import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateTradePlan,
  getCompletedCloseSnapshot,
  getTradePlanDisplayStatus,
  normalizeTradePlanAtrMultiplier,
  normalizeTradePlanMarket,
} from '../src/services/tradePlanCalculator.js';

test('ATR 倍數會限制在 0.5 到 4.0 並以 0.1 步進', () => {
  assert.equal(normalizeTradePlanAtrMultiplier(0.1), 0.5);
  assert.equal(normalizeTradePlanAtrMultiplier(1.56), 1.6);
  assert.equal(normalizeTradePlanAtrMultiplier(4.8), 4);
});

test('沒有固定風險額度也能建立 ATR 交易計畫', () => {
  const result = calculateTradePlan({ entryPrice: 100, atr: 2 });
  assert.equal(result.valid, true);
  assert.equal(result.stopPrice, 97);
  assert.equal(result.initialRiskPerShare, 3);
  assert.equal(result.stopDistancePercent, 3);
  assert.equal(result.positionSize, null);
  assert.equal(result.initialRiskAmount, null);
});

test('自訂 ATR 倍數會調整停損但不產生建議數量', () => {
  const result = calculateTradePlan({ entryPrice: 100, atr: 2, atrMultiplier: 2 });
  assert.equal(result.atrMultiplier, 2);
  assert.equal(result.atrStopPrice, 96);
  assert.equal(result.stopPrice, 96);
  assert.equal('suggestedShares' in result, false);
  assert.equal('suggestedPositionAmount' in result, false);
});

test('實際持股決定計畫 1R 與成本下方剩餘風險', () => {
  const result = calculateTradePlan({ entryPrice: 100, atr: 2, positionSize: 100, currentPrice: 102 });
  assert.equal(result.positionSize, 100);
  assert.equal(result.initialRiskAmount, 300);
  assert.equal(result.remainingRiskAmount, 300);
  assert.equal(result.lockedProfitAmount, 0);
  assert.equal(result.unrealizedPnlAmount, 200);
  assert.equal(result.stopOutcomeAmount, -300);
  assert.equal(result.stopOutcomePercent, -3);
});

test('FIFO 均價低於舊停損時重設基準並重新計算 1R', () => {
  const result = calculateTradePlan({
    entryPrice: 165.94,
    savedEntryPrice: 233.751,
    atr: 4.2,
    positionSize: 9,
    currentPrice: 188.5,
    initialStop: 166.171,
    initialRiskPerShare: 67.58,
    effectiveStop: 166.171,
  });

  assert.equal(result.valid, true);
  assert.equal(result.issueCode, null);
  assert.equal(result.basisMismatch, true);
  assert.equal(result.basisChanged, true);
  assert.equal(result.rebaseRequired, true);
  assert.equal(result.savedEntryPrice, 233.751);
  assert.equal(result.initialStopPrice, 159.64);
  assert.ok(Math.abs(result.initialRiskPerShare - 6.3) < 1e-8);
  assert.ok(result.stopPrice < result.entryPrice);
});

test('均價改變但舊停損仍低於成本時保留原計畫並依停損判斷狀態', () => {
  const result = calculateTradePlan({
    entryPrice: 105,
    savedEntryPrice: 100,
    atr: 2,
    currentPrice: 108,
    initialStop: 97,
    initialRiskPerShare: 3,
    effectiveStop: 98,
    highestPriceSinceEntry: 110,
  });

  assert.equal(result.rebaseRequired, false);
  assert.equal(result.basisChanged, true);
  assert.equal(result.initialStopPrice, 97);
  assert.equal(result.initialRiskPerShare, 3);
  assert.equal(result.stopPrice, 98);
  assert.equal(result.state, 'normal');
  assert.deepEqual(getTradePlanDisplayStatus(result), { state: 'normal', label: '正常' });
});

test('均價變動時仍會依實際價格與停損距離顯示警戒', () => {
  const result = calculateTradePlan({
    entryPrice: 105,
    savedEntryPrice: 100,
    atr: 2,
    currentPrice: 98.5,
    initialStop: 97,
    initialRiskPerShare: 3,
    effectiveStop: 98,
  });

  assert.equal(result.rebaseRequired, false);
  assert.equal(result.state, 'warning');
  assert.deepEqual(getTradePlanDisplayStatus(result), { state: 'warning', label: '警戒' });
});

test('缺少 ATR 時回報 ATR 缺漏，不混淆成成本基準不符', () => {
  const result = calculateTradePlan({ entryPrice: 100 });
  assert.equal(result.valid, false);
  assert.equal(result.issueCode, 'MISSING_ATR');
  assert.equal(result.basisMismatch, false);
  assert.match(result.errors.join('；'), /ATR 資料不足/);
});

test('市場名稱會正規化', () => {
  assert.equal(normalizeTradePlanMarket('Crypto'), 'CRYPTO');
  assert.equal(normalizeTradePlanMarket('TW'), 'TW');
  assert.equal(normalizeTradePlanMarket('anything'), 'US');
});

test('持倉狀態會分成正常、警戒與失效', () => {
  const base = { entryPrice: 100, atr: 2 };
  assert.equal(calculateTradePlan({ ...base, currentPrice: 105 }).state, 'normal');
  assert.equal(calculateTradePlan({ ...base, currentPrice: 97.5 }).state, 'warning');
  assert.equal(calculateTradePlan({ ...base, currentPrice: 97 }).state, 'invalid');
});

test('單純均價變動不重設停損，但仍按收盤價保留失效判斷', () => {
  const calculation = calculateTradePlan({
    entryPrice: 100,
    savedEntryPrice: 110,
    atr: 2,
    currentPrice: 96,
    isIntraday: false,
    analysis: { rows: [{ time: '2026-10-20', close: 96 }] },
  });

  assert.equal(calculation.rebaseRequired, false);
  assert.equal(calculation.state, 'invalid');
  assert.equal(calculation.confirmedInvalid, true);
  assert.deepEqual(getTradePlanDisplayStatus(calculation), { state: 'invalid', label: '失效' });
});

test('單純均價變動不影響依停損計算出的正常狀態', () => {
  const calculation = calculateTradePlan({
    entryPrice: 100,
    savedEntryPrice: 110,
    atr: 2,
    currentPrice: 105,
  });

  assert.equal(calculation.rebaseRequired, false);
  assert.equal(calculation.state, 'normal');
  assert.deepEqual(getTradePlanDisplayStatus(calculation), { state: 'normal', label: '正常' });
});

test('舊版失效後收復狀態統一顯示為失效', () => {
  assert.deepEqual(
    getTradePlanDisplayStatus({ state: 'recovered', rebaseRequired: true }),
    { state: 'invalid', label: '失效' },
  );
});

test('價格下方最近的中長期均線優先作為結構失效價', () => {
  const result = calculateTradePlan({
    entryPrice: 100,
    atr: 2,
    analysis: { latest: { ma20: 95, ma40: 92, ma60: 90 } },
  });
  assert.equal(result.structureLevel, 95);
  assert.equal(result.structureStopPrice, 94.4);
  assert.equal(result.stopPrice, 94.4);
  assert.equal(result.stopSource, 'structure');
  assert.equal(result.structureSource, 'MA20 支撐');
});

test('選用基準價下方最近的 MA40，並以固定 0.3 ATR 作結構緩衝', () => {
  const result = calculateTradePlan({
    entryPrice: 76.21,
    atr: 2.0333333333,
    analysis: { latest: { ma20: 76.4, ma40: 76.02, ma60: 70 } },
  });
  assert.equal(result.structureSource, 'MA40 支撐');
  assert.equal(result.structureLevel, 76.02);
  assert.equal(result.structureBufferAtr, 0.3);
  assert.ok(Math.abs(result.structureStopPrice - 75.41) < 1e-8);
  assert.equal(result.atrMultiplier, 1.5);
});

test('高於計算基準的均線不得成為停損來源', () => {
  const result = calculateTradePlan({
    entryPrice: 100,
    atr: 2,
    analysis: { latest: { ma20: 105, ma40: 104, ma60: 101 } },
  });
  assert.equal(result.structureAvailable, false);
  assert.equal(result.stopSource, 'atr');
  assert.equal(result.stopPrice, 97);
});

test('ATR 滑桿只調整 fallback，不改變結構外的固定緩衝', () => {
  const base = {
    entryPrice: 100,
    atr: 2,
    analysis: { latest: { ma20: 95, ma40: 92, ma60: 90 } },
  };
  const tighter = calculateTradePlan({ ...base, atrMultiplier: 1 });
  const wider = calculateTradePlan({ ...base, atrMultiplier: 3.5 });
  assert.equal(tighter.structureBufferAtr, 0.3);
  assert.equal(wider.structureBufferAtr, 0.3);
  assert.equal(tighter.stopPrice, 94.4);
  assert.equal(wider.stopPrice, 94.4);
});

test('找不到低於基準的中長期均線時回退到 ATR 防守價', () => {
  const result = calculateTradePlan({
    entryPrice: 100,
    atr: 2,
    analysis: { latest: { ma20: 105, ma40: 104, ma60: 103 } },
  });
  assert.equal(result.structureAvailable, false);
  assert.equal(result.stopPrice, 97);
  assert.equal(result.stopSource, 'atr');
});

test('均價未變時保留已設定的較緊停損、不會放寬', () => {
  const result = calculateTradePlan({
    entryPrice: 100,
    atr: 2,
    effectiveStop: 96,
    analysis: { latest: { ma20: 95, ma40: 92, ma60: 90 } },
  });
  assert.equal(result.candidateStopPrice, 94.4);
  assert.equal(result.stopPrice, 96);
  assert.equal(result.stopSource, 'tightened');
  assert.ok(Math.abs(result.initialRiskPerShare - 5.6) < 1e-8);
  assert.ok(result.stopPrice < 100);
});

test('停損固定，不因持倉創高自動推高停損', () => {
  const result = calculateTradePlan({
    entryPrice: 100,
    atr: 2,
    positionSize: 100,
    currentPrice: 110,
    initialStop: 97,
    initialRiskPerShare: 3,
    effectiveStop: 97,
    effectiveStopSource: 'atr',
    highestPriceSinceEntry: 112,
  });
  assert.equal(result.initialStopPrice, 97);
  assert.equal(result.stopPrice, 97);
  assert.equal(result.trailingAtrStop, undefined);
  assert.equal(result.candidateStopSource, 'atr');
  assert.ok(result.lockedRewardMultiple < 0);
  assert.equal(result.initialRiskAmount, 300);
  assert.ok(result.remainingRiskAmount > 0);
  assert.equal(result.lockedProfitAmount, 0);
  assert.equal(result.unrealizedPnlAmount, 1000);
  assert.ok(result.stopOutcomeAmount < 0);
  assert.ok(result.stopOutcomePercent < 0);
});

test('舊版移動停損資料只保留既有價格，不再繼續上移', () => {
  const result = calculateTradePlan({
    entryPrice: 100,
    atr: 2,
    currentPrice: 110,
    initialStop: 97,
    initialRiskPerShare: 3,
    effectiveStop: 99,
    effectiveStopSource: 'trailing_atr',
    highestPriceSinceEntry: 112,
  });

  assert.equal(result.stopPrice, 99);
  assert.equal(result.candidateStopPrice, 97);
  assert.equal(result.stopSource, 'tightened');
  assert.equal(result.stopSourceLabel, '已保留停損價');
  assert.equal(result.trailingAtrStop, undefined);
});

test('既有停損不會因持倉期間均線改變而移動', () => {
  const result = calculateTradePlan({
    entryPrice: 100,
    atr: 2,
    currentPrice: 110,
    initialStop: 97,
    initialRiskPerShare: 3,
    effectiveStop: 97,
    effectiveStopSource: 'atr',
    analysis: { latest: { ma20: 106, ma40: 103, ma60: 99 } },
  });
  assert.equal(result.holdingStructureLevel, undefined);
  assert.equal(result.holdingStructureStopPrice, undefined);
  assert.equal(result.candidateStopPrice, 97);
  assert.equal(result.candidateStopSource, 'atr');
  assert.ok(result.stopPrice < 100);
  assert.equal(result.stopPrice, 97);
  assert.equal(result.stopSource, 'atr');
});

test('既有停損不會因價格或均線上漲而往上移動', () => {
  const result = calculateTradePlan({
    entryPrice: 334.03,
    atr: 23.2933,
    currentPrice: 395.135,
    initialStop: 299.306,
    initialRiskPerShare: 34.724,
    highestPriceSinceEntry: 395.135,
    analysis: { latest: { ma20: 379.76, ma40: 391.2304, ma60: 383.54 } },
  });
  assert.equal(result.holdingStructureSource, undefined);
  assert.equal(result.holdingStructureStopPrice, undefined);
  assert.equal(result.candidateStopPrice, 299.306);
  assert.ok(result.candidateStopPrice < 334.03);
  assert.equal(result.stopPrice, 299.306);
});

test('已保存停損高於 FIFO 均價時丟棄舊停損並要求重設', () => {
  const result = calculateTradePlan({
    entryPrice: 334.03,
    atr: 23.2933,
    currentPrice: 394.79,
    initialStop: 299.306,
    initialRiskPerShare: 34.724,
    highestPriceSinceEntry: 395.135,
    effectiveStop: 384.2424,
    effectiveStopSource: 'structure',
    analysis: { latest: { ma20: 379.75, ma40: 391.2217, ma60: 383.53 } },
  });
  assert.equal(result.rebaseRequired, true);
  assert.equal(result.basisMismatch, true);
  assert.ok(result.stopPrice < result.entryPrice);
  assert.ok(result.candidateStopPrice < result.entryPrice);
});

test('盤中跌破明確標示但仍列警戒，正式收盤才標記失效', () => {
  const base = { entryPrice: 100, atr: 2, currentPrice: 96, initialStop: 97, initialRiskPerShare: 3, effectiveStop: 97 };
  const intraday = calculateTradePlan({ ...base, isIntraday: true });
  assert.equal(intraday.state, 'warning');
  assert.match(intraday.stateReason, /盤中價格已跌破.*收盤確認前維持警戒/);
  assert.equal(calculateTradePlan({ ...base, isIntraday: false }).state, 'invalid');
});

test('盤中剛好觸及停損時標示觸及並維持警戒', () => {
  const result = calculateTradePlan({
    entryPrice: 100,
    atr: 2,
    currentPrice: 97,
    initialStop: 97,
    initialRiskPerShare: 3,
    effectiveStop: 97,
    isIntraday: true,
  });
  assert.equal(result.state, 'warning');
  assert.match(result.stateReason, /盤中價格已觸及.*收盤確認前維持警戒/);
});

test('盤中行情以前一根日 K 確認失效，最新價收復時改列待重建', () => {
  const analysis = {
    rows: [
      { time: '2026-10-09', close: 96 },
      { time: '2026-10-12', close: 98 },
    ],
  };
  const result = calculateTradePlan({
    entryPrice: 100,
    atr: 2,
    currentPrice: 98,
    isIntraday: true,
    analysis,
    initialStop: 97,
    initialRiskPerShare: 3,
    effectiveStop: 97,
    effectiveStopEvaluatedAt: '2026-10-08T20:00:00Z',
    marketType: 'US',
  });
  assert.equal(getCompletedCloseSnapshot(analysis, true)?.date, '2026-10-09');
  assert.equal(result.state, 'invalid');
  assert.equal(result.confirmedInvalid, true);
  assert.equal(result.recoveredAfterInvalidation, true);
  assert.equal(result.invalidationStopPrice, 97);
  assert.equal(result.newlyConfirmedInvalid, true);
  assert.equal(result.invalidationPrice, 96);
  assert.equal(result.invalidationSessionDate, '2026-10-09');
});

test('已確認失效後價格收復會顯示待重建但保留失效紀錄', () => {
  const result = calculateTradePlan({
    entryPrice: 100,
    atr: 2,
    currentPrice: 110,
    isIntraday: true,
    initialStop: 97,
    initialRiskPerShare: 3,
    effectiveStop: 97,
    confirmedInvalidAt: '2026-10-10T01:00:00Z',
    confirmedInvalidPrice: 96,
    confirmedInvalidSessionDate: '2026-10-09',
  });
  assert.equal(result.state, 'invalid');
  assert.equal(result.confirmedInvalid, true);
  assert.equal(result.recoveredAfterInvalidation, true);
  assert.equal(result.invalidationStopPrice, 97);
  assert.equal(result.newlyConfirmedInvalid, false);
  assert.match(result.stateReason, /已收復原停損/);
  assert.match(result.stateReason, /狀態仍列為失效/);
});

test('已確認失效且最新價格仍在停損下方會保持風控失效', () => {
  const result = calculateTradePlan({
    entryPrice: 100,
    atr: 2,
    currentPrice: 95,
    isIntraday: true,
    initialStop: 97,
    initialRiskPerShare: 3,
    effectiveStop: 97,
    confirmedInvalidAt: '2026-10-10T01:00:00Z',
    confirmedInvalidPrice: 96,
    confirmedInvalidSessionDate: '2026-10-09',
  });
  assert.equal(result.state, 'invalid');
  assert.equal(result.confirmedInvalid, true);
  assert.equal(result.recoveredAfterInvalidation, false);
  assert.match(result.stateReason, /風控失效已確認/);
});

test('失效後分開計算原停損、失效確認價與目前價格損益', () => {
  const result = calculateTradePlan({
    entryPrice: 172.487,
    atr: 4,
    positionSize: 19,
    currentPrice: 149.3,
    isIntraday: true,
    initialStop: 166.171,
    initialRiskPerShare: 8.892,
    effectiveStop: 166.171,
    confirmedInvalidAt: '2026-10-10T01:00:00Z',
    confirmedInvalidPrice: 164.17,
    confirmedInvalidSessionDate: '2026-10-09',
  });
  assert.ok(Math.abs(result.stopOutcomePercent - (-3.6617)) < 0.001);
  assert.ok(Math.abs(result.invalidationOutcomePercent - (-4.8218)) < 0.001);
  assert.ok(Math.abs(result.unrealizedPnlPercent - (-13.4427)) < 0.001);
  assert.ok(result.unrealizedPnlAmount < result.invalidationOutcomeAmount);
});

test('今天才提高的停損不會回頭讓昨天的收盤失效', () => {
  const result = calculateTradePlan({
    entryPrice: 100,
    atr: 2,
    currentPrice: 110,
    isIntraday: true,
    analysis: {
      rows: [
        { time: '2026-10-09', close: 100 },
        { time: '2026-10-12', close: 110 },
      ],
    },
    initialStop: 95,
    initialRiskPerShare: 5,
    effectiveStop: 105,
    effectiveStopEvaluatedAt: '2026-10-12T14:00:00Z',
    marketType: 'US',
  });
  assert.equal(result.confirmedStopPrice, 97);
  assert.equal(result.newlyConfirmedInvalid, false);
  assert.equal(result.state, 'normal');
});

test('舊停損高於均價時重新計算，且不再使用移動 ATR 停損來源', () => {
  const result = calculateTradePlan({
    entryPrice: 100,
    atr: 2,
    currentPrice: 108,
    initialStop: 95,
    initialRiskPerShare: 5,
    highestPriceSinceEntry: 115,
    effectiveStop: 108,
    effectiveStopSource: 'trailing_atr',
  });
  assert.equal(result.rebaseRequired, true);
  assert.equal(result.highestPriceSinceEntry, 108);
  assert.equal(result.initialRiskPerShare, 3);
  assert.ok(result.stopPrice < 100);
  assert.equal(result.stopSource, 'atr');
});
