import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Dimensions, ActivityIndicator,
  TouchableOpacity, Modal, Platform, Alert, RefreshControl, Animated,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';
import { X, Calendar } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
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

const MARKET_TYPE_CONFIG = {
  TW:     { label: '台股', color: '#e11d48' },
  US:     { label: '美股', color: '#2563eb' },
  Crypto: { label: '虛幣', color: '#f59e0b' },
  other:  { label: '其他', color: '#94a3b8' },
};

const DRILL_PALETTE = ['#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4'];

const FILTER_OPTIONS = [
  { label: '全部',  key: 'all' },
  { label: '台股',  key: 'TW' },
  { label: '美股',  key: 'US' },
  { label: '虛幣',  key: 'Crypto' },
  { label: '外幣',  key: 'liquid' },
  { label: '其他',  key: 'other' },
];

const formatAmount = (amount) => {
  return Math.round(amount).toLocaleString('zh-TW');
};

// Validates YYYY-MM-DD
const isValidDate = (str) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
};

// ── Date Wheel Picker ──
const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS; // 220
const YEARS = Array.from({ length: 7 }, (_, i) => 2020 + i); // 2020–2026
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const getDaysInMonth = (year, month) => new Date(year, month, 0).getDate();
const pad2 = (n) => String(n).padStart(2, '0');

function WheelColumn({ data, selectedValue, onValueChange, formatLabel, colors, scrollTrigger }) {
  const ref = useRef(null);

  useEffect(() => {
    const idx = data.indexOf(selectedValue);
    if (ref.current && idx >= 0) {
      const timer = setTimeout(() => {
        ref.current?.scrollTo({ y: idx * ITEM_HEIGHT, animated: false });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [scrollTrigger]); // re-scroll whenever trigger fires (modal open / field switch / reset)

  return (
    <ScrollView
      ref={ref}
      style={{ height: PICKER_HEIGHT, flex: 1 }}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_HEIGHT}
      decelerationRate="fast"
      onMomentumScrollEnd={(e) => {
        const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
        const clamped = Math.max(0, Math.min(index, data.length - 1));
        onValueChange(data[clamped]);
      }}
      contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
    >
      {data.map((item, i) => {
        const isSelected = item === selectedValue;
        return (
          <View key={i} style={{ height: ITEM_HEIGHT, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{
              fontSize: isSelected ? 20 : 16,
              fontWeight: isSelected ? '700' : '400',
              color: isSelected ? '#10b981' : colors.textSub,
            }}>
              {formatLabel ? formatLabel(item) : String(item)}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

function DonutChart({ data, size = 180, strokeWidth = 28, selectedIndex, onSelect }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const SELECTED_EXTRA = 6;
  const radius = (size - strokeWidth - SELECTED_EXTRA) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const sel = selectedIndex != null ? data[selectedIndex] : null;

  // Single item: draw a full circle instead of an arc
  if (data.length === 1) {
    const isSelected = selectedIndex === 0;
    const sw = isSelected ? strokeWidth + SELECTED_EXTRA : strokeWidth;
    return (
      <Svg width={size} height={size}>
        <Circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke={data[0].color}
          strokeWidth={sw}
          onPress={() => onSelect(isSelected ? null : 0)}
        />
        {sel ? (
          <>
            <SvgText x={cx} y={cy - 6} textAnchor="middle" fill={sel.color} fontSize="18" fontWeight="bold">100%</SvgText>
            <SvgText x={cx} y={cy + 12} textAnchor="middle" fill="#94a3b8" fontSize="10">{sel.label}</SvgText>
          </>
        ) : (
          <SvgText x={cx} y={cy + 5} textAnchor="middle" fill="#94a3b8" fontSize="12">資產配置</SvgText>
        )}
      </Svg>
    );
  }

  const GAP = 0.03;
  let angle = -Math.PI / 2;

  const arcs = data.map((item) => {
    const fraction = item.value / total;
    const sweep = fraction * 2 * Math.PI - GAP;
    const x1 = cx + radius * Math.cos(angle);
    const y1 = cy + radius * Math.sin(angle);
    angle += sweep;
    const x2 = cx + radius * Math.cos(angle);
    const y2 = cy + radius * Math.sin(angle);
    angle += GAP;
    return {
      d: `M ${x1} ${y1} A ${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2}`,
      color: item.color,
      pct: (fraction * 100).toFixed(1),
    };
  });

  return (
    <Svg width={size} height={size}>
      {arcs.map((arc, i) => {
        const isSelected = selectedIndex === i;
        const dimmed = selectedIndex != null && !isSelected;
        return (
          <Path
            key={i}
            d={arc.d}
            fill="none"
            stroke={arc.color}
            strokeWidth={isSelected ? strokeWidth + SELECTED_EXTRA : strokeWidth}
            strokeLinecap="butt"
            opacity={dimmed ? 0.25 : 1}
            onPress={() => onSelect(isSelected ? null : i)}
          />
        );
      })}
      {sel ? (
        <>
          <SvgText x={cx} y={cy - 6} textAnchor="middle" fill={sel.color} fontSize="18" fontWeight="bold">
            {arcs[selectedIndex].pct}%
          </SvgText>
          <SvgText x={cx} y={cy + 12} textAnchor="middle" fill="#94a3b8" fontSize="10">
            {sel.label}
          </SvgText>
        </>
      ) : (
        <SvgText x={cx} y={cy + 5} textAnchor="middle" fill="#94a3b8" fontSize="12">
          資產配置
        </SvgText>
      )}
    </Svg>
  );
}

export default function TrendsScreen() {
  const { colors, isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [categoryTotals, setCategoryTotals] = useState([]);
  const [userId, setUserId] = useState(null);
  const [selectedDonutIndex, setSelectedDonutIndex] = useState(null);
  const [drilldownCategory, setDrilldownCategory] = useState(null);
  const [detailedAssets, setDetailedAssets] = useState([]);

  const [selectedPeriod, setSelectedPeriod] = useState(PERIODS[2]); // default 90d
  const [customRange, setCustomRange] = useState(null); // { start, end } strings

  const [selectedFilter, setSelectedFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  // Refs so that stable callbacks (onRefresh, useFocusEffect) always see the
  // latest selectedFilter and the latest loadData without needing to be
  // recreated on every render.
  const selectedFilterRef = useRef(selectedFilter);
  selectedFilterRef.current = selectedFilter; // kept current every render

  const loadDataRef = useRef(null); // populated after loadData is defined below

  const chartOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(chartOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(chartOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [selectedFilter]);

  // Custom date modal
  const [customModalVisible, setCustomModalVisible] = useState(false);
  const [activeDateField, setActiveDateField] = useState('start'); // 'start' | 'end'
  const [pickerScrollTrigger, setPickerScrollTrigger] = useState(0);
  const [pickerStart, setPickerStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  });
  const [pickerEnd, setPickerEnd] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  });

  // useFocusEffect: use the ref so we always call the latest loadData.
  // The [] dep is intentional here — we only want to register the effect once;
  // loadDataRef.current always points to the freshest version.
  useFocusEffect(useCallback(() => { loadDataRef.current?.(); }, []));

  // onRefresh: stable callback ([] deps) that reads both refs at call time,
  // so it never resets selectedFilter when pulling to refresh.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDataRef.current?.(selectedFilterRef.current);
    setRefreshing(false);
  }, []);

  const loadSnapshots = useCallback(async (uid, days, range, filter = 'all') => {
    setSnapshotLoading(true);
    try {
      if (filter === 'all') {
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
      } else {
        let query = supabase
          .from('category_snapshots').select('date, value')
          .eq('user_id', uid)
          .eq('category', filter)
          .order('date', { ascending: true });

        if (range) {
          query = query.gte('date', range.start).lte('date', range.end);
        } else {
          const since = new Date();
          since.setDate(since.getDate() - days);
          query = query.gte('date', since.toISOString().split('T')[0]);
        }

        const { data } = await query;
        setSnapshots((data || []).map(r => ({ snapshot_date: r.date, net_worth_base: r.value })));
      }
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  const saveCategorySnapshots = async (assets, uid, date) => {
    const getCategoryKey = (a) => {
      if (a.market_type === 'TW') return 'TW';
      if (a.market_type === 'US') return 'US';
      if (a.market_type === 'Crypto') return 'Crypto';
      if (a.category === 'liquid') return 'liquid';
      return 'other';
    };
    const totals = {};
    assets.forEach(a => {
      const key = getCategoryKey(a);
      totals[key] = (totals[key] || 0) + (a.converted_amount || 0);
    });
    const rows = Object.entries(totals).map(([category, value]) => ({
      user_id: uid,
      date,
      category,
      value,
    }));
    if (rows.length > 0) {
      await supabase.from('category_snapshots').upsert(rows, {
        onConflict: 'user_id,date,category',
      });
    }
  };

  const loadData = async (filterOverride) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data: profileData } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();
      setProfile(profileData);

      // 先載入並換算資產，再 upsert 今日快照，最後才讀歷史快照畫折線圖
      const { data: assetsData } = await supabase
        .from('assets').select('id, name, category, current_amount, currency, market_type')
        .eq('user_id', user.id);

      if (assetsData) {
        const baseCurrency = profileData?.base_currency || 'TWD';
        const converted = await Promise.all(
          assetsData.filter(a => a.category !== 'liability').map(async (a) => {
            const converted_amount = await convertToBaseCurrency(parseFloat(a.current_amount), a.currency, baseCurrency);
            return { ...a, converted_amount };
          })
        );
        setDetailedAssets(converted);

        const today = new Date().toISOString().split('T')[0];

        // Upsert 今日 daily_snapshots（確保折線圖最右邊的點是即時值）
        const totalValue = converted.reduce((sum, a) => sum + Number(a.converted_amount || 0), 0);
        await supabase.from('daily_snapshots').upsert(
          { user_id: user.id, snapshot_date: today, net_worth_base: totalValue },
          { onConflict: 'user_id,snapshot_date' }
        );

        // Upsert 今日 category_snapshots
        await saveCategorySnapshots(converted, user.id, today);

        const catSums = {};
        converted.forEach(a => {
          catSums[a.category] = (catSums[a.category] || 0) + a.converted_amount;
        });
        setCategoryTotals(
          Object.entries(catSums)
            .filter(([, v]) => v > 0)
            .map(([cat, value]) => ({
              key: cat,
              label: CATEGORY_CONFIG[cat]?.label || cat,
              value,
              color: CATEGORY_CONFIG[cat]?.color || '#888',
            }))
        );
      }

      // 在 upsert 完成後才讀歷史快照，確保今天的點已存入
      // Use filterOverride (supplied by onRefresh) so pull-to-refresh never
      // silently resets the active filter chip back to 'all'.
      const filterToLoad = filterOverride !== undefined ? filterOverride : selectedFilter;
      await loadSnapshots(user.id, PERIODS[2].days, null, filterToLoad);
    } catch (e) {
      console.error('Error loading charts:', e);
    } finally {
      setLoading(false);
    }
  };

  // Keep the ref pointing at the freshest loadData every render.
  loadDataRef.current = loadData;

  const handlePeriodSelect = (period) => {
    if (period.days === null) {
      // Initialize picker from existing customRange or 30-day default
      if (customRange) {
        const [sy, sm, sd] = customRange.start.split('-').map(Number);
        const [ey, em, ed] = customRange.end.split('-').map(Number);
        setPickerStart({ year: sy, month: sm, day: sd });
        setPickerEnd({ year: ey, month: em, day: ed });
      } else {
        const today = new Date();
        const prior = new Date();
        prior.setDate(prior.getDate() - 30);
        setPickerStart({ year: prior.getFullYear(), month: prior.getMonth() + 1, day: prior.getDate() });
        setPickerEnd({ year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() });
      }
      setActiveDateField('start');
      setPickerScrollTrigger(t => t + 1);
      setCustomModalVisible(true);
      return;
    }
    setSelectedPeriod(period);
    setCustomRange(null);
    if (userId) loadSnapshots(userId, period.days, null, selectedFilter);
  };

  const applyCustomRange = () => {
    const startStr = `${pickerStart.year}-${pad2(pickerStart.month)}-${pad2(pickerStart.day)}`;
    const endStr = `${pickerEnd.year}-${pad2(pickerEnd.month)}-${pad2(pickerEnd.day)}`;
    if (startStr > endStr) {
      Alert.alert('日期錯誤', '開始日期不能晚於結束日期');
      return;
    }
    const range = { start: startStr, end: endStr };
    setCustomRange(range);
    setSelectedPeriod(PERIODS[4]); // 自定義
    setCustomModalVisible(false);
    if (userId) loadSnapshots(userId, null, range, selectedFilter);
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

  const mergeBySymbol = (assets) => {
    const map = {};
    assets.forEach(a => {
      const key = a.symbol || a.name;
      if (map[key]) {
        map[key] = {
          ...map[key],
          converted_amount: (map[key].converted_amount || 0) + (a.converted_amount || 0),
        };
      } else {
        map[key] = { ...a };
      }
    });
    return Object.values(map);
  };

  const getDrilldownData = (category) => {
    const catAssets = detailedAssets.filter(a => a.category === category);
    if (category === 'investment') {
      const groups = {};
      catAssets.forEach(a => {
        const mt = a.market_type || 'other';
        groups[mt] = (groups[mt] || 0) + a.converted_amount;
      });
      return Object.entries(groups)
        .filter(([, v]) => v > 0)
        .map(([mt, value]) => ({
          key: mt,
          label: MARKET_TYPE_CONFIG[mt]?.label || mt,
          value,
          color: MARKET_TYPE_CONFIG[mt]?.color || '#94a3b8',
        }));
    }
    return mergeBySymbol(catAssets)
      .filter(a => a.converted_amount > 0)
      .sort((a, b) => b.converted_amount - a.converted_amount)
      .slice(0, 6)
      .map((a, i) => ({
        key: a.symbol || a.name,
        label: a.name,
        value: a.converted_amount,
        color: DRILL_PALETTE[i % DRILL_PALETTE.length],
      }));
  };

  const getFilteredDonutData = () => {
    let filtered;
    switch (selectedFilter) {
      case 'TW':
      case 'US':
      case 'Crypto':
        filtered = detailedAssets.filter(a => a.market_type === selectedFilter);
        break;
      case 'liquid':
        filtered = detailedAssets.filter(a => a.category === 'liquid');
        break;
      case 'other':
        filtered = detailedAssets.filter(a =>
          a.category === 'fixed' || a.category === 'receivable' ||
          (a.category === 'investment' && a.market_type === 'other')
        );
        break;
      default:
        filtered = detailedAssets;
    }
    const mergedAssets = mergeBySymbol(filtered);
    return mergedAssets
      .filter(a => a.converted_amount > 0)
      .sort((a, b) => b.converted_amount - a.converted_amount)
      .slice(0, 6)
      .map((a, i) => ({
        key: a.symbol || a.name,
        label: a.name,
        value: a.converted_amount,
        color: DRILL_PALETTE[i % DRILL_PALETTE.length],
      }));
  };

  const currentDonutData = selectedFilter !== 'all'
    ? getFilteredDonutData()
    : drilldownCategory
      ? getDrilldownData(drilldownCategory)
      : categoryTotals;
  const donutTotal = currentDonutData.reduce((s, d) => s + d.value, 0);
  const { data: chartData, baseline: chartBaseline } = getChartData();

  const selectedFilterLabel = FILTER_OPTIONS.find(o => o.key === selectedFilter)?.label || '全部';

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#10b981" />}
      >

        {/* Category filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ paddingHorizontal: 16, marginTop: 16, marginBottom: 4 }}
          contentContainerStyle={{ gap: 8 }}
        >
          {FILTER_OPTIONS.map(opt => {
            const active = selectedFilter === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                onPress={() => {
                  const newFilter = opt.key;
                  setSelectedFilter(newFilter);
                  setDrilldownCategory(null);
                  setSelectedDonutIndex(null);
                  if (userId) loadSnapshots(userId, selectedPeriod.days, customRange, newFilter);
                }}
                style={{
                  paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
                  backgroundColor: active ? PRIMARY : (isDark ? '#16213e' : '#f1f5f9'),
                  borderWidth: 1,
                  borderColor: active ? PRIMARY : (isDark ? '#2a3a5e' : '#e2e8f0'),
                }}
                activeOpacity={0.75}
              >
                <Text style={{ color: active ? '#fff' : colors.textSub, fontSize: 13, fontWeight: active ? '700' : '500' }}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Trend chart card */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {selectedFilter === 'all' ? `總淨資產趨勢（${currency}）` : `${selectedFilterLabel} 趨勢`}
            </Text>
            {changeText && (
              <Text style={[styles.changeBadge, changeText.positive ? styles.pos : styles.neg]}>
                {changeText.positive ? '+' : ''}{changeText.pct}%
              </Text>
            )}
          </View>

          {/* ── Liquid Glass period selector ── */}
          <View style={[styles.glassContainer, { backgroundColor: colors.card }]}>
            <View style={styles.periodRow}>
              {PERIODS.map((p) => {
                const isActive = p.days === selectedPeriod.days && !(p.days === null && selectedPeriod.days !== null);
                const isCustomActive = p.days === null && selectedPeriod.days === null;
                const active = isActive || isCustomActive;
                return (
                  <TouchableOpacity
                    key={p.label}
                    style={[styles.periodBtn,
                      { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', borderColor: colors.borderLight },
                      active && styles.periodBtnActive]}
                    onPress={() => handlePeriodSelect(p)}
                    activeOpacity={0.75}
                  >
                    {p.days === null && <Calendar size={10} color={active ? 'white' : PRIMARY} style={{ marginRight: 3 }} />}
                    <Text style={[styles.periodLabel, { color: colors.textSub }, active && styles.periodLabelActive]}>
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
            <Animated.View style={{ opacity: chartOpacity }}>
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
            </Animated.View>
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
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {selectedFilter !== 'all'
                  ? `${selectedFilterLabel} 資產配置`
                  : drilldownCategory
                    ? CATEGORY_CONFIG[drilldownCategory]?.label
                    : '資產配置'}
              </Text>
              {selectedFilter === 'all' && drilldownCategory && (
                <TouchableOpacity
                  onPress={() => { setDrilldownCategory(null); setSelectedDonutIndex(null); }}
                  style={[styles.backBtn, { backgroundColor: colors.bg }]}
                >
                  <Text style={[styles.backBtnText, { color: colors.textSub }]}>← 返回</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.donutCenter}>
              <DonutChart
                data={currentDonutData}
                size={180}
                strokeWidth={28}
                selectedIndex={selectedDonutIndex}
                onSelect={(i) => {
                  if (selectedFilter === 'all' && !drilldownCategory && i != null) {
                    // drill into category
                    setDrilldownCategory(currentDonutData[i].key);
                    setSelectedDonutIndex(null);
                  } else {
                    setSelectedDonutIndex(i);
                  }
                }}
              />
            </View>
            <View style={styles.legend}>
              {currentDonutData.map((item, i) => {
                const pct = donutTotal > 0 ? (item.value / donutTotal) * 100 : 0;
                const isSelected = selectedDonutIndex === i;
                return (
                  <TouchableOpacity
                    key={item.key ?? i}
                    onPress={() => {
                      if (selectedFilter === 'all' && !drilldownCategory) {
                        setDrilldownCategory(item.key);
                        setSelectedDonutIndex(null);
                      } else {
                        setSelectedDonutIndex(isSelected ? null : i);
                      }
                    }}
                    activeOpacity={0.7}
                    style={[styles.legendItem, { backgroundColor: colors.bg }, isSelected && { backgroundColor: `${item.color}14` }]}
                  >
                    <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                    <View style={{ flex: 1 }}>
                      <View style={styles.legendTopRow}>
                        <Text style={[styles.legendLabel, { color: colors.textSub }]}>{item.label}</Text>
                        <Text style={[styles.legendPct, { color: item.color, fontWeight: '700' }]}>{pct.toFixed(1)}%</Text>
                      </View>
                      <View style={[styles.barBg, { backgroundColor: colors.borderLight }]}>
                        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: item.color }]} />
                      </View>
                      <Text style={[styles.legendValue, { color: colors.text }]}>{fmt(item.value)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
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
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
            <View style={styles.modalContent}>
              {/* Header */}
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>請選擇開始日期和結束日期</Text>
                <TouchableOpacity onPress={() => setCustomModalVisible(false)}>
                  <X size={20} color={colors.textSub} />
                </TouchableOpacity>
              </View>

              {/* Date pills – tap to switch active field */}
              <View style={styles.datePillsRow}>
                {[
                  { field: 'start', label: '開始日期', d: pickerStart },
                  { field: 'end',   label: '結束日期', d: pickerEnd  },
                ].map(({ field, label, d }) => {
                  const active = activeDateField === field;
                  return (
                    <TouchableOpacity
                      key={field}
                      style={[
                        styles.datePill,
                        { borderColor: active ? '#10b981' : colors.borderLight, backgroundColor: colors.bg },
                        active && { borderWidth: 2 },
                      ]}
                      onPress={() => {
                        setActiveDateField(field);
                        setPickerScrollTrigger(t => t + 1);
                      }}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.datePillLabel, { color: colors.textSub }]}>{label}</Text>
                      <Text style={[styles.datePillValue, { color: active ? '#10b981' : colors.text }]}>
                        {d.year}-{pad2(d.month)}-{pad2(d.day)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Scroll-wheel picker */}
              <View style={styles.wheelContainer}>
                {/* Column header labels */}
                <View style={styles.wheelHeaders}>
                  {['年', '月', '日'].map(h => (
                    <Text key={h} style={[styles.wheelHeader, { color: colors.textSub }]}>{h}</Text>
                  ))}
                </View>

                {/* Selection highlight bar */}
                <View pointerEvents="none" style={styles.wheelSelectionOverlay}>
                  <View style={[styles.wheelSelectionBar, { borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)' }]} />
                </View>

                {/* The three columns */}
                <View style={styles.wheelColumnsRow}>
                  {/* Year */}
                  <WheelColumn
                    data={YEARS}
                    selectedValue={activeDateField === 'start' ? pickerStart.year : pickerEnd.year}
                    onValueChange={(val) => {
                      if (activeDateField === 'start') {
                        setPickerStart(p => {
                          const maxDay = getDaysInMonth(val, p.month);
                          return { ...p, year: val, day: Math.min(p.day, maxDay) };
                        });
                      } else {
                        setPickerEnd(p => {
                          const maxDay = getDaysInMonth(val, p.month);
                          return { ...p, year: val, day: Math.min(p.day, maxDay) };
                        });
                      }
                    }}
                    colors={colors}
                    scrollTrigger={pickerScrollTrigger}
                  />
                  {/* Month */}
                  <WheelColumn
                    data={MONTHS}
                    selectedValue={activeDateField === 'start' ? pickerStart.month : pickerEnd.month}
                    onValueChange={(val) => {
                      if (activeDateField === 'start') {
                        setPickerStart(p => {
                          const maxDay = getDaysInMonth(p.year, val);
                          return { ...p, month: val, day: Math.min(p.day, maxDay) };
                        });
                      } else {
                        setPickerEnd(p => {
                          const maxDay = getDaysInMonth(p.year, val);
                          return { ...p, month: val, day: Math.min(p.day, maxDay) };
                        });
                      }
                    }}
                    formatLabel={pad2}
                    colors={colors}
                    scrollTrigger={pickerScrollTrigger}
                  />
                  {/* Day */}
                  <WheelColumn
                    data={Array.from(
                      { length: getDaysInMonth(
                        activeDateField === 'start' ? pickerStart.year  : pickerEnd.year,
                        activeDateField === 'start' ? pickerStart.month : pickerEnd.month,
                      ) },
                      (_, i) => i + 1,
                    )}
                    selectedValue={activeDateField === 'start' ? pickerStart.day : pickerEnd.day}
                    onValueChange={(val) => {
                      if (activeDateField === 'start') {
                        setPickerStart(p => ({ ...p, day: val }));
                      } else {
                        setPickerEnd(p => ({ ...p, day: val }));
                      }
                    }}
                    formatLabel={pad2}
                    colors={colors}
                    scrollTrigger={pickerScrollTrigger}
                  />
                </View>
              </View>

              {/* Bottom buttons */}
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.resetBtn, { backgroundColor: colors.bg, borderColor: colors.borderLight }]}
                  onPress={() => {
                    const today = new Date();
                    const prior = new Date();
                    prior.setDate(prior.getDate() - 30);
                    setPickerStart({ year: prior.getFullYear(), month: prior.getMonth() + 1, day: prior.getDate() });
                    setPickerEnd({ year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() });
                    setPickerScrollTrigger(t => t + 1);
                  }}
                >
                  <Text style={{ color: colors.textSub, fontSize: 15, fontWeight: '600' }}>重置</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.applyBtn} onPress={applyCustomRange}>
                  <Text style={styles.applyBtnText}>確定</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
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
  neg: { color: '#E07070', backgroundColor: '#fee2e2' },

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
  negText: { color: '#E07070' },

  backBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  backBtnText: { fontSize: 13, fontWeight: '500' },
  donutCenter: { alignItems: 'center', marginTop: 4, marginBottom: 16 },
  legend: { gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 10 },
  legendDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  legendTopRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  legendLabel: { fontSize: 13 },
  legendPct: { fontSize: 13 },
  legendValue: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  barBg: { height: 4, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2 },

  // ── Custom date modal ──
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  modalContent: {
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', flex: 1, marginRight: 12 },

  // Date pills
  datePillsRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  datePill: {
    flex: 1, borderRadius: 14, borderWidth: 1,
    paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center',
  },
  datePillLabel: { fontSize: 11, fontWeight: '500', marginBottom: 4 },
  datePillValue: { fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },

  // Wheel picker
  wheelContainer: { position: 'relative', marginBottom: 20 },
  wheelHeaders: { flexDirection: 'row', marginBottom: 6 },
  wheelHeader: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600' },
  wheelColumnsRow: { flexDirection: 'row' },
  wheelSelectionOverlay: {
    position: 'absolute',
    top: 6 + 18, // header height ~24px
    left: 0, right: 0,
    height: PICKER_HEIGHT,
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  wheelSelectionBar: {
    height: ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },

  // Bottom buttons
  modalButtons: { flexDirection: 'row', gap: 12 },
  resetBtn: {
    flex: 1, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', borderWidth: 1,
  },
  applyBtn: {
    flex: 1,
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  applyBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});
