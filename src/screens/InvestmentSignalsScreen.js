import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { BellRing, CheckCircle2, ChevronDown, CircleAlert, RefreshCw, ShieldCheck, TrendingUp } from 'lucide-react-native';
import { useTheme } from '../lib/ThemeContext';
import {
  getSignalPreferences, listInvestmentSignals, markSignalRead,
  registerSignalPushDevice, runInvestmentSignalNow, saveSignalPreferences, syncLocalWatchlistToCloud,
} from '../services/investmentSignals';

const PRIMARY = '#F59E0B';

const SCORE_RULES = [
  ['本益比低於近三年 PER 第 25 百分位', 30],
  ['外資近 5 日淨買超達門檻', 20],
  ['投信近 5 日淨買超', 15],
  ['收盤價高於 MA20，且 MA20 高於 MA60', 25],
  ['近 20 日平均成交額達門檻', 10],
];

const dateText = (value) => value ? String(value).replaceAll('-', '/') : '—';
const number = (value, digits = 2) => Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: digits, minimumFractionDigits: digits });

function Metric({ label, value, colors, isDark }) {
  return (
    <View style={[styles.metric, { backgroundColor: isDark ? '#111827' : '#F1F5F9', borderColor: isDark ? '#3A465A' : '#DCE3ED' }]}>
      <Text style={[styles.metricLabel, { color: isDark ? '#C3CDDB' : '#475569' }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

export default function InvestmentSignalsScreen() {
  const { colors, isDark } = useTheme();
  const [signals, setSignals] = useState([]);
  const [preferences, setPreferences] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const [prefs, rows] = await Promise.all([getSignalPreferences(), listInvestmentSignals()]);
      setPreferences(prefs);
      setSignals(rows);
      syncLocalWatchlistToCloud().catch(error => console.warn('watchlist cloud migration:', error.message));
    } catch (error) {
      Alert.alert('無法載入研究訊號', error.message || '請稍後再試');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const latestResults = useMemo(() => {
    const newest = signals[0]?.signal_date;
    return newest ? signals.filter(item => item.signal_date === newest) : [];
  }, [signals]);
  const qualifiedCount = latestResults.filter(item => item.is_candidate).length;

  const setEnabled = async (key, value) => {
    try {
      const next = await saveSignalPreferences({ [key]: value });
      setPreferences(next);
      if (key === 'push_enabled' && value) {
        const result = await registerSignalPushDevice();
        if (!result.registered && result.reason === 'permission') {
          Alert.alert('尚未開啟通知', '請在系統設定允許 WealthTracker 發送通知。');
        }
      }
    } catch (error) {
      Alert.alert('設定失敗', error.message || '請稍後再試');
    }
  };

  const runNow = async () => {
    setAnalyzing(true);
    try {
      await syncLocalWatchlistToCloud();
      const result = await runInvestmentSignalNow();
      await load(true);
      Alert.alert('分析完成', `已分析 ${result.analyzed_symbols || 0} 檔台股；其中 ${result.qualified_symbols || 0} 檔符合研究條件。`);
    } catch (error) {
      Alert.alert('立即分析失敗', error.message || '請稍後再試');
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleExpanded = async (signal) => {
    setExpanded(expanded === signal.id ? null : signal.id);
    if (!signal.read_at) {
      markSignalRead(signal.id).catch(error => console.warn('mark signal read:', error.message));
    }
  };

  if (loading) return <View style={[styles.center, { backgroundColor: colors.bg }]}><ActivityIndicator color={PRIMARY} size="large" /></View>;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={PRIMARY} />}
    >
      <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.heroIcon}><TrendingUp size={25} color="#0B1F3A" /></View>
        <View style={styles.flex}>
          <Text style={[styles.heroTitle, { color: colors.text }]}>台股研究訊號</Text>
          <Text style={[styles.heroText, { color: colors.textSub }]}>以估值、法人與趨勢篩選值得進一步研究的股票。</Text>
        </View>
      </View>

      <View style={[styles.notice, { backgroundColor: isDark ? '#182337' : '#EFF6FF', borderColor: colors.border }]}>
        <ShieldCheck size={18} color="#2563EB" />
        <Text style={[styles.noticeText, { color: colors.textSub }]}>這是研究訊號，不是買進建議。請自行評估財報、風險與部位配置。</Text>
      </View>

      <View style={[styles.rulesCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.rulesHeader}>
          <View><Text style={[styles.rulesTitle, { color: colors.text }]}>研究分數怎麼計算？</Text><Text style={[styles.rulesSub, { color: colors.textSub }]}>滿分 100 分；達 70 分才標示為「值得研究」。</Text></View>
          <View style={styles.rulesScore}><Text style={styles.rulesScoreText}>70+</Text></View>
        </View>
        <View style={[styles.rulesList, { borderTopColor: colors.border }]}>
          {SCORE_RULES.map(([label, points]) => <View key={label} style={styles.ruleRow}><Text style={[styles.ruleLabel, { color: colors.text }]}>{label}</Text><Text style={styles.rulePoints}>{points} 分</Text></View>)}
        </View>
      </View>

      <View style={[styles.settingsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity style={[styles.analyzeButton, { opacity: analyzing ? 0.65 : 1 }]} onPress={runNow} disabled={analyzing} accessibilityLabel="立即分析我的台股">
          {analyzing ? <ActivityIndicator color="#0B1F3A" /> : <BellRing size={19} color="#0B1F3A" />}
          <View style={styles.flex}><Text style={styles.analyzeTitle}>{analyzing ? '正在分析自選與持倉…' : '立即分析目前資料'}</Text><Text style={styles.analyzeSub}>不等待 20:30；結果不會發送推播</Text></View>
        </TouchableOpacity>
        <View style={styles.settingRow}>
          <View style={styles.flex}><Text style={[styles.settingTitle, { color: colors.text }]}>每日收盤分析</Text><Text style={[styles.settingSub, { color: colors.textSub }]}>平日 20:30 後，僅分析自選與持倉台股</Text></View>
          <Switch value={preferences?.enabled ?? true} onValueChange={v => setEnabled('enabled', v)} trackColor={{ false: '#64748B', true: '#F7C35A' }} thumbColor={preferences?.enabled === false ? '#CBD5E1' : PRIMARY} />
        </View>
        <View style={[styles.settingRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
          <View style={styles.flex}><Text style={[styles.settingTitle, { color: colors.text }]}>每日摘要推播</Text><Text style={[styles.settingSub, { color: colors.textSub }]}>符合新訊號時通知；完整內容保留在此頁</Text></View>
          <Switch value={preferences?.push_enabled ?? true} disabled={preferences?.enabled === false} onValueChange={v => setEnabled('push_enabled', v)} trackColor={{ false: '#64748B', true: '#F7C35A' }} thumbColor={preferences?.push_enabled === false ? '#CBD5E1' : PRIMARY} />
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <View><Text style={[styles.sectionTitle, { color: colors.text }]}>最新分析結果</Text><Text style={[styles.sectionSub, { color: colors.textSub }]}>{latestResults.length ? `已分析 ${latestResults.length} 檔，${qualifiedCount} 檔符合｜資料截至 ${dateText(latestResults[0].source_as_of)}` : '尚未分析任何台股'}</Text></View>
        <TouchableOpacity onPress={() => load(true)} style={[styles.refresh, { borderColor: colors.border }]} accessibilityLabel="重新整理研究訊號"><RefreshCw size={16} color={colors.textSub} /></TouchableOpacity>
      </View>

      {latestResults.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <CircleAlert size={26} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>尚未有分析結果</Text>
          <Text style={[styles.emptyText, { color: colors.textSub }]}>先新增台股自選或持倉，然後按上方「立即分析目前資料」。</Text>
        </View>
      ) : latestResults.map(signal => {
        const open = expanded === signal.id;
        const metrics = signal.metrics || {};
        return (
          <TouchableOpacity key={signal.id} activeOpacity={0.88} onPress={() => toggleExpanded(signal)} style={[styles.signalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.signalTop}>
              <View style={styles.flex}><View style={styles.symbolRow}><Text style={[styles.symbol, { color: colors.text }]}>{signal.symbol}</Text>{!signal.read_at && <View style={styles.dot} />}</View><Text style={[styles.name, { color: colors.textSub }]}>{signal.name}</Text></View>
              <View style={[styles.score, !signal.is_candidate && styles.scoreInactive]}><Text style={[styles.scoreValue, !signal.is_candidate && styles.scoreValueInactive]}>{number(signal.score, 0)}</Text><Text style={[styles.scoreLabel, !signal.is_candidate && styles.scoreLabelInactive]}>{signal.is_candidate ? '值得研究' : '尚未符合'}</Text></View>
            </View>
            <View style={styles.reasonWrap}>{(signal.reasons || []).map(reason => <View key={reason} style={styles.reason}><CheckCircle2 size={14} color="#10B981" /><Text style={[styles.reasonText, { color: colors.text }]}>{reason}</Text></View>)}{(signal.risk_flags || []).map(reason => <View key={reason} style={styles.reason}><CircleAlert size={14} color="#F59E0B" /><Text style={[styles.reasonText, { color: isDark ? '#D7DEE9' : '#526174' }]}>{reason}</Text></View>)}</View>
            <View style={styles.detailToggle}><Text style={[styles.detailToggleText, { color: isDark ? '#D7DEE9' : colors.textSub }]}>{open ? '收合判斷依據' : '查看判斷依據'}</Text><ChevronDown size={17} color={isDark ? '#D7DEE9' : colors.textSub} style={open ? styles.chevronOpen : null} /></View>
            {open && <View style={[styles.detail, { borderTopColor: colors.border }]}>
              <View style={styles.metrics}><Metric label="本益比" value={metrics.per ? `${number(metrics.per)} 倍` : '—'} colors={colors} isDark={isDark} /><Metric label="三年 PER 25%" value={metrics.per_p25 ? `${number(metrics.per_p25)} 倍` : '—'} colors={colors} isDark={isDark} /><Metric label="近 5 日法人" value={metrics.institutional_net_buy ? `${number(metrics.institutional_net_buy, 0)} 股` : '—'} colors={colors} isDark={isDark} /><Metric label="20 日均額" value={metrics.avg_trading_money ? `$${number(metrics.avg_trading_money, 0)}` : '—'} colors={colors} isDark={isDark} /></View>
            </View>}
          </TouchableOpacity>
        );
      })}

      {signals.length > latestResults.length && <Text style={[styles.historyTitle, { color: colors.textSub }]}>近期歷史分析已保留 {signals.length} 筆</Text>}
      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1 },
  hero: { borderWidth: 1, borderRadius: 20, padding: 16, flexDirection: 'row', gap: 13, alignItems: 'center' }, heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center' }, heroTitle: { fontSize: 20, fontWeight: '800', marginBottom: 4 }, heroText: { fontSize: 13, lineHeight: 19 },
  notice: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 9, flexDirection: 'row', alignItems: 'flex-start' }, noticeText: { flex: 1, fontSize: 12, lineHeight: 18 },
  rulesCard: { borderWidth: 1, borderRadius: 18, padding: 15 }, rulesHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 }, rulesTitle: { fontSize: 16, fontWeight: '800', marginBottom: 3 }, rulesSub: { fontSize: 12, lineHeight: 18 }, rulesScore: { backgroundColor: '#FFF4D6', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 }, rulesScoreText: { color: '#92400E', fontSize: 16, fontWeight: '800' }, rulesList: { marginTop: 13, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 2 }, ruleRow: { flexDirection: 'row', gap: 12, justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }, ruleLabel: { flex: 1, fontSize: 12, lineHeight: 17 }, rulePoints: { color: '#D97706', fontSize: 12, fontWeight: '800' },
  settingsCard: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' }, analyzeButton: { backgroundColor: '#F59E0B', flexDirection: 'row', alignItems: 'center', gap: 11, padding: 15 }, analyzeTitle: { color: '#0B1F3A', fontSize: 15, fontWeight: '800', marginBottom: 2 }, analyzeSub: { color: '#0B1F3A', fontSize: 12, opacity: 0.82 }, settingRow: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 12 }, settingTitle: { fontSize: 15, fontWeight: '700', marginBottom: 3 }, settingSub: { fontSize: 12, lineHeight: 17 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }, sectionTitle: { fontSize: 20, fontWeight: '800' }, sectionSub: { fontSize: 12, marginTop: 3 }, refresh: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  empty: { borderWidth: 1, borderRadius: 18, padding: 24, alignItems: 'center', gap: 8 }, emptyTitle: { fontSize: 16, fontWeight: '700', marginTop: 4 }, emptyText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  signalCard: { borderWidth: 1, borderRadius: 18, padding: 15 }, signalTop: { flexDirection: 'row', alignItems: 'center' }, symbolRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, symbol: { fontSize: 18, fontWeight: '800' }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: PRIMARY }, name: { fontSize: 13, marginTop: 2 }, score: { minWidth: 68, borderRadius: 13, backgroundColor: '#FFF4D6', alignItems: 'center', paddingVertical: 7 }, scoreInactive: { backgroundColor: '#E2E8F0' }, scoreValue: { color: '#92400E', fontSize: 20, fontWeight: '800' }, scoreValueInactive: { color: '#475569' }, scoreLabel: { color: '#92400E', fontSize: 10, fontWeight: '600' }, scoreLabelInactive: { color: '#475569' },
  reasonWrap: { marginTop: 14, gap: 7 }, reason: { flexDirection: 'row', gap: 7, alignItems: 'flex-start' }, reasonText: { flex: 1, fontSize: 13, lineHeight: 18 }, detailToggle: { marginTop: 13, flexDirection: 'row', alignItems: 'center', gap: 3 }, detailToggleText: { fontSize: 12, fontWeight: '600' }, chevronOpen: { transform: [{ rotate: '180deg' }] }, detail: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, metric: { width: '47%', borderWidth: 1, borderRadius: 10, padding: 9 }, metricLabel: { fontSize: 10, marginBottom: 3 }, metricValue: { fontSize: 12, fontWeight: '700' }, risk: { marginTop: 10, fontSize: 12, lineHeight: 17 }, historyTitle: { fontSize: 12, textAlign: 'center', marginTop: 3 },
});
