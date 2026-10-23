import { supabase } from '../lib/supabase';

const CACHE_TTL = 10 * 60 * 1000;
const MIN_CALCULATION_VERSION = 12;
const cache = new Map();

export async function fetchFinancialReports(symbol, marketType = 'TW', forceRefresh = false) {
  const market = String(marketType || '').toUpperCase();
  if (!['TW', 'US'].includes(market)) throw new Error('財報分析目前只支援台股與美股個股。');
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) throw new Error('缺少股票代號。');
  const key = `${market}:${normalized}`;
  const hit = cache.get(key);
  if (!forceRefresh && hit && Number(hit.data?.calculationVersion) >= MIN_CALCULATION_VERSION
    && Date.now() - hit.timestamp < CACHE_TTL) return hit.data;

  const { data, error } = await supabase.functions.invoke('financial-reports', {
    body: { symbol: normalized, marketType: market, forceRefresh },
  });
  if (error) throw new Error(error.message || '財報資料服務無法連線');
  if (data?.error) throw new Error(data.error);
  if (!Array.isArray(data?.quarters) || !data?.earningsCalendar) throw new Error('財報資料格式不完整');
  if (Number(data.calculationVersion) < MIN_CALCULATION_VERSION) {
    throw new Error('財報資料服務尚未更新，請更新服務後再重試。');
  }
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}

export function clearFinancialReportsCache() {
  cache.clear();
}
