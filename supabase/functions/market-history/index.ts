import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
});
const dateBefore = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

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

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function yahooRows(symbol: string, days: number) {
  const period1 = Math.floor((Date.now() - days * 86400000) / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const payload = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`, { "User-Agent": "WealthTracker/1.0" });
  if (payload.chart?.error) throw new Error(payload.chart.error.description || "Yahoo market data error");
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp || [];
  const marketDate = result?.meta?.regularMarketTime ? new Date(result.meta.regularMarketTime * 1000).toISOString().slice(0, 10) : null;
  return timestamps.map((timestamp: number, index: number) => {
    const time = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const reportedClose = Number(quote?.close?.[index]);
    const latestPrice = Number(result?.meta?.regularMarketPrice);
    return {
      time,
      open: Number(quote?.open?.[index]),
      high: Number(quote?.high?.[index]),
      low: Number(quote?.low?.[index]),
      close: reportedClose > 0 ? reportedClose : (index === timestamps.length - 1 && time === marketDate && latestPrice > 0 ? latestPrice : 0),
      volume: Number(quote?.volume?.[index] || 0),
    };
  }).filter((row: { open: number; high: number; low: number; close: number }) => row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0);
}

type MarketQuote = {
  price: number;
  time: string;
  candleDate?: string;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  source: string;
  marketState?: string;
  isLive: boolean;
};

function marketSessionIsOpen(market: string, date = new Date()) {
  const clock = zonedClock(market === "TW" ? "Asia/Taipei" : "America/New_York", date);
  if (["Sat", "Sun"].includes(clock.weekday)) return false;
  const minutes = clock.hour * 60 + clock.minute;
  const openMinutes = market === "TW" ? 9 * 60 : 9 * 60 + 30;
  const closeMinutes = market === "TW" ? 13 * 60 + 35 : 16 * 60 + 10;
  return minutes >= openMinutes && minutes < closeMinutes;
}

function quoteLooksLive(timestamp: number, market: string, marketState: string) {
  if (marketState === "REGULAR") return true;
  // Some Yahoo v8/chart responses contain fresh 1-minute bars but omit
  // marketState entirely. Explicit PRE/POST/CLOSED states must still win.
  if (marketState) return false;
  const quoteDate = new Date(timestamp * 1000);
  const timeZone = market === "TW" ? "Asia/Taipei" : "America/New_York";
  const sameSessionDate = zonedClock(timeZone, quoteDate).date === zonedClock(timeZone).date;
  const ageMs = Date.now() - quoteDate.getTime();
  return sameSessionDate && marketSessionIsOpen(market) && ageMs >= -120_000 && ageMs <= 30 * 60_000;
}

function nasdaqClockMinutes(value: unknown) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return -1;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

async function yahooQuote(symbol: string, market: string): Promise<MarketQuote | null> {
  const payload = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`,
    { "User-Agent": "WealthTracker/1.0" },
  );
  if (payload.chart?.error) throw new Error(payload.chart.error.description || "Yahoo quote error");
  const result = payload.chart?.result?.[0];
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp || [];
  const closes = quote?.close || [];
  const opens = quote?.open || [];
  const highs = quote?.high || [];
  const lows = quote?.low || [];
  const volumes = quote?.volume || [];
  const latestBarPrice = [...closes].reverse().find((value: unknown) => Number(value) > 0);
  const price = Number(meta.regularMarketPrice || latestBarPrice || 0);
  const timestamp = Number(meta.regularMarketTime || result?.timestamp?.at(-1) || 0);
  if (!(price > 0) || !(timestamp > 0)) return null;
  const marketState = String(meta.marketState || "").toUpperCase();
  const sessionBars = timestamps.map((barTime: number, index: number) => ({
    time: Number(barTime), open: Number(opens[index]), high: Number(highs[index]), low: Number(lows[index]), volume: Number(volumes[index] || 0),
  })).filter((bar: { time: number; open: number; high: number; low: number }) => bar.time > 0 && bar.open > 0 && bar.high > 0 && bar.low > 0);
  const sessionOpen = sessionBars.at(0)?.open;
  const sessionHigh = sessionBars.length ? Math.max(...sessionBars.map(bar => bar.high), price) : undefined;
  const sessionLow = sessionBars.length ? Math.min(...sessionBars.map(bar => bar.low), price) : undefined;
  const sessionVolume = sessionBars.reduce((total: number, bar: { volume: number }) => total + bar.volume, 0);
  return {
    price,
    time: new Date(timestamp * 1000).toISOString(),
    candleDate: zonedClock(market === "TW" ? "Asia/Taipei" : "America/New_York", new Date(timestamp * 1000)).date,
    open: sessionOpen,
    high: sessionHigh,
    low: sessionLow,
    volume: sessionVolume || undefined,
    source: "Yahoo Finance",
    marketState: marketState || undefined,
    isLive: quoteLooksLive(timestamp, market, marketState),
  };
}

const numericText = (value: unknown) => Number(String(value || "").replace(/[^0-9.-]/g, ""));

function usMarketIsOpen(date = new Date()) {
  const clock = zonedClock("America/New_York", date);
  if (["Sat", "Sun"].includes(clock.weekday)) return false;
  const minutes = clock.hour * 60 + clock.minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60 + 10;
}

async function nasdaqQuote(symbol: string): Promise<MarketQuote | null> {
  const normalized = symbol === "^GSPC" ? "SPY" : symbol;
  const assetClasses = ["QQQ", "SPY"].includes(normalized) ? ["etf", "stocks"] : ["stocks", "etf"];
  for (const assetClass of assetClasses) {
    try {
      const payload = await fetchJson(
        `https://api.nasdaq.com/api/quote/${encodeURIComponent(normalized)}/chart?assetclass=${assetClass}`,
        { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      );
      if (Number(payload?.status?.rCode) !== 200 || !Array.isArray(payload?.data?.chart)) continue;
      const currentDate = zonedClock("America/New_York").date;
      const bars = payload.data.chart.map((point: Record<string, unknown>) => {
        const timestamp = Number(point.x || 0);
        // Nasdaq's x value is a timezone-less wall-clock epoch. z.dateTime is
        // the authoritative Eastern Time label (for example "11:31 AM ET").
        return { timestamp, minutes: nasdaqClockMinutes((point.z as Record<string, unknown> | undefined)?.dateTime), price: Number(point.y || 0) };
      }).filter((point: { timestamp: number; minutes: number; price: number }) => point.minutes >= 9 * 60 + 30
        && point.minutes <= 16 * 60 && point.price > 0);
      if (!bars.length || !usMarketIsOpen()) return null;
      const last = bars.at(-1)!;
      return {
        price: last.price,
        time: new Date().toISOString(),
        candleDate: currentDate,
        open: bars[0].price,
        high: Math.max(...bars.map((bar: { price: number }) => bar.price)),
        low: Math.min(...bars.map((bar: { price: number }) => bar.price)),
        volume: numericText(payload.data.volume),
        source: "Nasdaq",
        marketState: "REGULAR",
        isLive: true,
      };
    } catch {
      // Try the other Nasdaq asset class.
    }
  }
  return null;
}

async function marketQuote(symbol: string, market: string) {
  const candidates = market === "TW" && /^\d+$/.test(symbol)
    ? [`${symbol}.TW`, `${symbol}.TWO`]
    : [symbol];
  for (const candidate of candidates) {
    try {
      const quote = await yahooQuote(candidate, market);
      if (quote?.isLive) return quote;
    } catch {
      // Try the next Taiwan suffix, or Nasdaq for US symbols.
    }
  }
  return market === "US" ? nasdaqQuote(symbol) : null;
}

async function taiwanStockName(symbol: string, headers: Record<string, string>) {
  const params = new URLSearchParams({ dataset: "TaiwanStockInfo", data_id: symbol });
  const payload = await fetchJson(`${FINMIND_BASE}?${params}`, headers);
  if (payload.status !== 200) return "";
  const matches = (payload.data || []).filter((row: Record<string, unknown>) => String(row.stock_id || "") === symbol);
  return String(matches.at(-1)?.stock_name || matches[0]?.stock_name || "").trim();
}

async function finmind(symbol: string, days: number) {
  const token = Deno.env.get("FINMIND_API_TOKEN") || "";
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const startDate = dateBefore(days);
  const priceParams = new URLSearchParams({ dataset: "TaiwanStockPrice", data_id: symbol, start_date: startDate });
  const institutionParams = new URLSearchParams({ dataset: "TaiwanStockInstitutionalInvestorsBuySell", data_id: symbol, start_date: startDate });
  const [prices, institutions, name] = await Promise.all([
    fetchJson(`${FINMIND_BASE}?${priceParams}`, headers),
    fetchJson(`${FINMIND_BASE}?${institutionParams}`, headers).catch(() => ({ status: 200, data: [] })),
    taiwanStockName(symbol, headers).catch(() => ""),
  ]);
  if (prices.status !== 200) throw new Error(prices.msg || "FinMind price data error");
  const rows = (prices.data || []).map((row: Record<string, unknown>) => ({
    time: String(row.date), open: Number(row.open), high: Number(row.max), low: Number(row.min), close: Number(row.close), volume: Number(row.Trading_Volume || 0),
  })).filter((row: { time: string; open: number; high: number; low: number; close: number }) => row.time && row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0);
  const grouped = new Map<string, { time: string; foreign: number; trust: number; dealer: number; dealerSelf: number; dealerHedging: number }>();
  for (const row of institutions.data || []) {
    const time = String(row.date || "");
    if (!time) continue;
    const item = grouped.get(time) || { time, foreign: 0, trust: 0, dealer: 0, dealerSelf: 0, dealerHedging: 0 };
    const net = Number(row.buy || 0) - Number(row.sell || 0);
    const name = String(row.name || "");
    if (name === "Foreign_Investor" || name === "Foreign_Dealer_Self") item.foreign += net;
    else if (name === "Investment_Trust") item.trust += net;
    else if (name === "Dealer_self") { item.dealerSelf += net; item.dealer += net; }
    else if (name === "Dealer_Hedging") { item.dealerHedging += net; item.dealer += net; }
    grouped.set(time, item);
  }
  return { rows, institutional: [...grouped.values()].sort((a, b) => a.time.localeCompare(b.time)), name };
}

async function binanceRows(symbol: string, days: number) {
  const pair = symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;
  const limit = Math.min(1000, Math.max(60, days));
  const payload = await fetchJson(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=1d&limit=${limit}`);
  if (!Array.isArray(payload)) throw new Error(payload.msg || "Binance market data error");
  return payload.map((row: unknown[]) => ({
    time: new Date(Number(row[0])).toISOString().slice(0, 10), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5] || 0),
  })).filter((row: { open: number; high: number; low: number; close: number }) => row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0);
}

function zonedClock(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")), weekday: get("weekday") };
}

type PriceRow = { time: string; open: number; high: number; low: number; close: number; volume: number };

function mergeIntradayQuote(rows: PriceRow[], quote: MarketQuote | null) {
  if (!quote?.isLive || !quote.candleDate || !(quote.open! > 0) || !(quote.high! > 0) || !(quote.low! > 0) || !(quote.price > 0)) return rows;
  const intraday = {
    time: quote.candleDate,
    open: Number(quote.open), high: Number(quote.high), low: Number(quote.low),
    close: quote.price, volume: Number(quote.volume || 0),
  };
  const merged = rows.filter(row => row.time !== intraday.time);
  merged.push(intraday);
  return merged.sort((a, b) => a.time.localeCompare(b.time));
}

function completedDailyRows(rows: Array<{ time: string }>, market: string) {
  if (!rows.length) return rows;
  if (market === "CRYPTO") {
    const utcDate = new Date().toISOString().slice(0, 10);
    return rows.at(-1)?.time === utcDate ? rows.slice(0, -1) : rows;
  }
  const clock = zonedClock(market === "TW" ? "Asia/Taipei" : "America/New_York");
  const weekday = !["Sat", "Sun"].includes(clock.weekday);
  const closeMinutes = market === "TW" ? 13 * 60 + 35 : 16 * 60 + 10;
  const sessionNotFinal = weekday && clock.hour * 60 + clock.minute < closeMinutes;
  return sessionNotFinal && rows.at(-1)?.time === clock.date ? rows.slice(0, -1) : rows;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!await authenticate(request)) return json({ error: "Unauthorized" }, 401);
    const { symbol, marketType, days = 1095, includeIntraday = false } = await request.json();
    const safeSymbol = String(symbol || "").trim().toUpperCase();
    const market = String(marketType || (/^\d+$/.test(safeSymbol) ? "TW" : "US")).toUpperCase();
    const safeDays = Math.min(Math.max(Number(days) || 1095, 60), 2000);
    if (!/^[A-Z0-9.-]+$/.test(safeSymbol)) return json({ error: "Invalid symbol" }, 400);
    if (!["TW", "US", "CRYPTO"].includes(market)) return json({ error: "Unsupported market" }, 400);
    const primaryRequest = market === "TW"
      ? finmind(safeSymbol, safeDays)
      : (market === "CRYPTO" ? binanceRows(safeSymbol, safeDays) : yahooRows(safeSymbol, safeDays))
        .then(rows => ({ rows, institutional: [] }));
    const benchmarkRequest = market === "CRYPTO"
      ? binanceRows("BTCUSDT", safeDays)
      : yahooRows(market === "TW" ? "^TWII" : "^GSPC", safeDays);
    const relativeStrengthRequest = market === "US"
      ? yahooRows("QQQ", safeDays)
      : benchmarkRequest;
    const relativeStrengthBenchmark = market === "US" ? "QQQ" : market === "TW" ? "加權指數" : "BTC";
    const quoteRequest = market === "CRYPTO"
      ? Promise.resolve(null)
      : marketQuote(safeSymbol, market).catch(() => null);
    const benchmarkQuoteRequest = market === "CRYPTO"
      ? Promise.resolve(null)
      : marketQuote(market === "TW" ? "^TWII" : "^GSPC", market).catch(() => null);
    const relativeStrengthQuoteRequest = market === "US"
      ? marketQuote("QQQ", market).catch(() => null)
      : benchmarkQuoteRequest;
    const [primary, benchmarkRows, relativeStrengthRows, quote, benchmarkQuote, relativeStrengthQuote] = await Promise.all([
      primaryRequest,
      benchmarkRequest.catch(() => []),
      relativeStrengthRequest.catch(() => []),
      quoteRequest,
      benchmarkQuoteRequest,
      relativeStrengthQuoteRequest,
    ]);
    const completedRows = completedDailyRows(primary.rows, market);
    const completedBenchmarkRows = completedDailyRows(benchmarkRows, market);
    const completedRelativeStrengthRows = completedDailyRows(relativeStrengthRows, market);
    const cryptoDate = zonedClock("UTC").date;
    const cryptoIntraday = market === "CRYPTO" && primary.rows.at(-1)?.time === cryptoDate;
    const useIntraday = Boolean(includeIntraday) && (cryptoIntraday || Boolean(quote?.isLive));
    const result = {
      ...primary,
      rows: useIntraday ? (cryptoIntraday ? primary.rows : mergeIntradayQuote(completedRows, quote)) : completedRows,
      benchmarkRows: useIntraday ? (cryptoIntraday ? benchmarkRows : mergeIntradayQuote(completedBenchmarkRows, benchmarkQuote)) : completedBenchmarkRows,
      relativeStrengthRows: useIntraday ? (cryptoIntraday ? relativeStrengthRows : mergeIntradayQuote(completedRelativeStrengthRows, relativeStrengthQuote)) : completedRelativeStrengthRows,
      relativeStrengthBenchmark,
      quote,
      quoteSource: quote?.source || "",
      quoteStatus: useIntraday ? "intraday" : "official_close",
      isIntraday: useIntraday,
      quoteTime: useIntraday ? (quote?.time || new Date().toISOString()) : "",
      intradayUnavailable: Boolean(includeIntraday) && ["TW", "US"].includes(market) && marketSessionIsOpen(market) && !useIntraday,
    };
    if (result.rows.length < 60) return json({ error: "歷史資料不足 60 個交易日。" }, 422);
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Market history request failed" }, 500);
  }
});
