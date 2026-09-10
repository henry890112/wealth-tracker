import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BarChart3, Bot, CircleAlert, Layers3, RefreshCw } from 'lucide-react-native';
import TechnicalAnalysisChart from '../components/TechnicalAnalysisChart';
import { analyzeTechnicalData, fetchMarketTechnicalData, technicalAnalysisPrompt } from '../services/technicalAnalysis';
import { useTheme } from '../lib/ThemeContext';

const PERIODS = [
  { key: '3M', label: '3 個月', rows: 65 },
  { key: '6M', label: '6 個月', rows: 130 },
  { key: '1Y', label: '1 年', rows: 260 },
  { key: '3Y', label: '3 年', rows: 780 },
];

const money = value => Number(value || 0).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function LevelCard({ title, levels, color, colors }) {
  return (
    <View style={[styles.summaryCard, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
      <Text style={[styles.summaryLabel, { color: colors.textSub }]}>{title}</Text>
      {levels.length ? levels.map((level, index) => (
        <View key={`${title}-${index}`} style={styles.levelRow}>
          <Text style={[styles.levelValue, { color }]}>{money(level.lower)}–{money(level.upper)}</Text>
          <Text style={[styles.levelMeta, { color: colors.textMuted }]}>{level.touches} 次測試</Text>
        </View>
      )) : <Text style={[styles.emptyValue, { color: colors.textMuted }]}>尚未形成明確區域</Text>}
    </View>
  );
}

const SIGNAL_STATUS = {
  confirmed: '已確認',
  pending: '等待確認',
  invalidated: '已失效',
  expired: '已逾期',
  stale: '確認已過期',
};

function SignalChecklist({ signal, colors }) {
  if (!signal) return null;
  const bullish = signal.type === 'bullish';
  const statusColor = signal.status === 'confirmed'
    ? (bullish ? colors.positive : colors.negative)
    : signal.status === 'pending' ? colors.warning : colors.textMuted;
  const checks = [
    { key: 'structure', label: `收盤${bullish ? '突破' : '跌破'}確認線 ${money(signal.neckline)}`, required: true },
    { key: 'momentum', label: `MACD ${bullish ? '高於' : '低於'} Signal，柱狀體${bullish ? '為正' : '為負'}`, required: true },
    { key: 'trend', label: `收盤${bullish ? '站上' : '跌破'} MA20`, required: true },
    { key: 'volume', label: `成交量達 20 日均量 1.2 倍（目前 ${Number(signal.checks?.volumeRatio || 0).toFixed(1)} 倍）`, required: false },
  ];
  const timing = signal.status === 'confirmed'
    ? `確認日 ${signal.confirmationTime}`
    : signal.status === 'invalidated' ? `失效日 ${signal.invalidationTime}`
      : signal.status === 'expired' ? `已於 ${signal.expiresAt} 超過 40 個交易日`
        : signal.status === 'stale' ? `確認效力觀察至 ${signal.expiresAt}` : `最晚觀察至 ${signal.expiresAt}`;
  return (
    <View style={[styles.signalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.signalCardHeader}><View style={styles.flex}><Text style={[styles.signalEyebrow, { color: colors.textSub }]}>最新背離訊號</Text><Text style={[styles.signalTitle, { color: colors.text }]}>{bullish ? '偏多' : '偏空'}背離 · {SIGNAL_STATUS[signal.status]}</Text></View><View style={[styles.statusBadge, { backgroundColor: `${statusColor}22`, borderColor: statusColor }]}><Text style={[styles.statusBadgeText, { color: statusColor }]}>{signal.confirmationScore}/4</Text></View></View>
      <Text style={[styles.signalTiming, { color: colors.textMuted }]}>{signal.previousTime} → {signal.time} · 可辨識日 {signal.detectedAt} · {timing}</Text>
      <View style={[styles.checkList, { borderTopColor: colors.borderLight }]}>{checks.map(item => {
        const passed = Boolean(signal.checks?.[item.key]);
        return <View key={item.key} style={styles.checkRow}><View style={[styles.checkIcon, { backgroundColor: passed ? colors.positive : colors.cardAlt, borderColor: passed ? colors.positive : colors.border }]}><Text style={{ color: passed ? '#FFFFFF' : colors.textMuted, fontSize: 9, fontWeight: '900' }}>{passed ? '✓' : '–'}</Text></View><Text style={[styles.checkText, { color: passed ? colors.text : colors.textSub }]}>{item.label}</Text><Text style={[styles.checkTag, { color: item.required ? colors.warning : colors.textMuted }]}>{item.required ? '必要' : '加分'}</Text></View>;
      })}</View>
    </View>
  );
}

function StrategyOverview({ strategies = [], currentRsi, colors }) {
  const statusMeta = item => {
    if (item.status === 'confirmed') return { label: item.direction === 'bearish' ? '偏空確認' : '偏多確認', color: item.direction === 'bearish' ? colors.negative : colors.positive };
    if (item.status === 'watch') return { label: item.direction === 'bearish' ? '偏空觀察' : '偏多觀察', color: colors.warning };
    return { label: '未成立', color: colors.textMuted };
  };
  return (
    <View style={[styles.strategyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.strategyHeader}><View><Text style={[styles.strategyTitle, { color: colors.text }]}>多策略判斷</Text><Text style={[styles.strategyIntro, { color: colors.textSub }]}>每項獨立判斷，未成立也會顯示原因。</Text></View><Text style={[styles.rsiValue, { color: colors.textSub }]}>RSI14 {Number.isFinite(currentRsi) ? currentRsi.toFixed(1) : '—'}</Text></View>
      <View style={[styles.strategyList, { borderTopColor: colors.borderLight }]}>{strategies.map(item => {
        const meta = statusMeta(item);
        return <View key={item.key} style={[styles.strategyRow, { borderBottomColor: colors.borderLight }]}><View style={styles.flex}><View style={styles.strategyNameRow}><Text style={[styles.strategyName, { color: colors.text }]}>{item.label}</Text><View style={[styles.strategyBadge, { backgroundColor: `${meta.color}18`, borderColor: meta.color }]}><Text style={[styles.strategyBadgeText, { color: meta.color }]}>{meta.label}</Text></View></View><Text style={[styles.strategyReason, { color: colors.textSub }]}>{item.reason}</Text></View></View>;
      })}</View>
    </View>
  );
}

function ConfirmationLineGuide({ signal, colors }) {
  if (!signal) {
    return <View style={[styles.lineGuide, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><View style={[styles.lineGuideIcon, { backgroundColor: colors.accentSoft }]}><Text style={[styles.lineGuideIconText, { color: colors.accent }]}>?</Text></View><View style={styles.flex}><Text style={[styles.lineGuideTitle, { color: colors.text }]}>目前沒有有效確認線</Text><Text style={[styles.lineGuideText, { color: colors.textSub }]}>必須先形成一組仍有效的 MACD 多／空背離候選。圖上的灰色失效標記只保留歷史紀錄，不會再畫成目前確認線。</Text></View></View>;
  }
  const bullish = signal.type === 'bullish';
  const status = signal.status === 'confirmed' ? '已確認' : '等待確認';
  return <View style={[styles.lineGuide, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><View style={[styles.lineGuideIcon, { backgroundColor: colors.accentSoft }]}><Text style={[styles.lineGuideIconText, { color: colors.accent }]}>?</Text></View><View style={styles.flex}><Text style={[styles.lineGuideTitle, { color: colors.text }]}>{bullish ? '多方' : '空方'}確認線 {money(signal.neckline)} · {status}</Text><Text style={[styles.lineGuideText, { color: colors.textSub }]}>{bullish ? '取兩個背離低點之間的最高價；收盤向上突破後，才確認多方結構。' : '取兩個背離高點之間的最低價；收盤向下跌破後，才確認空方結構。'}</Text></View></View>;
}

export default function TechnicalAnalysisScreen({ navigation, route }) {
  const { colors } = useTheme();
  const { symbol, name, averageCost = 0, marketType = 'TW' } = route.params || {};
  const [rawRows, setRawRows] = useState([]);
  const [period, setPeriod] = useState('1Y');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [layers, setLayers] = useState({ ma: true, levels: true, volume: true, macd: true, rsi: true, kd: true });

  const load = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setRawRows(await fetchMarketTechnicalData(symbol, marketType, 1095, forceRefresh));
    } catch (e) {
      setError(e.message || '無法載入技術資料');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [symbol, marketType]);

  const visibleRows = useMemo(() => {
    const count = PERIODS.find(item => item.key === period)?.rows || 260;
    return rawRows.slice(-count);
  }, [rawRows, period]);
  const analysis = useMemo(() => visibleRows.length >= 60 ? analyzeTechnicalData(rawRows, visibleRows.length) : null, [rawRows, visibleRows.length]);

  const askAI = () => {
    if (!analysis) return;
    navigation.navigate('AI', {
      aiRequestId: `${Date.now()}-${symbol}`,
      initialPrompt: technicalAnalysisPrompt(name || symbol, symbol, analysis),
    });
  };

  const toggleLayer = key => setLayers(current => ({ ...current, [key]: !current[key] }));
  const latestSpike = analysis?.volumeSpikes.at(-1);
  const activeDivergence = analysis?.divergences.filter(item => item.status === 'confirmed' || item.status === 'pending').at(-1);
  const latestDivergence = activeDivergence || analysis?.divergences.at(-1);

  if (loading) return <View style={[styles.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.accent} /><Text style={[styles.loadingText, { color: colors.textSub }]}>正在計算 K 線與技術指標…</Text></View>;
  if (error || !analysis) return <View style={[styles.center, { backgroundColor: colors.bg }]}><CircleAlert size={30} color={colors.warning} /><Text style={[styles.errorTitle, { color: colors.text }]}>無法產生技術圖</Text><Text style={[styles.errorText, { color: colors.textSub }]}>{error || '歷史資料不足'}</Text><TouchableOpacity style={[styles.retry, { backgroundColor: colors.accent }]} onPress={() => load(true)}><RefreshCw size={16} color={colors.accentContrast} /><Text style={[styles.retryText, { color: colors.accentContrast }]}>重新載入</Text></TouchableOpacity></View>;

  const change = analysis.latest.close - visibleRows.at(-2).close;
  const changePct = visibleRows.at(-2).close ? change / visibleRows.at(-2).close * 100 : 0;
  const changeColor = change >= 0 ? colors.positive : colors.negative;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <View style={styles.quoteRow}>
        <View style={styles.flex}><Text style={[styles.symbol, { color: colors.text }]}>{symbol}</Text><Text style={[styles.name, { color: colors.textSub }]}>{name || symbol} · 資料截至 {analysis.latest.time}</Text></View>
        <View style={styles.quoteRight}><Text style={[styles.close, { color: colors.text }]}>{money(analysis.latest.close)}</Text><Text style={[styles.change, { color: changeColor }]}>{change >= 0 ? '+' : ''}{money(change)}（{changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%）</Text></View>
      </View>

      <View style={styles.periodRow}>{PERIODS.map(item => <TouchableOpacity key={item.key} style={[styles.chip, { borderColor: period === item.key ? colors.accent : colors.border, backgroundColor: period === item.key ? colors.accentSoft : colors.card }]} onPress={() => setPeriod(item.key)}><Text style={[styles.chipText, { color: period === item.key ? colors.accent : colors.textSub }]}>{item.label}</Text></TouchableOpacity>)}</View>

      <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
        <View style={styles.chartHeader}><View style={styles.chartTitleRow}><BarChart3 size={17} color={colors.accent} /><Text style={[styles.chartTitle, { color: colors.text }]}>技術 K 線</Text></View><Text style={[styles.chartHint, { color: colors.textMuted }]}>拖曳縮放 · 點擊查看價格</Text></View>
        <TechnicalAnalysisChart analysis={analysis} colors={colors} averageCost={Number(averageCost)} layers={layers} />
      </View>

      <ConfirmationLineGuide signal={activeDivergence} colors={colors} />

      <View style={styles.layerHeader}><Layers3 size={16} color={colors.textSub} /><Text style={[styles.layerTitle, { color: colors.textSub }]}>圖層</Text></View>
      <View style={styles.layerRow}>{[
        ['ma', 'MA20/60'], ['levels', '支撐壓力'], ['volume', '爆量'], ['macd', 'MACD'], ['rsi', 'RSI14'], ['kd', 'KD'],
      ].map(([key, label]) => <TouchableOpacity key={key} style={[styles.layerChip, { backgroundColor: layers[key] ? colors.accentSoft : colors.card, borderColor: layers[key] ? colors.accent : colors.border }]} onPress={() => toggleLayer(key)}><View style={[styles.layerDot, { backgroundColor: layers[key] ? colors.accent : colors.textMuted }]} /><Text style={[styles.layerText, { color: layers[key] ? colors.accent : colors.textSub }]}>{label}</Text></TouchableOpacity>)}</View>

      <View style={styles.summaryGrid}>
        <LevelCard title="最近支撐區" levels={analysis.supports} color={colors.positive} colors={colors} />
        <LevelCard title="最近壓力區" levels={analysis.resistances} color={colors.negative} colors={colors} />
        <View style={[styles.summaryCard, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.summaryLabel, { color: colors.textSub }]}>最近爆量</Text><Text style={[styles.summaryMain, { color: latestSpike ? colors.warning : colors.textMuted }]}>{latestSpike ? `${latestSpike.ratio.toFixed(1)} 倍` : '近期無'}</Text><Text style={[styles.levelMeta, { color: colors.textMuted }]}>{latestSpike?.time || '門檻為 20 日均量 1.8 倍'}</Text></View>
        <View style={[styles.summaryCard, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.summaryLabel, { color: colors.textSub }]}>MACD 背離</Text><Text style={[styles.summaryMain, { color: latestDivergence?.status === 'confirmed' ? (latestDivergence.type === 'bullish' ? colors.positive : colors.negative) : colors.textMuted }]}>{latestDivergence ? `${latestDivergence.type === 'bullish' ? '偏多' : '偏空'} · ${SIGNAL_STATUS[latestDivergence.status]}` : '近期未偵測'}</Text><Text style={[styles.levelMeta, { color: colors.textMuted }]}>{latestDivergence?.confirmationTime || latestDivergence?.time || '以轉折點交叉比較'}</Text></View>
      </View>

      <StrategyOverview strategies={analysis.strategies} currentRsi={analysis.latest.rsi} colors={colors} />

      <SignalChecklist signal={latestDivergence} colors={colors} />

      <View style={[styles.rulesCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
        <Text style={[styles.rulesTitle, { color: colors.text }]}>進出場研究訊號怎麼確認？</Text>
        <View style={[styles.ruleBlock, { backgroundColor: colors.cardAlt }]}><Text style={[styles.ruleHeading, { color: colors.accent }]}>趨勢回檔</Text><Text style={[styles.ruleBody, { color: colors.textSub }]}>MA20 與 MA60 同向，價格回測 MA20 約 1.5% 範圍後重新收回，且收盤較前一日轉強／轉弱。</Text></View>
        <View style={[styles.ruleBlock, { backgroundColor: colors.cardAlt }]}><Text style={[styles.ruleHeading, { color: colors.accent }]}>放量突破</Text><Text style={[styles.ruleBody, { color: colors.textSub }]}>收盤突破／跌破前 20 日高低點 0.1%，同時成交量達前 20 日均量 1.5 倍。</Text></View>
        <View style={[styles.ruleBlock, { backgroundColor: colors.cardAlt }]}><Text style={[styles.ruleHeading, { color: colors.accent }]}>RSI 支撐反轉</Text><Text style={[styles.ruleBody, { color: colors.textSub }]}>RSI14 從 30 以下站回且價格接近支撐，形成偏多確認；從 70 以上跌回且接近壓力，形成偏空確認。</Text></View>
        <View style={[styles.ruleBlock, { backgroundColor: colors.cardAlt }]}><Text style={[styles.ruleHeading, { color: colors.accent }]}>KD（9,3,3）怎麼看？</Text><Text style={[styles.ruleBody, { color: colors.textSub }]}>K 向上穿越 D 稱黃金交叉，向下穿越稱死亡交叉；80 以上為相對高檔、20 以下為相對低檔。KD 目前只作圖層輔助判讀，不會單獨產生進出場確認。</Text></View>
        <Text style={[styles.rulesIntro, { color: colors.textSub }]}>轉折點需等待右側 3 根 K 棒完成才建立背離候選；下列三項必要條件同時成立才會標為確認。</Text>
        <View style={[styles.ruleBlock, { backgroundColor: colors.positiveSoft }]}><Text style={[styles.ruleHeading, { color: colors.positive }]}>偏多確認</Text><Text style={[styles.ruleBody, { color: colors.textSub }]}>突破兩個低點之間的最高價（確認線）＋ MACD 高於 Signal 且柱狀體為正＋收盤站上 MA20。</Text></View>
        <View style={[styles.ruleBlock, { backgroundColor: colors.negativeSoft }]}><Text style={[styles.ruleHeading, { color: colors.negative }]}>偏空確認</Text><Text style={[styles.ruleBody, { color: colors.textSub }]}>跌破兩個高點之間的最低價（確認線）＋ MACD 低於 Signal 且柱狀體為負＋收盤跌破 MA20。</Text></View>
        <Text style={[styles.ruleFootnote, { color: colors.textMuted }]}>成交量 ≥ 20 日均量 1.2 倍為品質加分；確認前再破背離低／高點 0.5% 即失效，40 個交易日未確認即逾期。確認後最多追蹤 20 個交易日，跌回／站回確認線 0.5% 即失效。偏多／偏空確認分別供進場與減碼退出研究，不會自動下單。</Text>
      </View>

      <View style={[styles.disclaimer, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}><CircleAlert size={16} color={colors.accent} /><Text style={[styles.disclaimerText, { color: colors.textSub }]}>支撐、壓力、背離與策略結果為程式化研究訊號，可能失效或延後確認，不等於買賣建議。</Text></View>

      <TouchableOpacity style={[styles.aiButton, { backgroundColor: colors.accent }]} onPress={askAI}><Bot size={18} color={colors.accentContrast} /><View style={styles.flex}><Text style={[styles.aiTitle, { color: colors.accentContrast }]}>問 AI 解讀這張圖</Text><Text style={[styles.aiSub, { color: colors.accentContrast }]}>帶入價位、量價、MACD、RSI 與 KD 結果繼續對話</Text></View></TouchableOpacity>
      <View style={{ height: 36 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 }, flex: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }, loadingText: { marginTop: 12, fontSize: 13 }, errorTitle: { fontSize: 18, fontWeight: '800', marginTop: 12 }, errorText: { fontSize: 13, textAlign: 'center', marginTop: 6 }, retry: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 16, minHeight: 42, borderRadius: 13, marginTop: 16 }, retryText: { fontSize: 13, fontWeight: '800' },
  quoteRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 }, symbol: { fontSize: 25, fontWeight: '900' }, name: { fontSize: 12, marginTop: 3 }, quoteRight: { alignItems: 'flex-end' }, close: { fontSize: 22, fontWeight: '800' }, change: { fontSize: 11, fontWeight: '700', marginTop: 3 },
  periodRow: { flexDirection: 'row', gap: 7 }, chip: { flex: 1, minHeight: 36, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, chipText: { fontSize: 11, fontWeight: '700' },
  chartCard: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' }, chartHeader: { paddingHorizontal: 13, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, chartTitleRow: { flexDirection: 'row', gap: 7, alignItems: 'center' }, chartTitle: { fontSize: 14, fontWeight: '800' }, chartHint: { fontSize: 10 },
  lineGuide: { borderWidth: 1, borderRadius: 14, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 9 }, lineGuideIcon: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, lineGuideIconText: { fontSize: 13, fontWeight: '900' }, lineGuideTitle: { fontSize: 11, fontWeight: '800' }, lineGuideText: { fontSize: 10, lineHeight: 16, marginTop: 3 },
  layerHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 }, layerTitle: { fontSize: 12, fontWeight: '700' }, layerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, layerChip: { borderWidth: 1, minHeight: 34, borderRadius: 17, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 }, layerDot: { width: 6, height: 6, borderRadius: 3 }, layerText: { fontSize: 11, fontWeight: '700' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, summaryCard: { width: '48.5%', minHeight: 104, borderWidth: 1, borderRadius: 14, padding: 11 }, summaryLabel: { fontSize: 11, marginBottom: 7 }, levelRow: { marginBottom: 6 }, levelValue: { fontSize: 12, fontWeight: '800' }, levelMeta: { fontSize: 9, marginTop: 2 }, emptyValue: { fontSize: 11, lineHeight: 16 }, summaryMain: { fontSize: 16, fontWeight: '800' },
  signalCard: { borderWidth: 1, borderRadius: 16, padding: 13 }, signalCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, signalEyebrow: { fontSize: 10, marginBottom: 3 }, signalTitle: { fontSize: 16, fontWeight: '800' }, statusBadge: { minWidth: 48, minHeight: 38, paddingHorizontal: 8, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, statusBadgeText: { fontSize: 14, fontWeight: '900' }, signalTiming: { fontSize: 10, marginTop: 5 }, checkList: { marginTop: 11, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 }, checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, checkIcon: { width: 18, height: 18, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, checkText: { flex: 1, fontSize: 11, lineHeight: 16 }, checkTag: { fontSize: 9, fontWeight: '800' },
  strategyCard: { borderWidth: 1, borderRadius: 16, padding: 13 }, strategyHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, strategyTitle: { fontSize: 15, fontWeight: '800' }, strategyIntro: { fontSize: 10, marginTop: 3 }, rsiValue: { fontSize: 10, fontWeight: '700' }, strategyList: { marginTop: 11, borderTopWidth: StyleSheet.hairlineWidth }, strategyRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth }, strategyNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, strategyName: { fontSize: 12, fontWeight: '800' }, strategyBadge: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 4 }, strategyBadgeText: { fontSize: 8, fontWeight: '900' }, strategyReason: { fontSize: 10, lineHeight: 16, marginTop: 5 },
  rulesCard: { borderWidth: 1, borderRadius: 16, padding: 13, gap: 9 }, rulesTitle: { fontSize: 15, fontWeight: '800' }, rulesIntro: { fontSize: 11, lineHeight: 17 }, ruleBlock: { borderRadius: 12, padding: 10 }, ruleHeading: { fontSize: 11, fontWeight: '800', marginBottom: 3 }, ruleBody: { fontSize: 10, lineHeight: 16 }, ruleFootnote: { fontSize: 9, lineHeight: 15 },
  disclaimer: { borderWidth: 1, borderRadius: 13, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, disclaimerText: { flex: 1, fontSize: 11, lineHeight: 17 }, aiButton: { minHeight: 58, borderRadius: 16, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 11 }, aiTitle: { fontSize: 14, fontWeight: '800' }, aiSub: { fontSize: 10, opacity: 0.8, marginTop: 2 },
});
