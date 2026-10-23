import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DISTRIBUTION_SOURCE = "https://djinfo.cathaysec.com.tw/z/zc/zcj/zcj.djhtm";
const TWSE_COMPANIES = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L";
const TPEX_COMPANIES = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O";

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

async function fetchPayload(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 WealthTracker/1.0", Accept: "text/html,application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function numberFromText(value: string) {
  return Number(String(value || "").replace(/[^0-9.-]/g, "")) || 0;
}

function sourceDate(monthDay: string) {
  const match = monthDay.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return "";
  const now = new Date();
  const taipeiYear = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Taipei", year: "numeric" }).format(now));
  const candidate = `${taipeiYear}-${match[1]}-${match[2]}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return candidate > today ? `${taipeiYear - 1}-${match[1]}-${match[2]}` : candidate;
}

async function distributionRows(symbol: string) {
  const sourceUrl = `${DISTRIBUTION_SOURCE}?A=${encodeURIComponent(symbol)}`;
  const response = await fetchPayload(sourceUrl);
  // The source page is Big5. Its HTML tags and numeric cells are ASCII, so a
  // UTF-8 decode is sufficient and avoids relying on optional legacy codecs.
  const html = new TextDecoder().decode(await response.arrayBuffer());
  const cellText = (value: string) => value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tableRows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(match => [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cellText(cell[1])))
    .filter(cells => cells.length >= 4 && /\d/.test(cells[1]) && /%/.test(cells[3]))
    .slice(0, 4);
  if (tableRows.length < 4) throw new Error("Institutional distribution unavailable");
  const labels = ["directors", "foreign", "trust", "dealer"];
  const rows = labels.map((key, index) => ({
    key,
    sharesLots: numberFromText(tableRows[index][1]),
    changeLots: numberFromText(tableRows[index][2]),
    ratio: numberFromText(tableRows[index][3]),
  }));
  const dateMatch = html.match(/class="t11"[^>]*>[^0-9]*(\d{2}\/\d{2})/i);
  return { rows, asOf: sourceDate(dateMatch?.[1] || ""), sourceUrl };
}

let companyCache: { expiresAt: number; listed: Record<string, number>; otc: Record<string, number> } | null = null;

async function issuedSharesMaps() {
  if (companyCache && companyCache.expiresAt > Date.now()) return companyCache;
  const [listedResult, otcResult] = await Promise.allSettled([
    (async () => (await fetchPayload(TWSE_COMPANIES)).json())(),
    (async () => (await fetchPayload(TPEX_COMPANIES)).json())(),
  ]);
  const listedPayload = listedResult.status === "fulfilled" && Array.isArray(listedResult.value) ? listedResult.value : [];
  const otcPayload = otcResult.status === "fulfilled" && Array.isArray(otcResult.value) ? otcResult.value : [];
  if (listedResult.status === "rejected") console.error("TWSE issued shares unavailable", listedResult.reason);
  if (otcResult.status === "rejected") console.error("TPEx issued shares unavailable", otcResult.reason);
  const listed = Object.fromEntries(listedPayload.map((row: Record<string, unknown>) => [
    String(row["公司代號"] || "").trim(), Number(row["已發行普通股數或TDR原股發行股數"] || 0),
  ]));
  const otc = Object.fromEntries(otcPayload.map((row: Record<string, unknown>) => [
    String(row.SecuritiesCompanyCode || "").trim(), Number(row.IssueShares || 0),
  ]));
  companyCache = { expiresAt: Date.now() + 6 * 60 * 60 * 1000, listed, otc };
  return companyCache;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!await authenticate(request)) return json({ error: "Unauthorized" }, 401);
    const { symbol } = await request.json();
    const safeSymbol = String(symbol || "").trim();
    if (!/^\d{4,6}$/.test(safeSymbol)) return json({ error: "Invalid Taiwan stock symbol" }, 400);

    const [{ rows, asOf, sourceUrl }, companies] = await Promise.all([
      distributionRows(safeSymbol),
      issuedSharesMaps(),
    ]);
    const issuedShares = Number(companies.listed[safeSymbol] || companies.otc[safeSymbol] || 0);
    const issuedLots = issuedShares > 0 ? Math.round(issuedShares / 1000) : 0;
    const categorizedLots = rows.reduce((sum, row) => sum + row.sharesLots, 0);
    const overlaps = issuedLots > 0 && categorizedLots > issuedLots;
    const otherLots = issuedLots > 0 && !overlaps ? Math.max(0, issuedLots - categorizedLots) : 0;
    const categories = [
      ...rows,
      ...(issuedLots > 0 && !overlaps ? [{
        key: "other",
        sharesLots: otherLots,
        changeLots: 0,
        ratio: Number((otherLots / issuedLots * 100).toFixed(2)),
      }] : []),
    ];

    return json({
      symbol: safeSymbol,
      asOf,
      issuedShares,
      issuedLots,
      categories,
      overlaps,
      source: "國泰證券 DJ 籌碼資料；發行股數：TWSE／TPEx OpenAPI",
      sourceUrl,
    });
  } catch (error) {
    console.error("institutional-distribution", error);
    return json({ error: error instanceof Error ? error.message : "Unable to load institutional distribution" }, 502);
  }
});
