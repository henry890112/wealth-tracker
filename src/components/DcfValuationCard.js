import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import { buildSensitivity, calculateDcf, DCF_SCENARIOS, impliedGrowthRate } from '../services/dcf';

const money = (value, currency) => Number.isFinite(Number(value)) ? `${currency === 'USD' ? '$' : 'NT$'}${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—';
const pct = value => Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}%` : '—';
const shares = value => Number.isFinite(Number(value)) ? `${(Number(value) / 1e9).toFixed(3)}B 股` : '—';
const precisionForStep = step => {
  const numeric = Math.abs(Number(step));
  if (numeric >= 1) return 0;
  if (numeric >= 0.1) return 1;
  return 2;
};

function SliderControl({ label, value, min, max, step, suffix = '%', colors, onChange }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const update = event => {
    const x = Number(event.nativeEvent?.locationX || 0);
    const next = min + Math.max(0, Math.min(1, x / Math.max(1, trackWidth))) * (max - min);
    onChange(Math.round(next / step) * step);
  };
  return <View style={styles.sliderBlock}>
    <View style={styles.sliderHeader}><Text style={[styles.sliderLabel, { color: colors.textSub }]}>{label}</Text><Text style={[styles.sliderValue, { color: colors.accent }]}>{Number(value).toFixed(precisionForStep(step))}{suffix}</Text></View>
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
    ><View style={[styles.track, { backgroundColor: colors.border }]}><View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: colors.accent }]} /><View style={[styles.thumb, { left: `${ratio * 100}%`, backgroundColor: colors.accent, borderColor: colors.card }]} /></View></View>
  </View>;
}

export default function DcfValuationCard({ data, loading, error, colors, currentPrice, onRefresh }) {
  const [tab, setTab] = useState('dcf');
  const [scenario, setScenario] = useState('conservative');
  const [wacc, setWacc] = useState(10);
  const [terminalGrowth, setTerminalGrowth] = useState(2.5);
  const [marginOfSafety, setMarginOfSafety] = useState(20);
  const [growthRates, setGrowthRates] = useState([12, 10, 8, 6, 5]);
  const input = useMemo(() => ({ ...data?.fundamentals, currentPrice, wacc, terminalGrowth, marginOfSafety, growthRates }), [data, currentPrice, wacc, terminalGrowth, marginOfSafety, growthRates]);
  const result = useMemo(() => calculateDcf(input), [input]);
  const sensitivity = useMemo(() => buildSensitivity(input), [input]);
  const implied = useMemo(() => impliedGrowthRate(input), [input]);
  const currency = data?.currency || 'TWD';
  const applyScenario = preset => {
    setScenario(preset.key);
    setWacc(preset.wacc);
    setTerminalGrowth(preset.terminalGrowth);
    setGrowthRates([...preset.growthRates]);
  };
  const customChange = setter => value => {
    setScenario('custom');
    setter(value);
  };
  const setGrowth = (index, value) => {
    setScenario('custom');
    setGrowthRates(current => current.map((item, row) => row === index ? value : item));
  };
  const qualityWarnings = Array.isArray(data?.dataQuality?.warnings) ? data.dataQuality.warnings : [];
  const basisLabel = data?.dataQuality?.periodBasis || 'TTM（近四季）';
  const sharesBasis = data?.dataQuality?.sharesBasis || '來源流通股數';

  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.header}><View><Text style={[styles.title, { color: colors.text }]}>DCF 估值</Text><Text style={[styles.subtitle, { color: colors.textMuted }]}>{data?.source || '公司財報'} · {basisLabel} 截至 {data?.asOf || '—'}</Text></View><Pressable onPress={onRefresh} disabled={loading} style={[styles.refresh, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>{loading ? <ActivityIndicator size="small" color={colors.accent} /> : <RefreshCw size={15} color={colors.textSub} />}</Pressable></View>
    {loading && !data ? <View style={styles.state}><ActivityIndicator color={colors.accent} /><Text style={[styles.stateText, { color: colors.textSub }]}>正在整理 TTM 財報…</Text></View> : error ? <View style={styles.state}><Text style={[styles.stateTitle, { color: colors.text }]}>DCF 暫不可用</Text><Text style={[styles.stateText, { color: colors.textSub }]}>{error}</Text></View> : data?.unsupported ? <View style={styles.state}><Text style={[styles.stateTitle, { color: colors.text }]}>此標的不適用 DCF</Text><Text style={[styles.stateText, { color: colors.textSub }]}>{data.reason || '缺少公司財報資料。'}</Text></View> : <>
      <View style={styles.tabs}>{[['dcf', '正向 DCF'], ['sensitivity', '敏感度'], ['reverse', '反向 DCF']].map(([key, label]) => <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, { backgroundColor: tab === key ? colors.accent : colors.cardAlt, borderColor: tab === key ? colors.accent : colors.border }]}><Text style={[styles.tabText, { color: tab === key ? colors.accentContrast : colors.textSub }]}>{label}</Text></Pressable>)}</View>
      <View style={[styles.controls, { backgroundColor: colors.cardAlt }]}><View style={styles.controlsHeader}><Text style={[styles.sectionTitle, { color: colors.text }]}>模型假設</Text><Text style={[styles.scenarioLabel, { color: colors.accent }]}>{scenario === 'custom' ? '自訂' : DCF_SCENARIOS.find(item => item.key === scenario)?.label}</Text></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scenarioRow}>{DCF_SCENARIOS.map(preset => <Pressable key={preset.key} onPress={() => applyScenario(preset)} style={[styles.scenarioButton, { backgroundColor: scenario === preset.key ? colors.accentSoft : colors.card, borderColor: scenario === preset.key ? colors.accent : colors.border }]}><Text style={[styles.scenarioButtonText, { color: scenario === preset.key ? colors.accent : colors.text }]}>{preset.label}</Text><Text style={[styles.scenarioDescription, { color: colors.textMuted }]}>{preset.description}</Text></Pressable>)}</ScrollView><SliderControl label="WACC" value={wacc} min={5} max={20} step={0.25} colors={colors} onChange={customChange(setWacc)} /><SliderControl label="永續成長率" value={terminalGrowth} min={0} max={5} step={0.1} colors={colors} onChange={customChange(setTerminalGrowth)} /><SliderControl label="安全邊際" value={marginOfSafety} min={0} max={40} step={1} colors={colors} onChange={customChange(setMarginOfSafety)} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.growthRow}>{growthRates.map((value, index) => <View key={index} style={styles.growthItem}><Text style={[styles.growthLabel, { color: colors.textMuted }]}>第 {index + 1} 年</Text><SliderControl label="成長" value={value} min={-20} max={40} step={1} colors={colors} onChange={next => setGrowth(index, next)} /></View>)}</ScrollView><Text style={[styles.assumptionHint, { color: colors.textMuted }]}>預設先用保守情境；高成長科技可點「成長型科技基準」或自行拖曳調整。情境只會改變假設，不會修改財報資料。</Text></View>
      {!result.valid ? <View style={styles.state}><Text style={[styles.stateTitle, { color: colors.warning }]}>模型無法計算</Text><Text style={[styles.stateText, { color: colors.textSub }]}>{result.invalidReason}</Text></View> : tab === 'dcf' ? <><View style={styles.hero}><Text style={[styles.heroLabel, { color: colors.textMuted }]}>每股合理價</Text><Text style={[styles.heroValue, { color: result.upside >= 0 ? colors.positive : colors.negative }]}>{money(result.fairValue, currency)}</Text><Text style={[styles.heroSub, { color: colors.textSub }]}>安全邊際價 {money(result.safetyPrice, currency)} · 相對現價 {pct(result.upside)}</Text></View><View style={styles.metrics}>{[['企業價值', result.enterpriseValue], ['股權價值', result.equityValue], ['終值現值', result.terminalPv]].map(([label, value]) => <View key={label} style={styles.metric}><Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit style={[styles.metricValue, { color: colors.text }]}>{money(value, currency)}</Text></View>)}</View><View style={[styles.audit, { backgroundColor: colors.cardAlt }]}><Text style={[styles.auditText, { color: colors.textSub }]}>流通股數 {shares(data?.fundamentals?.shares)} · 股權價值 ÷ 流通股數 = 每股合理價</Text><Text style={[styles.auditText, { color: colors.textMuted }]}>{sharesBasis}；已使用拆股後股數口徑，不會額外除以 10。</Text></View><Text style={[styles.note, { color: result.warning ? colors.warning : colors.textMuted }]}>{result.warning || `基準 FCFF ${money(data?.fundamentals?.baseFcf, currency)}；損益與現金流依 ${basisLabel}，現金與負債採最新資產負債表。`}</Text>{qualityWarnings.map(warning => <Text key={warning} style={[styles.qualityWarning, { color: colors.warning }]}>{warning}</Text>)}</> : tab === 'sensitivity' ? <><Text style={[styles.sectionTitle, { color: colors.text }]}>每股合理價敏感度（{currency}）</Text><ScrollView horizontal><View><View style={styles.matrixRow}><Text style={[styles.matrixHead, { color: colors.textMuted }]}>WACC / g</Text>{sensitivity[0].values.map(cell => <Text key={cell.terminalGrowth} style={[styles.matrixHead, { color: colors.textMuted }]}>{cell.terminalGrowth.toFixed(2)}%</Text>)}</View>{sensitivity.map(row => <View key={row.wacc} style={styles.matrixRow}><Text style={[styles.matrixHead, { color: colors.textMuted }]}>{row.wacc.toFixed(2)}%</Text>{row.values.map((cell, index) => <View key={index} style={[styles.matrixCell, { backgroundColor: cell.fairValue == null ? colors.cardAlt : colors.accentSoft }]}><Text style={[styles.matrixValue, { color: colors.text }]}>{money(cell.fairValue, currency)}</Text></View>)}</View>)}</View></ScrollView></> : <View style={styles.hero}><Text style={[styles.heroLabel, { color: colors.textMuted }]}>目前價格隱含五年年均成長率</Text><Text style={[styles.heroValue, { color: colors.accent }]}>{implied == null ? '超出搜尋範圍' : pct(implied)}</Text><Text style={[styles.heroSub, { color: colors.textSub }]}>{implied == null ? '現價不在 -50% 至 +100% 固定成長假設範圍，請改用敏感度或自訂情境。' : '若市場預期高於你的基本情境，代表估值對成長假設較敏感。'}</Text></View>}
      <Text style={[styles.disclaimer, { color: colors.textMuted }]}>DCF 為假設敏感的研究模型，不構成買賣建議；財報缺項或負自由現金流時，請謹慎解讀。</Text>
    </>}
  </View>;
}

const styles = StyleSheet.create({ card: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 12 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, title: { fontSize: 18, fontWeight: '900' }, subtitle: { fontSize: 10, marginTop: 3 }, refresh: { width: 36, height: 36, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, tabs: { flexDirection: 'row', gap: 7 }, tab: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center' }, tabText: { fontSize: 11, fontWeight: '900' }, controls: { borderRadius: 14, padding: 12, gap: 8 }, controlsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { fontSize: 14, fontWeight: '900' }, scenarioLabel: { fontSize: 10, fontWeight: '900' }, scenarioRow: { gap: 7, paddingVertical: 2 }, scenarioButton: { minWidth: 112, borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7 }, scenarioButtonText: { fontSize: 10, fontWeight: '900' }, scenarioDescription: { fontSize: 8, marginTop: 2 }, assumptionHint: { fontSize: 9, lineHeight: 14 }, sliderBlock: { gap: 4 }, sliderHeader: { flexDirection: 'row', justifyContent: 'space-between' }, sliderLabel: { fontSize: 10, fontWeight: '800' }, sliderValue: { fontSize: 10, fontWeight: '900' }, sliderTouchArea: { height: 28, justifyContent: 'center' }, track: { height: 7, borderRadius: 4, position: 'relative', overflow: 'visible' }, fill: { height: 7, borderRadius: 4 }, thumb: { position: 'absolute', top: -4, width: 15, height: 15, marginLeft: -7, borderRadius: 8, borderWidth: 2 }, growthRow: { gap: 12 }, growthItem: { width: 82 }, growthLabel: { fontSize: 9, fontWeight: '800' }, hero: { alignItems: 'center', paddingVertical: 14 }, heroLabel: { fontSize: 12 }, heroValue: { fontSize: 34, fontWeight: '900', marginVertical: 5 }, heroSub: { fontSize: 10, textAlign: 'center' }, metrics: { flexDirection: 'row', gap: 8 }, metric: { flex: 1, backgroundColor: 'rgba(127,127,127,0.08)', borderRadius: 10, padding: 9, minWidth: 0 }, metricLabel: { fontSize: 9 }, metricValue: { fontSize: 12, fontWeight: '800', marginTop: 4 }, audit: { borderRadius: 10, padding: 9, gap: 3 }, auditText: { fontSize: 9, lineHeight: 14 }, note: { fontSize: 10, lineHeight: 15 }, qualityWarning: { fontSize: 9, lineHeight: 14 }, disclaimer: { fontSize: 9, lineHeight: 14 }, state: { minHeight: 140, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 18 }, stateTitle: { fontSize: 14, fontWeight: '900' }, stateText: { fontSize: 10, lineHeight: 16, textAlign: 'center' }, matrixRow: { flexDirection: 'row', alignItems: 'center' }, matrixHead: { width: 72, textAlign: 'center', fontSize: 9, paddingVertical: 7 }, matrixCell: { width: 72, margin: 1, borderRadius: 5, paddingVertical: 8, alignItems: 'center' }, matrixValue: { fontSize: 9, fontWeight: '800' },
});
