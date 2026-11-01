import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Modal, Platform, Alert, RefreshControl, Animated,
} from 'react-native';
import { X, Calendar } from 'lucide-react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { getTaipeiDateString, getTaipeiMonthStart } from '../lib/date';
import { fetchExchangeRatesBatch } from '../services/api';
import {
  calculatePortfolioTotals,
  fetchLiveAssetPrices,
  groupSnapshotTotals,
  valueAssets,
} from '../services/portfolio';
import { useTheme } from '../lib/ThemeContext';
import InvestmentPerformanceCard, { ExclusionModal } from '../components/InvestmentPerformanceCard';
import {
  buildHistoricalPriceRequests,
  calculateHistoricalNavSeries,
  calculateTradePerformance,
  loadInvestmentPerformance,
  setAssetPerformanceExclusion,
} from '../services/investmentPerformance';
import { fetchMarketTechnicalContext } from '../services/technicalAnalysis';
import { DonutChart, TrendLineChart } from '../features/trends/components/TrendsCharts';
import DayDetailModal from '../features/trends/components/DayDetailModal';
import PerformanceCalendar from '../features/trends/components/PerformanceCalendar';
import useEarningsCalendar from '../features/trends/hooks/useEarningsCalendar';
import { allSettledWithConcurrency } from '../features/trends/concurrency';
import {
  PNL_METRICS,
  buildTradePnlViews,
  formatAmount,
} from '../features/trends/tradePnl';

const PERIODS = [
  { label: '全部',  days: 'ALL' },
  { label: '7d',   days: 7 },
  { label: '30d',  days: 30 },
  { label: '90d',  days: 90 },
  { label: '180d', days: 180 },
  { label: '自定義', days: null },
];

const CATEGORY_CONFIG = {
  liquid: { label: '流動資產' }, investment: { label: '投資資產' },
  fixed: { label: '固定資產' }, receivable: { label: '應收款項' },
};

const MARKET_TYPE_CONFIG = {
  TW: { label: '台股' }, US: { label: '美股' },
  Crypto: { label: '虛幣' }, other: { label: '其他' },
};

const DRILL_PALETTE = ['#6366f1', '#ec4899', '#14b8a6', '#8092AE', '#8b5cf6', '#06b6d4'];
const DRILL_LIMIT = 20; // how many items to show in drilldown / donut legend
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
const ALLOCATION_DRILLDOWN_STORAGE_KEY = 'trends:asset-allocation-drilldown';

// Monthly performance and the daily P&L calendar use the same snapshot
// categories as the market filter.  `all` is backed by daily_snapshots;
// every other filter is backed by the matching category_snapshots row.
const snapshotCategoriesForFilter = (filter) => {
  if (!filter || filter === 'all') return null;
  return [filter];
};

const aggregateCategorySnapshotRows = (rows = []) => {
  const totals = {};
  for (const row of rows) {
    const date = row?.date || row?.snapshot_date;
    const value = Number(row?.value ?? row?.net_worth_base);
    if (!date || !Number.isFinite(value)) continue;
    totals[date] = (totals[date] || 0) + value;
  }
  return Object.entries(totals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ snapshot_date: date, net_worth_base: value }));
};

const performanceMarketForFilter = filter => ({
  all: 'ALL',
  TW: 'TW',
  US: 'US',
  Crypto: 'CRYPTO',
}[filter] || null);

const buildHoldingRanking = (assets = [], marketFilter = 'all') => {
  const includedInMarket = asset => {
    if (marketFilter === 'all') return true;
    if (marketFilter === 'other') {
      return !['TW', 'US', 'Crypto'].includes(asset.market_type);
    }
    return asset.market_type === marketFilter;
  };
  const merged = new Map();
  assets.forEach(asset => {
    const symbol = String(asset?.symbol || '').trim().toUpperCase();
    if (
      asset?.category !== 'investment' ||
      !symbol ||
      Number(asset.current_shares) <= 0 ||
      asset.exclude_from_performance ||
      !includedInMarket(asset)
    ) return;

    const currentValue = Number(asset.converted_amount);
    const cost = Number(asset.converted_cost);
    if (!Number.isFinite(currentValue) || !Number.isFinite(cost) || cost <= 0) return;

    const key = `${asset.market_type || 'other'}:${symbol}`;
    const existing = merged.get(key);
    if (existing) {
      existing.currentValue += currentValue;
      existing.cost += cost;
    } else {
      merged.set(key, {
        key,
        name: asset.name || symbol,
        symbol,
        currentValue,
        cost,
      });
    }
  });

  const ranked = [...merged.values()]
    .map(item => ({
      ...item,
      pnl_pct: ((item.currentValue - item.cost) / item.cost) * 100,
    }))
    .filter(item => Number.isFinite(item.pnl_pct));

  return {
    gainers: ranked
      .filter(item => item.pnl_pct > 0)
      .sort((a, b) => b.pnl_pct - a.pnl_pct)
      .slice(0, 3),
    losers: ranked
      .filter(item => item.pnl_pct < 0)
      .sort((a, b) => a.pnl_pct - b.pnl_pct)
      .slice(0, 3),
  };
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

export default function TrendsScreen() {
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();
  const PRIMARY = colors.accent;
  const chartPalette = colors.chartPalette || DRILL_PALETTE;
  const categoryColor = (category) => ({
    investment: chartPalette[0], liquid: chartPalette[1],
    fixed: chartPalette[4], receivable: chartPalette[2],
  })[category] || chartPalette[5];
  const marketColor = (marketType) => ({
    TW: chartPalette[0], US: chartPalette[1],
    Crypto: chartPalette[2], other: chartPalette[4],
  })[marketType] || chartPalette[5];
  const [loading, setLoading] = useState(true);
  const [chartLoadError, setChartLoadError] = useState('');
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [userId, setUserId] = useState(null);
  const [selectedDonutIndex, setSelectedDonutIndex] = useState(null);
  const [drilldownCategory, setDrilldownCategory] = useState(null);
  const [drilldownMarketType, setDrilldownMarketType] = useState(null);
  const [allocationDrilldownReady, setAllocationDrilldownReady] = useState(false);
  const [detailedAssets, setDetailedAssets] = useState([]);

  const [selectedPeriod, setSelectedPeriod] = useState(PERIODS[0]); // default all history
  const [customRange, setCustomRange] = useState(null); // { start, end } strings
  const [monthlyBreakdown, setMonthlyBreakdown] = useState([]); // [{ label, change, pct }]
  const performanceMode = 'trade'; // FIFO P&L remains available in the calendar.
  const [performanceDataLoading, setPerformanceDataLoading] = useState(false);
  const [performanceDataError, setPerformanceDataError] = useState('');
  const [tradePnlSummary, setTradePnlSummary] = useState(null);
  const [tradePnlSeries, setTradePnlSeries] = useState([]);
  const [tradePnlDetailSource, setTradePnlDetailSource] = useState(null);
  const [performanceScopeAssets, setPerformanceScopeAssets] = useState([]);
  const [scopeModalVisible, setScopeModalVisible] = useState(false);
  const [scopeSavingAssetId, setScopeSavingAssetId] = useState(null);
  const [selectedPnlMetric, setSelectedPnlMetric] = useState('total');
  const [calendarEarningsOnly, setCalendarEarningsOnly] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [dailyPnlMap, setDailyPnlMap] = useState({}); // { 'YYYY-MM-DD': { diff, prevValue } }
  const [calendarLoading, setCalendarLoading] = useState(false);
  const { earningsEvents, marketCalendarEvents, marketCalendarError, earningsCalendarLoading, earningsCalendarError, loadEarningsCalendar } = useEarningsCalendar(calendarMonth);

  const [selectedFilter, setSelectedFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const allocationDrilldownInteractedRef = useRef(false);
  const categorySnapshotWritesRef = useRef(new Map());

  useFocusEffect(useCallback(() => {
    let active = true;
    allocationDrilldownInteractedRef.current = false;
    setAllocationDrilldownReady(false);
    AsyncStorage.getItem(ALLOCATION_DRILLDOWN_STORAGE_KEY)
      .then(raw => {
        if (!active || allocationDrilldownInteractedRef.current) return;
        const saved = raw ? JSON.parse(raw) : null;
        const category = saved && Object.prototype.hasOwnProperty.call(CATEGORY_CONFIG, saved.category)
          ? saved.category
          : null;
        const marketType = category === 'investment' && saved
          && Object.prototype.hasOwnProperty.call(MARKET_TYPE_CONFIG, saved.marketType)
          ? saved.marketType
          : null;
        setDrilldownCategory(category);
        setDrilldownMarketType(marketType);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setAllocationDrilldownReady(true);
      });
    return () => { active = false; };
  }, []));

  // Refs so that stable callbacks (onRefresh, useFocusEffect) always see the
  // latest selectedFilter and the latest loadData without needing to be
  // recreated on every render.
  const selectedFilterRef = useRef(selectedFilter);
  selectedFilterRef.current = selectedFilter; // kept current every render
  const performanceModeRef = useRef(performanceMode);
  performanceModeRef.current = performanceMode;
  const tradePerformanceRequestRef = useRef(0);

  const loadDataRef = useRef(null); // populated after loadData is defined below
  const loadCalendarDataRef = useRef(null); // avoids referencing callback before initialization
  const userIdRef = useRef(null);             // always reflects the latest userId
  const calendarMonthRef = useRef(calendarMonth); // always reflects latest calendarMonth
  calendarMonthRef.current = calendarMonth;   // kept current every render
  // Day-detail modal state
  const [dayDetailVisible, setDayDetailVisible] = useState(false);
  const [dayDetailDate, setDayDetailDate] = useState(null);
  const [dayDetailMode, setDayDetailMode] = useState('pnl');
  const [dayDetailEarnings, setDayDetailEarnings] = useState([]);
  const [dayDetailData, setDayDetailData] = useState([]);
  const [dayDetailLoading, setDayDetailLoading] = useState(false);
  const [dayDetailNetWorth, setDayDetailNetWorth] = useState(null);

  const openEarningsAnalysis = event => {
    setDayDetailVisible(false);
    navigation.navigate('TechnicalAnalysis', {
      symbol: event.symbol,
      name: event.name || event.symbol,
      marketType: event.marketType || 'US',
      analysisKey: 'financialReports',
      earningsCalendarEvent: event,
    });
  };

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
    if (userIdRef.current && performanceModeRef.current === 'market') {
      const { year, month } = calendarMonthRef.current;
      await loadCalendarDataRef.current?.(userIdRef.current, year, month);
    }
    setRefreshing(false);
  }, []);

  const loadSnapshots = useCallback(async (uid, days, range, filter = 'all') => {
    setSnapshotLoading(true);
    try {
      const categories = snapshotCategoriesForFilter(filter);
      if (!categories) {
        let query = supabase
          .from('daily_snapshots').select('*')
          .eq('user_id', uid)
          .order('snapshot_date', { ascending: true });

        if (range) {
          query = query.gte('snapshot_date', range.start).lte('snapshot_date', range.end);
        } else if (days !== 'ALL') {
          const since = new Date();
          since.setDate(since.getDate() - days);
          query = query.gte('snapshot_date', getTaipeiDateString(since));
        }

        const { data, error } = await query;
        if (error) throw error;
        setSnapshots(data || []);
      } else {
        let query = supabase
          .from('category_snapshots').select('date, value')
          .eq('user_id', uid)
          .in('category', categories)
          .order('date', { ascending: true });

        if (range) {
          query = query.gte('date', range.start).lte('date', range.end);
        } else if (days !== 'ALL') {
          const since = new Date();
          since.setDate(since.getDate() - days);
          query = query.gte('date', getTaipeiDateString(since));
        }

        const { data, error } = await query;
        if (error) throw error;
        setSnapshots(aggregateCategorySnapshotRows(data || []));
      }
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  const saveCategorySnapshots = async (assets, uid, date) => {
    const totals = groupSnapshotTotals(assets);
    // Asset rows arrive without a guaranteed order. Sort the composite-key
    // writes identically on every request so concurrent upserts acquire index
    // locks in the same order (Postgres can deadlock otherwise).
    const rows = Object.entries(totals)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([category, value]) => ({ user_id: uid, date, category, value }));
    if (!rows.length) return;

    // Focus-triggered loads and pull-to-refresh can overlap. Serialize writes
    // for this user's day while still allowing a queued write to carry newer
    // valuations calculated by the later load.
    const queueKey = `${uid}:${date}`;
    const pending = categorySnapshotWritesRef.current.get(queueKey) || Promise.resolve();
    const write = pending.catch(() => {}).then(async () => {
      const { error } = await supabase.from('category_snapshots').upsert(rows, {
        onConflict: 'user_id,date,category',
      });
      if (error) throw error;
    });
    categorySnapshotWritesRef.current.set(queueKey, write);
    try {
      await write;
    } finally {
      if (categorySnapshotWritesRef.current.get(queueKey) === write) {
        categorySnapshotWritesRef.current.delete(queueKey);
      }
    }
  };

  // Keep the monthly card aligned with the selected market filter.  The
  // previous implementation always read daily_snapshots, so selecting 台股 or
  // 美股 changed the trend chart but left monthly績效 showing total assets.
  const loadMonthlyBreakdown = useCallback(async (uid, filter = 'all') => {
    try {
      const monthStart = getTaipeiMonthStart(23);
      const categories = snapshotCategoriesForFilter(filter);
      let rows = [];
      if (!categories) {
        const { data } = await supabase
          .from('daily_snapshots').select('snapshot_date, net_worth_base')
          .eq('user_id', uid)
          .gte('snapshot_date', monthStart)
          .order('snapshot_date', { ascending: true });
        rows = data || [];
      } else {
        const { data } = await supabase
          .from('category_snapshots').select('date, value')
          .eq('user_id', uid)
          .in('category', categories)
          .gte('date', monthStart)
          .order('date', { ascending: true });
        rows = aggregateCategorySnapshotRows(data || []);
      }

      if (performanceModeRef.current !== 'market' || selectedFilterRef.current !== filter) return;

      if (rows.length < 2) {
        setMonthlyBreakdown([]);
        return;
      }

      const byMonth = {};
      for (const row of rows) {
        const date = row.snapshot_date || row.date;
        const value = Number(row.net_worth_base ?? row.value);
        if (!date || !Number.isFinite(value)) continue;
        const ym = date.slice(0, 7);
        if (!byMonth[ym]) byMonth[ym] = { first: value, last: value };
        else byMonth[ym].last = value;
      }

      const months = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b));
      const breakdown = [];
      for (let i = 1; i < months.length; i++) {
        const [ym, { last }] = months[i];
        const prevLast = months[i - 1][1].last;
        const change = last - prevLast;
        const pct = prevLast > 0 ? (change / prevLast) * 100 : 0;
        const [year, month] = ym.split('-');
        breakdown.push({ label: `${year}/${parseInt(month, 10)}月`, change, pct });
      }
      setMonthlyBreakdown(breakdown);
    } catch (error) {
      console.warn('loadMonthlyBreakdown error:', error);
      if (performanceModeRef.current === 'market' && selectedFilterRef.current === filter) setMonthlyBreakdown([]);
    }
  }, []);

  // Rebuild a real trading P&L history when the user switches the common
  // monthly/daily cards from market-value change to FIFO total P&L.  This is
  // deliberately separate from category snapshots: sold positions keep their
  // realized result even after the proceeds move into liquid assets.
  const loadTradePerformance = useCallback(async (filter = selectedFilterRef.current) => {
    const market = performanceMarketForFilter(filter);
    const requestId = tradePerformanceRequestRef.current + 1;
    tradePerformanceRequestRef.current = requestId;
    setPerformanceDataLoading(true);
    setPerformanceDataError('');
    // Keep the last successful FIFO calendar visible while refreshed prices load.

    if (!market) {
      setPerformanceDataError('交易總損益只適用投資市場篩選（全部、台股、美股或虛幣）。');
      setPerformanceDataLoading(false);
      return;
    }

    try {
      const performance = await loadInvestmentPerformance({
        valuedAssets: detailedAssets,
        baseCurrency: profile?.base_currency || 'TWD',
      });
      if (requestId !== tradePerformanceRequestRef.current || performanceModeRef.current !== 'trade') return;
      if (!performance?.initialized) {
        setPerformanceDataError('投資績效資料尚未初始化。');
        return;
      }
      setPerformanceScopeAssets(performance.performanceAssets || []);

      // The FIFO summary only needs the transaction ledger and current
      // valuations. Keep it available even when a public daily-price history
      // is missing for one of the selected instruments.
      const summary = calculateTradePerformance(performance.periodContext, market, 'ALL');
      setTradePnlSummary(summary);
      const requests = buildHistoricalPriceRequests(performance.periodContext, market);
      const fetchable = requests.filter(request => request.sourceMarket && request.sourceSymbol && !request.unavailableReason);
      if (!fetchable.length) {
        setPerformanceDataError('找不到可用的股票歷史收盤價，無法計算每日 FIFO 損益。');
        return;
      }

      const results = await allSettledWithConcurrency(fetchable, 3, async request => {
        const context = await fetchMarketTechnicalContext(
          request.sourceSymbol,
          request.sourceMarket,
          2000,
          false,
          false,
        );
        if (!context?.rows?.length) throw new Error('沒有日線收盤資料');
        return [request.identity, { rows: context.rows, request }];
      });
      if (requestId !== tradePerformanceRequestRef.current || performanceModeRef.current !== 'trade') return;

      const historyPairs = [];
      const failures = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') historyPairs.push(result.value);
        else failures.push(`${fetchable[index].symbol}：${result.reason?.message || '歷史行情不可用'}`);
      });
      const series = calculateHistoricalNavSeries(
        performance.periodContext,
        market,
        'ALL',
        Object.fromEntries(historyPairs),
        { mode: 'actual' },
      );
      let points = (series.points || []).filter(point => Number.isFinite(Number(point.totalPnl)));
      if (points.length && Number.isFinite(Number(summary?.totalPnl))) {
        const last = points.at(-1);
        // Keep the displayed endpoint identical to the FIFO headline, which
        // also includes supported current valuations unavailable historically.
        points[points.length - 1] = {
          ...last,
          totalPnl: Number(summary.totalPnl),
          totalCost: Number(summary.totalCost),
          realizedPnl: Number(summary.realizedPnl),
          unrealizedPnl: Number(summary.unrealizedPnl),
          currentValue: Number(summary.currentValue),
        };
      }
      if (!points.length) {
        setPerformanceDataError(series.reason || '所選期間沒有足夠的交易損益資料。');
        return;
      }

      const views = buildTradePnlViews(points);
      setMonthlyBreakdown(views.monthly);
      setDailyPnlMap(views.daily);
      setTradePnlSeries(views.series);
      setTradePnlDetailSource({ context: performance.periodContext, market });
      const notes = [];
      if (failures.length) notes.push(`部分標的歷史行情不可用：${failures.join('、')}`);
      if (series.excludedHistorySymbols?.length) notes.push(`${series.excludedHistorySymbols.join('、')} 無官方日線，終點已依交易總損益校正`);
      setPerformanceDataError(notes.join('；'));
    } catch (error) {
      if (requestId === tradePerformanceRequestRef.current) {
        setPerformanceDataError(error?.message || '無法建立交易總損益歷史');
      }
    } finally {
      if (requestId === tradePerformanceRequestRef.current) setPerformanceDataLoading(false);
    }
  }, [detailedAssets, profile]);

  const loadData = async (filterOverride) => {
    let stage = '確認登入狀態';
    let snapshotWarning = '';
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) return;
      setUserId(user.id);
      userIdRef.current = user.id;

      stage = '讀取個人設定';
      const { data: profileData, error: profileError } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();
      if (profileError) throw profileError;
      setProfile(profileData);

      stage = '讀取資產';
      const { data: assetsData, error: assetsError } = await supabase
        .from('assets')
        .select('id, name, symbol, category, current_amount, currency, market_type, average_cost, current_shares, leverage, created_at, exclude_from_performance')
        .eq('user_id', user.id);
      if (assetsError) throw assetsError;
      loadEarningsCalendar(assetsData || []);

      if (assetsData) {
        const baseCurrency = profileData?.base_currency || 'TWD';

        // ── Fetch live prices for investment assets ONCE — reused for both
        //    the snapshot total (item 1) and the ranking (item 2 / no double-fetch)
        const invAssets = assetsData.filter(
          a => a.category === 'investment' && a.current_shares > 0 && a.symbol
        );
        stage = '更新行情與匯率';
        const [priceMap, ratesMap] = await Promise.all([
          fetchLiveAssetPrices(invAssets),
          fetchExchangeRatesBatch(
            [...new Set(assetsData.map(asset => asset.currency).filter(Boolean))],
            baseCurrency,
          ),
        ]);

        // ── Convert all assets: investment uses live price if available,
        //    others fall back to DB current_amount
        const converted = await valueAssets(assetsData, baseCurrency, { ratesMap, livePrices: priceMap });
        const nonLiabilityAssets = converted.filter(asset => asset.category !== 'liability');
        setDetailedAssets(nonLiabilityAssets);

        const today      = getTaipeiDateString();
        const { netWorth: totalValue } = calculatePortfolioTotals(converted);

        // Upsert today's snapshot with live-price-accurate total
        stage = '更新今日快照';
        try {
          const { error: snapshotError } = await supabase.from('daily_snapshots').upsert(
            { user_id: user.id, snapshot_date: today, net_worth_base: totalValue },
            { onConflict: 'user_id,snapshot_date' }
          );
          if (snapshotError) throw snapshotError;
          await saveCategorySnapshots(converted, user.id, today);
        } catch (snapshotError) {
          const message = [snapshotError?.message, snapshotError?.details].filter(Boolean).join(' ');
          if (!/fetch failed|network connection|network request failed|failed to fetch|timed? out|offline/i.test(message)) throw snapshotError;
          snapshotWarning = '網路中斷，今日快照尚未更新；下方顯示已保存的歷史資料。連線恢復後請重試。';
        }

      }

      const filterToLoad = filterOverride !== undefined ? filterOverride : selectedFilter;
      if (performanceModeRef.current === 'market') {
        stage = '讀取每月資料';
        await loadMonthlyBreakdown(user.id, filterToLoad);
      }
      stage = '讀取圖表歷史';
      await loadSnapshots(user.id, selectedPeriod.days, customRange, filterToLoad);
      setChartLoadError(snapshotWarning);
    } catch (e) {
      const message = [e?.message, e?.details, String(e || '')].filter(Boolean).join(' ');
      const networkFailure = /fetch failed|network connection|network request failed|failed to fetch|timed? out|offline/i.test(message);
      setChartLoadError(networkFailure
        ? `${stage}時網路中斷，現有圖表資料未更新。請確認連線後重試。`
        : `${stage}失敗：${e?.message || '請稍後重試'}`);
      if (!networkFailure) console.error('Error loading charts:', e);
    } finally {
      setLoading(false);
    }
  };

  // Keep the ref pointing at the freshest loadData every render.
  loadDataRef.current = loadData;

  // ── Calendar data loader ──────────────────────────────────────────────────
  const loadCalendarData = useCallback(async (uid, year, month, filter = selectedFilterRef.current) => {
    setCalendarLoading(true);
    try {
      // Fetch the day before the month starts so we can compute day-1 diff
      const prevDay = new Date(year, month - 1, 0); // last day of previous month
      const lastDay = new Date(year, month, 0);     // last day of this month
      const startStr = getTaipeiDateString(prevDay);
      const endStr   = getTaipeiDateString(lastDay);

      const categories = snapshotCategoriesForFilter(filter);
      let data;
      if (!categories) {
        const response = await supabase
          .from('daily_snapshots')
          .select('snapshot_date, net_worth_base')
          .eq('user_id', uid)
          .gte('snapshot_date', startStr)
          .lte('snapshot_date', endStr)
          .order('snapshot_date', { ascending: true });
        data = response.data || [];
      } else {
        const response = await supabase
          .from('category_snapshots')
          .select('date, value')
          .eq('user_id', uid)
          .in('category', categories)
          .gte('date', startStr)
          .lte('date', endStr)
          .order('date', { ascending: true });
        data = aggregateCategorySnapshotRows(response.data || []);
      }

      if (performanceModeRef.current !== 'market' || selectedFilterRef.current !== filter) return;
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
  loadCalendarDataRef.current = loadCalendarData;

  // Reload calendar whenever the displayed month or the logged-in user changes
  useEffect(() => {
    if (userId && performanceMode === 'market') {
      loadMonthlyBreakdown(userId, selectedFilter);
      loadCalendarData(userId, calendarMonth.year, calendarMonth.month, selectedFilter);
    }
  }, [userId, calendarMonth, selectedFilter, performanceMode, loadMonthlyBreakdown, loadCalendarData]);

  // Transaction mode uses the historical close series instead of category
  // snapshots, so changing market or entering this mode reloads the FIFO P&L
  // points once and reuses them for both cards.
  useEffect(() => {
    if (userId && performanceMode === 'trade') {
      loadTradePerformance(selectedFilter);
    }
  }, [userId, selectedFilter, performanceMode, detailedAssets, loadTradePerformance]);

  // ── Day-detail: fetch category_snapshots for a tapped calendar day ────────
  const openDayDetail = useCallback(async (dateStr, mode = 'pnl', earnings = []) => {
    setDayDetailDate(dateStr);
    setDayDetailMode(mode);
    setDayDetailEarnings(earnings);
    setDayDetailVisible(true);
    setDayDetailData([]);
    setDayDetailNetWorth(null);
    if (mode === 'earnings' || performanceModeRef.current === 'trade') {
      // FIFO daily P&L is already available locally. Opening the sheet should
      // be immediate and must not fetch unrelated market-value snapshots.
      setDayDetailLoading(false);
      return;
    }
    setDayDetailLoading(true);
    try {
      const uid = userIdRef.current;
      const categories = snapshotCategoriesForFilter(selectedFilterRef.current);
      if (!categories) {
        const [catRes, snapRes] = await Promise.all([
          supabase.from('category_snapshots').select('category, value').eq('user_id', uid).eq('date', dateStr),
          supabase.from('daily_snapshots').select('net_worth_base').eq('user_id', uid).eq('snapshot_date', dateStr).maybeSingle(),
        ]);
        setDayDetailData(catRes.data || []);
        setDayDetailNetWorth(snapRes.data ? parseFloat(snapRes.data.net_worth_base) : null);
      } else {
        const { data } = await supabase
          .from('category_snapshots').select('category, value')
          .eq('user_id', uid)
          .in('category', categories)
          .eq('date', dateStr);
        const rows = data || [];
        setDayDetailData(rows);
        setDayDetailNetWorth(rows.reduce((sum, row) => sum + (Number(row.value) || 0), 0));
      }
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
    setSelectedPeriod(PERIODS.find(period => period.days === null)); // 自定義
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
      // Allow upcoming earnings while keeping the navigator bounded.
      if ((next.year - today.getFullYear()) * 12 + next.month - (today.getMonth() + 1) > 12) {
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

  const displayedMonthEarnings = (() => {
    const monthPrefix = `${calendarMonth.year}-${pad2(calendarMonth.month)}-`;
    const merged = earningsEvents.filter(event => event.date.startsWith(monthPrefix));
    marketCalendarEvents.filter(event => event.date.startsWith(monthPrefix)).forEach(event => {
      const maxDateDifference = event.marketType === 'US' ? 86400000 : 0;
      const priorIndex = merged.findIndex(prior => prior.marketType === event.marketType && prior.symbol === event.symbol
        && Math.abs(Date.parse(`${prior.date}T00:00:00Z`) - Date.parse(`${event.date}T00:00:00Z`)) <= maxDateDifference);
      if (priorIndex >= 0) {
        const prior = merged[priorIndex];
        const isFilingDeadline = Boolean(prior.isFilingDeadline || event.isFilingDeadline
          || prior.eventType === 'filing_deadline' || event.eventType === 'filing_deadline');
        // Keep a confirmed release as confirmed when the calendar API reports
        // the same event as upcoming; otherwise prefer the market calendar date.
        const combinedEvent = prior.status === 'released'
          ? { ...event, ...prior, sourceDate: event.sourceDate || prior.sourceDate }
          : { ...prior, ...event };
        merged[priorIndex] = { ...combinedEvent, isFilingDeadline };
      }
      else merged.push(event);
    });
    const unique = new Map();
    merged.forEach(event => {
      const marketType = String(event.marketType || event.key?.split(':')[0] || '').trim().toUpperCase();
      const symbol = String(event.symbol || '').trim().toUpperCase();
      const key = `${marketType}:${symbol}:${event.date}`;
      const prior = unique.get(key);
      const preferred = !prior || event.status === 'released' ? event : prior;
      const secondary = preferred === event ? prior : event;
      const combined = prior ? {
        ...secondary,
        ...preferred,
        quarter: preferred.quarter || secondary.quarter,
        isHolding: prior.isHolding || event.isHolding,
        isWatchlist: prior.isWatchlist || event.isWatchlist,
        isFilingDeadline: Boolean(prior.isFilingDeadline || event.isFilingDeadline
          || prior.eventType === 'filing_deadline' || event.eventType === 'filing_deadline'),
      } : event;
      unique.set(key, { ...combined, key });
    });
    return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
  })();
  const earningsByDate = displayedMonthEarnings.reduce((groups, event) => {
    (groups[event.date] ||= []).push(event);
    return groups;
  }, {});

  // Monthly summary: sum of all daily diffs in the displayed month
  const calendarMonthSummary = (() => {
    const { year, month } = calendarMonth;
    const prefix  = `${year}-${pad2(month)}-`;
    const entries = Object.entries(dailyPnlMap).filter(([k]) => k.startsWith(prefix));
    if (entries.length === 0) return null;
    const realizedDiff = entries.reduce((s, [, v]) => s + (Number(v.realizedDiff) || 0), 0);
    const unrealizedDiff = entries.reduce((s, [, v]) => s + (Number(v.unrealizedDiff) || 0), 0);
    const totalDiff  = entries.reduce((s, [, v]) => s + (Number(v.totalDiff ?? v.diff) || 0), 0);
    const sorted     = [...entries].sort(([a], [b]) => a.localeCompare(b));
    const startValue = sorted[0][1].prevValue;
    const pct        = startValue > 0 ? (totalDiff / startValue) * 100 : 0;
    const realizedPct = startValue > 0 ? (realizedDiff / startValue) * 100 : 0;
    const unrealizedPct = startValue > 0 ? (unrealizedDiff / startValue) * 100 : 0;
    return { diff: totalDiff, realizedDiff, unrealizedDiff, pct, realizedPct, unrealizedPct };
  })();

  const selectedDayTradeSummary = useMemo(() => (
    dayDetailVisible && performanceMode === 'trade' && dayDetailMode === 'pnl'
      && dayDetailDate && tradePnlDetailSource
      ? calculateTradePerformance(tradePnlDetailSource.context, tradePnlDetailSource.market, { start: dayDetailDate, end: dayDetailDate })
      : null
  ), [dayDetailVisible, performanceMode, dayDetailMode, dayDetailDate, tradePnlDetailSource]);
  const selectedDaySellRows = (selectedDayTradeSummary?.assetRows || [])
    .filter(row => row.matchedSellCount > 0)
    .sort((a, b) => Math.abs(b.realizedPnl) - Math.abs(a.realizedPnl));

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
        const ids = [...new Set([
          ...(map[key].ids || (map[key].id ? [map[key].id] : [])),
          ...(a.ids || (a.id ? [a.id] : [])),
        ].filter(Boolean))];
        map[key] = {
          ...map[key],
          ids,
          converted_amount: (map[key].converted_amount || 0) + (a.converted_amount || 0),
          exclude_from_performance: Boolean(
            map[key].exclude_from_performance || a.exclude_from_performance
          ),
        };
      } else {
        map[key] = {
          ...a,
          ids: [...new Set([...(a.ids || []), a.id].filter(Boolean))],
          exclude_from_performance: Boolean(a.exclude_from_performance),
        };
      }
    });
    return Object.values(map);
  };

  // The donut and trading performance intentionally share one exclusion
  // source. Every donut level uses the same filtered holdings, so the
  // category, market, and holding views keep one consistent denominator.
  const allocationAssets = detailedAssets.filter(asset => !asset.exclude_from_performance);
  const allocationCategorySums = {};
  allocationAssets.forEach(asset => {
    allocationCategorySums[asset.category] = (
      allocationCategorySums[asset.category] || 0
    ) + (Number(asset.converted_amount) || 0);
  });
  const allocationCategoryTotals = Object.entries(allocationCategorySums)
    .filter(([, value]) => value > 0)
    .map(([category, value]) => ({
      key: category,
      label: CATEGORY_CONFIG[category]?.label || category,
      value,
      color: categoryColor(category),
    }));
  const sharedScopeAssets = performanceScopeAssets.length
    ? performanceScopeAssets
    : mergeBySymbol(detailedAssets.filter(asset => asset.category === 'investment'))
    .sort((a, b) => (Number(b.converted_amount) || 0) - (Number(a.converted_amount) || 0));

  const getDrilldownData = (category, marketType = null) => {
    const catAssets = allocationAssets.filter(a => a.category === category);
    if (category === 'investment') {
      if (marketType) {
        return mergeBySymbol(catAssets.filter(a => (a.market_type || 'other') === marketType))
          .filter(a => a.converted_amount > 0)
          .sort((a, b) => b.converted_amount - a.converted_amount)
          .slice(0, DRILL_LIMIT)
          .map((a, i) => ({
            key: a.symbol || a.name,
            label: a.name,
            value: a.converted_amount,
            color: chartPalette[i % chartPalette.length],
          }));
      }
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
          color: marketColor(mt),
        }));
    }
    return mergeBySymbol(catAssets)
      .filter(a => a.converted_amount > 0)
      .sort((a, b) => b.converted_amount - a.converted_amount)
      .slice(0, DRILL_LIMIT)
      .map((a, i) => ({
        key: a.symbol || a.name,
        label: a.name,
        value: a.converted_amount,
        color: chartPalette[i % chartPalette.length],
      }));
  };

  const getFilteredDonutData = () => {
    let filtered;
    switch (selectedFilter) {
      case 'TW':
      case 'US':
      case 'Crypto':
        filtered = allocationAssets.filter(a => a.market_type === selectedFilter);
        break;
      case 'liquid':
        filtered = allocationAssets.filter(a => a.category === 'liquid');
        break;
      case 'fixed':
        filtered = allocationAssets.filter(a => a.category === 'fixed');
        break;
      case 'receivable':
        filtered = allocationAssets.filter(a => a.category === 'receivable');
        break;
      case 'other':
        filtered = allocationAssets.filter(a =>
          a.category === 'investment' && !['TW', 'US', 'Crypto'].includes(a.market_type)
        );
        break;
      default:
        filtered = allocationAssets;
    }
    const mergedAssets = mergeBySymbol(filtered);
    return mergedAssets
      .filter(a => a.converted_amount > 0)
      .sort((a, b) => b.converted_amount - a.converted_amount)
      .slice(0, DRILL_LIMIT)
      .map((a, i) => ({
        key: a.symbol || a.name,
        label: a.name,
        value: a.converted_amount,
        color: chartPalette[i % chartPalette.length],
      }));
  };

  const currentDonutData = selectedFilter !== 'all'
    ? getFilteredDonutData()
    : drilldownCategory
      ? getDrilldownData(drilldownCategory, drilldownMarketType)
      : allocationCategoryTotals;
  const donutTotal = currentDonutData.reduce((s, d) => s + d.value, 0);

  const handleAllocationSelect = (index, toggleSelection = false) => {
    if (!allocationDrilldownReady) return;
    allocationDrilldownInteractedRef.current = true;
    if (index == null) {
      setSelectedDonutIndex(null);
      return;
    }
    if (selectedFilter === 'all' && !drilldownCategory) {
      const category = currentDonutData[index].key;
      setDrilldownCategory(category);
      setDrilldownMarketType(null);
      setSelectedDonutIndex(null);
      AsyncStorage.setItem(ALLOCATION_DRILLDOWN_STORAGE_KEY, JSON.stringify({ category, marketType: null })).catch(() => {});
      return;
    }
    if (selectedFilter === 'all' && drilldownCategory === 'investment' && !drilldownMarketType) {
      const marketType = currentDonutData[index].key;
      setDrilldownMarketType(marketType);
      setSelectedDonutIndex(null);
      AsyncStorage.setItem(ALLOCATION_DRILLDOWN_STORAGE_KEY, JSON.stringify({ category: 'investment', marketType })).catch(() => {});
      return;
    }
    setSelectedDonutIndex(current => toggleSelection && current === index ? null : index);
  };

  const selectedFilterLabel = FILTER_OPTIONS.find(o => o.key === selectedFilter)?.label || '全部';
  const assetRanking = buildHoldingRanking(detailedAssets, selectedFilter);
  const selectedTradePoint = dayDetailDate && tradePnlSeries.find(point => point.date === dayDetailDate);
  const selectedPnlMetricConfig = PNL_METRICS.find(metric => metric.key === selectedPnlMetric) || PNL_METRICS[2];
  const performanceMarket = {
    all: 'ALL',
    TW: 'TW',
    US: 'US',
    Crypto: 'CRYPTO',
    other: 'OTHER',
  }[selectedFilter];
  const applySharedExclusion = (assetIds, excluded) => {
    const ids = (Array.isArray(assetIds) ? assetIds : [assetIds]).filter(Boolean);
    setDetailedAssets(current => current.map(item => (
      ids.includes(item.id)
        ? { ...item, exclude_from_performance: Boolean(excluded) }
        : item
    )));
    setSelectedDonutIndex(null);
  };
  const togglePerformanceScopeAsset = async asset => {
    const assetIds = (Array.isArray(asset.ids) ? asset.ids : [asset.ids || asset.id]).filter(Boolean);
    const nextExcluded = !asset.exclude_from_performance;
    setScopeSavingAssetId(asset.id);
    try {
      await setAssetPerformanceExclusion(assetIds, nextExcluded);
      applySharedExclusion(assetIds, nextExcluded);
      await loadTradePerformance(selectedFilter);
    } catch (error) {
      Alert.alert('無法更新計算範圍', error?.message || '請稍後再試');
    } finally {
      setScopeSavingAssetId(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#10b981" />}
      >
        {!!chartLoadError && <View style={[styles.chartErrorBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.chartErrorText, { color: colors.text }]}>{chartLoadError}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={onRefresh} style={[styles.chartErrorRetry, { backgroundColor: colors.accentSoft }]}>
            <Text style={[styles.chartErrorRetryText, { color: colors.accent }]}>重試</Text>
          </TouchableOpacity>
        </View>}

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
                  allocationDrilldownInteractedRef.current = true;
                  AsyncStorage.removeItem(ALLOCATION_DRILLDOWN_STORAGE_KEY).catch(() => {});
                  setSelectedFilter(newFilter);
                  setDrilldownCategory(null);
                  setDrilldownMarketType(null);
                  setSelectedDonutIndex(null);
                  setMonthlyBreakdown([]);
                  setDailyPnlMap({});
                  setPerformanceDataError('');
                  setTradePnlSummary(null);
                  setTradePnlSeries([]);
                  setPerformanceScopeAssets([]);
                  if (userId) {
                    loadSnapshots(userId, selectedPeriod.days, customRange, newFilter);
                  }
                }}
                style={{
                  paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
                  backgroundColor: active ? PRIMARY : colors.cardAlt,
                  borderWidth: 1,
                  borderColor: active ? PRIMARY : colors.border,
                }}
                activeOpacity={0.75}
              >
                <Text style={{ color: active ? colors.accentContrast : colors.textSub, fontSize: 13, fontWeight: active ? '700' : '500' }}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {performanceMarket && <InvestmentPerformanceCard
          valuedAssets={detailedAssets}
          baseCurrency={currency}
          selectedMarket={performanceMarket}
          onExclusionChanged={applySharedExclusion}
        />}

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
                      active && { backgroundColor: PRIMARY, borderColor: PRIMARY, shadowColor: PRIMARY }]}
                    onPress={() => handlePeriodSelect(p)}
                    activeOpacity={0.75}
                  >
                    {p.days === null && <Calendar size={10} color={active ? colors.accentContrast : PRIMARY} style={{ marginRight: 3 }} />}
                    <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.periodLabel, { color: active ? colors.accentContrast : colors.textSub }, active && styles.periodLabelActive]}>
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
        {detailedAssets.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.text, flex: 1 }]}>
                {selectedFilter !== 'all'
                  ? `${selectedFilterLabel} 資產配置`
                  : drilldownMarketType
                    ? `${MARKET_TYPE_CONFIG[drilldownMarketType]?.label || drilldownMarketType}分布`
                    : drilldownCategory
                      ? CATEGORY_CONFIG[drilldownCategory]?.label
                      : '資產配置'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setScopeModalVisible(true)}
                  style={[styles.scopeButton, { borderColor: colors.border, backgroundColor: colors.bg }]}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.scopeButtonText, { color: colors.textSub }]}>選擇標的</Text>
                </TouchableOpacity>
                {selectedFilter === 'all' && drilldownCategory && (
                  <TouchableOpacity
                    onPress={() => {
                      allocationDrilldownInteractedRef.current = true;
                      if (drilldownMarketType) setDrilldownMarketType(null);
                      else setDrilldownCategory(null);
                      setSelectedDonutIndex(null);
                    }}
                    style={[styles.backBtn, { backgroundColor: colors.bg }]}
                  >
                    <Text style={[styles.backBtnText, { color: colors.textSub }]}>← 返回</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            {currentDonutData.length > 0 ? (
              <>
                <View style={styles.donutCenter}>
                  <DonutChart
                    data={currentDonutData}
                    size={180}
                    strokeWidth={28}
                    selectedIndex={selectedDonutIndex}
                    onSelect={i => handleAllocationSelect(i)}
                  />
                </View>
                <View style={styles.legend}>
                  {currentDonutData.map((item, i) => {
                    const pct = donutTotal > 0 ? (item.value / donutTotal) * 100 : 0;
                    const isSelected = selectedDonutIndex === i;
                    return (
                      <TouchableOpacity
                        key={item.key ?? i}
                        onPress={() => handleAllocationSelect(i, true)}
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
              </>
            ) : (
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>目前篩選範圍沒有納入資產</Text>
            )}
          </View>
        )}

        {/* ── ASSET RANKING ─────────────────────────────────────────────── */}
        {(assetRanking.gainers.length > 0 || assetRanking.losers.length > 0) && (
          <View style={[styles.card, { marginHorizontal: 16, marginTop: 16, backgroundColor: colors.card }]}>
            <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 3 }]}>持倉排行</Text>
            <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: 12 }}>
              已套用「選擇標的」與{selectedFilterLabel}範圍 · 同代號合併計算
            </Text>
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

        <PerformanceCalendar {...{ performanceMode, calendarEarningsOnly, setCalendarEarningsOnly, selectedPnlMetricConfig, selectedFilter, selectedFilterLabel, calendarLoading, performanceDataLoading, earningsCalendarLoading, selectedPnlMetric, setSelectedPnlMetric, calendarMonth, prevMonth, nextMonth, calendarMonthSummary, performanceDataError, dailyPnlMap, loadTradePerformance, calendarRows, earningsByDate, openDayDetail, isDark, fmt, fmtCompact, currency, displayedMonthEarnings, openEarningsAnalysis, earningsCalendarError, marketCalendarError, colors, styles, PRIMARY }} />

      </ScrollView>

      <DayDetailModal {...{ dayDetailVisible, setDayDetailVisible, dayDetailDate, dayDetailMode, dayDetailEarnings, openEarningsAnalysis, performanceMode, dailyPnlMap, selectedTradePoint, selectedDaySellRows, selectedDayTradeSummary, dayDetailNetWorth, dayDetailLoading, dayDetailData, fmt, currency, colors, styles, CATEGORY_CONFIG, MARKET_TYPE_CONFIG, PRIMARY }} />

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
                  <View style={[styles.wheelSelectionBar, { borderColor: PRIMARY, backgroundColor: `${PRIMARY}14` }]} />
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
                <TouchableOpacity style={[styles.applyBtn, { backgroundColor: PRIMARY, shadowColor: PRIMARY }]} onPress={applyCustomRange}>
                  <Text style={[styles.applyBtnText, { color: colors.accentContrast }]}>確定</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <ExclusionModal
        visible={scopeModalVisible}
        onClose={() => setScopeModalVisible(false)}
        assets={sharedScopeAssets}
        savingAssetId={scopeSavingAssetId}
        onToggle={togglePerformanceScopeAsset}
        colors={colors}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  chartErrorBanner: { marginHorizontal: 16, marginTop: 12, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chartErrorText: { flex: 1, fontSize: 11, lineHeight: 16 },
  chartErrorRetry: { minHeight: 44, minWidth: 52, paddingHorizontal: 10, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  chartErrorRetryText: { fontSize: 11, fontWeight: '800' },
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
  sectionLabel: { fontSize: 14, fontWeight: '700' },
  changeBadge: { fontSize: 13, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  pos: { color: '#0DBD8B', backgroundColor: 'rgba(13,189,139,0.12)' },
  neg: { color: '#F03030', backgroundColor: 'rgba(240,48,48,0.12)' },

  // ── Liquid Glass ──
  glassContainer: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(148,163,184,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.15)',
    marginBottom: 14,
    // subtle inner shadow illusion
    shadowColor: '#000',
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
    borderColor: 'rgba(255,255,255,0.3)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 4,
  },
  periodLabel: { fontSize: 12, fontWeight: '600' },
  periodLabelActive: { color: '#0B1F3A', fontWeight: '700' },

  emptyText: { textAlign: 'center', lineHeight: 22, paddingVertical: 32 },
  changeDetail: { fontSize: 13, fontWeight: '500', marginTop: 12, textAlign: 'right' },
  posText: { color: '#00C851' },
  negText: { color: '#F03030' },

  backBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  backBtnText: { fontSize: 13, fontWeight: '500' },
  scopeButton: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9, borderWidth: 1 },
  scopeButtonText: { fontSize: 11, fontWeight: '700' },
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
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  applyBtnText: { color: '#0B1F3A', fontSize: 16, fontWeight: '700' },
});
