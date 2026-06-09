import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Dimensions, ActivityIndicator,
  TouchableOpacity, Modal, Platform, Alert, RefreshControl, Animated,
  PanResponder,
} from 'react-native';
import Svg, {
  Path, Circle, Text as SvgText,
  Defs, LinearGradient, Stop, Line as SvgLine,
} from 'react-native-svg';
import { X, Calendar, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { convertToBaseCurrency, fetchUSStockPriceBatch, fetchCryptoPriceBatch, fetchTWStockPriceBatch } from '../services/api';
import { useTheme } from '../lib/ThemeContext';

const { width: screenWidth } = Dimensions.get('window');
const PRIMARY = '#F7A600';

const PERIODS = [
  { label: '7d',   days: 7 },
  { label: '30d',  days: 30 },
  { label: '90d',  days: 90 },
  { label: '180d', days: 180 },
  { label: '自定義', days: null },
];

const CATEGORY_CONFIG = {
  liquid:     { label: '流動資產', color: '#0DBD8B' },
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
  { label: '全部',    key: 'all' },
  { label: '台股',    key: 'TW' },
  { label: '美股',    key: 'US' },
  { label: '虛幣',    key: 'Crypto' },
  { label: '外幣',    key: 'liquid' },
  { label: '固定資產', key: 'fixed' },
  { label: '應收款項', key: 'receivable' },
  { label: '其他',    key: 'other' },
];

const formatAmount = (amount) => {
  return Math.round(amount).toLocaleString('zh-TW');
};

const fmtCompact = (v) => {
  const abs = Math.abs(v);
  if (abs >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (abs >= 10000)   return `${(v / 10000).toFixed(1)}萬`;
  if (abs >= 1000)    return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
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
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear - 2020 + 2 }, (_, i) => 2020 + i);
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

// ── Straight Polyline Path ──
function buildSmoothPath(pts) {
  if (pts.length === 0) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
}

// ── Amber Gradient Area Chart with Crosshair Tooltip ──
function TrendLineChart({ snapshots, currency }) {
  const { isDark } = useTheme();
  const CHART_W = screenWidth - 64;
  const CHART_H = 200;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 26;
  const PAD_H = 6;
  const plotW = CHART_W - PAD_H * 2;
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;

  const [touchIdx, setTouchIdx] = useState(null);
  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const x = e.nativeEvent.locationX;
        const n = snapshotsRef.current.length;
        if (n < 2) return;
        const idx = Math.round(Math.max(0, Math.min(1, (x - PAD_H) / plotW)) * (n - 1));
        setTouchIdx(idx);
      },
      onPanResponderMove: (e) => {
        const x = e.nativeEvent.locationX;
        const n = snapshotsRef.current.length;
        if (n < 2) return;
        const idx = Math.round(Math.max(0, Math.min(1, (x - PAD_H) / plotW)) * (n - 1));
        setTouchIdx(idx);
      },
      onPanResponderRelease: () => setTouchIdx(null),
      onPanResponderTerminate: () => setTouchIdx(null),
    })
  ).current;

  if (snapshots.length < 2) return null;

  const values = snapshots.map(s => parseFloat(s.net_worth_base));
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const maxIdx = values.indexOf(maxVal);
  const minIdx = values.indexOf(minVal);
  const vRange = maxVal - minVal || Math.abs(minVal) * 0.1 || 1;
  const vPad = vRange * 0.15;
  const yMin = minVal - vPad;
  const yMax = maxVal + vPad;

  const toX = (i) => PAD_H + (i / (snapshots.length - 1)) * plotW;
  const toY = (val) => PAD_TOP + plotH * (1 - (val - yMin) / (yMax - yMin));

  const pts = snapshots.map((s, i) => ({
    x: toX(i),
    y: toY(parseFloat(s.net_worth_base)),
    date: s.snapshot_date,
    value: parseFloat(s.net_worth_base),
  }));

  const linePath = buildSmoothPath(pts);
  const bottomY = PAD_TOP + plotH;
  const areaPath = `${linePath} L ${pts[pts.length - 1].x} ${bottomY} L ${pts[0].x} ${bottomY} Z`;

  // 5 evenly spaced X labels
  const nLabels = Math.min(5, snapshots.length);
  const xLabels = Array.from({ length: nLabels }, (_, k) => {
    const idx = Math.round(k / (nLabels - 1) * (snapshots.length - 1));
    const d = new Date(snapshots[idx].snapshot_date);
    return {
      x: toX(idx),
      label: `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`,
    };
  });

  const touchPt = touchIdx != null ? pts[touchIdx] : null;
  const tooltipLeft = touchPt
    ? Math.min(Math.max(touchPt.x - 55, 4), CHART_W - 116)
    : 0;

  // ── Theme-dependent colours ──
  const chartBg        = isDark ? '#0f1117' : 'transparent';
  const labelColor     = isDark ? '#9ca3af' : '#6b7280';
  const xLabelColor    = isDark ? '#4b5563' : '#6b7280';
  const crosshairDotBg = isDark ? '#0f1117' : '#ffffff';
  const crosshairLine  = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.18)';
  const tooltipBg      = isDark ? 'rgba(10,10,20,0.93)' : 'rgba(255,255,255,0.96)';
  const tooltipBorder  = isDark ? 'rgba(245,158,11,0.35)' : 'rgba(245,158,11,0.4)';
  const tooltipDateColor = '#6b7280';

  const gradId = `trendAreaGrad_main`;

  return (
    <View
      style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: isDark ? '#0f1117' : 'transparent', marginTop: 8 }}
      {...panResponder.panHandlers}
    >
      <Svg width={CHART_W} height={CHART_H} style={{ overflow: 'hidden', backgroundColor: 'transparent' }}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2={CHART_H} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#f59e0b" stopOpacity={isDark ? 0.5 : 0.4} />
            <Stop offset="1" stopColor={isDark ? '#0f1117' : '#fff7ed'} stopOpacity={1} />
          </LinearGradient>
        </Defs>

        {/* Gradient area fill */}
        <Path d={areaPath} fill={`url(#${gradId})`} stroke="none" />

        {/* Line */}
        <Path
          d={linePath}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* X-axis date labels */}
        {xLabels.map((lbl, i) => (
          <SvgText
            key={i}
            x={lbl.x}
            y={CHART_H - 5}
            textAnchor="middle"
            fill={xLabelColor}
            fontSize="10"
          >
            {lbl.label}
          </SvgText>
        ))}

        {/* Max / Min value labels */}
        {(() => {
          const maxLabelX = Math.max(4, Math.min(toX(maxIdx), CHART_W - 100));
          const maxLabelY = Math.max(PAD_TOP + 12, toY(maxVal) - 6);
          const minLabelX = Math.max(4, Math.min(toX(minIdx), CHART_W - 100));
          const minLabelY = Math.min(PAD_TOP + plotH - 4, toY(minVal) + 14);
          const fmtLabel = (v) => `${Math.round(v).toLocaleString('zh-TW')} ${currency}`;
          return (
            <>
              <SvgText x={maxLabelX} y={maxLabelY} fill={labelColor} fontSize="11" fontWeight="500">
                {fmtLabel(maxVal)}
              </SvgText>
              <SvgText x={minLabelX} y={minLabelY} fill={labelColor} fontSize="11" fontWeight="500">
                {fmtLabel(minVal)}
              </SvgText>
            </>
          );
        })()}

        {/* Crosshair + dot */}
        {touchPt && (
          <>
            <SvgLine
              x1={touchPt.x} y1={PAD_TOP}
              x2={touchPt.x} y2={bottomY}
              stroke={crosshairLine}
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <Circle cx={touchPt.x} cy={touchPt.y} r={7} fill={crosshairDotBg} stroke="#f59e0b" strokeWidth="2.5" />
            <Circle cx={touchPt.x} cy={touchPt.y} r={3} fill="#f59e0b" />
          </>
        )}
      </Svg>

      {/* Tooltip */}
      {touchPt && (
        <View
          style={{
            position: 'absolute',
            top: Math.max(2, touchPt.y - 48),
            left: tooltipLeft,
            backgroundColor: tooltipBg,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderWidth: 1,
            borderColor: tooltipBorder,
            minWidth: 112,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: isDark ? 0 : 0.08,
            shadowRadius: 6,
          }}
          pointerEvents="none"
        >
          <Text style={{ color: tooltipDateColor, fontSize: 10, marginBottom: 2 }}>{touchPt.date}</Text>
          <Text style={{ color: '#f59e0b', fontSize: 13, fontWeight: '700' }}>
            {Math.round(touchPt.value).toLocaleString('zh-TW')}
          </Text>
        </View>
      )}
    </View>
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
  const [monthlyBreakdown, setMonthlyBreakdown] = useState([]); // [{ label, change, pct }]
  const [assetRanking, setAssetRanking] = useState({ gainers: [], losers: [] });
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [dailyPnlMap, setDailyPnlMap] = useState({}); // { 'YYYY-MM-DD': { diff, prevValue } }
  const [calendarLoading, setCalendarLoading] = useState(false);

  const [selectedFilter, setSelectedFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  // Refs so that stable callbacks (onRefresh, useFocusEffect) always see the
  // latest selectedFilter and the latest loadData without needing to be
  // recreated on every render.
  const selectedFilterRef = useRef(selectedFilter);
  selectedFilterRef.current = selectedFilter; // kept current every render

  const loadDataRef = useRef(null); // populated after loadData is defined below
  const userIdRef = useRef(null);             // always reflects the latest userId
  const calendarMonthRef = useRef(calendarMonth); // always reflects latest calendarMonth
  calendarMonthRef.current = calendarMonth;   // kept current every render

  // Day-detail modal state
  const [dayDetailVisible, setDayDetailVisible] = useState(false);
  const [dayDetailDate, setDayDetailDate] = useState(null);
  const [dayDetailData, setDayDetailData] = useState([]);
  const [dayDetailLoading, setDayDetailLoading] = useState(false);
  const [dayDetailNetWorth, setDayDetailNetWorth] = useState(null);

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
    // Also refresh the calendar for the currently displayed month
    if (userIdRef.current) {
      const { year, month } = calendarMonthRef.current;
      await loadCalendarData(userIdRef.current, year, month);
    }
    setRefreshing(false);
  }, [loadCalendarData]);

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
      if (a.category === 'fixed') return 'fixed';
      if (a.category === 'receivable') return 'receivable';
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
      userIdRef.current = user.id;

      const { data: profileData } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();
      setProfile(profileData);

      const { data: assetsData } = await supabase
        .from('assets')
        .select('id, name, symbol, category, current_amount, currency, market_type, average_cost, current_shares, leverage')
        .eq('user_id', user.id);

      if (assetsData) {
        const baseCurrency = profileData?.base_currency || 'TWD';

        // ── Fetch live prices for investment assets ONCE — reused for both
        //    the snapshot total (item 1) and the ranking (item 2 / no double-fetch)
        const invAssets = assetsData.filter(
          a => a.category === 'investment' && a.current_shares > 0 && a.symbol
        );
        const twSymbols = invAssets.filter(a => a.market_type === 'TW').map(a => a.symbol);
        const usSymbols = invAssets.filter(a => a.market_type === 'US').map(a => a.symbol);
        const crSymbols = invAssets.filter(a => a.market_type === 'Crypto').map(a => a.symbol);

        const [twPrices, usPrices, crPrices] = await Promise.all([
          fetchTWStockPriceBatch(twSymbols),
          fetchUSStockPriceBatch(usSymbols),
          fetchCryptoPriceBatch(crSymbols),
        ]);
        const priceMap = { ...twPrices, ...usPrices, ...crPrices };

        // ── Convert all assets: investment uses live price if available,
        //    others fall back to DB current_amount
        const converted = await Promise.all(
          assetsData.filter(a => a.category !== 'liability').map(async (a) => {
            let amount = parseFloat(a.current_amount);
            if (a.category === 'investment' && a.current_shares > 0 && a.symbol) {
              const pd = priceMap[a.symbol];
              if (pd?.price) {
                const lev      = a.leverage || 1;
                const borrowed = a.current_shares * (a.average_cost || 0) * (lev - 1) / lev;
                amount = pd.price * a.current_shares - borrowed;
              }
            }
            const converted_amount = await convertToBaseCurrency(amount, a.currency, baseCurrency);
            return { ...a, converted_amount };
          })
        );
        setDetailedAssets(converted);

        const today      = new Date().toISOString().split('T')[0];
        const totalValue = converted.reduce((sum, a) => sum + Number(a.converted_amount || 0), 0);

        // Upsert today's snapshot with live-price-accurate total
        await supabase.from('daily_snapshots').upsert(
          { user_id: user.id, snapshot_date: today, net_worth_base: totalValue },
          { onConflict: 'user_id,snapshot_date' }
        );
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

        // ── Asset Ranking — reuses the same priceMap, no extra API calls
        const rankAssets = invAssets.filter(a => a.average_cost > 0);
        const ranked = (await Promise.all(
          rankAssets.map(async (a) => {
            const pd = priceMap[a.symbol];
            if (!pd?.price) return null;
            const lev       = a.leverage || 1;
            const borrowed  = a.current_shares * (a.average_cost || 0) * (lev - 1) / lev;
            const liveAmt   = pd.price * a.current_shares - borrowed;
            const costAmt   = a.current_shares * a.average_cost / lev;
            const currentVal = await convertToBaseCurrency(liveAmt, a.currency, baseCurrency);
            const costBasis  = await convertToBaseCurrency(costAmt, a.currency, baseCurrency);
            const pnl_pct    = costBasis > 0 ? ((currentVal - costBasis) / costBasis) * 100 : 0;
            return isFinite(pnl_pct) ? { name: a.name, symbol: a.symbol, pnl_pct } : null;
          })
        )).filter(Boolean);

        ranked.sort((a, b) => b.pnl_pct - a.pnl_pct);
        setAssetRanking({
          gainers: ranked.slice(0, 3).filter(a => a.pnl_pct > 0),
          losers:  ranked.slice(-3).reverse().filter(a => a.pnl_pct < 0),
        });
      }

      // ── Monthly Breakdown — last 24 months
      try {
        const since = new Date();
        since.setMonth(since.getMonth() - 23);
        since.setDate(1);
        const { data: monthSnaps } = await supabase
          .from('daily_snapshots').select('snapshot_date, net_worth_base')
          .eq('user_id', user.id)
          .gte('snapshot_date', since.toISOString().split('T')[0])
          .order('snapshot_date', { ascending: true });

        if (monthSnaps && monthSnaps.length > 1) {
          const byMonth = {};
          for (const s of monthSnaps) {
            const ym = s.snapshot_date.slice(0, 7);
            if (!byMonth[ym]) byMonth[ym] = { first: parseFloat(s.net_worth_base), last: parseFloat(s.net_worth_base) };
            else byMonth[ym].last = parseFloat(s.net_worth_base);
          }
          const months = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b));
          const breakdown = [];
          for (let i = 1; i < months.length; i++) {
            const [ym, { last }] = months[i];
            const prevLast = months[i - 1][1].last;
            const change   = last - prevLast;
            const pct      = prevLast > 0 ? (change / prevLast) * 100 : 0;
            const [y, m]   = ym.split('-');
            breakdown.push({ label: `${y}/${parseInt(m)}月`, change, pct });
          }
          setMonthlyBreakdown(breakdown); // show all available months (up to 24)
        }
      } catch {}

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

  // ── Calendar data loader ──────────────────────────────────────────────────
  const loadCalendarData = useCallback(async (uid, year, month) => {
    setCalendarLoading(true);
    try {
      // Fetch the day before the month starts so we can compute day-1 diff
      const prevDay = new Date(year, month - 1, 0); // last day of previous month
      const lastDay = new Date(year, month, 0);     // last day of this month
      const startStr = prevDay.toISOString().split('T')[0];
      const endStr   = lastDay.toISOString().split('T')[0];

      const { data } = await supabase
        .from('daily_snapshots')
        .select('snapshot_date, net_worth_base')
        .eq('user_id', uid)
        .gte('snapshot_date', startStr)
        .lte('snapshot_date', endStr)
        .order('snapshot_date', { ascending: true });

      if (!data || data.length < 2) { setDailyPnlMap({}); return; }

      const map = {};
      for (let i = 1; i < data.length; i++) {
        const prev     = parseFloat(data[i - 1].net_worth_base);
        const curr     = parseFloat(data[i].net_worth_base);
        const dateStr  = data[i].snapshot_date;
        const [y, m]   = dateStr.split('-').map(Number);
        if (y === year && m === month) {
          map[dateStr] = { diff: curr - prev, prevValue: prev };
        }
      }
      setDailyPnlMap(map);
    } catch (e) {
      console.warn('loadCalendarData error:', e);
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  // Reload calendar whenever the displayed month or the logged-in user changes
  useEffect(() => {
    if (userId) loadCalendarData(userId, calendarMonth.year, calendarMonth.month);
  }, [userId, calendarMonth, loadCalendarData]);

  // ── Day-detail: fetch category_snapshots for a tapped calendar day ────────
  const openDayDetail = useCallback(async (dateStr) => {
    setDayDetailDate(dateStr);
    setDayDetailVisible(true);
    setDayDetailLoading(true);
    setDayDetailData([]);
    setDayDetailNetWorth(null);
    try {
      const uid = userIdRef.current;
      const [catRes, snapRes] = await Promise.all([
        supabase.from('category_snapshots').select('category, value').eq('user_id', uid).eq('date', dateStr),
        supabase.from('daily_snapshots').select('net_worth_base').eq('user_id', uid).eq('snapshot_date', dateStr).maybeSingle(),
      ]);
      setDayDetailData(catRes.data || []);
      setDayDetailNetWorth(snapRes.data ? parseFloat(snapRes.data.net_worth_base) : null);
    } catch (e) {
      console.warn('openDayDetail error:', e);
    } finally {
      setDayDetailLoading(false);
    }
  }, []);

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

  // ── Calendar helpers ──────────────────────────────────────────────────────
  const prevMonth = () => setCalendarMonth(({ year, month }) => {
    const m = month - 1;
    return m < 1 ? { year: year - 1, month: 12 } : { year, month: m };
  });
  const nextMonth = () => {
    const today = new Date();
    setCalendarMonth(({ year, month }) => {
      const m = month + 1;
      const next = m > 12 ? { year: year + 1, month: 1 } : { year, month: m };
      // Don't navigate past current month
      if (next.year > today.getFullYear() || (next.year === today.getFullYear() && next.month > today.getMonth() + 1)) {
        return { year, month };
      }
      return next;
    });
  };

  // Build a 7-column grid (Sun=0 … Sat=6) for the current calendar month
  const calendarRows = (() => {
    const { year, month } = calendarMonth;
    const firstDow   = new Date(year, month - 1, 1).getDay(); // 0=Sun
    const daysInMon  = getDaysInMonth(year, month);
    const cells      = Array(firstDow).fill(null);
    for (let d = 1; d <= daysInMon; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  })();

  // Monthly summary: sum of all daily diffs in the displayed month
  const calendarMonthSummary = (() => {
    const { year, month } = calendarMonth;
    const prefix  = `${year}-${pad2(month)}-`;
    const entries = Object.entries(dailyPnlMap).filter(([k]) => k.startsWith(prefix));
    if (entries.length === 0) return null;
    const totalDiff  = entries.reduce((s, [, v]) => s + v.diff, 0);
    const sorted     = [...entries].sort(([a], [b]) => a.localeCompare(b));
    const startValue = sorted[0][1].prevValue;
    const pct        = startValue > 0 ? (totalDiff / startValue) * 100 : 0;
    return { diff: totalDiff, pct };
  })();

  if (loading) {
    return <View style={[styles.loading, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={PRIMARY} /></View>;
  }

  const hasData = snapshots.length > 0;


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
      case 'fixed':
        filtered = detailedAssets.filter(a => a.category === 'fixed');
        break;
      case 'receivable':
        filtered = detailedAssets.filter(a => a.category === 'receivable');
        break;
      case 'other':
        filtered = detailedAssets.filter(a =>
          a.category === 'investment' && !['TW', 'US', 'Crypto'].includes(a.market_type)
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
              <TrendLineChart snapshots={snapshots} currency={currency} />
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

        {/* ── ASSET RANKING ─────────────────────────────────────────────── */}
        {(assetRanking.gainers.length > 0 || assetRanking.losers.length > 0) && (
          <View style={[styles.card, { marginHorizontal: 16, marginTop: 16, backgroundColor: colors.card }]}>
            <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 12 }]}>持倉排行</Text>
            {assetRanking.gainers.length > 0 && (
              <>
                <Text style={{ fontSize: 12, color: colors.textSub, fontWeight: '600', marginBottom: 6 }}>▲ 漲幅前三</Text>
                {assetRanking.gainers.map((a, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={{ fontSize: 13, color: colors.textSub, width: 20 }}>{i + 1}</Text>
                    <Text style={{ fontSize: 13, color: colors.text, flex: 1 }} numberOfLines={1}>{a.name}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#0DBD8B' }}>
                      +{a.pnl_pct.toFixed(2)}%
                    </Text>
                  </View>
                ))}
              </>
            )}
            {assetRanking.gainers.length > 0 && assetRanking.losers.length > 0 && (
              <View style={{ height: 1, backgroundColor: colors.borderLight, marginVertical: 8 }} />
            )}
            {assetRanking.losers.length > 0 && (
              <>
                <Text style={{ fontSize: 12, color: colors.textSub, fontWeight: '600', marginBottom: 6 }}>▼ 跌幅前三</Text>
                {assetRanking.losers.map((a, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={{ fontSize: 13, color: colors.textSub, width: 20 }}>{i + 1}</Text>
                    <Text style={{ fontSize: 13, color: colors.text, flex: 1 }} numberOfLines={1}>{a.name}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#F03030' }}>
                      {a.pnl_pct.toFixed(2)}%
                    </Text>
                  </View>
                ))}
              </>
            )}
          </View>
        )}

        {/* ── MONTHLY BREAKDOWN ─────────────────────────────────────────── */}
        {monthlyBreakdown.length > 0 && (
          <View style={[styles.card, { marginHorizontal: 16, marginTop: 16, marginBottom: 8, backgroundColor: colors.card }]}>
            <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 12 }]}>月度績效</Text>
            {[...monthlyBreakdown].reverse().map((m, i) => {
              const isUp = m.change >= 0;
              const barPct = Math.min(Math.abs(m.pct) / 15, 1); // scale: 15% = full bar
              return (
                <View key={i} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
                    <Text style={{ fontSize: 13, color: colors.textSub, width: 60 }}>{m.label}</Text>
                    <View style={{ flex: 1, height: 6, backgroundColor: colors.borderLight, borderRadius: 3, overflow: 'hidden' }}>
                      <View style={{
                        width: `${barPct * 100}%`, height: '100%', borderRadius: 3,
                        backgroundColor: isUp ? '#0DBD8B' : '#F03030',
                      }} />
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: isUp ? '#0DBD8B' : '#F03030', minWidth: 70, textAlign: 'right' }}>
                      {isUp ? '+' : ''}{m.pct.toFixed(2)}%
                    </Text>
                  </View>
                  <Text style={{ fontSize: 11, color: colors.textMuted, paddingLeft: 60 }}>
                    {isUp ? '+' : ''}{fmt(m.change)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── DAILY P&L CALENDAR ──────────────────────────────────────────── */}
        <View style={[styles.card, { marginHorizontal: 16, marginTop: 16, marginBottom: 8, backgroundColor: colors.card }]}>
          {/* Card header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>每日損益日曆</Text>
            {calendarLoading && <ActivityIndicator size="small" color={PRIMARY} />}
          </View>

          {/* Month navigator */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
            <TouchableOpacity onPress={prevMonth} style={{ padding: 8 }} activeOpacity={0.7}>
              <ChevronLeft size={20} color={colors.textSub} />
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, minWidth: 130, textAlign: 'center' }}>
              {calendarMonth.year}年 {calendarMonth.month}月
            </Text>
            <TouchableOpacity onPress={nextMonth} style={{ padding: 8 }} activeOpacity={0.7}>
              <ChevronRight size={20} color={colors.textSub} />
            </TouchableOpacity>
          </View>

          {/* Monthly P&L summary */}
          {calendarMonthSummary ? (
            <View style={{ alignItems: 'center', marginBottom: 14 }}>
              <Text style={{
                fontSize: 14, fontWeight: '700',
                color: calendarMonthSummary.diff >= 0 ? '#0DBD8B' : '#F03030',
              }}>
                {calendarMonthSummary.diff >= 0 ? '+' : ''}{fmt(calendarMonthSummary.diff)} {currency}
                {'  '}
                ({calendarMonthSummary.diff >= 0 ? '+' : ''}{calendarMonthSummary.pct.toFixed(2)}%)
              </Text>
            </View>
          ) : !calendarLoading && (
            <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
              本月尚無快照資料
            </Text>
          )}

          {/* Day-of-week headers: Sun → Sat */}
          <View style={{ flexDirection: 'row', marginBottom: 6 }}>
            {['日', '一', '二', '三', '四', '五', '六'].map(d => (
              <Text key={d} style={{
                flex: 1, textAlign: 'center',
                fontSize: 11, fontWeight: '600',
                color: colors.textMuted,
              }}>
                {d}
              </Text>
            ))}
          </View>

          {/* Calendar grid */}
          {(() => {
            const todayStr = new Date().toISOString().split('T')[0];
            return calendarRows.map((week, wi) => (
            <View key={wi} style={{ flexDirection: 'row', marginBottom: 3 }}>
              {week.map((day, di) => {
                if (!day) return <View key={di} style={{ flex: 1 }} />;
                const dateStr = `${calendarMonth.year}-${pad2(calendarMonth.month)}-${pad2(day)}`;
                const pnl     = dailyPnlMap[dateStr];
                const hasPnl  = pnl != null;
                const isPos   = hasPnl && pnl.diff >= 0;
                const pct     = hasPnl && pnl.prevValue > 0
                  ? (pnl.diff / pnl.prevValue) * 100 : 0;
                const isToday = dateStr === todayStr;
                const Cell    = hasPnl ? TouchableOpacity : View;
                return (
                  <Cell
                    key={di}
                    onPress={hasPnl ? () => openDayDetail(dateStr) : undefined}
                    activeOpacity={0.7}
                    style={{
                      flex: 1,
                      marginHorizontal: 2,
                      borderRadius: 8,
                      paddingVertical: 5,
                      paddingHorizontal: 1,
                      backgroundColor: isPos
                        ? 'rgba(13,189,139,0.13)'
                        : hasPnl
                          ? 'rgba(240,48,48,0.10)'
                          : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'),
                      alignItems: 'center',
                      minHeight: 60,
                      borderWidth: isToday ? 1.5 : 0,
                      borderColor: isToday ? PRIMARY : 'transparent',
                    }}
                  >
                    <Text style={{
                      fontSize: 11,
                      color: isToday ? PRIMARY
                        : hasPnl ? (isDark ? '#cbd5e1' : '#475569') : colors.textMuted,
                      fontWeight: isToday ? '800' : '600',
                      marginBottom: 3,
                    }}>
                      {day}
                    </Text>
                    {hasPnl && (
                      <>
                        <Text style={{
                          fontSize: 10, fontWeight: '700',
                          color: isPos ? '#0DBD8B' : '#F03030',
                          textAlign: 'center',
                        }} numberOfLines={1}>
                          {isPos ? '+' : ''}{pct.toFixed(1)}%
                        </Text>
                        <Text style={{
                          fontSize: 9, fontWeight: '500',
                          color: isPos ? '#0DBD8B' : '#F03030',
                          textAlign: 'center', opacity: 0.8,
                        }} numberOfLines={1}>
                          {isPos ? '+' : ''}{fmtCompact(pnl.diff)}
                        </Text>
                      </>
                    )}
                  </Cell>
                );
              })}
            </View>
          ));
          })()}
        </View>

      </ScrollView>

      {/* ── Day-detail modal ─────────────────────────────────────────── */}
      <Modal
        visible={dayDetailVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDayDetailVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>{dayDetailDate}</Text>
                <TouchableOpacity onPress={() => setDayDetailVisible(false)}>
                  <X size={20} color={colors.textSub} />
                </TouchableOpacity>
              </View>

              {/* Net worth + daily change */}
              {dayDetailDate && dailyPnlMap[dayDetailDate] && (() => {
                const pnl  = dailyPnlMap[dayDetailDate];
                const isUp = pnl.diff >= 0;
                const pct  = pnl.prevValue > 0 ? (pnl.diff / pnl.prevValue) * 100 : 0;
                return (
                  <View style={{ marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.borderLight }}>
                    {dayDetailNetWorth != null && (
                      <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
                        {fmt(dayDetailNetWorth)} {currency}
                      </Text>
                    )}
                    <Text style={{ fontSize: 15, fontWeight: '700', color: isUp ? '#0DBD8B' : '#F03030' }}>
                      {isUp ? '+' : ''}{fmt(pnl.diff)}  ({isUp ? '+' : ''}{pct.toFixed(2)}%)
                    </Text>
                  </View>
                );
              })()}

              {/* Category breakdown */}
              {dayDetailLoading ? (
                <ActivityIndicator size="small" color={PRIMARY} style={{ marginTop: 16 }} />
              ) : dayDetailData.length > 0 ? (
                <>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSub, marginBottom: 10 }}>資產類別</Text>
                  {dayDetailData
                    .filter(d => d.value > 0)
                    .sort((a, b) => b.value - a.value)
                    .map((d, i) => {
                      const cfg   = { ...CATEGORY_CONFIG, ...MARKET_TYPE_CONFIG }[d.category];
                      const label = cfg?.label || d.category;
                      const color = cfg?.color || '#94a3b8';
                      return (
                        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginRight: 10 }} />
                          <Text style={{ flex: 1, fontSize: 14, color: colors.textSub }}>{label}</Text>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{fmt(d.value)}</Text>
                        </View>
                      );
                    })
                  }
                </>
              ) : (
                <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8 }}>
                  此日無類別快照資料
                </Text>
              )}
            </View>
          </View>
        </View>
      </Modal>

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
  pos: { color: '#0DBD8B', backgroundColor: 'rgba(13,189,139,0.12)' },
  neg: { color: '#F03030', backgroundColor: 'rgba(240,48,48,0.12)' },

  // ── Liquid Glass ──
  glassContainer: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(247,166,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(247,166,0,0.15)',
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
  posText: { color: '#00C851' },
  negText: { color: '#F03030' },

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
