import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BellRing, Clock3, Link2, Mail, MessageCircle, ShieldCheck } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/ThemeContext';
import WebSafeTextInput from '../components/WebSafeTextInput';
import { resolveSavedNotificationStrategies } from '../utils/notificationStrategySelection';
import {
  NOTIFICATION_STRATEGY_KEYS,
  NOTIFICATION_STRATEGY_OPTIONS,
  STRATEGY_SELECTION_CATEGORIES,
  sortStrategyItems,
} from '../services/strategyOptions';

const MARKET_OPTIONS = [['TW', '台股'], ['US', '美股'], ['CRYPTO', '加密貨幣']];
const STRATEGY_SELECTION_STORAGE_KEY = 'wealthtracker.technical-analysis.selected-strategies.v1';
const HOURS = [8, 12, 16, 20, 22];
const DEFAULTS = {
  enabled: false,
  schedule_frequency: 'daily',
  daily_hour: 20,
  timezone: 'Asia/Taipei',
  email_enabled: false,
  notification_email: '',
  line_enabled: false,
  line_user_id: null,
  include_holdings: true,
  include_watchlist: true,
  markets: ['TW', 'US', 'CRYPTO'],
  strategies: ['hybrid'],
  signal_statuses: ['confirmed'],
  signal_directions: ['bullish', 'bearish'],
  strategy_settings: {},
};

const toggleArray = (values, value) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
const toggleStrategy = (values, value) => {
  if (value === 'hybrid') return values.includes('hybrid') ? [] : ['hybrid'];
  const withoutHybrid = values.filter(item => item !== 'hybrid');
  return toggleArray(withoutHybrid, value);
};
const readCurrentViewingStrategyKeys = async () => {
  try {
    const raw = await AsyncStorage.getItem(STRATEGY_SELECTION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed?.selectedStrategyKeys)
      ? [...new Set(parsed.selectedStrategyKeys.filter(key => NOTIFICATION_STRATEGY_KEYS.has(key) && key !== 'hybrid'))]
      : [];
  } catch (_) {
    return [];
  }
};
const currentTestFilters = form => ({
  include_holdings: form.include_holdings,
  include_watchlist: form.include_watchlist,
  markets: form.markets,
  strategies: form.strategies,
  signal_statuses: form.signal_statuses,
  signal_directions: form.signal_directions,
});
const testResultSummary = data => {
  const counts = data?.alertsByMarket || {};
  const diagnostics = Array.isArray(data?.diagnostics) ? data.diagnostics : [];
  const analyzed = diagnostics.filter(item => item.status !== 'failed').length;
  const failed = diagnostics.filter(item => item.status === 'failed');
  const unmatched = diagnostics.filter(item => item.status === 'no_match');
  const breakdown = MARKET_OPTIONS
    .filter(([key]) => Number(counts[key] || 0) > 0)
    .map(([key, label]) => `${label} ${counts[key]} 筆`)
    .join('、');
  const scan = `已依畫面目前選擇掃描 ${Number(data?.targetsScanned || 0)} 檔，成功分析 ${analyzed || Number(data?.targetsScanned || 0)} 檔，產生 ${Number(data?.alertsFound || 0)} 張策略訊號卡`;
  const details = [];
  if (failed.length) details.push(`行情失敗 ${failed.length} 檔：${failed.slice(0, 8).map(item => item.symbol).join('、')}`);
  if (unmatched.length) details.push(`目前無符合訊號 ${unmatched.length} 檔：${unmatched.slice(0, 8).map(item => item.symbol).join('、')}`);
  const base = breakdown ? `${scan}（${breakdown}）。` : `${scan}。`;
  return details.length ? `${base}\n${details.join('\n')}` : base;
};
const functionErrorMessage = async error => {
  let message = error?.message || '請確認後端通知服務設定。';
  try {
    const payload = await error?.context?.json?.();
    if (payload?.error) message = payload.error;
  } catch (_) {
    // Keep the SDK error when the response body cannot be decoded.
  }
  return message;
};

export default function SignalNotificationSettingsScreen() {
  const { colors } = useTheme();
  const [form, setForm] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingLine, setTestingLine] = useState(false);
  const [currentViewingStrategyKeys, setCurrentViewingStrategyKeys] = useState([]);
  const [lastRunAt, setLastRunAt] = useState(null);
  const [lastDeliveryAt, setLastDeliveryAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: { user } }, viewingStrategyKeys] = await Promise.all([
        supabase.auth.getUser(),
        readCurrentViewingStrategyKeys(),
      ]);
      if (!user) throw new Error('請先登入');
      const { data, error } = await supabase
        .from('investment_signal_preferences')
        .select('enabled,schedule_frequency,daily_hour,timezone,email_enabled,notification_email,line_enabled,line_user_id,include_holdings,include_watchlist,markets,strategies,signal_statuses,signal_directions,strategy_settings,last_notification_run_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      const { data: delivery } = await supabase.from('signal_notification_deliveries')
        .select('created_at').eq('user_id', user.id).eq('status', 'sent')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      setLastRunAt(data?.last_notification_run_at || null);
      setLastDeliveryAt(delivery?.created_at || null);
      const strategies = resolveSavedNotificationStrategies(data?.strategies, NOTIFICATION_STRATEGY_KEYS, DEFAULTS.strategies);
      setCurrentViewingStrategyKeys(viewingStrategyKeys);
      const { last_notification_run_at: _lastRunAt, ...savedForm } = data || {};
      setForm({ ...DEFAULTS, notification_email: user.email || '', ...savedForm, strategies });
    } catch (error) {
      Alert.alert('無法讀取通知設定', error.message || '請稍後再試');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const update = changes => setForm(current => ({ ...current, ...changes }));
  const toggleNotificationStrategy = key => update({ strategies: toggleStrategy(form.strategies, key) });
  const applyCurrentViewingStrategies = () => {
    if (!currentViewingStrategyKeys.length) {
      Alert.alert('目前沒有選擇策略', '請先到技術分析的「目前查看策略」勾選策略，或直接在這裡選取。');
      return;
    }
    update({ strategies: currentViewingStrategyKeys });
  };

  const validateScanFilters = () => {
    if (!form.include_holdings && !form.include_watchlist) return '請至少選擇持倉或自選清單。';
    if (!form.markets.length) return '請至少選擇一個市場。';
    if (!form.strategies.length) return '請至少選擇一個策略。';
    if (!form.signal_statuses.length) return '請至少選擇一種信號狀態。';
    if (!form.signal_directions.length) return '請至少選擇一個訊號方向。';
    return null;
  };

  const validate = () => {
    const scanError = validateScanFilters();
    if (scanError) return scanError;
    if (form.email_enabled && !/^\S+@\S+\.\S+$/.test(form.notification_email.trim())) return '請輸入有效的通知 Email。';
    if (form.line_enabled && !form.line_user_id) return '請先完成 LINE 綁定。';
    if (form.enabled && !form.email_enabled && !form.line_enabled) return '請至少開啟 Email 或 LINE。';
    return null;
  };

  const save = async () => {
    const validationError = validate();
    if (validationError) return Alert.alert('尚未完成設定', validationError);
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('請先登入');
      const payload = {
        user_id: user.id,
        ...form,
        notification_email: form.notification_email.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('investment_signal_preferences').upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
      Alert.alert('通知設定已儲存', form.enabled ? '系統會依排程檢查，只有符合條件的標的才會通知。' : '排程通知目前為關閉。');
    } catch (error) {
      Alert.alert('儲存失敗', error.message || '請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  const createLineLink = async () => {
    setLinking(true);
    try {
      const { data, error } = await supabase.functions.invoke('signal-notifications', { body: { action: 'create_line_link' } });
      if (error) throw error;
      if (!data?.code) throw new Error(data?.error || '無法產生綁定碼');
      Alert.alert(
        'LINE 綁定碼',
        `請先加入 WealthTracker LINE 官方帳號，再於聊天室輸入：\n\n綁定 ${data.code}\n\n綁定碼 ${data.expiresInMinutes || 10} 分鐘內有效。完成後回到此頁重新整理。`,
      );
    } catch (error) {
      Alert.alert('無法產生 LINE 綁定碼', error.message || '請稍後再試');
    } finally {
      setLinking(false);
    }
  };

  const sendTestEmail = async () => {
    const scanError = validateScanFilters();
    if (scanError) return Alert.alert('無法開始測試', scanError);
    if (!/^\S+@\S+\.\S+$/.test(form.notification_email.trim())) return Alert.alert('請先輸入有效的通知 Email');
    setTestingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('signal-notifications', {
        body: { action: 'send_test_email', email: form.notification_email.trim(), filters: currentTestFilters(form) },
      });
      if (error) throw error;
      if (!data?.sent) throw new Error(data?.error || '測試信寄送失敗');
      const summary = testResultSummary(data);
      Alert.alert('全部符合條件的 Email 已寄出', `${summary}\n\n本次不套用歷史去重，已寄送到 ${form.notification_email.trim()}，請一併查看垃圾郵件匣。`);
    } catch (error) {
      Alert.alert('無法寄送測試信', await functionErrorMessage(error));
    } finally {
      setTestingEmail(false);
    }
  };

  const sendTestLine = async () => {
    const scanError = validateScanFilters();
    if (scanError) return Alert.alert('無法開始測試', scanError);
    if (!form.line_user_id) return Alert.alert('請先完成 LINE 綁定');
    setTestingLine(true);
    try {
      const { data, error } = await supabase.functions.invoke('signal-notifications', {
        body: { action: 'send_test_line', filters: currentTestFilters(form) },
      });
      if (error) throw error;
      if (!data?.sent) throw new Error(data?.error || '測試 LINE 通知寄送失敗');
      const summary = testResultSummary(data);
      Alert.alert('全部符合條件的 LINE 已送出', `${summary}\n\n本次不套用歷史去重，請到 WealthTracker LINE 官方帳號聊天室查看。`);
    } catch (error) {
      Alert.alert('無法寄送測試 LINE', await functionErrorMessage(error));
    } finally {
      setTestingLine(false);
    }
  };

  if (loading) return <View style={[styles.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.accent} /><Text style={[styles.loading, { color: colors.textSub }]}>正在讀取通知設定…</Text></View>;

  const chip = (selected, onPress, label, key) => <TouchableOpacity key={key || label} onPress={onPress} style={[styles.chip, { backgroundColor: selected ? colors.accentSoft : colors.cardAlt, borderColor: selected ? colors.accent : colors.border }]}><Text style={[styles.chipText, { color: selected ? colors.accent : colors.textSub }]}>{label}</Text></TouchableOpacity>;
  const row = (title, subtitle, value, onValueChange, Icon) => <View style={styles.switchRow}><View style={[styles.icon, { backgroundColor: colors.accentSoft }]}><Icon size={18} color={colors.accent} /></View><View style={styles.flex}><Text style={[styles.rowTitle, { color: colors.text }]}>{title}</Text><Text style={[styles.rowSub, { color: colors.textSub }]}>{subtitle}</Text></View><Switch value={value} onValueChange={onValueChange} trackColor={{ false: colors.border, true: colors.accentSoft }} thumbColor={value ? colors.accent : colors.textMuted} /></View>;
  const strategyGroups = STRATEGY_SELECTION_CATEGORIES
    .map(category => ({ category, items: sortStrategyItems(NOTIFICATION_STRATEGY_OPTIONS.filter(item => item.category === category)) }))
    .filter(group => group.items.length);
  const currentViewingStrategyNames = currentViewingStrategyKeys
    .map(key => NOTIFICATION_STRATEGY_OPTIONS.find(item => item.key === key)?.label)
    .filter(Boolean);

  return <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
    <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={[styles.heroIcon, { backgroundColor: colors.accentSoft }]}><BellRing size={24} color={colors.accent} /></View><View style={styles.flex}><Text style={[styles.heroTitle, { color: colors.text }]}>進出場訊號通知</Text><Text style={[styles.heroSub, { color: colors.textSub }]}>依持倉與自選清單掃描；僅寄送符合所選策略的研究訊號。</Text></View><Switch value={form.enabled} onValueChange={value => update({ enabled: value })} trackColor={{ false: colors.border, true: colors.accentSoft }} thumbColor={form.enabled ? colors.accent : colors.textMuted} /></View>
    <View style={[styles.statusBar, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.statusText, { color: colors.textSub }]}>上次掃描：{lastRunAt ? new Date(lastRunAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '尚無紀錄'}</Text><Text style={[styles.statusText, { color: colors.textSub }]}>上次成功寄送：{lastDeliveryAt ? new Date(lastDeliveryAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '尚無紀錄'}</Text></View>

    <Section title="檢查頻率" colors={colors} Icon={Clock3}>
      <View style={styles.chips}>{chip(form.schedule_frequency === 'hourly', () => update({ schedule_frequency: 'hourly' }), '每小時', 'hourly')}{chip(form.schedule_frequency === 'daily', () => update({ schedule_frequency: 'daily' }), '每天一次', 'daily')}</View>
      {form.schedule_frequency === 'daily' && <><Text style={[styles.label, { color: colors.textSub }]}>通知時間（Asia/Taipei）</Text><View style={styles.chips}>{HOURS.map(hour => chip(form.daily_hour === hour, () => update({ daily_hour: hour }), `${String(hour).padStart(2, '0')}:00`, hour))}</View></>}
      <Text style={[styles.hint, { color: colors.textMuted }]}>開盤期間會把當日盤中價量組成「暫估日 K」重新計算策略；只有訊號結果改變，或首次跌破／站回失效價時才通知，不會每小時重寄相同內容。正式確認與失效仍以收盤日 K 為準。</Text>
    </Section>

    <Section title="掃描範圍" colors={colors}>
      {row('目前持倉', '掃描帳戶中持有股數大於 0 的投資資產', form.include_holdings, value => update({ include_holdings: value }), ShieldCheck)}
      {row('自選清單', '包含尚未持有、但已加入自選的標的', form.include_watchlist, value => update({ include_watchlist: value }), Link2)}
      <Text style={[styles.label, { color: colors.textSub }]}>市場</Text><View style={styles.chips}>{MARKET_OPTIONS.map(([key, label]) => chip(form.markets.includes(key), () => update({ markets: toggleArray(form.markets, key) }), label, key))}</View>
    </Section>

    <Section title="通知條件" colors={colors}>
      <View style={styles.strategyConditionHeader}><Text style={[styles.label, { color: colors.textSub }]}>策略</Text><TouchableOpacity onPress={applyCurrentViewingStrategies} disabled={!currentViewingStrategyKeys.length} style={[styles.applyViewingButton, { backgroundColor: currentViewingStrategyKeys.length ? colors.accentSoft : colors.cardAlt, borderColor: currentViewingStrategyKeys.length ? colors.accent : colors.border }]}><Text style={[styles.applyViewingButtonText, { color: currentViewingStrategyKeys.length ? colors.accent : colors.textMuted }]}>沿用目前查看策略</Text></TouchableOpacity></View>
      {currentViewingStrategyNames.length > 0 && <Text style={[styles.hint, { color: colors.textMuted }]}>通知策略會保留上次儲存的選擇；需要帶入目前查看的 {currentViewingStrategyNames.length} 項策略時，請點「沿用目前查看策略」，再儲存通知設定。</Text>}
      {strategyGroups.map(group => <View key={group.category} style={styles.strategyGroup}><Text style={[styles.strategyGroupTitle, { color: colors.textMuted }]}>{group.category}</Text><View style={styles.chips}>{group.items.map(item => chip(form.strategies.includes(item.key), () => toggleNotificationStrategy(item.key), item.label, item.key))}</View></View>)}
      <Text style={[styles.hint, { color: colors.textMuted }]}>「接近支撐／壓力」使用圖上的 S1／S2、R1／R2 區域（至少 2 次歷史轉折測試）。壓力可在區間外提前提示：距下緣不超過現價 1% 或半個 ATR14（取較大值、上限 2%）；支撐維持原條件。勾選後可獨立通知，不會開啟其他策略的「等待確認」。</Text>
      <Text style={[styles.hint, { color: colors.textMuted }]}>其他策略須符合下方狀態與方向才通知；支撐／壓力到價仍須符合方向，但固定為觀察訊號。資料不足不通知。</Text>
      <Text style={[styles.label, { color: colors.textSub }]}>訊號狀態</Text><View style={styles.chips}>{chip(form.signal_statuses.includes('confirmed'), () => update({ signal_statuses: toggleArray(form.signal_statuses, 'confirmed') }), '已確認進出場', 'confirmed')}{chip(form.signal_statuses.includes('watch'), () => update({ signal_statuses: toggleArray(form.signal_statuses, 'watch') }), '等待確認', 'watch')}</View>
      <Text style={[styles.label, { color: colors.textSub }]}>訊號方向</Text><View style={styles.chips}>{chip(form.signal_directions.includes('bullish'), () => update({ signal_directions: toggleArray(form.signal_directions, 'bullish') }), '偏多／進場注意', 'bullish')}{chip(form.signal_directions.includes('bearish'), () => update({ signal_directions: toggleArray(form.signal_directions, 'bearish') }), '偏空／出場注意', 'bearish')}</View>
    </Section>

    <Section title="通知方式" colors={colors}>
      {row('Email', '可使用登入信箱，也能設定另一個通知信箱', form.email_enabled, value => update({ email_enabled: value }), Mail)}
      {form.email_enabled && <WebSafeTextInput value={form.notification_email} onChangeText={value => update({ notification_email: value })} placeholder="name@example.com" placeholderTextColor={colors.textMuted} keyboardType="email-address" autoCapitalize="none" style={[styles.input, { color: colors.text, backgroundColor: colors.cardAlt, borderColor: colors.border }]} />}
      {form.email_enabled && <><TouchableOpacity onPress={sendTestEmail} disabled={testingEmail} style={[styles.linkButton, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>{testingEmail ? <ActivityIndicator size="small" color={colors.accent} /> : <Mail size={16} color={colors.accent} />}<Text style={[styles.linkText, { color: colors.accent }]}>立即寄出全部符合訊號 Email</Text></TouchableOpacity><Text style={[styles.hint, { color: colors.textMuted }]}>直接依畫面目前條件重新掃描並完整寄出，不比較之前是否寄過，也不必先儲存。市場開盤時會使用盤中暫估日 K；信件會標示為手動寄送，不影響正式排程去重紀錄。</Text></>}
      <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
      {row('LINE', form.line_user_id ? '已綁定，可由 LINE 官方帳號接收通知' : '加入官方帳號並輸入一次性綁定碼', form.line_enabled, value => update({ line_enabled: value }), MessageCircle)}
      <TouchableOpacity onPress={createLineLink} disabled={linking} style={[styles.linkButton, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>{linking ? <ActivityIndicator size="small" color={colors.accent} /> : <Link2 size={16} color={colors.accent} />}<Text style={[styles.linkText, { color: colors.accent }]}>{form.line_user_id ? '重新綁定 LINE' : '產生 LINE 綁定碼'}</Text></TouchableOpacity>
      <TouchableOpacity onPress={load} style={[styles.refreshButton, { borderColor: colors.border }]}><Text style={[styles.linkText, { color: colors.textSub }]}>檢查 LINE 綁定狀態</Text></TouchableOpacity>
      {form.line_user_id && <><TouchableOpacity onPress={sendTestLine} disabled={testingLine} style={[styles.linkButton, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>{testingLine ? <ActivityIndicator size="small" color={colors.accent} /> : <MessageCircle size={16} color={colors.accent} />}<Text style={[styles.linkText, { color: colors.accent }]}>立即寄出全部符合訊號 LINE</Text></TouchableOpacity><Text style={[styles.hint, { color: colors.textMuted }]}>直接依畫面目前條件重新掃描並完整寄出，不比較之前是否寄過，也不必先儲存。市場開盤時會使用盤中暫估日 K；訊號較多時會依 LINE 限制分批寄送，每一批都會計入免費訊息額度。</Text></>}
    </Section>

    <View style={[styles.notice, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><ShieldCheck size={17} color={colors.accent} /><Text style={[styles.noticeText, { color: colors.textSub }]}>通知只提供研究訊號，不會自動下單。盤中策略結果是依當下 OHLCV 計算的暫估值，可能隨行情改變；盤中風險另使用失效價 0.3% 緩衝。兩者都不會覆寫正式收盤結論。</Text></View>
    <TouchableOpacity onPress={save} disabled={saving} style={[styles.save, { backgroundColor: colors.accent }]}>{saving ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={[styles.saveText, { color: colors.accentContrast }]}>儲存通知設定</Text>}</TouchableOpacity>
  </ScrollView>;
}

function Section({ title, colors, children, Icon }) {
  return <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={styles.sectionTitleRow}>{Icon && <Icon size={17} color={colors.accent} />}<Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text></View>{children}</View>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, loading: { marginTop: 12, fontSize: 13 },
  content: { padding: 16, paddingBottom: 48, gap: 13 }, flex: { flex: 1 },
  hero: { borderWidth: 1, borderRadius: 20, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 }, heroIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, heroTitle: { fontSize: 17, fontWeight: '800' }, heroSub: { fontSize: 11, lineHeight: 17, marginTop: 3 },
  statusBar: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, gap: 3 }, statusText: { fontSize: 10, lineHeight: 15 },
  section: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 12 }, sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, sectionTitle: { fontSize: 15, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 36, borderWidth: 1, borderRadius: 18, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' }, chipText: { fontSize: 11, fontWeight: '800' },
  strategyConditionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, strategyGroup: { gap: 7 }, strategyGroupTitle: { fontSize: 10, fontWeight: '900' }, applyViewingButton: { minHeight: 32, borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }, applyViewingButtonText: { fontSize: 10, fontWeight: '900' },
  label: { fontSize: 11, fontWeight: '700', marginTop: 2 }, hint: { fontSize: 10, lineHeight: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, rowTitle: { fontSize: 13, fontWeight: '800' }, rowSub: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 13 }, divider: { height: StyleSheet.hairlineWidth },
  linkButton: { minHeight: 42, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, linkText: { fontSize: 12, fontWeight: '800' },
  refreshButton: { minHeight: 40, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  notice: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, noticeText: { flex: 1, fontSize: 10, lineHeight: 16 },
  save: { minHeight: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, saveText: { fontSize: 14, fontWeight: '900' },
});
