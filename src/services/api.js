// API Service for external data sources
import { supabase } from '../lib/supabase';

const FINMIND_BASE_URL = 'https://api.finmindtrade.com/api/v4';
const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const EXCHANGE_RATE_BASE_URL = 'https://api.exchangerate-api.com/v4/latest';

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

/**
 * Fetch Taiwan stock price from FinMind API
 */
export const fetchTWStockPrice = async (symbol) => {
  try {
    // Check cache first
    const cached = await getCachedPrice(symbol, 'TW');
    if (cached) return cached;

    const response = await fetch(
      `${FINMIND_BASE_URL}/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${getDateString(-7)}&end_date=${getDateString(0)}`
    );
    const data = await response.json();
    
    if (data.status === 200 && data.data && data.data.length > 0) {
      const latest = data.data[data.data.length - 1];
      const priceData = {
        symbol,
        price: parseFloat(latest.close),
        change_percent: calculateChangePercent(latest.open, latest.close),
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
 * Fetch US stock price from FinMind API
 */
export const fetchUSStockPrice = async (symbol) => {
  try {
    // Check cache first
    const cached = await getCachedPrice(symbol, 'US');
    if (cached) return cached;

    const response = await fetch(
      `${FINMIND_BASE_URL}/data?dataset=USStockPrice&data_id=${symbol}&start_date=${getDateString(-7)}&end_date=${getDateString(0)}`
    );
    const data = await response.json();
    
    if (data.status === 200 && data.data && data.data.length > 0) {
      const latest = data.data[data.data.length - 1];
      const priceData = {
        symbol,
        price: parseFloat(latest.close),
        change_percent: calculateChangePercent(latest.open, latest.close),
        volume: parseFloat(latest.volume),
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
export const fetchCryptoPrice = async (symbol) => {
  try {
    // Check cache first
    const cached = await getCachedPrice(symbol, 'Crypto');
    if (cached) return cached;

    const coinId = symbol.toLowerCase();
    const response = await fetch(
      `${COINGECKO_BASE_URL}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`
    );
    const data = await response.json();
    
    if (data[coinId]) {
      const priceData = {
        symbol: symbol.toUpperCase(),
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
    // Check cache first
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
      
      // Cache the rate
      await supabase
        .from('exchange_rates')
        .upsert({
          from_currency: fromCurrency,
          to_currency: toCurrency,
          rate: rate,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'from_currency,to_currency'
        });
      
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
      // Search Taiwan stocks
      const twStocks = await searchTWStocks(query);
      results.push(...twStocks);
    }
    
    if (marketType === 'all' || marketType === 'US') {
      // Search US stocks
      const usStocks = await searchUSStocks(query);
      results.push(...usStocks);
    }
    
    if (marketType === 'all' || marketType === 'Crypto') {
      // Search cryptocurrencies
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
 * Search Taiwan stocks
 */
const searchTWStocks = async (query) => {
  try {
    const response = await fetch(
      `${FINMIND_BASE_URL}/data?dataset=TaiwanStockInfo`
    );
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
 * Search US stocks (simplified - in production use a proper API)
 */
const searchUSStocks = async (query) => {
  // This is a simplified version. In production, use a proper stock search API
  const commonStocks = [
    { symbol: 'AAPL', name: 'Apple Inc.' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.' },
    { symbol: 'MSFT', name: 'Microsoft Corporation' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.' },
    { symbol: 'TSLA', name: 'Tesla Inc.' },
    { symbol: 'META', name: 'Meta Platforms Inc.' },
    { symbol: 'NVDA', name: 'NVIDIA Corporation' },
  ];
  
  return commonStocks
    .filter(stock => 
      stock.symbol.toLowerCase().includes(query.toLowerCase()) ||
      stock.name.toLowerCase().includes(query.toLowerCase())
    )
    .map(stock => ({
      ...stock,
      market_type: 'US',
    }));
};

/**
 * Search cryptocurrencies
 */
const searchCrypto = async (query) => {
  try {
    const response = await fetch(
      `${COINGECKO_BASE_URL}/search?query=${query}`
    );
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

/**
 * Helper: Get cached price from database
 */
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
  } catch (error) {
    return null;
  }
};

/**
 * Helper: Cache price in database
 */
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
      }, {
        onConflict: 'symbol,market_type'
      });
  } catch (error) {
    console.error('Error caching price:', error);
  }
};

/**
 * Helper: Check if cache is recent
 */
const isRecentCache = (timestamp) => {
  const cacheTime = new Date(timestamp).getTime();
  const now = Date.now();
  return (now - cacheTime) < CACHE_DURATION;
};

/**
 * Helper: Get date string for API queries
 */
const getDateString = (daysOffset) => {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().split('T')[0];
};

/**
 * Helper: Calculate percentage change
 */
const calculateChangePercent = (open, close) => {
  if (!open || open === 0) return 0;
  return ((close - open) / open) * 100;
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
