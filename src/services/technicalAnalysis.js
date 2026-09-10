const FINMIND_BASE_URL = 'https://api.finmindtrade.com/api/v4';
const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map();

const finite = value => Number.isFinite(Number(value));
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function ema(values, period) {
  const multiplier = 2 / (period + 1);
  const result = [];
  let previous = values[0] || 0;
  values.forEach((value, index) => {
    previous = index === 0 ? value : (value * multiplier) + (previous * (1 - multiplier));
    result.push(previous);
  });
  return result;
}

function movingAverage(values, period) {
  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= period) sum -= values[index - period];
    return index >= period - 1 ? sum / period : null;
  });
}

function relativeStrengthIndex(values, period = 14) {
  const result = new Array(values.length).fill(null);
  if (values.length <= period) return result;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  result[period] = averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss));
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = ((averageGain * (period - 1)) + Math.max(change, 0)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-change, 0)) / period;
    result[index] = averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss));
  }
  return result;
}

function pivotIndexes(values, type, radius = 3) {
  const indexes = [];
  for (let index = radius; index < values.length - radius; index += 1) {
    const window = values.slice(index - radius, index + radius + 1);
    const target = values[index];
    const extreme = type === 'low' ? Math.min(...window) : Math.max(...window);
    if (target === extreme && window.filter(value => value === target).length === 1) indexes.push(index);
  }
  return indexes;
}

function averageTrueRange(rows, period = 14) {
  const ranges = rows.map((row, index) => {
    if (!index) return row.high - row.low;
    const previousClose = rows[index - 1].close;
    return Math.max(row.high - row.low, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose));
  });
  return average(ranges.slice(-period));
}

function clusterLevels(rows, indexes, field, latestClose, atr) {
  const tolerance = Math.max(latestClose * 0.012, atr * 0.8);
  const clusters = [];
  indexes.slice(-30).forEach(index => {
    const price = rows[index][field];
    let cluster = clusters.find(item => Math.abs(item.price - price) <= tolerance);
    if (!cluster) {
      cluster = { price, touches: 0, lastIndex: index };
      clusters.push(cluster);
    }
    cluster.price = ((cluster.price * cluster.touches) + price) / (cluster.touches + 1);
    cluster.touches += 1;
    cluster.lastIndex = Math.max(cluster.lastIndex, index);
  });
  return clusters
    .filter(item => item.touches >= 2)
    .map(item => ({
      price: item.price,
      lower: item.price - tolerance / 2,
      upper: item.price + tolerance / 2,
      touches: item.touches,
      lastDate: rows[item.lastIndex]?.time,
    }));
}

function volumeRatioAt(rows, index) {
  const baseline = average(rows.slice(Math.max(0, index - 20), index).map(item => item.volume));
  return baseline > 0 ? rows[index].volume / baseline : 0;
}

function confirmationChecks(row, type, neckline, volumeRatio) {
  const bullish = type === 'bullish';
  return {
    structure: bullish ? row.close > neckline * 1.001 : row.close < neckline * 0.999,
    momentum: bullish
      ? row.macd > row.macdSignal && row.macdHistogram > 0
      : row.macd < row.macdSignal && row.macdHistogram < 0,
    trend: row.ma20 != null && (bullish ? row.close > row.ma20 : row.close < row.ma20),
    volume: volumeRatio >= 1.2,
    volumeRatio,
  };
}

function resolveDivergence(rows, candidate) {
  const { type, currentIndex, neckline } = candidate;
  const bullish = type === 'bullish';
  const detectedIndex = Math.min(rows.length - 1, currentIndex + 3);
  const expiryIndex = Math.min(rows.length - 1, currentIndex + 40);
  let status = 'pending';
  let confirmationTime = null;
  let confirmationIndex = null;
  let invalidationTime = null;
  let checks = confirmationChecks(rows.at(-1), type, neckline, volumeRatioAt(rows, rows.length - 1));

  for (let index = currentIndex + 1; index <= expiryIndex; index += 1) {
    const row = rows[index];
    const invalidated = bullish
      ? row.low < candidate.price * 0.995
      : row.high > candidate.price * 1.005;
    if (invalidated) {
      status = 'invalidated';
      invalidationTime = row.time;
      checks = confirmationChecks(row, type, neckline, volumeRatioAt(rows, index));
      break;
    }
    const rowChecks = confirmationChecks(row, type, neckline, volumeRatioAt(rows, index));
    if (index >= detectedIndex && rowChecks.structure && rowChecks.momentum && rowChecks.trend) {
      status = 'confirmed';
      confirmationTime = row.time;
      confirmationIndex = index;
      checks = rowChecks;
      break;
    }
  }

  if (status === 'pending' && rows.length - 1 > currentIndex + 40) {
    status = 'expired';
    checks = confirmationChecks(rows[expiryIndex], type, neckline, volumeRatioAt(rows, expiryIndex));
  }
  if (status === 'confirmed') {
    const activeUntilIndex = Math.min(rows.length - 1, confirmationIndex + 20);
    for (let index = confirmationIndex + 1; index <= activeUntilIndex; index += 1) {
      const lostConfirmation = bullish
        ? rows[index].close < neckline * 0.995
        : rows[index].close > neckline * 1.005;
      if (lostConfirmation) {
        status = 'invalidated';
        invalidationTime = rows[index].time;
        break;
      }
    }
    if (status === 'confirmed' && rows.length - 1 > confirmationIndex + 20) status = 'stale';
  }
  return {
    ...candidate,
    status,
    confirmationTime,
    invalidationTime,
    detectedAt: rows[detectedIndex]?.time,
    expiresAt: rows[status === 'confirmed' || status === 'stale' ? Math.min(rows.length - 1, (confirmationIndex || currentIndex) + 20) : expiryIndex]?.time,
    checks,
    confirmationScore: ['structure', 'momentum', 'trend', 'volume'].filter(key => checks[key]).length,
  };
}

function findDivergences(rows) {
  const lows = pivotIndexes(rows.map(row => row.low), 'low', 3).filter(index => index >= rows.length - 140);
  const highs = pivotIndexes(rows.map(row => row.high), 'high', 3).filter(index => index >= rows.length - 140);
  const divergences = [];
  const compare = (indexes, type) => {
    for (let cursor = 1; cursor < indexes.length; cursor += 1) {
      const previous = indexes[cursor - 1];
      const current = indexes[cursor];
      if (current - previous < 5 || !finite(rows[previous].macd) || !finite(rows[current].macd)) continue;
      if (type === 'bullish' && rows[current].low < rows[previous].low * 0.995 && rows[current].macd > rows[previous].macd) {
        const neckline = Math.max(...rows.slice(previous, current + 1).map(row => row.high));
        divergences.push(resolveDivergence(rows, { type, time: rows[current].time, price: rows[current].low, previousTime: rows[previous].time, previousPrice: rows[previous].low, previousMacd: rows[previous].macd, macd: rows[current].macd, neckline, currentIndex: current }));
      }
      if (type === 'bearish' && rows[current].high > rows[previous].high * 1.005 && rows[current].macd < rows[previous].macd) {
        const neckline = Math.min(...rows.slice(previous, current + 1).map(row => row.low));
        divergences.push(resolveDivergence(rows, { type, time: rows[current].time, price: rows[current].high, previousTime: rows[previous].time, previousPrice: rows[previous].high, previousMacd: rows[previous].macd, macd: rows[current].macd, neckline, currentIndex: current }));
      }
    }
  };
  compare(lows, 'bullish');
  compare(highs, 'bearish');
  return divergences.sort((a, b) => a.time.localeCompare(b.time)).slice(-4);
}

function evaluateStrategies(rows, supports, resistances, divergences) {
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const volumeRatio = volumeRatioAt(rows, rows.length - 1);
  const fmt = value => Number(value).toFixed(2);
  const strategy = (key, label, status, direction, reason, details = {}) => ({ key, label, status, direction, reason, ...details });

  const activeDivergence = divergences.filter(item => item.status === 'confirmed' || item.status === 'pending').at(-1);
  const historicalDivergence = divergences.at(-1);
  const divergence = activeDivergence
    ? strategy('divergence', 'MACD 背離', activeDivergence.status === 'confirmed' ? 'confirmed' : 'watch', activeDivergence.type, activeDivergence.status === 'confirmed'
      ? `${activeDivergence.type === 'bullish' ? '偏多' : '偏空'}背離已通過確認線、MACD 與 MA20。`
      : `${activeDivergence.type === 'bullish' ? '偏多' : '偏空'}背離已形成，仍在等待必要確認。`, { signal: activeDivergence })
    : strategy('divergence', 'MACD 背離', 'none', 'neutral', historicalDivergence
      ? `最近背離已${historicalDivergence.status === 'invalidated' ? '失效' : historicalDivergence.status === 'expired' ? '逾期' : '過期'}，尚未形成新候選。`
      : '最近 140 個交易日尚未形成價格與 MACD 背離。');

  const uptrend = latest.ma20 != null && latest.ma60 != null && latest.ma20 > latest.ma60 && latest.close > latest.ma60;
  const downtrend = latest.ma20 != null && latest.ma60 != null && latest.ma20 < latest.ma60 && latest.close < latest.ma60;
  const ma20Distance = latest.ma20 ? Math.abs(latest.close - latest.ma20) / latest.ma20 : Infinity;
  const bullishPullback = uptrend && latest.low <= latest.ma20 * 1.015 && latest.close >= latest.ma20 && latest.close > previous.close;
  const bearishRejection = downtrend && latest.high >= latest.ma20 * 0.985 && latest.close <= latest.ma20 && latest.close < previous.close;
  let pullback;
  if (bullishPullback) pullback = strategy('pullback', '趨勢回檔', 'confirmed', 'bullish', `上升趨勢回測 MA20（${fmt(latest.ma20)}）後收回，且收盤轉強。`);
  else if (bearishRejection) pullback = strategy('pullback', '趨勢回檔', 'confirmed', 'bearish', `下降趨勢反彈至 MA20（${fmt(latest.ma20)}）後受阻，且收盤轉弱。`);
  else if ((uptrend || downtrend) && ma20Distance <= 0.03) pullback = strategy('pullback', '趨勢回檔', 'watch', uptrend ? 'bullish' : 'bearish', `${uptrend ? '上升' : '下降'}趨勢成立，距 MA20 ${Number(ma20Distance * 100).toFixed(1)}%，等待止跌／受阻 K 棒。`);
  else pullback = strategy('pullback', '趨勢回檔', 'none', 'neutral', uptrend || downtrend
    ? `${uptrend ? '上升' : '下降'}趨勢存在，但目前離 MA20 ${Number(ma20Distance * 100).toFixed(1)}%，不在回檔觀察區。`
    : 'MA20 與 MA60 尚未形成明確同向趨勢。');

  const priorRows = rows.slice(Math.max(0, rows.length - 21), -1);
  const breakoutHigh = Math.max(...priorRows.map(row => row.high));
  const breakdownLow = Math.min(...priorRows.map(row => row.low));
  let breakout;
  if (latest.close > breakoutHigh * 1.001 && volumeRatio >= 1.5) breakout = strategy('breakout', '放量突破', 'confirmed', 'bullish', `收盤突破 20 日高點 ${fmt(breakoutHigh)}，成交量為均量 ${volumeRatio.toFixed(1)} 倍。`, { level: breakoutHigh, volumeRatio });
  else if (latest.close < breakdownLow * 0.999 && volumeRatio >= 1.5) breakout = strategy('breakout', '放量突破', 'confirmed', 'bearish', `收盤跌破 20 日低點 ${fmt(breakdownLow)}，成交量為均量 ${volumeRatio.toFixed(1)} 倍。`, { level: breakdownLow, volumeRatio });
  else if (latest.close >= breakoutHigh * 0.98) breakout = strategy('breakout', '放量突破', 'watch', 'bullish', latest.close > breakoutHigh
    ? `已越過 20 日高點，但量能僅 ${volumeRatio.toFixed(1)} 倍，尚未達 1.5 倍。`
    : `距 20 日高點 ${fmt(breakoutHigh)} 不到 2%，等待收盤突破並放量。`, { level: breakoutHigh, volumeRatio });
  else if (latest.close <= breakdownLow * 1.02) breakout = strategy('breakout', '放量突破', 'watch', 'bearish', latest.close < breakdownLow
    ? `已跌破 20 日低點，但量能僅 ${volumeRatio.toFixed(1)} 倍，尚未達 1.5 倍。`
    : `距 20 日低點 ${fmt(breakdownLow)} 不到 2%，注意放量跌破風險。`, { level: breakdownLow, volumeRatio });
  else breakout = strategy('breakout', '放量突破', 'none', 'neutral', `收盤仍在 20 日區間 ${fmt(breakdownLow)}–${fmt(breakoutHigh)} 內。`, { level: null, volumeRatio });

  const nearestSupport = supports[0];
  const nearestResistance = resistances[0];
  const nearSupport = nearestSupport && latest.close >= nearestSupport.lower * 0.98 && latest.close <= nearestSupport.upper * 1.03;
  const nearResistance = nearestResistance && latest.close >= nearestResistance.lower * 0.97 && latest.close <= nearestResistance.upper * 1.02;
  const bullishRsiCross = previous.rsi != null && latest.rsi != null && previous.rsi < 30 && latest.rsi >= 30;
  const bearishRsiCross = previous.rsi != null && latest.rsi != null && previous.rsi > 70 && latest.rsi <= 70;
  let rsiReversal;
  if (bullishRsiCross && nearSupport) rsiReversal = strategy('rsi', 'RSI 支撐反轉', 'confirmed', 'bullish', `RSI 由超賣區站回 30，目前 ${latest.rsi.toFixed(1)}，且價格位於支撐區。`);
  else if (bearishRsiCross && nearResistance) rsiReversal = strategy('rsi', 'RSI 支撐反轉', 'confirmed', 'bearish', `RSI 由超買區跌回 70，目前 ${latest.rsi.toFixed(1)}，且價格位於壓力區。`);
  else if (latest.rsi <= 35 && nearSupport) rsiReversal = strategy('rsi', 'RSI 支撐反轉', 'watch', 'bullish', `RSI ${latest.rsi.toFixed(1)} 接近超賣，價格也接近支撐，等待 RSI 重新站回 30。`);
  else if (latest.rsi >= 65 && nearResistance) rsiReversal = strategy('rsi', 'RSI 支撐反轉', 'watch', 'bearish', `RSI ${latest.rsi.toFixed(1)} 接近超買，價格也接近壓力，等待 RSI 跌回 70。`);
  else rsiReversal = strategy('rsi', 'RSI 支撐反轉', 'none', 'neutral', `RSI 為 ${latest.rsi?.toFixed(1) || '—'}，且價格未同時滿足支撐／壓力反轉條件。`);

  const strategies = [divergence, pullback, breakout, rsiReversal];
  const confirmed = strategies.filter(item => item.status === 'confirmed');
  const watch = strategies.filter(item => item.status === 'watch');
  const bullish = strategies.filter(item => item.direction === 'bullish' && item.status !== 'none').length;
  const bearish = strategies.filter(item => item.direction === 'bearish' && item.status !== 'none').length;
  return { strategies, confirmedCount: confirmed.length, watchCount: watch.length, bullish, bearish };
}

export async function fetchTaiwanTechnicalData(symbol, days = 1095, forceRefresh = false) {
  const key = `${symbol}:${days}`;
  const hit = cache.get(key);
  if (!forceRefresh && hit && Date.now() - hit.timestamp < CACHE_TTL) return hit.data;
  const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const token = process.env.EXPO_PUBLIC_FINMIND_API_KEY || '';
  const response = await fetch(`${FINMIND_BASE_URL}/data?dataset=TaiwanStockPrice&data_id=${encodeURIComponent(symbol)}&start_date=${startDate}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status && payload.status !== 200) throw new Error(payload.msg || `FinMind HTTP ${response.status}`);
  const rows = (payload.data || [])
    .map(row => ({
      time: String(row.date),
      open: Number(row.open),
      high: Number(row.max),
      low: Number(row.min),
      close: Number(row.close),
      volume: Number(row.Trading_Volume || 0),
    }))
    .filter(row => row.time && row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0)
    .sort((a, b) => a.time.localeCompare(b.time));
  if (rows.length < 60) throw new Error('歷史資料不足 60 個交易日，暫時無法計算技術指標。');
  cache.set(key, { data: rows, timestamp: Date.now() });
  return rows;
}

async function fetchYahooTechnicalData(symbol, days = 1095, forceRefresh = false) {
  const key = `US:${symbol}:${days}`;
  const hit = cache.get(key);
  if (!forceRefresh && hit && Date.now() - hit.timestamp < CACHE_TTL) return hit.data;
  const period1 = Math.floor((Date.now() - days * 86400000) / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  let lastError = null;
  for (const host of ['query1', 'query2']) {
    try {
      const response = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.chart?.error) throw new Error(payload.chart?.error?.description || `Yahoo HTTP ${response.status}`);
      const result = payload.chart?.result?.[0];
      const quote = result?.indicators?.quote?.[0];
      const timestamps = result?.timestamp || [];
      const marketDate = result?.meta?.regularMarketTime
        ? new Date(result.meta.regularMarketTime * 1000).toISOString().slice(0, 10)
        : null;
      const rows = timestamps.map((timestamp, index) => {
        const time = new Date(timestamp * 1000).toISOString().slice(0, 10);
        const reportedClose = Number(quote?.close?.[index]);
        const latestPrice = Number(result?.meta?.regularMarketPrice);
        const close = reportedClose > 0
          ? reportedClose
          : (index === timestamps.length - 1 && time === marketDate && latestPrice > 0 ? latestPrice : 0);
        return {
          time,
          open: Number(quote?.open?.[index]),
          high: Number(quote?.high?.[index]),
          low: Number(quote?.low?.[index]),
          close,
          volume: Number(quote?.volume?.[index] || 0),
        };
      }).filter(row => row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0);
      if (rows.length < 60) throw new Error('美股歷史資料不足 60 個交易日。');
      cache.set(key, { data: rows, timestamp: Date.now() });
      return rows;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('無法取得美股歷史資料。');
}

async function fetchCryptoTechnicalData(symbol, days = 1095, forceRefresh = false) {
  const pair = String(symbol).toUpperCase().endsWith('USDT') ? String(symbol).toUpperCase() : `${String(symbol).toUpperCase()}USDT`;
  const key = `Crypto:${pair}:${days}`;
  const hit = cache.get(key);
  if (!forceRefresh && hit && Date.now() - hit.timestamp < CACHE_TTL) return hit.data;
  const limit = Math.min(1000, Math.max(60, days));
  const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=1d&limit=${limit}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload)) throw new Error(payload?.msg || `Binance HTTP ${response.status}`);
  const rows = payload.map(row => ({
    time: new Date(Number(row[0])).toISOString().slice(0, 10),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5] || 0),
  })).filter(row => row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0);
  if (rows.length < 60) throw new Error('加密貨幣歷史資料不足 60 日。');
  cache.set(key, { data: rows, timestamp: Date.now() });
  return rows;
}

export async function fetchMarketTechnicalData(symbol, marketType = 'TW', days = 1095, forceRefresh = false) {
  const market = String(marketType || '').toUpperCase();
  if (market === 'TW' || /^\d+$/.test(String(symbol))) return fetchTaiwanTechnicalData(symbol, days, forceRefresh);
  if (market === 'US') return fetchYahooTechnicalData(symbol, days, forceRefresh);
  if (market === 'CRYPTO') return fetchCryptoTechnicalData(symbol, days, forceRefresh);
  throw new Error(`目前尚未支援 ${marketType || '此市場'} 的 K 線資料。`);
}

export function analyzeTechnicalData(rawRows, displayCount = rawRows.length) {
  const closes = rawRows.map(row => row.close);
  const ma20Values = movingAverage(closes, 20);
  const ma60Values = movingAverage(closes, 60);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdValues = closes.map((_, index) => ema12[index] - ema26[index]);
  const signalValues = ema(macdValues, 9);
  const histogramValues = macdValues.map((value, index) => value - signalValues[index]);
  const rsiValues = relativeStrengthIndex(closes, 14);
  const enrichedAll = rawRows.map((row, index) => ({
    ...row,
    ma20: ma20Values[index],
    ma60: ma60Values[index],
    macd: macdValues[index],
    macdSignal: signalValues[index],
    macdHistogram: histogramValues[index],
    rsi: rsiValues[index],
  }));
  const enriched = enrichedAll.slice(-Math.min(displayCount, enrichedAll.length));
  const latest = enriched.at(-1);
  const atr = averageTrueRange(enriched);
  const lookback = enriched.slice(-260);
  const offset = enriched.length - lookback.length;
  const lowPivots = pivotIndexes(lookback.map(row => row.low), 'low').map(index => index + offset);
  const highPivots = pivotIndexes(lookback.map(row => row.high), 'high').map(index => index + offset);
  const supports = clusterLevels(enriched, lowPivots, 'low', latest.close, atr)
    .filter(level => level.price < latest.close)
    .sort((a, b) => b.price - a.price)
    .slice(0, 2);
  const resistances = clusterLevels(enriched, highPivots, 'high', latest.close, atr)
    .filter(level => level.price > latest.close)
    .sort((a, b) => a.price - b.price)
    .slice(0, 2);
  const volumeSpikes = enriched.map((row, index) => {
    const baseline = average(enriched.slice(Math.max(0, index - 20), index).map(item => item.volume));
    return baseline > 0 && row.volume >= baseline * 1.8 ? { time: row.time, volume: row.volume, ratio: row.volume / baseline, close: row.close } : null;
  }).filter(Boolean).slice(-10);
  const divergences = findDivergences(enriched);
  const strategySummary = evaluateStrategies(enriched, supports, resistances, divergences);
  return { rows: enriched, latest, supports, resistances, volumeSpikes, divergences, atr, ...strategySummary };
}

export function technicalAnalysisPrompt(name, symbol, analysis) {
  const fmt = value => Number(value).toFixed(2);
  const supports = analysis.supports.length ? analysis.supports.map(level => `${fmt(level.lower)}–${fmt(level.upper)}（${level.touches} 次測試）`).join('、') : '未形成足夠明確的支撐區';
  const resistances = analysis.resistances.length ? analysis.resistances.map(level => `${fmt(level.lower)}–${fmt(level.upper)}（${level.touches} 次測試）`).join('、') : '未形成足夠明確的壓力區';
  const spikes = analysis.volumeSpikes.length ? analysis.volumeSpikes.slice(-3).map(item => `${item.time} ${item.ratio.toFixed(1)} 倍`).join('、') : '近期無 1.8 倍以上爆量';
  const statusLabel = status => ({ confirmed: '已確認', pending: '等待確認', invalidated: '已失效', expired: '候選已逾期', stale: '確認已過期' }[status] || status);
  const divergences = analysis.divergences.length ? analysis.divergences.map(item => `${item.time} ${item.type === 'bullish' ? '看多' : '看空'}背離（${statusLabel(item.status)}，確認線 ${fmt(item.neckline)}${item.confirmationTime ? `，確認日 ${item.confirmationTime}` : ''}）`).join('、') : '近期未偵測到背離候選';
  const strategies = (analysis.strategies || []).map(item => `${item.label}：${item.status === 'confirmed' ? '已確認' : item.status === 'watch' ? '接近成立' : '未成立'}（${item.reason}）`).join('；');
  return `請解讀 ${name}（${symbol}）的技術圖。資料截至 ${analysis.latest.time}，收盤 ${fmt(analysis.latest.close)}，MA20 ${fmt(analysis.latest.ma20)}，MA60 ${fmt(analysis.latest.ma60)}，RSI14 ${fmt(analysis.latest.rsi)}。支撐區：${supports}。壓力區：${resistances}。爆量：${spikes}。MACD：${divergences}。策略判斷：${strategies}。請分成趨勢、關鍵價位、量價、動能、策略共識、風險與後續觀察；這些訊號只供研究，不要直接給買賣指令。`;
}
