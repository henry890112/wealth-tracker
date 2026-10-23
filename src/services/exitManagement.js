import { evaluateCapitalFlow } from './capitalFlow';

export const ATR_MULTIPLIER_MIN = 0.5;
export const ATR_MULTIPLIER_MAX = 4;
export const ATR_MULTIPLIER_STEP = 0.1;
export const ATR_MULTIPLIER_DEFAULT = 1.5;

export const normalizeAtrMultiplier = value => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return ATR_MULTIPLIER_DEFAULT;
  const stepped = Math.round(numeric / ATR_MULTIPLIER_STEP) * ATR_MULTIPLIER_STEP;
  return Math.max(ATR_MULTIPLIER_MIN, Math.min(ATR_MULTIPLIER_MAX, Number(stepped.toFixed(1))));
};

const finite = value => Number.isFinite(Number(value));
const numeric = value => (finite(value) ? Number(value) : null);
const nearestAbove = (levels, price) => (levels || [])
  .map(item => numeric(item?.price ?? item))
  .filter(value => value != null && value > price)
  .sort((a, b) => a - b);
const nearestBelow = (levels, price) => (levels || [])
  .map(item => numeric(item?.price ?? item))
  .filter(value => value != null && value < price)
  .sort((a, b) => b - a);

const statusText = status => ({
  hold: '續抱',
  tighten: '收緊停損',
  reduce: '減碼觀察',
  exit: '出倉',
  unavailable: '資料不足',
}[status] || '觀察');

export function calculateExitManagement({
  analysis,
  averageCost = 0,
  atrMultiplier = ATR_MULTIPLIER_DEFAULT,
  atrPosition = null,
  marketType = 'TW',
  excludeLatest = false,
} = {}) {
  const latest = analysis?.latest;
  if (!latest) return { status: 'unavailable', statusLabel: statusText('unavailable'), reason: '尚無可用的技術資料。' };

  const multiplier = normalizeAtrMultiplier(atrMultiplier);
  const close = numeric(latest.close);
  const atr14 = numeric(latest.atr14);
  if (!(close > 0) || !(atr14 > 0)) {
    return { status: 'unavailable', statusLabel: statusText('unavailable'), reason: '需要最新收盤價與 ATR14 才能計算停損停利。', atrMultiplier: multiplier };
  }

  const costEntry = numeric(averageCost);
  const persistedEntry = numeric(atrPosition?.entry_price);
  // The standalone exit plan is for the user's actual holding. Prefer the
  // holding's average cost; the persisted Hybrid entry is only a fallback for
  // the displayed calculation basis, never for the independent stop state.
  const entry = costEntry > 0 ? costEntry : persistedEntry || close;
  const basis = costEntry > 0 ? '持倉平均成本' : persistedEntry ? '正式持倉進場價' : '最新收盤試算';
  const supports = nearestBelow(analysis.supports, entry);
  const resistances = nearestAbove(analysis.resistances, close);
  const structuralStop = supports[0] || null;
  const atrStop = entry - atr14 * multiplier;
  const initialStop = Math.min(structuralStop || atrStop, atrStop);
  // This card is deliberately independent from the persisted Hybrid
  // position. Reusing that position's historical highest/effective stop can
  // produce a stop above the user's average cost and falsely force `exit`.
  // Without a separately persisted holding entry date/high, use the cost and
  // current close as the conservative standalone trailing reference.
  const highest = Math.max(entry, close);
  const trailingStop = highest - atr14 * multiplier;
  const effectiveStop = Math.max(initialStop, trailingStop);
  const stopMode = highest > entry ? '成本／目前價動態試算' : '初始 ATR 防線';
  const risk = Math.abs(entry - initialStop);
  const target1 = resistances[0] || (entry + risk);
  const target2 = resistances[1] || (entry + risk * 2);

  const ma20 = numeric(latest.ma20);
  const ma40 = numeric(latest.ma40);
  const maBearish = (ma40 != null && close < ma40) || (ma20 != null && ma40 != null && ma20 < ma40);
  const maWatch = !maBearish && ma20 != null && close < ma20;
  const maStatus = maBearish ? 'bearish' : maWatch ? 'watch' : 'bullish';

  const capitalFlow = evaluateCapitalFlow({ analysis, marketType, excludeLatest });
  const chipBearish = capitalFlow.bearish;
  const chipStatus = capitalFlow.status;

  const atrBroken = close <= effectiveStop;
  const bearishModules = [maBearish, chipBearish].filter(Boolean).length;
  const status = atrBroken ? 'exit' : bearishModules >= 2 ? 'reduce' : maBearish || chipBearish ? 'tighten' : 'hold';
  const chipSource = capitalFlow.source;
  const reason = atrBroken
    ? `收盤 ${close.toFixed(2)} 已跌破有效停損 ${effectiveStop.toFixed(2)}。`
    : bearishModules >= 2
      ? '均線與籌碼金流同步轉弱，尚未跌破有效停損，列為減碼觀察。'
      : maBearish
        ? `收盤跌破 MA40（${ma40?.toFixed(2) || '—'}），先收緊停損。`
        : chipBearish
          ? `${chipSource}方向轉弱，搭配價格結構觀察。`
          : 'ATR 防線尚未失效，均線與籌碼金流未同步轉弱。';

  return {
    status,
    statusLabel: statusText(status),
    reason,
    atrMultiplier: multiplier,
    atr14,
    entry,
    basis,
    initialAtrStop: atrStop,
    structuralStop,
    initialStop,
    highest,
    trailingStop,
    effectiveStop,
    stopMode,
    risk,
    target1,
    target2,
    oneR: entry + risk,
    twoR: entry + risk * 2,
    maStatus,
    ma20,
    ma40,
    chipStatus,
    chipSource,
    chipReason: capitalFlow.summary,
    capitalFlow,
    atrBroken,
    bearishModules,
  };
}
