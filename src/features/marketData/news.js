import { FINMIND_BASE_URL, getDateString } from './shared';

// ── News fetching ──────────────────────────────────────────────────────────
const _newsCache = new Map();
const NEWS_CACHE_TTL = 10 * 60 * 1000;

/**
 * Fetch recent news for an asset.
 * Returns array of { title, summary, source, publishedAt } or [].
 */
export const fetchAssetNews = async (symbol, name, marketType) => {
  const key = `${symbol}::${marketType}`;
  const hit = _newsCache.get(key);
  if (hit && Date.now() - hit.ts < NEWS_CACHE_TTL) return hit.data;

  try {
    let news = [];

    if (marketType === 'TW') {
      // FinMind TaiwanStockNews
      const startDate = getDateString(-21);
      const url = `${FINMIND_BASE_URL}/data?dataset=TaiwanStockNews&data_id=${symbol}&start_date=${startDate}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.data?.length > 0) {
        news = json.data.slice(-8).reverse().map(d => ({
          title: d.title || '',
          summary: d.description || '',
          source: d.source || 'FinMind',
          publishedAt: (d.date || '').slice(0, 10),
        })).filter(n => n.title);
      }
    }

    // For non-TW or if FinMind returned nothing, try Yahoo Finance search
    if (news.length === 0) {
      const query = encodeURIComponent(symbol);
      for (const host of ['query1', 'query2']) {
        try {
          const res = await fetch(
            `https://${host}.finance.yahoo.com/v1/finance/search?q=${query}&newsCount=6&quotesCount=0&enableFuzzyQuery=false`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } }
          );
          if (!res.ok) continue;
          const json = await res.json();
          if (json.news?.length > 0) {
            news = json.news.slice(0, 6).map(n => ({
              title: n.title || '',
              summary: n.summary || '',
              source: n.publisher || '',
              publishedAt: n.providerPublishTime
                ? new Date(n.providerPublishTime * 1000).toISOString().slice(0, 10)
                : '',
            })).filter(n => n.title);
            break;
          }
        } catch { continue; }
      }
    }

    _newsCache.set(key, { data: news, ts: Date.now() });
    return news;
  } catch (e) {
    console.warn(`fetchAssetNews(${symbol}):`, e.message);
    return [];
  }
};
