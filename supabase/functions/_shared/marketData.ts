export type MarketCode = "TW" | "US" | "CRYPTO";

export type PriceCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type UnifiedQuote = {
  symbol: string;
  market: MarketCode;
  price: number;
  changePercent: number;
  volume: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  source: string;
  sourceTime: string;
  fetchedAt: string;
  candleDate: string;
  session: "regular" | "pre" | "post" | "closed" | "continuous" | "reference" | "unknown";
  quoteStatus: "intraday" | "official_close" | "reference" | "stale" | "unavailable";
  isIntraday: boolean;
  isStale: boolean;
  delaySeconds: number | null;
};

const FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data";
const STABLECOINS = new Set(["USDT", "USDC", "BUSD", "DAI", "TUSD", "FDUSD"]);
const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", USDT: "tether", BNB: "binancecoin", SOL: "solana",
  XRP: "ripple", USDC: "usd-coin", DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche-2",
  TRX: "tron", TON: "the-open-network", LINK: "chainlink", DOT: "polkadot", MATIC: "matic-network",
  SHIB: "shiba-inu", LTC: "litecoin", UNI: "uniswap", ATOM: "cosmos", XLM: "stellar",
};

const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJson(url: string, options: RequestInit = {}, timeoutMs = 15_000) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(options.headers);
      if (!headers.has("User-Agent")) headers.set("User-Agent", "WealthTracker/1.0");
      const response = await fetch(url, { ...options, headers, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      const error = new Error(`HTTP ${response.status}`);
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 2) await sleep(350 * (attempt + 1));
  }
  throw lastError instanceof Error ? lastError : new Error("Market provider request failed");
}

export function normalizeMarket(value: unknown, symbol = ""): MarketCode {
  const market = String(value || "").toUpperCase();
  if (market === "CRYPTO" || market === "CRYPTOCURRENCY") return "CRYPTO";
  if (market === "TW" || market === "US") return market;
  return /^\d+$/.test(symbol) ? "TW" : "US";
}

export function marketClock(market: MarketCode, date = new Date()) {
  const timeZone = market === "TW" ? "Asia/Taipei" : market === "US" ? "America/New_York" : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    timeZone,
  };
}

export function marketIsOpen(market: MarketCode, date = new Date()) {
  if (market === "CRYPTO") return true;
  const clock = marketClock(market, date);
  if (["Sat", "Sun"].includes(clock.weekday)) return false;
  const open = market === "TW" ? 9 * 60 : 9 * 60 + 30;
  const close = market === "TW" ? 13 * 60 + 35 : 16 * 60 + 10;
  return clock.minutes >= open && clock.minutes < close;
}

function quote(params: Omit<UnifiedQuote, "fetchedAt" | "delaySeconds" | "isIntraday">): UnifiedQuote {
  const fetchedAt = new Date().toISOString();
  const sourceMs = new Date(params.sourceTime).getTime();
  const delaySeconds = Number.isFinite(sourceMs) ? Math.max(0, Math.round((Date.now() - sourceMs) / 1000)) : null;
  return {
    ...params,
    fetchedAt,
    delaySeconds,
    isIntraday: params.quoteStatus === "intraday",
  };
}

function sessionFromYahoo(state: unknown) {
  const normalized = String(state || "").toUpperCase();
  if (normalized === "REGULAR") return "regular" as const;
  if (normalized === "PRE") return "pre" as const;
  if (normalized === "POST" || normalized === "POSTPOST") return "post" as const;
  if (normalized === "CLOSED") return "closed" as const;
  return "unknown" as const;
}

function yahooLooksLive(timestamp: number, market: MarketCode, state: string) {
  if (state === "REGULAR") return true;
  if (state) return false;
  const time = new Date(timestamp * 1000);
  const age = Date.now() - time.getTime();
  return marketClock(market, time).date === marketClock(market).date
    && marketIsOpen(market)
    && age >= -120_000
    && age <= 10 * 60_000;
}

async function twseQuote(symbol: string): Promise<UnifiedQuote | null> {
  for (const prefix of ["tse", "otc"]) {
    try {
      const payload = await fetchJson(
        `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${prefix}_${encodeURIComponent(symbol)}.tw&json=1&delay=0`,
        { headers: { Referer: "https://mis.twse.com.tw/stock/fibest.html" } },
      );
      const item = payload?.msgArray?.[0];
      const price = number(item?.z);
      if (!(price > 0)) continue;
      const rawDate = String(item?.d || "");
      const rawTime = String(item?.t || "");
      const candleDate = /^\d{8}$/.test(rawDate)
        ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
        : marketClock("TW").date;
      const sourceTime = rawTime
        ? new Date(`${candleDate}T${rawTime}+08:00`).toISOString()
        : new Date().toISOString();
      const previousClose = number(item?.y);
      const live = marketIsOpen("TW") && candleDate === marketClock("TW").date;
      return quote({
        symbol, market: "TW", price,
        changePercent: previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0,
        volume: number(item?.v) * 1000,
        open: number(item?.o) || undefined,
        high: number(item?.h) || undefined,
        low: number(item?.l) || undefined,
        previousClose: previousClose || undefined,
        source: "TWSE MIS", sourceTime, candleDate,
        session: live ? "regular" : "closed",
        quoteStatus: live ? "intraday" : "official_close",
        isStale: false,
      });
    } catch {
      // Try OTC after TWSE, then move to Yahoo.
    }
  }
  return null;
}

async function yahooQuote(symbol: string, market: "TW" | "US"): Promise<UnifiedQuote | null> {
  const candidates = market === "TW" && /^\d+$/.test(symbol)
    ? [`${symbol}.TW`, `${symbol}.TWO`]
    : [symbol];
  for (const candidate of candidates) {
    for (const host of ["query1", "query2"]) {
      try {
        const payload = await fetchJson(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(candidate)}?range=5d&interval=1m`);
        if (payload?.chart?.error) continue;
        const result = payload?.chart?.result?.[0];
        const meta = result?.meta || {};
        const values = result?.indicators?.quote?.[0] || {};
        const timestamps: number[] = result?.timestamp || [];
        const timestamp = number(meta.regularMarketTime || timestamps.at(-1));
        const price = number(meta.regularMarketPrice || [...(values.close || [])].reverse().find(value => number(value) > 0));
        if (!(timestamp > 0) || !(price > 0)) continue;
        const state = String(meta.marketState || "").toUpperCase();
        const live = yahooLooksLive(timestamp, market, state);
        const candleDate = marketClock(market, new Date(timestamp * 1000)).date;
        const bars = timestamps.map((time, index) => ({
          time,
          open: number(values.open?.[index]),
          high: number(values.high?.[index]),
          low: number(values.low?.[index]),
          close: number(values.close?.[index]),
          volume: number(values.volume?.[index]),
        })).filter(item => marketClock(market, new Date(item.time * 1000)).date === candleDate
          && item.open > 0 && item.high > 0 && item.low > 0 && item.close > 0);
        const previousClose = number(meta.chartPreviousClose || meta.previousClose);
        return quote({
          symbol, market, price,
          changePercent: number(meta.regularMarketChangePercent) || (previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0),
          volume: number(meta.regularMarketVolume) || bars.reduce((sum, item) => sum + item.volume, 0),
          open: bars.at(0)?.open,
          high: bars.length ? Math.max(...bars.map(item => item.high), price) : undefined,
          low: bars.length ? Math.min(...bars.map(item => item.low), price) : undefined,
          previousClose: previousClose || undefined,
          source: "Yahoo Finance", sourceTime: new Date(timestamp * 1000).toISOString(), candleDate,
          session: sessionFromYahoo(state),
          quoteStatus: live ? "intraday" : "official_close",
          isStale: live && Date.now() - timestamp * 1000 > 10 * 60_000,
        });
      } catch {
        // Try the next host or Taiwan suffix.
      }
    }
  }
  return null;
}

function nasdaqMinutes(value: unknown) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return -1;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

async function nasdaqQuote(symbol: string): Promise<UnifiedQuote | null> {
  if (!marketIsOpen("US")) return null;
  const normalized = symbol === "^GSPC" ? "SPY" : symbol;
  for (const assetClass of ["stocks", "etf"]) {
    try {
      const payload = await fetchJson(
        `https://api.nasdaq.com/api/quote/${encodeURIComponent(normalized)}/chart?assetclass=${assetClass}`,
        { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } },
      );
      if (number(payload?.status?.rCode) !== 200 || !Array.isArray(payload?.data?.chart)) continue;
      const bars = payload.data.chart.map((point: Record<string, unknown>) => ({
        minutes: nasdaqMinutes((point.z as Record<string, unknown> | undefined)?.dateTime),
        price: number(point.y),
      })).filter((item: { minutes: number; price: number }) => item.minutes >= 9 * 60 + 30 && item.minutes <= 16 * 60 && item.price > 0);
      if (!bars.length) continue;
      const price = bars.at(-1)!.price;
      const previousClose = number(payload?.data?.previousClose);
      return quote({
        symbol, market: "US", price,
        changePercent: previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0,
        volume: number(String(payload?.data?.volume || "").replace(/[^0-9.-]/g, "")),
        open: bars[0].price,
        high: Math.max(...bars.map((item: { price: number }) => item.price)),
        low: Math.min(...bars.map((item: { price: number }) => item.price)),
        previousClose: previousClose || undefined,
        source: "Nasdaq", sourceTime: new Date().toISOString(), candleDate: marketClock("US").date,
        session: "regular", quoteStatus: "intraday", isStale: false,
      });
    } catch {
      // Try the other Nasdaq asset class.
    }
  }
  return null;
}

function cryptoBaseSymbol(symbol: string) {
  return symbol.toUpperCase().replaceAll("-", "").replaceAll("/", "").replace(/USDT$|USD$/u, "");
}

async function binanceQuote(symbol: string): Promise<UnifiedQuote | null> {
  const base = cryptoBaseSymbol(symbol);
  if (STABLECOINS.has(base)) {
    const now = new Date().toISOString();
    return quote({
      symbol: base, market: "CRYPTO", price: 1, changePercent: 0, volume: 0,
      open: 1, high: 1, low: 1, previousClose: 1,
      source: "Fixed USD peg", sourceTime: now, candleDate: marketClock("CRYPTO").date,
      session: "reference", quoteStatus: "reference", isStale: false,
    });
  }
  const payload = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(`${base}USDT`)}`);
  const price = number(payload?.lastPrice);
  if (!(price > 0)) return null;
  const sourceTime = payload?.closeTime ? new Date(number(payload.closeTime)).toISOString() : new Date().toISOString();
  return quote({
    symbol: base, market: "CRYPTO", price,
    changePercent: number(payload?.priceChangePercent), volume: number(payload?.quoteVolume),
    open: number(payload?.openPrice) || undefined,
    high: number(payload?.highPrice) || undefined,
    low: number(payload?.lowPrice) || undefined,
    previousClose: number(payload?.prevClosePrice) || undefined,
    source: "Binance", sourceTime, candleDate: marketClock("CRYPTO", new Date(sourceTime)).date,
    session: "continuous", quoteStatus: "intraday", isStale: false,
  });
}

async function coinGeckoQuote(symbol: string): Promise<UnifiedQuote | null> {
  const base = cryptoBaseSymbol(symbol);
  const id = COINGECKO_IDS[base];
  if (!id) return null;
  const payload = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_last_updated_at=true`);
  const row = payload?.[id];
  const price = number(row?.usd);
  if (!(price > 0)) return null;
  const sourceTime = row?.last_updated_at ? new Date(number(row.last_updated_at) * 1000).toISOString() : new Date().toISOString();
  return quote({
    symbol: base, market: "CRYPTO", price,
    changePercent: number(row?.usd_24h_change), volume: number(row?.usd_24h_vol),
    source: "CoinGecko", sourceTime, candleDate: marketClock("CRYPTO", new Date(sourceTime)).date,
    session: "continuous", quoteStatus: "intraday", isStale: Date.now() - new Date(sourceTime).getTime() > 10 * 60_000,
  });
}

async function finmindClose(symbol: string): Promise<UnifiedQuote | null> {
  const start = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const token = Deno.env.get("FINMIND_API_TOKEN") || "";
  const payload = await fetchJson(
    `${FINMIND_BASE}?${new URLSearchParams({ dataset: "TaiwanStockPrice", data_id: symbol, start_date: start })}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const latest = rows.at(-1);
  if (!latest || !(number(latest.close) > 0)) return null;
  const previous = rows.at(-2);
  const price = number(latest.close);
  const previousClose = number(previous?.close || latest.open);
  const candleDate = String(latest.date);
  return quote({
    symbol, market: "TW", price,
    changePercent: previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0,
    volume: number(latest.Trading_Volume), open: number(latest.open), high: number(latest.max), low: number(latest.min),
    previousClose: previousClose || undefined,
    source: "FinMind", sourceTime: new Date(`${candleDate}T13:30:00+08:00`).toISOString(), candleDate,
    session: "closed", quoteStatus: "official_close", isStale: false,
  });
}

export async function fetchUnifiedQuote(symbolValue: string, marketValue: unknown): Promise<UnifiedQuote> {
  const symbol = String(symbolValue || "").trim().toUpperCase();
  const market = normalizeMarket(marketValue, symbol);
  if (!/^[A-Z0-9.^/-]+$/.test(symbol)) throw new Error("Invalid symbol");
  if (market === "CRYPTO") {
    const result = await binanceQuote(symbol).catch(() => null) || await coinGeckoQuote(symbol).catch(() => null);
    if (result) return result;
  } else if (market === "TW") {
    const result = await twseQuote(symbol).catch(() => null)
      || await yahooQuote(symbol, "TW").catch(() => null)
      || await finmindClose(symbol).catch(() => null);
    if (result) return result;
  } else {
    const result = await yahooQuote(symbol, "US").catch(() => null)
      || await nasdaqQuote(symbol).catch(() => null);
    if (result) return result;
  }
  throw new Error(`Unable to fetch ${market}:${symbol}`);
}

export async function fetchIntradayCandle(symbol: string, marketValue: unknown) {
  const market = normalizeMarket(marketValue, symbol);
  if (market !== "CRYPTO" && !marketIsOpen(market)) return null;
  const current = await fetchUnifiedQuote(symbol, market);
  if (!current.isIntraday || current.isStale) return null;
  if (!(number(current.open) > 0) || !(number(current.high) > 0) || !(number(current.low) > 0)) return null;
  return {
    row: {
      time: current.candleDate,
      open: number(current.open),
      high: number(current.high),
      low: number(current.low),
      close: current.price,
      volume: current.volume,
    } satisfies PriceCandle,
    quoteTime: current.sourceTime,
    quote: current,
  };
}

export function staleQuoteFromCache(row: Record<string, unknown>, symbol: string, marketValue: unknown): UnifiedQuote | null {
  const price = number(row.price);
  if (!(price > 0)) return null;
  const market = normalizeMarket(marketValue, symbol);
  const sourceTime = String(row.source_time || row.updated_at || "");
  const fetchedAt = String(row.fetched_at || row.updated_at || new Date().toISOString());
  const sourceMs = new Date(sourceTime).getTime();
  return {
    symbol, market, price,
    changePercent: number(row.change_percent), volume: number(row.volume),
    source: String(row.source || "cache"), sourceTime, fetchedAt,
    candleDate: sourceTime ? marketClock(market, new Date(sourceTime)).date : "",
    session: "unknown", quoteStatus: "stale", isIntraday: false, isStale: true,
    delaySeconds: Number.isFinite(sourceMs) ? Math.max(0, Math.round((Date.now() - sourceMs) / 1000)) : null,
  };
}
