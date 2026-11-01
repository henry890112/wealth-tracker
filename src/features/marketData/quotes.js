import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import { BINANCE_BASE_URL, COINGECKO_BASE_URL, FINMIND_BASE_URL, SYMBOL_TO_COINGECKO_ID, getDateString } from './shared';

// Cache duration in milliseconds (1 minute)
const CACHE_DURATION = 60 * 1000;
const MARKET_PULSE_CACHE_KEY = 'wealthtracker:market-pulse-quotes:v1';
const MARKET_PULSE_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MARKET_PULSE_CACHE_SYMBOLS = new Set([
  'TW:^TWII', 'TW:TPEX', 'TW:0050', 'TW:0052', 'TW:00891',
  'US:^GSPC', 'US:^DJI', 'US:^RUT', 'US:^NDX', 'US:^IXIC', 'US:^SOX', 'US:^VIX',
]);
let _marketPulseCacheWriteQueue = Promise.resolve();

// ── L1 in-memory price cache ───────────────────────────────────────────────
// Avoids a Supabase round-trip when the same price is requested again within
// the same session.  Key: `${symbol}::${marketType}`, value: { data, timestamp }
const _priceMemCache = new Map();
// Last known Supabase quote used only when the live provider is unavailable.
const _priceStaleCache = new Map();
// In-flight promise cache: if two callers request the same symbol concurrently,
// the second one waits on the same Promise instead of firing a duplicate query.
const _priceInflight = new Map();
// Options analysis is rendered in both the standalone screen and the embedded
// technical-analysis card. Keep their underlying quote identical for a short
// window; otherwise two force-refresh requests can produce different GEX
// values while the user is looking at the same option chain.
const _latestQuoteSnapshotCache = new Map();
const _latestQuoteSnapshotInflight = new Map();
const LATEST_QUOTE_SNAPSHOT_TTL = 30 * 1000;

const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD']);

const quoteStatusFromState = state => String(state || '').toUpperCase() === 'REGULAR'
  ? 'intraday'
  : 'official_close';

const normalizeQuoteMetadata = priceData => {
  const fetchedAt = priceData.fetched_at || new Date().toISOString();
  const sourceTime = priceData.source_time || priceData.price_time || fetchedAt;
  return {
    ...priceData,
    source: priceData.source || 'unknown',
    source_time: sourceTime,
    fetched_at: fetchedAt,
    price_time: sourceTime,
    quote_status: priceData.quote_status || 'unknown',
    is_stale: Boolean(priceData.is_stale),
  };
};

const marketPulseCacheEntryKey = (symbol, marketType) => `${String(marketType || '').toUpperCase()}:${String(symbol || '').toUpperCase()}`;

const queueMarketPulseCacheWrite = quotes => {
  const validQuotes = (Array.isArray(quotes) ? quotes : []).filter(quote => {
    const symbol = String(quote?.symbol || '').toUpperCase();
    const market = String(quote?.market_type || quote?.market || '').toUpperCase();
    return MARKET_PULSE_CACHE_SYMBOLS.has(marketPulseCacheEntryKey(symbol, market))
      && Number.isFinite(Number(quote?.price))
      && Number(quote.price) > 0
      && !quote?.is_stale;
  });
  if (!validQuotes.length) return _marketPulseCacheWriteQueue;

  _marketPulseCacheWriteQueue = _marketPulseCacheWriteQueue.then(async () => {
    let entries = {};
    try {
      entries = JSON.parse(await AsyncStorage.getItem(MARKET_PULSE_CACHE_KEY) || '{}');
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) entries = {};
    } catch { entries = {}; }

    const now = Date.now();
    for (const quote of validQuotes) {
      const market = String(quote.market_type || quote.market || '').toUpperCase();
      const normalized = normalizeQuoteMetadata({ ...quote, market_type: market });
      entries[marketPulseCacheEntryKey(normalized.symbol, market)] = { quote: normalized, cachedAt: now };
    }
    for (const [key, entry] of Object.entries(entries)) {
      const age = now - Number(entry?.cachedAt);
      if (!MARKET_PULSE_CACHE_SYMBOLS.has(key) || !Number.isFinite(age) || age < 0 || age > MARKET_PULSE_CACHE_MAX_AGE) delete entries[key];
    }
    await AsyncStorage.setItem(MARKET_PULSE_CACHE_KEY, JSON.stringify(entries));
  }).catch(error => {
    console.warn('Could not persist market pulse quote cache:', error?.message || error);
  });
  return _marketPulseCacheWriteQueue;
};

export const readMarketPulseQuoteCache = async () => {
  try {
    await _marketPulseCacheWriteQueue;
    const entries = JSON.parse(await AsyncStorage.getItem(MARKET_PULSE_CACHE_KEY) || '{}');
    const result = { TW: {}, US: {} };
    const now = Date.now();
    for (const [key, entry] of Object.entries(entries || {})) {
      const age = now - Number(entry?.cachedAt);
      const quote = entry?.quote;
      if (!MARKET_PULSE_CACHE_SYMBOLS.has(key) || !Number.isFinite(age) || age < 0 || age > MARKET_PULSE_CACHE_MAX_AGE || !(Number(quote?.price) > 0)) continue;
      const market = String(quote.market_type || '').toUpperCase();
      const symbol = String(quote.symbol || '').toUpperCase();
      if (!result[market]) result[market] = {};
      result[market][symbol] = { ...quote, is_stale: true, quote_status: 'stale' };
    }
    return result;
  } catch {
    return { TW: {}, US: {} };
  }
};

export const persistMarketPulseQuoteCache = async quotes => {
  await queueMarketPulseCacheWrite(quotes);
};

const normalizeServerQuote = quote => normalizeQuoteMetadata({
  symbol: String(quote.symbol || '').toUpperCase(),
  price: Number(quote.price),
  change_percent: Number(quote.changePercent || 0),
  volume: Number(quote.volume || 0),
  market_type: String(quote.market || '').toUpperCase() === 'CRYPTO' ? 'Crypto' : quote.market,
  source: quote.source,
  source_time: quote.sourceTime,
  fetched_at: quote.fetchedAt,
  quote_status: quote.quoteStatus,
  is_stale: quote.isStale,
  delay_seconds: Number.isFinite(Number(quote.delaySeconds)) ? Number(quote.delaySeconds) : null,
  open: Number(quote.open || 0),
  high: Number(quote.high || 0),
  low: Number(quote.low || 0),
  previous_close: Number(quote.previousClose || 0),
  candle_date: quote.candleDate || '',
});

const rememberQuote = priceData => {
  const memKey = `${priceData.symbol}::${priceData.market_type}`;
  _priceMemCache.set(memKey, { data: priceData, timestamp: Date.now() });
  if (priceData.is_stale) _priceStaleCache.set(memKey, priceData);
  else _priceStaleCache.delete(memKey);
  void queueMarketPulseCacheWrite([priceData]);
};

// Primary quote gateway. Providers are called from the Edge Function so mobile
// clients are not dependent on third-party CORS behavior or device networking.
// Existing direct provider calls remain below as a resilient fallback.
const fetchServerQuotes = async (targets, forceRefresh = false) => {
  const symbols = targets
    .filter(target => target?.symbol)
    .map(target => ({
      symbol: String(target.symbol).toUpperCase(),
      market: String(target.market || '').toUpperCase(),
    }));
  if (!symbols.length) return {};
  const { data, error } = await supabase.functions.invoke('market-data', {
    body: { symbols, forceRefresh },
  });
  if (error) throw error;
  const result = {};
  for (const quote of data?.quotes || []) {
    const normalized = normalizeServerQuote(quote);
    if (!(normalized.price > 0)) continue;
    rememberQuote(normalized);
    result[normalized.symbol] = normalized;
  }
  return result;
};

// Lightweight quote request used by visible market screens. A short shared
// snapshot window keeps separate screens consistent while still allowing the
// technical-analysis refresh loop to obtain a new quote every 30 seconds.
export const fetchLatestMarketQuote = async (symbol, marketType = 'TW', options = {}) => {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const normalizedMarket = String(marketType || (/^\d+$/.test(normalizedSymbol) ? 'TW' : 'US')).toUpperCase();
  if (!normalizedSymbol) throw new Error('缺少標的代碼');
  const forceRefresh = Boolean(options?.forceRefresh);
  const cacheTtl = Number.isFinite(Number(options?.cacheTtl))
    ? Math.max(0, Number(options.cacheTtl))
    : LATEST_QUOTE_SNAPSHOT_TTL;
  const snapshotKey = String(options?.snapshotKey || 'default');
  const key = `${normalizedSymbol}::${normalizedMarket}::${snapshotKey}`;
  const cached = _latestQuoteSnapshotCache.get(key);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < cacheTtl) return cached.data;
  if (_latestQuoteSnapshotInflight.has(key)) return _latestQuoteSnapshotInflight.get(key);

  const request = (async () => {
    const quotes = await fetchServerQuotes([{ symbol: normalizedSymbol, market: normalizedMarket }], true);
    const quote = quotes[normalizedSymbol];
    if (!quote?.price) throw new Error(`無法取得 ${normalizedSymbol} 最新報價`);
    _latestQuoteSnapshotCache.set(key, { data: quote, timestamp: Date.now() });
    return quote;
  })();
  _latestQuoteSnapshotInflight.set(key, request);
  try {
    return await request;
  } finally {
    _latestQuoteSnapshotInflight.delete(key);
  }
};

export const US_POPULAR_STOCKS = [
  { symbol: 'AAPL', name: 'Apple Inc.', market_type: 'US' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', market_type: 'US' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', market_type: 'US' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', market_type: 'US' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', market_type: 'US' },
  { symbol: 'META', name: 'Meta Platforms Inc.', market_type: 'US' },
  { symbol: 'TSLA', name: 'Tesla Inc.', market_type: 'US' },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', market_type: 'US' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', market_type: 'US' },
  { symbol: 'V', name: 'Visa Inc.', market_type: 'US' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', market_type: 'US' },
  { symbol: 'WMT', name: 'Walmart Inc.', market_type: 'US' },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation', market_type: 'US' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', market_type: 'US' },
  { symbol: 'NFLX', name: 'Netflix Inc.', market_type: 'US' },
  { symbol: 'DIS', name: 'The Walt Disney Company', market_type: 'US' },
  { symbol: 'PYPL', name: 'PayPal Holdings Inc.', market_type: 'US' },
  { symbol: 'INTC', name: 'Intel Corporation', market_type: 'US' },
  { symbol: 'QCOM', name: 'Qualcomm Incorporated', market_type: 'US' },
  { symbol: 'SMR', name: 'NuScale Power Corporation', market_type: 'US' },
];

/**
 * Fetch Taiwan stock price.
 * Primary: TWSE MIS real-time API (免費，盤中即時)
 * Fallback: FinMind historical (收盤價)
 */
export const fetchTWStockPrice = async (symbol, options = {}) => {
  try {
    const cached = await getCachedPrice(symbol, 'TW');
    if (cached) return cached;

    if (!options.skipServer) {
      try {
        const serverQuotes = await fetchServerQuotes([{ symbol, market: 'TW' }]);
        if (serverQuotes[String(symbol).toUpperCase()]) return serverQuotes[String(symbol).toUpperCase()];
      } catch { /* fall through to direct providers */ }
    }

    // Layer 1: TWSE MIS 盤中即時（交易時間內最準確）
    for (const prefix of ['tse', 'otc']) {
      try {
        const res = await fetch(
          `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${prefix}_${symbol}.tw&json=1&delay=0`,
          { headers: { 'Referer': 'https://mis.twse.com.tw/stock/fibest.html', 'User-Agent': 'Mozilla/5.0' } }
        );
        if (!res.ok) continue;
        const data = await res.json();
        const item = data?.msgArray?.[0];
        if (!item || !item.z || item.z === '-') continue;
        const currentPrice = parseFloat(item.z);
        if (isNaN(currentPrice) || currentPrice <= 0) continue;
        const prevClose = parseFloat(item.y);
        const twTime = item.t && item.d
          ? new Date(`${item.d.slice(0,4)}-${item.d.slice(4,6)}-${item.d.slice(6,8)}T${item.t}`).toISOString()
          : new Date().toISOString();
        const priceData = {
          symbol,
          price: currentPrice,
          change_percent: (!isNaN(prevClose) && prevClose > 0)
            ? calculateChangePercent(prevClose, currentPrice)
            : 0,
          volume: parseFloat(item.v) * 1000 || 0,
          market_type: 'TW',
          source: 'TWSE MIS',
          quote_status: 'intraday',
          price_time: twTime,
        };
        await cachePrice(priceData);
        return priceData;
      } catch { continue; }
    }

    // Layer 2: Yahoo Finance v7/quote（盤中即時報價，比 v8/chart 日線更準確）
    // 上市用 .TW，上櫃用 .TWO
    for (const suffix of ['.TW', '.TWO']) {
      for (const host of ['query1', 'query2']) {
        try {
          const res = await fetch(
            `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${symbol}${suffix}`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } }
          );
          if (!res.ok) continue;
          const data = await res.json();
          const quote = data?.quoteResponse?.result?.[0];
          if (!quote?.regularMarketPrice) continue;
          const priceData = {
            symbol,
            price: quote.regularMarketPrice,
            change_percent: quote.regularMarketChangePercent ?? 0,
            volume: quote.regularMarketVolume ?? 0,
            market_type: 'TW',
            source: 'Yahoo Finance',
            quote_status: quoteStatusFromState(quote.marketState),
            price_time: quote.regularMarketTime
              ? new Date(quote.regularMarketTime * 1000).toISOString()
              : new Date().toISOString(),
          };
          await cachePrice(priceData);
          return priceData;
        } catch { continue; }
      }
    }

    // Layer 2b: Yahoo Finance v8/chart（備援，有時 v7 被擋）
    for (const suffix of ['.TW', '.TWO']) {
      for (const host of ['query1', 'query2']) {
        try {
          const res = await fetch(
            `https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}${suffix}?range=5d&interval=1d`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } }
          );
          if (!res.ok) continue;
          const data = await res.json();
          const meta = data?.chart?.result?.[0]?.meta;
          if (!meta?.regularMarketPrice) continue;
          const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
          const validCloses = closes.filter(c => c != null && !isNaN(c));
          const prevClose = validCloses.length >= 2
            ? validCloses[validCloses.length - 2]
            : meta.chartPreviousClose;
          const priceData = {
            symbol,
            price: meta.regularMarketPrice,
            change_percent: calculateChangePercent(prevClose, meta.regularMarketPrice),
            volume: meta.regularMarketVolume ?? 0,
            market_type: 'TW',
            source: 'Yahoo Finance',
            quote_status: quoteStatusFromState(meta.marketState),
            price_time: meta.regularMarketTime
              ? new Date(meta.regularMarketTime * 1000).toISOString()
              : new Date().toISOString(),
          };
          await cachePrice(priceData);
          return priceData;
        } catch { continue; }
      }
    }

    // Layer 3: FinMind 歷史收盤（最後備援，T+1 延遲）
    const response = await fetch(
      `${FINMIND_BASE_URL}/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${getDateString(-7)}&end_date=${getDateString(0)}`
    );
    const data = await response.json();
    if (data.status === 200 && data.data?.length > 0) {
      const rows = data.data;
      const latest = rows[rows.length - 1];
      const prevClose = rows.length >= 2
        ? parseFloat(rows[rows.length - 2].close)
        : parseFloat(latest.open);
      const priceData = {
        symbol,
        price: parseFloat(latest.close),
        change_percent: calculateChangePercent(prevClose, parseFloat(latest.close)),
        volume: parseFloat(latest.Trading_Volume),
        market_type: 'TW',
        source: 'FinMind',
        quote_status: 'official_close',
        price_time: new Date(latest.date).toISOString(),
      };
      await cachePrice(priceData);
      return priceData;
    }

    throw new Error('No data available');
  } catch (error) {
    const stale = getStaleCachedPrice(symbol, 'TW');
    if (stale) return stale;
    console.error('Error fetching TW stock price:', error);
    throw error;
  }
};

/**
 * Fetch US stock price from Yahoo Finance.
 * Primary: v7/quote (更即時的當前報價)
 * Fallback: v8/chart
 */
export const fetchUSStockPrice = async (symbol, options = {}) => {
  try {
    const cached = await getCachedPrice(symbol, 'US');
    if (cached) return cached;

    if (!options.skipServer) {
      try {
        const serverQuotes = await fetchServerQuotes([{ symbol, market: 'US' }]);
        if (serverQuotes[String(symbol).toUpperCase()]) return serverQuotes[String(symbol).toUpperCase()];
      } catch { /* fall through to direct providers */ }
    }

    // Primary: Yahoo Finance v7/quote (supports batch, more current)
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`
      );
      if (res.ok) {
        const data = await res.json();
        const quote = data?.quoteResponse?.result?.[0];
        if (quote?.regularMarketPrice) {
          const stale = getStaleCachedPrice(symbol, 'US');
          const priceData = {
            symbol,
            price: quote.regularMarketPrice,
            change_percent: quote.regularMarketChangePercent
              ?? (stale?.change_percent ?? calculateChangePercent(
                quote.regularMarketPreviousClose ?? quote.previousClose,
                quote.regularMarketPrice,
              )),
            volume: quote.regularMarketVolume ?? 0,
            market_type: 'US',
            source: 'Yahoo Finance',
            quote_status: quoteStatusFromState(quote.marketState),
            price_time: quote.regularMarketTime
              ? new Date(quote.regularMarketTime * 1000).toISOString()
              : new Date().toISOString(),
          };
          await cachePrice(priceData);
          return priceData;
        }
      }
    } catch { /* fall through */ }

    // Fallback: v8/chart
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2d&interval=1d`
    );
    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (meta) {
      const usCloses = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
      const usValidCloses = usCloses.filter(c => c != null && !isNaN(c));
      const usPrevClose = usValidCloses.length >= 2
        ? usValidCloses[usValidCloses.length - 2]
        : (meta.previousClose ?? meta.chartPreviousClose);
      const priceData = {
        symbol,
        price: meta.regularMarketPrice ?? meta.previousClose,
        change_percent: (meta.regularMarketChangePercent != null)
          ? meta.regularMarketChangePercent
          : calculateChangePercent(usPrevClose, meta.regularMarketPrice ?? meta.previousClose),
        volume: meta.regularMarketVolume ?? 0,
        market_type: 'US',
        source: 'Yahoo Finance',
        quote_status: quoteStatusFromState(meta.marketState),
        price_time: meta.regularMarketTime
          ? new Date(meta.regularMarketTime * 1000).toISOString()
          : new Date().toISOString(),
      };
      await cachePrice(priceData);
      return priceData;
    }

    throw new Error('No data available');
  } catch (error) {
    const stale = getStaleCachedPrice(symbol, 'US');
    if (stale) return stale;
    console.error('Error fetching US stock price:', error);
    throw error;
  }
};

/**
 * Fetch cryptocurrency price.
 * Primary: Binance public API (真即時，無 API key，無速率限制問題)
 * Fallback: CoinGecko
 */
export const fetchCryptoPrice = async (symbol) => {
  try {
    const upperSymbol = symbol.toUpperCase();
    const cached = await getCachedPrice(upperSymbol, 'Crypto');
    if (cached) return cached;

    // Stablecoins are always ~1 USD, skip API call
    if (STABLECOINS.has(upperSymbol)) {
      const priceData = { symbol: upperSymbol, price: 1, change_percent: 0, volume: 0, market_type: 'Crypto', source: 'Fixed USD peg', quote_status: 'reference' };
      await cachePrice(priceData);
      return priceData;
    }

    try {
      const serverQuotes = await fetchServerQuotes([{ symbol: upperSymbol, market: 'CRYPTO' }]);
      if (serverQuotes[upperSymbol]) return serverQuotes[upperSymbol];
    } catch { /* fall through to direct providers */ }

    // Primary: Binance 24hr ticker (real-time, no key needed)
    try {
      const res = await fetch(`${BINANCE_BASE_URL}/ticker/24hr?symbol=${upperSymbol}USDT`);
      if (res.ok) {
        const data = await res.json();
        if (data.lastPrice && !data.code) {
          const priceData = {
            symbol: upperSymbol,
            price: parseFloat(data.lastPrice),
            change_percent: parseFloat(data.priceChangePercent),
            volume: parseFloat(data.quoteVolume) || 0,
            market_type: 'Crypto',
            source: 'Binance',
            quote_status: 'intraday',
            price_time: data.closeTime
              ? new Date(parseInt(data.closeTime)).toISOString()
              : new Date().toISOString(),
          };
          await cachePrice(priceData);
          return priceData;
        }
      }
    } catch { /* fall through to CoinGecko */ }

    // Fallback: CoinGecko
    const coinId = SYMBOL_TO_COINGECKO_ID[upperSymbol] || symbol.toLowerCase();
    const response = await fetch(
      `${COINGECKO_BASE_URL}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`
    );
    if (!response.ok) {
      console.warn(`CoinGecko HTTP ${response.status} for ${upperSymbol} — skipping`);
      return null;
    }
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Invalid JSON from CoinGecko'); }

    if (data[coinId]) {
      const priceData = {
        symbol: upperSymbol,
        price: data[coinId].usd,
        change_percent: data[coinId].usd_24h_change || 0,
        volume: data[coinId].usd_24h_vol || 0,
        market_type: 'Crypto',
        source: 'CoinGecko',
        quote_status: 'intraday',
        price_time: new Date().toISOString(),
      };
      await cachePrice(priceData);
      return priceData;
    }

    console.warn(`fetchCryptoPrice: no data found for ${symbol}`);
    return null;
  } catch (error) {
    const stale = getStaleCachedPrice(symbol.toUpperCase(), 'Crypto');
    if (stale) return stale;
    console.warn('fetchCryptoPrice error (non-fatal):', error?.message || error);
    return null;
  }
};

/**
 * Batch fetch TW stock prices via parallel individual calls.
 * Returns a map: { [symbol]: priceData | null }
 */
export const fetchTWStockPriceBatch = async (symbols, options = {}) => {
  if (!symbols || symbols.length === 0) return {};
  let result = {};
  try {
    result = await fetchServerQuotes(symbols.map(symbol => ({ symbol, market: 'TW' })), Boolean(options.forceRefresh));
  } catch { /* use individual fallbacks below */ }
  const missing = symbols.filter(symbol => !result[String(symbol).toUpperCase()]);
  const fallbacks = await Promise.allSettled(missing.map(symbol => fetchTWStockPrice(symbol, { skipServer: true })));
  missing.forEach((symbol, index) => {
    result[symbol] = fallbacks[index].status === 'fulfilled' ? fallbacks[index].value : null;
  });
  return Object.fromEntries(symbols.map(symbol => [symbol, result[String(symbol).toUpperCase()] ?? result[symbol] ?? null]));
};

/**
 * Batch fetch US stock prices via Yahoo Finance v7 (single request).
 * Returns a map: { [symbol]: priceData }
 * Falls back to individual calls for any symbol not found in batch result.
 */
export const fetchUSStockPriceBatch = async (symbols, options = {}) => {
  if (!symbols || symbols.length === 0) return {};
  const forceRefresh = Boolean(options.forceRefresh);

  // Check cache first; only fetch uncached symbols
  const result = {};
  const toFetch = [];
  const cachedQuotes = await Promise.all(symbols.map(async sym => [sym, await getCachedPrice(sym, 'US')]));
  for (const [sym, cached] of cachedQuotes) {
    if (cached && !forceRefresh) result[sym] = cached;
    else {
      if (cached) _priceStaleCache.set(`${sym}::US`, { ...cached, is_stale: true, quote_status: 'stale' });
      toFetch.push(sym);
    }
  }
  if (toFetch.length === 0) return result;

  try {
    const serverQuotes = await fetchServerQuotes(toFetch.map(symbol => ({ symbol, market: 'US' })), forceRefresh);
    Object.assign(result, serverQuotes);
  } catch { /* use direct Yahoo fallback below */ }

  const directFetchSymbols = toFetch.filter(sym => !result[String(sym).toUpperCase()]);
  if (directFetchSymbols.length === 0) return result;

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${directFetchSymbols.join(',')}`
    );
    if (res.ok) {
      const data = await res.json();
      const quotes = data?.quoteResponse?.result ?? [];
      for (const quote of quotes) {
        if (!quote?.regularMarketPrice) continue;
        const stale = getStaleCachedPrice(quote.symbol, 'US');
        const priceData = {
          symbol: quote.symbol,
          price: quote.regularMarketPrice,
          change_percent: quote.regularMarketChangePercent
            ?? (stale?.change_percent ?? calculateChangePercent(
              quote.regularMarketPreviousClose ?? quote.previousClose,
              quote.regularMarketPrice,
            )),
          volume: quote.regularMarketVolume ?? 0,
          market_type: 'US',
          source: 'Yahoo Finance',
          quote_status: quoteStatusFromState(quote.marketState),
          price_time: quote.regularMarketTime
            ? new Date(quote.regularMarketTime * 1000).toISOString()
            : new Date().toISOString(),
        };
        result[quote.symbol] = priceData;
        cachePrice(priceData);
      }
    }
  } catch { /* fall through to individual fallback */ }

  // Individual fallback for any symbols still missing
  await Promise.allSettled(
    directFetchSymbols
      .filter(sym => !result[sym])
      .map(async (sym) => {
        try {
          const priceData = await fetchUSStockPrice(sym, { skipServer: true });
          if (priceData) result[sym] = priceData;
        } catch {}
      })
  );

  for (const sym of toFetch) {
    if (result[sym]) continue;
    const stale = getStaleCachedPrice(sym, 'US');
    if (stale?.price > 0) result[sym] = { ...stale, is_stale: true, quote_status: 'stale' };
  }

  return result;
};

/**
 * Batch fetch crypto prices via Binance (single request).
 * Returns a map: { [symbol]: priceData }
 */
export const fetchCryptoPriceBatch = async (symbols) => {
  if (!symbols || symbols.length === 0) return {};

  const result = {};
  const toFetch = [];
  for (const sym of symbols) {
    const upper = sym.toUpperCase();
    if (STABLECOINS.has(upper)) {
      result[upper] = normalizeQuoteMetadata({ symbol: upper, price: 1, change_percent: 0, volume: 0, market_type: 'Crypto', source: 'Fixed USD peg', quote_status: 'reference' });
      continue;
    }
    const cached = await getCachedPrice(upper, 'Crypto');
    if (cached) result[upper] = cached;
    else toFetch.push(upper);
  }
  if (toFetch.length === 0) return result;

  try {
    const serverQuotes = await fetchServerQuotes(toFetch.map(symbol => ({ symbol, market: 'CRYPTO' })));
    Object.assign(result, serverQuotes);
  } catch { /* use direct Binance fallback below */ }

  const directFetchSymbols = toFetch.filter(sym => !result[String(sym).toUpperCase()]);
  if (directFetchSymbols.length === 0) return result;

  try {
    const binanceSymbols = directFetchSymbols.map(s => `"${s}USDT"`).join(',');
    const res = await fetch(`${BINANCE_BASE_URL}/ticker/24hr?symbols=[${binanceSymbols}]`);
    if (res.ok) {
      const tickers = await res.json();
      if (Array.isArray(tickers)) {
        for (const t of tickers) {
          if (!t.lastPrice || t.code) continue;
          const sym = t.symbol.replace('USDT', '');
          const priceData = {
            symbol: sym,
            price: parseFloat(t.lastPrice),
            change_percent: parseFloat(t.priceChangePercent),
            volume: parseFloat(t.quoteVolume),
            market_type: 'Crypto',
            source: 'Binance',
            quote_status: 'intraday',
            price_time: t.closeTime
              ? new Date(parseInt(t.closeTime)).toISOString()
              : new Date().toISOString(),
          };
          result[sym] = priceData;
          cachePrice(priceData);
        }
      }
    }
  } catch { /* fall through to individual fallback */ }

  // Individual fallback for missing symbols — sequential with 200ms delay to avoid CoinGecko 429
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const missingSymbols = directFetchSymbols.filter(sym => !result[sym]);
  for (const sym of missingSymbols) {
    try {
      const priceData = await fetchCryptoPrice(sym);
      if (priceData) result[sym] = priceData;
    } catch (e) {}
    await sleep(200);
  }

  return result;
};

// --- Helpers ---

export const getCachedPrice = async (symbol, marketType) => {
  const memKey = `${symbol}::${marketType}`;

  // L1: in-memory cache hit — no network at all
  const memEntry = _priceMemCache.get(memKey);
  if (memEntry && (Date.now() - memEntry.timestamp) < CACHE_DURATION) {
    return memEntry.data;
  }

  // Dedup: if a Supabase query for this key is already in flight, reuse it
  if (_priceInflight.has(memKey)) {
    return _priceInflight.get(memKey);
  }

  const promise = (async () => {
    try {
      const { data, error } = await supabase
        .from('price_cache')
        .select('*')
        .eq('symbol', symbol)
        .eq('market_type', marketType)
        .single();

      if (error || !data) return null;

      if (isRecentCache(data.fetched_at || data.updated_at)) {
        const priceData = normalizeQuoteMetadata({
          symbol: data.symbol,
          price: parseFloat(data.price),
          change_percent: parseFloat(data.change_percent),
          volume: parseFloat(data.volume),
          market_type: data.market_type,
          source: data.source,
          source_time: data.source_time || data.updated_at,
          fetched_at: data.fetched_at || data.updated_at,
          quote_status: data.quote_status,
          is_stale: data.is_stale,
        });
        _priceMemCache.set(memKey, { data: priceData, timestamp: Date.now() });
        return priceData;
      }
      _priceStaleCache.set(memKey, normalizeQuoteMetadata({
        symbol: data.symbol,
        price: parseFloat(data.price),
        change_percent: parseFloat(data.change_percent),
        volume: parseFloat(data.volume),
        market_type: data.market_type,
        source: data.source,
        source_time: data.source_time || data.updated_at,
        fetched_at: data.fetched_at || data.updated_at,
        quote_status: 'stale',
        is_stale: true,
      }));
      return null;
    } catch {
      return null;
    } finally {
      _priceInflight.delete(memKey);
    }
  })();

  _priceInflight.set(memKey, promise);
  return promise;
};

const getStaleCachedPrice = (symbol, marketType) =>
  _priceStaleCache.get(`${symbol}::${marketType}`) || null;

export const cachePrice = async (priceData) => {
  try {
    const normalized = normalizeQuoteMetadata(priceData);
    Object.assign(priceData, normalized);
    // Fix 5: write to L1 in-memory cache immediately (no round-trip needed)
    const memKey = `${normalized.symbol}::${normalized.market_type}`;
    _priceMemCache.set(memKey, { data: normalized, timestamp: Date.now() });
    _priceStaleCache.delete(memKey);
    void queueMarketPulseCacheWrite([normalized]);

    await supabase
      .from('price_cache')
      .upsert({
        symbol: normalized.symbol,
        market_type: normalized.market_type,
        price: normalized.price,
        change_percent: normalized.change_percent,
        volume: normalized.volume,
        source: normalized.source,
        source_time: normalized.source_time,
        fetched_at: normalized.fetched_at,
        quote_status: normalized.quote_status,
        is_stale: normalized.is_stale,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'symbol,market_type' });
  } catch (error) {
    console.error('Error caching price:', error);
  }
};

const isRecentCache = (timestamp) => {
  return (Date.now() - new Date(timestamp).getTime()) < CACHE_DURATION;
};

const calculateChangePercent = (prevPrice, currentPrice) => {
  if (!prevPrice || prevPrice === 0) return 0;
  return ((currentPrice - prevPrice) / prevPrice) * 100;
};
