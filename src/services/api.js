// API Service for external data sources
import { supabase } from '../lib/supabase';

const FINMIND_BASE_URL = 'https://api.finmindtrade.com/api/v4';
const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const EXCHANGE_RATE_BASE_URL = 'https://api.exchangerate-api.com/v4/latest';

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

/**
 * Fetch Taiwan stock price from FinMind API
 * change_percent = (today_close - yesterday_close) / yesterday_close
 */
export const fetchTWStockPrice = async (symbol) => {
  try {
    const cached = await getCachedPrice(symbol, 'TW');
    if (cached) return cached;

    const response = await fetch(
      `${FINMIND_BASE_URL}/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${getDateString(-7)}&end_date=${getDateString(0)}`
    );
    const data = await response.json();

    if (data.status === 200 && data.data && data.data.length > 0) {
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
 * Fetch US stock price from Yahoo Finance (free, no token required)
 * change_percent = (price - previousClose) / previousClose
 */
export const fetchUSStockPrice = async (symbol) => {
  try {
    const cached = await getCachedPrice(symbol, 'US');
    if (cached) return cached;

    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2d&interval=1d`
    );
    const data = await response.json();

    const meta = data?.chart?.result?.[0]?.meta;
    if (meta) {
      const currentPrice = meta.regularMarketPrice ?? meta.previousClose;
      const prevClose = meta.chartPreviousClose ?? meta.previousClose;
      const priceData = {
        symbol,
        price: currentPrice,
        change_percent: calculateChangePercent(prevClose, currentPrice),
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

/**
 * Fetch cryptocurrency price from CoinGecko API
 */
export const fetchCryptoPrice = async (coinId) => {
  try {
    const cached = await getCachedPrice(coinId, 'Crypto');
    if (cached) return cached;

    const response = await fetch(
      `${COINGECKO_BASE_URL}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`
    );
    const data = await response.json();

    if (data[coinId]) {
      const priceData = {
        symbol: coinId.toUpperCase(),
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
 * Fetch exchange rate
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

    const response = await fetch(`${EXCHANGE_RATE_BASE_URL}/${fromCurrency}`);
    const data = await response.json();

    if (data.rates && data.rates[toCurrency]) {
      const rate = data.rates[toCurrency];

      await supabase
        .from('exchange_rates')
        .upsert({
          from_currency: fromCurrency,
          to_currency: toCurrency,
          rate: rate,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'from_currency,to_currency' });

      return rate;
    }

    throw new Error('Exchange rate not found');
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
      return data.data
        .filter(stock =>
          stock.stock_id.includes(query) ||
          stock.stock_name.includes(query)
        )
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
    const data = await response.json();

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

// 熱門標的
export const HOT_ASSETS = [
  { symbol: '2330', name: '台積電', market_type: 'TW' },
  { symbol: '2454', name: '聯發科', market_type: 'TW' },
  { symbol: '2317', name: '鴻海', market_type: 'TW' },
  { symbol: '2308', name: '台達電', market_type: 'TW' },
  { symbol: '2382', name: '廣達', market_type: 'TW' },
  { symbol: '2881', name: '富邦金', market_type: 'TW' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', market_type: 'US' },
  { symbol: 'AAPL', name: 'Apple Inc.', market_type: 'US' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', market_type: 'US' },
  { symbol: 'TSLA', name: 'Tesla Inc.', market_type: 'US' },
  { symbol: 'META', name: 'Meta Platforms Inc.', market_type: 'US' },
  { symbol: 'TSM',  name: 'Taiwan Semiconductor (ADR)', market_type: 'US' },
  { symbol: 'BTC',  name: 'Bitcoin', market_type: 'Crypto' },
  { symbol: 'ETH',  name: 'Ethereum', market_type: 'Crypto' },
  { symbol: 'SOL',  name: 'Solana', market_type: 'Crypto' },
  { symbol: 'BNB',  name: 'BNB', market_type: 'Crypto' },
];

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
