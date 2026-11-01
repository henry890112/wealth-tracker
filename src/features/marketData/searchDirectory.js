import AsyncStorage from '@react-native-async-storage/async-storage';
import { FINMIND_BASE_URL } from './shared';

// ── TW stock list cache (Fix 2) ───────────────────────────────────────────
// Keep a short in-memory cache for typing and a longer on-device cache so a
// temporary provider outage doesn't make the Taiwan search directory vanish.
let _twStockCache = null;
let _twStockCacheTime = 0;
let _twStockCacheWarning = null;
let _twStockLoadPromise = null;
const TW_STOCK_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const TW_STOCK_CACHE_MAX_AGE = 14 * 24 * 60 * 60 * 1000;
const TW_STOCK_CACHE_KEY = 'wealthtracker:tw-stock-directory:v1';
const TWSE_STOCK_DIRECTORY_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';

const TW_STOCK_SEARCH_FALLBACK = [
  ['0050', '元大台灣50'], ['0056', '元大高股息'], ['006208', '富邦台50'],
  ['00878', '國泰永續高股息'], ['00919', '群益台灣精選高息'], ['00929', '復華台灣科技優息'],
  ['00940', '元大台灣價值高息'], ['00923', '群益台ESG低碳50'], ['00935', '野村台灣新科技50'],
  ['00939', '統一台灣高息動能'], ['2330', '台積電'], ['2317', '鴻海'],
  ['2454', '聯發科'], ['2308', '台達電'], ['2382', '廣達'], ['2303', '聯電'],
  ['2412', '中華電'], ['2881', '富邦金'], ['2882', '國泰金'], ['2891', '中信金'],
  ['2886', '兆豐金'], ['2884', '玉山金'], ['2603', '長榮'], ['2618', '長榮航'],
  ['2002', '中鋼'], ['1301', '台塑'], ['3008', '大立光'], ['3711', '日月光投控'],
  ['5274', '信驊'], ['6488', '環球晶'], ['6510', '精測'], ['3529', '力旺'],
  ['4966', '譜瑞-KY'], ['8299', '群聯'], ['5347', '世界先進'], ['6485', '點序'],
];

const normalizeTWStockInfo = rows => {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).flatMap(row => {
    const stock_id = String(row?.stock_id ?? row?.Code ?? '').trim().toUpperCase();
    const stock_name = String(row?.stock_name ?? row?.Name ?? '').trim();
    if (!stock_id || !stock_name || seen.has(stock_id)) return [];
    seen.add(stock_id);
    return [{ stock_id, stock_name }];
  });
};

const readPersistedTWStockInfo = async () => {
  try {
    const raw = await AsyncStorage.getItem(TW_STOCK_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    const cachedAt = Number(cached?.cachedAt);
    const stocks = normalizeTWStockInfo(cached?.stocks);
    const age = Date.now() - cachedAt;
    if (!stocks.length || !Number.isFinite(age) || age < 0 || age > TW_STOCK_CACHE_MAX_AGE) return null;
    return { stocks, cachedAt, source: cached.source || 'cache' };
  } catch {
    return null;
  }
};

const persistTWStockInfo = async (stocks, source) => {
  try {
    await AsyncStorage.setItem(TW_STOCK_CACHE_KEY, JSON.stringify({ stocks, source, cachedAt: Date.now() }));
  } catch { /* search still works with the in-memory copy */ }
};

export const loadTWStockInfoDetailed = async () => {
  if (_twStockCache && Date.now() - _twStockCacheTime < TW_STOCK_CACHE_TTL) {
    return { stocks: _twStockCache, warning: _twStockCacheWarning };
  }
  if (_twStockLoadPromise) return _twStockLoadPromise;

  _twStockLoadPromise = (async () => {
    let persisted = _twStockCache?.length
      ? { stocks: _twStockCache, cachedAt: _twStockCacheTime, source: 'memory' }
      : await readPersistedTWStockInfo();

    try {
      const response = await fetch(`${FINMIND_BASE_URL}/data?dataset=TaiwanStockInfo`);
      if (response.ok === false) throw new Error(`FinMind HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.status !== 200 || !Array.isArray(payload.data)) {
        throw new Error(payload.msg || `FinMind status ${payload.status ?? 'unknown'}`);
      }
      const stocks = normalizeTWStockInfo(payload.data);
      if (!stocks.length) throw new Error('FinMind returned an empty Taiwan stock directory');
      _twStockCache = stocks;
      _twStockCacheTime = Date.now();
      _twStockCacheWarning = null;
      await persistTWStockInfo(stocks, 'finmind');
      return { stocks, warning: null };
    } catch (finmindError) {
      console.warn('Taiwan stock search primary source unavailable:', finmindError?.message || finmindError);
    }

    try {
      const response = await fetch(TWSE_STOCK_DIRECTORY_URL);
      if (response.ok === false) throw new Error(`TWSE HTTP ${response.status}`);
      const officialStocks = normalizeTWStockInfo(await response.json());
      const stocks = normalizeTWStockInfo([...officialStocks, ...(persisted?.stocks || [])]);
      if (!stocks.length) throw new Error('TWSE returned an empty Taiwan stock directory');
      const warning = '台股清單暫由證交所備援資料提供；上櫃股票可能未完整。';
      _twStockCache = stocks;
      _twStockCacheTime = Date.now();
      _twStockCacheWarning = warning;
      await persistTWStockInfo(stocks, 'twse');
      return { stocks, warning };
    } catch (twseError) {
      console.warn('Taiwan stock search fallback unavailable:', twseError?.message || twseError);
    }

    if (persisted?.stocks?.length) {
      const warning = '台股清單來源暫時受限，顯示裝置內快取資料。';
      _twStockCache = persisted.stocks;
      _twStockCacheTime = Date.now();
      _twStockCacheWarning = warning;
      return { stocks: persisted.stocks, warning };
    }

    const stocks = normalizeTWStockInfo(TW_STOCK_SEARCH_FALLBACK.map(([stock_id, stock_name]) => ({ stock_id, stock_name })));
    const warning = '台股清單來源暫時受限，目前僅顯示常用標的。';
    _twStockCache = stocks;
    _twStockCacheTime = Date.now();
    _twStockCacheWarning = warning;
    return { stocks, warning };
  })();

  try {
    return await _twStockLoadPromise;
  } finally {
    _twStockLoadPromise = null;
  }
};

const loadTWStockInfo = async () => (await loadTWStockInfoDetailed()).stocks;

/** Resolve Taiwan symbols to their official Chinese names with one cached request. */
export const resolveTWStockNames = async symbols => {
  const wanted = new Set((symbols || []).map(symbol => String(symbol).trim()).filter(Boolean));
  if (!wanted.size) return {};
  try {
    const stocks = await loadTWStockInfo();
    const names = {};
    for (const stock of stocks) {
      const symbol = String(stock.stock_id || '').trim();
      if (wanted.has(symbol) && stock.stock_name) names[symbol] = String(stock.stock_name).trim();
    }
    return names;
  } catch (error) {
    console.warn('resolveTWStockNames error:', error);
    return {};
  }
};
