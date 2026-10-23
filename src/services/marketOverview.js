const FRED_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
const SP500_PE_URL = 'https://www.multpl.com/s-p-500-pe-ratio/table/by-month';
const TPEX_INDEX_URL = 'https://info.tpex.org.tw/api/mktRT';
const TPEX_INDEX_HISTORY_URL = 'https://www.tpex.org.tw/www/zh-tw/indexInfo/inx?response=json';
const TAIEX_HISTORY_URL = 'https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?response=json';
const TWSE_MARGIN_INDEX_URL = 'https://www.twse.com.tw/rwd/zh/IIH/market/margin';
const TWSE_MARGIN_TREND_URL = 'https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN_TREND?response=json';
const TPEX_MARGIN_TREND_URL = 'https://www.tpex.org.tw/www/zh-tw/dashboardOtc/marginTrend?lang=zh-tw';
const MARKET_MAINTENANCE_URL = 'https://www.twse.com.tw/rwd/zh/marginTrading/BFIJ3U_TREND?response=json';
const TAIWAN_FLOW_URLS = {
  twseMargin: 'https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&selectType=MS',
  twseForeign: 'https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&type=day',
  tpexMargin: 'https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&o=json',
  tpexForeign: 'https://www.tpex.org.tw/www/zh-tw/insti/summary',
};
const CPI_SERIES_ID = 'CPIAUCNS';
const CPI_SOURCE_URL = 'https://fred.stlouisfed.org/series/CPIAUCNS';
const CPI_RELEASE_URL = 'https://www.bls.gov/cpi/';
const REQUEST_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const HISTORY_DAYS = 3 * 366;
const TW_MARGIN_HISTORY_CACHE_KEY = '@wt_tw_margin_history_pages_v1';
const TW_MARGIN_HISTORY_CACHE_MAX_PAGES = 16;
const TW_MARGIN_HISTORY_RECENT_CACHE_TTL_MS = 15 * 60 * 1000;
const TW_MARGIN_HISTORY_HISTORICAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const twMarginHistoryMemoryCache = new Map();
let twMarginHistoryCacheWriteQueue = Promise.resolve();
export const isTaiwanMarginHistoryCacheFresh = entry => {
  if (!entry?.cachedAt) return false;
  const asOfTime = Date.parse(`${entry?.data?.asOf || ''}T00:00:00Z`);
  const ageOfData = Number.isFinite(asOfTime) ? Date.now() - asOfTime : 0;
  const ttl = ageOfData > 3 * 24 * 60 * 60 * 1000
    ? TW_MARGIN_HISTORY_HISTORICAL_CACHE_TTL_MS
    : TW_MARGIN_HISTORY_RECENT_CACHE_TTL_MS;
  return Date.now() - entry.cachedAt < ttl;
};

const TREASURY_SERIES = [
  { id: 'DGS3MO', tenor: '3M', label: '3 個月' },
  { id: 'DGS2', tenor: '2Y', label: '2 年' },
  { id: 'DGS5', tenor: '5Y', label: '5 年' },
  { id: 'DGS10', tenor: '10Y', label: '10 年' },
  { id: 'DGS30', tenor: '30Y', label: '30 年' },
];

export const MARKET_PULSE_ITEMS = [
  { symbol: '^TWII', market: 'TW', marketLabel: '台股', name: '加權指數', category: '大盤', description: '台灣上市股票整體走勢' },
  { symbol: 'TPEX', market: 'TW', marketLabel: '台股', name: '櫃買指數', category: '中小型股', description: '台灣櫃買市場整體走勢', provider: 'tpex' },
  { symbol: '0050', market: 'TW', marketLabel: '台股', name: '台灣50', category: '大型股', description: '台灣大型權值股代表', proxy: true },
  { symbol: '0052', market: 'TW', marketLabel: '台股', name: '台灣科技', category: '科技', description: '以富邦科技 ETF 觀察產業強弱', proxy: true },
  { symbol: '00891', market: 'TW', marketLabel: '台股', name: '台灣半導體', category: '半導體', description: '以中信關鍵半導體 ETF 觀察', proxy: true },
  { symbol: '^GSPC', market: 'US', marketLabel: '美股', name: 'S&P 500', category: '大盤', description: '美國大型股整體走勢' },
  { symbol: '^DJI', market: 'US', marketLabel: '美股', name: '道瓊指數', category: '藍籌', description: '美國大型藍籌股代表指數' },
  { symbol: '^RUT', market: 'US', marketLabel: '美股', name: 'Russell 2000', category: '小型股', description: '美國小型股整體走勢' },
  { symbol: '^NDX', market: 'US', marketLabel: '美股', name: 'NASDAQ-100', category: '科技成長', description: 'Nasdaq 大型非金融成長股指數' },
  { symbol: '^IXIC', market: 'US', marketLabel: '美股', name: 'NASDAQ', category: '科技廣度', description: 'Nasdaq 市場整體科技與成長股廣度' },
  { symbol: '^SOX', market: 'US', marketLabel: '美股', name: '費城半導體', category: '半導體', description: '美國半導體產業指數' },
  { symbol: '^VIX', market: 'US', marketLabel: '美股', name: 'VIX 波動率', category: '市場風險', description: 'S&P 500 選擇權隱含波動率' },
];

export const formatMarketPulsePrice = value => {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return numeric.toLocaleString('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const marketPulseDailyChangePercent = (close, previousClose) => {
  if (close == null || previousClose == null) return null;
  const current = Number(close);
  const previous = Number(previousClose);
  return Number.isFinite(current) && Number.isFinite(previous) && previous > 0
    ? (current - previous) / previous * 100
    : null;
};

export const parseTpexIndexHistory = payload => {
  const table = payload?.tables?.find(item => item?.fields?.includes('收市') && Array.isArray(item?.data));
  if (!table) return [];
  const columns = Object.fromEntries(['日期', '開市', '最高', '最低', '收市'].map(name => [name, table.fields.indexOf(name)]));
  if (Object.values(columns).some(index => index < 0)) return [];
  return table.data.flatMap(values => {
    const time = String(values?.[columns['日期']] || '').replace(/\//g, '-');
    const number = name => Number(String(values?.[columns[name]] || '').replace(/,/g, ''));
    const [open, high, low, close] = ['開市', '最高', '最低', '收市'].map(number);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(time) || [open, high, low, close].some(value => !Number.isFinite(value) || value <= 0) || high < Math.max(open, close) || low > Math.min(open, close)) return [];
    return [{ time, open, high, low, close, volume: 0 }];
  });
};

export const fetchTpexIndexHistory = async () => {
  let payloads;
  try {
    const { supabase } = await import('../lib/supabase');
    const { data, error } = await supabase.functions.invoke('market-overview', { body: { action: 'tpex-index-history' } });
    if (error) throw error;
    if (!Array.isArray(data?.payloads) || !data.payloads.length) throw new Error('櫃買歷史資料暫缺');
    payloads = data.payloads;
  } catch {
    const current = new Date();
    const months = Array.from({ length: 14 }, (_, offset) => {
      const date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - offset, 1));
      return `${date.getUTCFullYear() - 1911}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    });
    const results = await Promise.allSettled(months.map(month => requestText(`${TPEX_INDEX_HISTORY_URL}&date=${encodeURIComponent(month)}`, '櫃買指數歷史').then(JSON.parse)));
    payloads = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  }
  const rows = [...new Map(payloads.flatMap(parseTpexIndexHistory).map(row => [row.time, row])).values()].sort((a, b) => a.time.localeCompare(b.time));
  if (rows.length < 2) throw new Error('櫃買指數歷史資料不足');
  return { rows, isIntraday: false };
};

let memoryCache = null;

const trimRecentHistory = (history, maxDays = HISTORY_DAYS) => {
  if (!Array.isArray(history) || !history.length) return [];
  const valid = history.filter(item => item?.date && Number.isFinite(Number(item.value)) && Number(item.value) > 0 && Number(item.value) < 500);
  if (!valid.length) return [];
  const latestTime = new Date(`${valid[valid.length - 1].date}T00:00:00Z`).getTime();
  const cutoff = latestTime - maxDays * 86400000;
  return valid.filter(item => new Date(`${item.date}T00:00:00Z`).getTime() >= cutoff);
};

const requestText = async (url, label) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/csv,text/html;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

const sourceTimeFromTaiwan = value => {
  const raw = String(value || '').trim();
  if (!raw) return new Date().toISOString();
  const parsed = new Date(`${raw.replace(/\//g, '-').replace(' ', 'T')}+08:00`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const taipeiClock = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
};

const tpexQuoteStatus = sourceTime => {
  const sourceClock = taipeiClock(new Date(sourceTime));
  const now = taipeiClock();
  const open = 9 * 60;
  const close = 13 * 60 + 35;
  return sourceClock.date === now.date
    && sourceClock.weekday !== 'Sat'
    && sourceClock.weekday !== 'Sun'
    && now.minutes >= open
    && now.minutes < close
    ? 'intraday'
    : 'official_close';
};

export const parseTpexRealtime = payload => {
  const index = Number(payload?.taiex?.index);
  if (!Number.isFinite(index) || index <= 0) return null;
  const previousClose = Number(payload?.infoArray?.y);
  const sourceTime = sourceTimeFromTaiwan(payload?.taiex?.datetime);
  const rawChangePercent = Number(payload?.taiex?.percent);
  const changePercent = Number.isFinite(rawChangePercent)
    ? rawChangePercent
    : Number.isFinite(previousClose) && previousClose > 0
      ? ((index - previousClose) / previousClose) * 100
      : 0;
  return {
    symbol: 'TPEX',
    price: index,
    change_percent: changePercent,
    volume: Number(payload?.infoArray?.v) || 0,
    market_type: 'TW',
    source: 'TPEx Official',
    source_time: sourceTime,
    fetched_at: new Date().toISOString(),
    price_time: sourceTime,
    quote_status: tpexQuoteStatus(sourceTime),
    is_stale: false,
    open: Number(payload?.infoArray?.o) || 0,
    high: Number(payload?.infoArray?.h) || 0,
    low: Number(payload?.infoArray?.l) || 0,
    previous_close: Number.isFinite(previousClose) ? previousClose : 0,
    candle_date: sourceTime.slice(0, 10),
  };
};

const fetchSp500Pe = async () => {
  let edgeError = null;
  try {
    const { supabase } = await import('../lib/supabase');
    const { data, error } = await supabase.functions.invoke('market-overview', { body: { action: 'sp500-pe' } });
    if (error) throw error;
    if (!data || !Number.isFinite(Number(data.value)) || !Array.isArray(data.history)) throw new Error(data?.error || '後端未回傳本益比');
    return { ...data, history: trimRecentHistory(data.history) };
  } catch (error) {
    edgeError = error;
  }
  try {
    const html = await requestText(SP500_PE_URL, 'S&P 500 本益比');
    const history = parseMultplSp500PeHistory(html);
    const latest = history[history.length - 1];
    if (!latest) throw new Error('S&P 500 本益比格式無法辨識');
    return { value: latest.value, asOf: latest.date, estimated: latest.estimated, history: trimRecentHistory(history) };
  } catch (directError) {
    throw new Error(`後端：${edgeError?.message || '無法連線'}；直接來源：${directError?.message || '無法連線'}`);
  }
};

const fetchTpexIndex = async () => {
  let edgeError = null;
  try {
    const { supabase } = await import('../lib/supabase');
    const { data, error } = await supabase.functions.invoke('market-overview', { body: { action: 'tpex-index' } });
    if (error) throw error;
    const quote = parseTpexRealtime(data);
    if (!quote) throw new Error('後端未回傳櫃買指數');
    return quote;
  } catch (error) {
    edgeError = error;
  }
  try {
    const payload = JSON.parse(await requestText(TPEX_INDEX_URL, '櫃買指數'));
    const quote = parseTpexRealtime(payload);
    if (!quote) throw new Error('櫃買指數格式無法辨識');
    return quote;
  } catch (directError) {
    throw new Error(`後端：${edgeError?.message || '無法連線'}；官方來源：${directError?.message || '無法連線'}`);
  }
};

const recentStartDate = (days = HISTORY_DAYS) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

export const parseFredSeries = (csvText, seriesId) => {
  const lines = String(csvText || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(value => value.trim());
  const valueIndex = headers.indexOf(seriesId);
  const dateIndex = headers.indexOf('observation_date');
  if (valueIndex < 0 || dateIndex < 0) return [];
  return lines.slice(1).flatMap(line => {
    const columns = line.split(',').map(value => value.trim());
    const value = Number(columns[valueIndex]);
    return columns[valueIndex] && Number.isFinite(value)
      ? [{ date: columns[dateIndex], value }]
      : [];
  });
};

export const parseFredLatestValue = (csvText, seriesId) => {
  const history = parseFredSeries(csvText, seriesId);
  const latest = history[history.length - 1];
  return latest ? { value: latest.value, asOf: latest.date } : null;
};

export const calculateYearOverYear = (history, targetDate = null) => {
  if (!Array.isArray(history) || history.length < 2) return null;
  const latest = targetDate
    ? history.find(item => item?.date === targetDate) || history.find(item => item?.date?.slice(0, 7) === String(targetDate).slice(0, 7))
    : history[history.length - 1];
  const monthKey = String(latest?.date || '').slice(0, 7);
  const [year, month] = monthKey.split('-');
  const previousYearKey = year && month ? `${Number(year) - 1}-${month}` : '';
  const previousYear = history.find(item => String(item?.date || '').slice(0, 7) === previousYearKey);
  const latestValue = Number(latest?.value);
  const previousValue = Number(previousYear?.value);
  if (!Number.isFinite(latestValue) || !Number.isFinite(previousValue) || previousValue <= 0) return null;
  return {
    value: (latestValue / previousValue - 1) * 100,
    asOf: latest.date,
    previousAsOf: previousYear.date,
  };
};

export const findHistoryPointAtOrBefore = (history, targetDate) => {
  if (!Array.isArray(history) || !history.length || !targetDate) return null;
  const targetTime = new Date(`${targetDate}T00:00:00Z`).getTime();
  if (Number.isNaN(targetTime)) return null;
  let match = null;
  let matchTime = -Infinity;
  history.forEach(item => {
    const itemTime = new Date(`${item?.date}T00:00:00Z`).getTime();
    if (!Number.isNaN(itemTime) && itemTime <= targetTime && itemTime > matchTime) {
      match = item;
      matchTime = itemTime;
    }
  });
  return match;
};

const stripHtml = value => String(value || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&#x[0-9a-f]+;|&#\d+;/gi, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

export const parseMultplSp500PeHistory = html => {
  const table = String(html || '').match(/<table[^>]*(?:id=["']datatable["'])?[^>]*>[\s\S]*?<\/table>/i)?.[0] || String(html || '');
  const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  return rows.flatMap(row => {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 2) return [];
    const dateText = stripHtml(cells[0][1]);
    const valueText = stripHtml(cells[1][1]).replace(/†/g, '').trim();
    const value = Number(valueText.match(/-?\d+(?:\.\d+)?/g)?.at(-1));
    const parsedDate = new Date(`${dateText} UTC`);
    if (!Number.isFinite(value) || Number.isNaN(parsedDate.getTime())) return [];
    return [{ date: parsedDate.toISOString().slice(0, 10), value, estimated: /Estimate|†/i.test(cells[1][1]) }];
  }).sort((left, right) => left.date.localeCompare(right.date));
};

export const parseMultplSp500Pe = html => {
  const history = parseMultplSp500PeHistory(html);
  const latest = history[history.length - 1];
  return latest ? { value: latest.value, asOf: latest.date, estimated: latest.estimated } : null;
};

const fetchFredSeries = async seriesId => {
  const url = `${FRED_CSV_URL}?id=${encodeURIComponent(seriesId)}&cosd=${recentStartDate()}`;
  const text = await requestText(url, `FRED ${seriesId}`);
  const history = parseFredSeries(text, seriesId);
  const latest = history[history.length - 1];
  if (!latest) throw new Error(`FRED ${seriesId} 沒有近期資料`);
  return { value: latest.value, asOf: latest.date, history };
};

const settledValue = result => result.status === 'fulfilled' ? result.value : null;

export const mergeMarketPulseQuotes = (items, quoteMaps, fallbackPulse = []) => {
  const fallbackQuotes = new Map();
  (fallbackPulse || []).forEach(item => {
    if (Number(item?.quote?.price) > 0) fallbackQuotes.set(`${item.market}:${item.symbol}`, item.quote);
  });
  return items.map(item => {
    const incoming = quoteMaps?.[item.market]?.[item.symbol] || null;
    const incomingValid = Number.isFinite(Number(incoming?.price)) && Number(incoming.price) > 0;
    const fallback = fallbackQuotes.get(`${item.market}:${item.symbol}`) || null;
    const fallbackValid = Number.isFinite(Number(fallback?.price)) && Number(fallback.price) > 0;
    const quote = incomingValid
      ? incoming
      : fallbackValid
        ? { ...fallback, is_stale: true, quote_status: 'stale' }
        : null;
    return {
      ...item,
      quote,
      available: Number(quote?.price) > 0,
    };
  });
};

const fetchMarketPulse = async (forceRefresh, fallbackPulse = []) => {
  const { fetchTWStockPriceBatch, fetchUSStockPriceBatch, readMarketPulseQuoteCache, persistMarketPulseQuoteCache } = await import('./api.js');
  const twSymbols = MARKET_PULSE_ITEMS.filter(item => item.market === 'TW' && item.provider !== 'tpex').map(item => item.symbol);
  const usSymbols = MARKET_PULSE_ITEMS.filter(item => item.market === 'US').map(item => item.symbol);
  const [tw, us, tpex, cachedQuotes] = await Promise.all([
    fetchTWStockPriceBatch(twSymbols, { forceRefresh }),
    fetchUSStockPriceBatch(usSymbols, { forceRefresh }),
    fetchTpexIndex().catch(() => null),
    readMarketPulseQuoteCache(),
  ]);
  const cachedPulse = MARKET_PULSE_ITEMS.map(item => ({
    ...item,
    quote: cachedQuotes?.[item.market]?.[item.symbol] || null,
  }));
  const liveQuotes = [
    ...Object.values(tw || {}),
    ...Object.values(us || {}),
    ...(tpex ? [tpex] : []),
  ].filter(quote => Number(quote?.price) > 0 && !quote?.is_stale);
  await persistMarketPulseQuoteCache(liveQuotes);
  return mergeMarketPulseQuotes(
    MARKET_PULSE_ITEMS,
    { TW: { ...tw, TPEX: tpex }, US: us },
    [...cachedPulse, ...fallbackPulse],
  );
};

export const fetchCachedMarketPulse = async () => {
  try {
    const { readMarketPulseQuoteCache } = await import('./api.js');
    const cachedQuotes = await readMarketPulseQuoteCache();
    const fallbackPulse = MARKET_PULSE_ITEMS.map(item => ({
      ...item,
      quote: cachedQuotes?.[item.market]?.[item.symbol] || null,
    }));
    return mergeMarketPulseQuotes(MARKET_PULSE_ITEMS, {}, fallbackPulse);
  } catch {
    return mergeMarketPulseQuotes(MARKET_PULSE_ITEMS, {});
  }
};

export const parseTaiwanMarketFlowPayloads = payloads => {
  const number = value => value == null || String(value).trim() === '' ? NaN : Number(String(value).replace(/,/g, ''));
  const date = value => {
    const raw = String(value || '').replace(/\D/g, '');
    return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null;
  };
  const payload = index => payloads?.[index] || null;
  const readMargin = (item, market) => {
    const row = market === 'twse'
      ? item?.tables?.[0]?.data?.find(entry => String(entry?.[0]).includes('融資金額'))
      : item?.tables?.[0]?.summary?.find(entry => String(entry?.[1]).includes('融資金'));
    const asOf = date(item?.date);
    const previous = number(row?.[market === 'twse' ? 4 : 2]) * 1000;
    const balance = number(row?.[market === 'twse' ? 5 : 6]) * 1000;
    return asOf && Number.isFinite(previous) && Number.isFinite(balance) ? { date: asOf, previous, balance, change: balance - previous } : null;
  };
  const readInstitutional = (item, market) => {
    const rows = market === 'twse' ? item?.data : item?.tables?.[0]?.data;
    const asOf = date(item?.date);
    if (!asOf) return null;
    const read = label => {
      const row = rows?.find(entry => String(entry?.[0]).trim() === label);
      const buy = number(row?.[1]); const sell = number(row?.[2]); const net = number(row?.[3]);
      return [buy, sell, net].every(Number.isFinite) ? { date: asOf, buy, sell, net } : null;
    };
    const add = (...parts) => parts.every(Boolean) ? {
      date: asOf, buy: parts.reduce((sum, part) => sum + part.buy, 0),
      sell: parts.reduce((sum, part) => sum + part.sell, 0), net: parts.reduce((sum, part) => sum + part.net, 0),
    } : null;
    const foreign = read(market === 'twse' ? '外資及陸資(不含外資自營商)' : '外資及陸資(不含自營商)');
    const trust = read('投信');
    const dealer = market === 'twse' ? add(read('自營商(自行買賣)'), read('自營商(避險)')) : read('自營商合計');
    return foreign || trust || dealer ? { date: asOf, foreign, trust, dealer, directional: add(foreign, trust), all: add(foreign, trust, dealer) } : null;
  };
  const twseInstitutional = readInstitutional(payload(1), 'twse');
  const tpexInstitutional = readInstitutional(payload(3), 'tpex');
  const twse = { margin: readMargin(payload(0), 'twse'), foreign: twseInstitutional?.foreign || null, institutional: twseInstitutional };
  const tpex = { margin: readMargin(payload(2), 'tpex'), foreign: tpexInstitutional?.foreign || null, institutional: tpexInstitutional };
  if (!twse.margin && !twse.institutional && !tpex.margin && !tpex.institutional) throw new Error('上市與上櫃市場資料暫時無法取得');
  const combined = Object.fromEntries(['margin', 'foreign'].map(key => {
    const left = twse[key];
    const right = tpex[key];
    if (!left || !right || left.date !== right.date) return [key, null];
    const fields = key === 'margin' ? ['balance', 'previous', 'change'] : ['buy', 'sell', 'net'];
    return [key, { date: left.date, ...Object.fromEntries(fields.map(field => [field, left[field] + right[field]])) }];
  }));
  combined.institutional = combineInstitutionalFlows(twseInstitutional, tpexInstitutional);
  return { twse, tpex, combined, sources: TAIWAN_FLOW_URLS };
};

export const combineInstitutionalFlows = (left, right) => {
  if (!left || !right || left.date !== right.date) return null;
  const combined = { date: left.date };
  for (const key of ['foreign', 'trust', 'dealer', 'all', 'directional']) {
    const a = left[key]; const b = right[key];
    combined[key] = a && b ? { date: left.date, buy: a.buy + b.buy, sell: a.sell + b.sell, net: a.net + b.net } : null;
  }
  return combined;
};

const mergeInstitutionalMarket = (previous, current) => {
  if (!previous) return current || null;
  if (!current) return previous;
  if (previous.date !== current.date) return current;
  const foreign = current.foreign || previous.foreign || null;
  const trust = current.trust || previous.trust || null;
  const dealer = current.dealer || previous.dealer || null;
  const add = (...items) => items.every(Boolean) ? {
    date: current.date,
    buy: items.reduce((sum, item) => sum + item.buy, 0),
    sell: items.reduce((sum, item) => sum + item.sell, 0),
    net: items.reduce((sum, item) => sum + item.net, 0),
  } : null;
  return {
    date: current.date, foreign, trust, dealer,
    directional: add(foreign, trust) || current.directional || previous.directional || null,
    all: add(foreign, trust, dealer) || current.all || previous.all || null,
  };
};

export const mergeInstitutionalHistoryRows = rows => {
  const byDate = new Map();
  (rows || []).forEach(row => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || ''))) return;
    const previous = byDate.get(row.date);
    const twse = mergeInstitutionalMarket(previous?.twse, row.twse);
    const tpex = mergeInstitutionalMarket(previous?.tpex, row.tpex);
    if (!twse && !tpex) return;
    byDate.set(row.date, {
      ...previous, ...row, twse, tpex,
      combined: combineInstitutionalFlows(twse, tpex),
      taiexClose: Number(row.taiexClose) > 0 ? row.taiexClose : previous?.taiexClose ?? null,
      tpexClose: Number(row.tpexClose) > 0 ? row.tpexClose : previous?.tpexClose ?? null,
    });
  });
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
};

export const marginHistoryCoverage = (history, endDate) => {
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(end.getTime())) return { complete: false, expected: 0, twse: 0, tpex: 0 };
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  let expected = 0;
  for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) expected++;
  }
  const dates = new Set();
  const counts = { twse: 0, tpex: 0 };
  (history || []).forEach(row => {
    if (!row?.date || row.date < start.toISOString().slice(0, 10) || row.date > endDate || dates.has(row.date)) return;
    dates.add(row.date);
    for (const market of ['twse', 'tpex']) {
      if (row[market]?.date === row.date && Number(row[market]?.balance) > 0) counts[market]++;
    }
  });
  const minimum = Math.max(2, Math.floor(expected * 0.55));
  return { ...counts, expected, complete: counts.twse >= minimum && counts.tpex >= minimum };
};

export const foreignHistoryCoverage = (history, endDate, category = 'foreign', market = 'combined') => {
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(end.getTime())) return { complete: false, expected: 0, twse: 0, tpex: 0, combined: 0 };
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  let expected = 0;
  for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) expected++;
  }
  const counts = { twse: 0, tpex: 0, combined: 0 };
  const dates = new Set();
  (history || []).forEach(row => {
    if (!row?.date || row.date < start.toISOString().slice(0, 10) || row.date > endDate || dates.has(row.date)) return;
    dates.add(row.date);
    const valid = key => {
      const item = row[key];
      const flow = item?.[category];
      return item?.date === row.date && flow && [flow.buy, flow.sell, flow.net].every(value => value != null && Number.isFinite(Number(value)));
    };
    const twse = valid('twse');
    const tpex = valid('tpex');
    if (twse) counts.twse++;
    if (tpex) counts.tpex++;
    if (twse && tpex) counts.combined++;
  });
  const minimum = Math.max(2, Math.ceil(expected * 0.75));
  return { ...counts, expected, complete: (counts[market] || 0) >= minimum };
};

export const parseTwseMarginTrend = payload => {
  if (payload?.stat !== 'OK' || !Array.isArray(payload?.data)) return [];
  return payload.data.flatMap((item, index, rows) => {
    const raw = String(item?.date || '');
    const balance = Number(item?.marginAmt) * 1000;
    const previous = Number(rows[index - 1]?.marginAmt) * 1000;
    if (!/^\d{8}$/.test(raw) || !Number.isFinite(balance) || balance <= 0) return [];
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    return [{ date, balance, previous: Number.isFinite(previous) && previous > 0 ? previous : null, change: Number.isFinite(previous) && previous > 0 ? balance - previous : null }];
  });
};

export const parseTpexMarginTrend = payload => {
  if (String(payload?.stat).toLowerCase() !== 'ok' || !Array.isArray(payload?.trend)) return [];
  return payload.trend.flatMap((item, index, rows) => {
    const raw = String(item?.date || '');
    const balance = Number(item?.marginBalance) * 1e8;
    const previous = Number(rows[index - 1]?.marginBalance) * 1e8;
    if (!/^\d{8}$/.test(raw) || !Number.isFinite(balance) || balance <= 0) return [];
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    return [{ date, balance, previous: Number.isFinite(previous) && previous > 0 ? previous : null, change: Number.isFinite(previous) && previous > 0 ? balance - previous : null }];
  });
};

const fetchTaiwanMarketFlow = async () => {
  try {
    const { supabase } = await import('../lib/supabase');
    const { data, error } = await supabase.functions.invoke('market-overview', { body: { action: 'tw-market-flow' } });
    if (error) throw error;
    if (data?.twse?.institutional && data?.tpex?.institutional) return data;
  } catch { /* Native fallback while the Edge Function is not yet deployed. */ }

  const urls = Object.values(TAIWAN_FLOW_URLS);
  const responses = await Promise.allSettled(urls.map(async url => JSON.parse(await requestText(url, '台股資金'))));
  return parseTaiwanMarketFlowPayloads(responses.map(result => result.status === 'fulfilled' ? result.value : null));
};

let marginHistoryEdgeSupported = true;

export const fetchTaiwanMarginHistoryCacheRange = async (startDate, endDate) => {
  const { supabase } = await import('../lib/supabase');
  const { data, error } = await supabase.functions.invoke('market-overview', {
    body: { action: 'tw-margin-history-cache-range', startDate, endDate },
  });
  if (error) throw error;
  return data?.cacheAvailable && Array.isArray(data?.history)
    ? data
    : { startDate, endDate, history: [], cacheAvailable: false };
};

export const readCachedTaiwanMarginHistoryPages = async endDates => {
  const dates = [...new Set(endDates)];
  const result = new Map(dates.flatMap(endDate => {
    const cached = twMarginHistoryMemoryCache.get(endDate);
    return cached ? [[endDate, cached]] : [];
  }));
  if (dates.every(endDate => result.has(endDate))) return result;
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(TW_MARGIN_HISTORY_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    for (const endDate of dates) {
      if (result.has(endDate)) continue;
      const entry = cache?.[endDate];
      if (entry?.data?.windowDays !== 31 || !Array.isArray(entry?.data?.history)) continue;
      const cached = { data: entry.data, cachedAt: Number(entry.cachedAt) || 0 };
      result.set(endDate, cached);
      twMarginHistoryMemoryCache.set(endDate, cached);
    }
  } catch {
    // The on-device cache is optional; callers can still fetch from the Edge Function.
  }
  return result;
};

export const cacheTaiwanMarginHistoryPages = async pageEntries => {
  const cachedAt = Date.now();
  const entries = [...(pageEntries || [])].map(([endDate, data]) => [endDate, { data, cachedAt }]);
  if (!entries.length) return;
  entries.forEach(([endDate, entry]) => twMarginHistoryMemoryCache.set(endDate, entry));
  twMarginHistoryCacheWriteQueue = twMarginHistoryCacheWriteQueue.then(async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(TW_MARGIN_HISTORY_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    entries.forEach(([endDate, entry]) => { cache[endDate] = entry; });
    const retained = Object.entries(cache)
      .sort((left, right) => Number(right[1]?.cachedAt || 0) - Number(left[1]?.cachedAt || 0))
      .slice(0, TW_MARGIN_HISTORY_CACHE_MAX_PAGES);
    await AsyncStorage.setItem(TW_MARGIN_HISTORY_CACHE_KEY, JSON.stringify(Object.fromEntries(retained)));
  }).catch(() => {});
  await twMarginHistoryCacheWriteQueue;
};

export const cacheTaiwanMarginHistory = async (endDate, data) => cacheTaiwanMarginHistoryPages([[endDate, data]]);

export const clearCachedTaiwanMarginHistory = async () => {
  twMarginHistoryMemoryCache.clear();
  twMarginHistoryCacheWriteQueue = twMarginHistoryCacheWriteQueue.then(async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.removeItem(TW_MARGIN_HISTORY_CACHE_KEY);
  }).catch(() => {});
  await twMarginHistoryCacheWriteQueue;
};

export const fetchTaiwanMarginHistory = async endDate => {
  const requestStartedAt = Date.now();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || '')) || Number.isNaN(Date.parse(`${endDate}T00:00:00Z`))) {
    throw new Error('融資圖表日期不正確');
  }
  if (marginHistoryEdgeSupported) {
    try {
      const { supabase } = await import('../lib/supabase');
      const { data, error } = await supabase.functions.invoke('market-overview', { body: { action: 'tw-margin-history', endDate } });
      if (error) throw error;
      if (data?.windowDays === 31 && Array.isArray(data?.history) && marginHistoryCoverage(data.history, endDate).complete) {
        const result = await attachTaiexHistory(data);
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('[market-overview] margin page fetched', { endDate, elapsedMs: Date.now() - requestStartedAt, path: 'edge' });
        return result;
      }
      if (data?.windowDays !== 31) marginHistoryEdgeSupported = false;
    } catch { /* Use official batch reports when the Edge action is unavailable. */ }
  }

  const end = new Date(`${endDate}T00:00:00Z`);
  const rocEnd = `${Number(endDate.slice(0, 4)) - 1911}/${endDate.slice(5, 7)}/${endDate.slice(8, 10)}`;
  const trendResponses = await Promise.allSettled([
    requestText(`${TWSE_MARGIN_TREND_URL}&date=${endDate.replace(/-/g, '')}&days=35`, '上市融資趨勢').then(JSON.parse),
    requestText(`${TPEX_MARGIN_TREND_URL}&date=${encodeURIComponent(rocEnd)}&days=35`, '上櫃融資趨勢').then(JSON.parse),
  ]);
  const twseTrend = parseTwseMarginTrend(trendResponses[0].status === 'fulfilled' ? trendResponses[0].value : null);
  const tpexTrend = parseTpexMarginTrend(trendResponses[1].status === 'fulfilled' ? trendResponses[1].value : null);
  if (twseTrend.length >= 12) {
    const windowStart = new Date(end);
    windowStart.setUTCDate(windowStart.getUTCDate() - 30);
    const windowStartDate = windowStart.toISOString().slice(0, 10);
    const windowRows = twseTrend.filter(row => row.date >= windowStartDate && row.date <= endDate);
    const tpexByDate = new Map(tpexTrend.map(row => [row.date, row]));
    const missingTpex = windowRows.filter(row => !tpexByDate.has(row.date));
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(2, missingTpex.length) }, async () => {
      while (cursor < missingTpex.length) {
        const date = missingTpex[cursor++].date;
        const rocDate = `${Number(date.slice(0, 4)) - 1911}/${date.slice(5, 7)}/${date.slice(8, 10)}`;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const payload = JSON.parse(await requestText(`${TAIWAN_FLOW_URLS.tpexMargin}&d=${encodeURIComponent(rocDate)}`, '上櫃融資歷史'));
            const parsed = parseTaiwanMarketFlowPayloads([null, null, payload, null]).tpex.margin;
            if (parsed?.date === date) { tpexByDate.set(date, parsed); break; }
          } catch { /* Retry transient provider failures, then keep the date missing. */ }
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
        }
        await new Promise(resolve => setTimeout(resolve, 220));
      }
    }));
    const history = windowRows.map(twse => {
      const tpex = tpexByDate.get(twse.date) || null;
      return {
        date: twse.date, twse, tpex,
        combined: tpex ? {
          date: twse.date, balance: twse.balance + tpex.balance,
          previous: twse.previous != null && tpex.previous != null ? twse.previous + tpex.previous : null,
          change: twse.change != null && tpex.change != null ? twse.change + tpex.change : null,
        } : null,
      };
    });
    if (marginHistoryCoverage(history, endDate).complete) {
      const result = await attachTaiexHistory({ asOf: history.at(-1)?.date, history, windowDays: 31, basis: '官方逐日餘額較前一交易日增減', sources: [TWSE_MARGIN_TREND_URL, TPEX_MARGIN_TREND_URL] });
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('[market-overview] margin page fetched', { endDate, elapsedMs: Date.now() - requestStartedAt, path: 'trend-fallback' });
      return result;
    }
    throw new Error('這段期間的融資資料不完整，請稍後重試');
  }
  const dates = Array.from({ length: 31 }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - (30 - index));
    return day;
  }).filter(day => day.getUTCDay() !== 0 && day.getUTCDay() !== 6);
  const rows = new Array(dates.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, dates.length) }, async () => {
    while (cursor < dates.length) {
      const index = cursor++;
      const date = dates[index].toISOString().slice(0, 10);
      const rocDate = `${Number(date.slice(0, 4)) - 1911}/${date.slice(5, 7)}/${date.slice(8, 10)}`;
      const urls = [
        `${TAIWAN_FLOW_URLS.twseMargin}&date=${date.replace(/-/g, '')}`,
        `${TAIWAN_FLOW_URLS.tpexMargin}&d=${encodeURIComponent(rocDate)}`,
      ];
      const responses = await Promise.allSettled(urls.map(async url => JSON.parse(await requestText(url, '融資歷史'))));
      try {
        const parsed = parseTaiwanMarketFlowPayloads([
          responses[0].status === 'fulfilled' ? responses[0].value : null,
          null,
          responses[1].status === 'fulfilled' ? responses[1].value : null,
          null,
        ]);
        rows[index] = {
          date,
          twse: parsed.twse.margin?.date === date ? parsed.twse.margin : null,
          tpex: parsed.tpex.margin?.date === date ? parsed.tpex.margin : null,
        };
      } catch { rows[index] = { date, twse: null, tpex: null }; }
    }
  }));
  const history = rows.filter(row => row.twse || row.tpex).map(row => ({
    ...row,
    combined: row.twse && row.tpex
      ? {
          date: row.date,
          balance: row.twse.balance + row.tpex.balance,
          previous: row.twse.previous + row.tpex.previous,
          change: row.twse.change + row.tpex.change,
        }
      : null,
  }));
  if (!marginHistoryCoverage(history, endDate).complete) throw new Error('這段期間的融資資料不完整，請稍後重試');
  const result = await attachTaiexHistory({ asOf: history.at(-1)?.date, history, windowDays: 31, basis: '各交易日報表的今日餘額減前日餘額' });
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('[market-overview] margin page fetched', { endDate, elapsedMs: Date.now() - requestStartedAt, path: 'client-fallback' });
  return result;
};

export const fetchTaiwanForeignHistory = async (endDate, category = 'foreign', market = 'combined') => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || '')) || Number.isNaN(Date.parse(`${endDate}T00:00:00Z`))) {
    throw new Error('外資圖表日期不正確');
  }
  let edgeHistory = [];
  try {
    const { supabase } = await import('../lib/supabase');
    const { data, error } = await supabase.functions.invoke('market-overview', { body: { action: 'tw-foreign-history', endDate } });
    if (error) throw error;
    if (data?.windowDays === 31 && Array.isArray(data?.history)) {
      edgeHistory = data.history;
      if (foreignHistoryCoverage(edgeHistory, endDate, category, market).complete) return attachInstitutionalIndex(data);
    }
  } catch { /* Use official daily reports when the Edge action is unavailable. */ }

  const end = new Date(`${endDate}T00:00:00Z`);
  const dates = Array.from({ length: 31 }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - (30 - index));
    return day;
  }).filter(day => day.getUTCDay() !== 0 && day.getUTCDay() !== 6);
  const rows = new Array(dates.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(2, dates.length) }, async () => {
    while (cursor < dates.length) {
      const index = cursor++;
      const date = dates[index].toISOString().slice(0, 10);
      const rocDate = `${Number(date.slice(0, 4)) - 1911}/${date.slice(5, 7)}/${date.slice(8, 10)}`;
      const responses = await Promise.allSettled([
        requestText(`${TAIWAN_FLOW_URLS.twseForeign}&dayDate=${date.replace(/-/g, '')}`, '上市外資歷史').then(JSON.parse),
        requestText(`${TAIWAN_FLOW_URLS.tpexForeign}?date=${encodeURIComponent(rocDate)}`, '上櫃外資歷史').then(JSON.parse),
      ]);
      try {
        const parsed = parseTaiwanMarketFlowPayloads([
          null, responses[0].status === 'fulfilled' ? responses[0].value : null,
          null, responses[1].status === 'fulfilled' ? responses[1].value : null,
        ]);
        rows[index] = {
          date,
          twse: parsed.twse.institutional?.date === date ? parsed.twse.institutional : null,
          tpex: parsed.tpex.institutional?.date === date ? parsed.tpex.institutional : null,
        };
      } catch { rows[index] = { date, twse: null, tpex: null }; }
    }
  }));
  const history = mergeInstitutionalHistoryRows([...edgeHistory, ...rows]);
  if (!history.length) throw new Error('這段期間沒有可用的法人資料，請稍後重試');
  return attachInstitutionalIndex({ asOf: history.at(-1)?.date, history, windowDays: 31, sources: [TAIWAN_FLOW_URLS.twseForeign, TAIWAN_FLOW_URLS.tpexForeign] });
};

export const parseTwseTaiexHistory = payload => {
  if (payload?.stat !== 'OK' || !Array.isArray(payload?.data)) return [];
  const closeIndex = payload.fields?.indexOf('收盤指數');
  if (closeIndex == null || closeIndex < 0) return [];
  return payload.data.flatMap(row => {
    const match = String(row?.[0] || '').match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
    const close = Number(String(row?.[closeIndex] || '').replace(/,/g, ''));
    if (!match || !Number.isFinite(close) || close <= 0) return [];
    const date = `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
    return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? [] : [{ date, close }];
  });
};

export const parseTwseTaiexCandles = payload => {
  if (payload?.stat !== 'OK' || !Array.isArray(payload?.data)) return [];
  const fields = ['開盤指數', '最高指數', '最低指數', '收盤指數'];
  const indices = fields.map(field => payload.fields?.indexOf(field) ?? -1);
  if (indices.some(index => index < 0)) return [];
  return payload.data.flatMap(row => {
    const match = String(row?.[0] || '').match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
    if (!match) return [];
    const [open, high, low, close] = indices.map(index => Number(String(row?.[index] || '').replace(/,/g, '')));
    if (![open, high, low, close].every(value => Number.isFinite(value) && value > 0)
      || high < Math.max(open, close) || low > Math.min(open, close)) return [];
    const date = `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
    return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? [] : [{ date, open, high, low, close }];
  });
};

export const withDailyMovingAverages = candles => {
  const ordered = [...(candles || [])].sort((a, b) => String(a.date || a.time).localeCompare(String(b.date || b.time)));
  const running = { 20: 0, 60: 0 };
  return ordered.map((candle, index) => {
    const close = Number(candle.close);
    for (const window of [20, 60]) {
      running[window] += close;
      if (index >= window) running[window] -= Number(ordered[index - window].close);
    }
    return { ...candle, ma20: index >= 19 ? running[20] / 20 : null, ma60: index >= 59 ? running[60] / 60 : null };
  });
};

const taiexCandleCache = new Map();
export const fetchTwseTaiexCandles = async (startDate, endDate) => {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) throw new Error('加權指數圖表日期不正確');
  start.setUTCDate(start.getUTCDate() - 125);
  const months = [];
  for (let date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); date <= end; date.setUTCMonth(date.getUTCMonth() + 1)) {
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const results = new Array(months.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, months.length) }, async () => {
    while (cursor < months.length) {
      const index = cursor++;
      const month = months[index];
      const cached = taiexCandleCache.get(month);
      if (cached && Date.now() - cached.at < 15 * 60_000) { results[index] = cached.rows; continue; }
      const payload = JSON.parse(await requestText(`${TAIEX_HISTORY_URL}&date=${month.replace('-', '')}01`, '加權指數日 K'));
      const rows = parseTwseTaiexCandles(payload).filter(row => row.date.slice(0, 7) === month);
      if (!rows.length) throw new Error(`${month} 加權指數日 K 資料暫缺`);
      taiexCandleCache.set(month, { rows, at: Date.now() });
      results[index] = rows;
    }
  }));
  const candles = [...new Map(results.flat().filter(row => row.date <= endDate).map(row => [row.date, row])).values()];
  return withDailyMovingAverages(candles);
};

export const parseTwseIihMarketIndex = payload => {
  const dates = payload?.taiex?.categories;
  const values = payload?.taiex?.series?.[0]?.data;
  if (!Array.isArray(dates) || !Array.isArray(values)) return [];
  return dates.flatMap((raw, index) => {
    const date = String(raw || '').replace(/\//g, '-');
    const close = Number(values[index]);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0 ? [{ date, close }] : [];
  });
};

export const parseTwseMarketMaintenanceHistory = payload => {
  if (payload?.stat !== 'OK' || !Array.isArray(payload?.data)) return [];
  return payload.data.flatMap(row => {
    const raw = String(row?.date || '');
    const rate = Number(row?.keepRate);
    if (!/^\d{8}$/.test(raw) || !Number.isFinite(rate) || rate <= 0) return [];
    return [{ date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, rate }];
  });
};

const attachInstitutionalIndex = async result => {
  if (!result?.history?.length) return result;
  const first = result.history[0].date;
  const last = result.history.at(-1).date;
  let closes = new Map();
  try {
    const payload = JSON.parse(await requestText(`${TWSE_MARGIN_INDEX_URL}?start=${first.replace(/-/g, '')}&end=${last.replace(/-/g, '')}`, '加權指數歷史'));
    closes = new Map(parseTwseIihMarketIndex(payload).map(point => [point.date, point.close]));
  } catch { /* Fall through to monthly official reports. */ }
  if (result.history.some(row => row.twse && !closes.has(row.date))) {
    const months = [...new Set(result.history.map(row => `${row.date.slice(0, 7)}-01`))];
    const responses = await Promise.allSettled(months.map(async month => parseTwseTaiexHistory(JSON.parse(await requestText(`${TAIEX_HISTORY_URL}&date=${month.replace(/-/g, '')}`, '加權指數歷史')))));
    responses.forEach(response => { if (response.status === 'fulfilled') response.value.forEach(point => closes.set(point.date, point.close)); });
  }
  const months = [...new Set(result.history.map(row => row.date.slice(0, 7)))];
  const tpexResponses = await Promise.allSettled(months.map(async month => {
    const rocMonth = `${Number(month.slice(0, 4)) - 1911}/${month.slice(5, 7)}`;
    return parseTpexIndexHistory(JSON.parse(await requestText(`${TPEX_INDEX_HISTORY_URL}&date=${encodeURIComponent(rocMonth)}`, '櫃買指數歷史')));
  }));
  const tpexCloses = new Map(tpexResponses.flatMap(response => response.status === 'fulfilled' ? response.value : []).map(point => [point.time, point.close]));
  return {
    ...result,
    history: result.history.map(row => ({ ...row, taiexClose: closes.get(row.date) ?? null, tpexClose: tpexCloses.get(row.date) ?? null })),
    indexSource: TWSE_MARGIN_INDEX_URL, tpexIndexSource: TPEX_INDEX_HISTORY_URL,
  };
};

const attachTaiexHistory = async result => {
  const endDate = result.history.at(-1)?.date;
  if (!endDate) return result;
  const needIndex = !result.indexSource || result.history.some(row => row.twse && !(Number(row.taiexClose) > 0));
  const needMaintenance = !result.maintenanceSource || !result.history.some(row => Number(row.maintenanceRate) > 0);
  if (!needIndex && !needMaintenance) return result;
  const months = [...new Set(result.history.map(row => `${row.date.slice(0, 7)}-01`))];
  const [indexResponses, maintenanceResponse] = await Promise.all([
    needIndex ? Promise.allSettled([requestText(`${TWSE_MARGIN_INDEX_URL}?start=${result.history[0].date.replace(/-/g, '')}&end=${endDate.replace(/-/g, '')}`, '加權指數歷史')
      .then(text => parseTwseIihMarketIndex(JSON.parse(text)))]) : Promise.resolve([]),
    needMaintenance ? requestText(`${MARKET_MAINTENANCE_URL}&date=${endDate.replace(/-/g, '')}&days=35`, '全市場擔保維持率')
      .then(text => parseTwseMarketMaintenanceHistory(JSON.parse(text))).catch(() => []) : Promise.resolve([]),
  ]);
  const closes = new Map(indexResponses.flatMap(response => response.status === 'fulfilled' ? response.value : []).map(point => [point.date, point.close]));
  if (needIndex && result.history.some(row => row.twse && !closes.has(row.date))) {
    const monthly = await Promise.allSettled(months.map(async month => {
      const url = `${TAIEX_HISTORY_URL}&date=${month.replace(/-/g, '')}`;
      return parseTwseTaiexHistory(JSON.parse(await requestText(url, '加權指數歷史')));
    }));
    monthly.forEach(response => {
      if (response.status === 'fulfilled') response.value.forEach(point => closes.set(point.date, point.close));
    });
  }
  const rates = new Map(maintenanceResponse.map(point => [point.date, point.rate]));
  return {
    ...result,
    history: result.history.map(row => ({
      ...row,
      taiexClose: Number(row.taiexClose) > 0 ? row.taiexClose : closes.get(row.date) ?? null,
      maintenanceRate: Number(row.maintenanceRate) > 0 ? row.maintenanceRate : rates.get(row.date) ?? null,
    })),
    indexSource: needIndex ? closes.size ? TWSE_MARGIN_INDEX_URL : TAIEX_HISTORY_URL : result.indexSource,
    maintenanceSource: MARKET_MAINTENANCE_URL,
  };
};

export const fetchMarketOverview = async ({ forceRefresh = false } = {}) => {
  const cachedPulseComplete = memoryCache?.data?.pulse?.length === MARKET_PULSE_ITEMS.length
    && memoryCache.data.pulse.every(item => Number(item?.quote?.price) > 0 && !item.quote.is_stale);
  if (!forceRefresh && cachedPulseComplete && memoryCache && Object.prototype.hasOwnProperty.call(memoryCache.data, 'cpi') && memoryCache.data.errors.length === 0 && Date.now() - memoryCache.cachedAt < CACHE_TTL_MS) return memoryCache.data;
  const fallbackPulse = memoryCache?.data?.pulse || [];

  const [pulseResult, sp500Result, peResult, cpiResult, taiwanFlowResult, ...yieldResults] = await Promise.allSettled([
    fetchMarketPulse(forceRefresh, fallbackPulse),
    fetchFredSeries('SP500'),
    fetchSp500Pe(),
    fetchFredSeries(CPI_SERIES_ID),
    fetchTaiwanMarketFlow(),
    ...TREASURY_SERIES.map(series => fetchFredSeries(series.id)),
  ]);

  const errors = [];
  if (pulseResult.status === 'rejected') errors.push(`市場動態：${pulseResult.reason?.message || '載入失敗'}`);
  if (sp500Result.status === 'rejected') errors.push(`標普 500：${sp500Result.reason?.message || '載入失敗'}`);
  if (peResult.status === 'rejected') errors.push(`本益比：${peResult.reason?.message || '載入失敗'}`);
  if (cpiResult.status === 'rejected') errors.push(`美國 CPI：${cpiResult.reason?.message || '載入失敗'}`);
  if (taiwanFlowResult.status === 'rejected') errors.push(`台股資金：${taiwanFlowResult.reason?.message || '載入失敗'}`);
  yieldResults.forEach((result, index) => {
    if (result.status === 'rejected') errors.push(`${TREASURY_SERIES[index].label}美債：${result.reason?.message || '載入失敗'}`);
  });

  const yields = TREASURY_SERIES.map((series, index) => ({
    ...series,
    ...settledValue(yieldResults[index]),
  })).filter(item => Number.isFinite(item.value));
  const twoYear = yields.find(item => item.tenor === '2Y')?.value;
  const tenYear = yields.find(item => item.tenor === '10Y')?.value;
  const spread10y2y = Number.isFinite(twoYear) && Number.isFinite(tenYear) ? tenYear - twoYear : null;
  const cpiSeries = settledValue(cpiResult);
  const cpiYearOverYear = calculateYearOverYear(cpiSeries?.history);
  const cpi = cpiSeries ? {
    ...cpiSeries,
    yoy: cpiYearOverYear?.value ?? null,
    previousAsOf: cpiYearOverYear?.previousAsOf || null,
  } : null;

  const data = {
    fetchedAt: new Date().toISOString(),
    pulse: settledValue(pulseResult) || mergeMarketPulseQuotes(MARKET_PULSE_ITEMS, {}, fallbackPulse),
    sp500: settledValue(sp500Result),
    pe: settledValue(peResult),
    cpi,
    taiwanFlow: settledValue(taiwanFlowResult),
    yields,
    spread10y2y,
    errors,
    sources: {
      fred: 'https://fred.stlouisfed.org/',
      cpi: CPI_SOURCE_URL,
      cpiRelease: CPI_RELEASE_URL,
      pe: SP500_PE_URL,
    },
  };
  memoryCache = { cachedAt: Date.now(), data };
  return data;
};

export { TREASURY_SERIES };
