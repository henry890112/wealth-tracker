const finite = value => Number.isFinite(Number(value));
const numeric = value => (finite(value) ? Number(value) : null);

const moneyFlowIndex = (rows, period = 14) => {
  if (!Array.isArray(rows) || rows.length <= period) return null;
  const flows = rows.map((row, index) => {
    const typical = (Number(row.high) + Number(row.low) + Number(row.close)) / 3;
    const previous = index ? (Number(rows[index - 1].high) + Number(rows[index - 1].low) + Number(rows[index - 1].close)) / 3 : typical;
    const flow = typical * Number(row.volume || 0);
    return { positive: typical > previous ? flow : 0, negative: typical < previous ? flow : 0 };
  }).slice(-period);
  const positive = flows.reduce((sum, item) => sum + item.positive, 0);
  const negative = flows.reduce((sum, item) => sum + item.negative, 0);
  if (negative === 0) return positive > 0 ? 100 : 50;
  return 100 - (100 / (1 + positive / negative));
};

const directionLabel = direction => direction === 'bullish' ? '偏多' : direction === 'bearish' ? '偏空' : '觀察';

export function evaluateCapitalFlow({ analysis, marketType = 'TW', excludeLatest = false } = {}) {
  const sourceRows = Array.isArray(analysis?.rows) ? analysis.rows : [];
  const rows = excludeLatest ? sourceRows.slice(0, -1) : sourceRows;
  const latest = rows.at(-1);
  if (!latest || rows.length < 21) {
    return { status: 'unavailable', available: false, source: '籌碼金流', summary: '籌碼金流資料不足。' };
  }

  const cmf = numeric(latest.cmf);
  const obv = numeric(latest.obv);
  const priorObv = rows.slice(-21, -1).map(row => Number(row.obv)).filter(Number.isFinite);
  const priorObvHigh = priorObv.length ? Math.max(...priorObv) : null;
  const obvStrong = obv != null && priorObvHigh != null && obv >= priorObvHigh;
  const obvWeak = obv != null && priorObvHigh != null && obv < priorObvHigh * 0.98;
  const mfi = moneyFlowIndex(rows, 14);
  const previousMfi = moneyFlowIndex(rows.slice(0, -1), 14);
  const mfiRecovering = mfi != null && mfi > 20 && (previousMfi == null || mfi >= previousMfi);
  const mfiWeak = mfi != null && previousMfi != null && mfi < previousMfi && mfi < 50;
  const quantitativeAvailable = cmf != null && obv != null && mfi != null;
  const quantitativeBullish = quantitativeAvailable && cmf > 0 && obvStrong && mfiRecovering;
  const quantitativeBearish = quantitativeAvailable && cmf < 0 && (obvWeak || mfiWeak);
  const quantitativeDirection = quantitativeBullish ? 'bullish' : quantitativeBearish ? 'bearish' : 'neutral';

  const market = String(marketType || '').toUpperCase();
  const institutional = analysis?.strategies?.find(item => item.key === 'institutional');
  const institutionalData = institutional?.institutional;
  const institutionalAvailable = market === 'TW' && institutionalData?.available !== false && Boolean(institutionalData);
  const institutionalDirection = institutionalAvailable && ['bullish', 'bearish'].includes(institutional?.direction)
    ? institutional.direction
    : 'neutral';

  let status = quantitativeDirection;
  let summary = `量價資金${directionLabel(quantitativeDirection)}。`;
  if (market === 'TW' && institutionalAvailable) {
    if (quantitativeDirection === 'neutral') {
      status = 'watch';
      summary = `法人${directionLabel(institutionalDirection)}，但 CMF20／OBV／MFI 尚未共同確認。`;
    } else if (institutionalDirection === 'neutral') {
      status = 'watch';
      summary = `量價資金${directionLabel(quantitativeDirection)}，但法人方向尚未確認。`;
    } else if (institutionalDirection === quantitativeDirection) {
      status = quantitativeDirection;
      summary = `法人與量價資金一致${directionLabel(status)}。`;
    } else {
      status = 'watch';
      summary = `法人${directionLabel(institutionalDirection)}、量價資金${directionLabel(quantitativeDirection)}，訊號分歧。`;
    }
  } else if (!quantitativeAvailable) {
    status = institutionalAvailable ? institutionalDirection : 'unavailable';
    summary = institutionalAvailable ? `僅法人資料可用，目前${directionLabel(institutionalDirection)}。` : '籌碼金流資料不足。';
  } else if (quantitativeDirection === 'neutral') {
    status = 'watch';
    summary = 'CMF20／OBV／MFI 尚未共同確認方向。';
  }

  return {
    status,
    available: status !== 'unavailable',
    bullish: status === 'bullish',
    bearish: status === 'bearish',
    source: market === 'TW' ? '法人＋CMF20／OBV／MFI' : 'CMF20／OBV／MFI',
    summary,
    cmf,
    obv,
    obvStrong,
    obvWeak,
    mfi,
    previousMfi,
    mfiRecovering,
    quantitativeDirection,
    institutionalAvailable,
    institutionalDirection,
    institutionalReason: institutional?.reason || '',
  };
}
