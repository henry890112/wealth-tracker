import { ATR_MULTIPLIER_DEFAULT, normalizeAtrMultiplier } from './exitManagement';
import { evaluateCapitalFlow } from './capitalFlow';

const finite = value => Number.isFinite(Number(value));
const number = value => (finite(value) ? Number(value) : null);
const average = values => values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;

const statusText = status => ({
  initial: '可試單進場',
  waitEntry: '暫不進場',
  add1: '第一次加碼',
  add2: '第二次加碼',
  hold: '續抱等待',
  noAdd: '不加碼',
  tighten: '停止加碼',
  unavailable: '資料不足',
}[status] || '觀察');

export function calculateEntryScaling({
  analysis,
  averageCost = 0,
  atrMultiplier = ATR_MULTIPLIER_DEFAULT,
  excludeLatest = false,
  marketType = 'TW',
} = {}) {
  const sourceRows = Array.isArray(analysis?.rows) ? analysis.rows : [];
  const rows = excludeLatest ? sourceRows.slice(0, -1) : sourceRows;
  const latest = rows.at(-1);
  const multiplier = normalizeAtrMultiplier(atrMultiplier);
  const close = number(latest?.close);
  const atr14 = number(latest?.atr14);
  if (rows.length < 40 || !(close > 0) || !(atr14 > 0)) {
    return { status: 'unavailable', statusLabel: statusText('unavailable'), reason: '需要至少 40 根已完成 K 棒、最新收盤價與 ATR14 才能計算進場與加碼。', atrMultiplier: multiplier };
  }

  const holdingCost = number(averageCost);
  const hasPosition = holdingCost > 0;
  const entry = hasPosition ? holdingCost : close;
  const initialStop = entry - atr14 * multiplier;
  const risk = atr14 * multiplier;
  const oneR = entry + risk;
  const twoR = entry + risk * 2;
  const threeR = entry + risk * 3;

  const ma20 = number(latest.ma20);
  const ma40 = number(latest.ma40);
  const prior5 = rows.at(-6);
  const priorMa20 = number(prior5?.ma20);
  const ma20Rising = ma20 != null && priorMa20 != null && ma20 >= priorMa20;
  const aboveKeyAverage = (ma20 != null && close >= ma20) || (ma40 != null && close >= ma40);
  const goldenAlignment = ma20 != null && ma40 != null && ma20 >= ma40;
  const trendPassed = aboveKeyAverage && (ma20Rising || goldenAlignment);

  const comparisonRows = rows.slice(-21, -1);
  const platformHigh = Math.max(...comparisonRows.map(row => Number(row.high)).filter(Number.isFinite));
  const breakoutLevel = Number.isFinite(platformHigh) ? platformHigh + atr14 * multiplier : null;
  const breakoutPassed = breakoutLevel != null && close >= breakoutLevel;
  const pullbackPassed = ma20 != null
    && close >= ma20
    && Number(latest.low) >= ma20 - atr14 * multiplier
    && Number(latest.low) <= ma20 + atr14 * 0.5;
  const volatilityPassed = breakoutPassed || pullbackPassed;

  const capitalFlow = evaluateCapitalFlow({ analysis, marketType, excludeLatest });
  const { cmf, obvStrong, mfi } = capitalFlow;
  const flowPassed = capitalFlow.bullish;
  const flowWeak = capitalFlow.bearish;

  const averageVolume20 = average(comparisonRows.map(row => Number(row.volume || 0)).filter(value => value > 0));
  const volumeRatio = averageVolume20 > 0 ? Number(latest.volume || 0) / averageVolume20 : 0;
  const volumeConfirmed = volumeRatio >= 1;
  const secondWaveRows = rows.slice(-11, -1);
  const recentPullbackHeld = ma20 != null && secondWaveRows.some(row => {
    const rowMa20 = number(row.ma20) ?? ma20;
    return Number(row.low) <= rowMa20 + atr14 * 0.5
      && Number(row.low) >= rowMa20 - atr14 * multiplier
      && Number(row.close) >= rowMa20;
  });
  const secondWaveHigh = Math.max(...secondWaveRows.map(row => Number(row.high)).filter(Number.isFinite));
  const secondWaveBreakout = recentPullbackHeld && Number.isFinite(secondWaveHigh) && close > secondWaveHigh && volumeConfirmed;
  const belowCost = hasPosition && close < entry;
  const reached1R = hasPosition && close >= oneR;
  const reached2R = hasPosition && close >= twoR;
  const overextended = close >= threeR || (mfi != null && mfi >= 80);

  let status = 'hold';
  let allocation = hasPosition ? '維持目前持倉' : '等待';
  let stop = initialStop;
  let stopLabel = '進場價 − ATR 倍數';
  let reason = '尚未同時通過趨勢、ATR 與資金流條件。';

  if (!hasPosition) {
    if (trendPassed && volatilityPassed && flowPassed) {
      status = 'initial';
      allocation = '首單 30%～40%';
      reason = '均線趨勢、ATR 突破／回測與資金流三項均已確認，可建立基本倉位。';
    } else {
      status = 'waitEntry';
      allocation = '暫不進場';
      reason = `首單尚缺：${[
        !trendPassed && '均線趨勢',
        !volatilityPassed && 'ATR 突破／回測',
        !flowPassed && '資金流背書',
      ].filter(Boolean).join('、') || '無'}。`;
    }
  } else if (belowCost) {
    status = 'noAdd';
    reason = '現價仍低於持倉平均成本，禁止向下攤平；等待重新站回成本與趨勢確認。';
  } else if (overextended || flowWeak || !trendPassed) {
    status = 'tighten';
    stop = reached2R ? oneR : reached1R ? entry : initialStop;
    stopLabel = reached2R ? '上移至 1R' : reached1R ? '上移至成本' : '維持初始防線';
    reason = overextended ? '已接近 3R 或資金指標過熱，不再加碼並轉入收緊停損。' : flowWeak ? '資金流出現轉弱，不再加碼並保護既有利潤。' : '均線趨勢未通過，不加碼並等待趨勢恢復。';
  } else if (reached2R && secondWaveBreakout && !flowWeak) {
    status = 'add2';
    allocation = '最後加碼 20%';
    stop = oneR;
    stopLabel = '上移至 1R';
    reason = '價格突破 2R、均線維持多頭且量價資金未背離，符合第二次遞減加碼。';
  } else if (reached1R && volumeConfirmed && !flowWeak) {
    status = 'add1';
    allocation = '加碼 30%';
    stop = entry;
    stopLabel = '上移至成本';
    reason = '價格突破 1R且成交量確認，符合第一次順勢加碼；同步把停損提高到成本。';
  } else {
    stop = reached2R ? oneR : reached1R ? entry : initialStop;
    stopLabel = reached2R ? '上移至 1R' : reached1R ? '上移至成本' : '維持初始防線';
    reason = reached2R || reached1R ? '已達報酬門檻，但成交量或資金流尚未確認，維持持倉、不提前加碼。' : '尚未到達 1R，維持基本倉位並等待，只在獲利時加碼。';
  }

  return {
    status,
    statusLabel: statusText(status),
    reason,
    allocation,
    atrMultiplier: multiplier,
    atr14,
    entry,
    basis: hasPosition ? '持倉平均成本' : '最新已完成收盤試算',
    initialStop,
    activeStop: stop,
    stopLabel,
    risk,
    oneR,
    twoR,
    threeR,
    close,
    trendPassed,
    ma20,
    ma40,
    ma20Rising,
    volatilityPassed,
    breakoutPassed,
    pullbackPassed,
    platformHigh,
    breakoutLevel,
    flowPassed,
    flowWeak,
    cmf,
    obvStrong,
    mfi,
    capitalFlow,
    volumeRatio,
    volumeConfirmed,
    recentPullbackHeld,
    secondWaveBreakout,
    hasPosition,
  };
}
