import { supabase } from '../lib/supabase';

const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map();

export async function fetchCorporateActions(symbol, marketType = 'TW', forceRefresh = false) {
  const market = String(marketType || '').toUpperCase();
  if (!['TW', 'US'].includes(market)) {
    throw new Error('股利／除權息目前只支援台股與美股。');
  }
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) throw new Error('缺少股票代號。');
  const key = `${market}:${normalized}`;
  const hit = cache.get(key);
  if (!forceRefresh && hit && Date.now() - hit.timestamp < CACHE_TTL) return hit.data;

  const { data, error } = await supabase.functions.invoke('corporate-actions', {
    body: { symbol: normalized, marketType: market, years: 5, forceRefresh },
  });
  if (error) throw new Error(error.message || '股利／除權息資料服務無法連線');
  if (data?.error) throw new Error(data.error);
  if (!Array.isArray(data?.events) || !data?.summary) throw new Error('股利／除權息資料格式不完整');
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}

export function clearCorporateActionsCache() {
  cache.clear();
}
