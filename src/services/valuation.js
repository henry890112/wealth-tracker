import { supabase } from '../lib/supabase';

const CACHE_TTL = 10 * 60 * 1000;
const CALCULATION_VERSION = 4;
const cache = new Map();

export async function fetchValuationHistory(symbol, marketType = 'TW', forceRefresh = false) {
  const market = String(marketType || '').toUpperCase();
  if (!['TW', 'US'].includes(market)) {
    throw new Error('估值位階目前只支援台股與美股。');
  }
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const key = `${market}:${normalizedSymbol}`;
  const hit = cache.get(key);
  if (!forceRefresh
    && hit
    && Number(hit.data?.calculationVersion) === CALCULATION_VERSION
    && Date.now() - hit.timestamp < CACHE_TTL) return hit.data;

  const { data, error } = await supabase.functions.invoke('valuation-history', {
    body: { symbol: normalizedSymbol, marketType: market, years: 5, forceRefresh },
  });
  if (error) throw new Error(error.message || '估值資料服務無法連線');
  if (data?.error) throw new Error(data.error);
  if (!data?.metrics) throw new Error('估值資料格式不完整');
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}
