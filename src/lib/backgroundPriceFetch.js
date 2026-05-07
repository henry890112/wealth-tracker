import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchCryptoPriceBatch, fetchUSStockPriceBatch, fetchTWStockPrice } from '../services/api';

// Must match the key used in SearchScreen.js
const WATCHLIST_KEY = 'watchlist';

/**
 * Load the watchlist from AsyncStorage and fetch current prices for all symbols.
 * Returns a priceMap: { [symbol]: priceData }
 */
export async function fetchPricesForSymbols() {
  const raw = await AsyncStorage.getItem(WATCHLIST_KEY);
  if (!raw) return {};

  let watchlist;
  try {
    watchlist = JSON.parse(raw);
  } catch {
    return {};
  }

  const priceMap = {};
  const cryptos  = watchlist.filter(a => a.market_type === 'Crypto').map(a => a.symbol);
  const usStocks = watchlist.filter(a => a.market_type === 'US').map(a => a.symbol);
  const twStocks = watchlist.filter(a => a.market_type === 'TW');

  // Crypto and US use batch endpoints (single request each)
  if (cryptos.length > 0) {
    try {
      const prices = await fetchCryptoPriceBatch(cryptos);
      Object.assign(priceMap, prices);
    } catch (e) {
      console.warn('backgroundPriceFetch crypto batch error:', e);
    }
  }

  if (usStocks.length > 0) {
    try {
      const prices = await fetchUSStockPriceBatch(usStocks);
      Object.assign(priceMap, prices);
    } catch (e) {
      console.warn('backgroundPriceFetch US batch error:', e);
    }
  }

  // TW stocks: no batch endpoint, fetch sequentially
  for (const stock of twStocks) {
    try {
      const price = await fetchTWStockPrice(stock.symbol);
      if (price) priceMap[stock.symbol] = price;
    } catch {}
  }

  return priceMap;
}
