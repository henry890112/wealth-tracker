import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Dimensions, ActivityIndicator,
  TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { BlurView } from 'expo-blur';
import Svg, { Path } from 'react-native-svg';
import { X, Calendar } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { convertToBaseCurrency } from '../services/api';
import { useTheme } from '../lib/ThemeContext';

const { width: screenWidth } = Dimensions.get('window');
const PRIMARY = '#16a34a';

const PERIODS = [
  { label: '7d',   days: 7 },
  { label: '30d',  days: 30 },
  { label: '90d',  days: 90 },
  { label: '180d', days: 180 },
  { label: '自定義', days: null },
];

const CATEGORY_CONFIG = {
  liquid:     { label: '流動資產', color: '#16a34a' },
  investment: { label: '投資資產', color: '#f59e0b' },
  fixed:      { label: '固定資產', color: '#94a3b8' },
  receivable: { label: '應收款項', color: '#0d9488' },
};

const formatAmount = (amount) => {
  return Math.round(amount).toLocaleString('zh-TW');
};

// Validates YYYY-MM-DD
const isValidDate = (str) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
};

function DonutChart({ data, size = 160, strokeWidth = 30 }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  let angle = -Math.PI / 2;
  const arcs = data.map(item => {
    const a = (item.value / total) * 2 * Math.PI * 0.99;
    const x1 = cx + radius * Math.cos(angle);
    const y1 = cy + radius * Math.sin(angle);
    angle += a;
    const x2 = cx + radius * Math.cos(angle);
    const y2 = cy + radius * Math.sin(angle);
    angle += 2 * Math.PI * 0.01;
    return { d: `M ${x1} ${y1} A ${radius} ${radius} 0 ${a > Math.PI ? 1 : 0} 1 ${x2} ${y2}`, color: item.color };
  });
  return (
    <Svg width={size} height={size}>
      {arcs.map((arc, i) => (
        <Path key={i} d={arc.d} fill="none" stroke={arc.color} strokeWidth={strokeWidth} strokeLinecap="round" />
      ))}
    </Svg>
  );
}

export default function TrendsScreen() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [categoryTotals, setCategoryTotals] = useState([]);
  const [userId, setUserId] = useState(null);

  const [selectedPeriod, setSelectedPeriod] = useState(PERIODS[2]); // default 90d
  const [customRange, setCustomRange] = useState(null); // { start, end } strings

  // Custom date modal
  const [customModalVisible, setCustomModalVisible] = useState(false);
  const [inputStart, setInputStart] = useState('');
  const [inputEnd, setInputEnd] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadSnapshots = useCallback(async (uid, days, range) => {
    setSnapshotLoading(true);
    try {
      let query = supabase
        .from('daily_snapshots').select('*')
        .eq('user_id', uid)
        .order('snapshot_date', { ascending: true });

      if (range) {
        query = query.gte('snapshot_date', range.start).lte('snapshot_date', range.end);
      } else {
        const since = new Date();
        since.setDate(since.getDate() - days);
        query = query.gte('snapshot_date', since.toISOString().split('T')[0]);
      }

      const { data } = await query;
      setSnapshots(data || []);
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data: profileData } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();
      setProfile(profileData);

      await loadSnapshots(user.id, PERIODS[2].days, null);

      const { data: assetsData } = await supabase
        .from('assets').select('category, current_amount, currency')
        .eq('user_id', user.id);

      if (assetsData) {
        const baseCurrency = profileData?.base_currency || 'TWD';
        const catSums = {};
        await Promise.all(
          assetsData.filter(a => a.category !== 'liability').map(async (a) => {
            const amt = await convertToBaseCurrency(parseFloat(a.current_amount), a.currency, baseCurrency);
            catSums[a.category] = (catSums[a.category] || 0) + amt;
          })
        );
        setCategoryTotals(
          Object.entries(catSums)
            .filter(([, v]) => v > 0)
            .map(([cat, value]) => ({
              label: CATEGORY_CONFIG[cat]?.label || cat,
              value,
              color: CATEGORY_CONFIG[cat]?.color || '#888',
            }))
        );
      }
    } catch (e) {
      console.error('Error loading charts:', e);
    } finally {
      setLoading(false);
    }
  };

  const handlePeriodSelect = (period) => {
    if (period.days === null) {
      // Custom: pre-fill with last selection or sensible default
      const today = new Date().toISOString().split('T')[0];
      const prior = new Date();
      prior.setDate(prior.getDate() - 30);
      setInputStart(customRange?.start || prior.toISOString().split('T')[0]);
      setInputEnd(customRange?.end || today);
      setCustomModalVisible(true);
      return;
    }
    setSelectedPeriod(period);
    setCustomRange(null);
    if (userId) loadSnapshots(userId, period.days, null);
  };

  const applyCustomRange = () => {
    if (!isValidDate(inputStart) || !isValidDate(inputEnd)) {
      Alert.alert('格式錯誤', '請輸入正確的日期格式 YYYY-MM-DD');
      return;
    }
    if (inputStart > inputEnd) {
      Alert.alert('日期錯誤', '開始日期不能晚於結束日期');
      return;
    }
    const range = { start: inputStart, end: inputEnd };
    setCustomRange(range);
    setSelectedPeriod(PERIODS[4]); // 自定義
    setCustomModalVisible(false);
    if (userId) loadSnapshots(userId, null, range);
  };

  const currency = profile?.base_currency || 'TWD';
  const fmt = (v) => formatAmount(v);

  if (loading) {
    return <View style={[styles.loading, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={PRIMARY} /></View>;
  }

  const hasData = snapshots.length > 0;

  const getChartData = () => {
    if (!hasData) return { data: { labels: [''], datasets: [{ data: [0] }] }, baseline: 0 };
    const values = snapshots.map(s => Math.round(parseFloat(s.net_worth_base)));
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal;
    // Add 15% padding above and below so the line never touches the edges
    const padding = range > 0 ? range * 0.15 : Math.abs(minVal) * 0.1 || 100;
    const baseline = Math.max(0, minVal - padding);

    const step = Math.max(1, Math.ceil(snapshots.length / 6));
    const labels = snapshots
      .filter((_, i) => i % step === 0 || i === snapshots.length - 1)
      .map(s => {
        const d = new Date(s.snapshot_date);
        return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`;
      });
    return {
      data: {
        labels,
        datasets: [{
          data: values.map(v => v - baseline),
          color: (opacity = 1) => `rgba(22, 163, 74, ${opacity})`,
          strokeWidth: 2,
        }],
      },
      baseline,
    };
  };

  const fmtYLabel = (val, baseline) => {
    const abs = parseFloat(val) + baseline;
    return Math.round(abs).toLocaleString('zh-TW');
  };

  let changeText = null;
  if (hasData && snapshots.length >= 2) {
    const first = parseFloat(snapshots[0].net_worth_base);
    const last = parseFloat(snapshots[snapshots.length - 1].net_worth_base);
    const diff = last - first;
    const pct = first !== 0 ? ((diff / Math.abs(first)) * 100).toFixed(1) : '0.0';
    changeText = { diff, pct, positive: diff >= 0 };
  }

  const periodLabel = selectedPeriod.days === null && customRange
    ? `${customRange.start} ~ ${customRange.end}`
    : selectedPeriod.label;

  const donutTotal = categoryTotals.reduce((s, d) => s + d.value, 0);
  const { data: chartData, baseline: chartBaseline } = getChartData();

  return (
    <>
      <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* Trend chart card */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>淨資產趨勢（{currency}）</Text>
            {changeText && (
              <Text style={[styles.changeBadge, changeText.positive ? styles.pos : styles.neg]}>
                {changeText.positive ? '+' : ''}{changeText.pct}%
              </Text>
            )}
          </View>

          {/* ── Liquid Glass period selector ── */}
          <View style={styles.glassContainer}>
            <BlurView intensity={30} tint="light" style={StyleSheet.absoluteFill} />
            <View style={styles.periodRow}>
              {PERIODS.map((p) => {
                const isActive = p.days === selectedPeriod.days && !(p.days === null && selectedPeriod.days !== null);
                const isCustomActive = p.days === null && selectedPeriod.days === null;
                const active = isActive || isCustomActive;
                return (
                  <TouchableOpacity
                    key={p.label}
                    style={[styles.periodBtn, active && styles.periodBtnActive]}
                    onPress={() => handlePeriodSelect(p)}
                    activeOpacity={0.75}
                  >
                    {p.days === null && <Calendar size={10} color={active ? 'white' : PRIMARY} style={{ marginRight: 3 }} />}
                    <Text style={[styles.periodLabel, active && styles.periodLabelActive]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Chart */}
          {snapshotLoading ? (
            <View style={styles.chartLoading}>
              <ActivityIndicator size="small" color={PRIMARY} />
            </View>
          ) : snapshots.length >= 2 ? (
            <LineChart
              data={chartData}
              width={screenWidth - 64}
              height={200}
              yAxisWidth={72}
              formatYLabel={(val) => fmtYLabel(val, chartBaseline)}
              chartConfig={{
                backgroundGradientFrom: colors.card,
                backgroundGradientTo: colors.card,
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(22, 163, 74, ${opacity})`,
                labelColor: (opacity = 1) => `rgba(148, 163, 184, ${opacity})`,
                fillShadowGradient: '#16a34a',
                fillShadowGradientOpacity: 0.12,
                propsForDots: { r: '3', strokeWidth: '1.5', stroke: '#16a34a' },
                propsForBackgroundLines: { stroke: colors.borderLight },
              }}
              withShadow
              bezier
              style={{ borderRadius: 8, marginLeft: -8, marginTop: 4 }}
            />
          ) : (
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              {hasData ? '需要至少兩天的記錄才能顯示趨勢\n明日系統會自動記錄今日資產' : '此區間尚無數據\n系統每日自動記錄您的資產狀況'}
            </Text>
          )}

          {changeText && (
            <Text style={[styles.changeDetail, changeText.positive ? styles.posText : styles.negText]}>
              {periodLabel}變化：{changeText.positive ? '+' : ''}{fmt(changeText.diff)}
            </Text>
          )}
        </View>

        {/* Asset allocation */}
        {categoryTotals.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>資產配置</Text>
            <View style={styles.donutRow}>
              <DonutChart data={categoryTotals} size={120} strokeWidth={22} />
              <View style={styles.legend}>
                {categoryTotals.map((item, i) => (
                  <View key={i} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                    <View>
                      <Text style={[styles.legendLabel, { color: colors.textSub }]}>{item.label}</Text>
                      <Text style={[styles.legendValue, { color: colors.text }]}>{fmt(item.value)}</Text>
                      <Text style={[styles.legendPct, { color: colors.textMuted }]}>
                        {donutTotal > 0 ? ((item.value / donutTotal) * 100).toFixed(1) : 0}%
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Custom date range modal */}
      <Modal
        visible={customModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalSheet}>
            {/* Frosted glass background */}
            <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>自定義區間</Text>
                <TouchableOpacity onPress={() => setCustomModalVisible(false)}>
                  <X size={20} color={colors.textSub} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.inputLabel, { color: colors.textSub }]}>開始日期</Text>
              <TextInput
                style={[styles.dateInput, { color: colors.text }]}
                value={inputStart}
                onChangeText={setInputStart}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#cbd5e1"
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />

              <Text style={[styles.inputLabel, { color: colors.textSub }]}>結束日期</Text>
              <TextInput
                style={[styles.dateInput, { color: colors.text }]}
                value={inputEnd}
                onChangeText={setInputEnd}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#cbd5e1"
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />

              <TouchableOpacity style={styles.applyBtn} onPress={applyCustomRange}>
                <Text style={styles.applyBtnText}>套用</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  chartLoading: { height: 200, justifyContent: 'center', alignItems: 'center' },

  card: {
    margin: 16, marginBottom: 0, padding: 20,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  changeBadge: { fontSize: 13, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  pos: { color: PRIMARY, backgroundColor: '#dcfce7' },
  neg: { color: '#ef4444', backgroundColor: '#fee2e2' },

  // ── Liquid Glass ──
  glassContainer: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(22, 163, 74, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(22, 163, 74, 0.15)',
    marginBottom: 14,
    // subtle inner shadow illusion
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  periodRow: {
    flexDirection: 'row',
    padding: 5,
    gap: 4,
  },
  periodBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  periodBtnActive: {
    backgroundColor: PRIMARY,
    borderColor: 'rgba(255,255,255,0.3)',
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 4,
  },
  periodLabel: { fontSize: 12, color: PRIMARY, fontWeight: '600' },
  periodLabelActive: { color: 'white', fontWeight: '700' },

  emptyText: { textAlign: 'center', lineHeight: 22, paddingVertical: 32 },
  changeDetail: { fontSize: 13, fontWeight: '500', marginTop: 12, textAlign: 'right' },
  posText: { color: PRIMARY },
  negText: { color: '#ef4444' },

  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 8 },
  legend: { flex: 1, gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginTop: 3 },
  legendLabel: { fontSize: 12 },
  legendValue: { fontSize: 14, fontWeight: '700' },
  legendPct: { fontSize: 11 },

  // ── Custom date modal ──
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  modalContent: {
    padding: 28,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  inputLabel: { fontSize: 13, marginBottom: 6, fontWeight: '500' },
  dateInput: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(22,163,74,0.25)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  applyBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  applyBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});
