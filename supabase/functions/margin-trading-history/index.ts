import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data";
const SOURCE_URL = "https://finmind.github.io/tutor/TaiwanMarket/Chip/";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "private, max-age=900" },
});

async function authenticate(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !anonKey) throw new Error("Supabase environment unavailable");
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  return error ? null : user;
}

function dateBefore(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

async function fetchRows(symbol: string, days: number) {
  const params = new URLSearchParams({
    dataset: "TaiwanStockMarginPurchaseShortSale",
    data_id: symbol,
    start_date: dateBefore(days),
  });
  const token = Deno.env.get("FINMIND_API_TOKEN") || "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${FINMIND_BASE}?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.status) !== 200) {
      throw new Error(payload.msg || `FinMind HTTP ${response.status}`);
    }
    return (Array.isArray(payload.data) ? payload.data : [])
      .map((row: Record<string, unknown>) => {
        const marginBalance = Number(row.MarginPurchaseTodayBalance || 0);
        const previousMarginBalance = Number(row.MarginPurchaseYesterdayBalance || 0);
        const shortBalance = Number(row.ShortSaleTodayBalance || 0);
        const previousShortBalance = Number(row.ShortSaleYesterdayBalance || 0);
        const marginLimit = Number(row.MarginPurchaseLimit || 0);
        return {
          time: String(row.date || ""),
          marginBalance,
          marginChange: marginBalance - previousMarginBalance,
          marginBuy: Number(row.MarginPurchaseBuy || 0),
          marginSell: Number(row.MarginPurchaseSell || 0),
          marginCashRepayment: Number(row.MarginPurchaseCashRepayment || 0),
          marginUtilization: marginLimit > 0 ? Number((marginBalance / marginLimit * 100).toFixed(2)) : null,
          shortBalance,
          shortChange: shortBalance - previousShortBalance,
          shortSell: Number(row.ShortSaleSell || 0),
          shortCover: Number(row.ShortSaleBuy || 0),
          shortCashRepayment: Number(row.ShortSaleCashRepayment || 0),
          shortToMargin: marginBalance > 0 ? Number((shortBalance / marginBalance * 100).toFixed(2)) : null,
          offset: Number(row.OffsetLoanAndShort || 0),
          note: String(row.Note || ""),
        };
      })
      .filter((row: { time: string }) => /^\d{4}-\d{2}-\d{2}$/.test(row.time))
      .sort((a: { time: string }, b: { time: string }) => a.time.localeCompare(b.time));
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!await authenticate(request)) return json({ error: "Unauthorized" }, 401);
    const { symbol, days = 420 } = await request.json();
    const safeSymbol = String(symbol || "").trim();
    const safeDays = Math.min(Math.max(Number(days) || 420, 90), 1200);
    if (!/^\d{4,6}$/.test(safeSymbol)) return json({ error: "Invalid Taiwan stock symbol" }, 400);
    const rows = await fetchRows(safeSymbol, safeDays);
    if (!rows.length) return json({ error: "目前沒有可用的融資融券資料" }, 404);
    return json({
      symbol: safeSymbol,
      asOf: rows.at(-1)?.time || "",
      rows,
      source: "FinMind／臺灣證券交易所融資融券資料",
      sourceUrl: SOURCE_URL,
    });
  } catch (error) {
    console.error("margin-trading-history", error);
    return json({ error: error instanceof Error ? error.message : "Unable to load margin trading history" }, 502);
  }
});
