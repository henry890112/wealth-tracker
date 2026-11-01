import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { TTM_SQUEEZE_PRESET_OPTIONS, MA_SWING_PERIOD_OPTIONS } from '../../../services/strategyEngines.js';

const money = value => Number(value || 0).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const maSwingPeriodLabel = period => period == null ? '無' : `MA${period}`;
const maSwingOptionLabel = period => period == null ? '無' : `${period} 日`;

export default function StrategyLibraryCard({ strategy, result, colors, isReplay = false, asOfDate = null, squeezePreset = 'standard', onSqueezePresetChange = null, maSwingSettings, onMaSwingChange, styles, statusMeta }) {
  const [expanded, setExpanded] = useState(true);
  const [showRules, setShowRules] = useState(false);
  if (!strategy) return null;
  const live = result?.computed;
  const meta = live ? statusMeta(result, colors) : { label: '研究框架', color: colors.accent };
  const signal = result?.signal || result?.latestEvent || result?.events?.at(-1);
  const obvText = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 0 }) : '—';
  const isTtmSqueeze = strategy.key === 'indicator-bollinger-squeeze';
  const isMoneyFlowDivergence = ['volume-mfi-divergence', 'volume-cmf-divergence'].includes(result?.key);
  const isMarketStructure = result?.key === 'trend-market-structure';
  const ttmRows = isTtmSqueeze && live ? [
    ['Squeeze 狀態', signal?.squeezeOn ? `ON · 已壓縮 ${signal.squeezeBars || 0} 根` : signal?.releaseTime ? `已釋放 · ${signal.releaseTime}` : 'OFF／未形成完整擠壓'],
    ['KC 參數', `EMA20 ± ATR20 × ${Number(signal?.kcMultiplier || 0).toFixed(2)}`],
    ['突破條件', `${signal?.rangeHigh != null ? money(signal.rangeHigh) : '—'} ／ ${signal?.rangeLow != null ? money(signal.rangeLow) : '—'} · ${signal?.breakoutPassed ? '已通過' : '未通過'}`],
    ['量能條件', `RVOL ${Number(signal?.volumeRatio || 0).toFixed(2)} 倍／門檻 ${Number(signal?.volumeThreshold || 0).toFixed(2)} · ${signal?.volumePassed ? '已通過' : '未通過'}`],
    ['TTM 動能', `${Number.isFinite(Number(signal?.momentum)) ? Number(signal.momentum).toFixed(2) : '—'} · ${signal?.momentumPassed && signal?.momentumStrengthened ? '同向已通過' : '尚未確認'}`],
    ['確認規則', `釋放後 ${signal?.confirmationWindow || 3} 根內，突破＋量能＋動能同向才確認`],
  ] : [];
  const liveRows = live ? [
    [isReplay ? '歷史狀態' : '即時狀態', meta.label],
    [isReplay ? '截至當日判定' : '即時判定', result.reason],
    ...ttmRows,
    result?.key === 'indicator-kd-cross' ? ['判斷門檻', '黃金：K 上穿 D 且 K 或 D ≤ 35；死亡：K 下穿 D 且 K 或 D ≥ 65'] : null,
    isMarketStructure && signal?.structureLabel ? ['目前結構', signal.structureBroken ? `${signal.structureLabel} 已受破壞，等待反向結構確認` : signal.structureLabel] : null,
    isMarketStructure && signal?.previousHigh != null && signal?.latestHigh != null ? ['波段高點', `${signal.previousHighTime} ${money(signal.previousHigh)} → ${signal.latestHighTime} ${money(signal.latestHigh)}（${signal.highState === 'EH' ? '持平，待確認' : signal.highState}）`] : null,
    isMarketStructure && signal?.previousLow != null && signal?.latestLow != null ? ['波段低點', `${signal.previousLowTime} ${money(signal.previousLow)} → ${signal.latestLowTime} ${money(signal.latestLow)}（${signal.lowState === 'EL' ? '持平，待確認' : signal.lowState}）`] : null,
    isMarketStructure && signal?.candidatePivotTime ? ['候選轉折', `${signal.candidatePivotTime} ${money(signal.candidatePivotValue)} 候選${signal.candidatePivotKind === 'high' ? '高點' : '低點'}；尚待右側 ${signal.candidateBarsRemaining || 0} 根 K 線`] : null,
    isMarketStructure ? ['轉折確認', `高低點必須依時間交錯，且左右各 ${signal?.pivotStrength || 3} 根 K 線；最新未完成轉折只以灰色虛線顯示`] : null,
    result?.key === 'volume-obv-divergence' && signal?.firstTime && signal?.secondTime ? ['背離區間', `${signal.firstTime} → ${signal.secondTime}`] : null,
    result?.key === 'volume-obv-divergence' && signal?.firstPrice != null && signal?.secondPrice != null ? ['價格轉折', `${money(signal.firstPrice)} → ${money(signal.secondPrice)}`] : null,
    result?.key === 'volume-obv-divergence' && signal?.firstObv != null && signal?.secondObv != null ? ['OBV 轉折', `${obvText(signal.firstObv)} → ${obvText(signal.secondObv)}`] : null,
    isMoneyFlowDivergence && signal?.firstTime && signal?.secondTime ? ['背離區間', `${signal.firstTime} → ${signal.secondTime}`] : null,
    isMoneyFlowDivergence && signal?.firstPrice != null && signal?.secondPrice != null ? ['價格轉折', `${money(signal.firstPrice)} → ${money(signal.secondPrice)}`] : null,
    isMoneyFlowDivergence && signal?.firstIndicator != null && signal?.secondIndicator != null ? [`${signal.indicatorName} 轉折`, `${Number(signal.firstIndicator).toFixed(signal.indicatorName === 'MFI' ? 1 : 2)} → ${Number(signal.secondIndicator).toFixed(signal.indicatorName === 'MFI' ? 1 : 2)}`] : null,
    isMoneyFlowDivergence && signal?.confirmationLevel != null ? ['價格確認線', money(signal.confirmationLevel)] : null,
    isMoneyFlowDivergence ? ['背離共振', signal?.resonance ? `是 · 同時出現 ${signal.resonanceWith} 同方向背離` : '否 · 僅本指標成立'] : null,
    signal?.entryLower != null && signal?.entryUpper != null ? ['計算進場區', `${money(signal.entryLower)}–${money(signal.entryUpper)}`] : null,
    signal?.stop != null ? ['計算停損／失效', money(signal.stop)] : null,
    signal?.target != null || signal?.target1 != null ? ['計算目標', money(signal.target ?? signal.target1)] : null,
  ].filter(Boolean) : [];
  const rows = [
    ['適用環境', strategy.market],
    ['進場觸發', strategy.trigger],
    ['失效／停損', strategy.invalidation],
    ['退場邏輯', strategy.exit],
    ['主要優點', strategy.pros],
    ['主要風險', strategy.risks],
  ];
  return (
    <View style={[styles.strategyCard, styles.compactStrategyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.strategyHeader}>
        <View style={styles.flex}>
          <Text style={[styles.selectedEyebrow, { color: colors.accent }]}>{live ? (isReplay ? `策略庫 · 歷史回放截至 ${asOfDate || '—'}` : '策略庫 · 即時計算') : '策略庫 · 研究框架'}</Text>
          <Text style={[styles.strategyTitle, { color: colors.text }]}>{strategy.label}</Text>
          <Text style={[styles.strategyIntro, { color: colors.textSub }]}>{strategy.category}</Text>
        </View>
        <View style={styles.collapsibleStatus}>
          <View style={[styles.strategyBadge, { backgroundColor: `${meta.color}18`, borderColor: meta.color }]}>
            <Text style={[styles.strategyBadgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
          {expanded ? <ChevronUp size={18} color={colors.textMuted} /> : <ChevronDown size={18} color={colors.textMuted} />}
        </View>
      </TouchableOpacity>
      {expanded && <>
      {strategy.key === 'trend-ma-swing' && <View style={[styles.squeezePresetPanel, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
        <Text style={[styles.squeezePresetTitle, { color: colors.text }]}>進出場均線（日 K・簡單移動平均）</Text>
        {[['entry', '進場線'], ['shortExit', '第一段出場（賣 50%）'], ['longExit', '全部出場']].map(([key, label]) => <View key={key} style={{ gap: 6 }}>
          <Text style={[styles.squeezePresetValue, { color: colors.text }]}>{label} · {maSwingPeriodLabel(maSwingSettings?.[key])}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {MA_SWING_PERIOD_OPTIONS.map(period => <TouchableOpacity key={period == null ? 'none' : period} disabled={!onMaSwingChange}
              accessibilityRole="button" accessibilityLabel={`${label} ${period == null ? '不使用' : `${period} 日均線`}`} accessibilityState={{ selected: maSwingSettings?.[key] === period, disabled: !onMaSwingChange }}
              onPress={() => onMaSwingChange(key, period)}
              style={[styles.squeezePresetButton, { flex: 0, minWidth: 54, minHeight: 44, backgroundColor: maSwingSettings?.[key] === period ? colors.accentSoft : colors.card, borderColor: maSwingSettings?.[key] === period ? colors.accent : colors.border }]}>
              <Text style={[styles.squeezePresetButtonText, { color: maSwingSettings?.[key] === period ? colors.accent : colors.textSub }]}>{maSwingOptionLabel(period)}</Text>
            </TouchableOpacity>)}
          </ScrollView>
        </View>)}
        {[['abovePeriod', '收盤站在'], ['risingPeriod', '近 5 日呈上揚']].map(([key, label]) => {
          const period = maSwingSettings?.[key];
          const currentLabel = key === 'abovePeriod'
            ? period == null ? '收盤站在均線上方 · 不限制' : `收盤站在 ${maSwingPeriodLabel(period)} 上方`
            : period == null ? '均線近 5 日呈上揚 · 不限制' : `${maSwingPeriodLabel(period)} ${label}`;
          return <View key={key} style={{ gap: 6 }}>
            <Text style={[styles.squeezePresetValue, { color: colors.text }]}>{currentLabel}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {MA_SWING_PERIOD_OPTIONS.map(option => <TouchableOpacity key={option == null ? 'none' : option} disabled={!onMaSwingChange}
                accessibilityRole="button" accessibilityLabel={`${currentLabel} ${option == null ? '不限制' : `使用 ${option} 日均線`}`} accessibilityState={{ selected: period === option, disabled: !onMaSwingChange }}
                onPress={() => onMaSwingChange(key, option)}
                style={[styles.squeezePresetButton, { flex: 0, minWidth: 54, minHeight: 44, backgroundColor: period === option ? colors.accentSoft : colors.card, borderColor: period === option ? colors.accent : colors.border }]}>
                <Text style={[styles.squeezePresetButtonText, { color: period === option ? colors.accent : colors.textSub }]}>{maSwingOptionLabel(option)}</Text>
              </TouchableOpacity>)}
            </ScrollView>
          </View>;
        })}
        <Text style={[styles.squeezePresetHint, { color: colors.textMuted }]}>點選即重算訊號與圖上標記。第一段出場均線不得長於全部出場均線；若選擇衝突值，另一條會自動調整。兩個趨勢濾網可分別指定均線，選「無」代表不限制。設定記於本機，不同步推播規則、不修改交易計畫停損、不會下單。</Text>
      </View>}
      {isTtmSqueeze && <View style={[styles.squeezePresetPanel, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
        <View style={styles.squeezePresetHeader}><Text style={[styles.squeezePresetTitle, { color: colors.text }]}>TTM Squeeze 敏感度</Text><Text style={[styles.squeezePresetValue, { color: colors.accent }]}>{TTM_SQUEEZE_PRESET_OPTIONS.find(option => option.key === squeezePreset)?.label || '標準'}</Text></View>
        <View style={styles.squeezePresetButtons}>{TTM_SQUEEZE_PRESET_OPTIONS.map(option => <TouchableOpacity key={option.key} disabled={!onSqueezePresetChange} onPress={() => onSqueezePresetChange?.(option.key)} style={[styles.squeezePresetButton, { backgroundColor: squeezePreset === option.key ? colors.accentSoft : colors.card, borderColor: squeezePreset === option.key ? colors.accent : colors.border }]}><Text style={[styles.squeezePresetButtonText, { color: squeezePreset === option.key ? colors.accent : colors.textSub }]}>{option.label}</Text></TouchableOpacity>)}</View>
        <Text style={[styles.squeezePresetHint, { color: colors.textMuted }]}>積極較早出訊號；保守需要更長擠壓、較高量能與更明確動能。預設為標準。</Text>
      </View>}
      {liveRows.length > 0 && <View style={[styles.metricList, { borderTopColor: colors.borderLight }]}>
        {liveRows.map(([label, value]) => (
          <View key={label} style={[styles.strategyLibraryRow, styles.compactLibraryRow, { borderBottomColor: colors.borderLight }]}>
            <Text style={[styles.strategyLibraryLabel, styles.compactLibraryLabel, { color: colors.accent }]}>{label}</Text>
            <Text style={[styles.strategyLibraryValue, styles.compactLibraryValue, { color: colors.text }]}>{value}</Text>
          </View>
        ))}
      </View>}
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showRules }} onPress={() => setShowRules(value => !value)} style={styles.compactDisclosure}>
        <Text style={[styles.guideTitle, { color: colors.accent }]}>策略規則與風險</Text>
        {showRules ? <ChevronUp size={16} color={colors.accent} /> : <ChevronDown size={16} color={colors.accent} />}
      </TouchableOpacity>
      {showRules && <><View style={[styles.metricList, { borderTopColor: colors.borderLight }]}>
        {rows.map(([label, value]) => (
          <View key={label} style={[styles.strategyLibraryRow, styles.compactLibraryRow, { borderBottomColor: colors.borderLight }]}>
            <Text style={[styles.strategyLibraryLabel, styles.compactLibraryLabel, { color: colors.textMuted }]}>{label}</Text>
            <Text style={[styles.strategyLibraryValue, styles.compactLibraryValue, { color: colors.textSub }]}>{value}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.guideBlock, { backgroundColor: colors.cardAlt }]}>
        <Text style={[styles.guideTitle, { color: colors.text }]}>使用提醒</Text>
        <Text style={[styles.guideText, { color: colors.textSub }]}>{live ? `${isReplay ? '圖上線條、標記與本卡片數值只使用截至回放日期的 K 線計算；' : '圖上線條、標記與本卡片數值會隨目前 K 線重新計算；'}訊號只代表研究條件成立，不構成自動下單或買賣建議。` : '此策略已加入多市場策略庫，目前提供一致的研究欄位與風險說明。'}</Text>
      </View>
      </>}
      </>}
    </View>
  );
}
