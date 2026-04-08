// API Service for external data sources
import { supabase } from '../lib/supabase';

const FINMIND_BASE_URL = 'https://api.finmindtrade.com/api/v4';
const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const BOT_CSV_URL = 'https://rate.bot.com.tw/xrt/flcsv/0/day';

// Cache duration in milliseconds (1 minute)
const CACHE_DURATION = 60 * 1000;

const BINANCE_BASE_URL = 'https://api.binance.com/api/v3';
const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD']);

/**
 * Fetch Taiwan stock price.
 * Primary: TWSE MIS real-time API (免費，盤中即時)
 * Fallback: FinMind historical (收盤價)
 */
export const fetchTWStockPrice = async (symbol) => {
  try {
    const cached = await getCachedPrice(symbol, 'TW');
    if (cached) return cached;

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
        const priceData = {
          symbol,
          price: currentPrice,
          change_percent: (!isNaN(prevClose) && prevClose > 0)
            ? calculateChangePercent(prevClose, currentPrice)
            : 0,
          volume: parseFloat(item.v) * 1000 || 0,
          market_type: 'TW',
        };
        await cachePrice(priceData);
        return priceData;
      } catch { continue; }
    }

    // Layer 2: Yahoo Finance v8/chart（不需 cookie，盤後收盤價準確）
    // 上市用 .TW，上櫃用 .TWO，query1 / query2 各試一次
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
          // chartPreviousClose = range 第一根收盤，不是昨天收盤！
          // 正確昨日收盤 = closes 陣列倒數第二個有效值
          const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
          const validCloses = closes.filter(c => c != null && !isNaN(c));
          const prevClose = validCloses.length >= 2
            ? validCloses[validCloses.length - 2]  // 昨日收盤
            : meta.chartPreviousClose;              // 備援
          const priceData = {
            symbol,
            price: meta.regularMarketPrice,
            change_percent: calculateChangePercent(prevClose, meta.regularMarketPrice),
            volume: meta.regularMarketVolume ?? 0,
            market_type: 'TW',
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
      };
      await cachePrice(priceData);
      return priceData;
    }

    throw new Error('No data available');
  } catch (error) {
    console.error('Error fetching TW stock price:', error);
    throw error;
  }
};

/**
 * Fetch US stock price from Yahoo Finance.
 * Primary: v7/quote (更即時的當前報價)
 * Fallback: v8/chart
 */
export const fetchUSStockPrice = async (symbol) => {
  try {
    const cached = await getCachedPrice(symbol, 'US');
    if (cached) return cached;

    // Primary: Yahoo Finance v7/quote (supports batch, more current)
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`
      );
      if (res.ok) {
        const data = await res.json();
        const quote = data?.quoteResponse?.result?.[0];
        if (quote?.regularMarketPrice) {
          const priceData = {
            symbol,
            price: quote.regularMarketPrice,
            change_percent: quote.regularMarketChangePercent ?? 0,
            volume: quote.regularMarketVolume ?? 0,
            market_type: 'US',
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
      };
      await cachePrice(priceData);
      return priceData;
    }

    throw new Error('No data available');
  } catch (error) {
    console.error('Error fetching US stock price:', error);
    throw error;
  }
};

// Map ticker symbols to CoinGecko IDs
const SYMBOL_TO_COINGECKO_ID = {
  BTC:  'bitcoin',
  ETH:  'ethereum',
  USDT: 'tether',
  BNB:  'binancecoin',
  SOL:  'solana',
  XRP:  'ripple',
  USDC: 'usd-coin',
  DOGE: 'dogecoin',
  ADA:  'cardano',
  AVAX: 'avalanche-2',
  TRX:  'tron',
  TON:  'the-open-network',
  LINK: 'chainlink',
  DOT:  'polkadot',
  MATIC:'matic-network',
  SHIB: 'shiba-inu',
  LTC:  'litecoin',
  UNI:  'uniswap',
  ATOM: 'cosmos',
  XLM:  'stellar',
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
      const priceData = { symbol: upperSymbol, price: 1, change_percent: 0, volume: 0, market_type: 'Crypto' };
      await cachePrice(priceData);
      return priceData;
    }

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
            volume: parseFloat(data.quoteVolume) || 0, // volume in USDT
            market_type: 'Crypto',
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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
      };
      await cachePrice(priceData);
      return priceData;
    }

    throw new Error('Cryptocurrency not found');
  } catch (error) {
    console.error('Error fetching crypto price:', error);
    throw error;
  }
};

/**
 * Fetch BOT (Bank of Taiwan) daily rates CSV.
 * Returns { USD: 31.995, JPY: 0.2018, EUR: 36.97, ... }
 * Values = TWD per 1 unit of foreign currency (即期賣出, col 13).
 */
const fetchBOTRates = async () => {
  const response = await fetch(BOT_CSV_URL);
  if (!response.ok) throw new Error(`BOT CSV HTTP ${response.status}`);
  const text = await response.text();
  const rates = {};
  const lines = text.split('\n');
  // Line 0 is header; data starts at line 1
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].trim().split(',');
    if (cols.length < 14) continue;
    const currency = cols[0].trim();
    const buySpot  = parseFloat(cols[12]);
    const sellSpot = parseFloat(cols[13]);
    if (currency && !isNaN(buySpot) && !isNaN(sellSpot) && buySpot > 0 && sellSpot > 0) {
      rates[currency] = { buySpot, sellSpot };
    }
  }
  return rates; // { USD: { buySpot: 31.795, sellSpot: 31.995 }, ... }
};

/**
 * Fetch BOT daily rates with both spot buying and selling.
 * Returns { USD: { buy: 31.795, sell: 32.150 }, JPY: { buy: 0.2032, sell: 0.2065 }, ... }
 * buy  = 即期買入 (col 12), sell = 即期賣出 (col 13)
 * TWD per 1 unit of foreign currency.
 */
export const fetchBOTRatesDetailed = async () => {
  const response = await fetch(BOT_CSV_URL);
  if (!response.ok) throw new Error(`BOT CSV HTTP ${response.status}`);
  const text = await response.text();
  const rates = {};
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].trim().split(',');
    if (cols.length < 14) continue;
    const currency = cols[0].trim();
    const spotBuying  = parseFloat(cols[12]);
    const spotSelling = parseFloat(cols[13]);
    if (currency && !isNaN(spotBuying) && !isNaN(spotSelling) && spotBuying > 0 && spotSelling > 0) {
      rates[currency] = { buy: spotBuying, sell: spotSelling };
    }
  }
  return rates;
};

/**
 * Fetch BOT rates enhanced with yesterday's rates and weekly sparkline data.
 * Returns { USD: { buy, sell, sparkPoints: [buy1, buy2, ...] }, ... }
 * buy/sell = today's 即期買入/賣出 (TWD per 1 foreign unit); KRW uses 現金 rates (no 即期)
 * sparkPoints = last 14 trading days buy rates from Yahoo Finance (oldest → newest)
 */
export const fetchBOTRatesForFX = async () => {
  const parseRows = (text) => {
    // BOT CSV columns:
    //   [0]=幣別 [1]=本行買入 [2]=現金買入 [3]=即期買入 [4-10]=遠期買入
    //   [11]=本行賣出 [12]=現金賣出 [13]=即期賣出 [14-20]=遠期賣出
    // KRW and some currencies have no 即期 (cols[3]/[13] = 0), fall back to 現金
    const rows = {};
    const lines = text.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].trim().split(',');
      if (cols.length < 14) continue;
      const currency = cols[0].trim();
      const buy  = parseFloat(cols[3])  || parseFloat(cols[2]);   // 即期買入 → 現金買入
      const sell = parseFloat(cols[13]) || parseFloat(cols[12]);  // 即期賣出 → 現金賣出
      if (currency && !isNaN(buy) && !isNaN(sell) && buy > 0 && sell > 0) {
        rows[currency] = { buy, sell };
      }
    }
    return rows;
  };

  // /week and /ltm endpoints are currently blocked (302); only /day is reliable
  const dayResult = await fetch(BOT_CSV_URL).catch(() => null);
  const dayRows = (dayResult?.ok) ? parseRows(await dayResult.text()) : {};

  // Fetch 14-day buy-rate history from Yahoo Finance for sparklines
  const FX_YAHOO_MAP = {
    USD: 'USDTWD=X', JPY: 'JPYTWD=X', EUR: 'EURTWD=X', GBP: 'GBPTWD=X',
    CNY: 'CNYTWD=X', HKD: 'HKDTWD=X', AUD: 'AUDTWD=X', SGD: 'SGDTWD=X', KRW: 'KRWTWD=X',
  };
  const sparkResults = await Promise.allSettled(
    Object.entries(FX_YAHOO_MAP).map(async ([code, ticker]) => {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1mo&interval=1d`
      );
      const data = await r.json();
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
      const pts = closes.filter(v => v != null).slice(-14);
      return { code, pts };
    })
  );
  const sparkMap = {};
  for (const res of sparkResults) {
    if (res.status === 'fulfilled' && res.value.pts.length > 1) {
      sparkMap[res.value.code] = res.value.pts;
    }
  }

  const result = {};
  for (const [currency, { buy, sell }] of Object.entries(dayRows)) {
    result[currency] = {
      buy,
      sell,
      prevBuy:  null,
      prevSell: null,
      sparkPoints: sparkMap[currency] ?? null,
    };
  }
  // Merge in currencies only in sparkMap but missing from BOT (shouldn't happen, but safe)
  for (const code of Object.keys(FX_YAHOO_MAP)) {
    if (!result[code] && sparkMap[code]) {
      const pts = sparkMap[code];
      result[code] = { buy: pts[pts.length-1], sell: pts[pts.length-1], prevBuy: null, prevSell: null, sparkPoints: pts };
    }
  }

  return result;
};

/**
 * Fallback: fetch exchange rate from exchangerate-api.com.
 */
const fetchExchangeRateFallback = async (fromCurrency, toCurrency) => {
  const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${fromCurrency}`);
  const data = await response.json();
  if (data.rates && data.rates[toCurrency]) return data.rates[toCurrency];
  throw new Error(`exchangerate-api rate not found for ${fromCurrency}→${toCurrency}`);
};

/**
 * Fetch exchange rate using Bank of Taiwan 即期賣出 (spot selling) rates.
 * Falls back to exchangerate-api.com for currencies not in BOT (e.g. KRW).
 */
export const fetchExchangeRate = async (fromCurrency, toCurrency) => {
  try {
    const { data: cached } = await supabase
      .from('exchange_rates')
      .select('*')
      .eq('from_currency', fromCurrency)
      .eq('to_currency', toCurrency)
      .single();

    if (cached && isRecentCache(cached.updated_at)) {
      return parseFloat(cached.rate);
    }

    let rate;
    if (fromCurrency === toCurrency) {
      rate = 1;
    } else {
      const botRates = await fetchBOTRates(); // TWD per 1 foreign unit

      const rFrom = fromCurrency === 'TWD' ? null : botRates[fromCurrency]?.sellSpot;
      const rTo   = toCurrency   === 'TWD' ? null : botRates[toCurrency]?.sellSpot;

      // Check if any required currency is missing from BOT
      const fromMissing = fromCurrency !== 'TWD' && !rFrom;
      const toMissing   = toCurrency   !== 'TWD' && !rTo;

      if (fromMissing || toMissing) {
        console.warn(`BOT missing ${fromMissing ? fromCurrency : toCurrency}, falling back to exchangerate-api`);
        rate = await fetchExchangeRateFallback(fromCurrency, toCurrency);
      } else if (toCurrency === 'TWD') {
        rate = rFrom; // foreign → TWD (即期賣出)
      } else if (fromCurrency === 'TWD') {
        rate = 1 / rTo; // TWD → foreign
      } else {
        rate = rFrom / rTo; // cross rate via TWD
      }
    }

    await supabase
      .from('exchange_rates')
      .upsert({
        from_currency: fromCurrency,
        to_currency: toCurrency,
        rate: rate,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'from_currency,to_currency' });

    return rate;
  } catch (error) {
    console.error('Error fetching exchange rate:', error);
    throw error;
  }
};

/**
 * Search stocks and crypto
 */
export const searchAssets = async (query, marketType = 'all') => {
  const results = [];

  try {
    if (marketType === 'all' || marketType === 'TW') {
      const twStocks = await searchTWStocks(query);
      results.push(...twStocks);
    }

    if (marketType === 'all' || marketType === 'US') {
      const usStocks = await searchUSStocks(query);
      results.push(...usStocks);
    }

    if (marketType === 'all' || marketType === 'Crypto') {
      const cryptos = await searchCrypto(query);
      results.push(...cryptos);
    }

    return results;
  } catch (error) {
    console.error('Error searching assets:', error);
    return [];
  }
};

/**
 * Search Taiwan stocks via FinMind
 */
const searchTWStocks = async (query) => {
  try {
    const response = await fetch(`${FINMIND_BASE_URL}/data?dataset=TaiwanStockInfo`);
    const data = await response.json();

    if (data.status === 200 && data.data) {
      const seen = new Set();
      return data.data
        .filter(stock =>
          stock.stock_id.includes(query) ||
          stock.stock_name.includes(query)
        )
        .filter(stock => {
          if (seen.has(stock.stock_id)) return false;
          seen.add(stock.stock_id);
          return true;
        })
        .slice(0, 20)
        .map(stock => ({
          symbol: stock.stock_id,
          name: stock.stock_name,
          market_type: 'TW',
        }));
    }
    return [];
  } catch (error) {
    console.error('Error searching TW stocks:', error);
    return [];
  }
};

/**
 * Search US stocks (local list)
 */
const US_STOCKS = [
  { symbol: 'AAPL',  name: 'Apple Inc.' },
  { symbol: 'MSFT',  name: 'Microsoft Corporation' },
  { symbol: 'NVDA',  name: 'NVIDIA Corporation' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'AMZN',  name: 'Amazon.com Inc.' },
  { symbol: 'META',  name: 'Meta Platforms Inc.' },
  { symbol: 'TSLA',  name: 'Tesla Inc.' },
  { symbol: 'AVGO',  name: 'Broadcom Inc.' },
  { symbol: 'JPM',   name: 'JPMorgan Chase & Co.' },
  { symbol: 'V',     name: 'Visa Inc.' },
  { symbol: 'MA',    name: 'Mastercard Inc.' },
  { symbol: 'UNH',   name: 'UnitedHealth Group' },
  { symbol: 'XOM',   name: 'Exxon Mobil Corporation' },
  { symbol: 'LLY',   name: 'Eli Lilly and Company' },
  { symbol: 'WMT',   name: 'Walmart Inc.' },
  { symbol: 'JNJ',   name: 'Johnson & Johnson' },
  { symbol: 'PG',    name: 'Procter & Gamble Co.' },
  { symbol: 'AMD',   name: 'Advanced Micro Devices' },
  { symbol: 'ORCL',  name: 'Oracle Corporation' },
  { symbol: 'COST',  name: 'Costco Wholesale Corporation' },
  { symbol: 'HD',    name: 'The Home Depot Inc.' },
  { symbol: 'BAC',   name: 'Bank of America Corporation' },
  { symbol: 'NFLX',  name: 'Netflix Inc.' },
  { symbol: 'QCOM',  name: 'Qualcomm Inc.' },
  { symbol: 'TXN',   name: 'Texas Instruments Inc.' },
  { symbol: 'DIS',   name: 'The Walt Disney Company' },
  { symbol: 'UBER',  name: 'Uber Technologies Inc.' },
  { symbol: 'PLTR',  name: 'Palantir Technologies Inc.' },
  { symbol: 'COIN',  name: 'Coinbase Global Inc.' },
  { symbol: 'SMCI',  name: 'Super Micro Computer Inc.' },
  { symbol: 'ARM',   name: 'Arm Holdings plc' },
  { symbol: 'INTC',  name: 'Intel Corporation' },
  { symbol: 'MU',    name: 'Micron Technology Inc.' },
  { symbol: 'AMAT',  name: 'Applied Materials Inc.' },
  { symbol: 'LRCX',  name: 'Lam Research Corporation' },
  { symbol: 'ASML',  name: 'ASML Holding N.V.' },
  { symbol: 'TSM',   name: 'Taiwan Semiconductor (ADR)' },
  { symbol: 'BABA',  name: 'Alibaba Group Holding' },
  { symbol: 'PDD',   name: 'PDD Holdings (Temu)' },
  { symbol: 'MSTR',  name: 'MicroStrategy Inc.' },
];

const searchUSStocks = async (query) => {
  const q = query.toLowerCase();
  return US_STOCKS
    .filter(s => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
    .slice(0, 20)
    .map(s => ({ ...s, market_type: 'US' }));
};

/**
 * Search cryptocurrencies via CoinGecko
 */
const searchCrypto = async (query) => {
  try {
    const response = await fetch(`${COINGECKO_BASE_URL}/search?query=${query}`);
    if (!response.ok) return [];
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { return []; }

    if (data.coins) {
      return data.coins
        .slice(0, 20)
        .map(coin => ({
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          market_type: 'Crypto',
          coinId: coin.id,
        }));
    }
    return [];
  } catch (error) {
    console.error('Error searching crypto:', error);
    return [];
  }
};

// 大盤指數（固定清單，用 Yahoo Finance 取價）
export const TW_INDICES = [
  { symbol: '^TWII',  name: '台股加權指數', market_type: 'TW', isIndex: true },
  { symbol: '^TWOII', name: '台股櫃買指數', market_type: 'TW', isIndex: true },
];

export const US_INDICES = [
  { symbol: '^GSPC', name: 'S&P 500',     market_type: 'US', isIndex: true },
  { symbol: '^IXIC', name: 'NASDAQ',       market_type: 'US', isIndex: true },
  { symbol: '^DJI',  name: '道瓊工業指數', market_type: 'US', isIndex: true },
  { symbol: '^RUT',  name: '羅素 2000',    market_type: 'US', isIndex: true },
  { symbol: '^VIX',  name: 'VIX 恐慌指數', market_type: 'US', isIndex: true },
];

// 熱門標的
// TW candidate pool — sorted by live volume when fetched, pick top 10
const TW_CANDIDATES = [
  { symbol: '2330', name: '台積電' },
  { symbol: '2454', name: '聯發科' },
  { symbol: '2317', name: '鴻海' },
  { symbol: '2308', name: '台達電' },
  { symbol: '2382', name: '廣達' },
  { symbol: '2881', name: '富邦金' },
  { symbol: '2303', name: '聯電' },
  { symbol: '2412', name: '中華電' },
  { symbol: '2886', name: '兆豐金' },
  { symbol: '3711', name: '日月光投控' },
  { symbol: '2891', name: '中信金' },
  { symbol: '2884', name: '玉山金' },
  { symbol: '2002', name: '中鋼' },
  { symbol: '1301', name: '台塑' },
  { symbol: '2357', name: '華碩' },
];

/**
 * Fetch trending assets dynamically:
 *  - Crypto: CoinGecko top 10 by 24h volume (fallback to simple/price)
 *  - US: Yahoo Finance trending top 10
 *  - TW: TW_CANDIDATES sorted by live FinMind volume, top 10
 *
 * Returns { assets: [...], prices: { symbol: priceData } }
 */
export const fetchTrendingAssets = async () => {
  const assets = [];
  const prices = {};

  // ── 0. 大盤指數（Yahoo Finance，TW 優先，US 次之）────────────
  const allIndices = [...TW_INDICES, ...US_INDICES];
  const idxResults = await Promise.allSettled(
    allIndices.map(async (idx) => {
      const priceData = await fetchUSStockPrice(idx.symbol);
      return { idx, priceData };
    })
  );
  idxResults.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.priceData) {
      prices[allIndices[i].symbol] = { ...r.value.priceData, market_type: allIndices[i].market_type };
    } else if (r.status === 'rejected') {
      console.warn(`fetchTrendingAssets index ${allIndices[i].symbol}:`, r.reason?.message);
    }
  });
  allIndices.forEach(idx => assets.push({ ...idx }));

  // ── 1. Crypto — Binance batch (primary), CoinGecko (fallback) ──
  const CRYPTO_LIST = [
    { id: 'bitcoin',      symbol: 'BTC',  name: 'Bitcoin',    binance: 'BTCUSDT' },
    { id: 'ethereum',     symbol: 'ETH',  name: 'Ethereum',   binance: 'ETHUSDT' },
    { id: 'tether',       symbol: 'USDT', name: 'Tether',     stablecoin: true },
    { id: 'binancecoin',  symbol: 'BNB',  name: 'BNB',        binance: 'BNBUSDT' },
    { id: 'solana',       symbol: 'SOL',  name: 'Solana',     binance: 'SOLUSDT' },
    { id: 'ripple',       symbol: 'XRP',  name: 'XRP',        binance: 'XRPUSDT' },
    { id: 'usd-coin',     symbol: 'USDC', name: 'USD Coin',   stablecoin: true },
    { id: 'dogecoin',     symbol: 'DOGE', name: 'Dogecoin',   binance: 'DOGEUSDT' },
    { id: 'cardano',      symbol: 'ADA',  name: 'Cardano',    binance: 'ADAUSDT' },
    { id: 'avalanche-2',  symbol: 'AVAX', name: 'Avalanche',  binance: 'AVAXUSDT' },
  ];

  let cryptoFilled = false;
  try {
    // Binance batch ticker — single request, truly real-time
    const binanceSymbols = CRYPTO_LIST.filter(c => c.binance).map(c => `"${c.binance}"`).join(',');
    const binRes = await fetch(`${BINANCE_BASE_URL}/ticker/24hr?symbols=[${binanceSymbols}]`);
    if (!binRes.ok) throw new Error(`Binance HTTP ${binRes.status}`);
    const binData = await binRes.json();
    if (!Array.isArray(binData)) throw new Error('Binance unexpected response');

    const binMap = Object.fromEntries(binData.map(d => [d.symbol, d]));
    CRYPTO_LIST.forEach(({ id, symbol, name, binance, stablecoin }) => {
      let priceData;
      if (stablecoin) {
        priceData = { symbol, price: 1, change_percent: 0, volume: 0, market_type: 'Crypto' };
      } else {
        const d = binMap[binance];
        if (!d) return;
        priceData = {
          symbol,
          price: parseFloat(d.lastPrice),
          change_percent: parseFloat(d.priceChangePercent),
          volume: parseFloat(d.quoteVolume) || 0,
          market_type: 'Crypto',
        };
      }
      assets.push({ symbol, name, market_type: 'Crypto', coinId: id });
      prices[symbol] = priceData;
      cachePrice(priceData);
    });
    cryptoFilled = true;
  } catch (e) {
    console.warn('Binance batch failed, falling back to CoinGecko:', e.message);
  }

  if (!cryptoFilled) {
    // Fallback: CoinGecko markets
    try {
      const res = await fetch(
        `${COINGECKO_BASE_URL}/coins/markets?vs_currency=usd&order=volume_desc&per_page=10&page=1`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) throw new Error('CoinGecko empty');
      data.forEach(coin => {
        const sym = coin.symbol.toUpperCase();
        const priceData = {
          symbol: sym, price: coin.current_price,
          change_percent: coin.price_change_percentage_24h || 0,
          volume: coin.total_volume || 0, market_cap: coin.market_cap || 0,
          high_24h: coin.high_24h || null, low_24h: coin.low_24h || null,
          market_type: 'Crypto',
        };
        assets.push({ symbol: sym, name: coin.name, market_type: 'Crypto', coinId: coin.id });
        prices[sym] = priceData;
        cachePrice(priceData);
      });
    } catch (e2) {
      console.warn('CoinGecko fallback also failed:', e2.message);
      // Last resort: show stale cache
      for (const { id, symbol, name } of CRYPTO_LIST) {
        const cached = await getCachedPrice(symbol, 'Crypto');
        if (cached) { assets.push({ symbol, name, market_type: 'Crypto', coinId: id }); prices[symbol] = cached; }
        else assets.push({ symbol, name, market_type: 'Crypto', coinId: id });
      }
    }
  }

  // ── 2. US trending ─────────────────────────────────────────
  try {
    const trendRes = await fetch(
      'https://query1.finance.yahoo.com/v1/finance/trending/US?count=12'
    );
    const trendData = await trendRes.json();
    const symbols = (trendData?.finance?.result?.[0]?.quotes || [])
      .map(q => q.symbol)
      .filter(s => !s.includes('^') && !s.includes('='))
      .slice(0, 10);

    const usResults = await Promise.allSettled(
      symbols.map(async (sym) => {
        const known = US_STOCKS.find(s => s.symbol === sym);
        const priceData = await fetchUSStockPrice(sym);
        return { sym, name: known?.name || sym, priceData };
      })
    );
    usResults.forEach(r => {
      if (r.status === 'fulfilled') {
        const { sym, name, priceData } = r.value;
        assets.push({ symbol: sym, name, market_type: 'US' });
        if (priceData) prices[sym] = priceData;
      }
    });
  } catch (e) {
    console.warn('fetchTrendingAssets US error:', e.message);
  }

  // ── 3. TW — candidate pool sorted by live volume ───────────
  try {
    const twResults = await Promise.allSettled(
      TW_CANDIDATES.map(async (c) => {
        const priceData = await fetchTWStockPrice(c.symbol);
        return { ...c, priceData };
      })
    );
    const twWithPrices = twResults
      .filter(r => r.status === 'fulfilled' && r.value.priceData)
      .map(r => r.value)
      .sort((a, b) => (b.priceData.volume || 0) - (a.priceData.volume || 0))
      .slice(0, 10);

    twWithPrices.forEach(({ symbol, name, priceData }) => {
      assets.push({ symbol, name, market_type: 'TW' });
      prices[symbol] = priceData;
    });
  } catch (e) {
    console.warn('fetchTrendingAssets TW error:', e.message);
  }

  return { assets, prices };
};

/**
 * Fetch 30-day historical prices for chart
 */
export const fetchHistoricalPrices = async (symbol, marketType) => {
  const start = getDateString(-30);
  const end = getDateString(0);
  try {
    if (marketType === 'TW') {
      const res = await fetch(
        `${FINMIND_BASE_URL}/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${start}&end_date=${end}`
      );
      const data = await res.json();
      if (data.status === 200 && data.data?.length > 0) {
        return data.data.map(d => ({ date: d.date, price: parseFloat(d.close) }));
      }
    } else if (marketType === 'US') {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1mo&interval=1d`
      );
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (result) {
        const timestamps = result.timestamp || [];
        const closes = result.indicators?.quote?.[0]?.close || [];
        return timestamps.map((ts, i) => ({
          date: new Date(ts * 1000).toISOString().split('T')[0],
          price: closes[i] ?? null,
        })).filter(d => d.price !== null);
      }
    } else if (marketType === 'Crypto') {
      const CRYPTO_IDS = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin' };
      const coinId = CRYPTO_IDS[symbol] || symbol.toLowerCase();
      const res = await fetch(
        `${COINGECKO_BASE_URL}/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=daily`
      );
      const data = await res.json();
      if (data.prices) {
        return data.prices.map(([ts, price]) => ({
          date: new Date(ts).toISOString().split('T')[0],
          price,
        }));
      }
    }
  } catch (e) {
    console.error('fetchHistoricalPrices error:', e);
  }
  return [];
};

/**
 * Convert amount to base currency
 */
export const convertToBaseCurrency = async (amount, fromCurrency, baseCurrency) => {
  if (fromCurrency === baseCurrency) return amount;

  try {
    const rate = await fetchExchangeRate(fromCurrency, baseCurrency);
    return amount * rate;
  } catch (error) {
    console.error('Error converting currency:', error);
    return amount;
  }
};

// --- Helpers ---

const getCachedPrice = async (symbol, marketType) => {
  try {
    const { data, error } = await supabase
      .from('price_cache')
      .select('*')
      .eq('symbol', symbol)
      .eq('market_type', marketType)
      .single();

    if (error || !data) return null;

    if (isRecentCache(data.updated_at)) {
      return {
        symbol: data.symbol,
        price: parseFloat(data.price),
        change_percent: parseFloat(data.change_percent),
        volume: parseFloat(data.volume),
        market_type: data.market_type,
      };
    }
    return null;
  } catch {
    return null;
  }
};

const cachePrice = async (priceData) => {
  try {
    await supabase
      .from('price_cache')
      .upsert({
        symbol: priceData.symbol,
        market_type: priceData.market_type,
        price: priceData.price,
        change_percent: priceData.change_percent,
        volume: priceData.volume,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'symbol,market_type' });
  } catch (error) {
    console.error('Error caching price:', error);
  }
};

const isRecentCache = (timestamp) => {
  return (Date.now() - new Date(timestamp).getTime()) < CACHE_DURATION;
};

const getDateString = (daysOffset) => {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().split('T')[0];
};

const calculateChangePercent = (prevPrice, currentPrice) => {
  if (!prevPrice || prevPrice === 0) return 0;
  return ((currentPrice - prevPrice) / prevPrice) * 100;
};
