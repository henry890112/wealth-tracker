import { BINANCE_BASE_URL, COINGECKO_BASE_URL, FINMIND_BASE_URL, SYMBOL_TO_COINGECKO_ID, getDateString } from './shared';

/**
 * Fetch historical close prices for technical analysis.
 * Returns number[] (oldest → newest) or null on failure.
 */
const _histCache = new Map();
const HIST_CACHE_TTL = 5 * 60 * 1000;

export const fetchHistoricalPrices = async (symbol, marketType, days = 90) => {
  const key = `${symbol}::${marketType}`;
  const hit = _histCache.get(key);
  if (hit && Date.now() - hit.ts < HIST_CACHE_TTL) return hit.data;

  try {
    let closes = [];

    if (marketType === 'TW') {
      const startDate = getDateString(-days);
      const url = `${FINMIND_BASE_URL}/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${startDate}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.data?.length > 0) {
        closes = json.data.map(d => parseFloat(d.close)).filter(v => v > 0);
      }
    } else if (marketType === 'US') {
      const range = days <= 30 ? '1mo' : days <= 90 ? '3mo' : '6mo';
      for (const host of ['query1', 'query2']) {
        try {
          const res = await fetch(
            `https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } }
          );
          if (!res.ok) continue;
          const json = await res.json();
          const raw = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
          const valid = raw.filter(c => c !== null && !isNaN(c));
          if (valid.length > 0) { closes = valid; break; }
        } catch { continue; }
      }
    } else if (marketType === 'Crypto') {
      const upperSym = symbol.toUpperCase();
      try {
        const limit = Math.min(days, 500);
        const res = await fetch(
          `${BINANCE_BASE_URL}/klines?symbol=${upperSym}USDT&interval=1d&limit=${limit}`
        );
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json) && json.length > 0) {
            closes = json.map(k => parseFloat(k[4]));
          }
        }
      } catch { /* fall through */ }

      if (closes.length === 0) {
        const coinId = SYMBOL_TO_COINGECKO_ID[upperSym] || upperSym.toLowerCase();
        try {
          const res = await fetch(
            `${COINGECKO_BASE_URL}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`
          );
          if (res.ok) {
            const json = await res.json();
            if (json.prices?.length > 0) closes = json.prices.map(p => p[1]);
          }
        } catch { /* no data */ }
      }
    }

    const data = closes.length >= 5 ? closes : null;
    _histCache.set(key, { data, ts: Date.now() });
    return data;
  } catch (e) {
    console.warn(`fetchHistoricalPrices(${symbol}):`, e.message);
    return null;
  }
};
