const FINMIND_BASE_URL = 'https://api.finmindtrade.com/api/v4';
import { supabase } from '../lib/supabase';
const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map();

const finite = value => Number.isFinite(Number(value));
const present = value => value !== null && value !== undefined && finite(value);
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

function wilderAverage(values, period) {
  const result = new Array(values.length).fill(null);
  if (values.length <= period) return result;
  let sum = 0;
  for (let index = 1; index <= period; index += 1) sum += Number(values[index] || 0);
  result[period] = sum / period;
  for (let index = period + 1; index < values.length; index += 1) {
    result[index] = ((result[index - 1] * (period - 1)) + Number(values[index] || 0)) / period;
  }
  return result;
}

function atrSeries(rows, period = 14) {
  const ranges = rows.map((row, index) => index
    ? Math.max(row.high - row.low, Math.abs(row.high - rows[index - 1].close), Math.abs(row.low - rows[index - 1].close))
    : row.high - row.low);
  return wilderAverage(ranges, period);
}

function averageDirectionalIndex(rows, period = 14) {
  const trueRanges = new Array(rows.length).fill(0);
  const plusDm = new Array(rows.length).fill(0);
  const minusDm = new Array(rows.length).fill(0);
  for (let index = 1; index < rows.length; index += 1) {
    const up = rows[index].high - rows[index - 1].high;
    const down = rows[index - 1].low - rows[index].low;
    trueRanges[index] = Math.max(rows[index].high - rows[index].low, Math.abs(rows[index].high - rows[index - 1].close), Math.abs(rows[index].low - rows[index - 1].close));
    plusDm[index] = up > down && up > 0 ? up : 0;
    minusDm[index] = down > up && down > 0 ? down : 0;
  }
  const smoothedTr = wilderAverage(trueRanges, period);
  const smoothedPlus = wilderAverage(plusDm, period);
  const smoothedMinus = wilderAverage(minusDm, period);
  const dx = rows.map((_, index) => {
    if (!present(smoothedTr[index]) || !smoothedTr[index]) return null;
    const plus = (smoothedPlus[index] / smoothedTr[index]) * 100;
    const minus = (smoothedMinus[index] / smoothedTr[index]) * 100;
    return plus + minus ? (Math.abs(plus - minus) / (plus + minus)) * 100 : 0;
  });
  const adx = new Array(rows.length).fill(null);
  const first = period * 2 - 1;
  if (rows.length > first) {
    adx[first] = average(dx.slice(period, first + 1).filter(present));
    for (let index = first + 1; index < rows.length; index += 1) {
      adx[index] = present(dx[index]) ? ((adx[index - 1] * (period - 1)) + dx[index]) / period : adx[index - 1];
    }
  }
  return adx;
}

function linearSlope(values) {
  const usable = values.map(Number).filter(Number.isFinite);
  if (usable.length < 2) return 0;
  const xAverage = (usable.length - 1) / 2;
  const yAverage = average(usable);
  let numerator = 0;
  let denominator = 0;
  usable.forEach((value, index) => {
    numerator += (index - xAverage) * (value - yAverage);
    denominator += (index - xAverage) ** 2;
  });
  return denominator ? numerator / denominator : 0;
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

function chaikinMoneyFlow(rows, period = 20) {
  return rows.map((_, index) => {
    if (index < period - 1) return null;
    const window = rows.slice(index - period + 1, index + 1);
    const volume = window.reduce((sum, row) => sum + Number(row.volume || 0), 0);
    if (!volume) return 0;
    const moneyFlowVolume = window.reduce((sum, row) => {
      const range = row.high - row.low;
      const multiplier = range > 0 ? ((row.close - row.low) - (row.high - row.close)) / range : 0;
      return sum + multiplier * Number(row.volume || 0);
    }, 0);
    return moneyFlowVolume / volume;
  });
}

function onBalanceVolume(rows) {
  let value = 0;
  return rows.map((row, index) => {
    if (index) value += row.close > rows[index - 1].close ? row.volume : row.close < rows[index - 1].close ? -row.volume : 0;
    return value;
  });
}

function stochasticOscillator(rows, period = 9, smoothing = 3) {
  const kValues = new Array(rows.length).fill(null);
  const dValues = new Array(rows.length).fill(null);
  let previousK = 50;
  let previousD = 50;
  const weight = 1 / smoothing;

  for (let index = period - 1; index < rows.length; index += 1) {
    const window = rows.slice(index - period + 1, index + 1);
    const lowestLow = Math.min(...window.map(row => row.low));
    const highestHigh = Math.max(...window.map(row => row.high));
    const range = highestHigh - lowestLow;
    const rsv = range > 0 ? ((rows[index].close - lowestLow) / range) * 100 : 50;
    const k = (previousK * (1 - weight)) + (rsv * weight);
    const d = (previousD * (1 - weight)) + (k * weight);
    kValues[index] = k;
    dValues[index] = d;
    previousK = k;
    previousD = d;
  }

  return { kValues, dValues };
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

function strategyEvents(rows) {
  const pullback = [];
  const breakout = [];
  const rsi = [];
  const start = Math.max(20, rows.length - 140);
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index];
    const previous = rows[index - 1];
    const uptrend = finite(row.ma20) && finite(row.ma60) && row.ma20 > row.ma60 && row.close > row.ma60;
    const downtrend = finite(row.ma20) && finite(row.ma60) && row.ma20 < row.ma60 && row.close < row.ma60;
    if (uptrend && row.low <= row.ma20 * 1.015 && row.close >= row.ma20 && row.close > previous.close) {
      pullback.push({ time: row.time, type: 'bullish', status: 'confirmed', kind: 'reclaim', price: row.close, level: row.ma20, text: '回檔確認' });
    } else if (downtrend && row.high >= row.ma20 * 0.985 && row.close <= row.ma20 && row.close < previous.close) {
      pullback.push({ time: row.time, type: 'bearish', status: 'confirmed', kind: 'rejection', price: row.close, level: row.ma20, text: '反彈受阻' });
    }

    const prior = rows.slice(Math.max(0, index - 20), index);
    if (prior.length >= 20) {
      const high = Math.max(...prior.map(item => item.high));
      const low = Math.min(...prior.map(item => item.low));
      const ratio = volumeRatioAt(rows, index);
      if (row.close > high * 1.001) {
        const event = { time: row.time, type: 'bullish', status: ratio >= 1.5 ? 'confirmed' : 'watch', kind: 'breakout', price: row.close, level: high, volumeRatio: ratio, text: ratio >= 1.5 ? '放量突破' : '突破量不足' };
        for (let cursor = index + 1; cursor < rows.length && cursor <= index + 5; cursor += 1) if (rows[cursor].close < high * 0.999) { event.status = 'invalidated'; event.invalidationTime = rows[cursor].time; event.text = '假突破'; break; }
        breakout.push(event);
      }
      if (row.close < low * 0.999) {
        const event = { time: row.time, type: 'bearish', status: ratio >= 1.5 ? 'confirmed' : 'watch', kind: 'breakdown', price: row.close, level: low, volumeRatio: ratio, text: ratio >= 1.5 ? '放量跌破' : '跌破量不足' };
        for (let cursor = index + 1; cursor < rows.length && cursor <= index + 5; cursor += 1) if (rows[cursor].close > low * 1.001) { event.status = 'invalidated'; event.invalidationTime = rows[cursor].time; event.text = '假跌破'; break; }
        breakout.push(event);
      }
    }

    if (finite(previous.rsi) && finite(row.rsi)) {
      const levels = boundaryLevelsAt(rows, index);
      const nearSupport = levels && row.close >= levels.lower - levels.atr && row.close <= levels.lower + levels.atr;
      const nearResistance = levels && row.close >= levels.upper - levels.atr && row.close <= levels.upper + levels.atr;
      if (previous.rsi < 30 && row.rsi >= 30 && nearSupport) rsi.push({ time: row.time, type: 'bullish', status: 'confirmed', kind: 'cross', price: row.close, value: row.rsi, level: levels.lower, text: 'RSI 支撐反轉' });
      if (previous.rsi > 70 && row.rsi <= 70 && nearResistance) rsi.push({ time: row.time, type: 'bearish', status: 'confirmed', kind: 'cross', price: row.close, value: row.rsi, level: levels.upper, text: 'RSI 壓力反轉' });
    }
  }
  return { pullback: pullback.slice(-8), breakout: breakout.slice(-8), rsi: rsi.slice(-8) };
}

function boundaryLevelsAt(rows, index) {
  const history = rows.slice(Math.max(0, index - 120), index);
  if (history.length < 30) return null;
  const reference = rows[index]?.close || history.at(-1).close;
  const atr = Math.max(averageTrueRange(history), reference * 0.005);
  const lows = pivotIndexes(history.map(row => row.low), 'low', 3);
  const highs = pivotIndexes(history.map(row => row.high), 'high', 3);
  const lowClusters = clusterLevels(history, lows, 'low', reference, atr).sort((a, b) => String(b.lastDate).localeCompare(String(a.lastDate)));
  const highClusters = clusterLevels(history, highs, 'high', reference, atr).sort((a, b) => String(b.lastDate).localeCompare(String(a.lastDate)));
  const recent = history.slice(-60);
  const lower = lowClusters[0]?.price ?? (lows.length ? history[lows.at(-1)].low : Math.min(...recent.map(row => row.low)));
  const upper = highClusters[0]?.price ?? (highs.length ? history[highs.at(-1)].high : Math.max(...recent.map(row => row.high)));
  if (!finite(lower) || !finite(upper) || upper <= lower) return null;
  const midpoint = (lower + upper) / 2;
  const neutralHalfWidth = Math.min(atr * 0.5, (upper - lower) * 0.1);
  return { lower, upper, midpoint, neutralLower: midpoint - neutralHalfWidth, neutralUpper: midpoint + neutralHalfWidth, atr };
}

function institutionalForDate(context, time) {
  const rows = context?.institutional || [];
  return rows.find(item => item.time === time || item.date === time) || null;
}

function institutionalWindow(rows, index, context, lookback = 5) {
  const market = String(context?.marketType || '').toUpperCase();
  if (market !== 'TW') return null;
  const candleDate = rows[index]?.time;
  const flows = (context?.institutional || [])
    .filter(item => {
      const date = item.time || item.date;
      return date && (!candleDate || date <= candleDate);
    })
    .sort((a, b) => String(a.time || a.date).localeCompare(String(b.time || b.date)))
    .slice(-lookback);
  if (!flows.length) return null;
  const sums = flows.reduce((result, flow) => ({
    foreign: result.foreign + Number(flow.foreign || 0),
    trust: result.trust + Number(flow.trust || 0),
    dealerSelf: result.dealerSelf + Number(flow.dealerSelf || 0),
    dealerHedging: result.dealerHedging + Number(flow.dealerHedging || 0),
  }), { foreign: 0, trust: 0, dealerSelf: 0, dealerHedging: 0 });
  const directional = sums.foreign + sums.trust;
  const positiveDays = flows.filter(flow => Number(flow.foreign || 0) + Number(flow.trust || 0) > 0).length;
  const negativeDays = flows.filter(flow => Number(flow.foreign || 0) + Number(flow.trust || 0) < 0).length;
  let consecutive = 0;
  let consecutiveDirection = 'neutral';
  for (let cursor = flows.length - 1; cursor >= 0; cursor -= 1) {
    const net = Number(flows[cursor].foreign || 0) + Number(flows[cursor].trust || 0);
    const direction = net > 0 ? 'bullish' : net < 0 ? 'bearish' : 'neutral';
    if (direction === 'neutral' || (consecutiveDirection !== 'neutral' && direction !== consecutiveDirection)) break;
    consecutiveDirection = direction;
    consecutive += 1;
  }
  const volume = rows.slice(Math.max(0, index - lookback + 1), index + 1).reduce((sum, row) => sum + Number(row.volume || 0), 0);
  return {
    days: flows.length,
    ...sums,
    directional,
    positiveDays,
    negativeDays,
    consecutive,
    consecutiveDirection,
    asOf: flows.at(-1)?.time || flows.at(-1)?.date || null,
    volumeRatio: volume > 0 ? directional / volume : null,
  };
}

function institutionalPressure(rows, index, context, direction = 'bullish') {
  const market = String(context?.marketType || '').toUpperCase();
  if (market === 'TW') {
    const summary = institutionalWindow(rows, index, context, 5);
    if (!summary) return { passed: false, available: false, direction, label: '法人資料尚未取得' };
    const sameDirectionDays = direction === 'bullish' ? summary.positiveDays : summary.negativeDays;
    const passed = direction === 'bullish' ? summary.directional > 0 && sameDirectionDays >= 3 : summary.directional < 0 && sameDirectionDays >= 3;
    const action = direction === 'bullish' ? '買超' : '賣超';
    return {
      ...summary,
      passed,
      available: true,
      direction,
      label: passed
        ? `外資＋投信近 ${summary.days} 日${action}，${sameDirectionDays} 日同向`
        : `外資＋投信近 ${summary.days} 日未形成連續${action}`,
    };
  }
  const obvBase = rows[Math.max(0, index - 5)]?.obv;
  const bullish = finite(rows[index].cmf) && rows[index].cmf > 0 && finite(obvBase) && rows[index].obv > obvBase;
  const bearish = finite(rows[index].cmf) && rows[index].cmf < 0 && finite(obvBase) && rows[index].obv < obvBase;
  const passed = direction === 'bullish' ? bullish : bearish;
  return { passed, available: true, direction, label: passed ? `CMF20 與 OBV 確認${direction === 'bullish' ? '買盤' : '賣壓'}` : `CMF20／OBV 尚未確認${direction === 'bullish' ? '買盤' : '賣壓'}` };
}

function hasBuyPressure(rows, index, context) {
  return institutionalPressure(rows, index, context, 'bullish');
}

function applyInstitutionalConfirmation(result, rows, context) {
  if (!result || result.status === 'none' || result.direction === 'neutral') return result;
  const pressure = institutionalPressure(rows, rows.length - 1, context, result.direction);
  result.institutional = pressure;
  if (!pressure.available) {
    result.reason = `${result.reason} 法人資料待更新，不影響原技術判斷。`;
    return result;
  }
  if (pressure.passed) {
    result.reason = `${result.reason} ${pressure.label}，法人同向確認。`;
    return result;
  }
  if (result.status === 'confirmed') result.status = 'watch';
  result.reason = `${result.reason} 技術條件已出現，但${pressure.label}，降為觀察。`;
  return result;
}

function marketAlignmentAt(context, time, type) {
  const benchmark = (context?.benchmarkRows || []).filter(row => row.time <= time);
  if (benchmark.length < 60) return { passed: false, available: false, label: '大盤資料尚未取得' };
  const closes = benchmark.map(row => Number(row.close));
  const close = closes.at(-1);
  const ma20 = average(closes.slice(-20));
  const ma60 = average(closes.slice(-60));
  const bullish = close > ma20 && ma20 >= ma60;
  const bearish = close < ma20 && ma20 <= ma60;
  const passed = type === 'bullish' ? bullish : bearish;
  return {
    passed,
    available: true,
    close,
    ma20,
    ma60,
    label: passed ? `大盤${type === 'bullish' ? '偏多' : '偏空'}同向` : '大盤方向尚未同向',
  };
}

function smcRangeAt(rows, index) {
  const history = rows.slice(Math.max(0, index - 180), index);
  if (history.length < 60) return null;
  const reference = rows[index]?.close || history.at(-1).close;
  const atr = Math.max(averageTrueRange(history), reference * 0.005);
  const lows = pivotIndexes(history.map(row => row.low), 'low', 3);
  const highs = pivotIndexes(history.map(row => row.high), 'high', 3);
  const lowPools = clusterLevels(history, lows, 'low', reference, atr)
    .filter(item => item.price < reference + atr)
    .sort((a, b) => b.touches - a.touches || String(b.lastDate).localeCompare(String(a.lastDate)));
  const highPools = clusterLevels(history, highs, 'high', reference, atr)
    .filter(item => item.price > reference - atr)
    .sort((a, b) => b.touches - a.touches || String(b.lastDate).localeCompare(String(a.lastDate)));
  const recent = history.slice(-90);
  const ssl = lowPools[0]?.price ?? Math.min(...recent.map(row => row.low));
  const bsl = highPools[0]?.price ?? Math.max(...recent.map(row => row.high));
  if (!finite(ssl) || !finite(bsl) || bsl <= ssl || (bsl - ssl) < atr * 3) return null;
  const eq = (ssl + bsl) / 2;
  const noManHalfWidth = Math.max(atr * 0.25, (bsl - ssl) * 0.08);
  return {
    ssl,
    bsl,
    eq,
    discountUpper: eq - noManHalfWidth,
    premiumLower: eq + noManHalfWidth,
    atr,
    sslTouches: lowPools[0]?.touches || 1,
    bslTouches: highPools[0]?.touches || 1,
  };
}

function latestInternalStructure(rows, index) {
  const start = Math.max(0, index - 90);
  const history = rows.slice(start, index);
  const lows = pivotIndexes(history.map(row => row.low), 'low', 3);
  const highs = pivotIndexes(history.map(row => row.high), 'high', 3);
  const recentHighs = highs.slice(-2).map(pivot => history[pivot].high);
  const recentLows = lows.slice(-2).map(pivot => history[pivot].low);
  const bearishStructure = recentHighs.length === 2 && recentLows.length === 2
    && recentHighs[1] < recentHighs[0] && recentLows[1] < recentLows[0];
  const bullishStructure = recentHighs.length === 2 && recentLows.length === 2
    && recentHighs[1] > recentHighs[0] && recentLows[1] > recentLows[0];
  return {
    high: highs.length ? history[highs.at(-1)].high : null,
    low: lows.length ? history[lows.at(-1)].low : null,
    trend: bearishStructure ? 'bearish' : bullishStructure ? 'bullish' : 'range',
  };
}

function orderBlockBefore(rows, index, type) {
  for (let cursor = index - 1; cursor >= Math.max(0, index - 8); cursor -= 1) {
    const row = rows[cursor];
    const opposite = type === 'bullish' ? row.close < row.open : row.close > row.open;
    if (opposite) return {
      time: row.time,
      lower: Math.min(row.open, row.close),
      upper: Math.max(row.open, row.close),
    };
  }
  return null;
}

function fairValueGapAt(rows, index, type) {
  if (index < 2) return null;
  const left = rows[index - 2];
  const row = rows[index];
  if (type === 'bullish' && row.low > left.high) return { lower: left.high, upper: row.low, midpoint: (left.high + row.low) / 2 };
  if (type === 'bearish' && row.high < left.low) return { lower: row.high, upper: left.low, midpoint: (row.high + left.low) / 2 };
  return null;
}

function rewardRisk(type, entry, stop, target) {
  const risk = type === 'bullish' ? entry - stop : stop - entry;
  const reward = type === 'bullish' ? target - entry : entry - target;
  return risk > 0 ? reward / risk : 0;
}

function evaluateSmcStrategy(rows, context = {}) {
  const events = [];
  const market = String(context?.marketType || '').toUpperCase();
  const requiresStockFilters = market === 'TW' || market === 'US';
  const start = Math.max(60, rows.length - 180);
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index];
    const range = smcRangeAt(rows, index);
    if (!range) continue;
    const volumeRatio = volumeRatioAt(rows, index);
    const bullishMarket = marketAlignmentAt(context, row.time, 'bullish');
    const bearishMarket = marketAlignmentAt(context, row.time, 'bearish');
    const body = Math.abs(row.close - row.open);
    const lowerWick = Math.min(row.open, row.close) - row.low;
    const upperWick = row.high - Math.max(row.open, row.close);
    const bullishSweep = row.low < range.ssl * 0.999 && row.close > range.ssl && row.close < range.discountUpper
      && lowerWick >= Math.max(body * 1.5, range.atr * 0.25);
    const bearishSweep = row.high > range.bsl * 1.001 && row.close < range.bsl && row.close > range.premiumLower
      && upperWick >= Math.max(body * 1.5, range.atr * 0.25);
    if (bullishSweep || bearishSweep) {
      const type = bullishSweep ? 'bullish' : 'bearish';
      const stop = bullishSweep ? row.low - range.atr * 0.1 : row.high + range.atr * 0.1;
      const target = bullishSweep ? range.bsl : range.ssl;
      const rr = rewardRisk(type, row.close, stop, target);
      const marketFilter = bullishSweep ? bullishMarket : bearishMarket;
      const volumePassed = volumeRatio >= (requiresStockFilters ? 1.5 : 1.2);
      const confirmed = volumePassed && marketFilter.passed && rr >= 2.5;
      const event = {
        strategy: 'smc', scenario: 'sweep', type, time: row.time, price: row.close,
        status: confirmed ? 'confirmed' : 'watch', text: confirmed ? `${type === 'bullish' ? 'SSL' : 'BSL'} Sweep 確認` : !volumePassed ? 'Sweep 量能不足' : !marketFilter.passed ? marketFilter.label : `盈虧比僅 ${rr.toFixed(1)}`,
        entryLower: row.close - range.atr * 0.1, entryUpper: row.close + range.atr * 0.1,
        stop, target, rr, volumeRatio, marketFilter,
        checks: { sweep: true, wick: true, discountPremium: true, volume: volumePassed, market: marketFilter.passed, rr: rr >= 2.5 },
        ...range,
      };
      for (let cursor = index + 1; cursor < rows.length && cursor <= index + 20; cursor += 1) {
        const invalid = type === 'bullish' ? rows[cursor].close < stop : rows[cursor].close > stop;
        if (invalid) { event.status = 'invalidated'; event.invalidationTime = rows[cursor].time; event.text = 'Sweep 停損失效'; break; }
      }
      if (event.status === 'confirmed' && rows.length - 1 > index + 20) event.status = 'stale';
      events.push(event);
    }

    const structure = latestInternalStructure(rows, index);
    for (const type of ['bullish', 'bearish']) {
      if (type === 'bullish' && structure.trend !== 'bearish') continue;
      if (type === 'bearish' && structure.trend !== 'bullish') continue;
      const level = type === 'bullish' ? structure.high : structure.low;
      if (!finite(level)) continue;
      const directionalBody = type === 'bullish' ? row.close > row.open : row.close < row.open;
      const choch = type === 'bullish'
        ? rows[index - 1].close <= level * 1.001 && row.close > level * 1.001
        : rows[index - 1].close >= level * 0.999 && row.close < level * 0.999;
      if (!choch || !directionalBody || body < range.atr * 0.8) continue;
      const fvg = fairValueGapAt(rows, index, type);
      const ob = orderBlockBefore(rows, index, type);
      const zone = fvg || ob;
      if (!zone) continue;
      const entryLower = zone.lower;
      const entryUpper = zone.upper;
      const entry = fvg?.midpoint || (entryLower + entryUpper) / 2;
      const stop = type === 'bullish' ? Math.min(ob?.lower ?? row.low, row.low) - range.atr * 0.1 : Math.max(ob?.upper ?? row.high, row.high) + range.atr * 0.1;
      const target = type === 'bullish' ? range.bsl : range.ssl;
      const rr = rewardRisk(type, entry, stop, target);
      const marketFilter = type === 'bullish' ? bullishMarket : bearishMarket;
      const volumePassed = volumeRatio >= (requiresStockFilters ? 1.2 : 1.0);
      const event = {
        strategy: 'smc', scenario: 'choch', type, time: row.time, price: row.close,
        status: 'watch', text: `${type === 'bullish' ? '多方' : '空方'} CHoCH，等待回踩`,
        chochLevel: level, fvg, ob, zoneType: fvg ? 'FVG' : 'OB', entryLower, entryUpper,
        stop, target, rr, volumeRatio, marketFilter,
        checks: { choch: true, displacement: true, imbalance: Boolean(fvg), orderBlock: Boolean(ob), volume: volumePassed, market: marketFilter.passed, retest: false, rr: rr >= 2.5 },
        ...range,
      };
      for (let cursor = index + 1; cursor < rows.length && cursor <= index + 12; cursor += 1) {
        const candidate = rows[cursor];
        const invalid = type === 'bullish' ? candidate.close < stop : candidate.close > stop;
        if (invalid) { event.status = 'invalidated'; event.invalidationTime = candidate.time; event.text = 'CHoCH／OB 失效'; break; }
        const retested = candidate.low <= entryUpper && candidate.high >= entryLower;
        if (retested && volumePassed && marketFilter.passed && rr >= 2.5) {
          event.status = 'confirmed'; event.confirmationTime = candidate.time; event.confirmationPrice = candidate.close;
          event.checks.retest = true; event.text = `${event.zoneType} 回踩確認`; break;
        }
      }
      if (event.status === 'watch' && rows.length - 1 >= index + 12) { event.status = 'expired'; event.text = '十二日內未回踩進場區'; }
      events.push(event);
    }
  }
  const levels = smcRangeAt(rows, rows.length - 1);
  if (!levels) return { key: 'smc', label: 'SMC 智慧資金', status: 'none', direction: 'neutral', reason: '顯著高低點不足，尚無法建立 BSL／SSL 與 EQ。', events, levels: null };
  const recentTimes = new Set(rows.slice(-20).map(item => item.time));
  const active = events.filter(item => ['confirmed', 'watch'].includes(item.status) && recentTimes.has(item.confirmationTime || item.time)).at(-1);
  if (active) return {
    key: 'smc', label: 'SMC 智慧資金', status: active.status, direction: active.type,
    reason: `${active.text}；${active.zoneType || '流動性收回'}，R:R ${active.rr.toFixed(1)}，量能 ${active.volumeRatio.toFixed(1)} 倍。`,
    signal: active, events: events.slice(-10), levels,
  };
  const latest = rows.at(-1);
  const inNoManLand = latest.close >= levels.discountUpper && latest.close <= levels.premiumLower;
  const direction = latest.close < levels.discountUpper ? 'bullish' : latest.close > levels.premiumLower ? 'bearish' : 'neutral';
  return {
    key: 'smc', label: 'SMC 智慧資金', status: inNoManLand ? 'none' : 'watch', direction,
    reason: inNoManLand
      ? `價格位於 EQ ${levels.eq.toFixed(2)} 附近的無人區，不建立新倉研究訊號。`
      : `${direction === 'bullish' ? '折價區' : '溢價區'}觀察；等待 Sweep 或 CHoCH 後回踩 FVG／OB，且 R:R 至少 2.5。`,
    signal: null, latestEvent: events.at(-1) || null, events: events.slice(-10), levels,
  };
}

function evaluateBoundaryStrategy(rows, context = {}) {
  const events = [];
  let lastBreakout = -20;
  const start = Math.max(60, rows.length - 160);
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index];
    const previous = rows[index - 1];
    const levels = boundaryLevelsAt(rows, index);
    if (!levels) continue;
    const body = Math.abs(row.close - row.open);
    const lowerWick = Math.min(row.open, row.close) - row.low;
    const swept = row.low < levels.lower * 0.999 && row.close > levels.lower;
    const wickPassed = lowerWick >= Math.max(body * 1.5, levels.atr * 0.25);
    const kdCross = finite(previous.k) && finite(previous.d) && finite(row.k) && finite(row.d)
      && previous.k <= previous.d && row.k > row.d && Math.max(row.k, row.d) <= 20;
    const macdFlip = finite(previous.macdHistogram) && finite(row.macdHistogram) && previous.macdHistogram <= 0 && row.macdHistogram > 0;
    if (swept && wickPassed) {
      const stop = row.low - levels.atr * 0.1;
      const riskPct = row.close > 0 ? (row.close - stop) / row.close : Infinity;
      const confirmed = (kdCross || macdFlip) && riskPct <= 0.03;
      const event = {
        strategy: 'boundary', subStrategy: 'sweep', type: 'bullish', time: row.time,
        status: confirmed ? 'confirmed' : 'watch', price: row.close, level: levels.lower,
        entryLower: levels.lower, entryUpper: levels.lower + levels.atr * 0.5,
        stop, target1: levels.midpoint, target2: levels.upper, riskPct,
        checks: { swept, wick: wickPassed, kd: kdCross, macd: macdFlip, risk: riskPct <= 0.03 },
        text: confirmed ? '下邊界反轉確認' : riskPct > 0.03 ? '反轉風險超過 3%' : '反轉等待動能',
        ...levels,
      };
      for (let cursor = index + 1; cursor < rows.length && cursor <= index + 20; cursor += 1) {
        if (rows[cursor].close < stop) { event.status = 'invalidated'; event.invalidationTime = rows[cursor].time; break; }
      }
      if (event.status === 'confirmed' && rows.length - 1 > index + 20) event.status = 'stale';
      events.push(event);
    }

    const volumeRatio = volumeRatioAt(rows, index);
    const pressure = hasBuyPressure(rows, index, context);
    const brokeOut = row.close > levels.upper * 1.001 && volumeRatio >= 1.2;
    if (brokeOut && index - lastBreakout >= 10) {
      lastBreakout = index;
      const event = {
        strategy: 'boundary', subStrategy: 'breakout', type: 'bullish', time: row.time,
        status: 'watch', price: row.close, level: levels.upper,
        entryLower: levels.upper - levels.atr * 0.25, entryUpper: levels.upper + levels.atr * 0.25,
        stop: levels.upper - levels.atr * 0.5, target1: levels.upper + levels.atr * 2,
        target2: levels.upper + levels.atr * 3, volumeRatio, buyPressure: pressure,
        checks: { breakout: true, volume: true, pressure: pressure.passed, retest: false },
        text: pressure.passed ? '突破後等待回踩' : pressure.label,
        ...levels,
      };
      const end = Math.min(rows.length - 1, index + 10);
      for (let cursor = index + 1; cursor <= end; cursor += 1) {
        const candidate = rows[cursor];
        if (candidate.close < event.stop) {
          event.status = 'invalidated'; event.invalidationTime = candidate.time; event.text = '突破跌回失效區'; break;
        }
        const touched = candidate.low <= event.entryUpper && candidate.high >= event.entryLower;
        if (pressure.passed && touched && candidate.close >= levels.upper) {
          event.status = 'confirmed'; event.confirmationTime = candidate.time; event.confirmationPrice = candidate.close;
          event.checks.retest = true; event.text = '突破回踩確認'; break;
        }
      }
      if (event.status === 'watch' && rows.length - 1 >= index + 10) { event.status = 'expired'; event.text = '十日內未完成回踩'; }
      events.push(event);
    }
  }
  const levels = boundaryLevelsAt(rows, rows.length - 1);
  const recentTimes = new Set(rows.slice(-20).map(item => item.time));
  const active = events.filter(item => ['confirmed', 'watch'].includes(item.status) && recentTimes.has(item.confirmationTime || item.time)).at(-1);
  const historical = events.at(-1);
  if (!levels) return { key: 'boundary', label: '雙軌邊界', status: 'none', direction: 'neutral', reason: '歷史轉折不足，尚無法建立上下邊界。', events, levels: null };
  if (active) return {
    key: 'boundary', label: '雙軌邊界', status: active.status, direction: active.type,
    reason: active.subStrategy === 'sweep'
      ? `${active.text}；下邊界 ${active.lower.toFixed(2)}，中軸 ${active.midpoint.toFixed(2)}。`
      : `${active.text}；突破邊界 ${active.upper.toFixed(2)}，量能 ${active.volumeRatio.toFixed(1)} 倍。`,
    signal: active, events, levels,
  };
  const latest = rows.at(-1);
  const nearLower = latest.close <= levels.lower + levels.atr;
  const nearUpper = latest.close >= levels.upper - levels.atr;
  return {
    key: 'boundary', label: '雙軌邊界', status: nearLower || nearUpper ? 'watch' : 'none',
    direction: nearLower ? 'bullish' : nearUpper ? 'bearish' : 'neutral', signal: null, latestEvent: historical || null, events, levels,
    reason: nearLower ? `接近下邊界 ${levels.lower.toFixed(2)}，等待刺破收回與動能確認。`
      : nearUpper ? `接近上邊界 ${levels.upper.toFixed(2)}，等待放量突破與回踩。`
        : `價格位於邊界中段；下邊界 ${levels.lower.toFixed(2)}、上邊界 ${levels.upper.toFixed(2)}，暫不建立訊號。`,
  };
}

function relativeStrengthGate(rows, context) {
  const latest = rows.at(-1);
  const symbol = String(context?.symbol || '').toUpperCase().replace(/[-/]?USDT$|[-/]?USD$/i, '');
  const market = String(context?.marketType || '').toUpperCase();
  if (market === 'CRYPTO' && symbol === 'BTC') {
    const passed = present(latest?.ma50) && latest.close > latest.ma50;
    return { passed, available: present(latest?.ma50), value: latest?.close, average: latest?.ma50, benchmark: 'BTC SMA50', label: present(latest?.ma50) ? `BTC ${passed ? '站上' : '未站上'}自身 SMA50 ${Number(latest.ma50).toFixed(2)}` : 'BTC SMA50 資料不足' };
  }
  const benchmarkRows = context?.relativeStrengthRows || [];
  const benchmarkByDate = new Map(benchmarkRows.map(row => [String(row.time), Number(row.close)]));
  const ratios = rows
    .map(row => ({ time: row.time, value: benchmarkByDate.get(String(row.time)) ? row.close / benchmarkByDate.get(String(row.time)) : null }))
    .filter(item => present(item.value));
  if (ratios.length < 50) return { passed: false, available: false, benchmark: context?.relativeStrengthBenchmark || '市場基準', label: '相對強弱共同交易日不足 50 日' };
  const latestRatio = ratios.at(-1).value;
  const ratioMa50 = average(ratios.slice(-50).map(item => item.value));
  const passed = latestRatio > ratioMa50;
  return {
    passed, available: true, value: latestRatio, average: ratioMa50,
    benchmark: context?.relativeStrengthBenchmark || (market === 'US' ? 'QQQ' : market === 'TW' ? '加權指數' : 'BTC'),
    label: `相對強弱 ${latestRatio.toFixed(4)} ${passed ? '高於' : '未高於'} 50 日均值 ${ratioMa50.toFixed(4)}`,
  };
}

function evaluateHybridStrategy(rows, context, strategies) {
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const prior20 = rows.slice(-21, -1);
  const hh20 = prior20.length ? Math.max(...prior20.map(row => row.high)) : null;
  const averageVolume20 = average(prior20.map(row => Number(row.volume || 0)));
  const rvol = averageVolume20 > 0 ? latest.volume / averageVolume20 : 0;
  const trendPassed = present(latest.ma200) && present(latest.ema20) && present(latest.ema50)
    && latest.close > latest.ma200 && latest.ema20 > latest.ema50;
  const breakoutPassed = present(hh20) && latest.close > hh20 && rvol > 1.2 && present(latest.adx14) && latest.adx14 > 18;
  const breakoutNear = present(hh20) && latest.close >= hh20 * 0.98;
  const pullbackTouched = rows.slice(-5).some(row => present(row.ema20)
    && row.low <= row.ema20 * 1.015 && row.high >= row.ema20 * 0.985);
  const reclaimedEma20 = present(previous?.ema20) && present(latest.ema20)
    && previous.close <= previous.ema20 && latest.close > latest.ema20;
  const rsiCross50 = present(previous?.rsi) && present(latest.rsi) && previous.rsi <= 50 && latest.rsi > 50;
  const pullbackPassed = latest.ema20 > latest.ema50 && pullbackTouched && reclaimedEma20 && rsiCross50;
  const obvSlope5 = linearSlope(rows.slice(-5).map(row => row.obv));
  const volumePassed = (present(latest.cmf) && latest.cmf > 0) || obvSlope5 > 0;
  const relativeStrength = relativeStrengthGate(rows, context);
  const route = breakoutPassed ? 'breakout' : pullbackPassed ? 'pullback' : null;
  const confirmed = trendPassed && Boolean(route) && volumePassed && relativeStrength.passed;
  const candidate = trendPassed && (breakoutNear || pullbackTouched || Boolean(route));
  const status = confirmed ? 'confirmed' : candidate ? 'watch' : 'none';
  const atr14 = Number(latest.atr14 || 0);
  const entryPrice = latest.close;
  const initialStop = atr14 > 0 ? entryPrice - atr14 * 2 : null;
  const bearishDivergence = strategies.find(item => item.key === 'divergence' && item.direction === 'bearish' && item.status !== 'none');
  const boundary = strategies.find(item => item.key === 'boundary');
  const smc = strategies.find(item => item.key === 'smc');
  const missing = [!route && '突破／回檔路線', !volumePassed && '量能', !relativeStrength.passed && '相對強弱'].filter(Boolean);
  return {
    key: 'hybrid', label: '混合策略', status, direction: confirmed || candidate ? 'bullish' : 'neutral', route,
    reason: confirmed
      ? `${route === 'breakout' ? '放量突破' : '趨勢回檔'}路線通過，量能與相對強弱確認。`
      : trendPassed ? `多頭趨勢成立，仍待${missing.join('、') || '進場確認'}。` : 'Close 尚未同時站上 SMA200，或 EMA20 尚未高於 EMA50。',
    gates: {
      trend: { passed: trendPassed, label: present(latest.ma200) ? `Close ${latest.close.toFixed(2)} / SMA200 ${latest.ma200.toFixed(2)}；EMA20 ${latest.ema20.toFixed(2)} / EMA50 ${latest.ema50.toFixed(2)}` : '需要至少 200 個交易日資料' },
      breakout: { passed: breakoutPassed, candidate: breakoutNear, hh20, rvol, adx14: latest.adx14, label: present(hh20) ? `HH20 ${hh20.toFixed(2)}・RVOL ${rvol.toFixed(2)}・ADX14 ${present(latest.adx14) ? latest.adx14.toFixed(1) : '—'}` : '20 日資料不足' },
      pullback: { passed: pullbackPassed, candidate: pullbackTouched, touched: pullbackTouched, reclaimedEma20, rsiCross50, label: `5 日回測 ${pullbackTouched ? '有' : '無'}・站回 EMA20 ${reclaimedEma20 ? '是' : '否'}・RSI50 上穿 ${rsiCross50 ? '是' : '否'}` },
      volume: { passed: volumePassed, cmf20: latest.cmf, obvSlope5, label: `CMF20 ${present(latest.cmf) ? latest.cmf.toFixed(2) : '—'}・OBV 斜率 ${obvSlope5.toFixed(0)}` },
      relativeStrength,
    },
    risk: { entryPrice, atr14, initialStop, trailingStop: null, effectiveStop: initialStop },
    warnings: { macd: bearishDivergence?.reason || null, boundary: boundary?.reason || null, smc: smc?.reason || null },
    invalidationLevel: initialStop,
  };
}

function evaluateStrategies(rows, supports, resistances, divergences, context = {}) {
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
  if (bullishPullback) pullback = strategy('pullback', '趨勢回檔', 'confirmed', 'bullish', `上升趨勢回測 MA20（${fmt(latest.ma20)}）後收回，且收盤轉強。`, { level: latest.ma20 });
  else if (bearishRejection) pullback = strategy('pullback', '趨勢回檔', 'confirmed', 'bearish', `下降趨勢反彈至 MA20（${fmt(latest.ma20)}）後受阻，且收盤轉弱。`, { level: latest.ma20 });
  else if ((uptrend || downtrend) && ma20Distance <= 0.03) pullback = strategy('pullback', '趨勢回檔', 'watch', uptrend ? 'bullish' : 'bearish', `${uptrend ? '上升' : '下降'}趨勢成立，距 MA20 ${Number(ma20Distance * 100).toFixed(1)}%，等待止跌／受阻 K 棒。`, { level: latest.ma20 });
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

  const events = strategyEvents(rows);
  divergence.events = divergences;
  pullback.events = events.pullback;
  breakout.events = events.breakout;
  rsiReversal.events = events.rsi;
  const boundary = evaluateBoundaryStrategy(rows, context);
  const smc = evaluateSmcStrategy(rows, context);
  const strategies = [divergence, pullback, breakout, rsiReversal, boundary, smc]
    .map(item => applyInstitutionalConfirmation(item, rows, context));
  const hybrid = evaluateHybridStrategy(rows, context, strategies);
  const confirmed = strategies.filter(item => item.status === 'confirmed');
  const watch = strategies.filter(item => item.status === 'watch');
  const bullish = strategies.filter(item => item.direction === 'bullish' && item.status !== 'none').length;
  const bearish = strategies.filter(item => item.direction === 'bearish' && item.status !== 'none').length;
  const institutional = String(context?.marketType || '').toUpperCase() === 'TW' ? {
    day1: institutionalWindow(rows, rows.length - 1, context, 1),
    day3: institutionalWindow(rows, rows.length - 1, context, 3),
    day5: institutionalWindow(rows, rows.length - 1, context, 5),
    day20: institutionalWindow(rows, rows.length - 1, context, 20),
  } : null;
  return { strategies, hybrid, institutional, confirmedCount: confirmed.length, watchCount: watch.length, bullish, bearish };
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

  // Yahoo blocks browser-origin requests with CORS. Use the authenticated
  // Supabase proxy on web and native clients alike.
  try {
    const { data, error } = await supabase.functions.invoke('market-history', {
      body: { symbol, days },
    });
    if (!error && Array.isArray(data?.rows) && data.rows.length >= 60) {
      cache.set(key, { data: data.rows, timestamp: Date.now() });
      return data.rows;
    }
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  } catch (proxyError) {
    // Keep the direct fallback for local/native environments while the
    // function is unavailable or during a temporary deployment transition.
    if (typeof window !== 'undefined') throw proxyError;
  }

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

export async function fetchMarketTechnicalContext(symbol, marketType = 'TW', days = 1095, forceRefresh = false, includeIntraday = false) {
  const market = String(marketType || (/^\d+$/.test(String(symbol)) ? 'TW' : 'US')).toUpperCase();
  const key = `CTX:${market}:${symbol}:${days}:${includeIntraday ? 'intraday' : 'closed'}`;
  const hit = cache.get(key);
  if (!forceRefresh && hit && Date.now() - hit.timestamp < CACHE_TTL) return hit.data;
  try {
    const { data, error } = await supabase.functions.invoke('market-history', { body: { symbol, marketType: market, days, includeIntraday } });
    if (error) throw error;
    if (!Array.isArray(data?.rows) || data.rows.length < 60) throw new Error(data?.error || '歷史資料不足');
    const result = {
      rows: data.rows,
      institutional: data.institutional || [],
      benchmarkRows: data.benchmarkRows || [],
      relativeStrengthRows: data.relativeStrengthRows || [],
      relativeStrengthBenchmark: data.relativeStrengthBenchmark || '',
      name: data.name || '',
      quote: data.quote || null,
      quoteSource: data.quoteSource || data.quote?.source || '',
      quoteStatus: data.quoteStatus || (data.isIntraday ? 'intraday' : 'official_close'),
      isIntraday: Boolean(data.isIntraday),
      quoteTime: data.quoteTime || '',
      intradayUnavailable: Boolean(data.intradayUnavailable),
      marketType: market,
      symbol: String(symbol).toUpperCase(),
    };
    cache.set(key, { data: result, timestamp: Date.now() });
    return result;
  } catch (error) {
    const rows = await fetchMarketTechnicalData(symbol, market, days, forceRefresh);
    return { rows, institutional: [], benchmarkRows: [], relativeStrengthRows: [], relativeStrengthBenchmark: '', name: '', quote: null, quoteSource: '', quoteStatus: 'unavailable', isIntraday: false, quoteTime: '', intradayUnavailable: includeIntraday, marketType: market, symbol: String(symbol).toUpperCase(), contextError: error.message };
  }
}

export function analyzeTechnicalData(rawRows, displayCount = rawRows.length, context = {}) {
  const closes = rawRows.map(row => row.close);
  const ma5Values = movingAverage(closes, 5);
  const ma10Values = movingAverage(closes, 10);
  const ma20Values = movingAverage(closes, 20);
  const ma50Values = movingAverage(closes, 50);
  const ma60Values = movingAverage(closes, 60);
  const ma200Values = movingAverage(closes, 200);
  const ema20Values = ema(closes, 20);
  const ema50Values = ema(closes, 50);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdValues = closes.map((_, index) => ema12[index] - ema26[index]);
  const signalValues = ema(macdValues, 9);
  const histogramValues = macdValues.map((value, index) => value - signalValues[index]);
  const rsiValues = relativeStrengthIndex(closes, 14);
  const cmfValues = chaikinMoneyFlow(rawRows, 20);
  const obvValues = onBalanceVolume(rawRows);
  const atr14Values = atrSeries(rawRows, 14);
  const adx14Values = averageDirectionalIndex(rawRows, 14);
  const { kValues, dValues } = stochasticOscillator(rawRows, 9, 3);
  const enrichedAll = rawRows.map((row, index) => ({
    ...row,
    ma5: ma5Values[index],
    ma10: ma10Values[index],
    ma20: ma20Values[index],
    ma50: ma50Values[index],
    ma60: ma60Values[index],
    ma200: ma200Values[index],
    ema20: ema20Values[index],
    ema50: ema50Values[index],
    macd: macdValues[index],
    macdSignal: signalValues[index],
    macdHistogram: histogramValues[index],
    rsi: rsiValues[index],
    k: kValues[index],
    d: dValues[index],
    cmf: cmfValues[index],
    obv: obvValues[index],
    atr14: atr14Values[index],
    adx14: adx14Values[index],
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
  const strategySummary = evaluateStrategies(enriched, supports, resistances, divergences, context);
  return { rows: enriched, latest, supports, resistances, volumeSpikes, divergences, atr, ...strategySummary };
}

export function technicalAnalysisPrompt(name, symbol, analysis, selectedStrategy = 'ALL') {
  const fmt = value => Number(value).toFixed(2);
  const supports = analysis.supports.length ? analysis.supports.map(level => `${fmt(level.lower)}–${fmt(level.upper)}（${level.touches} 次測試）`).join('、') : '未形成足夠明確的支撐區';
  const resistances = analysis.resistances.length ? analysis.resistances.map(level => `${fmt(level.lower)}–${fmt(level.upper)}（${level.touches} 次測試）`).join('、') : '未形成足夠明確的壓力區';
  const spikes = analysis.volumeSpikes.length ? analysis.volumeSpikes.slice(-3).map(item => `${item.time} ${item.ratio.toFixed(1)} 倍`).join('、') : '近期無 1.8 倍以上爆量';
  const statusLabel = status => ({ confirmed: '已確認', pending: '等待確認', invalidated: '已失效', expired: '候選已逾期', stale: '確認已過期' }[status] || status);
  const divergences = analysis.divergences.length ? analysis.divergences.map(item => `${item.time} ${item.type === 'bullish' ? '看多' : '看空'}背離（${statusLabel(item.status)}，確認線 ${fmt(item.neckline)}${item.confirmationTime ? `，確認日 ${item.confirmationTime}` : ''}）`).join('、') : '近期未偵測到背離候選';
  const selected = selectedStrategy === 'ALL'
    ? (analysis.hybrid ? [analysis.hybrid] : [])
    : (analysis.strategies || []).filter(item => item.key === selectedStrategy);
  const strategies = selected.map(item => `${item.label}：${item.status === 'confirmed' ? '已確認' : item.status === 'watch' ? '接近成立' : '未成立'}（${item.reason}）`).join('；');
  const flow = analysis.institutional?.day5;
  const institutional = flow
    ? `近 ${flow.days} 日外資 ${Number(flow.foreign || 0).toLocaleString('zh-TW')} 股、投信 ${Number(flow.trust || 0).toLocaleString('zh-TW')} 股、外資加投信合計 ${Number(flow.directional || 0).toLocaleString('zh-TW')} 股，其中買超 ${flow.positiveDays} 日、賣超 ${flow.negativeDays} 日；自營商自行買賣 ${Number(flow.dealerSelf || 0).toLocaleString('zh-TW')} 股，避險部位不納入方向確認`
    : '此市場沒有可用的台股法人籌碼資料';
  return `請解讀 ${name}（${symbol}）的技術圖。資料截至 ${analysis.latest.time}，收盤 ${fmt(analysis.latest.close)}，MA20 ${fmt(analysis.latest.ma20)}，MA60 ${fmt(analysis.latest.ma60)}，RSI14 ${fmt(analysis.latest.rsi)}，KD(9,3,3) K ${fmt(analysis.latest.k)}、D ${fmt(analysis.latest.d)}。支撐區：${supports}。壓力區：${resistances}。爆量：${spikes}。MACD：${divergences}。法人籌碼：${institutional}。目前選取策略：${selectedStrategy}。策略判斷：${strategies || '無可用結果'}。請分成趨勢、關鍵價位、量價、法人籌碼、動能、策略條件、風險與後續觀察；這些訊號只供研究，不要直接給買賣指令。`;
}
