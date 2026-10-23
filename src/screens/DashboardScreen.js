import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, useWindowDimensions, Alert, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Wallet, TrendingUp, Home, DollarSign, CreditCard, Plus, RefreshCw,
  Eye, EyeOff, Check, SlidersHorizontal, X,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { getTaipeiDateString, getTaipeiMonthStart } from '../lib/date';
import { getDayPnlPresentation } from '../lib/marketPnl';
import { applyCompleteFifoPositionCosts } from '../lib/positionAccounting';
import { fetchExchangeRatesBatch } from '../services/api';
import {
  calculatePortfolioTotals,
  fetchLiveAssetPrices,
  getLiveQuote,
  getAssetCurrency,
  groupSnapshotTotals,
  valueAssets,
} from '../services/portfolio';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../lib/ThemeContext';
import {
  buildCurrentFifoPerformanceContext,
  buildInvestmentTransactionFlows,
  calculateTradePerformance,
  fetchInvestmentTransactions,
  getInvestmentPerformanceIdentity,
  normalizePerformanceMarket,
  setAssetPerformanceExclusion,
} from '../services/investmentPerformance';
import { analyzeTechnicalData, fetchMarketTechnicalContext } from '../services/technicalAnalysis';
import { calculateTradePlan, getTradePlanDisplayStatus } from '../services/tradePlanCalculator';
import { loadActiveTradePlanStops, loadTradePlanSettings, saveTradePlanStops } from '../services/tradePlans';

const DASHBOARD_CACHE_KEY = '@wt_dashboard_cache';

const GREEN   = '#0DBD8B';
const RED     = '#F03030';

const CATEGORY_CONFIG = {
  liquid:     { label: '流動資產', Icon: Wallet },
  investment: { label: '投資資產', Icon: TrendingUp },
  fixed:      { label: '固定資產', Icon: Home },
  receivable: { label: '應收款項', Icon: DollarSign },
  liability:  { label: '負債', Icon: CreditCard },
};

const ASSET_CATEGORIES = ['liquid', 'investment', 'fixed', 'receivable'];

const MARKET_TYPE_CONFIG = {
  TW: { label: '台股' }, US: { label: '美股' },
  Crypto: { label: '虛幣' }, other: { label: '其他' },
};

const getAllocationColors = (palette) => ({
  investment: palette[0], liquid: palette[1], fixed: palette[4], receivable: palette[2],
});

const formatAmount = (amount) => Math.round(amount).toLocaleString('zh-TW');

const getAssetRenderKey = (asset) => [
  asset.id,
  asset.category,
  asset.market_type || '',
  asset.symbol || asset.name || '',
  asset.currency || '',
].join(':');

const getTradePlanKey = (asset) => [
  String(asset?.market_type || '').trim().toUpperCase() === 'CRYPTO'
    ? 'CRYPTO'
    : String(asset?.market_type || '').trim().toUpperCase(),
  String(asset?.symbol || '').trim().toUpperCase(),
].join(':');

const aggregateInvestmentAssets = (items = []) => {
  const map = new Map();
  for (const asset of items) {
    if (asset?.category !== 'investment' || !asset?.symbol || !(Number(asset.current_shares) > 0)) continue;
    const key = getTradePlanKey(asset);
    const shares = Number(asset.current_shares) || 0;
    const nativeCost = shares * (Number(asset.average_cost) || 0);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...asset, current_shares: shares, _nativeCost: nativeCost });
      continue;
    }
    existing.current_shares += shares;
    existing._nativeCost += nativeCost;
    if (Number(asset.live_price) > 0) existing.live_price = Number(asset.live_price);
  }
  return [...map.values()].map(asset => ({
    ...asset,
    average_cost: asset.current_shares > 0 ? asset._nativeCost / asset.current_shares : 0,
  }));
};

const runWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        results[index] = { error };
      }
    }
  });
  await Promise.all(runners);
  return results;
};

// ─── Sparkline ───────────────────────────────────────────────────────────────
const Sparkline = ({ data, width, height = 40, color = GREEN }) => {
  const w = width || 100;
  if (!data || data.length < 2) {
    return (
      <Svg width={w} height={height}>
        <Polyline
          points={`0,${height / 2} ${w},${height / 2}`}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeOpacity={0.35}
        />
      </Svg>
    );
  }
  const minVal = Math.min(...data);
  const maxVal = Math.max(...data);
  const range  = maxVal - minVal || 1;
  const pad    = 4;
  const pts    = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = pad + ((maxVal - v) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <Svg width={w} height={height}>
      <Polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

// ─── Donut Chart ─────────────────────────────────────────────────────────────
const DonutChart = ({ data, size = 110, strokeWidth = 18, bgColor = '#2A3A61' }) => {
  const radius       = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx           = size / 2;
  const cy           = size / 2;
  const total        = data.reduce((s, d) => s + (d.value || 0), 0);

  let cumPct = 0;
  const segments = data
    .map((seg) => {
      const pct = total > 0 ? (seg.value / total) * 100 : 0;
      if (pct <= 0.3) return null;
      const dashVisible = (pct / 100) * circumference;
      const dashGap     = circumference - dashVisible;
      const rotation    = cumPct * 3.6 - 90;
      cumPct += pct;
      return { color: seg.color, dashVisible, dashGap, rotation };
    })
    .filter(Boolean);

  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={radius} stroke={bgColor} strokeWidth={strokeWidth} fill="none" />
      {segments.map((seg, i) => (
        <Circle
          key={i}
          cx={cx} cy={cy} r={radius}
          stroke={seg.color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${seg.dashVisible} ${seg.dashGap}`}
          strokeDashoffset={0}
          transform={`rotate(${seg.rotation} ${cx} ${cy})`}
        />
      ))}
    </Svg>
  );
};

const PnlExclusionModal = ({ visible, onClose, assets, savingAssetId, onToggle, colors }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.pnlScopeOverlay}>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="關閉投資損益計算範圍"
      />
      <View style={[styles.pnlScopeModal, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.pnlScopeHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.pnlScopeTitle, { color: colors.text }]}>投資損益計算範圍</Text>
            <Text style={[styles.pnlScopeHint, { color: colors.textMuted }]}>排除公司配股等不屬於個人投資的部位</Text>
          </View>
          <TouchableOpacity
            style={[styles.pnlScopeClose, { backgroundColor: colors.cardAlt }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="關閉"
          >
            <X size={20} color={colors.textSub} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.pnlScopeList} showsVerticalScrollIndicator={false}>
          {assets.map(asset => {
            const excluded = Boolean(asset.exclude_from_performance);
            const saving = savingAssetId === asset.id;
            return (
              <TouchableOpacity
                key={asset.id}
                style={[styles.pnlScopeRow, { borderBottomColor: colors.border }]}
                onPress={() => onToggle(asset)}
                disabled={Boolean(savingAssetId)}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !excluded, disabled: Boolean(savingAssetId) }}
                accessibilityLabel={`${asset.name || asset.symbol}，${excluded ? '已排除' : '已納入'}`}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.pnlScopeAssetName, { color: colors.text }]} numberOfLines={1}>
                    {asset.name || asset.symbol}
                  </Text>
                  <Text style={[styles.pnlScopeAssetMeta, { color: colors.textMuted }]} numberOfLines={1}>
                    {asset.symbol}{asset.market_type ? ` · ${MARKET_TYPE_CONFIG[asset.market_type]?.label || asset.market_type}` : ''}
                  </Text>
                </View>
                <View style={[
                  styles.pnlScopeToggle,
                  {
                    backgroundColor: excluded ? colors.cardAlt : colors.accentSoft,
                    borderColor: excluded ? colors.border : colors.accent,
                  },
                ]}>
                  {saving
                    ? <ActivityIndicator size="small" color={colors.accent} />
                    : !excluded && <Check size={14} color={colors.accent} strokeWidth={3} />}
                  {!saving && (
                    <Text style={[styles.pnlScopeToggleText, { color: excluded ? colors.textMuted : colors.accent }]}>
                      {excluded ? '已排除' : '納入'}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Text style={[styles.pnlScopeFooter, { color: colors.textMuted }]}>此設定也會套用到「股票交易報酬」，不影響淨資產、資產配置與持倉。</Text>
        <TouchableOpacity style={[styles.pnlScopeDone, { backgroundColor: colors.accent }]} onPress={onClose}>
          <Text style={[styles.pnlScopeDoneText, { color: colors.accentContrast }]}>完成</Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
);

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const navigation          = useNavigation();
  const insets              = useSafeAreaInsets();
  const { colors, isDark, theme }  = useTheme();
  const primary = colors.accent;
  const allocationColors = getAllocationColors(colors.chartPalette);
  const marketColors = {
    TW: colors.chartPalette[0], US: colors.chartPalette[1],
    Crypto: colors.chartPalette[2], other: colors.chartPalette[4],
  };
  const { width: SW }       = useWindowDimensions();

  const [assets,             setAssets]             = useState([]);
  const [profile,            setProfile]            = useState(null);
  const [loading,            setLoading]            = useState(true);
  const [refreshing,         setRefreshing]         = useState(false);
  const [netWorth,           setNetWorth]           = useState(0);
  const [monthlyChange,      setMonthlyChange]      = useState(null);
  const [selectedCategory,   setSelectedCategory]   = useState(null);
  const [lastUpdated,        setLastUpdated]        = useState(null);
  const [hidden,             setHidden]             = useState(false);
  const [sortOrder,          setSortOrder]          = useState('default');
  const [isRefreshing,       setIsRefreshing]       = useState(false);
  const [categorySnapshots,  setCategorySnapshots]  = useState([]);
  const [loadError,          setLoadError]          = useState(null);
  const [hasWatchlist,       setHasWatchlist]       = useState(false);
  const [selectedPnlMarket,  setSelectedPnlMarket]  = useState('ALL');
  const [positionCostNotice, setPositionCostNotice] = useState(null);
  const [fifoTransactionFlows, setFifoTransactionFlows] = useState(null);
  const [pnlScopeVisible,    setPnlScopeVisible]    = useState(false);
  const [savingPnlAssetId,   setSavingPnlAssetId]   = useState(null);
  const [tradePlanStatuses,  setTradePlanStatuses]  = useState({});
  const [tradePlanLoading,   setTradePlanLoading]   = useState(false);
  const [selectedTradePlanState, setSelectedTradePlanState] = useState(null);
  const CONCENTRATION_THRESHOLD = 0.30; // warn when single asset > 30% of portfolio

  const lastLoadedRef = useRef(0);
  const tradePlanRequestRef = useRef(0);

  // ── theme tokens ─────────────────────────────────────────────────────────
  const C = {
    bg:       colors.bg,
    card:     colors.card,
    border:   colors.border,
    text:     colors.text,
    textSub:  colors.textSub,
    textMuted:colors.textMuted,
    donutBg:  colors.cardAlt,
  };

  const cardWidth = (SW - 16 * 2 - 10) / 2;

  // ── cache load ───────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(DASHBOARD_CACHE_KEY);
        if (cached) {
          const { assets: ca, netWorth: cnw } = JSON.parse(cached);
          setAssets(ca);
          setNetWorth(cnw);
          if (ca.some(asset => asset.category === 'investment' && Number(asset.current_shares) > 0)) {
            setPositionCostNotice('正在核對交易紀錄；目前先顯示上次計算結果。');
          }
          setLoading(false);
          setIsRefreshing(true);
        }
      } catch (e) {
        console.log('dashboard cache read error:', e);
      }
    })();
  }, []);

  const cycleSortOrder = () =>
    setSortOrder(prev =>
      prev === 'default' ? 'desc' :
      prev === 'desc' ? 'asc' :
      prev === 'asc' ? 'pnl_desc' :
      prev === 'pnl_desc' ? 'pnl_asc' : 'default'
    );

  // ── derived data ─────────────────────────────────────────────────────────
  const mergedAssets = useMemo(() => {
    const map = new Map();
    for (const asset of assets) {
      const key = asset.category === 'investment' && asset.symbol
        ? `inv:${asset.symbol}:${asset.market_type || ''}:${asset.currency || ''}:${asset.category}`
        : `${asset.category}:${asset.name}:${asset.currency || ''}`;
      if (!map.has(key)) {
        const shares = Number(asset.current_shares) || 0;
        map.set(key, {
          ...asset,
          _allIds: [asset.id],
          _nativeCost: shares * (Number(asset.average_cost) || 0),
        });
      } else {
        const ex = map.get(key);
        const shares = Number(asset.current_shares) || 0;
        ex._allIds.push(asset.id);
        ex.converted_amount = (ex.converted_amount || 0) + (asset.converted_amount || 0);
        ex.current_shares = (ex.current_shares || 0) + shares;
        ex._nativeCost = (ex._nativeCost || 0) + shares * (Number(asset.average_cost) || 0);
        if (ex.pnl !== null && asset.pnl !== null) {
          ex.pnl += asset.pnl;
          ex.converted_cost = (ex.converted_cost || 0) + (asset.converted_cost || 0);
          ex.pnl_pct = ex.converted_cost > 0 ? (ex.pnl / ex.converted_cost) * 100 : null;
        } else if (asset.pnl !== null) {
          ex.pnl = asset.pnl; ex.converted_cost = asset.converted_cost; ex.pnl_pct = asset.pnl_pct;
        }
        if (Number.isFinite(ex.day_pnl) && Number.isFinite(asset.day_pnl)) {
          ex.day_pnl += asset.day_pnl;
          const previousValue = ex.converted_amount - ex.day_pnl;
          ex.day_pnl_pct = previousValue !== 0 ? (ex.day_pnl / Math.abs(previousValue)) * 100 : null;
        } else if (Number.isFinite(asset.day_pnl)) {
          ex.day_pnl = asset.day_pnl;
          ex.day_pnl_pct = asset.day_pnl_pct;
        }
        ex.exclude_from_performance = Boolean(ex.exclude_from_performance) || Boolean(asset.exclude_from_performance);
      }
    }
    return Array.from(map.values()).map(asset => {
      if (asset.category !== 'investment' || !(Number(asset.current_shares) > 0)) return asset;
      return {
        ...asset,
        average_cost: Number(asset._nativeCost) > 0
          ? Number(asset._nativeCost) / Number(asset.current_shares)
          : Number(asset.average_cost) || 0,
      };
    });
  }, [assets]);

  const categoryTotals = useMemo(() => {
    const totals = {};
    for (const cat of [...ASSET_CATEGORIES, 'liability']) {
      const list = mergedAssets.filter(a => a.category === cat && !(cat === 'investment' && Number(a.current_shares || 0) <= 0));
      totals[cat] = { total: list.reduce((s, a) => s + a.converted_amount, 0), count: list.length };
    }
    return totals;
  }, [mergedAssets]);

  const tradePlanSummary = useMemo(() => {
    const holdings = mergedAssets.filter(asset => (
      asset.category === 'investment' && asset.symbol && Number(asset.current_shares) > 0
    ));
    const counts = { normal: 0, warning: 0, invalid: 0, unset: 0, missing: 0, pending: 0 };
    holdings.forEach(asset => {
      const state = tradePlanStatuses[getTradePlanKey(asset)]?.state || 'pending';
      counts[state] = (counts[state] || 0) + 1;
    });
    return { total: holdings.length, ...counts };
  }, [mergedAssets, tradePlanStatuses]);

  const filteredAssets = useMemo(() =>
    mergedAssets.filter(a =>
      !(a.category === 'investment' && Number(a.current_shares || 0) <= 0) &&
      (!selectedCategory || a.category === selectedCategory) &&
      (!selectedTradePlanState || (
        a.category === 'investment' &&
        tradePlanStatuses[getTradePlanKey(a)]?.state === selectedTradePlanState
      ))
    ),
  [mergedAssets, selectedCategory, selectedTradePlanState, tradePlanStatuses]);

  const sortedFilteredAssets = useMemo(() => {
    if (sortOrder === 'default') return filteredAssets;
    return [...filteredAssets].sort((a, b) => {
      if (sortOrder === 'desc') return (b.converted_amount || 0) - (a.converted_amount || 0);
      if (sortOrder === 'asc') return (a.converted_amount || 0) - (b.converted_amount || 0);

      if (sortOrder === 'pnl_desc' || sortOrder === 'pnl_asc') {
        const valA = typeof a.pnl_pct === 'number' && !isNaN(a.pnl_pct) ? a.pnl_pct : null;
        const valB = typeof b.pnl_pct === 'number' && !isNaN(b.pnl_pct) ? b.pnl_pct : null;

        if (valA === valB) return 0;
        if (valA === null) return 1; // nulls go to the bottom
        if (valB === null) return -1;

        return sortOrder === 'pnl_desc' ? valB - valA : valA - valB;
      }
      return 0;
    });
  }, [filteredAssets, sortOrder]);

  const donutData = useMemo(() => [
    { label: '投資資產', value: categoryTotals.investment?.total || 0, color: allocationColors.investment },
    { label: '流動資產', value: categoryTotals.liquid?.total     || 0, color: allocationColors.liquid },
    { label: '固定資產', value: categoryTotals.fixed?.total      || 0, color: allocationColors.fixed },
    { label: '其他資產', value: categoryTotals.receivable?.total || 0, color: allocationColors.receivable },
  ], [categoryTotals, allocationColors]);

  const totalAssets = useMemo(() =>
    ASSET_CATEGORIES.reduce((s, cat) => s + (categoryTotals[cat]?.total || 0), 0),
  [categoryTotals]);

  const monthlyChangePct = useMemo(() => {
    if (monthlyChange === null || netWorth === 0) return null;
    const prev = netWorth - monthlyChange;
    return prev === 0 ? null : (monthlyChange / Math.abs(prev)) * 100;
  }, [monthlyChange, netWorth]);

  const pnlMarketOptions = useMemo(() => {
    const available = [...new Set(mergedAssets
      .filter(asset => asset.category === 'investment' && Number(asset.current_shares || 0) > 0 && !asset.exclude_from_performance && asset.market_type)
      .map(asset => asset.market_type))];
    return ['ALL', ...['TW', 'US', 'Crypto', 'other'].filter(market => available.includes(market))];
  }, [mergedAssets]);

  useEffect(() => {
    if (!pnlMarketOptions.includes(selectedPnlMarket)) setSelectedPnlMarket('ALL');
  }, [pnlMarketOptions, selectedPnlMarket]);

  const fifoPnlByMarket = useMemo(() => {
    if (fifoTransactionFlows === null) return null;
    const context = buildCurrentFifoPerformanceContext(assets, fifoTransactionFlows);
    const summaries = {
      ALL: calculateTradePerformance(context, 'ALL', 'ALL'),
    };
    for (const market of context.markets) {
      summaries[market] = calculateTradePerformance(context, market, 'ALL');
    }
    return summaries;
  }, [assets, fifoTransactionFlows]);

  const investmentPnl = useMemo(() => {
    const investments = mergedAssets.filter(asset =>
      asset.category === 'investment' &&
      Number(asset.current_shares || 0) > 0 &&
      !asset.exclude_from_performance &&
      (selectedPnlMarket === 'ALL' || (asset.market_type || 'other') === selectedPnlMarket)
    );
    const dayAssets = investments
      .filter(asset => asset.day_pnl !== null && asset.day_pnl !== undefined)
      .map(asset => ({ ...asset, _dayPnl: Number(asset.day_pnl) }))
      .filter(asset => Number.isFinite(asset._dayPnl));
    const day = dayAssets.reduce((sum, asset) => sum + asset._dayPnl, 0);
    const dayPresentation = getDayPnlPresentation(dayAssets, selectedPnlMarket);
    const previousValue = dayAssets.reduce((sum, asset) => sum + Number(asset.converted_amount) - asset._dayPnl, 0);
    const marketKey = selectedPnlMarket === 'ALL' ? 'ALL' : normalizePerformanceMarket(selectedPnlMarket);
    const fifoSummary = fifoPnlByMarket?.[marketKey] || null;
    const cumulative = Number(fifoSummary?.unrealizedPnl) || 0;
    const cost = Number(fifoSummary?.openCost) || 0;
    return {
      day,
      dayLabel: dayPresentation.label,
      dayQuoteDateLabel: dayPresentation.quoteDateLabel,
      isPreviousSession: dayPresentation.isPreviousSession,
      dayPct: previousValue !== 0 ? (day / Math.abs(previousValue)) * 100 : null,
      hasDay: dayAssets.length > 0,
      cumulative,
      cumulativePct: cost > 0 ? (cumulative / cost) * 100 : null,
      hasCumulative: cost > 0,
      count: investments.length,
    };
  }, [mergedAssets, selectedPnlMarket, fifoPnlByMarket]);

  const pnlScopeAssets = useMemo(() => {
    const marketOrder = { TW: 0, US: 1, Crypto: 2, other: 3 };
    return mergedAssets
      .filter(asset => asset.category === 'investment' && Number(asset.current_shares || 0) > 0)
      .sort((a, b) => {
        const marketDiff = (marketOrder[a.market_type || 'other'] ?? 9) - (marketOrder[b.market_type || 'other'] ?? 9);
        if (marketDiff !== 0) return marketDiff;
        return String(a.symbol || a.name || '').localeCompare(String(b.symbol || b.name || ''), 'zh-TW');
      });
  }, [mergedAssets]);

  const excludedPnlCount = useMemo(
    () => pnlScopeAssets.filter(asset => asset.exclude_from_performance).length,
    [pnlScopeAssets]
  );

  const liquidSparkline = useMemo(() => (categorySnapshots || [])
    .filter(row => row?.category === 'liquid' && row?.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(row => Number(row.value))
    .filter(Number.isFinite), [categorySnapshots]);
  const investmentSparkline = useMemo(() => {
    const totalsByDate = new Map();
    for (const row of categorySnapshots || []) {
      if (!row?.date || !['TW', 'US', 'Crypto'].includes(row.category)) continue;
      const value = Number(row.value);
      if (!Number.isFinite(value)) continue;
      totalsByDate.set(row.date, (totalsByDate.get(row.date) || 0) + value);
    }
    return [...totalsByDate.entries()]
      .sort(([first], [second]) => String(first).localeCompare(String(second)))
      .map(([, value]) => value);
  }, [categorySnapshots]);

  // ── focus effect ─────────────────────────────────────────────────────────
  // Bypass the 60s debounce if another screen (AssetDetail, Settings) flagged
  // that data-changing work was done (transaction added, currency switched).
  useFocusEffect(useCallback(() => {
    (async () => {
      const watchlistRaw = await AsyncStorage.getItem('watchlist').catch(() => null);
      try {
        const savedWatchlist = JSON.parse(watchlistRaw || '[]');
        if (watchlistRaw !== null) {
          setHasWatchlist(Array.isArray(savedWatchlist) && savedWatchlist.length > 0);
        } else {
          const { data: { user } } = await supabase.auth.getUser();
          const { data: cloudWatchlist } = user
            ? await supabase.from('watchlist').select('id').eq('user_id', user.id).limit(1)
            : { data: [] };
          setHasWatchlist((cloudWatchlist || []).length > 0);
        }
      } catch { setHasWatchlist(false); }
      const needsRefresh = await AsyncStorage.getItem('@wt_needs_refresh');
      if (needsRefresh === '1') {
        await AsyncStorage.removeItem('@wt_needs_refresh');
        lastLoadedRef.current = 0;
      }
      if (Date.now() - lastLoadedRef.current < 60000) return;
      loadData();
    })();
  }, []));

  // ── helper: save category snapshots ──────────────────────────────────────
  const saveCategorySnapshots = async (assetsToSnapshot, uid, date, currentNW) => {
    try {
      const lastSnapNWStr = await AsyncStorage.getItem('lastCategorySnapshotNW');
      const lastSnapNW = lastSnapNWStr ? parseFloat(lastSnapNWStr) : 0;

      // Only update if NW has changed by more than 0.1%
      const diff = Math.abs(currentNW - lastSnapNW);
      const threshold = lastSnapNW === 0 ? 0 : Math.abs(lastSnapNW) * 0.001;
      if (diff <= threshold) return;

      const totals = groupSnapshotTotals(assetsToSnapshot);
      const rows = Object.entries(totals).map(([category, value]) => ({ user_id: uid, date, category, value }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('category_snapshots')
          .upsert(rows, { onConflict: 'user_id,date,category' });
        if (error) throw error;
        await AsyncStorage.setItem('lastCategorySnapshotNW', currentNW.toString());
      }
    } catch (e) {
      console.log('category snapshot write error:', e);
    }
  };

  // ── live prices ──────────────────────────────────────────────────────────
  const refreshLivePrices = async (assetsData, baseCurrency, ratesMap = null, userId = null) => {
    const inv = (assetsData || []).filter(a => a.symbol && a.category === 'investment' && a.current_shares > 0);
    if (inv.length === 0) return assetsData;
    const priceMap = await fetchLiveAssetPrices(inv);

    const updates = await Promise.allSettled(
      inv.map(async (asset) => {
        const pd = getLiveQuote(priceMap, asset);
        if (!pd?.price) return null;
        const [valued] = await valueAssets([asset], baseCurrency, { ratesMap, livePrices: priceMap });
        const newAmount = valued.current_amount;
        return {
          id: asset.id,
          ...valued,
          _amountChanged: Math.abs(newAmount - (asset.current_amount || 0)) >= 0.001,
        };
      })
    );
    const priced = updates.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
    if (priced.length === 0) return assetsData;
    const changed = priced.filter(item => item._amountChanged);
    const now = new Date().toISOString();
    if (userId && changed.length > 0) {
      const persisted = await Promise.all(changed.map(({ id, current_amount }) =>
        supabase
          .from('assets')
          .update({ current_amount, updated_at: now })
          .eq('id', id)
          .eq('user_id', userId)
      ));
      const updateError = persisted.find(result => result.error)?.error;
      if (updateError) throw updateError;
    }
    const map = Object.fromEntries(priced.map(({ _amountChanged, ...item }) => [item.id, item]));

    const next = assetsData.map(a => map[a.id] ? { ...a, ...map[a.id] } : a);
    const { netWorth: liveNW } = calculatePortfolioTotals(next);

    setAssets(next);
    setNetWorth(liveNW);

    if (userId) {
      const today = getTaipeiDateString();
      // Upsert today's snapshot with the accurate live net worth
      const { error: snapshotError } = await supabase.from('daily_snapshots')
        .upsert({ user_id: userId, snapshot_date: today, net_worth_base: liveNW },
                { onConflict: 'user_id,snapshot_date' });
      if (snapshotError) console.warn('live snapshot upsert:', snapshotError.message);

      // Immediately trigger category snapshot if prices changed
      saveCategorySnapshots(next, userId, today, liveNW).catch(e => console.warn('live category snapshot error:', e));
    }
    return next;
  };

  const refreshTradePlanStatuses = async (assetsData) => {
    const requestId = ++tradePlanRequestRef.current;
    const holdings = aggregateInvestmentAssets(assetsData);
    if (!holdings.length) {
      setTradePlanStatuses({});
      setTradePlanLoading(false);
      return;
    }

    setTradePlanLoading(true);
    try {
      const [settings, activeStops] = await Promise.all([
        loadTradePlanSettings(),
        loadActiveTradePlanStops(),
      ]);
      if (requestId !== tradePlanRequestRef.current) return;

      if (!settings.saved) {
        setTradePlanStatuses(Object.fromEntries(holdings.map(asset => [
          getTradePlanKey(asset),
          { state: 'unset', label: '未設定' },
        ])));
        return;
      }

      const stopMap = new Map((activeStops || []).map(stop => [
        getTradePlanKey({ symbol: stop.symbol, market_type: stop.market_type }),
        stop,
      ]));
      const results = await runWithConcurrency(holdings, 3, async asset => {
        const savedStop = stopMap.get(getTradePlanKey(asset));
        const context = await fetchMarketTechnicalContext(
          asset.symbol,
          asset.market_type,
          1095,
          false,
          true,
        );
        const rows = Array.isArray(context?.rows) ? context.rows : [];
        if (rows.length < 60) throw new Error('歷史資料不足');
        const analysis = analyzeTechnicalData(rows, Math.min(130, rows.length), context);
        const currentPrice = Number(context?.quote?.price)
          || Number(asset.live_price)
          || Number(analysis?.latest?.close);
        const calculation = calculateTradePlan({
          entryPrice: Number(asset.average_cost),
          savedEntryPrice: savedStop?.entry_price,
          atr: analysis?.latest?.atr14 || analysis?.atr,
          positionSize: Number(asset.current_shares),
          currentPrice,
          isIntraday: Boolean(context?.isIntraday),
          analysis,
          effectiveStop: savedStop?.last_effective_stop,
          effectiveStopSource: savedStop?.last_stop_source,
          initialStop: savedStop?.initial_stop_price,
          initialRiskPerShare: savedStop?.initial_risk_per_share,
          highestPriceSinceEntry: savedStop?.highest_price_since_entry,
          effectiveStopEvaluatedAt: savedStop?.last_evaluated_at,
          confirmedInvalidAt: savedStop?.invalidated_at,
          confirmedInvalidPrice: savedStop?.invalidation_price,
          confirmedInvalidSessionDate: savedStop?.invalidation_session_date,
          marketType: asset.market_type,
          atrMultiplier: settings.atr_multiplier,
        });
        if (!calculation.valid || !(Number(calculation.stopPrice) > 0) || !(currentPrice > 0)) {
          throw new Error(calculation.errors?.[0] || '交易計畫資料不足');
        }
        const displayStatus = getTradePlanDisplayStatus(calculation);
        const referenceStopPrice = calculation.confirmedInvalid
          ? Number(calculation.invalidationStopPrice || calculation.stopPrice)
          : Number(calculation.stopPrice);
        const distancePct = (currentPrice - referenceStopPrice) / referenceStopPrice * 100;
        const intradayStopStatus = displayStatus.state === 'warning'
          && Boolean(context?.isIntraday)
          && currentPrice <= referenceStopPrice
          ? currentPrice < referenceStopPrice ? '盤中跌破停損' : '盤中觸及停損'
          : null;
        const shouldPersist = calculation.rebaseRequired
          || !savedStop
          || Number(calculation.stopPrice) > Number(savedStop.last_effective_stop || 0) + 1e-8
          || savedStop.last_stop_source !== calculation.stopSource
          || !(Number(savedStop.initial_stop_price) > 0)
          || !(Number(savedStop.initial_risk_per_share) > 0)
          || (calculation.confirmedInvalid && !savedStop.invalidated_at);
        return {
          key: getTradePlanKey(asset),
          state: displayStatus.state,
          label: displayStatus.label,
          stopPrice: calculation.stopPrice,
          referenceStopPrice,
          currentPrice,
          distancePct,
          intradayStopStatus,
          rewardMultiple: calculation.rewardMultiple,
          recoveredAfterInvalidation: calculation.recoveredAfterInvalidation,
          persist: shouldPersist ? {
            symbol: asset.symbol,
            marketType: asset.market_type,
            entryPrice: calculation.entryPrice,
            effectiveStop: calculation.stopPrice,
            initialStop: calculation.initialStopPrice,
            initialRiskPerShare: calculation.initialRiskPerShare,
            highestPriceSinceEntry: calculation.highestPriceSinceEntry,
            stopSource: calculation.stopSource,
            rebaseExisting: Boolean(calculation.rebaseRequired),
            invalidatedAt: calculation.invalidatedAt,
            invalidationPrice: calculation.invalidationPrice,
            invalidationSessionDate: calculation.invalidationSessionDate,
          } : null,
        };
      });
      if (requestId !== tradePlanRequestRef.current) return;
      const plansToPersist = results
        .filter(result => !result?.error && result?.persist)
        .map(result => result.persist);
      if (plansToPersist.length) {
        try {
          await saveTradePlanStops(plansToPersist);
        } catch (saveError) {
          console.warn('Trade plan overview save error:', saveError?.message || saveError);
        }
      }
      if (requestId !== tradePlanRequestRef.current) return;
      const nextStatuses = {};
      results.forEach((result, index) => {
        const key = getTradePlanKey(holdings[index]);
        nextStatuses[key] = result?.error
          ? { state: 'missing', label: '資料不足' }
          : result;
      });
      setTradePlanStatuses(nextStatuses);
    } catch (error) {
      if (requestId === tradePlanRequestRef.current) {
        console.warn('Trade plan overview load error:', error?.message || error);
        setTradePlanStatuses(Object.fromEntries(holdings.map(asset => [
          getTradePlanKey(asset),
          { state: 'missing', label: '資料不足' },
        ])));
      }
    } finally {
      if (requestId === tradePlanRequestRef.current) setTradePlanLoading(false);
    }
  };

  // ── load data ────────────────────────────────────────────────────────────
  const loadData = async () => {
    try {
      setFifoTransactionFlows(null);
      setPositionCostNotice(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData, error: profileError } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();
      if (profileError) throw profileError;
      setProfile(profileData);

      const { data: assetsData, error } = await supabase
        .from('assets').select('*').eq('user_id', user.id).order('category', { ascending: true });
      if (error) throw error;

      const baseCurrency     = profileData?.base_currency || 'TWD';
      const uniqueCurrencies = [...new Set(assetsData.map(a => getAssetCurrency(a, baseCurrency)).filter(Boolean))];
      const activePerformanceIdentities = new Set(assetsData
        .filter(asset => asset.category === 'investment' && Number(asset.current_shares) > 0)
        .map(getInvestmentPerformanceIdentity));
      const investmentAssetIds = assetsData
        .filter(asset => asset.category === 'investment' && activePerformanceIdentities.has(getInvestmentPerformanceIdentity(asset)))
        .map(asset => asset.id)
        .filter(Boolean);
      setPositionCostNotice(investmentAssetIds.length > 0 ? '正在核對交易紀錄…' : null);
      const transactionsPromise = investmentAssetIds.length > 0
        ? fetchInvestmentTransactions(user.id, investmentAssetIds).catch(error => {
            console.warn('FIFO cost-basis load error; using saved average cost:', error?.message || error);
            return null;
          })
        : Promise.resolve([]);
      const [ratesMap, positionTransactions] = await Promise.all([
        fetchExchangeRatesBatch(uniqueCurrencies, baseCurrency),
        transactionsPromise,
      ]);

      let loadedFifoTransactionFlows = null;
      if (positionTransactions) {
        try {
          const flowResult = await buildInvestmentTransactionFlows({
            transactions: positionTransactions,
            baseCurrency,
            rates: ratesMap,
            respectAssetExclusion: false,
          });
          loadedFifoTransactionFlows = flowResult.transactionFlows;
        } catch (flowError) {
          console.warn('FIFO P&L transaction conversion error:', flowError?.message || flowError);
          setFifoTransactionFlows(null);
          setPositionCostNotice('FIFO 損益換算失敗；本次累積損益暫不顯示，請重新整理。');
        }
      }

      const assetsWithFifoCosts = positionTransactions
        ? applyCompleteFifoPositionCosts(assetsData, positionTransactions)
        : assetsData;
      let fifoPositionFallbackCount = 0;
      if (!positionTransactions && investmentAssetIds.length > 0) {
        setFifoTransactionFlows(null);
        setPositionCostNotice('交易紀錄載入失敗；本次 FIFO 累積損益暫不顯示，請重新整理。');
      } else {
        fifoPositionFallbackCount = assetsWithFifoCosts.filter(asset =>
          asset.category === 'investment' &&
          Number(asset.current_shares) > 0 &&
          asset.position_cost_source !== 'fifo'
        ).length;
      }
      const converted = await valueAssets(assetsWithFifoCosts, baseCurrency, { ratesMap });
      setAssets(converted);
      const finalAssets = await refreshLivePrices(converted, baseCurrency, ratesMap, user.id);
      setAssets(finalAssets);
      if (loadedFifoTransactionFlows !== null) {
        const fifoContext = buildCurrentFifoPerformanceContext(finalAssets, loadedFifoTransactionFlows);
        const fifoSummary = calculateTradePerformance(fifoContext, 'ALL', 'ALL');
        setFifoTransactionFlows(loadedFifoTransactionFlows);
        const notices = [];
        if (fifoPositionFallbackCount > 0) {
          notices.push(`${fifoPositionFallbackCount} 檔持倉與交易股數未完全核對，損益只計入可配對的 FIFO 批次`);
        }
        if (fifoSummary.ignoredIncompleteSymbols?.length > 0) {
          notices.push(`${fifoSummary.ignoredIncompleteSymbols.length} 檔缺少可配對買入紀錄，已排除於損益`);
        }
        setPositionCostNotice(notices.length
          ? `${notices.join('；')}；未納入損益的持倉市值仍計入淨資產。`
          : null);
      }
      refreshTradePlanStatuses(finalAssets).catch(error => {
        console.warn('Trade plan overview refresh error:', error?.message || error);
      });

      const { netWorth: currentNetWorth } = calculatePortfolioTotals(finalAssets);
      setNetWorth(currentNetWorth);
      setLastUpdated(new Date());

      try {
        await AsyncStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({ assets: finalAssets, netWorth: currentNetWorth, lastUpdated: Date.now() }));
      } catch (e) { console.log('dashboard cache write error:', e); }

      // Keep the dashboard definition identical to the monthly chart:
      // current value minus the last value recorded before this month began.
      const monthStart = getTaipeiMonthStart();
      const { data: previousMonthSnap } = await supabase
        .from('daily_snapshots').select('net_worth_base')
        .eq('user_id', user.id)
        .lt('snapshot_date', monthStart)
        .order('snapshot_date', { ascending: false }).limit(1).maybeSingle();
      if (previousMonthSnap) {
        setMonthlyChange(currentNetWorth - parseFloat(previousMonthSnap.net_worth_base));
      } else {
        // A newly created portfolio has no prior month-end yet. Show a
        // best-effort in-month change until its first full month is available.
        const { data: firstMonthSnap } = await supabase
          .from('daily_snapshots').select('net_worth_base')
          .eq('user_id', user.id)
          .gte('snapshot_date', monthStart)
          .order('snapshot_date', { ascending: true }).limit(1).maybeSingle();
        setMonthlyChange(firstMonthSnap
          ? currentNetWorth - parseFloat(firstMonthSnap.net_worth_base)
          : null);
      }

      // Fallback snapshot upsert
      {
        const today = getTaipeiDateString();
        try {
          const { error: snapshotError } = await supabase.from('daily_snapshots')
            .upsert({ user_id: user.id, snapshot_date: today, net_worth_base: currentNetWorth },
                    { onConflict: 'user_id,snapshot_date' });
          if (snapshotError) throw snapshotError;
        } catch (e) { console.warn('fallback snapshot upsert:', e?.message); }
      }

      // Category snapshots write — gated by change detection
      try {
        const today = getTaipeiDateString();
        await saveCategorySnapshots(finalAssets, user.id, today, currentNetWorth);
      } catch (e) {
        if (e?.message !== 'already_written') console.log('category snapshot write error:', e);
      }

      // Category snapshots read (sparklines)
      try {
        const ago = new Date(); ago.setDate(ago.getDate() - 30);
        const { data: snapData } = await supabase
          .from('category_snapshots').select('date, category, value')
          .eq('user_id', user.id).gte('date', ago.toISOString().split('T')[0])
          .order('date', { ascending: true });
        setCategorySnapshots(snapData || []);
      } catch (e) { console.log('category snapshots read error:', e); }

      setLoadError(null); // clear any previous error on success
      lastLoadedRef.current = Date.now();
    } catch (error) {
      console.error('Error loading data:', error);
      setLoadError(error?.message || '載入失敗，請檢查網路連線');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setIsRefreshing(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (lastLoadedRef?.current) lastLoadedRef.current = 0;
    await loadData();
    setRefreshing(false);
  }, []);

  const togglePnlExclusion = async (asset) => {
    const nextExcluded = !asset.exclude_from_performance;
    const assetIds = asset._allIds?.length ? asset._allIds : [asset.id];
    setSavingPnlAssetId(asset.id);
    try {
      await setAssetPerformanceExclusion(assetIds, nextExcluded);
      setAssets(currentAssets => {
        const idSet = new Set(assetIds);
        const nextAssets = currentAssets.map(item => (
          idSet.has(item.id)
            ? { ...item, exclude_from_performance: nextExcluded }
            : item
        ));
        AsyncStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
          assets: nextAssets,
          netWorth,
          lastUpdated: Date.now(),
        })).catch(error => console.warn('dashboard exclusion cache write:', error?.message || error));
        return nextAssets;
      });
      await AsyncStorage.setItem('@wt_needs_refresh', '1');
    } catch (error) {
      Alert.alert('無法更新計算範圍', error?.message || '請稍後再試');
    } finally {
      setSavingPnlAssetId(null);
    }
  };

  const currency = profile?.base_currency || 'TWD';
  const fmt  = (v) => formatAmount(v);
  const mask = (v) => hidden ? '****' : fmt(v);

  if (loading) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top, backgroundColor: C.bg }]}>
        <ActivityIndicator size="large" color={primary} />
      </View>
    );
  }

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 160 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={primary}
            colors={[primary]}
            progressViewOffset={insets.top + 8}
          />
        }
      >

        {/* ── NETWORK ERROR BANNER ─────────────────────────────────────── */}
        {loadError && (
          <View style={{
            marginHorizontal: 16, marginBottom: 12,
            backgroundColor: 'rgba(240,48,48,0.10)',
            borderRadius: 14, borderLeftWidth: 3, borderLeftColor: '#F03030',
            padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10,
          }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#F03030', fontSize: 13, fontWeight: '700', marginBottom: 2 }}>
                載入失敗
              </Text>
              <Text style={{ color: C.textSub, fontSize: 12 }} numberOfLines={2}>
                {loadError}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => { setLoadError(null); onRefresh(); }}
              style={{
                backgroundColor: '#F03030', borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 7,
              }}
              activeOpacity={0.8}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>重試</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── HERO ──────────────────────────────────────────────────────── */}
        <View style={[styles.hero]}>
          <View style={styles.heroHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.heroLabel, { color: C.textSub }]}>淨資產總覽（{currency}）</Text>
              <TouchableOpacity onPress={() => setHidden(h => !h)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                {hidden
                  ? <EyeOff size={16} color={C.textSub} />
                  : <Eye    size={16} color={C.textSub} />
                }
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.addBtn, { backgroundColor: primary }]}
              onPress={() => navigation.navigate('AddAsset')}
              activeOpacity={0.85}
            >
              <Plus size={21} color="#0B1F3A" strokeWidth={2.7} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.heroAmount, { color: netWorth < 0 ? RED : C.text }]}>
            {mask(netWorth)}
          </Text>

          {monthlyChange !== null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <Text style={[styles.heroChange, { color: monthlyChange >= 0 ? GREEN : RED }]}>
                {monthlyChange >= 0 ? '▲' : '▼'}{' '}
                {hidden ? '****' : fmt(Math.abs(monthlyChange))}
                {monthlyChangePct !== null
                  ? ` (${monthlyChange >= 0 ? '' : '-'}${Math.abs(monthlyChangePct).toFixed(2)}%)`
                  : ''}
              </Text>
              <Text style={[styles.heroChangeSub, { color: C.textMuted }]}>本月</Text>
            </View>
          )}
        </View>

        {/* ── INVESTMENT PNL ───────────────────────────────────────────── */}
        <View style={[styles.sectionCard, { backgroundColor: C.card, marginHorizontal: 16, marginBottom: 12 }]}>
          <View style={styles.pnlHeader}>
            <View>
              <Text style={[styles.sectionTitle, { color: C.text, marginBottom: 3 }]}>投資損益</Text>
              <Text style={[styles.pnlSubtitle, { color: C.textMuted }]}>目前報價 · 換算 {currency}</Text>
            </View>
            <TouchableOpacity
              style={[styles.pnlScopeButton, { backgroundColor: C.cardAlt, borderColor: C.border }]}
              onPress={() => setPnlScopeVisible(true)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`設定投資損益計算範圍，目前排除 ${excludedPnlCount} 項`}
            >
              <SlidersHorizontal size={13} color={primary} />
              <Text style={[styles.pnlScopeButtonText, { color: excludedPnlCount > 0 ? primary : C.textSub }]}>
                {investmentPnl.count} 檔{excludedPnlCount > 0 ? ` · 排除 ${excludedPnlCount}` : ''}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pnlMarketRow}>
            {pnlMarketOptions.map(market => {
              const selected = selectedPnlMarket === market;
              const label = market === 'ALL' ? '全部' : MARKET_TYPE_CONFIG[market]?.label || market;
              return (
                <TouchableOpacity
                  key={market}
                  style={[styles.pnlMarketChip, { backgroundColor: selected ? primary : C.card, borderColor: selected ? primary : C.border }]}
                  onPress={() => setSelectedPnlMarket(market)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.pnlMarketText, { color: selected ? colors.accentContrast : C.textSub }]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={[styles.pnlMetrics, { borderTopColor: C.border }]}>
            <View style={styles.pnlMetric}>
              <Text style={[styles.pnlMetricLabel, { color: C.textSub }]}>{investmentPnl.dayLabel}</Text>
              <Text style={[styles.pnlMetricValue, { color: investmentPnl.day >= 0 ? colors.positive : colors.negative }]} numberOfLines={1} adjustsFontSizeToFit>
                {hidden ? '****' : investmentPnl.hasDay ? `${investmentPnl.day >= 0 ? '+' : ''}${fmt(investmentPnl.day)}` : '—'}
              </Text>
              <Text style={[styles.pnlMetricPct, { color: investmentPnl.day >= 0 ? colors.positive : colors.negative }]}>
                {investmentPnl.hasDay && investmentPnl.dayPct !== null ? `${investmentPnl.dayPct >= 0 ? '+' : ''}${investmentPnl.dayPct.toFixed(2)}%` : '尚無單日報價'}
              </Text>
            </View>
            <View style={[styles.pnlMetricDivider, { backgroundColor: C.border }]} />
            <View style={styles.pnlMetric}>
              <Text style={[styles.pnlMetricLabel, { color: C.textSub }]}>累積未實現損益</Text>
              <Text style={[styles.pnlMetricValue, { color: investmentPnl.cumulative >= 0 ? colors.positive : colors.negative }]} numberOfLines={1} adjustsFontSizeToFit>
                {hidden ? '****' : investmentPnl.hasCumulative ? `${investmentPnl.cumulative >= 0 ? '+' : ''}${fmt(investmentPnl.cumulative)}` : '—'}
              </Text>
              <Text style={[styles.pnlMetricPct, { color: investmentPnl.cumulative >= 0 ? colors.positive : colors.negative }]}>
                {investmentPnl.hasCumulative && investmentPnl.cumulativePct !== null
                  ? `${investmentPnl.cumulativePct >= 0 ? '+' : ''}${investmentPnl.cumulativePct.toFixed(2)}%`
                  : fifoTransactionFlows === null ? 'FIFO 計算中' : '尚無可用 FIFO 買入批次'}
              </Text>
            </View>
          </View>
          <Text style={[styles.pnlFootnote, { color: C.textMuted }]}>單日損益依目前報價估算；累積未實現損益改採與「股票交易報酬」相同的 FIFO 買入批次、費用與匯率計算，不含已實現損益。缺少買入紀錄或無法配對的批次不列入損益，但持倉市值仍計入淨資產。</Text>
          {positionCostNotice && (
            <Text style={[styles.pnlFootnote, { color: colors.warning, marginTop: 4 }]}>
              {positionCostNotice}
            </Text>
          )}
        </View>

        {/* ── ALLOCATION CARD ───────────────────────────────────────────── */}
        <View style={[styles.sectionCard, { backgroundColor: C.card, marginHorizontal: 16, marginBottom: 12 }]}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>資產配置</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ marginRight: 20 }}>
              <DonutChart data={donutData} size={112} strokeWidth={20} bgColor={C.donutBg} />
            </View>
            <View style={{ flex: 1, gap: 10 }}>
              {donutData.map((item) => {
                const pct      = totalAssets > 0 ? (item.value / totalAssets * 100).toFixed(1) : '0.0';
                const catKey   = Object.keys(CATEGORY_CONFIG).find(k => CATEGORY_CONFIG[k].label === item.label);
                const isActive = catKey && selectedCategory === catKey;
                return (
                  <TouchableOpacity
                    key={item.label}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                    onPress={() => catKey && setSelectedCategory(isActive ? null : catKey)}
                    activeOpacity={0.65}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  >
                    <View style={{
                      width: 9, height: 9, borderRadius: 5, backgroundColor: item.color,
                      ...(isActive ? { width: 12, height: 12, borderRadius: 6 } : {}),
                    }} />
                    <Text style={[styles.legendLabel, { color: isActive ? item.color : C.textSub, flex: 1, fontWeight: isActive ? '700' : '400' }]}>
                      {item.label}
                    </Text>
                    <Text style={[styles.legendPct, { color: isActive ? item.color : C.text }]}>{pct}%</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* ── CONCENTRATION ALERTS ─────────────────────────────────────── */}
        {(() => {
          if (!netWorth || netWorth <= 0) return null;
          const overweight = mergedAssets.filter(a =>
            a.category !== 'liability' &&
            (a.converted_amount || 0) / netWorth > CONCENTRATION_THRESHOLD
          );
          if (overweight.length === 0) return null;
          return (
            <View style={{ marginHorizontal: 16, marginBottom: 10 }}>
              {overweight.map(a => {
                const pct = ((a.converted_amount / netWorth) * 100).toFixed(1);
                return (
                  <View key={getAssetRenderKey(a)} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 8,
                    backgroundColor: C.card,
                    borderLeftWidth: 3, borderLeftColor: primary,
                    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
                    marginBottom: 6,
                  }}>
                    <Text style={{ fontSize: 14 }}>⚠️</Text>
                    <Text style={{ fontSize: 13, color: C.text, flex: 1 }}>
                      <Text style={{ fontWeight: '700', color: primary }}>{a.name}</Text>
                      {` 佔總資產 ${pct}%，集中度偏高`}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })()}

        {/* ── 2-COL: LIQUID + INVESTMENT ────────────────────────────────── */}
        <View style={[styles.twoColRow, { marginHorizontal: 16, marginBottom: 10 }]}>

          {/* Liquid */}
          <TouchableOpacity
            style={[
              styles.sparkCard,
              { backgroundColor: C.card, width: cardWidth },
              selectedCategory === 'liquid' && { borderWidth: 1.5, borderColor: allocationColors.liquid },
            ]}
            onPress={() => setSelectedCategory(selectedCategory === 'liquid' ? null : 'liquid')}
            activeOpacity={0.7}
          >
            <Text style={[styles.sparkCardLabel, { color: allocationColors.liquid }]}>流動資產</Text>
            <Text style={[styles.sparkCardAmount, { color: C.text }]} numberOfLines={1}>
              {mask(categoryTotals.liquid?.total || 0)}
            </Text>
            {monthlyChange !== null ? (
              <Text style={[styles.sparkCardChange, { color: monthlyChange >= 0 ? GREEN : RED }]}>
                {monthlyChange >= 0 ? '▲' : '▼'}{' '}
                {monthlyChangePct !== null ? `${Math.abs(monthlyChangePct).toFixed(2)}%` : '--'}
              </Text>
            ) : (
              <Text style={[styles.sparkCardChange, { color: C.textMuted }]}>— --</Text>
            )}
            <View style={{ marginTop: 10, overflow: 'hidden' }}>
              <Sparkline data={liquidSparkline} width={cardWidth - 28} height={40} color={allocationColors.liquid} />
            </View>
          </TouchableOpacity>

          {/* Investment */}
          <TouchableOpacity
            style={[
              styles.sparkCard,
              { backgroundColor: C.card, width: cardWidth },
              selectedCategory === 'investment' && { borderWidth: 1.5, borderColor: primary },
            ]}
            onPress={() => setSelectedCategory(selectedCategory === 'investment' ? null : 'investment')}
            activeOpacity={0.7}
          >
            <Text style={[styles.sparkCardLabel, { color: primary }]}>投資資產</Text>
            <Text style={[styles.sparkCardAmount, { color: C.text }]} numberOfLines={1}>
              {mask(categoryTotals.investment?.total || 0)}
            </Text>
            {(() => {
              const invList = mergedAssets.filter(a => a.category === 'investment' && a.pnl !== null);
              const invPnl  = invList.reduce((s, a) => s + a.pnl, 0);
              const invCost = invList.filter(a => a.converted_cost != null).reduce((s, a) => s + a.converted_cost, 0);
              const invPct  = invCost > 0 ? (invPnl / invCost * 100) : null;
              const col     = invPnl >= 0 ? GREEN : RED;
              return (
                <Text style={[styles.sparkCardChange, { color: col }]}>
                  {invPnl !== 0 ? (invPnl >= 0 ? '▲' : '▼') : '—'}{' '}
                  {invPct !== null ? `${Math.abs(invPct).toFixed(2)}%` : '--'}
                </Text>
              );
            })()}
            <View style={{ marginTop: 10, overflow: 'hidden' }}>
              <Sparkline data={investmentSparkline} width={cardWidth - 28} height={40} color={primary} />
            </View>
          </TouchableOpacity>
        </View>

        {/* ── 2-COL: FIXED + RECEIVABLE ─────────────────────────────────── */}
        <View style={[styles.twoColRow, { marginHorizontal: 16, marginBottom: 10 }]}>

          <TouchableOpacity
            style={[
              styles.simpleCard,
              { backgroundColor: C.card, width: cardWidth },
              selectedCategory === 'fixed' && { borderWidth: 1.5, borderColor: '#94a3b8' },
            ]}
            onPress={() => setSelectedCategory(selectedCategory === 'fixed' ? null : 'fixed')}
            activeOpacity={0.7}
          >
            <Text style={[styles.simpleCardLabel, { color: C.textSub }]}>固定資產</Text>
            <Text style={[styles.simpleCardAmount, { color: C.text }]} numberOfLines={1}>
              {mask(categoryTotals.fixed?.total || 0)}
            </Text>
            <Text style={[styles.simpleCardChange, { color: C.textMuted }]}>— 0%</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.simpleCard,
              { backgroundColor: C.card, width: cardWidth },
              selectedCategory === 'receivable' && { borderWidth: 1.5, borderColor: '#0d9488' },
            ]}
            onPress={() => setSelectedCategory(selectedCategory === 'receivable' ? null : 'receivable')}
            activeOpacity={0.7}
          >
            <Text style={[styles.simpleCardLabel, { color: C.textSub }]}>應收款項</Text>
            <Text style={[styles.simpleCardAmount, { color: C.text }]} numberOfLines={1}>
              {mask(categoryTotals.receivable?.total || 0)}
            </Text>
            <Text style={[styles.simpleCardChange, { color: C.textMuted }]}>— 0%</Text>
          </TouchableOpacity>
        </View>

        {/* ── LIABILITY ─────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.liabilityCard, { backgroundColor: C.card, marginHorizontal: 16, marginBottom: 10 }]}
          onPress={() => setSelectedCategory(selectedCategory === 'liability' ? null : 'liability')}
          activeOpacity={0.75}
        >
          <View style={[styles.liabIconCircle, { backgroundColor: isDark ? 'rgba(240,48,48,0.15)' : '#fee2e2' }]}>
            <CreditCard size={20} color={RED} />
          </View>
          <Text style={[styles.liabLabel, { color: C.text }]}>負債總額</Text>
          <View style={{ flex: 1 }} />
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.liabAmount, { color: (categoryTotals.liability?.total || 0) > 0 ? RED : C.textSub }]}>
              {mask(categoryTotals.liability?.total || 0)}
            </Text>
            <Text style={[styles.liabChange, { color: RED }]}>▼ 0%</Text>
          </View>
        </TouchableOpacity>

        {/* ── FILTER BAR ────────────────────────────────────────────────── */}
        <View style={[styles.filterBar, { backgroundColor: C.card }]}>
          {(selectedCategory || selectedTradePlanState) ? (
            <>
              <Text style={[styles.filterText, { color: C.textSub }]} numberOfLines={1}>
                篩選：{[
                  selectedCategory ? CATEGORY_CONFIG[selectedCategory]?.label : null,
                  selectedTradePlanState ? ({
                    normal: '正常', warning: '警戒', invalid: '失效', unset: '未設定', missing: '資料不足',
                  })[selectedTradePlanState] : null,
                ].filter(Boolean).join(' · ')}
              </Text>
              <TouchableOpacity onPress={() => { setSelectedCategory(null); setSelectedTradePlanState(null); }} style={styles.clearBtn}>
                <Text style={[styles.clearText, { color: primary }]}>清除</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <View style={{ flex: 1 }} />
          <RefreshCw size={12} color={C.textMuted} />
          <Text style={[styles.filterCount, { color: C.textMuted }]}> {sortedFilteredAssets.length} 項</Text>
          <TouchableOpacity onPress={cycleSortOrder} style={styles.sortBtn} activeOpacity={0.7}>
            <Text style={[styles.sortText, { color: sortOrder !== 'default' ? primary : C.textMuted }]}>
              {sortOrder === 'default' ? '排序' : sortOrder === 'desc' ? '金額↓' : sortOrder === 'asc' ? '金額↑' : sortOrder === 'pnl_desc' ? '損益↓' : '損益↑'}
            </Text>
          </TouchableOpacity>


        </View>

        {/* update time */}
        <View style={styles.updateRow}>
          {lastUpdated && (
            <Text style={[styles.updateTime, { color: C.textMuted }]}>
              報價更新：{lastUpdated.toLocaleTimeString('zh-TW')}
            </Text>
          )}
          {isRefreshing && (
            <>
              <ActivityIndicator size="small" color={primary} />
              <Text style={[styles.refreshingText, { color: C.textMuted }]}>更新中</Text>
            </>
          )}
        </View>

        {(hasWatchlist || mergedAssets.some(asset => asset.category === 'investment' && asset.symbol && asset.current_shares > 0)) && (
          <TouchableOpacity style={[styles.holdingSignalsButton, { backgroundColor: C.card, borderColor: colors.accent }]} onPress={() => navigation.navigate('PortfolioSignals')} activeOpacity={0.78}>
            <View style={[styles.holdingSignalsIcon, { backgroundColor: colors.accentSoft }]}><TrendingUp size={17} color={primary} /></View>
            <View style={{ flex: 1 }}><Text style={[styles.holdingSignalsTitle, { color: C.text }]}>查看持倉與自選進出場訊號</Text><Text style={[styles.holdingSignalsSub, { color: C.textMuted }]}>多策略、多週期與市場分類分析</Text></View>
            <Text style={[styles.holdingSignalsArrow, { color: primary }]}>›</Text>
          </TouchableOpacity>
        )}

        {tradePlanSummary.total > 0 && (
          <View style={[styles.tradePlanOverview, { backgroundColor: C.card, borderColor: C.border }]}>
            <View style={styles.tradePlanOverviewHeader}>
              <Text style={[styles.tradePlanOverviewTitle, { color: C.text }]}>交易計畫風控</Text>
              {tradePlanLoading && <ActivityIndicator size="small" color={primary} />}
              <Text style={[styles.tradePlanOverviewMeta, { color: C.textMuted }]}>
                {tradePlanLoading ? '更新中' : `${tradePlanSummary.total} 檔`}
              </Text>
            </View>
            <View style={styles.tradePlanOverviewPills}>
              {[
                ['normal', '正常', colors.positive],
                ['warning', '警戒', colors.warning],
                ['invalid', '失效', colors.negative],
                ['unset', '未設定', C.textMuted],
                ['missing', '資料不足', C.textMuted],
              ].filter(([key]) => tradePlanSummary[key] > 0).map(([key, label, color]) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.tradePlanSummaryPill,
                    {
                      borderColor: selectedTradePlanState === key ? color : `${color}66`,
                      backgroundColor: selectedTradePlanState === key ? `${color}2E` : `${color}14`,
                    },
                  ]}
                  onPress={() => setSelectedTradePlanState(current => current === key ? null : key)}
                  activeOpacity={0.72}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedTradePlanState === key }}
                  accessibilityLabel={`只顯示${label}的標的，共 ${tradePlanSummary[key]} 檔`}
                >
                  <View style={[styles.tradePlanSummaryDot, { backgroundColor: color }]} />
                  <Text style={[styles.tradePlanSummaryText, { color }]}>{label} {tradePlanSummary[key]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ── ASSET LIST ────────────────────────────────────────────────── */}
        {sortedFilteredAssets.length > 0 ? (
          (() => {
            const renderAssetRows = (list) => list.map((asset, idx) => (
              <TouchableOpacity
                key={getAssetRenderKey(asset)}
                style={[
                  styles.assetRow,
                  { borderBottomColor: C.border },
                  idx === list.length - 1 && { borderBottomWidth: 0 },
                ]}
                onPress={() => navigation.navigate('AssetDetail', { assetId: asset.id, allIds: asset._allIds || [asset.id] })}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.assetNameRow}>
                    <Text style={[styles.assetName, { color: C.text }]} numberOfLines={1}>{asset.name}</Text>
                    {asset.category === 'investment' && tradePlanStatuses[getTradePlanKey(asset)] && (() => {
                      const plan = tradePlanStatuses[getTradePlanKey(asset)];
                      const stateColor = plan.state === 'normal'
                        ? colors.positive
                        : plan.state === 'warning'
                          ? colors.warning
                          : plan.state === 'invalid'
                            ? colors.negative
                            : C.textMuted;
                      return (
                        <View style={[styles.tradePlanBadge, { borderColor: `${stateColor}66`, backgroundColor: `${stateColor}14` }]}>
                          <Text style={[styles.tradePlanBadgeText, { color: stateColor }]}>{plan.label}</Text>
                        </View>
                      );
                    })()}
                  </View>
                  <Text style={[styles.assetMeta, { color: C.textMuted }]}>{asset.currency}</Text>
                  {asset.category === 'investment' && (() => {
                    const plan = tradePlanStatuses[getTradePlanKey(asset)];
                    if (!plan || !['warning', 'invalid'].includes(plan.state) || !Number.isFinite(plan.distancePct)) return null;
                    const text = plan.state === 'invalid'
                      ? plan.recoveredAfterInvalidation
                        ? `曾收盤跌破停損・現價已收復 ${Math.max(0, plan.distancePct).toFixed(1)}%`
                        : `低於停損價 ${Math.abs(plan.distancePct).toFixed(1)}%`
                      : plan.intradayStopStatus || (() => {
                        const distance = Math.max(0, plan.distancePct);
                        const formattedDistance = distance > 0 && distance < 0.01
                          ? '<0.01'
                          : distance < 0.1 ? distance.toFixed(2) : distance.toFixed(1);
                        return `距停損 ${formattedDistance}%`;
                      })();
                    return <Text style={[styles.tradePlanDistance, { color: plan.state === 'invalid' ? colors.negative : colors.warning }]}>{text}</Text>;
                  })()}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {asset.leverage > 1 && (
                      <Text style={{
                        fontSize: 11, color: primary, fontWeight: '700',
                        backgroundColor: theme === 'trading' ? 'rgba(247,166,0,0.12)' : (isDark ? colors.cardAlt : '#E8EEF6'),
                        paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
                      }}>
                        {asset.leverage}x
                      </Text>
                    )}
                    <Text style={[styles.assetAmount, { color: C.text }]}>{mask(asset.converted_amount)}</Text>
                  </View>
                  {asset.pnl !== null && (
                    <Text style={{ fontSize: 11, fontWeight: '600', color: asset.pnl >= 0 ? GREEN : RED }}>
                      {hidden ? '****' : asset.pnl_pct !== null
                        ? `${asset.pnl >= 0 ? '+' : ''}${fmt(asset.pnl)}  (${asset.pnl >= 0 ? '+' : ''}${Number(asset.pnl_pct).toFixed(1)}%)`
                        : `${asset.pnl >= 0 ? '+' : ''}${fmt(asset.pnl)}`}
                    </Text>
                  )}
                  {asset.current_shares > 0 && (
                    <Text style={[styles.assetShares, { color: C.textMuted }]}>
                      {asset.current_shares.toLocaleString()} 股
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            ));

            const renderGroup = (key, label, color, list) => {
              const total = list.reduce((s, a) => s + a.converted_amount, 0);
              return (
                <View key={key} style={{ marginBottom: 8 }}>
                  <View style={[styles.groupHeader, { backgroundColor: C.card }]}>
                    <View style={[styles.groupDot, { backgroundColor: color }]} />
                    <Text style={[styles.groupLabel, { color }]}>{label}</Text>
                    <Text style={[styles.groupTotal, { color: C.textSub }]}>{mask(total)}</Text>
                  </View>
                  <View style={[styles.assetList, { backgroundColor: C.card }]}>
                    {renderAssetRows(list)}
                  </View>
                </View>
              );
            };

            if (!selectedCategory) {
              const CAT_ORDER = ['liquid', 'investment', 'fixed', 'receivable', 'liability'];
              const groups    = {};
              sortedFilteredAssets.forEach(a => {
                if (!groups[a.category]) groups[a.category] = [];
                groups[a.category].push(a);
              });
              return CAT_ORDER.filter(c => groups[c]).map(cat => {
                const cfg = CATEGORY_CONFIG[cat];
                const groupColor = cat === 'liability' ? colors.negative : allocationColors[cat];
                return renderGroup(cat, cfg.label, groupColor, groups[cat]);
              });
            }

            if (selectedCategory === 'investment') {
              const MT_ORDER = ['TW', 'US', 'Crypto', 'other'];
              const groups   = {};
              sortedFilteredAssets.forEach(a => {
                const mt = a.market_type || 'other';
                if (!groups[mt]) groups[mt] = [];
                groups[mt].push(a);
              });
              return MT_ORDER.filter(mt => groups[mt]).map(mt => {
                const cfg = MARKET_TYPE_CONFIG[mt];
                return renderGroup(mt, cfg.label, marketColors[mt], groups[mt]);
              });
            }

            return (
              <View style={[styles.assetList, { backgroundColor: C.card }]}>
                {renderAssetRows(sortedFilteredAssets)}
              </View>
            );
          })()
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: C.textSub }]}>尚無資產</Text>
            <Text style={[styles.emptySub, { color: C.textMuted }]}>點擊右上角 + 新增您的資產</Text>
          </View>
        )}

      </ScrollView>
      <PnlExclusionModal
        visible={pnlScopeVisible}
        onClose={() => setPnlScopeVisible(false)}
        assets={pnlScopeAssets}
        savingAssetId={savingPnlAssetId}
        onToggle={togglePnlExclusion}
        colors={colors}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  loading:   { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Hero
  hero: { paddingHorizontal: 20, paddingBottom: 24, marginBottom: 4 },
  heroHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  heroLabel:  { fontSize: 13, fontWeight: '500' },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 4,
  },
  heroAmount:    { fontSize: 44, fontWeight: 'bold', letterSpacing: -1 },
  heroChange:    { fontSize: 15, fontWeight: '600' },
  heroChangeSub: { fontSize: 13 },

  // Section card (allocation, monthly perf)
  sectionCard: {
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 14 },
  pnlHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 11 },
  pnlSubtitle: { fontSize: 9 }, pnlCount: { fontSize: 10, fontWeight: '700', marginTop: 2 },
  pnlScopeButton: { minHeight: 30, borderWidth: 1, borderRadius: 15, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  pnlScopeButtonText: { fontSize: 9, fontWeight: '800' },
  pnlMarketRow: { gap: 7, paddingRight: 4, marginBottom: 12 },
  pnlMarketChip: { minHeight: 31, paddingHorizontal: 12, borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pnlMarketText: { fontSize: 10, fontWeight: '800' },
  pnlMetrics: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 13 },
  pnlMetric: { flex: 1, minWidth: 0 }, pnlMetricDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: 13 },
  pnlMetricLabel: { fontSize: 10, marginBottom: 6 }, pnlMetricValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  pnlMetricPct: { fontSize: 10, fontWeight: '700', marginTop: 4 }, pnlFootnote: { fontSize: 8, lineHeight: 13, marginTop: 12 },

  // Investment P&L calculation scope
  pnlScopeOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' },
  pnlScopeModal: { maxHeight: '78%', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingTop: 18, paddingHorizontal: 18, paddingBottom: 28 },
  pnlScopeHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  pnlScopeTitle: { fontSize: 19, fontWeight: '800', marginBottom: 5 },
  pnlScopeHint: { fontSize: 11, lineHeight: 16 },
  pnlScopeClose: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pnlScopeList: { flexGrow: 0, marginBottom: 12 },
  pnlScopeRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  pnlScopeAssetName: { fontSize: 14, fontWeight: '800', marginBottom: 3 },
  pnlScopeAssetMeta: { fontSize: 10 },
  pnlScopeToggle: { minWidth: 76, height: 32, paddingHorizontal: 10, borderWidth: 1, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  pnlScopeToggleText: { fontSize: 10, fontWeight: '800' },
  pnlScopeFooter: { fontSize: 9, lineHeight: 14, marginBottom: 13 },
  pnlScopeDone: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pnlScopeDoneText: { fontSize: 14, fontWeight: '800' },

  // Donut legend
  legendLabel: { fontSize: 13 },
  legendPct:   { fontSize: 13, fontWeight: '700' },

  // Two-column row
  twoColRow: { flexDirection: 'row', justifyContent: 'space-between' },

  // Sparkline card
  sparkCard: {
    borderRadius: 16, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  sparkCardLabel:  { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  sparkCardAmount: { fontSize: 17, fontWeight: '700', marginBottom: 3 },
  sparkCardChange: { fontSize: 12, fontWeight: '500' },

  // Simple card (fixed, receivable)
  simpleCard: {
    borderRadius: 16, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  simpleCardLabel:  { fontSize: 12, marginBottom: 4 },
  simpleCardAmount: { fontSize: 17, fontWeight: '700', marginBottom: 3 },
  simpleCardChange: { fontSize: 12 },

  // Liability row
  liabilityCard: {
    borderRadius: 16, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  liabIconCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  liabLabel:  { fontSize: 15, fontWeight: '600' },
  liabAmount: { fontSize: 17, fontWeight: '700' },
  liabChange: { fontSize: 12, fontWeight: '500' },

  // Monthly performance
  perfRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  perfLabel:   { fontSize: 14 },
  perfValue:   { fontSize: 15, fontWeight: '700' },
  perfDivider: { height: StyleSheet.hairlineWidth },

  // Filter bar
  filterBar: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 4, marginBottom: 4,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, gap: 6,
  },
  filterText:   { fontSize: 13 },
  clearBtn:     { paddingHorizontal: 4 },
  clearText:    { fontSize: 13, fontWeight: '600' },
  filterCount:  { fontSize: 12 },
  sortBtn:      { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginLeft: 4 },
  sortText:     { fontSize: 12, fontWeight: '600' },

  // Update time
  updateRow:       { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 6, marginBottom: 4, gap: 6 },
  updateTime:      { fontSize: 11 },
  refreshingText:  { fontSize: 11 },
  holdingSignalsButton: { marginHorizontal: 16, marginTop: 7, marginBottom: 7, minHeight: 58, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  holdingSignalsIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  holdingSignalsTitle: { fontSize: 13, fontWeight: '800' }, holdingSignalsSub: { fontSize: 9, marginTop: 3 }, holdingSignalsArrow: { fontSize: 25, fontWeight: '500' },
  tradePlanOverview: { marginHorizontal: 16, marginTop: 2, marginBottom: 7, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  tradePlanOverviewHeader: { minHeight: 20, flexDirection: 'row', alignItems: 'center', gap: 7 },
  tradePlanOverviewTitle: { flex: 1, fontSize: 13, fontWeight: '800' },
  tradePlanOverviewMeta: { fontSize: 10, fontWeight: '600' },
  tradePlanOverviewPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tradePlanSummaryPill: { minHeight: 24, borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  tradePlanSummaryDot: { width: 6, height: 6, borderRadius: 3 },
  tradePlanSummaryText: { fontSize: 10, fontWeight: '800' },

  // Asset list
  groupHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 8, marginBottom: 4,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, gap: 6,
  },
  groupDot:   { width: 8, height: 8, borderRadius: 4 },
  groupLabel: { fontSize: 13, fontWeight: '700', flex: 1 },
  groupTotal: { fontSize: 13, fontWeight: '500' },

  assetList: {
    marginHorizontal: 16, borderRadius: 12, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  assetRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  assetNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingRight: 8 },
  assetName:   { flexShrink: 1, fontSize: 15, fontWeight: '500', marginBottom: 2 },
  assetMeta:   { fontSize: 12 },
  assetAmount: { fontSize: 16, fontWeight: '600' },
  assetShares: { fontSize: 12, marginTop: 2 },
  tradePlanBadge: { minHeight: 20, borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  tradePlanBadgeText: { fontSize: 9, fontWeight: '800' },
  tradePlanDistance: { fontSize: 10, fontWeight: '700', marginTop: 3 },

  empty:     { alignItems: 'center', padding: 48 },
  emptyText: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptySub:  { fontSize: 13 },
});
