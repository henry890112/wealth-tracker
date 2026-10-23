import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { BellRing, ChevronDown, ChevronUp, Clock3, ExternalLink, Link2, Mail, MessageCircle, Newspaper, Search, ShieldCheck } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/ThemeContext';

const HOURS = [8, 12, 16, 20, 22];
const MARKET_OPTIONS = [['TW', '台股'], ['US', '美股'], ['CRYPTO', '加密貨幣']];
const DEFAULTS = {
  enabled: false, daily_hour: 20, timezone: 'Asia/Taipei', include_holdings: true,
  include_watchlist: true, markets: ['TW', 'US', 'CRYPTO'], min_importance: 70,
  email_enabled: false, line_enabled: false,
};
const toggleArray = (values, value) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
const uniqueSources = sources => [...new Map((sources || []).filter(source => source?.url).map(source => [source.url, source])).values()];
const sourceDomain = source => {
  try { return new URL(source.url).hostname.replace(/^www\./, ''); }
  catch { return source.title || '新聞來源'; }
};
const exactPublishedAt = event => event?.publishedAt || event?.published_at || '';
const hasExactPublishedTime = event => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(exactPublishedAt(event))
  && Number.isFinite(Date.parse(exactPublishedAt(event)));
const isCompleteEvent = event => hasExactPublishedTime(event) && (event?.sourceUrls || []).some(url => /^https?:\/\//i.test(url));
const formatPublishedTime = event => new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  timeZone: 'Asia/Taipei', timeZoneName: 'short',
}).format(new Date(exactPublishedAt(event)));
const openSource = async source => {
  try {
    const supported = await Linking.canOpenURL(source.url);
    if (!supported) throw new Error('unsupported');
    await Linking.openURL(source.url);
  } catch {
    Alert.alert('無法開啟新聞', '這個新聞連結目前無法使用。');
  }
};

export default function MajorEventNotificationScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const [form, setForm] = useState(DEFAULTS);
  const [channels, setChannels] = useState({ email: false, line: false, emailAddress: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [report, setReport] = useState(null);
  const [expandedEvents, setExpandedEvents] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('請先登入');
      const [preferenceResult, channelResult, reportResult] = await Promise.all([
        supabase.from('market_event_preferences').select('enabled,daily_hour,timezone,include_holdings,include_watchlist,markets,min_importance,email_enabled,line_enabled').eq('user_id', user.id).maybeSingle(),
        supabase.from('investment_signal_preferences').select('email_enabled,notification_email,line_enabled,line_user_id').eq('user_id', user.id).maybeSingle(),
        supabase.from('market_event_reports').select('events,sources,model,report_date,created_at').eq('user_id', user.id).order('report_date', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (preferenceResult.error) throw preferenceResult.error;
      const channelAvailability = { email: Boolean(channelResult.data?.email_enabled), line: Boolean(channelResult.data?.line_enabled && channelResult.data?.line_user_id), emailAddress: channelResult.data?.notification_email || user.email || '' };
      setChannels(channelAvailability);
      setForm(preferenceResult.data
        ? { ...DEFAULTS, ...preferenceResult.data }
        : { ...DEFAULTS, email_enabled: channelAvailability.email, line_enabled: channelAvailability.line });
      if (reportResult.data) setReport({ ...reportResult.data, reportDate: reportResult.data.report_date, generatedAt: reportResult.data.created_at });
    } catch (error) { Alert.alert('無法讀取重大事件設定', error.message || '請稍後再試'); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const update = changes => setForm(current => ({ ...current, ...changes }));
  const validate = () => {
    if (!form.include_holdings && !form.include_watchlist) return '請至少選擇持倉或自選清單。';
    if (!form.markets.length) return '請至少選擇一個市場。';
    if (form.enabled && !form.email_enabled && !form.line_enabled) return '請至少開啟 Email 或 LINE。';
    if (form.email_enabled && !channels.email) return 'Email 尚未在「訊號通知」完成設定。';
    if (form.line_enabled && !channels.line) return 'LINE 尚未完成綁定。';
    return null;
  };

  const save = async () => {
    const message = validate(); if (message) return Alert.alert('尚未完成設定', message);
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser(); if (!user) throw new Error('請先登入');
      const { error } = await supabase.from('market_event_preferences').upsert({ user_id: user.id, ...form, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) throw error;
      Alert.alert('重大事件通知已儲存', form.enabled ? '系統會每天搜尋一次，只有達到重要性門檻的事件才會通知。' : '重大事件通知目前為關閉。');
    } catch (error) { Alert.alert('儲存失敗', error.message || '請稍後再試'); }
    finally { setSaving(false); }
  };

  const scanNow = async () => {
    const message = validate(); if (message && !/Email|LINE/.test(message)) return Alert.alert('尚未完成設定', message);
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('market-event-notifications', { body: { action: 'preview', ...form } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setReport(data);
      const completeCount = (data?.events || []).filter(isCompleteEvent).length;
      const incompleteCount = Math.max(Number(data?.discardedCount) || 0, (data?.events || []).length - completeCount);
      Alert.alert('搜尋完成', completeCount
        ? `找到 ${completeCount} 筆有時間與來源的重要事件。`
        : incompleteCount
          ? `找到 ${incompleteCount} 筆候選新聞，但缺少可核對的時間或來源，已略過。`
          : '今天沒有找到符合條件的重大事件。');
    } catch (error) { Alert.alert('搜尋失敗', error.message || 'AI Web Search 暫時無法使用'); }
    finally { setScanning(false); }
  };

  const chip = (selected, onPress, label, key) => <TouchableOpacity key={key || label} onPress={onPress} style={[styles.chip, { backgroundColor: selected ? colors.accentSoft : colors.cardAlt, borderColor: selected ? colors.accent : colors.border }]}><Text style={[styles.chipText, { color: selected ? colors.accent : colors.textSub }]}>{label}</Text></TouchableOpacity>;
  const switchRow = (title, subtitle, value, onValueChange, Icon) => <View style={styles.switchRow}><View style={[styles.icon, { backgroundColor: colors.accentSoft }]}><Icon size={18} color={colors.accent} /></View><View style={styles.flex}><Text style={[styles.rowTitle, { color: colors.text }]}>{title}</Text><Text style={[styles.rowSub, { color: colors.textSub }]}>{subtitle}</Text></View><Switch value={value} onValueChange={onValueChange} trackColor={{ false: colors.border, true: colors.accentSoft }} thumbColor={value ? colors.accent : colors.textMuted} /></View>;

  if (loading) return <View style={[styles.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.accent} /><Text style={[styles.loading, { color: colors.textSub }]}>正在讀取重大事件設定…</Text></View>;
  const displayableEvents = (report?.events || []).filter(isCompleteEvent);
  const incompleteEventCount = Math.max(Number(report?.discardedCount) || 0, (report?.events || []).length - displayableEvents.length);

  return <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
    <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={[styles.heroIcon, { backgroundColor: colors.accentSoft }]}><Newspaper size={24} color={colors.accent} /></View><View style={styles.flex}><Text style={[styles.heroTitle, { color: colors.text }]}>重大事件通知</Text><Text style={[styles.heroSub, { color: colors.textSub }]}>AI 以 Web Search 尋找當日與持倉、自選相關的重大事件，並附上可開啟的來源連結。</Text></View><Switch value={form.enabled} onValueChange={value => update({ enabled: value })} trackColor={{ false: colors.border, true: colors.accentSoft }} thumbColor={form.enabled ? colors.accent : colors.textMuted} /></View>

    <Section title="搜尋範圍" colors={colors} Icon={Search}>
      {switchRow('目前持倉', '掃描目前實際持有的投資標的', form.include_holdings, value => update({ include_holdings: value }), ShieldCheck)}
      {switchRow('自選清單', '也搜尋尚未持有的關注標的', form.include_watchlist, value => update({ include_watchlist: value }), Link2)}
      <Text style={[styles.label, { color: colors.textSub }]}>市場</Text><View style={styles.chips}>{MARKET_OPTIONS.map(([key, label]) => chip(form.markets.includes(key), () => update({ markets: toggleArray(form.markets, key) }), label, key))}</View>
      <Text style={[styles.label, { color: colors.textSub }]}>最低重要性</Text><View style={styles.chips}>{[60, 70, 80, 90].map(value => chip(form.min_importance === value, () => update({ min_importance: value }), `${value}+`, value))}</View>
    </Section>

    <Section title="每日通知時間" colors={colors} Icon={Clock3}>
      <View style={styles.chips}>{HOURS.map(hour => chip(form.daily_hour === hour, () => update({ daily_hour: hour }), `${String(hour).padStart(2, '0')}:00`, hour))}</View>
      <Text style={[styles.hint, { color: colors.textMuted }]}>以 Asia/Taipei 搜尋當日新事件；相同日期與事件會去重。Web Search 可能產生 Gemini API 搜尋用量。</Text>
    </Section>

    <Section title="通知管道" colors={colors} Icon={BellRing}>
      {switchRow('Email', channels.email ? `寄送至 ${channels.emailAddress}` : '請先設定 Email 收件地址', form.email_enabled, value => channels.email ? update({ email_enabled: value }) : Alert.alert('Email 尚未設定', '請先到「訊號通知」開啟 Email 並設定收件地址。'), Mail)}
      {switchRow('LINE', channels.line ? '使用目前已綁定的 LINE 官方帳號' : '請先完成 LINE 綁定', form.line_enabled, value => channels.line ? update({ line_enabled: value }) : Alert.alert('LINE 尚未綁定', '請先到「訊號通知」完成 LINE 綁定。'), MessageCircle)}
      <Text style={[styles.hint, { color: colors.textMuted }]}>重大事件可獨立選擇 Email 或 LINE；收件地址與 LINE 身分仍沿用訊號通知，避免重複維護。</Text>
      <TouchableOpacity style={[styles.outlineButton, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]} onPress={() => navigation.navigate('SignalNotificationSettings')}><BellRing size={16} color={colors.accent} /><Text style={[styles.outlineText, { color: colors.accent }]}>設定通知管道</Text></TouchableOpacity>
    </Section>

    <TouchableOpacity onPress={scanNow} disabled={scanning} style={[styles.previewButton, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>{scanning ? <ActivityIndicator color={colors.accent} /> : <Search size={17} color={colors.accent} />}<Text style={[styles.previewText, { color: colors.accent }]}>{scanning ? 'AI 正在搜尋與核對來源…' : '立即搜尋今日事件'}</Text></TouchableOpacity>

    {report && <Section title={`最新結果 · ${report.reportDate || report.report_date || ''}`} colors={colors} Icon={Newspaper}>
      <View style={[styles.methodBox, { backgroundColor: colors.cardAlt, borderColor: colors.borderLight }]}><Text style={[styles.methodTitle, { color: colors.text }]}>顯示條件</Text><Text style={[styles.methodText, { color: colors.textSub }]}>重要性達標，且同時有明確發布時間與可開啟新聞來源。</Text></View>
      {displayableEvents.length ? displayableEvents.map((event, index) => {
        const eventKey = `${event.title}-${index}`;
        const expanded = Boolean(expandedEvents[eventKey]);
        const mappedSources = (event.sourceUrls || []).map(url => (report.sources || []).find(source => source.url === url) || { url, title: sourceDomain({ url }) });
        const eventSources = uniqueSources(mappedSources);
        const visibleSources = expanded ? eventSources : eventSources.slice(0, 2);
        return <View key={eventKey} style={[styles.eventCard, { backgroundColor: colors.cardAlt, borderColor: colors.borderLight }]}>
          <View style={styles.eventHeader}><Text style={[styles.eventSymbols, { color: colors.accent }]}>{(event.symbols || []).join('、')}</Text><Text style={[styles.importance, { color: event.importance >= 80 ? colors.negative : colors.warning }]}>重要性 {event.importance}/100</Text></View>
          <Text style={[styles.eventTime, { color: colors.textMuted }]}>發布時間：{formatPublishedTime(event)}</Text>
          <Text style={[styles.eventTitle, { color: colors.text }]}>{event.title}</Text>
          <Text numberOfLines={expanded ? undefined : 4} style={[styles.eventSummary, { color: colors.textSub }]}>{event.summary}</Text>
          <Text numberOfLines={expanded ? undefined : 3} style={[styles.eventImpact, { color: colors.textSub }]}>可能影響：{event.impact}</Text>
          <TouchableOpacity style={styles.expandButton} onPress={() => setExpandedEvents(current => ({ ...current, [eventKey]: !expanded }))}>
            <Text style={[styles.expandText, { color: colors.accent }]}>{expanded ? '收合事件內容' : '展開完整內容'}</Text>{expanded ? <ChevronUp size={15} color={colors.accent} /> : <ChevronDown size={15} color={colors.accent} />}
          </TouchableOpacity>
          <View style={[styles.eventSources, { borderTopColor: colors.borderLight }]}>
            <Text style={[styles.eventSourcesTitle, { color: colors.text }]}>新聞來源</Text>
            {visibleSources.map((source, sourceIndex) => <TouchableOpacity key={`${source.url}-${sourceIndex}`} style={[styles.newsButton, { borderColor: colors.accent, backgroundColor: sourceIndex === 0 ? colors.accentSoft : colors.card }]} onPress={() => openSource(source)}>
              <View style={[styles.sourceNumber, { backgroundColor: colors.accent }]}><Text style={[styles.sourceNumberText, { color: colors.accentContrast }]}>{sourceIndex + 1}</Text></View>
              <View style={styles.sourceCopy}><Text numberOfLines={1} style={[styles.newsButtonText, { color: colors.text }]}>{source.title || '閱讀原文'}</Text><Text numberOfLines={1} style={[styles.newsDomain, { color: colors.textMuted }]}>{sourceDomain(source)}</Text></View>
              <ExternalLink size={16} color={colors.accent} />
            </TouchableOpacity>)}
            {!expanded && eventSources.length > 2 && <TouchableOpacity style={styles.moreSourcesButton} onPress={() => setExpandedEvents(current => ({ ...current, [eventKey]: true }))}><Text style={[styles.moreSourcesText, { color: colors.accent }]}>再查看 {eventSources.length - 2} 個來源</Text><ChevronDown size={14} color={colors.accent} /></TouchableOpacity>}
          </View>
        </View>;
      }) : <Text style={[styles.empty, { color: colors.textMuted }]}>{incompleteEventCount
        ? `搜尋到 ${incompleteEventCount} 筆候選新聞，但因缺少可核對時間或來源而未顯示。`
        : '今天沒有找到符合條件的重大事件。'}</Text>}
    </Section>}

    <View style={[styles.notice, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><ShieldCheck size={17} color={colors.accent} /><Text style={[styles.noticeText, { color: colors.textSub }]}>AI 只整理搜尋結果，可能遺漏、誤判或遇到來源更新延遲。請開啟原始連結核對，不會自動下單。</Text></View>
    <TouchableOpacity onPress={save} disabled={saving} style={[styles.save, { backgroundColor: colors.accent }]}>{saving ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={[styles.saveText, { color: colors.accentContrast }]}>儲存重大事件設定</Text>}</TouchableOpacity>
  </ScrollView>;
}

function Section({ title, colors, children, Icon }) {
  return <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={styles.sectionTitleRow}>{Icon && <Icon size={17} color={colors.accent} />}<Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text></View>{children}</View>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, loading: { marginTop: 12, fontSize: 13 }, content: { padding: 16, paddingBottom: 48, gap: 13 }, flex: { flex: 1 },
  hero: { borderWidth: 1, borderRadius: 20, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 }, heroIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, heroTitle: { fontSize: 17, fontWeight: '800' }, heroSub: { fontSize: 11, lineHeight: 17, marginTop: 3 },
  section: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 12 }, sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, sectionTitle: { fontSize: 15, fontWeight: '800' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, rowTitle: { fontSize: 13, fontWeight: '800' }, rowSub: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  label: { fontSize: 11, fontWeight: '700' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 36, borderWidth: 1, borderRadius: 18, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' }, chipText: { fontSize: 11, fontWeight: '800' }, hint: { fontSize: 10, lineHeight: 16 },
  channelText: { fontSize: 12, fontWeight: '800' }, outlineButton: { minHeight: 42, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, outlineText: { fontSize: 12, fontWeight: '800' },
  previewButton: { minHeight: 48, borderWidth: 1, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, previewText: { fontSize: 13, fontWeight: '900' },
  methodBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 11, gap: 4 }, methodTitle: { fontSize: 11, fontWeight: '900' }, methodText: { fontSize: 10, lineHeight: 16 }, eventCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, gap: 8 }, eventHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, eventSymbols: { fontSize: 11, fontWeight: '900' }, importance: { fontSize: 10, fontWeight: '900' }, eventTime: { fontSize: 9, lineHeight: 14 }, eventTitle: { fontSize: 15, lineHeight: 21, fontWeight: '900' }, eventSummary: { fontSize: 11, lineHeight: 18 }, eventImpact: { fontSize: 10, lineHeight: 17 }, expandButton: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }, expandText: { fontSize: 10, fontWeight: '800' }, eventSources: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 2, gap: 8 }, eventSourcesTitle: { fontSize: 11, fontWeight: '900' }, newsButton: { minHeight: 52, borderWidth: 1, borderRadius: 13, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 9 }, sourceNumber: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, sourceNumberText: { fontSize: 10, fontWeight: '900' }, sourceCopy: { flex: 1, gap: 2 }, newsButtonText: { fontSize: 11, fontWeight: '900' }, newsDomain: { fontSize: 9 }, moreSourcesButton: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }, moreSourcesText: { fontSize: 10, fontWeight: '800' }, sourcePending: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 9 }, sourcePendingText: { fontSize: 9, lineHeight: 14 }, empty: { fontSize: 11, lineHeight: 17 },
  notice: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, noticeText: { flex: 1, fontSize: 10, lineHeight: 16 }, save: { minHeight: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, saveText: { fontSize: 14, fontWeight: '900' },
});
