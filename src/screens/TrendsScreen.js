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
import { fetchFinancialReports } from '../services/financialReports';
import { loadCloudWatchlist } from '../services/investmentSignals';

const { width: screenWidth } = Dimensions.get('window');
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
const PNL_GAIN_COLOR = '#0DBD8B';
const PNL_LOSS_COLOR = '#F03030';
const PNL_GAIN_SOFT = 'rgba(13,189,139,0.13)';
const PNL_LOSS_SOFT = 'rgba(240,48,48,0.10)';
const PNL_METRICS = [
  { key: 'realized', label: '已實現', seriesKey: 'realizedPnl', changeKey: 'realizedChange', pctKey: 'realizedPct', color: PNL_GAIN_COLOR },
  { key: 'unrealized', label: '未實現', seriesKey: 'unrealizedPnl', changeKey: 'unrealizedChange', pctKey: 'unrealizedPct', color: '#F5A623' },
  { key: 'total', label: '總損益', seriesKey: 'totalPnl', changeKey: 'totalDiff', pctKey: 'totalPct', color: '#60A5FA' },
];

const quarterFromPeriodEnd = value => {
  const match = String(value || '').match(/^(\d{4})-(0[1-9]|1[0-2])-\d{2}$/);
  return match ? `${match[1]} Q${Math.ceil(Number(match[2]) / 3)}` : null;
};

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

const allSettledWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
};

const performanceMarketForFilter = filter => ({
  all: 'ALL',
  TW: 'TW',
  US: 'US',
  Crypto: 'CRYPTO',
}[filter] || null);

const buildTradePnlViews = (points = []) => {
  const usable = points
    .filter(point => point?.date && Number.isFinite(Number(point.totalPnl)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const series = usable.map(point => ({
    date: point.date,
    realizedPnl: Number(point.realizedPnl) || 0,
    unrealizedPnl: Number(point.unrealizedPnl) || 0,
    totalPnl: Number(point.totalPnl) || 0,
  }));
  const daily = {};
  for (let index = 1; index < usable.length; index += 1) {
    const previous = usable[index - 1];
    const current = usable[index];
    const previousCost = Number(previous.totalCost) > 0
      ? Number(previous.totalCost)
      : Math.max(Number(previous.currentValue) || 0, 0);
    const realizedDiff = Number(current.realizedPnl) - Number(previous.realizedPnl);
    const unrealizedDiff = Number(current.unrealizedPnl) - Number(previous.unrealizedPnl);
    const totalDiff = Number(current.totalPnl) - Number(previous.totalPnl);
    const denominator = previousCost > 0 ? previousCost : Math.max(Number(current.totalCost) || 0, 0);
    daily[current.date] = {
      diff: totalDiff,
      realizedDiff,
      unrealizedDiff,
      totalDiff,
      prevValue: previousCost,
      realizedPnl: Number(current.realizedPnl) || 0,
      unrealizedPnl: Number(current.unrealizedPnl) || 0,
      totalPnl: Number(current.totalPnl),
      realizedPct: denominator > 0 ? (realizedDiff / denominator) * 100 : 0,
      unrealizedPct: denominator > 0 ? (unrealizedDiff / denominator) * 100 : 0,
      totalPct: denominator > 0 ? (totalDiff / denominator) * 100 : 0,
    };
  }

  const monthStart = getTaipeiMonthStart(23);
  const monthLast = {};
  usable
    .filter(point => point.date >= monthStart)
    .forEach(point => { monthLast[point.date.slice(0, 7)] = point; });
  const months = Object.entries(monthLast).sort(([a], [b]) => a.localeCompare(b));
  const monthly = [];
  for (let index = 1; index < months.length; index += 1) {
    const [ym, current] = months[index];
    const previous = months[index - 1][1];
    const realizedChange = Number(current.realizedPnl) - Number(previous.realizedPnl);
    const unrealizedChange = Number(current.unrealizedPnl) - Number(previous.unrealizedPnl);
    const totalChange = Number(current.totalPnl) - Number(previous.totalPnl);
    const denominator = Number(previous.totalCost) > 0
      ? Number(previous.totalCost)
      : Math.max(Number(current.totalCost) || Number(previous.currentValue) || 0, 0);
    const [year, month] = ym.split('-');
    monthly.push({
      label: `${year}/${parseInt(month, 10)}月`,
      realizedChange,
      unrealizedChange,
      totalChange,
      // PNL_METRICS uses `totalDiff` for both the daily calendar and the
      // monthly list. Keep the same key here so the amount, sign, colour and
      // percentage are all derived from the same monthly P&L change.
      totalDiff: totalChange,
      realizedPct: denominator > 0 ? (realizedChange / denominator) * 100 : 0,
      unrealizedPct: denominator > 0 ? (unrealizedChange / denominator) * 100 : 0,
      totalPct: denominator > 0 ? (totalChange / denominator) * 100 : 0,
    });
  }
  return { daily, monthly, series };
};

const filterTradePnlSeries = (series = [], selectedPeriod, customRange) => {
  if (!series.length) return [];
  const ordered = [...series].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (customRange?.start && customRange?.end) {
    return ordered.filter(point => point.date >= customRange.start && point.date <= customRange.end);
  }
  const days = Number(selectedPeriod?.days);
  if (!Number.isFinite(days) || days <= 0) return ordered;
  const endDate = ordered.at(-1)?.date;
  if (!endDate) return ordered;
  const cutoff = new Date(`${endDate}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (Math.floor(days) - 1));
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  return ordered.filter(point => point.date >= cutoffKey && point.date <= endDate);
};

const formatAmount = (amount) => {
  return Math.round(amount).toLocaleString('zh-TW');
};

const pnlSign = value => Number(value) > 0 ? '+' : Number(value) < 0 ? '−' : '';
const pnlColor = (value, neutralColor) => Number(value) > 0
  ? PNL_GAIN_COLOR
  : Number(value) < 0 ? PNL_LOSS_COLOR : neutralColor;
const pnlSoftColor = (value, neutralColor) => Number(value) > 0
  ? PNL_GAIN_SOFT
  : Number(value) < 0 ? PNL_LOSS_SOFT : neutralColor;
const signedPnlAmount = (value, formatter = formatAmount) => {
  const number = Number(value) || 0;
  return `${pnlSign(number)}${formatter(Math.abs(number))}`;
};
const signedPnlPercent = (value, digits = 2) => {
  const number = Number(value) || 0;
  const rounded = Number(number.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}%`;
};

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

// ── Straight Polyline Path ──
function buildSmoothPath(pts) {
  if (pts.length === 0) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
}

// ── Amber Gradient Area Chart with Crosshair Tooltip ──
function TrendLineChart({ snapshots, currency }) {
  const { isDark, colors } = useTheme();
  const accent = colors.accent;
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
  const chartBg        = isDark ? colors.bg : 'transparent';
  const labelColor     = colors.textSub;
  const xLabelColor    = colors.textMuted;
  const crosshairDotBg = isDark ? colors.bg : '#ffffff';
  const crosshairLine  = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.18)';
  const tooltipBg      = isDark ? colors.cardAlt : 'rgba(255,255,255,0.96)';
  const tooltipBorder  = `${accent}66`;
  const tooltipDateColor = '#6b7280';

  const gradId = `trendAreaGrad_main`;

  return (
    <View
      style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: chartBg, marginTop: 8 }}
      {...panResponder.panHandlers}
    >
      <Svg width={CHART_W} height={CHART_H} style={{ overflow: 'hidden', backgroundColor: 'transparent' }}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2={CHART_H} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={accent} stopOpacity={isDark ? 0.5 : 0.4} />
            <Stop offset="1" stopColor={isDark ? colors.bg : '#F2F5F9'} stopOpacity={1} />
          </LinearGradient>
        </Defs>

        {/* Gradient area fill */}
        <Path d={areaPath} fill={`url(#${gradId})`} stroke="none" />

        {/* Line */}
        <Path
          d={linePath}
          fill="none"
          stroke={accent}
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
            <Circle cx={touchPt.x} cy={touchPt.y} r={7} fill={crosshairDotBg} stroke={accent} strokeWidth="2.5" />
            <Circle cx={touchPt.x} cy={touchPt.y} r={3} fill={accent} />
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
          <Text style={{ color: accent, fontSize: 13, fontWeight: '700' }}>
            {Math.round(touchPt.value).toLocaleString('zh-TW')}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Realized / unrealized / total P&L line chart ──
function PnlBreakdownChart({ series, currency, metric = 'total' }) {
  const { isDark, colors } = useTheme();
  const CHART_W = screenWidth - 64;
  const CHART_H = 224;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 28;
  const PAD_H = 8;
  const plotW = CHART_W - PAD_H * 2;
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const [touchIdx, setTouchIdx] = useState(null);
  const seriesRef = useRef(series);
  seriesRef.current = series;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: event => {
        const n = seriesRef.current.length;
        if (n < 2) return;
        const x = event.nativeEvent.locationX;
        setTouchIdx(Math.round(Math.max(0, Math.min(1, (x - PAD_H) / plotW)) * (n - 1)));
      },
      onPanResponderMove: event => {
        const n = seriesRef.current.length;
        if (n < 2) return;
        const x = event.nativeEvent.locationX;
        setTouchIdx(Math.round(Math.max(0, Math.min(1, (x - PAD_H) / plotW)) * (n - 1)));
      },
      onPanResponderRelease: () => setTouchIdx(null),
      onPanResponderTerminate: () => setTouchIdx(null),
    }),
  ).current;

  if (!Array.isArray(series) || series.length < 2) return null;

  const metricConfig = PNL_METRICS.find(item => item.key === metric) || PNL_METRICS[2];
  const values = series.map(point => Number(point[metricConfig.seriesKey]) || 0);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const valueRange = maxValue - minValue || 1;
  const valuePad = valueRange * 0.12;
  const yMin = minValue - valuePad;
  const yMax = maxValue + valuePad;
  const toX = index => PAD_H + (index / (series.length - 1)) * plotW;
  const toY = value => PAD_TOP + plotH * (1 - (value - yMin) / (yMax - yMin));
  const pointsFor = key => series.map((point, index) => ({
    x: toX(index),
    y: toY(Number(point[key]) || 0),
    value: Number(point[key]) || 0,
    date: point.date,
  }));
  const activePoints = pointsFor(metricConfig.seriesKey);
  const zeroY = toY(0);
  const xLabels = Array.from({ length: Math.min(5, series.length) }, (_, index) => {
    const count = Math.min(5, series.length);
    const pointIndex = count === 1 ? 0 : Math.round(index / (count - 1) * (series.length - 1));
    const date = series[pointIndex].date;
    return { x: toX(pointIndex), label: String(date).slice(5) };
  });
  const touchPoint = touchIdx == null ? null : {
    x: toX(touchIdx),
    y: activePoints[touchIdx].y,
    data: series[touchIdx],
  };
  const tooltipLeft = touchPoint
    ? Math.min(Math.max(touchPoint.x - 70, 4), CHART_W - 148)
    : 0;
  const lineColor = metricConfig.color;
  const touchValue = touchPoint
    ? Number(touchPoint.data[metricConfig.seriesKey]) || 0
    : 0;

  return (
    <View
      style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: isDark ? colors.bg : 'transparent', marginTop: 8 }}
      {...panResponder.panHandlers}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingTop: 4 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: lineColor }} />
        <Text style={{ color: colors.textSub, fontSize: 11 }}>{metricConfig.label}</Text>
      </View>
      <Svg width={CHART_W} height={CHART_H} style={{ overflow: 'hidden', backgroundColor: 'transparent' }}>
        <SvgLine
          x1={PAD_H}
          y1={zeroY}
          x2={CHART_W - PAD_H}
          y2={zeroY}
          stroke={isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)'}
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <Path d={buildSmoothPath(activePoints)} fill="none" stroke={lineColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {xLabels.map((label, index) => (
          <SvgText key={index} x={label.x} y={CHART_H - 6} textAnchor="middle" fill={colors.textMuted} fontSize="10">
            {label.label}
          </SvgText>
        ))}
        {touchPoint && (
          <SvgLine
            x1={touchPoint.x}
            y1={PAD_TOP}
            x2={touchPoint.x}
            y2={PAD_TOP + plotH}
            stroke={isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.18)'}
            strokeWidth="1"
            strokeDasharray="4 4"
          />
        )}
      </Svg>
      {touchPoint && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: Math.max(28, touchPoint.y - 72),
            left: tooltipLeft,
            minWidth: 144,
            backgroundColor: isDark ? colors.cardAlt : 'rgba(255,255,255,0.96)',
            borderRadius: 8,
            paddingHorizontal: 9,
            paddingVertical: 6,
            borderWidth: 1,
            borderColor: `${colors.accent}66`,
          }}
        >
          <Text style={{ color: colors.textMuted, fontSize: 10, marginBottom: 2 }}>{touchPoint.data.date}</Text>
          <Text style={{ color: pnlColor(touchValue, colors.textMuted), fontSize: 11, fontWeight: '800' }}>
            {metricConfig.label} {signedPnlAmount(touchValue)} {currency}
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
  const [performanceMode, setPerformanceMode] = useState('trade'); // default FIFO trading P&L
  const [performanceDataLoading, setPerformanceDataLoading] = useState(false);
  const [performanceDataError, setPerformanceDataError] = useState('');
  const [tradePnlSummary, setTradePnlSummary] = useState(null);
  const [tradePnlSeries, setTradePnlSeries] = useState([]);
  const [performanceScopeAssets, setPerformanceScopeAssets] = useState([]);
  const [scopeModalVisible, setScopeModalVisible] = useState(false);
  const [scopeSavingAssetId, setScopeSavingAssetId] = useState(null);
  const [selectedPnlMetric, setSelectedPnlMetric] = useState('total');
  const [calendarEarningsOnly, setCalendarEarningsOnly] = useState(false);
  const [trendChartMode, setTrendChartMode] = useState('pnl');
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [dailyPnlMap, setDailyPnlMap] = useState({}); // { 'YYYY-MM-DD': { diff, prevValue } }
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [earningsEvents, setEarningsEvents] = useState([]);
  const [marketCalendarEvents, setMarketCalendarEvents] = useState([]);
  const [earningsUsSymbols, setEarningsUsSymbols] = useState('');
  const [earningsTwSymbols, setEarningsTwSymbols] = useState('');
  const [earningsTargetMeta, setEarningsTargetMeta] = useState({});
  const [marketCalendarError, setMarketCalendarError] = useState('');
  const [earningsCalendarLoading, setEarningsCalendarLoading] = useState(false);
  const [earningsCalendarError, setEarningsCalendarError] = useState('');

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
  const earningsCalendarRequestRef = useRef(0);

  const loadEarningsCalendar = useCallback(async (assetRows = []) => {
    const requestId = earningsCalendarRequestRef.current + 1;
    earningsCalendarRequestRef.current = requestId;
    setEarningsCalendarLoading(true);
    setEarningsCalendarError('');
    try {
      const [cloudWatchlist, localWatchlistRaw] = await Promise.all([
        loadCloudWatchlist().catch(() => []),
        AsyncStorage.getItem('watchlist').catch(() => null),
      ]);
      if (requestId !== earningsCalendarRequestRef.current) return;

      let localWatchlist = [];
      try { localWatchlist = JSON.parse(localWatchlistRaw || '[]'); } catch { localWatchlist = []; }
      const localItems = Array.isArray(localWatchlist) ? localWatchlist : [];
      const watchlist = [...localItems, ...cloudWatchlist.map(item => ({
        ...item,
        name: localItems.find(local => local.symbol === item.symbol && local.market_type === item.market_type)?.name || item.symbol,
      }))];

      const targets = new Map();
      const addTarget = (asset, source) => {
        const symbol = String(asset?.symbol || '').trim().toUpperCase();
        const marketType = String(asset?.market_type || '').trim().toUpperCase();
        if (!symbol || !['TW', 'US'].includes(marketType)) return;
        if (source === 'holding' && (asset?.category !== 'investment' || Number(asset?.current_shares) <= 0)) return;
        const key = `${marketType}:${symbol}`;
        const current = targets.get(key) || {
          key,
          symbol,
          marketType,
          name: asset?.name || symbol,
          isHolding: false,
          isWatchlist: false,
        };
        current.isHolding ||= source === 'holding';
        current.isWatchlist ||= source === 'watchlist';
        if (!current.name || current.name === symbol) current.name = asset?.name || current.name;
        targets.set(key, current);
      };
      assetRows.forEach(asset => addTarget(asset, 'holding'));
      watchlist.forEach(asset => addTarget(asset, 'watchlist'));

      const targetList = [...targets.values()];
      setEarningsUsSymbols(targetList.filter(target => target.marketType === 'US').map(target => target.symbol).sort().join(','));
      setEarningsTwSymbols(targetList
        .filter(target => target.marketType === 'TW' && !target.symbol.startsWith('00') && !target.symbol.startsWith('^'))
        .map(target => target.symbol).sort().join(','));
      setEarningsTargetMeta(Object.fromEntries(targetList.map(target => [target.key, target])));
      if (!targetList.length) {
        setEarningsEvents([]);
        return;
      }

      const results = await allSettledWithConcurrency(targetList, 3, async target => {
        const report = await fetchFinancialReports(target.symbol, target.marketType);
        const nextEstimate = (report?.estimates || []).find(item => item?.period === '0q' && item?.endDate);
        const upcomingQuarter = quarterFromPeriodEnd(nextEstimate?.endDate);
        const releaseDate = String(report?.latestEarningsRelease?.date || '');
        const previousDate = String(report?.earningsCalendar?.previousDate || '');
        const releaseMatchesPrevious = releaseDate && previousDate
          && Math.abs(Date.parse(`${releaseDate}T00:00:00Z`) - Date.parse(`${previousDate}T00:00:00Z`)) <= 86400000;
        const dateCandidates = [
          previousDate ? {
            date: previousDate,
            status: releaseMatchesPrevious ? 'released' : 'recent',
            quarter: report?.quarters?.find(row => row?.announcementDate === releaseDate)?.label
              || report?.releaseQuarter?.label || null,
            source: releaseMatchesPrevious
              ? report?.latestEarningsRelease?.source
              : report?.earningsCalendar?.previousSource,
          } : null,
          releaseDate && !releaseMatchesPrevious ? {
            date: releaseDate,
            status: 'released',
            quarter: report?.releaseQuarter?.label || report?.quarters?.find(row => row?.announcementDate === releaseDate)?.label || null,
            source: report?.latestEarningsRelease?.source,
          } : null,
          {
            date: report?.earningsCalendar?.nextDate,
            status: 'upcoming',
            quarter: upcomingQuarter,
            source: report?.earningsCalendar?.nextSource,
          },
        ].filter(Boolean);
        const uniqueDates = new Map();
        dateCandidates.forEach(candidate => {
          const date = String(candidate.date || '');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
          const existing = uniqueDates.get(date);
          if (!existing || candidate.status === 'released') uniqueDates.set(date, { ...candidate, date });
        });
        return [...uniqueDates.values()].map(event => ({
          ...target,
          ...event,
          key: `${target.key}:${event.date}`,
        }));
      });
      if (requestId !== earningsCalendarRequestRef.current) return;
      const failedCount = results.filter(result => result.status === 'rejected').length;
      setEarningsEvents(results
        .filter(result => result.status === 'fulfilled' && result.value)
        .flatMap(result => result.value)
        .sort((left, right) => left.date.localeCompare(right.date) || left.symbol.localeCompare(right.symbol)));
      setEarningsCalendarError(failedCount ? `${failedCount} 檔標的的財報日期暫時無法取得` : '');
    } catch (error) {
      if (requestId === earningsCalendarRequestRef.current) {
        setEarningsCalendarError(error?.message || '暫時無法取得財報日期');
      }
    } finally {
      if (requestId === earningsCalendarRequestRef.current) setEarningsCalendarLoading(false);
    }
  }, []);

  useEffect(() => {
    const usSymbols = earningsUsSymbols ? earningsUsSymbols.split(',') : [];
    const twSymbols = earningsTwSymbols ? earningsTwSymbols.split(',') : [];
    if (!usSymbols.length && !twSymbols.length) {
      setMarketCalendarEvents([]);
      setMarketCalendarError('');
      return;
    }
    let active = true;
    const month = `${calendarMonth.year}-${pad2(calendarMonth.month)}`;
    setMarketCalendarError('');
    const load = async () => {
      const requests = [
        usSymbols.length && { marketType: 'US', symbols: usSymbols },
        twSymbols.length && { marketType: 'TW', symbols: twSymbols },
      ].filter(Boolean);
      const outcomes = await Promise.all(requests.map(async request => {
        try {
          const { data, error } = await supabase.functions.invoke('financial-reports', {
            body: { calendarMonth: month, marketType: request.marketType, symbols: request.symbols },
          });
          if (error || data?.error) throw new Error(data?.error || error?.message || '財報日曆暫時無法取得');
          return { ...request, data };
        } catch (error) {
          return { ...request, error };
        }
      }));
      if (!active) return;

      const events = [];
      const errors = [];
      outcomes.forEach(outcome => {
        if (outcome.error) {
          errors.push(outcome.marketType === 'US' ? '美股財報日曆暫時無法取得' : '台股申報期限暫時無法取得');
          console.warn(`${outcome.marketType} earnings calendar:`, outcome.error?.message || outcome.error);
          return;
        }
        if (outcome.marketType === 'US' && outcome.data?.incompleteDays) {
          errors.push(`${outcome.data.incompleteDays} 天的 Nasdaq 財報資料暫時無法取得`);
        }
        (outcome.data?.events || []).forEach(event => {
          const key = `${outcome.marketType}:${event.symbol}`;
          events.push({
            ...earningsTargetMeta[key],
            ...event,
            marketType: outcome.marketType,
            key: `${key}:${event.date}`,
          });
        });
      });
      setMarketCalendarEvents(events);
      setMarketCalendarError(errors.join(' · '));
    };
    load();
    return () => { active = false; };
  }, [calendarMonth, earningsUsSymbols, earningsTwSymbols, earningsTargetMeta]);

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

  useEffect(() => {
    // Keep the chart tab aligned with the calculation mode after a tab or
    // market-filter change.
    setTrendChartMode(performanceMode === 'trade' ? 'pnl' : 'assets');
  }, [performanceMode]);

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

        const { data } = await query;
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

        const { data } = await query;
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
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      userIdRef.current = user.id;

      const { data: profileData, error: profileError } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();
      if (profileError) throw profileError;
      setProfile(profileData);

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
        const { error: snapshotError } = await supabase.from('daily_snapshots').upsert(
          { user_id: user.id, snapshot_date: today, net_worth_base: totalValue },
          { onConflict: 'user_id,snapshot_date' }
        );
        if (snapshotError) throw snapshotError;
        await saveCategorySnapshots(converted, user.id, today);

      }

      const filterToLoad = filterOverride !== undefined ? filterOverride : selectedFilter;
      if (performanceModeRef.current === 'market') {
        await loadMonthlyBreakdown(user.id, filterToLoad);
      }
      await loadSnapshots(user.id, selectedPeriod.days, customRange, filterToLoad);
    } catch (e) {
      console.error('Error loading charts:', e);
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
  const visibleTradePnlSeries = filterTradePnlSeries(tradePnlSeries, selectedPeriod, customRange);
  const showPnlChart = performanceMode === 'trade' && trendChartMode === 'pnl';
  const selectedPnlMetricConfig = PNL_METRICS.find(metric => metric.key === selectedPnlMetric) || PNL_METRICS[2];
  const scopeExcludedCount = performanceScopeAssets.filter(asset => asset.exclude_from_performance).length;
  const scopeIncludedCount = Math.max(0, performanceScopeAssets.length - scopeExcludedCount);
  const selectedTradeReturn = selectedPnlMetric === 'realized'
    ? tradePnlSummary?.realizedReturn
    : selectedPnlMetric === 'unrealized'
      ? tradePnlSummary?.unrealizedReturn
      : tradePnlSummary?.totalReturn;
  const selectedTradePnl = selectedPnlMetric === 'realized'
    ? tradePnlSummary?.realizedPnl
    : selectedPnlMetric === 'unrealized'
      ? tradePnlSummary?.unrealizedPnl
      : tradePnlSummary?.totalPnl;
  const tradeReturnText = tradePnlSummary && Number.isFinite(Number(selectedTradeReturn))
    ? signedPnlPercent(Number(selectedTradeReturn) * 100, 1)
    : null;
  const performanceMarket = {
    all: 'ALL',
    TW: 'TW',
    US: 'US',
    Crypto: 'CRYPTO',
    other: 'OTHER',
  }[selectedFilter];
  const selectPerformanceMode = nextMode => {
    if (nextMode === performanceMode) return;
    setPerformanceMode(nextMode);
    setPerformanceDataError('');
    setTradePnlSummary(null);
    setTradePnlSeries([]);
    setPerformanceScopeAssets([]);
    setMonthlyBreakdown([]);
    setDailyPnlMap({});
  };
  const selectTrendChartMode = mode => {
    setTrendChartMode(mode);
    selectPerformanceMode(mode === 'pnl' ? 'trade' : 'market');
  };
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
              {showPnlChart
                ? `交易損益走勢（${currency}）`
                : selectedFilter === 'all' ? `總淨資產趨勢（${currency}）` : `${selectedFilterLabel} 趨勢`}
            </Text>
            {showPnlChart && tradeReturnText ? (
              <Text style={[
                styles.changeBadge,
                {
                  color: pnlColor(selectedTradeReturn, colors.textMuted),
                  backgroundColor: pnlSoftColor(selectedTradeReturn, colors.cardAlt),
                },
              ]}>
                {tradeReturnText}
              </Text>
            ) : changeText && (
              <Text style={[styles.changeBadge, changeText.positive ? styles.pos : styles.neg]}>
                {changeText.positive ? '+' : ''}{changeText.pct}%
              </Text>
            )}
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            {[
              ['assets', '資產淨值'],
              ['pnl', '損益拆分'],
            ].map(([mode, label]) => {
              const active = trendChartMode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  onPress={() => selectTrendChartMode(mode)}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 10,
                    alignItems: 'center',
                    backgroundColor: active ? PRIMARY : colors.cardAlt,
                    borderWidth: 1,
                    borderColor: active ? PRIMARY : colors.border,
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={{ color: active ? colors.accentContrast : colors.textSub, fontSize: 12, fontWeight: active ? '700' : '500' }}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {showPnlChart && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.textSub, fontSize: 12, fontWeight: '700' }}>損益計算標的</Text>
                <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }}>
                  已納入 {scopeIncludedCount} 檔{scopeExcludedCount > 0 ? ` · 手動排除 ${scopeExcludedCount} 檔` : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setScopeModalVisible(true)}
                disabled={!performanceScopeAssets.length || performanceDataLoading}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: colors.cardAlt,
                  borderWidth: 1,
                  borderColor: colors.border,
                  opacity: !performanceScopeAssets.length || performanceDataLoading ? 0.55 : 1,
                }}
                activeOpacity={0.75}
              >
                <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '800' }}>選擇標的</Text>
              </TouchableOpacity>
            </View>
          )}

          {showPnlChart && (
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }} accessibilityRole="tablist">
              {PNL_METRICS.map(metric => {
                const active = selectedPnlMetric === metric.key;
                return <TouchableOpacity
                  key={metric.key}
                  onPress={() => setSelectedPnlMetric(metric.key)}
                  activeOpacity={0.75}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={{ flex: 1, minHeight: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? PRIMARY : colors.cardAlt, borderWidth: 1, borderColor: active ? PRIMARY : colors.border }}
                >
                  <Text style={{ color: active ? colors.accentContrast : colors.textSub, fontSize: 11, fontWeight: active ? '800' : '600' }}>{metric.label}</Text>
                </TouchableOpacity>;
              })}
            </View>
          )}

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
          {showPnlChart ? (
            performanceDataLoading && visibleTradePnlSeries.length < 2 ? (
              <View style={styles.chartLoading}>
                <ActivityIndicator size="small" color={PRIMARY} />
              </View>
            ) : visibleTradePnlSeries.length >= 2 ? (
              <Animated.View style={{ opacity: chartOpacity }}>
                <PnlBreakdownChart series={visibleTradePnlSeries} currency={currency} metric={selectedPnlMetric} />
              </Animated.View>
            ) : (
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>所選期間尚無足夠的歷史損益資料</Text>
            )
          ) : snapshotLoading ? (
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

          {showPnlChart && performanceDataError ? (
            <Text style={{ color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8 }}>
              {performanceDataError}
            </Text>
          ) : showPnlChart && tradePnlSummary ? (
            <Text style={[styles.changeDetail, { color: pnlColor(selectedTradePnl, colors.textMuted) }]}>
              目前累計{selectedPnlMetricConfig.label}：{signedPnlAmount(selectedTradePnl, fmt)} {currency}
            </Text>
          ) : changeText && (
            <Text style={[styles.changeDetail, changeText.positive ? styles.posText : styles.negText]}>
              {periodLabel}變化：{changeText.positive ? '+' : ''}{fmt(changeText.diff)}
            </Text>
          )}

          {showPnlChart && (
            <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.borderLight }}>
              <Text style={[styles.sectionLabel, { color: colors.textSub, marginBottom: 10 }]}>月度績效 · {selectedPnlMetricConfig.label}</Text>
              {performanceDataLoading && !monthlyBreakdown.length ? (
                <ActivityIndicator size="small" color={PRIMARY} style={{ marginVertical: 12 }} />
              ) : monthlyBreakdown.length ? (
                [...monthlyBreakdown].reverse().map((m, i) => {
                  const change = Number(m[selectedPnlMetricConfig.changeKey]) || 0;
                  const changePct = Number(m[selectedPnlMetricConfig.pctKey]) || 0;
                  const trendColor = pnlColor(change, colors.textMuted);
                  const barPct = Math.min(Math.abs(changePct) / 15, 1);
                  return (
                    <View key={i} style={{ marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
                        <Text style={{ fontSize: 13, color: colors.textSub, width: 66 }} numberOfLines={1}>
                          {String(m.label).replace(/月$/, '')}
                        </Text>
                        <View style={{ flex: 1, height: 6, backgroundColor: colors.borderLight, borderRadius: 3, overflow: 'hidden' }}>
                          <View style={{ width: `${barPct * 100}%`, height: '100%', borderRadius: 3, backgroundColor: trendColor }} />
                        </View>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: trendColor, minWidth: 70, textAlign: 'right' }}>
                          {signedPnlPercent(changePct, 2)}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 11, color: trendColor, paddingLeft: 66 }}>
                        {signedPnlAmount(change, fmt)} {currency}
                      </Text>
                    </View>
                  );
                })
              ) : (
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>尚無足夠資料</Text>
              )}
            </View>
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

        {/* ── DAILY P&L CALENDAR ──────────────────────────────────────────── */}
        {performanceMode === 'trade' && <View
          style={[styles.card, { marginHorizontal: 16, marginTop: 16, marginBottom: 8, backgroundColor: colors.card }]}
        >
          {/* Card header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {calendarEarningsOnly ? '財報日曆' : `每日損益日曆 · ${selectedPnlMetricConfig.label}`}{selectedFilter !== 'all' ? `（${selectedFilterLabel}）` : ''}
            </Text>
            {(calendarLoading || performanceDataLoading || earningsCalendarLoading) && <ActivityIndicator size="small" color={PRIMARY} />}
          </View>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }} accessibilityRole="tablist">
            {PNL_METRICS.map(metric => {
              const active = !calendarEarningsOnly && selectedPnlMetric === metric.key;
              return <TouchableOpacity
                key={metric.key}
                onPress={() => {
                  setSelectedPnlMetric(metric.key);
                  setCalendarEarningsOnly(false);
                }}
                activeOpacity={0.75}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={{ flex: 1, minHeight: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? PRIMARY : colors.cardAlt, borderWidth: 1, borderColor: active ? PRIMARY : colors.border }}
              >
                <Text style={{ color: active ? colors.accentContrast : colors.textSub, fontSize: 10, fontWeight: active ? '800' : '600' }}>{metric.label}</Text>
              </TouchableOpacity>;
            })}
            <TouchableOpacity
              onPress={() => setCalendarEarningsOnly(true)}
              activeOpacity={0.75}
              accessibilityRole="tab"
              accessibilityLabel="財報日曆"
              accessibilityState={{ selected: calendarEarningsOnly }}
              style={{ flex: 1, minHeight: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: calendarEarningsOnly ? PRIMARY : colors.cardAlt, borderWidth: 1, borderColor: calendarEarningsOnly ? PRIMARY : colors.border }}
            >
              <Text style={{ color: calendarEarningsOnly ? colors.accentContrast : colors.textSub, fontSize: 10, fontWeight: calendarEarningsOnly ? '800' : '600' }}>
                財報
              </Text>
            </TouchableOpacity>
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
          {!calendarEarningsOnly && (calendarMonthSummary ? (
            <View style={{ alignItems: 'center', marginBottom: 14 }}>
              {(() => {
                const summaryValue = selectedPnlMetric === 'realized'
                  ? calendarMonthSummary.realizedDiff
                  : selectedPnlMetric === 'unrealized'
                    ? calendarMonthSummary.unrealizedDiff
                    : calendarMonthSummary.diff;
                const summaryPct = selectedPnlMetric === 'realized'
                  ? calendarMonthSummary.realizedPct
                  : selectedPnlMetric === 'unrealized'
                    ? calendarMonthSummary.unrealizedPct
                    : calendarMonthSummary.pct;
                return <Text style={{ fontSize: 14, fontWeight: '700', color: pnlColor(summaryValue, colors.textMuted) }}>
                  {selectedPnlMetricConfig.label} {signedPnlAmount(summaryValue, fmt)} {currency}
                  {'  '}({signedPnlPercent(summaryPct, 2)})
                </Text>;
              })()}
            </View>
          ) : performanceDataLoading ? (
            <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
              正在重算每日 FIFO 損益…
            </Text>
          ) : !calendarLoading && (
            <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
              {performanceDataError ? '本月每日損益暫時無法計算' : '本月尚無損益紀錄'}
            </Text>
          ))}
          {!calendarEarningsOnly && performanceMode === 'trade' && !!performanceDataError && (
            <View style={{ alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ color: colors.warning, fontSize: 10, lineHeight: 15, textAlign: 'center' }}>
                {performanceDataError}{Object.keys(dailyPnlMap).length ? '；目前顯示上次成功計算的資料' : ''}
              </Text>
              {!performanceDataLoading && <TouchableOpacity onPress={() => loadTradePerformance(selectedFilter)} style={{ padding: 5 }}>
                <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700' }}>重試計算</Text>
              </TouchableOpacity>}
            </View>
          )}

          <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center', marginBottom: 10 }}>
            {calendarEarningsOnly
              ? '只顯示持有或收藏標的的財報日期；Q 代表財報季度，預估日期可能調整'
              : '點選有損益的日期查看明細'}
          </Text>

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
            const todayStr = getTaipeiDateString();
            return calendarRows.map((week, wi) => (
            <View key={wi} style={{ flexDirection: 'row', marginBottom: 3 }}>
              {week.map((day, di) => {
                if (!day) return <View key={di} style={{ flex: 1 }} />;
                const dateStr = `${calendarMonth.year}-${pad2(calendarMonth.month)}-${pad2(day)}`;
                const dayEarnings = earningsByDate[dateStr] || [];
                const pnl     = dailyPnlMap[dateStr];
                const hasPnl  = pnl != null;
                const totalDiff = Number(pnl?.totalDiff ?? pnl?.diff) || 0;
                const realizedDiff = Number(pnl?.realizedDiff) || 0;
                const unrealizedDiff = Number(pnl?.unrealizedDiff) || 0;
                const selectedDiff = selectedPnlMetric === 'realized'
                  ? realizedDiff
                  : selectedPnlMetric === 'unrealized'
                    ? unrealizedDiff
                    : totalDiff;
                const selectedPct = selectedPnlMetric === 'realized'
                  ? Number(pnl?.realizedPct)
                  : selectedPnlMetric === 'unrealized'
                    ? Number(pnl?.unrealizedPct)
                    : Number(pnl?.totalPct);
                const showPnl = hasPnl && !calendarEarningsOnly;
                const isPositive = showPnl && selectedDiff > 0;
                const isNegative = showPnl && selectedDiff < 0;
                const dayTone = pnlColor(selectedDiff, colors.textMuted);
                const pct     = showPnl && Number.isFinite(selectedPct)
                  ? selectedPct : (hasPnl && pnl.prevValue > 0 ? (selectedDiff / pnl.prevValue) * 100 : 0);
                const isToday = dateStr === todayStr;
                const canOpenDetail = calendarEarningsOnly ? dayEarnings.length > 0 : showPnl;
                const Cell    = canOpenDetail ? TouchableOpacity : View;
                return (
                  <Cell
                    key={di}
                    onPress={canOpenDetail
                      ? () => openDayDetail(dateStr, calendarEarningsOnly ? 'earnings' : 'pnl', dayEarnings)
                      : undefined}
                    activeOpacity={0.7}
                    accessibilityRole={canOpenDetail ? 'button' : undefined}
                    accessibilityLabel={canOpenDetail
                      ? calendarEarningsOnly
                        ? `${dateStr} 財報事件 ${dayEarnings.length} 檔`
                        : `${dateStr} ${selectedPnlMetricConfig.label} ${signedPnlAmount(selectedDiff, fmt)} ${currency}`
                      : dateStr}
                    style={{
                      flex: 1,
                      marginHorizontal: 2,
                      borderRadius: 8,
                      paddingVertical: 5,
                      paddingHorizontal: 1,
                      backgroundColor: isPositive
                        ? PNL_GAIN_SOFT
                        : isNegative
                          ? PNL_LOSS_SOFT
                          : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'),
                      alignItems: 'center',
                      minHeight: 70,
                      borderWidth: isToday ? 1.5 : 0,
                      borderColor: isToday ? PRIMARY : 'transparent',
                    }}
                  >
                    <Text style={{
                      fontSize: 11,
                      color: isToday ? PRIMARY
                        : showPnl ? colors.textSub : colors.textMuted,
                      fontWeight: isToday ? '800' : '600',
                      marginBottom: 3,
                    }}>
                      {day}
                    </Text>
                    {showPnl && (
                      <>
                        <Text style={{
                          fontSize: 10, fontWeight: '700',
                          color: dayTone,
                          textAlign: 'center',
                        }} numberOfLines={1}>
                          {signedPnlPercent(pct, 1)}
                        </Text>
                        <Text style={{
                          fontSize: 9, fontWeight: '700',
                          color: dayTone,
                          textAlign: 'center', opacity: 0.9,
                        }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                          {signedPnlAmount(selectedDiff, fmtCompact)}
                        </Text>
                      </>
                    )}
                    {calendarEarningsOnly && dayEarnings.slice(0, 2).map((event, eventIndex) => (
                      <Text key={`${event.key}:${eventIndex}`} style={{ fontSize: 7, lineHeight: 9, fontWeight: '800', color: colors.accent, maxWidth: '100%' }} numberOfLines={1}>
                        {event.symbol}{event.quarter ? ` ${event.quarter.match(/Q[1-4]/)?.[0] || ''}` : ''}
                      </Text>
                    ))}
                    {calendarEarningsOnly && dayEarnings.length > 2 && <Text style={{ fontSize: 7, lineHeight: 9, color: colors.accent }}>+{dayEarnings.length - 2}</Text>}
                  </Cell>
                );
              })}
            </View>
          ));
          })()}

          {calendarEarningsOnly && <View style={{ marginTop: 10, borderRadius: 12, padding: 11, backgroundColor: colors.cardAlt }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>本月財報事件</Text>
              <Text style={{ color: colors.accent, fontSize: 10, fontWeight: '800' }}>{displayedMonthEarnings.length} 檔</Text>
            </View>
            {displayedMonthEarnings.map((event, eventIndex) => (
              <TouchableOpacity key={`${event.key}:${eventIndex}`} accessibilityRole="button" accessibilityLabel={`開啟 ${event.symbol} 財報分析`} activeOpacity={0.75} onPress={() => openEarningsAnalysis(event)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 8 }}>
                <Text style={{ width: 42, color: colors.textSub, fontSize: 10, fontWeight: '800' }}>{event.date.slice(8)}日</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.text, fontSize: 11, fontWeight: '800' }} numberOfLines={1}>
                    {event.symbol}{event.quarter ? ` · ${event.quarter}` : ''} · {event.name || event.symbol}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 9, marginTop: 2 }} numberOfLines={1}>
                    {[
                      event.isHolding && '持有',
                      event.isWatchlist && '收藏',
                      event.status === 'released' ? '已公告'
                        : event.status === 'recent' ? '最近一次'
                          : event.isFilingDeadline || event.status === 'filing_deadline' ? '法定申報期限' : '預估',
                      event.isFilingDeadline && event.status === 'released' && '同日申報期限',
                      String(event.source || '第三方資料').split(/[・＋]/)[0],
                      event.sourceDate && event.sourceDate !== event.date && `美國 ${event.sourceDate.slice(5)} ${event.time || ''}`,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            {!displayedMonthEarnings.length && (
              <Text style={{ color: colors.textMuted, fontSize: 10, lineHeight: 15, paddingVertical: 5 }}>
                {earningsCalendarLoading ? '正在查詢持倉與收藏標的…' : '本月尚未取得財報日期；部分公司可能尚未提供日期。'}
              </Text>
            )}
            {!!earningsCalendarError && <Text style={{ color: colors.warning, fontSize: 9, lineHeight: 14, marginTop: 4 }}>{earningsCalendarError}</Text>}
            {!!marketCalendarError && <Text style={{ color: colors.warning, fontSize: 9, lineHeight: 14, marginTop: 4 }}>{marketCalendarError}</Text>}
            <Text style={{ color: colors.textMuted, fontSize: 9, lineHeight: 14, marginTop: 5 }}>
              美股預估日可能調整；台股日期是一般曆年制公司的法定申報期限提醒，不代表公司預告日，金控等特殊產業期限可能不同。實際公告請以公開資訊觀測站及公司公告為準。
            </Text>
          </View>}
        </View>}

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

              {dayDetailMode === 'earnings' ? (
                dayDetailEarnings.length ? (
                  <>
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 12 }}>
                      當日財報事件 · {dayDetailEarnings.length} 檔
                    </Text>
                    {dayDetailEarnings.map((event, eventIndex) => {
                      const statusLabel = event.status === 'released'
                        ? '已公告'
                        : event.status === 'recent' ? '最近公布'
                          : event.isFilingDeadline || event.status === 'filing_deadline' ? '法定申報期限' : '預估日期';
                      const tags = [
                        event.isHolding && '持有中',
                        event.isWatchlist && '已收藏',
                        (event.isFilingDeadline || event.status === 'filing_deadline') && '一般期限推算',
                        String(event.source || '第三方資料').split(/[・＋]/)[0],
                        event.sourceDate && event.sourceDate !== event.date
                          && `美國日期 ${event.sourceDate}${event.time ? ` ${event.time}` : ''}`,
                      ].filter(Boolean);
                      return (
                        <TouchableOpacity
                          key={`${event.key}:${eventIndex}`}
                          accessibilityRole="button"
                          accessibilityLabel={`開啟 ${event.symbol} 財報分析`}
                          activeOpacity={0.78}
                          onPress={() => openEarningsAnalysis(event)}
                          style={{
                            backgroundColor: colors.cardAlt,
                            borderWidth: 1,
                            borderColor: colors.borderLight,
                            borderRadius: 12,
                            paddingHorizontal: 14,
                            paddingVertical: 12,
                            marginBottom: 10,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                            <Text style={{ flex: 1, color: colors.text, fontSize: 15, fontWeight: '800' }} numberOfLines={1}>
                              {event.symbol}{event.quarter ? ` · ${event.quarter}` : ''}
                            </Text>
                            <Text style={{ color: event.status === 'released' ? PNL_GAIN_COLOR : colors.accent, fontSize: 12, fontWeight: '800' }}>
                              {statusLabel}
                            </Text>
                          </View>
                          <Text style={{ color: colors.textSub, fontSize: 12, marginBottom: 5 }} numberOfLines={2}>
                            {event.name || event.symbol}
                          </Text>
                          {!!tags.length && (
                            <Text style={{ color: colors.textMuted, fontSize: 10, lineHeight: 15 }}>
                              {tags.join(' · ')}
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </>
                ) : (
                  <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8 }}>
                    此日沒有財報事件
                  </Text>
                )
              ) : performanceMode === 'trade' ? (
                dayDetailDate && dailyPnlMap[dayDetailDate] ? (() => {
                  const pnl = dailyPnlMap[dayDetailDate];
                  const detailRows = [
                    { label: '已實現', value: Number(pnl.realizedDiff) || 0, pct: Number(pnl.realizedPct) || 0, cumulative: Number(pnl.realizedPnl) || 0 },
                    { label: '未實現', value: Number(pnl.unrealizedDiff) || 0, pct: Number(pnl.unrealizedPct) || 0, cumulative: Number(pnl.unrealizedPnl) || 0 },
                    { label: '總損益', value: Number(pnl.totalDiff ?? pnl.diff) || 0, pct: Number(pnl.totalPct) || 0, cumulative: Number(pnl.totalPnl) || 0 },
                  ];
                  return (
                    <>
                      <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 12 }}>
                        當日變化（相較前一個交易日）
                      </Text>
                      {detailRows.map(row => (
                        <View
                          key={row.label}
                          style={{
                            backgroundColor: colors.cardAlt,
                            borderWidth: 1,
                            borderColor: colors.borderLight,
                            borderRadius: 12,
                            paddingHorizontal: 14,
                            paddingVertical: 12,
                            marginBottom: 10,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                            <Text style={{ flex: 1, color: colors.textSub, fontSize: 13, fontWeight: '700' }}>{row.label}</Text>
                            <Text style={{ color: pnlColor(row.value, colors.textMuted), fontSize: 16, fontWeight: '800' }}>
                              {signedPnlAmount(row.value, fmt)} {currency}
                            </Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ flex: 1, color: colors.textMuted, fontSize: 11 }}>
                              截至當日累計 {signedPnlAmount(row.cumulative, fmt)} {currency}
                            </Text>
                            <Text style={{ color: pnlColor(row.pct, colors.textMuted), fontSize: 12, fontWeight: '700' }}>
                              {signedPnlPercent(row.pct, 2)}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </>
                  );
                })() : (
                  <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8 }}>
                    此日無交易損益資料
                  </Text>
                )
              ) : (
                <>
                  {/* Net worth + daily change */}
                  {dayDetailDate && dailyPnlMap[dayDetailDate] && (() => {
                    const pnl = dailyPnlMap[dayDetailDate];
                    const pct = pnl.prevValue > 0 ? (pnl.diff / pnl.prevValue) * 100 : 0;
                    return (
                      <View style={{ marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.borderLight }}>
                        {dayDetailNetWorth != null && (
                          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
                            {fmt(dayDetailNetWorth)} {currency}
                          </Text>
                        )}
                        <Text style={{ fontSize: 15, fontWeight: '700', color: pnlColor(pnl.diff, colors.textMuted) }}>
                          {signedPnlAmount(pnl.diff, fmt)} {currency} ({signedPnlPercent(pct, 2)})
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
                </>
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
