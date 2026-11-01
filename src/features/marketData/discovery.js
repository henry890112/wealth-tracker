import { BINANCE_BASE_URL, COINGECKO_BASE_URL } from './shared';
import { loadTWStockInfoDetailed } from './searchDirectory';
import { US_POPULAR_STOCKS, cachePrice, fetchTWStockPrice, fetchUSStockPrice, getCachedPrice } from './quotes';

/**
 * Search stocks and crypto
 */
export const searchAssetsDetailed = async (query, marketType = 'all') => {
  const results = [];
  const warnings = [];

  if (marketType === 'all' || marketType === 'TW') {
    const { assets, warning } = await searchTWStocksDetailed(query);
    results.push(...assets);
    if (warning) warnings.push(warning);
  }

  if (marketType === 'all' || marketType === 'US') {
    results.push(...await searchUSStocks(query));
  }

  if (marketType === 'all' || marketType === 'Crypto') {
    results.push(...await searchCrypto(query));
  }

  return { assets: results, warnings };
};

export const searchAssets = async (query, marketType = 'all') => {
  const { assets } = await searchAssetsDetailed(query, marketType);
  return assets;
};

/** Search Taiwan stocks by their official symbol or display name. */
const searchTWStocksDetailed = async query => {
  const { stocks, warning } = await loadTWStockInfoDetailed();
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  const seen = new Set();
  const assets = stocks
    .filter(stock => stock.stock_id.toLocaleLowerCase().includes(normalizedQuery)
      || stock.stock_name.toLocaleLowerCase().includes(normalizedQuery))
    .sort((a, b) => {
      const score = stock => stock.stock_id.toLocaleLowerCase() === normalizedQuery ? 0
        : stock.stock_id.toLocaleLowerCase().startsWith(normalizedQuery) ? 1 : 2;
      return score(a) - score(b);
    })
    .filter(stock => {
      if (seen.has(stock.stock_id)) return false;
      seen.add(stock.stock_id);
      return true;
    })
    .slice(0, 20)
    .map(stock => ({ symbol: stock.stock_id, name: stock.stock_name, market_type: 'TW' }));
  return { assets, warning };
};

/**
 * Search US stocks via Yahoo Finance API
 */
const US_YAHOO_QUOTE_TYPES = new Set(['EQUITY', 'ETF', 'MUTUALFUND', 'ETN']);
// Yahoo's search endpoint also returns foreign listings for the same keyword
// (for example DRAM.TO and DRAM.DE).  Keep only exchanges that are traded in
// the US so the UI's "美股" filter does not relabel foreign tickers.
const US_YAHOO_EXCHANGES = new Set([
  'ASE', 'BATS', 'BTT', 'BTS', 'MKT', 'NAS', 'NCM', 'NGM', 'NMS',
  'NYQ', 'NYS', 'OQB', 'OQX', 'OTC', 'PCX', 'PNK',
]);

const isUSYahooQuote = quote => (
  US_YAHOO_QUOTE_TYPES.has(String(quote?.quoteType || '').toUpperCase())
  && US_YAHOO_EXCHANGES.has(String(quote?.exchange || '').toUpperCase())
);

const searchUSStocks = async (query) => {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=15&newsCount=0`;
    const res = await fetch(url);
    const json = await res.json();
    const quotes = json?.quotes || [];
    return quotes
      .filter(isUSYahooQuote)
      .map(q => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        market_type: 'US',
        exchange: q.exchange,
        quote_type: q.quoteType,
      }))
      .slice(0, 15);
  } catch (e) {
    console.log('searchUSStocks error:', e);
    return [];
  }
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
  { symbol: '^DJI',  name: '道瓊工業指數', market_type: 'US', isIndex: true },
  { symbol: '^NDX',  name: 'NASDAQ-100', market_type: 'US', isIndex: true },
  { symbol: '^IXIC', name: 'NASDAQ',       market_type: 'US', isIndex: true },
  { symbol: '^RUT',  name: '羅素 2000',    market_type: 'US', isIndex: true },
  { symbol: '^SOX',  name: '費城半導體指數', market_type: 'US', isIndex: true },
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
        const known = US_POPULAR_STOCKS.find(s => s.symbol === sym);
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
    // Fallback: show static popular stocks with cached/live prices
    const fallbackSymbols = US_POPULAR_STOCKS.slice(0, 10);
    const fallbackResults = await Promise.allSettled(
      fallbackSymbols.map(async (stock) => {
        const priceData = await fetchUSStockPrice(stock.symbol);
        return { ...stock, priceData };
      })
    );
    fallbackResults.forEach(r => {
      if (r.status === 'fulfilled') {
        const { symbol, name, priceData } = r.value;
        assets.push({ symbol, name, market_type: 'US' });
        if (priceData) prices[symbol] = priceData;
      }
    });
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
