export const TRADE_PLAN_ATR_MULTIPLIER = 1.5;
export const TRADE_PLAN_ATR_MULTIPLIER_MIN = 0.5;
export const TRADE_PLAN_ATR_MULTIPLIER_MAX = 4;
export const TRADE_PLAN_ATR_MULTIPLIER_STEP = 0.1;
// 均線支撐決定「看錯的位置」，ATR 只在均線下方保留固定雜訊空間。
// 這個緩衝不跟使用者調整的 ATR fallback 倍數一起漂移。
export const TRADE_PLAN_STRUCTURE_BUFFER_ATR = 0.3;

export const normalizeTradePlanAtrMultiplier = value => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return TRADE_PLAN_ATR_MULTIPLIER;
  const clamped = Math.min(TRADE_PLAN_ATR_MULTIPLIER_MAX, Math.max(TRADE_PLAN_ATR_MULTIPLIER_MIN, parsed));
  return Number((Math.round(clamped / TRADE_PLAN_ATR_MULTIPLIER_STEP) * TRADE_PLAN_ATR_MULTIPLIER_STEP).toFixed(1));
};

export const TRADE_PLAN_STOP_SOURCE_LABELS = {
  structure: '均線結構失效價',
  atr: 'ATR 防守價',
  tightened: '已保留停損價',
};

const positive = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const normalizeTradePlanMarket = value => {
  const market = String(value || 'US').trim().toUpperCase();
  return market === 'CRYPTOCURRENCY' || market === 'CRYPTO' ? 'CRYPTO' : market === 'TW' ? 'TW' : 'US';
};

const finitePositive = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const marketTimeZone = marketType => {
  const market = normalizeTradePlanMarket(marketType);
  if (market === 'TW') return 'Asia/Taipei';
  if (market === 'US') return 'America/New_York';
  return 'UTC';
};

export const getTradePlanMarketDate = (value, marketType = 'US') => {
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: marketTimeZone(marketType),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return byType.year && byType.month && byType.day
    ? `${byType.year}-${byType.month}-${byType.day}`
    : null;
};

export const getCompletedCloseSnapshot = (analysis = {}, isIntraday = false) => {
  const rows = Array.isArray(analysis?.rows) ? analysis.rows : [];
  const row = rows.at(isIntraday ? -2 : -1);
  const price = finitePositive(row?.close);
  const date = row?.time || row?.date;
  return price && date ? { price, date: String(date) } : null;
};

/**
 * Use the nearest medium/long moving average below the calculation basis as
 * dynamic support. MA5/MA10 are intentionally excluded because they create
 * noisy stops that are too sensitive for a position-level plan.
 */
export const deriveTradePlanStructure = (analysis = {}, entryPrice) => {
  const entry = finitePositive(entryPrice);
  if (!entry) return { available: false, level: null, source: null, reason: '缺少有效計算基準價，無法建立策略失效價。' };

  const latest = analysis?.latest || {};
  const movingAverages = [
    { key: 'ma20', label: 'MA20', level: finitePositive(latest.ma20) },
    { key: 'ma40', label: 'MA40', level: finitePositive(latest.ma40) },
    { key: 'ma60', label: 'MA60', level: finitePositive(latest.ma60) },
  ]
    .filter(item => item.level && item.level < entry)
    .sort((left, right) => right.level - left.level);
  if (movingAverages.length) {
    const selected = movingAverages[0];
    return {
      available: true,
      level: selected.level,
      source: `${selected.label} 支撐`,
      reason: `採用價格下方最近的 ${selected.label} ${selected.level.toFixed(2)}；跌破均線並超出 ATR 緩衝，視為均線結構失效。`,
    };
  }

  return {
    available: false,
    level: null,
    source: null,
    reason: 'MA20／MA40／MA60 都沒有形成低於計算基準的有效支撐，改用 ATR 防守價。',
  };
};

export const calculateTradePlan = ({
  entryPrice,
  savedEntryPrice,
  atr,
  positionSize,
  currentPrice,
  isIntraday = false,
  analysis,
  effectiveStop,
  effectiveStopSource,
  initialStop,
  initialRiskPerShare,
  highestPriceSinceEntry,
  effectiveStopEvaluatedAt,
  confirmedInvalidAt,
  confirmedInvalidPrice,
  confirmedInvalidSessionDate,
  marketType = 'US',
  atrMultiplier = TRADE_PLAN_ATR_MULTIPLIER,
} = {}) => {
  const entry = positive(entryPrice);
  const savedEntry = finitePositive(savedEntryPrice);
  const atrValue = positive(atr);
  const quantity = positive(positionSize);
  const normalizedAtrMultiplier = normalizeTradePlanAtrMultiplier(atrMultiplier);
  const structureBufferAtr = TRADE_PLAN_STRUCTURE_BUFFER_ATR;
  const errors = [];
  if (!entry) errors.push('缺少有效的計算基準價');
  if (!atrValue) errors.push('ATR 資料不足');

  const savedInitialStop = finitePositive(initialStop);
  const savedEffectiveStop = finitePositive(effectiveStop);
  const basisTolerance = Math.max(1e-6, Math.abs(entry || 0) * 1e-8);
  const basisChanged = Boolean(savedEntry && entry && Math.abs(savedEntry - entry) > basisTolerance);
  const basisMismatch = Boolean(entry && [savedInitialStop, savedEffectiveStop].some(stop => stop && stop >= entry));
  // A cost-basis change alone does not disturb a valid plan. Rebase only when
  // a legacy stop would violate the invariant that stops stay below FIFO cost.
  const rebaseRequired = basisMismatch;

  // The initial stop fixes both the original 1R and the stop level. Later ATR,
  // moving-average, or price changes must not move an existing stop.
  const structure = deriveTradePlanStructure(analysis, entry);
  const atrStopPrice = entry && atrValue ? entry - atrValue * normalizedAtrMultiplier : null;
  if (atrStopPrice != null && atrStopPrice <= 0) errors.push('ATR 防守價無效');
  const structureStopPrice = structure.available && atrValue
    ? structure.level - atrValue * structureBufferAtr
    : null;
  const usableStructureStop = structureStopPrice != null && structureStopPrice > 0 && (!entry || structureStopPrice < entry);
  const calculatedInitialStop = usableStructureStop
    ? structureStopPrice
    : atrStopPrice;
  const initialStopPrice = (rebaseRequired ? null : savedInitialStop) || calculatedInitialStop;
  const normalizedPreviousStopSource = ['trailing_atr', 'breakeven'].includes(effectiveStopSource)
    ? 'tightened'
    : effectiveStopSource;
  const initialStopSource = savedInitialStop && !rebaseRequired
    ? (TRADE_PLAN_STOP_SOURCE_LABELS[normalizedPreviousStopSource] ? normalizedPreviousStopSource : 'tightened')
    : usableStructureStop ? 'structure' : 'atr';
  if (initialStopPrice != null && entry && initialStopPrice >= entry) {
    errors.push('初始停損價必須低於 FIFO 均價');
  }
  const savedInitialRisk = rebaseRequired ? null : finitePositive(initialRiskPerShare);
  const initialRisk = savedInitialRisk || (
    entry && initialStopPrice > 0 && initialStopPrice < entry
      ? entry - initialStopPrice
      : null
  );

  const livePrice = positive(currentPrice);
  const previousHigh = rebaseRequired ? null : finitePositive(highestPriceSinceEntry);
  const highestPrice = Math.max(entry || 0, livePrice || 0, previousHigh || 0) || null;
  const rewardMultiple = livePrice && entry && initialRisk
    ? (livePrice - entry) / initialRisk
    : null;

  // Stops stay below FIFO cost. An already saved tighter stop is retained,
  // but newly changing ATR/MA values never tighten or loosen it automatically.
  const maximumStopBelowEntry = entry
    ? entry - Math.min(0.01, entry * 0.01)
    : null;
  const capStopAtAverage = value => Number(value) > 0 && maximumStopBelowEntry != null
    ? Math.min(Number(value), maximumStopBelowEntry)
    : value;

  const candidateStopPrice = capStopAtAverage(initialStopPrice);
  const candidateStopSource = initialStopSource;
  const previousStop = rebaseRequired ? null : savedEffectiveStop;
  const previousStopSource = normalizedPreviousStopSource;
  const safePreviousStop = previousStop && entry && previousStop < entry ? previousStop : null;
  const stopPrice = candidateStopPrice && safePreviousStop
    ? capStopAtAverage(Math.max(candidateStopPrice, safePreviousStop))
    : candidateStopPrice;
  if (stopPrice != null && stopPrice <= 0) errors.push('停損價無效');
  const riskPerShare = initialRisk;
  const stopDistancePercent = entry && initialRisk ? initialRisk / entry * 100 : null;
  const initialRiskAmount = quantity && initialRisk ? quantity * initialRisk : null;
  const remainingRiskAmount = quantity && entry && stopPrice
    ? Math.max(0, (entry - stopPrice) * quantity)
    : null;
  const lockedProfitAmount = quantity && entry && stopPrice
    ? Math.max(0, (stopPrice - entry) * quantity)
    : null;
  const unrealizedPnlAmount = quantity && livePrice && entry
    ? (livePrice - entry) * quantity
    : null;
  const unrealizedPnlPercent = livePrice && entry
    ? (livePrice - entry) / entry * 100
    : null;
  const stopOutcomeAmount = quantity && entry && stopPrice
    ? (stopPrice - entry) * quantity
    : null;
  const stopOutcomePercent = entry && stopPrice
    ? (stopPrice - entry) / entry * 100
    : null;
  const stopSource = safePreviousStop && candidateStopPrice && safePreviousStop > candidateStopPrice + 1e-8
    ? (TRADE_PLAN_STOP_SOURCE_LABELS[previousStopSource] ? previousStopSource : 'tightened')
    : previousStopSource && safePreviousStop && Math.abs(safePreviousStop - candidateStopPrice) <= 1e-8
      ? (TRADE_PLAN_STOP_SOURCE_LABELS[previousStopSource] ? previousStopSource : initialStopSource)
      : initialStopSource;
  const structureReason = structure.available && !usableStructureStop
    ? `${structure.reason}，但加上 ATR 緩衝後不在基準價下方，改用 ATR 防守價。`
    : structure.reason;

  // An intraday quote must never downgrade a position that already closed
  // below its stop. Compare the latest completed daily close with the stop
  // that was actually in force for that session; a stop tightened afterwards
  // must not retroactively invalidate an earlier close.
  const completedClose = getCompletedCloseSnapshot(analysis, isIntraday);
  const completedSessionDate = getTradePlanMarketDate(completedClose?.date, marketType);
  const evaluatedSessionDate = getTradePlanMarketDate(effectiveStopEvaluatedAt, marketType);
  const confirmedStopPrice = safePreviousStop
    && completedSessionDate
    && evaluatedSessionDate
    && evaluatedSessionDate <= completedSessionDate
    ? previousStop
    : initialStopPrice;
  const newlyConfirmedInvalid = Boolean(
    completedClose?.price
    && confirmedStopPrice
    && completedClose.price <= confirmedStopPrice,
  );
  const persistedInvalid = !rebaseRequired && Boolean(confirmedInvalidAt);
  const confirmedInvalid = persistedInvalid || newlyConfirmedInvalid;
  const invalidatedAt = (!rebaseRequired ? confirmedInvalidAt : null) || (newlyConfirmedInvalid ? new Date().toISOString() : null);
  const invalidationPrice = (!rebaseRequired ? finitePositive(confirmedInvalidPrice) : null)
    || (newlyConfirmedInvalid ? completedClose.price : null);
  const invalidationSessionDate = (!rebaseRequired ? confirmedInvalidSessionDate : null)
    || (newlyConfirmedInvalid ? completedSessionDate : null);
  const invalidationOutcomeAmount = quantity && entry && invalidationPrice
    ? (invalidationPrice - entry) * quantity
    : null;
  const invalidationOutcomePercent = entry && invalidationPrice
    ? (invalidationPrice - entry) / entry * 100
    : null;
  const invalidationStopPrice = confirmedInvalid
    ? finitePositive(confirmedStopPrice) || finitePositive(stopPrice)
    : null;
  const recoveredAfterInvalidation = Boolean(
    confirmedInvalid
    && livePrice
    && invalidationStopPrice
    && livePrice > invalidationStopPrice,
  );

  let state = 'planned';
  let stateReason = '尚未持有，以最新價格試算部位。';
  if (confirmedInvalid) {
    state = 'invalid';
    const invalidationText = invalidationSessionDate && invalidationPrice
      ? `${invalidationSessionDate} 正式收盤 ${invalidationPrice.toFixed(2)} 已到達或跌破停損`
      : '先前正式收盤已到達或跌破停損';
    stateReason = recoveredAfterInvalidation
      ? `${invalidationText}；最新價格 ${livePrice.toFixed(2)} 已收復原停損 ${invalidationStopPrice.toFixed(2)}，狀態仍列為失效。`
      : `${invalidationText}，風控失效已確認。`;
  } else if (livePrice && stopPrice) {
    if (livePrice <= stopPrice) {
      state = isIntraday ? 'warning' : 'invalid';
      stateReason = isIntraday
        ? `盤中價格已${livePrice < stopPrice ? '跌破' : '觸及'}${TRADE_PLAN_STOP_SOURCE_LABELS[stopSource]}，收盤確認前維持警戒。`
        : `正式收盤已到達或跌破${TRADE_PLAN_STOP_SOURCE_LABELS[stopSource]}。`;
    } else if (livePrice <= stopPrice + Math.max(atrValue * 0.5, initialRisk * 0.25)) {
      state = 'warning';
      stateReason = `價格已接近${TRADE_PLAN_STOP_SOURCE_LABELS[stopSource]}，請留意收盤確認。`;
    } else {
      state = 'normal';
      stateReason = `價格仍在${TRADE_PLAN_STOP_SOURCE_LABELS[stopSource]}之上。`;
    }
  }

  const lockedRewardMultiple = entry && initialRisk && stopPrice
    ? (stopPrice - entry) / initialRisk
    : null;
  const currentStopDistancePercent = livePrice && stopPrice
    ? (livePrice - stopPrice) / livePrice * 100
    : null;
  const phase = rewardMultiple == null
    ? 'planned'
    : rewardMultiple >= 2
      ? 'take_profit'
      : rewardMultiple >= 1
        ? 'protect'
        : 'risk';

  return {
    valid: errors.length === 0,
    errors,
    issueCode: !entry ? 'MISSING_ENTRY' : !atrValue ? 'MISSING_ATR' : errors.length ? 'INVALID_PLAN' : null,
    basisMismatch,
    basisChanged,
    rebaseRequired,
    savedEntryPrice: savedEntry,
    entryPrice: entry,
    stopPrice,
    initialStopPrice,
    atrStopPrice,
    structureLevel: structure.level,
    structureCandidateSource: structure.available ? structure.source : null,
    structureCandidateStopPrice: structureStopPrice,
    structureStopPrice: usableStructureStop ? structureStopPrice : null,
    candidateStopPrice,
    candidateStopSource,
    candidateStopSourceLabel: TRADE_PLAN_STOP_SOURCE_LABELS[candidateStopSource],
    previousStop,
    stopSource,
    stopSourceLabel: TRADE_PLAN_STOP_SOURCE_LABELS[stopSource],
    structureAvailable: structure.available && usableStructureStop,
    structureSource: usableStructureStop ? structure.source : null,
    structureReason,
    atrValue,
    atrMultiplier: normalizedAtrMultiplier,
    structureBufferAtr,
    positionSize: quantity,
    riskPerShare,
    initialRiskPerShare: initialRisk,
    initialRiskAmount,
    remainingRiskAmount,
    lockedProfitAmount,
    unrealizedPnlAmount,
    unrealizedPnlPercent,
    stopOutcomeAmount,
    stopOutcomePercent,
    invalidationOutcomeAmount,
    invalidationOutcomePercent,
    stopDistancePercent,
    currentStopDistancePercent,
    highestPriceSinceEntry: highestPrice,
    rewardMultiple,
    lockedRewardMultiple,
    phase,
    state,
    stateReason,
    confirmedInvalid,
    newlyConfirmedInvalid,
    recoveredAfterInvalidation,
    invalidationStopPrice,
    invalidatedAt,
    invalidationPrice,
    invalidationSessionDate,
    completedClosePrice: completedClose?.price || null,
    completedCloseDate: completedSessionDate,
    confirmedStopPrice,
  };
};

export const TRADE_PLAN_STATE_LABELS = {
  planned: '試算',
  normal: '正常',
  warning: '警戒',
  invalid: '失效',
};

// Keep only the three actionable position states in every UI surface. These
// mappings also normalize statuses persisted by older app versions.
export const getTradePlanDisplayStatus = calculation => {
  const rawState = calculation?.state || 'planned';
  const state = rawState === 'touched' ? 'warning' : rawState === 'recovered' ? 'invalid' : rawState;
  return { state, label: TRADE_PLAN_STATE_LABELS[state] || TRADE_PLAN_STATE_LABELS.planned };
};
