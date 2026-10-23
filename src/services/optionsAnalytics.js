import { supabase } from '../lib/supabase';
import {
  estimateGammaFromDeltaCurve,
  inferSpotFromPutCallParity,
  normalizeOptionSymbol,
  normalizeTaiwanOptionSymbol,
  parseTaifexStockProducts,
} from './optionsAnalyticsCalculator';

export {
  calculateOptionsAnalytics,
  calculateScenarioGexCurve,
  filterContractsByRange,
  normalizeOptionSymbol,
  normalizeTaiwanOptionSymbol,
} from './optionsAnalyticsCalculator';

const CACHE_TTL_MS = 5 * 60 * 1000;
const requestCache = new Map();
const cboeCache = new Map();
const taifexCache = new Map();
const TAIFEX_API = 'https://openapi.taifex.com.tw/v1';
const TAIFEX_STOCK_PRODUCTS_URL = 'https://www.taifex.com.tw/cht/2/stockLists';
const TAIFEX_INDEX_PRODUCTS = [
  { contract: 'TXO', symbol: 'TXO', name: '臺指選擇權', multiplier: 50, weekly: true },
];

const finiteNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const ymdToIso = value => {
  const text = String(value || '').replace(/\D/g, '');
  return text.length === 8 ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : String(value || '');
};

const fetchJson = async url => {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`期交所資料服務暫時無法使用（HTTP ${response.status}）`);
  return response.json();
};

const fetchTaifexSnapshot = async ({ forceRefresh = false } = {}) => {
  const cached = taifexCache.get('snapshot');
  if (!forceRefresh && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.data;
  const [marketRows, deltaRows, productResponse] = await Promise.all([
    fetchJson(`${TAIFEX_API}/DailyMarketReportOpt`),
    fetchJson(`${TAIFEX_API}/DailyOptionsDelta`),
    fetch(TAIFEX_STOCK_PRODUCTS_URL),
  ]);
  if (!productResponse.ok) throw new Error(`無法取得期交所股票選擇權清單（HTTP ${productResponse.status}）`);
  const products = [...TAIFEX_INDEX_PRODUCTS, ...parseTaifexStockProducts(await productResponse.text())];
  const data = { marketRows, deltaRows, products };
  taifexCache.set('snapshot', { cachedAt: Date.now(), data });
  return data;
};

const resolveTaifexProduct = (input, snapshot) => {
  const query = normalizeTaiwanOptionSymbol(input);
  const active = new Set((snapshot.marketRows || []).map(row => String(row?.Contract || '').toUpperCase()));
  const product = snapshot.products.find(item => item.symbol === query || item.contract === query);
  if (!product || !active.has(product.contract)) {
    throw new Error(`${query || '此標的'}目前沒有期交所掛牌且有行情的選擇權商品`);
  }
  return product;
};

const buildTaifexProductData = (snapshot, product) => {
  const sourceRows = (snapshot.marketRows || []).filter(row =>
    String(row?.Contract || '').toUpperCase() === product.contract
    && (!row?.TradingSession || row.TradingSession === '一般'));
  const sourceDeltas = (snapshot.deltaRows || []).filter(row => String(row?.Contract || '').toUpperCase() === product.contract);
  const settlementByMonth = new Map(sourceDeltas.map(row => [String(row?.['ContractMonth(Week)'] || ''), ymdToIso(row?.ContractSettlementDay)]));
  const deltaByKey = new Map(sourceDeltas.map(row => [
    `${row?.['ContractMonth(Week)']}:${finiteNumber(row?.StrikePrice)}:${row?.CallPut}`,
    finiteNumber(row?.Delta),
  ]));
  const contracts = sourceRows.flatMap(row => {
    const strike = finiteNumber(row?.StrikePrice);
    const type = row?.CallPut === '買權' ? 'call' : row?.CallPut === '賣權' ? 'put' : '';
    const contractMonth = String(row?.['ContractMonth(Week)'] || '');
    if (!(strike > 0) || !type) return [];
    const numeric = value => {
      const parsed = finiteNumber(value);
      return parsed === null ? null : parsed;
    };
    return [{
      symbol: `${product.contract}-${contractMonth}-${type}-${strike}`,
      type,
      strike,
      expiration: settlementByMonth.get(contractMonth) || contractMonth,
      contractMonth,
      multiplier: product.multiplier,
      bid: numeric(row?.BestBid),
      ask: numeric(row?.BestAsk),
      last: numeric(row?.Close),
      settlementPrice: numeric(row?.SettlementPrice),
      volume: Math.max(0, numeric(row?.Volume) || 0),
      openInterest: Math.max(0, numeric(row?.OpenInterest) || 0),
      delta: deltaByKey.get(`${contractMonth}:${strike}:${row?.CallPut}`) ?? null,
      impliedVolatility: null,
      greeksUpdatedAt: ymdToIso(row?.Date),
    }];
  });
  const spot = inferSpotFromPutCallParity(contracts);
  return {
    contracts: estimateGammaFromDeltaCurve({ rows: contracts, spot }),
    spot,
    expirations: [...new Set(contracts.map(item => item.expiration))].filter(Boolean).sort(),
    providerAsOf: ymdToIso(sourceRows[0]?.Date),
  };
};

const fetchTaifexProduct = async (symbol, { forceRefresh = false } = {}) => {
  const snapshot = await fetchTaifexSnapshot({ forceRefresh });
  const product = resolveTaifexProduct(symbol, snapshot);
  const built = buildTaifexProductData(snapshot, product);
  return {
    configured: true,
    market: 'TW',
    symbol: product.symbol,
    productName: product.name,
    contractCode: product.contract,
    currency: 'TWD',
    multiplier: product.multiplier,
    ...built,
    provider: '臺灣期貨交易所 OpenAPI',
    priceDelay: '盤後每日官方資料',
    greeksDelay: 'Gamma 依官方每日 Delta 曲線估算',
    gammaMethod: 'official-delta-curve-estimate',
    fetchedAt: new Date().toISOString(),
  };
};

const parseCboeOptionCode = value => {
  const match = String(value || '').match(/^(.+?)(\d{6})([CP])(\d{8})$/);
  if (!match) return null;
  return {
    expiration: `20${match[2].slice(0, 2)}-${match[2].slice(2, 4)}-${match[2].slice(4, 6)}`,
    type: match[3] === 'C' ? 'call' : 'put',
    strike: Number(match[4]) / 1000,
  };
};

const fetchCboeSnapshot = async (symbol, { forceRefresh = false } = {}) => {
  const cached = cboeCache.get(symbol);
  if (!forceRefresh && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.data;
  const response = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Cboe 找不到 ${symbol} 的選擇權資料（HTTP ${response.status}）`);
  const payload = await response.json();
  const rawContracts = Array.isArray(payload?.data?.options) ? payload.data.options : [];
  const contracts = rawContracts.flatMap(item => {
    const parsed = parseCboeOptionCode(item?.option);
    if (!parsed || !(parsed.strike > 0)) return [];
    return [{
      symbol: item.option,
      ...parsed,
      multiplier: 100,
      bid: Number.isFinite(Number(item.bid)) ? Number(item.bid) : null,
      ask: Number.isFinite(Number(item.ask)) ? Number(item.ask) : null,
      last: Number.isFinite(Number(item.last_trade_price)) ? Number(item.last_trade_price) : null,
      volume: Number.isFinite(Number(item.volume)) ? Math.max(0, Number(item.volume)) : 0,
      openInterest: Number.isFinite(Number(item.open_interest)) ? Math.max(0, Number(item.open_interest)) : 0,
      gamma: Number.isFinite(Number(item.gamma)) ? Number(item.gamma) : null,
      delta: Number.isFinite(Number(item.delta)) ? Number(item.delta) : null,
      impliedVolatility: Number.isFinite(Number(item.iv)) ? Number(item.iv) : null,
      greeksUpdatedAt: payload.timestamp || null,
    }];
  });
  const currentPrice = [payload?.data?.current_price, payload?.data?.close, payload?.data?.prev_day_close]
    .map(Number)
    .find(value => Number.isFinite(value) && value > 0) || null;
  const data = {
    configured: true,
    symbol,
    spot: currentPrice,
    contracts,
    expirations: [...new Set(contracts.map(item => item.expiration))].sort(),
    provider: 'Cboe Delayed Quotes',
    priceDelay: '約 15 分鐘延遲',
    greeksDelay: '隨 Cboe 延遲快照更新',
    providerAsOf: payload.timestamp || null,
    fetchedAt: new Date().toISOString(),
  };
  cboeCache.set(symbol, { cachedAt: Date.now(), data });
  return data;
};

const invokeOptionsAnalysis = async body => {
  const cacheKey = JSON.stringify(body);
  const cached = requestCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.data;

  const { data, error } = await supabase.functions.invoke('options-analysis', { body });
  if (error) throw new Error(error.message || '選擇權資料載入失敗');
  if (!data?.configured) throw new Error(data?.error || '尚未設定選擇權資料來源');
  if (data?.error) throw new Error(data.error);
  requestCache.set(cacheKey, { cachedAt: Date.now(), data });
  return data;
};

export const fetchOptionExpirations = async (symbol, { forceRefresh = false, market = 'US' } = {}) => {
  if (String(market).toUpperCase() === 'TW') {
    try {
      return await fetchTaifexProduct(symbol, { forceRefresh });
    } catch (directError) {
      try {
        return await invokeOptionsAnalysis({ action: 'expirations', market: 'TW', symbol: normalizeTaiwanOptionSymbol(symbol) });
      } catch {
        throw directError;
      }
    }
  }
  const normalized = normalizeOptionSymbol(symbol);
  if (!normalized) throw new Error('請輸入美股代號');
  if (forceRefresh) requestCache.delete(JSON.stringify({ action: 'expirations', symbol: normalized }));
  try {
    return await fetchCboeSnapshot(normalized, { forceRefresh });
  } catch {
    return invokeOptionsAnalysis({ action: 'expirations', symbol: normalized });
  }
};

export const fetchOptionChain = async (symbol, expiration, { forceRefresh = false, market = 'US' } = {}) => {
  if (String(market).toUpperCase() === 'TW') {
    try {
      const snapshot = await fetchTaifexProduct(symbol, { forceRefresh });
      return { ...snapshot, expiration, contracts: snapshot.contracts.filter(item => item.expiration === expiration) };
    } catch (directError) {
      try {
        return await invokeOptionsAnalysis({ action: 'chain', market: 'TW', symbol: normalizeTaiwanOptionSymbol(symbol), expiration });
      } catch {
        throw directError;
      }
    }
  }
  const normalized = normalizeOptionSymbol(symbol);
  if (!normalized) throw new Error('請輸入美股代號');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expiration || ''))) throw new Error('請先選擇到期日');
  const body = { action: 'chain', symbol: normalized, expiration };
  if (forceRefresh) requestCache.delete(JSON.stringify(body));
  try {
    const snapshot = await fetchCboeSnapshot(normalized, { forceRefresh });
    return { ...snapshot, expiration, contracts: snapshot.contracts.filter(item => item.expiration === expiration) };
  } catch {
    return invokeOptionsAnalysis(body);
  }
};
