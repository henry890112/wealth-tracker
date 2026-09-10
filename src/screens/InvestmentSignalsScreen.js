import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { BarChart3, BellRing, Bot, CheckCircle2, ChevronDown, CircleAlert, RefreshCw, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react-native';
import { useTheme } from '../lib/ThemeContext';
import {
  getSignalPreferences, listInvestmentSignals, listTaiwanSignalHoldings, markSignalRead,
  registerSignalPushDevice, runInvestmentSignalNow, saveSignalPreferences, syncLocalWatchlistToCloud,
} from '../services/investmentSignals';

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
    <View style={[styles.metric, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
      <Text style={[styles.metricLabel, { color: colors.textSub }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

export default function InvestmentSignalsScreen({ navigation }) {
  const { colors, isDark } = useTheme();
  const PRIMARY = colors.accent;
  const [signals, setSignals] = useState([]);
  const [preferences, setPreferences] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const [prefs, rows, heldAssets] = await Promise.all([getSignalPreferences(), listInvestmentSignals(), listTaiwanSignalHoldings()]);
      setPreferences(prefs);
      setSignals(rows);
      setHoldings(heldAssets);
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
  const holdingSymbols = useMemo(() => new Set(holdings.map(item => String(item.symbol).toUpperCase())), [holdings]);
  const holdingSignals = latestResults.filter(item => holdingSymbols.has(String(item.symbol).toUpperCase()));

  const askAI = (prompt) => {
    navigation.navigate('AI', {
      aiRequestId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      initialPrompt: prompt,
    });
  };

  const setEnabled = async (key, value) => {
    try {
      if (key === 'push_enabled' && value) {
        const result = await registerSignalPushDevice();
        if (!result.registered) {
          const next = await saveSignalPreferences({ push_enabled: false });
          setPreferences(next);
          const copy = {
            web: ['網頁版不支援推播', '每日分析仍會正常執行，結果會保留在這個頁面。請改用支援推播的手機版本。'],
            permission: ['尚未開啟通知', '請在 iPhone「設定」中允許 WealthTracker 發送通知，再回來重新開啟。'],
            configuration: ['推播尚未完成設定', '找不到 Expo 專案設定。每日分析仍會正常執行，結果會保留在這個頁面。'],
            'apns-entitlement': ['此版本不支援遠端推播', '目前安裝的 iPhone 版本沒有 Apple APNs 推播權限。Xcode Personal Team 不支援遠端推播；每日分析仍會正常執行，結果會保留在這個頁面。若要接收推播，需要使用 Apple Developer Program 簽署後重新建置 App。'],
            token: ['無法啟用推播', result.message || '目前無法註冊這台裝置，請稍後再試。'],
          };
          const [title, message] = copy[result.reason] || ['無法啟用推播', '目前無法註冊這台裝置，請稍後再試。'];
          Alert.alert(title, message);
          return;
        }
      }
      const next = await saveSignalPreferences({ [key]: value });
      setPreferences(next);
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
      const failed = result.failed_symbols || 0;
      Alert.alert(
        failed ? '分析完成（部分資料暫缺）' : '分析完成',
        `已分析 ${result.analyzed_symbols || 0} 檔台股；其中 ${result.qualified_symbols || 0} 檔符合研究條件。${failed ? `\n${failed} 檔市場資料暫時無法讀取，已保留在結果中並標示原因。` : ''}`
      );
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
        <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}><TrendingUp size={25} color={colors.accentContrast} /></View>
        <View style={styles.flex}>
          <Text style={[styles.heroTitle, { color: colors.text }]}>台股研究訊號</Text>
          <Text style={[styles.heroText, { color: colors.textSub }]}>以估值、法人與趨勢篩選值得進一步研究的股票。</Text>
        </View>
      </View>

      <View style={[styles.notice, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}>
        <ShieldCheck size={18} color={PRIMARY} />
        <Text style={[styles.noticeText, { color: colors.textSub }]}>這是研究訊號，不是買進建議。請自行評估財報、風險與部位配置。</Text>
      </View>

      <View style={[styles.rulesCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.rulesHeader}>
          <View><Text style={[styles.rulesTitle, { color: colors.text }]}>研究分數怎麼計算？</Text><Text style={[styles.rulesSub, { color: colors.textSub }]}>滿分 100 分；達 70 分才標示為「值得研究」。</Text></View>
          <View style={[styles.rulesScore, { backgroundColor: colors.accentSoft }]}><Text style={[styles.rulesScoreText, { color: PRIMARY }]}>70+</Text></View>
        </View>
        <View style={[styles.rulesList, { borderTopColor: colors.border }]}>
          {SCORE_RULES.map(([label, points]) => <View key={label} style={styles.ruleRow}><Text style={[styles.ruleLabel, { color: colors.text }]}>{label}</Text><Text style={[styles.rulePoints, { color: PRIMARY }]}>{points} 分</Text></View>)}
        </View>
      </View>

      <View style={[styles.aiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.aiIcon, { backgroundColor: colors.accentSoft }]}><Sparkles size={21} color={PRIMARY} /></View>
        <View style={styles.flex}>
          <Text style={[styles.aiTitle, { color: colors.text }]}>AI 持倉研究</Text>
          <Text style={[styles.aiText, { color: colors.textSub }]}>目前有 {holdings.length} 檔台股持倉，最新訊號涵蓋 {holdingSignals.length} 檔。AI 會整合成本、損益與研究條件，回答會保留在對話紀錄。</Text>
          <TouchableOpacity
            style={[styles.aiButton, { backgroundColor: PRIMARY, opacity: holdings.length ? 1 : 0.5 }]}
            disabled={!holdings.length}
            onPress={() => askAI('請根據最新台股研究訊號，分析我目前所有台股持倉。請分成：整體結論、各持倉觀察、主要風險、下一步研究清單。請清楚區分已知資料與仍需查證的資訊，不要只依研究分數下買賣結論。')}
            accessibilityLabel="使用 AI 分析目前台股持倉"
          >
            <Bot size={17} color={colors.accentContrast} />
            <Text style={[styles.aiButtonText, { color: colors.accentContrast }]}>{holdings.length ? 'AI 分析目前持倉' : '尚無台股持倉'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.settingsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity style={[styles.analyzeButton, { backgroundColor: PRIMARY, opacity: analyzing ? 0.65 : 1 }]} onPress={runNow} disabled={analyzing} accessibilityLabel="立即分析我的台股">
          {analyzing ? <ActivityIndicator color={colors.accentContrast} /> : <BellRing size={19} color={colors.accentContrast} />}
          <View style={styles.flex}><Text style={[styles.analyzeTitle, { color: colors.accentContrast }]}>{analyzing ? '正在分析自選與持倉…' : '立即分析目前資料'}</Text><Text style={[styles.analyzeSub, { color: colors.accentContrast }]}>不等待 20:30；結果不會發送推播</Text></View>
        </TouchableOpacity>
        <View style={styles.settingRow}>
          <View style={styles.flex}><Text style={[styles.settingTitle, { color: colors.text }]}>每日收盤分析</Text><Text style={[styles.settingSub, { color: colors.textSub }]}>平日 20:30 後，僅分析自選與持倉台股</Text></View>
          <Switch value={preferences?.enabled ?? true} onValueChange={v => setEnabled('enabled', v)} trackColor={{ false: colors.border, true: colors.accentSoft }} thumbColor={preferences?.enabled === false ? colors.textMuted : PRIMARY} />
        </View>
        <View style={[styles.settingRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
          <View style={styles.flex}><Text style={[styles.settingTitle, { color: colors.text }]}>每日摘要推播</Text><Text style={[styles.settingSub, { color: colors.textSub }]}>符合新訊號時通知；完整內容保留在此頁</Text></View>
          <Switch value={preferences?.push_enabled ?? false} disabled={preferences?.enabled === false} onValueChange={v => setEnabled('push_enabled', v)} trackColor={{ false: colors.border, true: colors.accentSoft }} thumbColor={preferences?.push_enabled ? PRIMARY : colors.textMuted} />
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
        const isHolding = holdingSymbols.has(String(signal.symbol).toUpperCase());
        const holding = holdings.find(item => String(item.symbol).toUpperCase() === String(signal.symbol).toUpperCase());
        return (
          <TouchableOpacity key={signal.id} activeOpacity={0.88} onPress={() => toggleExpanded(signal)} style={[styles.signalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.signalTop}>
              <View style={styles.flex}><View style={styles.symbolRow}><Text style={[styles.symbol, { color: colors.text }]}>{signal.symbol}</Text>{!signal.read_at && <View style={[styles.dot, { backgroundColor: PRIMARY }]} />}{isHolding && <View style={[styles.holdingBadge, { backgroundColor: colors.accentSoft }]}><Text style={[styles.holdingBadgeText, { color: PRIMARY }]}>我的持倉</Text></View>}</View><Text style={[styles.name, { color: colors.textSub }]}>{signal.name}</Text></View>
              <View style={[styles.score, { backgroundColor: signal.is_candidate ? colors.accentSoft : colors.cardAlt }]}><Text style={[styles.scoreValue, { color: signal.is_candidate ? PRIMARY : colors.textSub }]}>{number(signal.score, 0)}</Text><Text style={[styles.scoreLabel, { color: signal.is_candidate ? PRIMARY : colors.textSub }]}>{signal.is_candidate ? '值得研究' : '尚未符合'}</Text></View>
            </View>
            <View style={styles.reasonWrap}>{(signal.reasons || []).map(reason => <View key={reason} style={styles.reason}><CheckCircle2 size={14} color={colors.positive} /><Text style={[styles.reasonText, { color: colors.text }]}>{reason}</Text></View>)}{(signal.risk_flags || []).map(reason => <View key={reason} style={styles.reason}><CircleAlert size={14} color={PRIMARY} /><Text style={[styles.reasonText, { color: colors.textSub }]}>{reason}</Text></View>)}</View>
            <View style={styles.detailToggle}><Text style={[styles.detailToggleText, { color: colors.textSub }]}>{open ? '收合判斷依據' : '查看判斷依據'}</Text><ChevronDown size={17} color={colors.textSub} style={open ? styles.chevronOpen : null} /></View>
            {open && <View style={[styles.detail, { borderTopColor: colors.border }]}>
              <View style={styles.metrics}><Metric label="本益比" value={metrics.per ? `${number(metrics.per)} 倍` : '—'} colors={colors} isDark={isDark} /><Metric label="三年 PER 25%" value={metrics.per_p25 ? `${number(metrics.per_p25)} 倍` : '—'} colors={colors} isDark={isDark} /><Metric label="近 5 日法人" value={metrics.institutional_net_buy ? `${number(metrics.institutional_net_buy, 0)} 股` : '—'} colors={colors} isDark={isDark} /><Metric label="20 日均額" value={metrics.avg_trading_money ? `$${number(metrics.avg_trading_money, 0)}` : '—'} colors={colors} isDark={isDark} /></View>
              <View style={styles.signalActions}>
                <TouchableOpacity style={[styles.signalChartButton, { backgroundColor: colors.accentSoft }]} onPress={event => { event.stopPropagation?.(); navigation.navigate('TechnicalAnalysis', { symbol: signal.symbol, name: signal.name, averageCost: holding?.average_cost || 0, marketType: 'TW' }); }}><BarChart3 size={16} color={PRIMARY} /><Text style={[styles.signalAiButtonText, { color: PRIMARY }]}>K 線技術圖</Text></TouchableOpacity>
                {isHolding && <TouchableOpacity style={[styles.signalAiButton, { borderColor: PRIMARY }]} onPress={event => { event.stopPropagation?.(); askAI(`請深入分析我的台股持倉 ${signal.name}（${signal.symbol}）。結合最新研究訊號、我的持有成本與目前損益，說明已符合的條件、未符合原因、持倉風險，以及接下來應追蹤的三項資訊。不要直接給買進或賣出指令。`); }}><Bot size={16} color={PRIMARY} /><Text style={[styles.signalAiButtonText, { color: PRIMARY }]}>問 AI</Text></TouchableOpacity>}
              </View>
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
  hero: { borderWidth: 1, borderRadius: 20, padding: 16, flexDirection: 'row', gap: 13, alignItems: 'center' }, heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#E8EEF6', alignItems: 'center', justifyContent: 'center' }, heroTitle: { fontSize: 20, fontWeight: '800', marginBottom: 4 }, heroText: { fontSize: 13, lineHeight: 19 },
  notice: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 9, flexDirection: 'row', alignItems: 'flex-start' }, noticeText: { flex: 1, fontSize: 12, lineHeight: 18 },
  aiCard: { borderWidth: 1, borderRadius: 18, padding: 15, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, aiIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, aiTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 }, aiText: { fontSize: 12, lineHeight: 18 }, aiButton: { marginTop: 12, minHeight: 42, borderRadius: 13, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, aiButtonText: { fontSize: 13, fontWeight: '800' },
  rulesCard: { borderWidth: 1, borderRadius: 18, padding: 15 }, rulesHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 }, rulesTitle: { fontSize: 16, fontWeight: '800', marginBottom: 3 }, rulesSub: { fontSize: 12, lineHeight: 18 }, rulesScore: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 }, rulesScoreText: { fontSize: 16, fontWeight: '800' }, rulesList: { marginTop: 13, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 2 }, ruleRow: { flexDirection: 'row', gap: 12, justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }, ruleLabel: { flex: 1, fontSize: 12, lineHeight: 17 }, rulePoints: { fontSize: 12, fontWeight: '800' },
  settingsCard: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' }, analyzeButton: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 15 }, analyzeTitle: { fontSize: 15, fontWeight: '800', marginBottom: 2 }, analyzeSub: { fontSize: 12, opacity: 0.82 }, settingRow: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 12 }, settingTitle: { fontSize: 15, fontWeight: '700', marginBottom: 3 }, settingSub: { fontSize: 12, lineHeight: 17 },
  holdingBadge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 4 }, holdingBadgeText: { fontSize: 10, fontWeight: '800' }, signalActions: { flexDirection: 'row', gap: 8, marginTop: 12 }, signalChartButton: { flex: 1.25, minHeight: 40, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, signalAiButton: { flex: 0.75, minHeight: 40, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, signalAiButtonText: { fontSize: 12, fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }, sectionTitle: { fontSize: 20, fontWeight: '800' }, sectionSub: { fontSize: 12, marginTop: 3 }, refresh: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  empty: { borderWidth: 1, borderRadius: 18, padding: 24, alignItems: 'center', gap: 8 }, emptyTitle: { fontSize: 16, fontWeight: '700', marginTop: 4 }, emptyText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  signalCard: { borderWidth: 1, borderRadius: 18, padding: 15 }, signalTop: { flexDirection: 'row', alignItems: 'center' }, symbolRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, symbol: { fontSize: 18, fontWeight: '800' }, dot: { width: 7, height: 7, borderRadius: 4 }, name: { fontSize: 13, marginTop: 2 }, score: { minWidth: 68, borderRadius: 13, alignItems: 'center', paddingVertical: 7 }, scoreInactive: {}, scoreValue: { fontSize: 20, fontWeight: '800' }, scoreValueInactive: {}, scoreLabel: { fontSize: 10, fontWeight: '600' }, scoreLabelInactive: {},
  reasonWrap: { marginTop: 14, gap: 7 }, reason: { flexDirection: 'row', gap: 7, alignItems: 'flex-start' }, reasonText: { flex: 1, fontSize: 13, lineHeight: 18 }, detailToggle: { marginTop: 13, flexDirection: 'row', alignItems: 'center', gap: 3 }, detailToggleText: { fontSize: 12, fontWeight: '600' }, chevronOpen: { transform: [{ rotate: '180deg' }] }, detail: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, metric: { width: '47%', borderWidth: 1, borderRadius: 10, padding: 9 }, metricLabel: { fontSize: 10, marginBottom: 3 }, metricValue: { fontSize: 12, fontWeight: '700' }, risk: { marginTop: 10, fontSize: 12, lineHeight: 17 }, historyTitle: { fontSize: 12, textAlign: 'center', marginTop: 3 },
});
