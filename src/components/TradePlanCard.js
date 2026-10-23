import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  calculateTradePlan,
  normalizeTradePlanAtrMultiplier,
  TRADE_PLAN_ATR_MULTIPLIER,
  TRADE_PLAN_ATR_MULTIPLIER_MAX,
  TRADE_PLAN_ATR_MULTIPLIER_MIN,
  TRADE_PLAN_STRUCTURE_BUFFER_ATR,
  TRADE_PLAN_STATE_LABELS,
} from '../services/tradePlanCalculator';
import { loadTradePlanSettings, saveTradePlanSettings, loadTradePlanStop, saveTradePlanStop } from '../services/tradePlans';

const money = value => Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const signedMoney = (value, currency) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `${amount > 0 ? '+' : amount < 0 ? '-' : ''}${currency} ${money(Math.abs(amount))}`;
};
const defaultCurrency = marketType => String(marketType || '').toUpperCase() === 'TW' ? 'TWD' : 'USD';
function AtrMultiplierSlider({ value, colors, onChange }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const normalizedValue = normalizeTradePlanAtrMultiplier(value);
  const ratio = Math.max(0, Math.min(1, (normalizedValue - TRADE_PLAN_ATR_MULTIPLIER_MIN) / (TRADE_PLAN_ATR_MULTIPLIER_MAX - TRADE_PLAN_ATR_MULTIPLIER_MIN)));
  const update = event => {
    const x = Number(event.nativeEvent?.locationX || 0);
    const raw = TRADE_PLAN_ATR_MULTIPLIER_MIN + Math.max(0, Math.min(1, x / Math.max(1, trackWidth))) * (TRADE_PLAN_ATR_MULTIPLIER_MAX - TRADE_PLAN_ATR_MULTIPLIER_MIN);
    onChange(normalizeTradePlanAtrMultiplier(raw));
  };
  return <View style={styles.sliderBlock}>
    <View style={styles.sliderHeader}>
      <Text style={[styles.sliderLabel, { color: colors.textSub }]}>ATR 倍數</Text>
      <Text style={[styles.sliderValue, { color: colors.accent }]}>{normalizedValue.toFixed(1)}×</Text>
    </View>
    <View
      style={styles.sliderTouchArea}
      onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponderCapture={() => true}
      onMoveShouldSetResponderCapture={() => true}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={update}
      onResponderMove={update}
      onResponderRelease={update}
      onResponderTerminationRequest={() => false}
      onShouldBlockNativeResponder={() => true}
    >
      <View style={[styles.sliderTrack, { backgroundColor: colors.border }]}>
        <View style={[styles.sliderFill, { width: `${ratio * 100}%`, backgroundColor: colors.accent }]} />
        <View style={[styles.sliderThumb, { left: `${ratio * 100}%`, backgroundColor: colors.accent, borderColor: colors.card }]} />
      </View>
    </View>
    <View style={styles.sliderScale}>
      <Text style={[styles.sliderScaleText, { color: colors.textMuted }]}>0.5×</Text>
      <Text style={[styles.sliderScaleText, { color: colors.textMuted }]}>較緊</Text>
      <Text style={[styles.sliderScaleText, { color: colors.textMuted }]}>4.0×</Text>
    </View>
  </View>;
}

export default function TradePlanCard({ symbol, marketType, currency, averageCost = 0, positionSize = 0, analysis, currentPrice, isIntraday = false, colors }) {
  const latest = analysis?.latest || {};
  const latestPrice = Number(currentPrice || latest.close || 0);
  const hasPosition = Number(averageCost) > 0 && Number(positionSize) > 0;
  const calculationBasis = hasPosition ? Number(averageCost) : latestPrice;
  const atr = Number(latest.atr14 || analysis?.atr || 0);
  const assetCurrency = currency || defaultCurrency(marketType);
  const [atrMultiplier, setAtrMultiplier] = useState(TRADE_PLAN_ATR_MULTIPLIER);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [dynamicStop, setDynamicStop] = useState(null);
  const [stopLoading, setStopLoading] = useState(false);
  const [stopReady, setStopReady] = useState(false);
  const [stopError, setStopError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    loadTradePlanSettings()
      .then(settings => {
        if (!active) return;
        setAtrMultiplier(normalizeTradePlanAtrMultiplier(settings.atr_multiplier));
        setSaved(settings.saved);
      })
      .catch(error => active && setLoadError(error.message || '共用風控設定暫時無法讀取'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setDynamicStop(null);
    setStopReady(false);
    setStopError(null);
    if (!hasPosition || !symbol) {
      setStopLoading(false);
      setStopReady(true);
      return () => { active = false; };
    }
    setStopLoading(true);
    loadTradePlanStop(symbol, marketType)
      .then(stop => {
        if (!active) return;
        setDynamicStop(stop);
        setStopReady(true);
      })
      .catch(error => active && setStopError(error.message || '持倉停損狀態暫時無法讀取'))
      .finally(() => active && setStopLoading(false));
    return () => { active = false; };
  }, [symbol, marketType, hasPosition]);

  const calculation = useMemo(() => calculateTradePlan({
    entryPrice: calculationBasis,
    savedEntryPrice: dynamicStop?.entry_price,
    atr,
    positionSize: hasPosition ? Number(positionSize) : null,
    currentPrice: hasPosition ? latestPrice : null,
    isIntraday,
    analysis,
    effectiveStop: dynamicStop?.last_effective_stop,
    effectiveStopSource: dynamicStop?.last_stop_source,
    initialStop: dynamicStop?.initial_stop_price,
    initialRiskPerShare: dynamicStop?.initial_risk_per_share,
    highestPriceSinceEntry: dynamicStop?.highest_price_since_entry,
    effectiveStopEvaluatedAt: dynamicStop?.last_evaluated_at,
    confirmedInvalidAt: dynamicStop?.invalidated_at,
    confirmedInvalidPrice: dynamicStop?.invalidation_price,
    confirmedInvalidSessionDate: dynamicStop?.invalidation_session_date,
    marketType,
    atrMultiplier,
  }), [calculationBasis, atr, hasPosition, positionSize, latestPrice, isIntraday, analysis, dynamicStop, atrMultiplier]);
  const hasConfirmedInvalidation = Boolean(calculation.confirmedInvalid);
  const stateColor = calculation.state === 'invalid'
    ? colors.negative
    : !calculation.valid
      ? colors.warning
    : calculation.state === 'warning'
      ? colors.warning
      : calculation.state === 'normal' ? colors.positive : colors.accent;
  const displayedStop = hasConfirmedInvalidation && Number(calculation.invalidationStopPrice) > 0
    ? Number(calculation.invalidationStopPrice)
    : calculation.valid
      ? Number(calculation.stopPrice || 0)
      : calculation.rebaseRequired
      ? 0
      : Number(dynamicStop?.last_effective_stop || calculation.initialStopPrice || 0);
  const selectedMa = String(calculation.structureCandidateSource || '').split(' ')[0];
  const maComparison = [
    ['MA20', latest.ma20],
    ['MA40', latest.ma40],
    ['MA60', latest.ma60],
  ].flatMap(([label, value]) => {
    const level = Number(value);
    if (!(level > 0)) return [];
    const reason = level >= calculationBasis
      ? '不低於基準，排除'
      : label === selectedMa
        ? '下方最近，採用'
        : '低於基準但較遠';
    return [`${label} ${money(level)}（${reason}）`];
  }).join('；');
  const stopCalculationText = calculation.structureAvailable && calculation.structureLevel > 0
    ? `計算基準為${hasPosition ? '持有均價' : '最新收盤價'} ${money(calculationBasis)}；${maComparison}。因此採用${hasPosition ? '均價' : '收盤價'}下方第一條均線 ${calculation.structureSource}。結構停損參考＝${money(calculation.structureLevel)} − ATR14 ${money(calculation.atrValue)} × 固定緩衝 ${Number(calculation.structureBufferAtr || TRADE_PLAN_STRUCTURE_BUFFER_ATR).toFixed(1)}＝${money(calculation.structureStopPrice)}。MA5／MA10 不納入部位停損比較。`
    : calculation.structureCandidateSource && calculation.structureLevel > 0 && calculation.atrValue > 0
      ? `基準 ${money(calculationBasis)}；${maComparison}。${calculation.structureCandidateSource} 扣除 0.3×ATR 後的候選價 ${money(calculation.structureCandidateStopPrice)} 不符合停損條件，因此改用 ATR 回退。`
      : calculation.atrValue > 0
        ? `基準 ${money(calculationBasis)}；${maComparison || '沒有可用的 MA20／MA40／MA60 支撐'}。ATR 回退候選價＝${money(calculationBasis)} − ATR14 ${money(calculation.atrValue)} × ${atrMultiplier.toFixed(1)}＝${money(calculation.atrStopPrice)}。`
        : `目前缺少 ATR14，無法計出停損候選價。規則會先找基準價下方最近的 MA20／MA40／MA60；只有找不到可用均線時，才用 ATR 倍數回退。`;
  const savedStopExplanation = hasPosition && dynamicStop?.initial_stop_price
    ? `已保存的初始停損為 ${money(dynamicStop.initial_stop_price)}，每股初始風險（1R）為 ${money(dynamicStop.initial_risk_per_share)}；目前停損 ${money(displayedStop)}${displayedStop > Number(dynamicStop.initial_stop_price) ? ' 是先前已保存的較緊停損' : ' 與初始停損相同'}。建立計畫時的 MA／ATR 數值沒有另外留存，因此上面的公式是用最新技術資料說明「現在會選哪條均線」，不是回推初始停損的歷史輸入，也不會改寫已保存停損。`
    : `建立持倉計畫時會固定初始停損與每股 1R；上面列出本標的依目前資料選線及計算候選停損的方式。`;

  useEffect(() => {
    if (!stopReady || stopLoading || !hasPosition || !symbol || !calculation?.valid || !(Number(calculation.stopPrice) > 0)) return undefined;
    const previous = Number(dynamicStop?.last_effective_stop || 0);
    const next = Number(calculation.stopPrice);
    const nextHigh = Number(calculation.highestPriceSinceEntry || 0);
    const needsSave = calculation.rebaseRequired
      || !dynamicStop
      || next > previous + 1e-8
      || dynamicStop.last_stop_source !== calculation.stopSource
      || (calculation.confirmedInvalid && !dynamicStop.invalidated_at);
    if (!(next > 0) || !needsSave) return undefined;
    let active = true;
    saveTradePlanStop({
      symbol,
      marketType,
      entryPrice: calculation.entryPrice,
      effectiveStop: next,
      initialStop: calculation.initialStopPrice,
      initialRiskPerShare: calculation.initialRiskPerShare,
      highestPriceSinceEntry: nextHigh,
      stopSource: calculation.stopSource,
      rebaseExisting: Boolean(calculation.rebaseRequired),
      invalidatedAt: calculation.invalidatedAt,
      invalidationPrice: calculation.invalidationPrice,
      invalidationSessionDate: calculation.invalidationSessionDate,
    })
      .then(stop => active && setDynamicStop(stop))
      .catch(error => active && setStopError(error.message || '持倉停損狀態暫時無法儲存'));
    return () => { active = false; };
  }, [stopReady, stopLoading, hasPosition, symbol, marketType, calculation, dynamicStop]);

  const onSave = async () => {
    setSaving(true);
    try {
      await saveTradePlanSettings({ atrMultiplier });
      setSaved(true);
      Alert.alert('已儲存', `ATR ${atrMultiplier.toFixed(1)}× 已套用到所有標的；持倉風險會依實際數量計算。`);
    } catch (error) {
      Alert.alert('儲存失敗', error.message || '請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  const outcomeMetrics = hasConfirmedInvalidation
    ? [
      ['失效確認價', calculation.invalidationPrice > 0 ? money(calculation.invalidationPrice) : '—', colors.negative],
      ['失效確認時損益', Number.isFinite(calculation.invalidationOutcomePercent) ? `${signedMoney(calculation.invalidationOutcomeAmount, assetCurrency)}（${calculation.invalidationOutcomePercent > 0 ? '+' : ''}${calculation.invalidationOutcomePercent.toFixed(2)}%）` : '—', Number(calculation.invalidationOutcomeAmount) >= 0 ? colors.positive : colors.negative],
      ['目前價格損益', Number.isFinite(calculation.unrealizedPnlPercent) ? `${signedMoney(calculation.unrealizedPnlAmount, assetCurrency)}（${calculation.unrealizedPnlPercent > 0 ? '+' : ''}${calculation.unrealizedPnlPercent.toFixed(2)}%）` : '—', Number(calculation.unrealizedPnlAmount) >= 0 ? colors.positive : colors.negative],
    ]
    : [
      ['停損價預估損益', Number.isFinite(calculation.stopOutcomePercent) ? `${signedMoney(calculation.stopOutcomeAmount, assetCurrency)}（${calculation.stopOutcomePercent > 0 ? '+' : ''}${calculation.stopOutcomePercent.toFixed(2)}%）` : '—', Number(calculation.stopOutcomeAmount) > 0 ? colors.positive : Number(calculation.stopOutcomeAmount) < 0 ? colors.negative : colors.text],
    ];

  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.header}>
      <View style={styles.flex}>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>獨立分析 · 全標的共用</Text>
        <Text style={[styles.title, { color: colors.text }]}>交易計畫風控</Text>
        <Text style={[styles.intro, { color: colors.textSub }]}>停損在建立計畫時依均線支撐或 ATR 設定，之後不會自動移動；狀態只分正常、警戒、失效。持倉風險依實際數量計算。</Text>
      </View>
      <View style={[styles.badge, { borderColor: saved ? colors.positive : colors.warning, backgroundColor: `${saved ? colors.positive : colors.warning}18` }]}><Text style={[styles.badgeText, { color: saved ? colors.positive : colors.warning }]}>{saved ? '已套用' : '未儲存'}</Text></View>
    </View>

    {loading ? <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Text style={{ color: colors.textMuted }}>讀取共用規則…</Text></View> : <>
      {loadError && <Text style={[styles.notice, { color: colors.warning }]}>{loadError}</Text>}
      <View style={[styles.atrControl, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
        <View style={styles.atrControlHeader}>
          <View style={styles.flex}>
            <Text style={[styles.atrControlTitle, { color: colors.text }]}>ATR 防守空間</Text>
            <Text style={[styles.atrControlNote, { color: colors.textMuted }]}>用於新建立或需要重設的停損；已建立的停損不會因 ATR 或股價變動而移動。</Text>
          </View>
          <Text style={[styles.atrControlValue, { color: colors.accent }]}>{atrMultiplier.toFixed(1)}×</Text>
        </View>
        <AtrMultiplierSlider value={atrMultiplier} colors={colors} onChange={setAtrMultiplier} />
      </View>

      <View style={[styles.rule, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
        <Text style={[styles.ruleTitle, { color: colors.text }]}>本標的自動規則</Text>
        <Text style={[styles.ruleText, { color: colors.textSub }]}>{symbol} · {hasPosition ? '持有平均成本' : '最新收盤價'} {money(calculationBasis)} {assetCurrency}</Text>
        <Text style={[styles.ruleText, { color: colors.textSub }]}>初始停損＝{calculation.initialStopPrice ? money(calculation.initialStopPrice) : '—'}（建立計畫時固定）</Text>
        <Text style={[styles.ruleText, { color: colors.textSub }]}>目前停損＝{calculation.stopPrice ? money(calculation.stopPrice) : '—'}（不自動移動；已設定的較緊停損會保留）</Text>
        {hasPosition && <Text style={[styles.ruleText, { color: colors.accent }]}>目前 {Number.isFinite(calculation.rewardMultiple) ? `${calculation.rewardMultiple >= 0 ? '+' : ''}${calculation.rewardMultiple.toFixed(2)}R` : '—'}；初始 1R 固定，狀態依價格與停損位置判斷。</Text>}
        <View style={[styles.ruleExplanation, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.calculationNoteTitle, { color: colors.accent }]}>目前選線與算法 · {symbol}</Text>
          {calculation.structureAvailable && calculation.structureLevel > 0 && <Text style={[styles.ruleText, { color: colors.text }]}>目前參考 {selectedMa}（{money(calculation.structureLevel)}）：它是{hasPosition ? '成本均價' : '最新收盤價'} {money(calculationBasis)} 下方最近的一條有效均線（僅比較 MA20／MA40／MA60，依價位高低選取，不是依天數順序）。這是目前的計算參考，不代表已保存停損會跟著移動。</Text>}
          <Text style={[styles.ruleText, { color: colors.textSub }]}>{stopCalculationText}</Text>
          <Text style={[styles.ruleText, { color: colors.textMuted }]}>{savedStopExplanation}</Text>
        </View>
        {stopLoading && <Text style={[styles.ruleText, { color: colors.textMuted }]}>讀取持倉停損狀態…</Text>}
        {stopError && <Text style={[styles.error, { color: colors.warning }]}>{stopError}</Text>}
      </View>

      <View style={[styles.result, { backgroundColor: colors.cardAlt, borderColor: calculation.valid ? colors.accent : colors.warning }]}>
        <Text style={[styles.resultTitle, { color: colors.text }]}>自動試算</Text>
        {hasPosition && (calculation.valid || calculation.confirmedInvalid) && <View style={[styles.stateNotice, { borderColor: stateColor, backgroundColor: `${stateColor}14` }]}>
          <Text style={[styles.stateNoticeLabel, { color: stateColor }]}>{TRADE_PLAN_STATE_LABELS[calculation.state] || '交易計畫'}</Text>
          <Text style={[styles.stateNoticeText, { color: colors.textSub }]}>{calculation.stateReason}</Text>
        </View>}
        {[
          ['ATR 倍數', `${atrMultiplier.toFixed(1)}×`],
          ['初始停損價', calculation.initialStopPrice > 0 ? money(calculation.initialStopPrice) : '—'],
          [hasConfirmedInvalidation ? '失效時停損價' : calculation.rebaseRequired && !calculation.valid ? '停損待計算' : calculation.valid ? '目前停損價' : '已保存停損價', displayedStop > 0 ? money(displayedStop) : '—'],
          ['停損來源', calculation.valid ? calculation.stopSourceLabel : '已保存規則'],
          ['目前報酬', Number.isFinite(calculation.rewardMultiple) ? `${calculation.rewardMultiple >= 0 ? '+' : ''}${calculation.rewardMultiple.toFixed(2)}R` : '—'],
          ['停損對應風險', Number.isFinite(calculation.lockedRewardMultiple) ? `${calculation.lockedRewardMultiple >= 0 ? '+' : ''}${calculation.lockedRewardMultiple.toFixed(2)}R` : '—', colors.negative],
          ['每股／單位初始風險', calculation.initialRiskPerShare ? money(calculation.initialRiskPerShare) : '—'],
          ['實際持有數量', hasPosition ? money(calculation.positionSize) : '尚未持有'],
          ['計畫 1R 金額', Number.isFinite(calculation.initialRiskAmount) ? `${assetCurrency} ${money(calculation.initialRiskAmount)}` : '—'],
          ...outcomeMetrics,
        ].map(([label, value, valueColor]) => <View key={label} style={styles.metric}><Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text><Text style={[styles.metricValue, { color: valueColor || colors.text }]}>{value}</Text></View>)}
        {!calculation.valid && <Text style={[styles.error, { color: colors.warning }]}>{calculation.errors.join('；')}</Text>}
      </View>

      <TouchableOpacity disabled={saving} onPress={onSave} style={[styles.save, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}><Text style={[styles.saveText, { color: colors.accentContrast }]}>{saving ? '儲存中…' : '儲存並套用到所有標的'}</Text></TouchableOpacity>
      <Text style={[styles.disclaimer, { color: colors.textMuted }]}>初始停損與 1R 在建立計畫時固定，停損保持低於 FIFO 均價。{hasConfirmedInvalidation ? '失效後分開顯示正式收盤確認時與最新價格的損益。' : '停損價預估損益以目前持股及停損價計算。'}未含滑價、手續費與交易稅。盤中觸及列為警戒，正式收盤跌破列為失效，系統不會自動下單。</Text>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 13 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, flex: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: '800' }, title: { fontSize: 22, fontWeight: '900', marginTop: 3 }, intro: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  badge: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6 }, badgeText: { fontSize: 11, fontWeight: '800' },
  loading: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 8 }, notice: { fontSize: 11, lineHeight: 17 },
  atrControl: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 }, atrControlHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, atrControlTitle: { fontSize: 13, fontWeight: '900' }, atrControlValue: { fontSize: 18, fontWeight: '900' }, atrControlNote: { fontSize: 10, lineHeight: 15, marginTop: 3 },
  sliderBlock: { gap: 3 }, sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sliderLabel: { fontSize: 11, fontWeight: '800' }, sliderValue: { fontSize: 13, fontWeight: '900' }, sliderTouchArea: { height: 30, justifyContent: 'center' }, sliderTrack: { height: 8, borderRadius: 4, position: 'relative', overflow: 'visible' }, sliderFill: { height: 8, borderRadius: 4 }, sliderThumb: { position: 'absolute', top: -4, width: 16, height: 16, marginLeft: -8, borderRadius: 8, borderWidth: 2 }, sliderScale: { flexDirection: 'row', justifyContent: 'space-between' }, sliderScaleText: { fontSize: 9 },
  rule: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 5 }, ruleTitle: { fontSize: 13, fontWeight: '900' }, ruleText: { fontSize: 11, lineHeight: 17 },
  ruleExplanation: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 5, marginTop: 4 }, calculationNoteTitle: { fontSize: 11, fontWeight: '900' },
  result: { borderWidth: 1, borderRadius: 13, padding: 12, gap: 8 }, resultTitle: { fontSize: 14, fontWeight: '900', marginBottom: 2 },
  stateNotice: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 }, stateNoticeLabel: { fontSize: 12, fontWeight: '900' }, stateNoticeText: { fontSize: 10, lineHeight: 16 },
  metric: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, metricLabel: { fontSize: 11 }, metricValue: { fontSize: 12, fontWeight: '800', textAlign: 'right' }, error: { fontSize: 10, lineHeight: 16, marginTop: 4 },
  save: { minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, saveText: { fontSize: 14, fontWeight: '900' }, disclaimer: { fontSize: 10, lineHeight: 16 },
});
