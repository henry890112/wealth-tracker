// Technical indicator calculations for AI asset analysis

/**
 * Wilder's RSI using Exponential Moving Average smoothing.
 * @param {number[]} closes  Array of close prices (oldest → newest)
 * @param {number}   period  Default 14
 * @returns {number|null}
 */
export function calculateRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Simple Moving Average of the last `period` closes.
 */
export function calculateMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Build a short plain-text technicals summary to feed to the AI.
 * Returns null if there's not enough data.
 */
export function buildTechnicalsText(closes, currentPrice) {
  if (!closes || closes.length < 15) return null;

  const rsi   = calculateRSI(closes);
  const ma20  = calculateMA(closes, Math.min(20, closes.length));
  const ma50  = closes.length >= 50 ? calculateMA(closes, 50) : null;

  const fmt = (v) => v.toFixed(2);
  const lines = [];

  if (rsi !== null) {
    const zone = rsi > 70 ? '超買區 ⚠️' : rsi < 30 ? '超賣區 🟢' : '中性區';
    lines.push(`RSI(14)：${rsi.toFixed(1)}（${zone}）`);
  }
  if (ma20 !== null) {
    const pos = currentPrice > ma20 ? '站上 ↑' : '跌破 ↓';
    lines.push(`MA20：${fmt(ma20)}（目前價格${pos} MA20）`);
  }
  if (ma50 !== null) {
    const pos = currentPrice > ma50 ? '站上 ↑' : '跌破 ↓';
    lines.push(`MA50：${fmt(ma50)}（目前價格${pos} MA50）`);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}
