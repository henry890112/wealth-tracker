const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;

export function parseYahooOptionHistory(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const points = timestamps.flatMap((timestamp, index) => {
    const close = Number(closes[index]);
    const milliseconds = Number(timestamp) * 1000;
    if (closes[index] == null || !Number.isFinite(close) || close <= 0
      || !Number.isFinite(milliseconds) || milliseconds <= 0) return [];
    return [{ date: new Date(milliseconds).toISOString().slice(0, 10), close }];
  });
  if (!points.length) return [];
  const latest = Date.parse(`${points[points.length - 1].date}T00:00:00Z`);
  const firstDay = new Date(latest - 29 * 86400000).toISOString().slice(0, 10);
  return points.filter(point => point.date >= firstDay);
}

export async function fetchOptionHistoricalPoints(symbol) {
  const key = String(symbol || '').trim().toUpperCase();
  if (!key) return null;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.points;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(key)}?interval=1d&range=1mo`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const points = parseYahooOptionHistory(await response.json());
      if (points.length) {
        cache.set(key, { at: Date.now(), points });
        return points;
      }
    } catch (_) {
      // A missing history should not hide the IV-based expected-move band.
    }
  }
  return null;
}
