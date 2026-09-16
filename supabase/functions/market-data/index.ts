import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.1";
import { fetchUnifiedQuote, normalizeMarket, staleQuoteFromCache, type UnifiedQuote } from "../_shared/marketData.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});

async function authenticate(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const client = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  return error ? null : user;
}

const dbMarket = (market: string) => market === "CRYPTO" ? "Crypto" : market;
const cacheKey = (market: string, symbol: string) => `${market}:${symbol}`;

function cachedQuote(row: Record<string, unknown>, symbol: string, market: string): UnifiedQuote | null {
  const current = staleQuoteFromCache(row, symbol, market);
  if (!current) return null;
  const fetchedAt = new Date(String(row.fetched_at || row.updated_at || "")).getTime();
  const fresh = Number.isFinite(fetchedAt) && Date.now() - fetchedAt < 30_000;
  return fresh ? {
    ...current,
    quoteStatus: String(row.quote_status || "unknown") as UnifiedQuote["quoteStatus"],
    isIntraday: String(row.quote_status) === "intraday",
    isStale: Boolean(row.is_stale),
  } : current;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!await authenticate(request)) return json({ error: "Unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const entries = Array.isArray(body.symbols)
      ? body.symbols
      : [{ symbol: body.symbol, market: body.market || body.marketType }];
    const targets = [...new Map(entries.map((entry: Record<string, unknown>) => {
      const symbol = String(entry?.symbol || "").trim().toUpperCase();
      const market = normalizeMarket(entry?.market || entry?.marketType, symbol);
      return [cacheKey(market, symbol), { symbol, market }];
    }).filter(([, value]) => value.symbol))].map(([, value]) => value).slice(0, 75);
    if (!targets.length) return json({ error: "No symbols supplied" }, 400);

    const url = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const symbols = [...new Set(targets.map(item => item.symbol))];
    const { data: cacheRows } = await admin.from("price_cache").select("*").in("symbol", symbols);
    const cache = new Map((cacheRows || []).map(row => [cacheKey(normalizeMarket(row.market_type, row.symbol), row.symbol), row]));
    const forceRefresh = Boolean(body.forceRefresh);

    const results = await Promise.all(targets.map(async target => {
      const row = cache.get(cacheKey(target.market, target.symbol));
      const cached = row ? cachedQuote(row, target.symbol, target.market) : null;
      if (!forceRefresh && cached && !cached.isStale) return { quote: cached };
      try {
        const live = await fetchUnifiedQuote(target.symbol, target.market);
        const { error: cacheError } = await admin.from("price_cache").upsert({
          symbol: live.symbol,
          market_type: dbMarket(live.market),
          price: live.price,
          change_percent: live.changePercent,
          volume: live.volume,
          source: live.source,
          source_time: live.sourceTime,
          fetched_at: live.fetchedAt,
          quote_status: live.quoteStatus,
          is_stale: live.isStale,
          updated_at: live.fetchedAt,
        }, { onConflict: "symbol,market_type" });
        if (cacheError) console.error("price-cache", target.symbol, cacheError.message);
        return { quote: live };
      } catch (error) {
        if (cached) return { quote: cached, warning: error instanceof Error ? error.message : "Provider failed" };
        return { error: error instanceof Error ? error.message : "Quote unavailable", symbol: target.symbol, market: target.market };
      }
    }));
    return json({
      quotes: results.flatMap(result => result.quote ? [result.quote] : []),
      errors: results.flatMap(result => result.error ? [{ symbol: result.symbol, market: result.market, error: result.error }] : []),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Market data request failed" }, 500);
  }
});
