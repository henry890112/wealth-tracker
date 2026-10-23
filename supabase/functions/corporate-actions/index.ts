import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data";
const CALCULATION_VERSION = 1;
const CACHE_HOURS = 12;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

type RecordLike = Record<string, unknown>;
type PriceRow = { date: string; high: number; close: number };
type CorporateAction = {
  id: string;
  type: "cash" | "stock" | "mixed" | "split";
  status: "completed" | "announced";
  announcementDate: string | null;
  exDate: string | null;
  cashExDate?: string | null;
  stockExDate?: string | null;
  paymentDate: string | null;
  cashDividend: number | null;
  stockDividend: number | null;
  ratioLabel?: string | null;
  referencePrice?: number | null;
  beforePrice?: number | null;
  afterPrice?: number | null;
  fillStatus: "filled" | "unfilled" | "pending" | "not_applicable";
  fillDate: string | null;
  daysToFill: number | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const dateBefore = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const dateAfter = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
const text = (value: unknown) => {
  const result = String(value ?? "").trim();
  return result || null;
};
const dateValue = (value: unknown) => {
  const result = text(value);
  return result && /^\d{4}-\d{2}-\d{2}/.test(result) ? result.slice(0, 10) : null;
};
const numberValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};
const eventSort = (a: CorporateAction, b: CorporateAction) => String(a.exDate || a.announcementDate || "").localeCompare(String(b.exDate || b.announcementDate || ""));

function safeDateNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

async function authenticate(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!url || !anon) return null;
  const client = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await client.auth.getUser(token);
  return error ? null : user;
}

async function fetchJson(url: string, headers: Record<string, string> = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

async function cached(marketType: string, symbol: string) {
  const client = serviceClient();
  if (!client) return null;
  const { data } = await client.from("corporate_actions_cache").select("payload,expires_at").eq("market_type", marketType).eq("symbol", symbol).maybeSingle();
  return data
    && new Date(data.expires_at).getTime() > Date.now()
    && Number(data.payload?.calculationVersion) === CALCULATION_VERSION
    ? data.payload
    : null;
}

async function cacheResult(marketType: string, symbol: string, payload: RecordLike) {
  const client = serviceClient();
  if (!client) return;
  await client.from("corporate_actions_cache").upsert({
    market_type: marketType,
    symbol,
    payload,
    source_as_of: payload.asOf || null,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + CACHE_HOURS * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "market_type,symbol" });
}

async function finmindDataset(dataset: string, symbol: string, startDate: string) {
  const token = Deno.env.get("FINMIND_API_TOKEN") || "";
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const params = new URLSearchParams({ dataset, data_id: symbol, start_date: startDate });
  const payload = await fetchJson(`${FINMIND_BASE}?${params}`, headers);
  if (Number(payload.status) !== 200) throw new Error(payload.msg || `FinMind ${dataset} 資料錯誤`);
  return Array.isArray(payload.data) ? payload.data as RecordLike[] : [];
}

function eventType(cashDividend: number | null, stockDividend: number | null): CorporateAction["type"] {
  const hasCash = Number(cashDividend || 0) > 0;
  const hasStock = Number(stockDividend || 0) > 0;
  return hasCash && hasStock ? "mixed" : hasStock ? "stock" : "cash";
}

function fillStatusFor(event: CorporateAction, prices: PriceRow[]) {
  if (event.status === "announced") return { fillStatus: "pending" as const, fillDate: null, daysToFill: null };
  const target = Number(event.beforePrice || 0);
  if (!event.exDate || !Number.isFinite(target) || target <= 0 || !prices.length) {
    return { fillStatus: "not_applicable" as const, fillDate: null, daysToFill: null };
  }
  const following = prices
    .map((row, index) => ({ ...row, index }))
    .filter(row => row.date >= event.exDate! && row.date <= dateAfter(event.exDate!, 180));
  const filled = following.find(row => row.high >= target);
  if (!filled) return { fillStatus: "unfilled" as const, fillDate: null, daysToFill: null };
  const exIndex = prices.findIndex(row => row.date >= event.exDate!);
  return { fillStatus: "filled" as const, fillDate: filled.date, daysToFill: exIndex >= 0 ? Math.max(0, filled.index - exIndex) : null };
}

function frequencyLabel(events: CorporateAction[]) {
  const dates = events.filter(event => event.exDate).map(event => new Date(`${event.exDate}T00:00:00Z`).getTime()).sort((a, b) => a - b);
  if (dates.length < 2) return dates.length ? "資料不足" : "無資料";
  const averageDays = dates.slice(1).reduce((sum, value, index) => sum + (value - dates[index]) / 86400000, 0) / (dates.length - 1);
  if (averageDays <= 120) return "季配附近";
  if (averageDays <= 240) return "半年配附近";
  return "年配附近";
}

function buildSummary(events: CorporateAction[], latestClose: number, asOf: string | null) {
  const currentDate = today();
  const cutoff = dateBefore(365);
  const completed = events.filter(event => event.exDate && event.exDate <= currentDate);
  const future = events.filter(event => event.exDate && event.exDate > currentDate).sort(eventSort);
  const latest = [...completed].sort((a, b) => String(b.exDate).localeCompare(String(a.exDate))).at(0) || null;
  const trailingCashDividend = completed.filter(event => String(event.exDate) >= cutoff).reduce((sum, event) => sum + Number(event.cashDividend || 0), 0);
  const trailingYield = latestClose > 0 ? trailingCashDividend / latestClose * 100 : null;
  return {
    latestEvent: latest,
    nextEvent: future.at(0) || null,
    trailingCashDividend,
    trailingYield,
    frequency: frequencyLabel(events),
    asOf,
  };
}

async function taiwanActions(symbol: string, years: number) {
  const startDate = dateBefore(years * 366 + 30);
  const [dividendRows, resultRows, priceRows] = await Promise.all([
    finmindDataset("TaiwanStockDividend", symbol, startDate),
    finmindDataset("TaiwanStockDividendResult", symbol, startDate),
    finmindDataset("TaiwanStockPrice", symbol, startDate),
  ]);
  const prices: PriceRow[] = priceRows.map(row => ({ date: String(row.date || ""), high: Number(row.max || 0), close: Number(row.close || 0) })).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const resultByDate = new Map(resultRows.map(row => [String(row.date || ""), row]));
  const grouped = new Map<string, CorporateAction>();
  for (const row of dividendRows) {
    const cashExDate = dateValue(row.CashExDividendTradingDate);
    const stockExDate = dateValue(row.StockExDividendTradingDate);
    const exDate = [cashExDate, stockExDate].filter(Boolean).sort()[0] || dateValue(row.date);
    const announcementDate = dateValue(row.AnnouncementDate) || dateValue(row.date);
    const result = (exDate && resultByDate.get(exDate)) || (cashExDate && resultByDate.get(cashExDate)) || (stockExDate && resultByDate.get(stockExDate));
    const resultKind = text(result?.stock_or_cache_dividend);
    const resultAmount = numberValue(result?.stock_and_cache_dividend);
    const cashDividend = numberValue(row.CashEarningsDistribution) ?? (resultKind === "息" ? resultAmount : null);
    const stockDividend = numberValue(row.StockEarningsDistribution) ?? (resultKind === "權" ? resultAmount : null);
    if (!exDate && !cashDividend && !stockDividend) continue;
    const key = `${text(row.year) || "unknown"}:${exDate || announcementDate || "unknown"}`;
    const existing = grouped.get(key);
    const event: CorporateAction = existing || {
      id: `tw-${key}`,
      type: eventType(cashDividend, stockDividend),
      status: exDate && exDate > today() ? "announced" : "completed",
      announcementDate,
      exDate,
      cashExDate,
      stockExDate,
      paymentDate: dateValue(row.CashDividendPaymentDate),
      cashDividend,
      stockDividend,
      referencePrice: numberValue(result?.reference_price),
      beforePrice: numberValue(result?.before_price),
      afterPrice: numberValue(result?.after_price),
      fillStatus: "not_applicable",
      fillDate: null,
      daysToFill: null,
    };
    if (existing) {
      event.cashDividend = event.cashDividend ?? cashDividend;
      event.stockDividend = event.stockDividend ?? stockDividend;
      event.cashExDate = event.cashExDate || cashExDate;
      event.stockExDate = event.stockExDate || stockExDate;
      event.paymentDate = event.paymentDate || dateValue(row.CashDividendPaymentDate);
      event.type = eventType(event.cashDividend, event.stockDividend);
    }
    const fill = fillStatusFor(event, prices);
    grouped.set(key, { ...event, ...fill });
  }
  const events = [...grouped.values()].sort(eventSort);
  const asOf = prices.at(-1)?.date || events.at(-1)?.exDate || null;
  const summary = buildSummary(events, prices.at(-1)?.close || 0, asOf);
  return {
    symbol,
    marketType: "TW",
    currency: "TWD",
    source: "FinMind・台股股利與除權息資料",
    asOf,
    calculationVersion: CALCULATION_VERSION,
    summary,
    events,
    warnings: [
      "填權息以除權息後價格是否回到除權息前價格估算；資料尚未公布或價格不足時不判定。",
      ...(events.length ? [] : ["來源目前沒有可用股利事件。"]),
    ],
  };
}

function yahooDate(value: unknown) {
  const number = safeDateNumber(value);
  return number ? new Date(number * 1000).toISOString().slice(0, 10) : null;
}

async function yahooDaily(symbol: string, years: number) {
  const period1 = Math.floor((Date.now() - (years * 366 + 10) * 86400000) / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const payload = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits`, { "User-Agent": "WealthTracker/1.0" });
  if (payload.chart?.error) throw new Error(payload.chart.error.description || "Yahoo 歷史價格錯誤");
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error("Yahoo 找不到這個美股代號");
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const rows: PriceRow[] = (result?.timestamp || []).map((timestamp: number, index: number) => ({ date: new Date(timestamp * 1000).toISOString().slice(0, 10), high: Number(result?.indicators?.quote?.[0]?.high?.[index] || 0), close: Number(closes[index] || 0) })).filter(row => row.close > 0);
  const dividends = Object.values(result?.events?.dividends || {}).map((item: unknown) => {
    const dividend = item as { date?: number; amount?: number };
    return { date: yahooDate(dividend.date), value: numberValue(dividend.amount) };
  }).filter(item => item.date && Number(item.value) > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const splits = Object.values(result?.events?.splits || {}).map((item: unknown) => {
    const split = item as { date?: number; numerator?: number; denominator?: number };
    const numerator = numberValue(split.numerator);
    const denominator = numberValue(split.denominator);
    return { date: yahooDate(split.date), numerator, denominator, ratioLabel: numerator && denominator ? `${numerator}:${denominator}` : "拆併" };
  }).filter(item => item.date && item.numerator && item.denominator).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { rows, dividends, splits };
}

async function yahooCalendar(symbol: string) {
  const headers = { "User-Agent": "WealthTracker/1.0" };
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const payload = await fetchJson(`https://${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents,summaryDetail`, headers, 10_000);
      const result = payload.quoteSummary?.result?.[0];
      const calendar = result?.calendarEvents || {};
      const details = result?.summaryDetail || {};
      const exDate = yahooDate(calendar.exDividendDate?.raw || details.exDividendDate?.raw);
      const paymentDate = yahooDate(calendar.dividendDate?.raw);
      if (exDate && exDate > today()) return { exDate, paymentDate, cashDividend: null };
    } catch {
      // Calendar metadata is optional; the chart events remain authoritative
      // for historical records when this endpoint is unavailable.
    }
  }
  return null;
}

async function usActions(symbol: string, years: number) {
  const [market, calendar] = await Promise.all([yahooDaily(symbol, years), yahooCalendar(symbol)]);
  const events: CorporateAction[] = [
    ...market.dividends.map(item => ({
      id: `us-dividend-${item.date}`,
      type: "cash" as const,
      status: "completed" as const,
      announcementDate: null,
      exDate: item.date,
      paymentDate: null,
      cashDividend: item.value,
      stockDividend: null,
      referencePrice: null,
      beforePrice: null,
      afterPrice: null,
      fillStatus: "not_applicable" as const,
      fillDate: null,
      daysToFill: null,
    })),
    ...market.splits.map(item => ({
      id: `us-split-${item.date}`,
      type: "split" as const,
      status: "completed" as const,
      announcementDate: null,
      exDate: item.date,
      paymentDate: null,
      cashDividend: null,
      stockDividend: null,
      ratioLabel: item.ratioLabel,
      referencePrice: null,
      beforePrice: null,
      afterPrice: null,
      fillStatus: "not_applicable" as const,
      fillDate: null,
      daysToFill: null,
    })),
  ];
  if (calendar?.exDate && !events.some(event => event.exDate === calendar.exDate)) {
    events.push({
      id: `us-upcoming-${calendar.exDate}`,
      type: "cash",
      status: "announced",
      announcementDate: null,
      exDate: calendar.exDate,
      paymentDate: calendar.paymentDate || null,
      cashDividend: calendar.cashDividend,
      stockDividend: null,
      fillStatus: "pending",
      fillDate: null,
      daysToFill: null,
    });
  }
  events.sort(eventSort);
  const asOf = market.rows.at(-1)?.date || events.at(-1)?.exDate || null;
  const summary = buildSummary(events, market.rows.at(-1)?.close || 0, asOf);
  return {
    symbol,
    marketType: "US",
    currency: "USD",
    source: "Yahoo Finance・股利與拆併事件",
    asOf,
    calculationVersion: CALCULATION_VERSION,
    summary,
    events,
    warnings: [
      "美股歷史股利與拆併事件依 Yahoo Finance 可提供資料；尚未公告的股利金額不自行推算。",
      ...(events.length ? [] : ["來源目前沒有可用股利或拆併事件。"]),
    ],
  };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!await authenticate(request)) return json({ error: "Unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const safeSymbol = String(body.symbol || "").trim().toUpperCase();
    const market = String(body.marketType || (/^\d+$/.test(safeSymbol) ? "TW" : "US")).toUpperCase();
    if (!/^[A-Z0-9.^-]{1,20}$/.test(safeSymbol)) return json({ error: "股票代號格式錯誤" }, 400);
    if (!["TW", "US"].includes(market)) return json({ error: "股利／除權息目前只支援台股與美股" }, 400);
    const forceRefresh = Boolean(body.forceRefresh);
    if (!forceRefresh) {
      const hit = await cached(market, safeSymbol).catch(() => null);
      if (hit) return json({ ...hit, cached: true });
    }
    const safeYears = Math.min(5, Math.max(1, Number(body.years) || 5));
    const result = market === "TW" ? await taiwanActions(safeSymbol, safeYears) : await usActions(safeSymbol, safeYears);
    await cacheResult(market, safeSymbol, result).catch(() => undefined);
    return json(result);
  } catch (error) {
    console.error("corporate-actions", error);
    return json({ error: error instanceof Error ? error.message : "無法取得股利／除權息資料" }, 502);
  }
});
