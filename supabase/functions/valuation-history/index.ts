import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data";
const CALCULATION_VERSION = 4;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
const dateBefore = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

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
  const { data } = await client.from("valuation_history_cache").select("payload,expires_at").eq("market_type", marketType).eq("symbol", symbol).maybeSingle();
  return data
    && new Date(data.expires_at).getTime() > Date.now()
    && Number(data.payload?.calculationVersion) === CALCULATION_VERSION
    ? data.payload
    : null;
}

async function cacheResult(marketType: string, symbol: string, payload: Record<string, unknown>) {
  const client = serviceClient();
  if (!client) return;
  await client.from("valuation_history_cache").upsert({
    market_type: marketType,
    symbol,
    payload,
    source_as_of: payload.asOf || null,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "market_type,symbol" });
}

async function taiwanValuation(symbol: string, years: number) {
  const params = new URLSearchParams({ dataset: "TaiwanStockPER", data_id: symbol, start_date: dateBefore(years * 366 + 10) });
  const priceParams = new URLSearchParams({ dataset: "TaiwanStockPrice", data_id: symbol, start_date: dateBefore(45) });
  const token = Deno.env.get("FINMIND_API_TOKEN") || "";
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const [payload, pricePayload] = await Promise.all([
    fetchJson(`${FINMIND_BASE}?${params}`, headers),
    fetchJson(`${FINMIND_BASE}?${priceParams}`, headers).catch(() => ({ status: 200, data: [] })),
  ]);
  if (Number(payload.status) !== 200) throw new Error(payload.msg || "FinMind 估值資料錯誤");
  const rows = (payload.data || []).filter((row: Record<string, unknown>) => row.date && String(row.stock_id || symbol) === symbol);
  const series = (field: string, allowZero = false) => rows.map((row: Record<string, unknown>) => ({ date: String(row.date), value: Number(row[field]) }))
    .filter((row: { date: string; value: number }) => row.date && Number.isFinite(row.value) && (allowZero ? row.value >= 0 : row.value > 0))
    .sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));
  const per = series("PER");
  const pbr = series("PBR");
  const dividendYield = series("dividend_yield", true);
  const latestValuationDate = String(rows.at(-1)?.date || "");
  const latestPrice = (pricePayload.data || []).filter((row: Record<string, unknown>) => String(row.date || "") <= latestValuationDate && Number(row.close) > 0).at(-1);
  return {
    symbol, marketType: "TW", source: "FinMind・臺灣證交所資料", asOf: rows.at(-1)?.date || null,
    calculationVersion: CALCULATION_VERSION,
    referenceClose: Number(latestPrice?.close || 0) || null,
    metrics: { per, pbr, ps: [], dividendYield },
    warnings: ["台股市銷率歷史資料目前未由來源提供；PER 為負或零時不列入位階。"],
  };
}

type SecFact = { start?: string; end?: string; filed?: string; val?: number; form?: string; fp?: string; fy?: number; frame?: string };
type Quarter = { frame: string; end: string; filed: string; value: number };

function factUnits(companyFacts: Record<string, unknown>, namespaces: string[], concepts: string[], unit: string) {
  let best: SecFact[] = [];
  let bestLatestEnd = "";
  let bestCoverage = -1;
  for (const namespace of namespaces) {
    const facts = (companyFacts?.facts as Record<string, Record<string, unknown>> | undefined)?.[namespace] || {};
    for (const concept of concepts) {
      const units = (facts[concept] as { units?: Record<string, SecFact[]> } | undefined)?.units;
      const rows = units?.[unit];
      if (!Array.isArray(rows) || !rows.length) continue;
      const usable = rows.filter(item => item.end && item.filed && Number.isFinite(Number(item.val)));
      const latestEnd = usable.reduce((latest, item) => String(item.end) > latest ? String(item.end) : latest, "");
      const coverage = new Set(usable.map(item => `${item.start || "instant"}|${item.end}`)).size;
      if (latestEnd > bestLatestEnd || (latestEnd === bestLatestEnd && coverage > bestCoverage)) {
        best = rows;
        bestLatestEnd = latestEnd;
        bestCoverage = coverage;
      }
    }
  }
  return best;
}

const validForms = new Set(["10-Q", "10-K", "10-Q/A", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]);
function durationDays(item: SecFact) {
  const start = new Date(String(item.start || "")).getTime();
  const end = new Date(String(item.end || "")).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86400000) : 0;
}

function quarterlyFacts(rows: SecFact[]): Quarter[] {
  const candidates = rows.filter(item => validForms.has(String(item.form)) && item.start && item.end && item.filed && Number.isFinite(Number(item.val)));
  // SEC Company Facts repeats prior-year comparison periods in newer filings.
  // Grouping by fy/fp can therefore label a comparative 2025 quarter as FY2026.
  // A financial period is identified by its actual start/end dates instead.
  type PeriodFact = { item: SecFact; firstFiled: string };
  const quarterlyPeriods = new Map<string, PeriodFact>();
  const annualPeriods = new Map<string, PeriodFact>();
  const updatePeriod = (periods: Map<string, PeriodFact>, key: string, item: SecFact) => {
    const filed = String(item.filed);
    const current = periods.get(key);
    if (!current) {
      periods.set(key, { item, firstFiled: filed });
      return;
    }
    current.firstFiled = filed < current.firstFiled ? filed : current.firstFiled;
    // Use the newest restated value (important after stock splits), while
    // preserving the date when the period first became publicly available.
    if (filed >= String(current.item.filed)) current.item = item;
  };
  for (const item of candidates) {
    const period = String(item.fp || "");
    const days = durationDays(item);
    if (["Q1", "Q2", "Q3"].includes(period) && days >= 60 && days <= 150) {
      const key = `${item.start}|${item.end}`;
      updatePeriod(quarterlyPeriods, key, item);
    }
    if (period === "FY" && days >= 300 && days <= 390) {
      const key = `${item.start}|${item.end}`;
      updatePeriod(annualPeriods, key, item);
    }
  }
  const quarters: Quarter[] = [...quarterlyPeriods.values()].map(period => ({
    item: period.item,
    firstFiled: period.firstFiled,
  })).map(({ item, firstFiled }) => ({
    frame: String(item.frame || `${item.start}/${item.end}`),
    end: String(item.end),
    filed: firstFiled,
    value: Number(item.val),
  }));
  for (const annualPeriod of annualPeriods.values()) {
    const annual = annualPeriod.item;
    const annualStart = String(annual.start);
    const annualEnd = String(annual.end);
    const firstThree = [...quarterlyPeriods.values()]
      .map(period => period.item)
      .filter(item => String(item.start) >= annualStart && String(item.end) < annualEnd)
      .sort((a, b) => String(a.end).localeCompare(String(b.end)));
    if (firstThree.length !== 3) continue;
    quarters.push({
      frame: String(annual.frame || `${annualStart}/${annualEnd}`) + "Q4",
      end: annualEnd,
      filed: annualPeriod.firstFiled,
      value: Number(annual.val) - firstThree.reduce((sum, quarter) => sum + Number(quarter.val || 0), 0),
    });
  }
  return quarters.sort((a, b) => a.end.localeCompare(b.end) || a.filed.localeCompare(b.filed));
}

function ttmSeries(rows: SecFact[]) {
  const quarters = quarterlyFacts(rows);
  const result: Array<{ end: string; filed: string; value: number }> = [];
  for (let index = 3; index < quarters.length; index += 1) {
    const window = quarters.slice(index - 3, index + 1);
    const spanDays = (new Date(window.at(-1)!.end).getTime() - new Date(window[0].end).getTime()) / 86400000;
    if (spanDays < 250 || spanDays > 390) continue;
    result.push({ end: window.at(-1)!.end, filed: window.reduce((latest, item) => item.filed > latest ? item.filed : latest, ""), value: window.reduce((sum, item) => sum + item.value, 0) });
  }
  return result;
}

function instantSeries(rows: SecFact[]) {
  const byEnd = new Map<string, { end: string; filed: string; sourceFiled: string; value: number }>();
  for (const item of rows.filter(entry => validForms.has(String(entry.form)) && entry.end && entry.filed && Number.isFinite(Number(entry.val)))) {
    const end = String(item.end);
    const filed = String(item.filed);
    const current = byEnd.get(end);
    if (!current) byEnd.set(end, { end, filed, sourceFiled: filed, value: Number(item.val) });
    else {
      current.filed = filed < current.filed ? filed : current.filed;
      if (filed >= current.sourceFiled) {
        current.sourceFiled = filed;
        current.value = Number(item.val);
      }
    }
  }
  return [...byEnd.values()]
    .map(({ sourceFiled: _sourceFiled, ...item }) => item)
    .sort((a, b) => a.filed.localeCompare(b.filed));
}

function latestAt<T extends { filed: string }>(rows: T[], date: string) {
  let found: T | null = null;
  for (const row of rows) {
    if (row.filed <= date && (!found || row.filed >= found.filed)) found = row;
  }
  return found;
}

async function yahooDaily(symbol: string, years: number) {
  const period1 = Math.floor((Date.now() - (years * 366 + 10) * 86400000) / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const payload = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits`, { "User-Agent": "WealthTracker/1.0" });
  if (payload.chart?.error) throw new Error(payload.chart.error.description || "Yahoo 歷史價格錯誤");
  const result = payload.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const rows = (result?.timestamp || []).map((timestamp: number, index: number) => ({ date: new Date(timestamp * 1000).toISOString().slice(0, 10), close: Number(closes[index]) })).filter((row: { close: number }) => row.close > 0);
  const dividends = Object.values(result?.events?.dividends || {}).map((item: unknown) => {
    const dividend = item as { date?: number; amount?: number };
    return { date: new Date(Number(dividend.date || 0) * 1000).toISOString().slice(0, 10), value: Number(dividend.amount || 0) };
  }).filter((item: { date: string; value: number }) => item.date && item.value > 0).sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));
  return { rows, dividends };
}

async function usValuation(symbol: string, years: number) {
  const userAgent = Deno.env.get("SEC_USER_AGENT") || "WealthTracker/1.0 personal-research-app";
  const headers = { "User-Agent": userAgent, Accept: "application/json", "Accept-Encoding": "gzip, deflate" };
  const tickers = await fetchJson("https://www.sec.gov/files/company_tickers.json", headers);
  const match = Object.values(tickers).find((item: unknown) => String((item as { ticker?: string }).ticker || "").toUpperCase() === symbol) as { cik_str?: number; title?: string } | undefined;
  if (!match?.cik_str) throw new Error("SEC 找不到這個美股代號，ETF 或部分 ADR 可能沒有公司財報資料。");
  const cik = String(match.cik_str).padStart(10, "0");
  const [companyFacts, market] = await Promise.all([
    fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, headers),
    yahooDaily(symbol, years),
  ]);
  const dilutedEpsRows = factUnits(companyFacts, ["us-gaap"], ["EarningsPerShareDiluted"], "USD/shares");
  const basicEpsRows = dilutedEpsRows.length ? [] : factUnits(companyFacts, ["us-gaap"], ["EarningsPerShareBasic"], "USD/shares");
  const earningsPerShare = ttmSeries(dilutedEpsRows.length ? dilutedEpsRows : basicEpsRows);
  const netIncome = ttmSeries(factUnits(companyFacts, ["us-gaap"], ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"], "USD"));
  const revenue = ttmSeries(factUnits(companyFacts, ["us-gaap"], ["RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "Revenues"], "USD"));
  const equity = instantSeries(factUnits(companyFacts, ["us-gaap"], ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], "USD"));
  const shares = instantSeries(factUnits(companyFacts, ["dei", "us-gaap"], ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"], "shares"));
  const per: Array<{ date: string; value: number }> = [];
  const pbr: Array<{ date: string; value: number }> = [];
  const ps: Array<{ date: string; value: number }> = [];
  const dividendYield: Array<{ date: string; value: number }> = [];
  for (const price of market.rows) {
    const eps = latestAt(earningsPerShare, price.date);
    const income = latestAt(netIncome, price.date);
    const sales = latestAt(revenue, price.date);
    const book = latestAt(equity, price.date);
    const shareCount = latestAt(shares, price.date);
    const marketCap = shareCount && shareCount.value > 0 ? price.close * shareCount.value : 0;
    if (eps && eps.value > 0) per.push({ date: price.date, value: price.close / eps.value });
    else if (marketCap > 0 && income && income.value > 0) per.push({ date: price.date, value: marketCap / income.value });
    if (marketCap > 0 && book && book.value > 0) pbr.push({ date: price.date, value: marketCap / book.value });
    if (marketCap > 0 && sales && sales.value > 0) ps.push({ date: price.date, value: marketCap / sales.value });
    const cutoff = new Date(new Date(`${price.date}T00:00:00Z`).getTime() - 365 * 86400000).toISOString().slice(0, 10);
    const trailingDividend = market.dividends.filter(item => item.date > cutoff && item.date <= price.date).reduce((sum, item) => sum + item.value, 0);
    if (trailingDividend >= 0) dividendYield.push({ date: price.date, value: trailingDividend / price.close * 100 });
  }
  return {
    symbol, marketType: "US", companyName: match.title || "", source: "SEC Company Facts・Yahoo Finance", asOf: market.rows.at(-1)?.date || null,
    calculationVersion: CALCULATION_VERSION,
    referenceClose: Number(market.rows.at(-1)?.close || 0) || null,
    metrics: { per, pbr, ps, dividendYield },
    warnings: ["美股 PER 優先使用 SEC 稀釋 EPS TTM；PBR 與 P/S 依 SEC 財報、流通股數與每日收盤價推算。財報生效日採 filed 日期，盤中值為暫估。", ...(earningsPerShare.length || netIncome.length ? [] : ["缺少可用的近四季獲利資料，PER 無法計算。"])],
  };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!await authenticate(request)) return json({ error: "Unauthorized" }, 401);
    const { symbol, marketType, years = 5, forceRefresh = false } = await request.json();
    const safeSymbol = String(symbol || "").trim().toUpperCase();
    const market = String(marketType || (/^\d+$/.test(safeSymbol) ? "TW" : "US")).toUpperCase();
    if (!/^[A-Z0-9.^-]{1,20}$/.test(safeSymbol)) return json({ error: "股票代號格式錯誤" }, 400);
    if (!["TW", "US"].includes(market)) return json({ error: "估值位階目前只支援台股與美股" }, 400);
    if (!forceRefresh) {
      const hit = await cached(market, safeSymbol).catch(() => null);
      if (hit) return json({ ...hit, cached: true });
    }
    const safeYears = Math.min(5, Math.max(1, Number(years) || 5));
    const result = market === "TW" ? await taiwanValuation(safeSymbol, safeYears) : await usValuation(safeSymbol, safeYears);
    await cacheResult(market, safeSymbol, result).catch(() => undefined);
    return json(result);
  } catch (error) {
    console.error("valuation-history", error);
    return json({ error: error instanceof Error ? error.message : "無法取得估值資料" }, 502);
  }
});
