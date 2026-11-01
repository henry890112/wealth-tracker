import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  PanResponder,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ExternalLink, Landmark, TrendingUp } from 'lucide-react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../lib/ThemeContext';
import { cacheTaiwanForeignHistoryPage, cacheTaiwanMarginHistory, cacheTaiwanMarginHistoryPages, calculateYearOverYear, clearCachedTaiwanForeignHistory, clearCachedTaiwanMarginHistory, fetchCachedMarketPulse, fetchMarketOverview, fetchTaiwanForeignHistory, fetchTaiwanMarginHistory, fetchTaiwanMarginHistoryCacheRange, fetchTwseTaiexCandles, findHistoryPointAtOrBefore, foreignHistoryCoverage, formatMarketPulsePrice, isTaiwanForeignHistoryCacheFresh, isTaiwanMarginHistoryCacheFresh, marginHistoryCoverage, mergeInstitutionalHistoryRows, mergeMarketPulseQuotes, readCachedTaiwanForeignHistoryPages, readCachedTaiwanMarginHistoryPages } from '../services/marketOverview';
import MarketPulseChart from '../components/MarketPulseChart';
import CompactDataTable from '../components/CompactDataTable';
import { calculateInstitutionalFlowTotals } from '../utils/institutionalTotals';
import { marginIndexRelativePoints } from '../utils/marginIndexComparison';

const numberText = (value, digits = 2) => Number.isFinite(Number(value))
  ? Number(value).toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  : '—';

const dateText = value => value || '資料日期未知';

const percentText = value => value != null && value !== '' && Number.isFinite(Number(value))
  ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}%`
  : '—';

const changeFromPreviousPercent = (current, previous) => previous > 0
  ? (current / previous - 1) * 100
  : null;

const analysisPercentText = value => {
  if (value == null || !Number.isFinite(value)) return '—';
  const digits = value !== 0 && Math.abs(value) < 0.005 ? 4 : 2;
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
};

const analysisChangeColor = (value, colors) => value > 0
  ? colors.positive
  : value < 0 ? colors.negative : colors.textSub;

const marginBalanceChangeColor = (value, colors) => value > 0
  ? colors.negative
  : value < 0 ? colors.positive : colors.textSub;

const amountYi = value => value != null && Number.isFinite(Number(value))
  ? `${Number(value).toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} 億`
  : '—';

const INSTITUTIONAL_TYPES = [
  { key: 'foreign', label: '外資' }, { key: 'trust', label: '投信' },
  { key: 'dealer', label: '自營商' }, { key: 'all', label: '三大法人' },
  { key: 'directional', label: '外資＋投信' },
];
const institutionalLabel = key => INSTITUTIONAL_TYPES.find(item => item.key === key)?.label || '外資';

const quoteStateText = quote => {
  if (!quote) return '資料暫缺';
  if (quote.is_stale) return '快取行情';
  const labels = {
    intraday: '盤中',
    official_close: '正式收盤',
    delayed: '延遲行情',
    reference: '參考行情',
  };
  return labels[quote.quote_status] || '最新行情';
};

const quoteTimeText = quote => {
  const value = quote?.source_time || quote?.price_time;
  if (!value) return '時間未知';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
};

const PERIODS = [
  { key: '1M', label: '1M', description: '1 個月', days: 31 },
  { key: '3M', label: '3M', description: '3 個月', days: 93 },
  { key: '6M', label: '6M', description: '6 個月', days: 186 },
  { key: '1Y', label: '1Y', description: '1 年', days: 366 },
  { key: '3Y', label: '3Y', description: '3 年', days: 1098 },
];
const YIELD_PERIODS = [
  { key: '1M', label: '近一月', description: '近一個月', days: 31 },
  { key: '3M', label: '近三月', description: '近三個月', days: 93 },
  { key: '1Y', label: '近一年', description: '近一年', days: 366 },
];

const filterPeriod = (series, period, periods = PERIODS) => {
  if (!Array.isArray(series) || !series.length) return [];
  const days = periods.find(item => item.key === period)?.days || 366;
  const newest = new Date(`${series[series.length - 1].date}T00:00:00Z`).getTime();
  const cutoff = newest - days * 86400000;
  return series.filter(item => new Date(`${item.date}T00:00:00Z`).getTime() >= cutoff);
};

function useAlignedFlowChartScroll(scrollRef, pointSpacing) {
  const [layout, setLayout] = useState({ viewportWidth: 0, contentWidth: 0 });
  useEffect(() => {
    if (!layout.viewportWidth || !layout.contentWidth) return;
    const maxOffset = Math.max(0, layout.contentWidth - layout.viewportWidth);
    const alignedOffset = Math.floor(maxOffset / pointSpacing) * pointSpacing;
    scrollRef.current?.scrollTo({ x: alignedOffset, animated: false });
  }, [layout, pointSpacing, scrollRef]);
  return {
    onLayout: event => setLayout(current => ({ ...current, viewportWidth: event.nativeEvent.layout.width })),
    onContentSizeChange: contentWidth => setLayout(current => ({ ...current, contentWidth })),
  };
}

const aggregateYieldWeeklyCandles = series => {
  const weeks = new Map();
  (series || []).forEach(point => {
    const value = Number(point?.value);
    const date = String(point?.date || '');
    if (!Number.isFinite(value) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const weekStart = new Date(`${date}T00:00:00Z`);
    weekStart.setUTCDate(weekStart.getUTCDate() - (weekStart.getUTCDay() + 6) % 7);
    const key = weekStart.toISOString().slice(0, 10);
    const candle = weeks.get(key);
    if (!candle) {
      weeks.set(key, { date, startDate: date, open: value, high: value, low: value, close: value });
      return;
    }
    candle.date = date;
    candle.high = Math.max(candle.high, value);
    candle.low = Math.min(candle.low, value);
    candle.close = value;
  });
  return [...weeks.values()].sort((left, right) => left.date.localeCompare(right.date));
};

function ChipRow({ items, selected, onSelect, colors }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {items.map(item => {
        const key = typeof item === 'string' ? item : item.key;
        const label = typeof item === 'string' ? item : item.label || item.key;
        const active = selected === key;
        return (
          <TouchableOpacity
            key={key}
            onPress={() => onSelect(key)}
            style={[styles.chip, { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accentSoft : colors.cardAlt }]}
          >
            <Text style={[styles.chipText, { color: active ? colors.accent : colors.textSub }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function HistoricalTrendChart({ series, colors, suffix = '', compact = false, onPointChange }) {
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(280, width - 64);
  const chartHeight = compact ? 160 : 220;
  const pad = compact ? { left: 40, right: 14, top: 14, bottom: 24 } : { left: 44, right: 16, top: 24, bottom: 30 };
  const [selectedIndex, setSelectedIndex] = useState(null);
  const points = useMemo(() => {
    if (!series?.length) return [];
    const values = series.map(item => Number(item.value));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const rawRange = max - min;
    const range = rawRange || Math.max(Math.abs(max) * 0.05, 1);
    const yMin = min - range * 0.12;
    const yMax = max + range * 0.12;
    const plotWidth = chartWidth - pad.left - pad.right;
    const plotHeight = chartHeight - pad.top - pad.bottom;
    return series.map((item, index) => ({
      ...item,
      x: pad.left + index / Math.max(1, series.length - 1) * plotWidth,
      y: pad.top + (1 - (Number(item.value) - yMin) / (yMax - yMin)) * plotHeight,
      yMin,
      yMax,
    }));
  }, [series, chartWidth, compact]);
  const selectAt = useCallback(x => {
    if (!points.length) return;
    const plotWidth = chartWidth - pad.left - pad.right;
    const ratio = Math.max(0, Math.min(1, (x - pad.left) / plotWidth));
    const nextIndex = Math.round(ratio * (points.length - 1));
    setSelectedIndex(nextIndex);
    onPointChange?.(points[nextIndex]);
  }, [points, chartWidth, onPointChange]);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 3 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: event => selectAt(event.nativeEvent.locationX),
    onPanResponderMove: event => selectAt(event.nativeEvent.locationX),
  }), [selectAt]);

  if (points.length < 2) {
    return <View style={[styles.noChart, { backgroundColor: colors.cardAlt }]}><Text style={{ color: colors.textMuted }}>這個期間的歷史資料不足</Text></View>;
  }
  const chosen = points[Math.min(selectedIndex ?? points.length - 1, points.length - 1)];
  const yMin = points[0].yMin;
  const yMax = points[0].yMax;
  const plotHeight = chartHeight - pad.top - pad.bottom;
  const linePoints = points.map(point => `${point.x},${point.y}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <View>
      <View style={styles.chartReadout}>
        <Text style={[styles.chartValue, { color: colors.accent }]}>{numberText(chosen.value)}{suffix}</Text>
        <Text style={[styles.chartDate, { color: colors.textMuted }]}>{chosen.date}</Text>
      </View>
      <View {...panResponder.panHandlers}>
        <Svg width={chartWidth} height={chartHeight}>
          {[0, 0.5, 1].map(position => {
            const y = pad.top + position * plotHeight;
            const value = yMax - position * (yMax - yMin);
            return (
              <React.Fragment key={position}>
                <Line x1={pad.left} y1={y} x2={chartWidth - pad.right} y2={y} stroke={colors.border} strokeWidth="1" />
                <SvgText x={pad.left - 6} y={y + 4} textAnchor="end" fill={colors.textMuted} fontSize={compact ? '9' : '10'}>{numberText(value, 1)}</SvgText>
              </React.Fragment>
            );
          })}
          <Polyline points={linePoints} fill="none" stroke={colors.accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <Line x1={chosen.x} y1={pad.top} x2={chosen.x} y2={chartHeight - pad.bottom} stroke={colors.textMuted} strokeDasharray="4 4" />
          <Circle cx={chosen.x} cy={chosen.y} r="5" fill={colors.card} stroke={colors.accent} strokeWidth="3" />
          <SvgText x={pad.left} y={chartHeight - 8} fill={colors.textMuted} fontSize={compact ? '9' : '10'}>{first.date.slice(0, 7)}</SvgText>
          <SvgText x={chartWidth - pad.right} y={chartHeight - 8} textAnchor="end" fill={colors.textMuted} fontSize={compact ? '9' : '10'}>{last.date.slice(0, 7)}</SvgText>
        </Svg>
      </View>
      <Text style={[styles.dragHint, { color: colors.textMuted }]}>在圖上左右拖曳，可查看各日期數值</Text>
    </View>
  );
}

function YieldCandlestickChart({ series, colors, onPointChange }) {
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(280, width - 64);
  const chartHeight = 184;
  const pad = { left: 42, right: 14, top: 14, bottom: 26 };
  const [selectedIndex, setSelectedIndex] = useState(null);
  const candles = useMemo(() => aggregateYieldWeeklyCandles(series), [series]);
  const plotWidth = chartWidth - pad.left - pad.right;
  const plotHeight = chartHeight - pad.top - pad.bottom;
  const lowValue = candles.length ? Math.min(...candles.map(item => item.low)) : 0;
  const highValue = candles.length ? Math.max(...candles.map(item => item.high)) : 1;
  const span = highValue - lowValue;
  const margin = Math.max(span * 0.12, Math.abs(highValue) * 0.002, 0.01);
  const yMin = lowValue - margin;
  const yMax = highValue + margin;
  const y = value => pad.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;
  const x = index => pad.left + (index + 0.5) / Math.max(1, candles.length) * plotWidth;
  const chooseAt = useCallback(locationX => {
    if (!candles.length) return;
    const index = Math.max(0, Math.min(candles.length - 1, Math.floor((locationX - pad.left) / plotWidth * candles.length)));
    const candle = candles[index];
    setSelectedIndex(index);
    onPointChange?.({ date: candle.date, value: candle.close });
  }, [candles, onPointChange, plotWidth]);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 3 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: event => chooseAt(event.nativeEvent.locationX),
    onPanResponderMove: event => chooseAt(event.nativeEvent.locationX),
  }), [chooseAt]);

  if (candles.length < 2) {
    return <View style={[styles.noChart, { backgroundColor: colors.cardAlt }]}><Text style={{ color: colors.textMuted }}>這個期間的歷史資料不足</Text></View>;
  }

  const chosen = candles[Math.min(selectedIndex ?? candles.length - 1, candles.length - 1)];
  const step = plotWidth / candles.length;
  const bodyWidth = Math.max(1, Math.min(9, step * 0.62));

  return (
    <View>
      <View style={styles.chartReadout}>
        <Text style={[styles.chartValue, { color: colors.accent }]}>{numberText(chosen.close)}%</Text>
        <Text style={[styles.chartDate, { color: colors.textMuted }]}>{chosen.date}</Text>
      </View>
      <Text style={[styles.dragHint, { color: colors.textSub }]}>
        開 {numberText(chosen.open)}%　高 {numberText(chosen.high)}%　低 {numberText(chosen.low)}%　收 {numberText(chosen.close)}%
      </Text>
      <View {...panResponder.panHandlers}>
        <Svg width={chartWidth} height={chartHeight}>
          {[0, 0.5, 1].map(position => {
            const value = yMax - position * (yMax - yMin);
            const lineY = pad.top + position * plotHeight;
            return <React.Fragment key={position}><Line x1={pad.left} y1={lineY} x2={chartWidth - pad.right} y2={lineY} stroke={colors.border} strokeWidth="1" /><SvgText x={pad.left - 6} y={lineY + 4} textAnchor="end" fill={colors.textMuted} fontSize="9">{numberText(value, 2)}</SvgText></React.Fragment>;
          })}
          {candles.map((candle, index) => {
            const candleX = x(index);
            const rising = candle.close >= candle.open;
            const color = rising ? colors.positive : colors.negative;
            const bodyTop = Math.min(y(candle.open), y(candle.close));
            const bodyHeight = Math.max(1.5, Math.abs(y(candle.open) - y(candle.close)));
            return <React.Fragment key={`${candle.date}:${index}`}><Line x1={candleX} x2={candleX} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth="1.25" /><Rect x={candleX - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} /></React.Fragment>;
          })}
          {selectedIndex !== null && <Line x1={x(Math.min(selectedIndex, candles.length - 1))} x2={x(Math.min(selectedIndex, candles.length - 1))} y1={pad.top} y2={chartHeight - pad.bottom} stroke={colors.textMuted} strokeDasharray="4 4" />}
          <SvgText x={pad.left} y={chartHeight - 7} fill={colors.textMuted} fontSize="9">{candles[0].startDate.slice(0, 7)}</SvgText>
          <SvgText x={chartWidth - pad.right} y={chartHeight - 7} textAnchor="end" fill={colors.textMuted} fontSize="9">{candles.at(-1).date.slice(0, 7)}</SvgText>
        </Svg>
      </View>
      <Text style={[styles.dragHint, { color: colors.textMuted }]}>左右拖曳選擇週 K；OHLC 為每日收盤值彙整</Text>
    </View>
  );
}

function YieldAnalysisModal({ visible, onClose, tenor, periodLabel, series, colors }) {
  const latest = series?.at(-1);
  const first = series?.[0];
  const highest = series?.reduce((best, point) => !best || point.value > best.value ? point : best, null);
  const lowest = series?.reduce((best, point) => !best || point.value < best.value ? point : best, null);
  const periodChangeBps = latest && first ? (latest.value - first.value) * 100 : null;
  const rows = (series || []).slice().reverse().map((point, index, reversed) => {
    const previous = reversed[index + 1];
    return { ...point, changeBps: previous ? (point.value - previous.value) * 100 : null };
  });
  const formatBasisPoints = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)} bp` : '—';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.marginAnalysisModal, { backgroundColor: colors.bg }]}>
        <View style={styles.marginAnalysisHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.marginAnalysisTitle, { color: colors.text }]}>{tenor} 美國公債殖利率</Text>
            <Text style={[styles.marginAnalysisSub, { color: colors.textSub }]}>完整分析 · {periodLabel} · {series?.length || 0} 個交易日</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="關閉殖利率完整分析" onPress={onClose} style={[styles.marginAnalysisClose, { backgroundColor: colors.cardAlt }]}><Text style={{ color: colors.accent, fontWeight: '700' }}>完成</Text></TouchableOpacity>
        </View>
        <View style={[styles.yieldAnalysisSummary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.yieldAnalysisSummaryTop}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.marginAnalysisSub, { color: colors.textSub }]}>最新殖利率 · {latest?.date || '—'}</Text>
              <Text style={[styles.yieldAnalysisLatest, { color: colors.accent }]}>{latest ? `${numberText(latest.value)}%` : '—'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.marginAnalysisSub, { color: colors.textSub }]}>區間變動</Text>
              <Text style={[styles.yieldAnalysisLatest, { color: periodChangeBps > 0 ? colors.positive : periodChangeBps < 0 ? colors.negative : colors.textSub }]}>{formatBasisPoints(periodChangeBps)}</Text>
            </View>
          </View>
          <Text style={[styles.marginAnalysisSub, { color: colors.textSub, marginTop: 8 }]}>區間高點 {highest ? `${numberText(highest.value)}% · ${highest.date}` : '—'}　低點 {lowest ? `${numberText(lowest.value)}% · ${lowest.date}` : '—'}</Text>
        </View>
        <Text style={[styles.marginAnalysisSection, { color: colors.text, marginTop: 18 }]}>逐日資料</Text>
        <Text style={[styles.marginAnalysisSub, { color: colors.textSub, marginBottom: 8 }]}>由新到舊；較前一個有資料日以殖利率百分點換算基點（bp）。</Text>
        {rows.length ? <CompactDataTable style={{ flex: 1 }} maxHeight={520} rows={rows} rowKey={item => item.date} colors={colors} fixedColumn={{ header: '日期', width: 88, render: item => item.date }} columns={[{ key: 'yield', header: '殖利率', width: 92, render: item => `${numberText(item.value)}%` }, { key: 'change', header: '較前筆', width: 92, render: item => formatBasisPoints(item.changeBps), color: item => item.changeBps > 0 ? colors.positive : item.changeBps < 0 ? colors.negative : colors.textSub }]} /> : <Text style={[styles.marginAnalysisSub, { color: colors.textMuted, paddingVertical: 18 }]}>這段期間沒有可用的殖利率資料。</Text>}
        <Text style={[styles.marginAnalysisSub, { color: colors.textMuted, marginTop: 8, marginBottom: 12 }]}>資料來源：FRED 每日殖利率觀測；K 線的週內高低為收盤值極值，非盤中價格。</Text>
      </View>
    </Modal>
  );
}

function YieldCurve({ yields, colors, compact = false }) {
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(280, width - 64);
  const chartHeight = compact ? 132 : 180;
  const pad = compact ? { left: 32, right: 16, top: 12, bottom: 25 } : { left: 34, right: 18, top: 20, bottom: 32 };
  if (!Array.isArray(yields) || yields.length < 2) return null;
  const values = yields.map(item => Number(item.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.25, max - min);
  const yMin = min - range * 0.18;
  const yMax = max + range * 0.18;
  const plotWidth = chartWidth - pad.left - pad.right;
  const plotHeight = chartHeight - pad.top - pad.bottom;
  const pointAt = (item, index) => ({
    ...item,
    x: pad.left + index / Math.max(1, yields.length - 1) * plotWidth,
    y: pad.top + (1 - (Number(item.value) - yMin) / (yMax - yMin)) * plotHeight,
  });
  const points = yields.map(pointAt);
  const polyline = points.map(point => `${point.x},${point.y}`).join(' ');

  return (
    <Svg width={chartWidth} height={chartHeight}>
      {[0, 0.5, 1].map(position => {
        const y = pad.top + position * plotHeight;
        const value = yMax - position * (yMax - yMin);
        return (
          <React.Fragment key={position}>
            <Line x1={pad.left} y1={y} x2={chartWidth - pad.right} y2={y} stroke={colors.border} strokeWidth="1" />
            <SvgText x={pad.left - 6} y={y + 4} textAnchor="end" fill={colors.textMuted} fontSize={compact ? '9' : '10'}>{value.toFixed(1)}%</SvgText>
          </React.Fragment>
        );
      })}
      <Polyline points={polyline} fill="none" stroke={colors.accent} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {points.map(point => (
        <React.Fragment key={point.tenor}>
          <Circle cx={point.x} cy={point.y} r={compact ? '4' : '5'} fill={colors.card} stroke={colors.accent} strokeWidth={compact ? '2' : '3'} />
          <SvgText x={point.x} y={point.y - 8} textAnchor="middle" fill={colors.text} fontSize={compact ? '9' : '11'} fontWeight="700">{Number(point.value).toFixed(2)}</SvgText>
          <SvgText x={point.x} y={chartHeight - 8} textAnchor="middle" fill={colors.textSub} fontSize={compact ? '10' : '11'}>{point.tenor}</SvgText>
        </React.Fragment>
      ))}
    </Svg>
  );
}

function SourceLink({ label, url, colors }) {
  return (
    <TouchableOpacity style={styles.sourceLink} onPress={() => Linking.openURL(url)} activeOpacity={0.7}>
      <ExternalLink size={13} color={colors.accent} />
      <Text style={[styles.sourceText, { color: colors.accent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function MarginChangeChart({ history, market, colors }) {
  const { width } = useWindowDimensions();
  const chartScrollRef = useRef(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const points = (history || []).flatMap(row => row?.[market] && Number.isFinite(Number(row[market].change)) && row[market].change != null
    ? [{ ...row[market], date: row.date, valueYi: row[market].change / 1e8 }] : []);
  if (!points.length) return <Text style={[styles.flowChartEmpty, { color: colors.textMuted }]}>這段期間沒有兩市同日的融資資料；可切換個別市場查看。</Text>;
  const chosen = points.find(point => point.date === selectedDate) || points[points.length - 1];
  const chartWidth = Math.max(width - 64, points.length * 48 + 36);
  const baseline = 96;
  const positiveMax = Math.max(1, ...points.map(point => Math.max(0, point.valueYi)));
  const negativeMax = Math.max(1, ...points.map(point => Math.max(0, -point.valueYi)));
  const signColor = value => value > 0 ? colors.negative : value < 0 ? colors.positive : colors.textMuted;
  return (
    <View style={[styles.flowChartPanel, { backgroundColor: colors.cardAlt }]}>
      <View style={styles.flowChartHeader}>
        <View>
          <Text style={[styles.flowChartTitle, { color: colors.text }]}>融資單日增減</Text>
          <Text style={[styles.flowChartHint, { color: colors.textMuted }]}>逐日增減 · 單位：億元</Text>
        </View>
        <View style={styles.flowChartReadout}>
          <Text style={[styles.flowChartSelected, { color: signColor(chosen.valueYi) }]}>{chosen.valueYi > 0 ? '+' : ''}{amountYi(chosen.valueYi)}</Text>
          <Text style={[styles.metricDate, { color: colors.textMuted }]}>{chosen.date}</Text>
        </View>
      </View>
      <ScrollView ref={chartScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.flowChartScroll} onContentSizeChange={() => chartScrollRef.current?.scrollToEnd({ animated: false })} nestedScrollEnabled>
        <Svg width={chartWidth} height={210}>
          <Line x1={14} y1={baseline} x2={chartWidth - 14} y2={baseline} stroke={colors.border} strokeWidth={1.5} />
          {points.map((point, index) => {
            const x = 25 + index * 48;
            const positive = point.valueYi >= 0;
            const height = Math.max(2, Math.min(positive ? 58 : 77, Math.abs(point.valueYi) / (positive ? positiveMax : negativeMax) * (positive ? 58 : 77)));
            const y = positive ? baseline - height : baseline;
            const active = point.date === chosen.date;
            const magnitude = Math.abs(point.valueYi);
            const label = `${point.valueYi > 0 ? '+' : point.valueYi < 0 ? '-' : ''}${magnitude < 10 ? magnitude.toFixed(1) : magnitude.toFixed(0)}`;
            return (
              <React.Fragment key={point.date}>
                <Rect x={x - 8} y={20} width={40} height={163} fill="transparent" onPress={() => setSelectedDate(point.date)} />
                <Rect x={x} y={y} width={24} height={height} rx={3} fill={signColor(point.valueYi)} opacity={active ? 1 : 0.78} onPress={() => setSelectedDate(point.date)} />
                <SvgText x={x + 12} y={positive ? y - 6 : y + height + 14} textAnchor="middle" fill={signColor(point.valueYi)} fontSize="10" fontWeight={active ? '800' : '600'}>{label}</SvgText>
                <SvgText x={x + 12} y={198} textAnchor="middle" fill={colors.textMuted} fontSize="9">{point.date.slice(5).replace('-', '/')}</SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      </ScrollView>
      <Text style={[styles.flowChartHint, { color: colors.textMuted }]}>柱上為增減幅度；點柱子看含正負號的精確數字。紅色為增加、綠色為減少，不代表股價方向。</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => setAnalysisOpen(true)} style={[styles.marginAnalysisButton, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
        <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '800' }}>完整分析 · 查看每日資料 ›</Text>
      </TouchableOpacity>
      <MarginDailyAnalysisModal
        visible={analysisOpen}
        onClose={() => setAnalysisOpen(false)}
        points={points}
        selectedDate={chosen.date}
        market={market}
        colors={colors}
        onSelectDate={date => {
          setSelectedDate(date);
          const index = points.findIndex(point => point.date === date);
          chartScrollRef.current?.scrollTo({ x: Math.max(0, index * 48 - width / 2), animated: true });
        }}
      />
    </View>
  );
}

function MarginDailyAnalysisModal({ visible, onClose, points, selectedDate, market, colors, onSelectDate }) {
  const selected = points.find(point => point.date === selectedDate) || points.at(-1);
  const first = points[0];
  const last = points.at(-1);
  const periodChange = first && last ? (last.balance - first.balance) / 1e8 : null;
  const marketLabel = market === 'combined' ? '兩市' : market === 'twse' ? '上市' : '上櫃';
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.marginAnalysisModal, { backgroundColor: colors.bg }]}>
        <View style={styles.marginAnalysisHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.marginAnalysisTitle, { color: colors.text }]}>{marketLabel}融資每日增減</Text>
            <Text style={[styles.marginAnalysisSub, { color: colors.textSub }]}>完整分析 · {points.length} 個有增減資料的交易日</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="關閉融資每日增減分析" onPress={onClose} style={[styles.marginAnalysisClose, { backgroundColor: colors.cardAlt }]}><Text style={{ color: colors.accent, fontWeight: '700' }}>完成</Text></TouchableOpacity>
        </View>
        <View style={[styles.marginAnalysisSummary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.marginAnalysisSection, { color: colors.text }]}>首末餘額變動</Text>
          <Text style={[styles.foreignAnalysisTotal, { color: periodChange > 0 ? colors.negative : periodChange < 0 ? colors.positive : colors.textSub }]}>{periodChange > 0 ? '+' : ''}{amountYi(periodChange)}</Text>
          <Text style={[styles.marginAnalysisSub, { color: colors.textSub }]}>{first?.date} ～ {last?.date} · 由首末餘額相減；不是買進金額</Text>
        </View>
        <Text style={[styles.marginAnalysisSection, { color: colors.text, marginTop: 18 }]}>逐日資料</Text>
        <Text style={[styles.marginAnalysisSub, { color: colors.textSub, marginBottom: 8 }]}>單位：億元；由新到舊，點選一列回到圖表。</Text>
        <CompactDataTable style={{ flex: 1 }} maxHeight={520} rows={points.slice().reverse().map(item => ({ ...item, selected: item.date === selected?.date }))} rowKey={item => item.date} colors={colors}
          fixedColumn={{ header: '日期', width: 72, render: item => item.date.slice(5).replace('-', '/') }}
          columns={[{ key: 'balance', header: '融資餘額', width: 94, render: item => numberText(item.balance / 1e8, 1) }, { key: 'change', header: '較前日(億)', width: 94, render: item => item.change == null ? '—' : `${item.change > 0 ? '+' : ''}${numberText(item.change / 1e8, 1)}`, color: item => item.change == null ? colors.textMuted : item.change > 0 ? colors.negative : item.change < 0 ? colors.positive : colors.textSub }, { key: 'percent', header: '較前日(%)', width: 94, render: item => analysisPercentText(changeFromPreviousPercent(item.balance, item.previous)), color: item => { const value = changeFromPreviousPercent(item.balance, item.previous); return value == null ? colors.textMuted : value > 0 ? colors.negative : value < 0 ? colors.positive : colors.textSub; } }]}
          onRowPress={item => { onSelectDate(item.date); onClose(); }} rowAccessibilityLabel={item => `${item.date} 融資餘額 ${amountYi(item.balance / 1e8)}，點選回到圖表`} />
        <Text style={[styles.marginAnalysisSub, { color: colors.textMuted, marginTop: 8, marginBottom: 12 }]}>較前日依官方前日餘額計算；紅色為融資增加、綠色為減少。僅列實際取得資料的日期；兩市合計須同日齊備。</Text>
      </View>
    </Modal>
  );
}

function MarginPeriodSelector({ period, onSelect, colors }) {
  return (
    <View style={styles.flowPeriodRow}>
      {[{ key: '1M', label: '近一月' }, { key: '3M', label: '近三月' }, { key: '1Y', label: '近一年' }].map(option => (
        <TouchableOpacity key={option.key} accessibilityRole="button" accessibilityState={{ selected: period === option.key }} onPress={() => { if (period !== option.key) onSelect(option.key); }} style={[styles.flowPeriodButton, { backgroundColor: period === option.key ? colors.accentSoft : colors.card }]}>
          <Text style={{ color: period === option.key ? colors.accent : colors.textSub, fontSize: 12, fontWeight: '700' }}>{option.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ForeignAnalysisModal({ visible, onClose, points, selectedDate, market, category, colors, onSelectDate }) {
  const total = points.reduce((sum, point) => sum + point.net, 0);
  const periodTotals = calculateInstitutionalFlowTotals(points);
  const selected = points.find(point => point.date === selectedDate) || points.at(-1);
  const dailyChanges = new Map();
  points.forEach((point, index) => {
    const previous = points[index - 1];
    const change = previous ? point.net - previous.net : null;
    dailyChanges.set(point.date, {
      change,
      changePercent: previous && previous.net !== 0 ? (change / Math.abs(previous.net)) * 100 : null,
    });
  });
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.marginAnalysisModal, { backgroundColor: colors.bg }]}>
        <View style={styles.marginAnalysisHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.marginAnalysisTitle, { color: colors.text }]}>{market === 'combined' ? '兩市' : market === 'twse' ? '上市' : '上櫃'}{institutionalLabel(category)}買賣超</Text>
            <Text style={[styles.marginAnalysisSub, { color: colors.textSub }]}>完整分析 · {points.length} 個交易日</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="關閉法人完整分析" onPress={onClose} style={[styles.marginAnalysisClose, { backgroundColor: colors.cardAlt }]}><Text style={{ color: colors.accent, fontWeight: '700' }}>完成</Text></TouchableOpacity>
        </View>
        <View style={[styles.marginAnalysisSummary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.marginAnalysisSection, { color: colors.text }]}>區間合計</Text>
          <Text style={[styles.foreignAnalysisTotal, { color: analysisChangeColor(total, colors) }]}>{total > 0 ? '+' : ''}{amountYi(total)}</Text>
          <Text style={[styles.marginAnalysisSub, { color: colors.textSub }]}>{points[0]?.date} ～ {points.at(-1)?.date} · 買超 {points.filter(point => point.net > 0).length} 日 · 賣超 {points.filter(point => point.net < 0).length} 日</Text>
        </View>
        <View style={styles.foreignPeriodGrid}>
          {periodTotals.map(period => (
            <View key={period.days} style={[styles.foreignPeriodCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.foreignPeriodLabel, { color: colors.accent }]}>{period.days} 日合計</Text>
              <Text style={[styles.foreignPeriodValue, { color: period.complete ? analysisChangeColor(period.net, colors) : colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>
                {period.complete ? `${period.net > 0 ? '+' : ''}${amountYi(period.net)}` : '—'}
              </Text>
              <Text style={[styles.marginAnalysisSub, { color: colors.textSub }]} numberOfLines={1}>
                {period.complete ? `買 ${amountYi(period.buy)} · 賣 ${amountYi(period.sell)}` : `目前僅有 ${period.availableDays} 個交易日`}
              </Text>
            </View>
          ))}
        </View>
        <Text style={[styles.marginAnalysisSub, { color: colors.textSub }]}>依最新已取得交易日計算；不足 5／10／20／30 日時不顯示合計。</Text>
        <Text style={[styles.marginAnalysisSection, { color: colors.text, marginTop: 18 }]}>逐日資料</Text>
        <Text style={[styles.marginAnalysisSub, { color: colors.textSub, marginBottom: 8 }]}>單位：億元；日期由新到舊。點選一列回到圖表，表格可左右滑動。</Text>
        <CompactDataTable style={{ flex: 1 }} maxHeight={520} rows={points.slice().reverse().map(item => ({ ...item, selected: item.date === selected?.date }))} rowKey={item => item.date} colors={colors}
          fixedColumn={{ header: '日期', width: 72, render: item => item.date.slice(5).replace('-', '/') }}
          columns={[{ key: 'buy', header: '買進', width: 92, render: item => numberText(item.buy, 1) }, { key: 'sell', header: '賣出', width: 92, render: item => numberText(item.sell, 1) }, { key: 'net', header: '買賣超', width: 92, render: item => `${item.net > 0 ? '+' : ''}${numberText(item.net, 1)}`, color: item => analysisChangeColor(item.net, colors) }, { key: 'change', header: '較前日(億)', width: 92, render: item => { const value = dailyChanges.get(item.date)?.change; return value == null ? '—' : `${value > 0 ? '+' : ''}${numberText(value, 1)}`; }, color: item => analysisChangeColor(dailyChanges.get(item.date)?.change, colors) }, { key: 'percent', header: '較前日(%)', width: 92, render: item => analysisPercentText(dailyChanges.get(item.date)?.changePercent), color: item => analysisChangeColor(dailyChanges.get(item.date)?.changePercent, colors) }]}
          onRowPress={item => { onSelectDate(item.date); onClose(); }} rowAccessibilityLabel={item => `${item.date} ${institutionalLabel(category)}買賣超 ${amountYi(item.net)}，點選回到圖表`} />
        <Text style={[styles.marginAnalysisSub, { color: colors.textMuted, marginTop: 8, marginBottom: 12 }]}>較前日為前一個有資料的交易日；買賣超變化率＝淨額變化 ÷ 前筆淨額絕對值，前筆為 0 則顯示 —。綠色代表淨買賣超改善、紅色代表轉弱，不代表股價漲跌。外資不含外資自營商；自營商含自行買賣與避險。三大法人＝外資＋投信＋自營商；兩市合計僅採同日齊備資料。</Text>
      </View>
    </Modal>
  );
}

function ForeignNetChart({ history, market, category, colors }) {
  const { width } = useWindowDimensions();
  const chartScrollRef = useRef(null);
  const chartScrollLayout = useAlignedFlowChartScroll(chartScrollRef, 44);
  const [selectedDate, setSelectedDate] = useState(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const points = (history || []).flatMap(row => {
    const item = row?.[market]?.[category];
    return item && [item.buy, item.sell, item.net].every(value => value != null && Number.isFinite(Number(value)))
      ? [{ date: row.date, buy: item.buy / 1e8, sell: item.sell / 1e8, net: item.net / 1e8 }] : [];
  });
  if (!points.length) return <Text style={[styles.flowChartEmpty, { color: colors.textMuted }]}>此期間沒有{market === 'combined' ? '兩市同日' : ''}{institutionalLabel(category)}資料；可切換市場查看。</Text>;
  const chosen = points.find(point => point.date === selectedDate) || points.at(-1);
  const chartWidth = Math.max(width - 64, points.length * 44 + 24);
  const plotTop = 26;
  const plotBottom = 164;
  const plotHeight = plotBottom - plotTop;
  const positiveMax = Math.max(0, ...points.map(point => point.net));
  const negativeMax = Math.max(0, ...points.map(point => -point.net));
  const totalRange = positiveMax + negativeMax;
  const scale = plotHeight / (totalRange || 1);
  const baseline = totalRange ? plotTop + positiveMax * scale : (plotTop + plotBottom) / 2;
  const color = value => analysisChangeColor(value, colors);
  return (
    <View style={[styles.flowChartPanel, { backgroundColor: colors.cardAlt }]}>
      <View style={styles.flowChartHeader}>
        <View>
          <Text style={[styles.flowChartTitle, { color: colors.text }]}>{institutionalLabel(category)}單日買賣超</Text>
          <Text style={[styles.flowChartHint, { color: colors.textMuted, paddingHorizontal: 0 }]}>單位：億元 · 盤後資料</Text>
        </View>
        <View style={styles.flowChartReadout}>
          <Text style={[styles.flowChartSelected, { color: color(chosen.net) }]}>{chosen.net > 0 ? '+' : ''}{amountYi(chosen.net)}</Text>
          <Text style={[styles.metricDate, { color: colors.textMuted }]}>{chosen.date}</Text>
        </View>
      </View>
      <Text style={[styles.flowChartHint, { color: colors.textSub }]}>買進 {amountYi(chosen.buy)} · 賣出 {amountYi(chosen.sell)}</Text>
      <ScrollView ref={chartScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.flowChartScroll} {...chartScrollLayout} nestedScrollEnabled>
        <Svg width={chartWidth} height={210}>
          <Line x1={14} y1={baseline} x2={chartWidth - 14} y2={baseline} stroke={colors.border} strokeWidth={1.5} />
          {points.map((point, index) => {
            const x = 21 + index * 44;
            const height = Math.max(2, Math.abs(point.net) * scale);
            const positive = point.net >= 0;
            const y = positive ? baseline - height : baseline;
            const active = point.date === chosen.date;
            const magnitude = Math.abs(point.net);
            const label = `${point.net > 0 ? '＋' : point.net < 0 ? '−' : ''}${magnitude >= 10 ? magnitude.toFixed(0) : magnitude.toFixed(1)}`;
            return <React.Fragment key={point.date}>
              <Rect x={x - 8} y={15} width={40} height={170} fill="transparent" onPress={() => setSelectedDate(point.date)} />
              <Rect x={x} y={y} width={24} height={height} rx={3} fill={color(point.net)} opacity={active ? 1 : 0.8} onPress={() => setSelectedDate(point.date)} />
              <SvgText x={x + 12} y={positive ? y - 5 : y + height + 12} textAnchor="middle" fill={color(point.net)} fontSize="11" fontWeight={active ? '800' : '700'}>{label}</SvgText>
              <SvgText x={x + 12} y={198} textAnchor="middle" fill={colors.textMuted} fontSize="9">{point.date.slice(5).replace('-', '/')}</SvgText>
            </React.Fragment>;
          })}
        </Svg>
      </ScrollView>
      <Text style={[styles.flowChartHint, { color: colors.textMuted }]}>綠色買超、紅色賣超；點柱子查看當日買進、賣出與買賣超。</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => setAnalysisOpen(true)} style={[styles.marginAnalysisButton, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
        <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '800' }}>完整分析 · 查看每日資料 ›</Text>
      </TouchableOpacity>
      <ForeignAnalysisModal visible={analysisOpen} onClose={() => setAnalysisOpen(false)} points={points} selectedDate={chosen.date} market={market} category={category} colors={colors} onSelectDate={setSelectedDate} />
    </View>
  );
}

function InstitutionalIndexChart({ history, market, category, colors }) {
  const { width } = useWindowDimensions();
  const [selectedDate, setSelectedDate] = useState(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const indexKey = market === 'tpex' ? 'tpexClose' : 'taiexClose';
  const indexLabel = market === 'tpex' ? '櫃買指數' : '加權指數';
  let running = 0;
  const points = (history || []).flatMap(row => {
    const item = row?.[market]?.[category];
    if (!item || item.net == null || !Number.isFinite(Number(item.net)) || !(Number(row[indexKey]) > 0)) return [];
    running += item.net / 1e8;
    return [{ date: row.date, index: Number(row[indexKey]), cumulative: running, buy: item.buy / 1e8, sell: item.sell / 1e8, net: item.net / 1e8 }];
  });
  if (points.length < 2) return <Text style={[styles.flowChartEmpty, { color: colors.textMuted }]}>此期間缺少足夠的法人與{indexLabel}同日資料。</Text>;
  const chosen = points.find(point => point.date === selectedDate) || points.at(-1);
  const selectedIndex = points.findIndex(point => point.date === chosen.date);
  const previous = points[selectedIndex - 1];
  const chartWidth = Math.max(width - 64, 220);
  const left = 44; const right = chartWidth - 45; const top = 22; const bottom = 183;
  const extent = (key, includeZero = false) => {
    const values = points.map(point => point[key]);
    const low = Math.min(...values, ...(includeZero ? [0] : []));
    const high = Math.max(...values, ...(includeZero ? [0] : []));
    const pad = Math.max((high - low) * 0.12, key === 'index' ? high * 0.002 : 1);
    return [low - pad, high + pad];
  };
  const [indexMin, indexMax] = extent('index');
  const [flowMin, flowMax] = extent('cumulative', true);
  const xAt = index => left + index / Math.max(1, points.length - 1) * (right - left);
  const yAt = (value, min, max) => bottom - (value - min) / (max - min) * (bottom - top);
  const indexLine = points.map((point, index) => `${xAt(index)},${yAt(point.index, indexMin, indexMax)}`).join(' ');
  const flowLine = points.map((point, index) => `${xAt(index)},${yAt(point.cumulative, flowMin, flowMax)}`).join(' ');
  const selectAtTouch = event => {
    const x = event.nativeEvent.locationX;
    if (!Number.isFinite(x)) return;
    const index = Math.max(0, Math.min(points.length - 1, Math.round((x - left) / (right - left) * (points.length - 1))));
    setSelectedDate(points[index].date);
  };
  return <View style={[styles.flowChartPanel, styles.flowComparePanel, { backgroundColor: colors.cardAlt, borderColor: colors.accent }]}>
    <Text style={[styles.flowChartTitle, { color: colors.text, paddingHorizontal: 11, fontSize: 15 }]}>{institutionalLabel(category)}累計買賣超 × {indexLabel}</Text>
    <View style={styles.flowCompareReadout}>
      <Text style={[styles.flowCompareValue, { color: colors.accent }]}>{indexLabel} {numberText(chosen.index, market === 'tpex' ? 2 : 0)} <Text style={{ color: colors.textSub }}>較前 {percentText(changeFromPreviousPercent(chosen.index, previous?.index))}</Text></Text>
      <Text style={[styles.flowCompareValue, { color: '#D5B260' }]}>累計 {chosen.cumulative > 0 ? '+' : ''}{amountYi(chosen.cumulative)}</Text>
      <Text style={[styles.flowCompareValue, { color: analysisChangeColor(chosen.net, colors) }]}>當日 {chosen.net > 0 ? '+' : ''}{amountYi(chosen.net)} <Text style={{ color: colors.textSub }}>買 {amountYi(chosen.buy)} · 賣 {amountYi(chosen.sell)}</Text></Text>
    </View>
    <Text style={[styles.flowChartHint, { color: colors.textMuted }]}>{chosen.date} · 前一共同資料日 {previous?.date || '無資料'}</Text>
    <View style={styles.flowChartScroll}><View style={{ width: chartWidth, height: 220 }}>
      <Svg width={chartWidth} height={220}>
        {[top, (top + bottom) / 2, bottom].map((y, index) => <React.Fragment key={y}>
          <Line x1={left} y1={y} x2={right} y2={y} stroke={colors.border} strokeWidth="1" />
          <SvgText x={left - 5} y={y + 3} textAnchor="end" fill={colors.accent} fontSize="9">{numberText(indexMax - index * (indexMax - indexMin) / 2, 0)}</SvgText>
          <SvgText x={right + 5} y={y + 3} fill="#D5B260" fontSize="9">{numberText(flowMax - index * (flowMax - flowMin) / 2, 0)}</SvgText>
        </React.Fragment>)}
        <Polyline points={indexLine} fill="none" stroke={colors.accent} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
        <Polyline points={flowLine} fill="none" stroke="#D5B260" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
        <Line x1={xAt(selectedIndex)} y1={top} x2={xAt(selectedIndex)} y2={bottom} stroke={colors.textMuted} strokeWidth="1" strokeDasharray="3 4" />
        <Circle cx={xAt(selectedIndex)} cy={yAt(chosen.index, indexMin, indexMax)} r="4.5" fill={colors.cardAlt} stroke={colors.accent} strokeWidth="2.5" />
        <Circle cx={xAt(selectedIndex)} cy={yAt(chosen.cumulative, flowMin, flowMax)} r="4.5" fill={colors.cardAlt} stroke="#D5B260" strokeWidth="2.5" />
        <SvgText x={left} y={211} fill={colors.textMuted} fontSize="9">{points[0].date}</SvgText>
        <SvgText x={right} y={211} textAnchor="end" fill={colors.textMuted} fontSize="9">{points.at(-1).date}</SvgText>
      </Svg>
      <View accessible accessibilityLabel={`法人買賣超與${indexLabel}比較圖，按住並左右拖曳查看同日數值`} style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderTerminationRequest={() => false} onResponderGrant={selectAtTouch} onResponderMove={selectAtTouch} onResponderRelease={selectAtTouch} />
    </View></View>
    <Text style={[styles.flowChartHint, { color: colors.textMuted }]}>藍線／左軸：{indexLabel}；金線／右軸：自本期首個共同資料日起累計買賣超（億元），非持股餘額。雙軸獨立縮放，按住圖表查看同日值。</Text>
    <TouchableOpacity accessibilityRole="button" onPress={() => setAnalysisOpen(true)} style={[styles.marginAnalysisButton, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}><Text style={{ color: colors.accent, fontSize: 13, fontWeight: '800' }}>完整分析 · 查看每日資料 ›</Text></TouchableOpacity>
    <ForeignAnalysisModal visible={analysisOpen} onClose={() => setAnalysisOpen(false)} points={points} selectedDate={chosen.date} market={market} category={category} colors={colors} onSelectDate={setSelectedDate} />
  </View>;
}

function MarginAnalysisModal({ visible, onClose, points, selectedDate, market, colors, onSelectDate }) {
  const peakIndex = points.reduce((best, point, index) => point.index > points[best].index ? index : best, 0);
  const peak = points[peakIndex];
  const lowAfterPeak = points.slice(peakIndex).reduce((lowest, point) => point.index < lowest.index ? point : lowest, peak);
  const milestones = [
    { label: '起', point: points[0] },
    { label: '高', point: peak },
    { label: '低', point: lowAfterPeak },
    { label: '最新', point: points[points.length - 1] },
  ];
  const selected = points.find(point => point.date === selectedDate) || points[points.length - 1];
  const tableRows = points.map((item, index) => ({
    ...item,
    selected: item.date === selected?.date,
    indexChange: changeFromPreviousPercent(item.index, points[index - 1]?.index),
    marginChange: changeFromPreviousPercent(item.margin, points[index - 1]?.margin),
  })).reverse();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.marginAnalysisModal, { backgroundColor: colors.bg }]}>
        <View style={styles.marginAnalysisHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.marginAnalysisTitle, { color: colors.text }]}>{market === 'combined' ? '兩市' : '上市'}融資 × 指數</Text>
            <Text style={[styles.marginAnalysisSub, { color: colors.textSub }]}>完整分析 · {points.length} 個共同資料日</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="關閉完整分析" onPress={onClose} style={[styles.marginAnalysisClose, { backgroundColor: colors.cardAlt }]}><Text style={{ color: colors.accent, fontWeight: '700' }}>完成</Text></TouchableOpacity>
        </View>
        <View style={[styles.marginAnalysisSummary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.marginAnalysisSection, { color: colors.text }]}>區間關鍵日期</Text>
          <Text style={[styles.marginAnalysisSub, { color: colors.textSub }]}>融資變動以指數最高收盤日（{peak.date}）的融資餘額為基準。</Text>
          {milestones.map(({ label, point }) => (
            <View key={`${label}-${point.date}`} style={styles.marginAnalysisMilestone}>
              <Text style={[styles.marginAnalysisBadge, { color: colors.accent }]}>{label}</Text>
              <Text style={[styles.marginAnalysisMilestoneDate, { color: colors.text }]}>{point.date}</Text>
              <Text style={[styles.marginAnalysisMilestoneValue, { color: colors.text }]}>指 <Text style={{ color: colors.accent }}>{numberText(point.index, 0)}</Text> · 融 <Text style={{ color: colors.warning }}>{numberText(point.margin, 1)}</Text> 億</Text>
              <Text style={[styles.marginAnalysisMilestoneChange, { color: marginBalanceChangeColor(changeFromPreviousPercent(point.margin, peak.margin), colors) }]}>{analysisPercentText(changeFromPreviousPercent(point.margin, peak.margin))}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.marginAnalysisSection, { color: colors.text, marginTop: 18 }]}>逐日資料</Text>
        <Text style={[styles.marginAnalysisSub, { color: colors.textSub, marginBottom: 8 }]}>日期由新到舊，點選一列回到圖表；表格可左右滑動。</Text>
        <CompactDataTable style={{ flex: 1 }} maxHeight={520} rows={tableRows} rowKey={item => item.date} colors={colors}
          fixedColumn={{ header: '日期', width: 72, render: item => item.date.slice(5).replace('-', '/') }}
          columns={[{ key: 'index', header: '收盤指數', width: 95, render: item => numberText(item.index, 0), color: () => colors.accent }, { key: 'margin', header: '融資(億)', width: 95, render: item => numberText(item.margin, 1), color: () => colors.warning }, { key: 'indexChange', header: '指數日變', width: 90, render: item => analysisPercentText(item.indexChange), color: item => analysisChangeColor(item.indexChange, colors) }, { key: 'marginChange', header: '融資日變', width: 90, render: item => analysisPercentText(item.marginChange), color: item => marginBalanceChangeColor(item.marginChange, colors) }, { key: 'peak', header: '距融資高點', width: 94, render: item => analysisPercentText(changeFromPreviousPercent(item.margin, peak.margin)), color: item => marginBalanceChangeColor(changeFromPreviousPercent(item.margin, peak.margin), colors) }]}
          onRowPress={item => { onSelectDate(item.date); onClose(); }} rowAccessibilityLabel={item => `${item.date} 指數收盤 ${numberText(item.index, 0)}，融資 ${numberText(item.margin, 1)} 億，點選回到圖表`} />
        <Text style={[styles.marginAnalysisSub, { color: colors.textMuted, marginTop: 8, marginBottom: 12 }]}>僅列指數收盤與融資餘額同日齊備的交易日；日變對照前一共同資料日。高／低為區間收盤指數，較高點日以 {peak.date} 為固定基準。</Text>
      </View>
    </Modal>
  );
}

function MarginIndexComparisonChart({ history, market, colors, period, onPeriodChange }) {
  const { width } = useWindowDimensions();
  const [chartMode, setChartMode] = useState('relative');
  const [selectedDate, setSelectedDate] = useState(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [indexCandles, setIndexCandles] = useState(null);
  const [indexError, setIndexError] = useState(null);
  const [zoomWindow, setZoomWindow] = useState(null);
  const interactionRef = useRef({});
  const pinchRef = useRef(null);
  const panRef = useRef(null);
  const touchRef = useRef(null);
  const firstDate = history?.[0]?.date;
  const lastDate = history?.at(-1)?.date;
  useEffect(() => {
    let active = true;
    setIndexCandles(null);
    setIndexError(null);
    if (market !== 'tpex' && firstDate && lastDate) {
      fetchTwseTaiexCandles(firstDate, lastDate)
        .then(rows => { if (active) setIndexCandles(rows); })
        .catch(error => { if (active) setIndexError(error?.message || '加權指數歷史資料載入失敗'); });
    }
    return () => { active = false; };
  }, [firstDate, lastDate, market]);
  const candlesByDate = useMemo(() => new Map((indexCandles || []).map(row => [row.date, row])), [indexCandles]);
  const points = useMemo(() => (history || []).flatMap(row => {
    const balance = row?.[market]?.balance;
    const candle = candlesByDate.get(row.date);
    return Number(balance) > 0 && Number(candle?.close) > 0
      ? [{ ...candle, index: candle.close, margin: Number(balance) / 1e8 }]
      : [];
  }), [history, market, candlesByDate]);
  const relativePoints = useMemo(() => marginIndexRelativePoints(points), [points]);
  useEffect(() => {
    setZoomWindow(null);
    setSelectedDate(null);
    pinchRef.current = null;
    panRef.current = null;
    touchRef.current = null;
  }, [period, market, firstDate, lastDate]);
  const hasChart = market !== 'tpex' && !indexError && indexCandles && points.length >= 2;
  const safePoints = hasChart ? points : [{ date: '', index: 0, margin: 0 }];
  const chosen = safePoints.find(point => point.date === selectedDate) || safePoints[safePoints.length - 1];
  const chartWidth = Math.max(width - 64, 220);
  const plotLeft = chartMode === 'relative' ? 48 : 40;
  const plotRight = chartWidth - (chartMode === 'relative' ? 16 : 40);
  const plotWidth = plotRight - plotLeft;
  const plotTop = 23;
  const plotBottom = 183;
  const totalPoints = safePoints.length;
  const viewStart = Math.max(0, Math.min(totalPoints - 1, zoomWindow?.start ?? 0));
  const viewEnd = Math.max(viewStart, Math.min(totalPoints - 1, zoomWindow?.end ?? totalPoints - 1));
  const visibleCount = viewEnd - viewStart + 1;
  const isZoomed = visibleCount < totalPoints;
  const visiblePoints = safePoints.slice(viewStart, viewEnd + 1);
  const visibleRelativePoints = relativePoints.slice(viewStart, viewEnd + 1);
  const setWindow = (start, count, selectedIndex = null) => {
    const boundedCount = Math.max(Math.min(6, totalPoints), Math.min(totalPoints, Math.round(count)));
    const boundedStart = Math.max(0, Math.min(totalPoints - boundedCount, Math.round(start)));
    const nextWindow = boundedCount >= totalPoints ? null : { start: boundedStart, end: boundedStart + boundedCount - 1 };
    setZoomWindow(nextWindow);
    if (selectedIndex != null) {
      const index = Math.max(boundedStart, Math.min(boundedStart + boundedCount - 1, Math.round(selectedIndex)));
      setSelectedDate(safePoints[index]?.date || null);
    }
  };
  const indexAtX = (x, start = viewStart, end = viewEnd) => {
    const ratio = Math.max(0, Math.min(1, (x - plotLeft) / plotWidth));
    return Math.max(start, Math.min(end, Math.round(start + ratio * (end - start))));
  };
  const selectAtX = x => {
    if (!Number.isFinite(x)) return;
    setSelectedDate(safePoints[indexAtX(x)]?.date || null);
  };
  const readTouches = event => event?.nativeEvent?.touches || [];
  const localX = (event, touch = readTouches(event)[0]) => {
    const x = touch?.locationX ?? event?.nativeEvent?.locationX;
    return Number.isFinite(x) ? x : null;
  };
  const touchDistance = touches => {
    const [first, second] = touches;
    if (!first || !second) return null;
    const dx = Number(second.pageX) - Number(first.pageX);
    const dy = Number(second.pageY) - Number(first.pageY);
    const distance = Math.hypot(dx, dy);
    return Number.isFinite(distance) && distance > 0 ? distance : null;
  };
  const beginPinch = event => {
    const touches = readTouches(event);
    const distance = touchDistance(touches);
    if (!distance) return;
    const firstX = Number.isFinite(touches[0]?.locationX) ? touches[0].locationX : plotLeft + plotWidth / 2;
    const secondX = Number.isFinite(touches[1]?.locationX) ? touches[1].locationX : firstX;
    const anchorX = (firstX + secondX) / 2;
    const anchorRatio = Math.max(0, Math.min(1, (anchorX - plotLeft) / plotWidth));
    const currentStart = interactionRef.current.viewStart;
    const currentEnd = interactionRef.current.viewEnd;
    const count = currentEnd - currentStart + 1;
    pinchRef.current = {
      distance,
      count,
      anchorIndex: currentStart + anchorRatio * Math.max(0, count - 1),
      anchorRatioInWindow: anchorRatio,
    };
    panRef.current = null;
  };
  const handleGrant = (event, gesture) => {
    const touches = readTouches(event);
    if (touches.length >= 2) {
      if (touchRef.current) {
        touchRef.current.moved = true;
        touchRef.current.pinched = true;
      }
      beginPinch(event);
      return;
    }
    const x = localX(event);
    if (x == null) return;
    const dx = Number(gesture?.dx) || 0;
    touchRef.current = { moved: true, pinched: false };
    const currentStart = interactionRef.current.viewStart;
    const currentEnd = interactionRef.current.viewEnd;
    if (interactionRef.current.isZoomed) {
      panRef.current = { baseX: x - dx, start: currentStart, count: currentEnd - currentStart + 1 };
    } else {
      selectAtX(x);
    }
  };
  const handleMove = event => {
    const touches = readTouches(event);
    if (touches.length >= 2) {
      if (!pinchRef.current) {
        beginPinch(event);
        if (touchRef.current) touchRef.current.pinched = true;
        return;
      }
      if (touchRef.current) touchRef.current.pinched = true;
      const distance = touchDistance(touches);
      if (!distance) return;
      const pinch = pinchRef.current;
      const nextCount = Math.max(Math.min(6, totalPoints), Math.min(totalPoints, Math.round(pinch.count * pinch.distance / distance)));
      const start = pinch.anchorIndex - pinch.anchorRatioInWindow * Math.max(0, nextCount - 1);
      setWindow(start, nextCount, pinch.anchorIndex);
      return;
    }
    if (pinchRef.current) {
      pinchRef.current = null;
      const x = localX(event);
      panRef.current = x == null ? null : {
        baseX: x,
        start: interactionRef.current.viewStart,
        count: interactionRef.current.viewEnd - interactionRef.current.viewStart + 1,
      };
      if (touchRef.current) touchRef.current.pinched = true;
      return;
    }
    if (touchRef.current) touchRef.current.moved = true;
    const x = localX(event);
    if (x == null) return;
    const pan = panRef.current;
    if (pan && (interactionRef.current.isZoomed || touchRef.current?.pinched)) {
      const delta = Math.round((x - pan.baseX) / plotWidth * pan.count);
      const nextStart = Math.max(0, Math.min(totalPoints - pan.count, pan.start - delta));
      setWindow(nextStart, pan.count, nextStart + Math.round(Math.max(0, Math.min(1, (x - plotLeft) / plotWidth)) * Math.max(0, pan.count - 1)));
    } else {
      selectAtX(x);
    }
  };
  const handleRelease = () => {
    pinchRef.current = null;
    panRef.current = null;
  };
  interactionRef.current = { viewStart, viewEnd, isZoomed, grant: handleGrant, move: handleMove, release: handleRelease };
  const chartResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: event => readTouches(event).length >= 2,
    onStartShouldSetPanResponderCapture: event => readTouches(event).length >= 2,
    onMoveShouldSetPanResponder: (event, gesture) => readTouches(event).length >= 2 || (Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy)),
    onMoveShouldSetPanResponderCapture: (event, gesture) => readTouches(event).length >= 2 || (Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy)),
    onPanResponderGrant: (event, gesture) => interactionRef.current.grant(event, gesture),
    onPanResponderMove: event => interactionRef.current.move(event),
    onPanResponderRelease: () => interactionRef.current.release(),
    onPanResponderTerminate: () => interactionRef.current.release(),
    onPanResponderTerminationRequest: () => false,
  }), []);
  if (!hasChart) return (
    <View style={[styles.flowChartPanel, styles.flowComparePanel, { backgroundColor: colors.cardAlt, borderColor: colors.accent }]}>
      <Text style={[styles.flowChartTitle, { color: colors.text, paddingHorizontal: 11 }]}>融資餘額 × 加權指數</Text>
      <Text style={[styles.flowChartEmpty, { color: indexError ? colors.negative : colors.textMuted }]}>{market === 'tpex' ? '此圖使用上市加權指數；請切換「上市」或「上市＋上櫃」來比對融資餘額。' : indexError || (!indexCandles ? '正在載入加權指數收盤、月線與季線…' : '這段期間缺少同日的加權指數收盤與融資餘額資料，無法比對。')}</Text>
      <MarginPeriodSelector period={period} onSelect={onPeriodChange} colors={colors} />
    </View>
  );
  const resetZoom = () => {
    pinchRef.current = null;
    panRef.current = null;
    setZoomWindow(null);
    setSelectedDate(null);
  };
  const minMax = key => {
    const values = key === 'index'
      ? visiblePoints.flatMap(point => [point.index, ...[point.ma20, point.ma60].filter(Number.isFinite)])
      : visiblePoints.map(point => point[key]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.12, max * 0.002);
    return [min - padding, max + padding];
  };
  const [indexMin, indexMax] = minMax('index');
  const [marginMin, marginMax] = minMax('margin');
  const relativeValues = relativePoints.flatMap(point => [point.indexPercent, point.marginPercent, point.ma20Percent, point.ma60Percent].filter(Number.isFinite));
  const relativeMinValue = Math.min(0, ...relativeValues);
  const relativeMaxValue = Math.max(0, ...relativeValues);
  const relativePadding = Math.max((relativeMaxValue - relativeMinValue) * 0.12, 0.1);
  const relativeMin = relativeMinValue - relativePadding;
  const relativeMax = relativeMaxValue + relativePadding;
  const xAt = index => plotLeft + (index - viewStart) * plotWidth / Math.max(1, visibleCount - 1);
  const yAt = (value, min, max) => plotBottom - (value - min) / (max - min) * (plotBottom - plotTop);
  const relativeMode = chartMode === 'relative';
  const maLine = key => visiblePoints.flatMap((point, offset) => {
    const value = relativeMode ? visibleRelativePoints[offset]?.[`${key}Percent`] : point[key];
    return Number.isFinite(value) ? [`${xAt(viewStart + offset)},${yAt(value, relativeMode ? relativeMin : indexMin, relativeMode ? relativeMax : indexMax)}`] : [];
  }).join(' ');
  const indexLine = visiblePoints.map((point, offset) => `${xAt(viewStart + offset)},${yAt(relativeMode ? visibleRelativePoints[offset].indexPercent : point.index, relativeMode ? relativeMin : indexMin, relativeMode ? relativeMax : indexMax)}`).join(' ');
  const marginLine = visiblePoints.map((point, offset) => `${xAt(viewStart + offset)},${yAt(relativeMode ? visibleRelativePoints[offset].marginPercent : point.margin, relativeMode ? relativeMin : marginMin, relativeMode ? relativeMax : marginMax)}`).join(' ');
  const chosenIndex = points.findIndex(point => point.date === chosen.date);
  const chosenRelative = relativePoints[chosenIndex];
  const previous = points[chosenIndex - 1];
  const selectedX = xAt(chosenIndex);
  return (
    <View style={[styles.flowChartPanel, styles.flowComparePanel, { backgroundColor: colors.cardAlt, borderColor: colors.accent }]}>
      <Text style={[styles.flowChartTitle, { color: colors.text, paddingHorizontal: 11, fontSize: 15 }]}>{market === 'combined' ? '兩市融資餘額' : '上市融資餘額'} × 加權指數</Text>
      <View style={styles.flowCompareModeRow}>
        {[{ key: 'relative', label: '漲跌幅比較' }, { key: 'raw', label: '原始數值' }].map(option => <TouchableOpacity
          key={option.key}
          accessibilityRole="button"
          accessibilityState={{ selected: chartMode === option.key }}
          onPress={() => setChartMode(option.key)}
          style={[styles.flowCompareModeButton, { backgroundColor: chartMode === option.key ? colors.accentSoft : colors.card, borderColor: chartMode === option.key ? colors.accent : colors.border }]}
        ><Text style={[styles.flowCompareModeText, { color: chartMode === option.key ? colors.accent : colors.textSub }]}>{option.label}</Text></TouchableOpacity>)}
      </View>
      <View style={styles.flowCompareReadout}>
        <Text style={[styles.flowCompareValue, { color: colors.accent }]}>指數 {numberText(chosen.index, 0)} <Text style={{ color: colors.textSub }}>{relativeMode ? `區間 ${percentText(chosenRelative?.indexPercent)}` : `較前 ${percentText(changeFromPreviousPercent(chosen.index, previous?.index))}`}</Text></Text>
        <Text style={[styles.flowCompareValue, { color: '#D5B260' }]}>融資 {numberText(chosen.margin, 1)} 億 <Text style={{ color: colors.textSub }}>{relativeMode ? `區間 ${percentText(chosenRelative?.marginPercent)}` : `較前 ${percentText(changeFromPreviousPercent(chosen.margin, previous?.margin))}`}</Text></Text>
      </View>
      <View style={[styles.flowChartModeRow, { flexWrap: 'wrap', paddingHorizontal: 11, marginTop: 4 }]}>
        <Text style={{ color: '#EF8D52', fontSize: 11, fontWeight: '700' }}>月線 MA20 {chosen.ma20 == null ? '—' : numberText(chosen.ma20, 0)}</Text>
        <Text style={{ color: '#B69AF4', fontSize: 11, fontWeight: '700' }}>季線 MA60 {chosen.ma60 == null ? '—' : numberText(chosen.ma60, 0)}</Text>
      </View>
      <Text style={[styles.flowChartHint, { color: colors.textMuted }]}>{chosen.date} · {relativeMode ? `基準 ${points[0].date}（同日 0%）` : `前一共同資料日 ${previous?.date || '無資料'}`}</Text>
      <View style={styles.flowChartScroll}>
        <View style={{ width: chartWidth, height: 220 }}>
        <Svg width={chartWidth} height={220}>
          {[plotTop, (plotTop + plotBottom) / 2, plotBottom].map((y, index) => (
            <React.Fragment key={y}>
              <Line x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke={colors.border} strokeWidth="1" />
              <SvgText x={plotLeft - 5} y={y + 3} textAnchor="end" fill={relativeMode ? colors.textSub : colors.accent} fontSize="9">{relativeMode ? percentText(relativeMax - index * (relativeMax - relativeMin) / 2) : numberText(indexMax - index * (indexMax - indexMin) / 2, 0)}</SvgText>
              {!relativeMode && <SvgText x={plotRight + 5} y={y + 3} fill="#D5B260" fontSize="9">{numberText(marginMax - index * (marginMax - marginMin) / 2, 0)}</SvgText>}
            </React.Fragment>
          ))}
          {relativeMode && <Line x1={plotLeft} y1={yAt(0, relativeMin, relativeMax)} x2={plotRight} y2={yAt(0, relativeMin, relativeMax)} stroke={colors.textMuted} strokeWidth="1" strokeDasharray="4 4" />}
          <Polyline points={marginLine} fill="none" stroke="#D5B260" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
          <Polyline points={indexLine} fill="none" stroke={colors.accent} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
          {maLine('ma20') && <Polyline points={maLine('ma20')} fill="none" stroke="#EF8D52" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />}
          {maLine('ma60') && <Polyline points={maLine('ma60')} fill="none" stroke="#B69AF4" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />}
          <Line x1={selectedX} y1={plotTop} x2={selectedX} y2={plotBottom} stroke={colors.textMuted} strokeWidth="1" strokeDasharray="3 4" />
          <Circle cx={selectedX} cy={yAt(relativeMode ? chosenRelative.indexPercent : chosen.index, relativeMode ? relativeMin : indexMin, relativeMode ? relativeMax : indexMax)} r="4.5" fill={colors.cardAlt} stroke={colors.accent} strokeWidth="2.5" />
          <Circle cx={selectedX} cy={yAt(relativeMode ? chosenRelative.marginPercent : chosen.margin, relativeMode ? relativeMin : marginMin, relativeMode ? relativeMax : marginMax)} r="4.5" fill={colors.cardAlt} stroke="#D5B260" strokeWidth="2.5" />
          <SvgText x={plotLeft} y={211} fill={colors.textMuted} fontSize="9">{visiblePoints[0].date}</SvgText>
          <SvgText x={plotRight} y={211} textAnchor="end" fill={colors.textMuted} fontSize="9">{visiblePoints.at(-1).date}</SvgText>
        </Svg>
          <View
            accessible
            accessibilityLabel="融資與加權指數比較圖，雙指捏合縮放；放大後左右拖曳平移，點按查看同日數值"
            style={StyleSheet.absoluteFill}
            {...chartResponder.panHandlers}
            onTouchStart={event => {
              const touches = readTouches(event);
              touchRef.current = { moved: false, pinched: touches.length >= 2 };
              if (touches.length >= 2) beginPinch(event);
            }}
            onTouchEnd={event => {
              const touch = touchRef.current;
              const x = localX(event, event.nativeEvent.changedTouches?.[0]);
              if (touch && !touch.moved && !touch.pinched) selectAtX(x);
              if ((event.nativeEvent.touches || []).length === 0) {
                touchRef.current = null;
                pinchRef.current = null;
                panRef.current = null;
              }
            }}
          />
        </View>
      </View>
      <View style={styles.flowChartZoomRow}>
        <Text style={[styles.flowChartHint, styles.flowChartZoomHint, { color: colors.textMuted }]}>雙指捏合縮放；放大後單指左右滑動日期，點按查看數值。</Text>
        {isZoomed && <TouchableOpacity accessibilityRole="button" onPress={resetZoom} style={[styles.flowChartZoomReset, { borderColor: colors.border }]}><Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700' }}>重設縮放</Text></TouchableOpacity>}
      </View>
      <Text style={[styles.flowChartHint, { color: colors.textMuted }]}>{relativeMode
        ? '藍線：加權指數；金線：融資餘額。兩者以本期間首個共同交易日為 0%，共用百分比軸；橘／紫均線也依首日指數換算。縮放不改變基準。'
        : '藍線／左軸：加權指數收盤；橘線 MA20（月線）、紫線 MA60（季線）；金線／右軸：融資餘額。兩組縱軸會依目前顯示區間自動調整，線條交會不代表數值相等。'}</Text>
      <MarginPeriodSelector period={period} onSelect={onPeriodChange} colors={colors} />
      <TouchableOpacity accessibilityRole="button" onPress={() => setAnalysisOpen(true)} style={[styles.marginAnalysisButton, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
        <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '800' }}>完整分析 · 查看每日資料 ›</Text>
      </TouchableOpacity>
      <MarginAnalysisModal visible={analysisOpen} onClose={() => setAnalysisOpen(false)} points={points} selectedDate={chosen.date} market={market} colors={colors} onSelectDate={date => { setZoomWindow(null); setSelectedDate(date); }} />
    </View>
  );
}

function MarketMaintenanceChart({ history, colors }) {
  const { width } = useWindowDimensions();
  const [selectedDate, setSelectedDate] = useState(null);
  const points = (history || []).flatMap(row => Number(row?.taiexClose) > 0 && Number(row?.maintenanceRate) > 0
    ? [{ date: row.date, index: Number(row.taiexClose), rate: Number(row.maintenanceRate) }]
    : []);
  if (points.length < 2) return <Text style={[styles.flowChartEmpty, { color: colors.textMuted }]}>這段期間缺少同日的官方整戶擔保維持率資料；證交所較早日期可能未提供此序列。</Text>;
  const chosen = points.find(point => point.date === selectedDate) || points[points.length - 1];
  const chartWidth = Math.max(width - 64, 220);
  const plotLeft = 40;
  const plotRight = chartWidth - 40;
  const plotTop = 23;
  const plotBottom = 183;
  const axis = key => {
    const values = points.map(point => point[key]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.12, key === 'index' ? max * 0.002 : 0.5);
    return [min - padding, max + padding];
  };
  const [indexMin, indexMax] = axis('index');
  const [rateMin, rateMax] = axis('rate');
  const xAt = index => plotLeft + index * (plotRight - plotLeft) / Math.max(1, points.length - 1);
  const yAt = (value, min, max) => plotBottom - (value - min) / (max - min) * (plotBottom - plotTop);
  const indexLine = points.map((point, index) => `${xAt(index)},${yAt(point.index, indexMin, indexMax)}`).join(' ');
  const rateLine = points.map((point, index) => `${xAt(index)},${yAt(point.rate, rateMin, rateMax)}`).join(' ');
  const chosenIndex = points.findIndex(point => point.date === chosen.date);
  const previous = points[chosenIndex - 1];
  const selectedX = xAt(chosenIndex);
  const selectAtTouch = event => {
    const touchX = event.nativeEvent.locationX;
    if (!Number.isFinite(touchX)) return;
    const index = Math.max(0, Math.min(points.length - 1,
      Math.round((touchX - plotLeft) / (plotRight - plotLeft) * (points.length - 1))));
    setSelectedDate(points[index].date);
  };
  return (
    <View style={[styles.flowChartPanel, { backgroundColor: colors.cardAlt }]}>
      <Text style={[styles.flowChartTitle, { color: colors.text, paddingHorizontal: 11 }]}>加權指數 × 全市場整戶擔保維持率</Text>
      <View style={styles.flowCompareReadout}>
        <Text style={[styles.flowCompareValue, { color: colors.negative }]}>指數 {numberText(chosen.index, 0)} <Text style={{ color: colors.textSub }}>較前 {percentText(changeFromPreviousPercent(chosen.index, previous?.index))}</Text></Text>
        <Text style={[styles.flowCompareValue, { color: colors.accent }]}>維持率 {numberText(chosen.rate, 2)}% <Text style={{ color: colors.textSub }}>較前 {percentText(changeFromPreviousPercent(chosen.rate, previous?.rate))}</Text></Text>
      </View>
      <Text style={[styles.flowChartHint, { color: colors.textMuted }]}>{chosen.date} · 前一共同資料日 {previous?.date || '無資料'}；維持率變動為相對百分比</Text>
      <View style={styles.flowChartScroll}>
        <View style={{ width: chartWidth, height: 220 }}>
          <Svg width={chartWidth} height={220}>
          {[plotTop, (plotTop + plotBottom) / 2, plotBottom].map((y, index) => (
            <React.Fragment key={y}>
              <Line x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke={colors.border} strokeWidth="1" />
              <SvgText x={plotLeft - 5} y={y + 3} textAnchor="end" fill={colors.textMuted} fontSize="9">{numberText(indexMax - index * (indexMax - indexMin) / 2, 0)}</SvgText>
              <SvgText x={plotRight + 5} y={y + 3} fill={colors.textMuted} fontSize="9">{numberText(rateMax - index * (rateMax - rateMin) / 2, 0)}%</SvgText>
            </React.Fragment>
          ))}
          <Polyline points={indexLine} fill="none" stroke={colors.negative} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
          <Polyline points={rateLine} fill="none" stroke={colors.accent} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
          <Line x1={selectedX} y1={plotTop} x2={selectedX} y2={plotBottom} stroke={colors.textMuted} strokeWidth="1" strokeDasharray="3 4" />
          <Circle cx={selectedX} cy={yAt(chosen.index, indexMin, indexMax)} r="4.5" fill={colors.cardAlt} stroke={colors.negative} strokeWidth="2.5" />
          <Circle cx={selectedX} cy={yAt(chosen.rate, rateMin, rateMax)} r="4.5" fill={colors.cardAlt} stroke={colors.accent} strokeWidth="2.5" />
          <SvgText x={plotLeft} y={211} fill={colors.textMuted} fontSize="9">{points[0].date.slice(5).replace('-', '/')}</SvgText>
          <SvgText x={plotRight} y={211} textAnchor="end" fill={colors.textMuted} fontSize="9">{points[points.length - 1].date.slice(5).replace('-', '/')}</SvgText>
          </Svg>
          <View
            accessible
            accessibilityLabel="維持率與加權指數比較圖，按住並左右拖曳可查看同日數值"
            style={StyleSheet.absoluteFill}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            onResponderGrant={selectAtTouch}
            onResponderMove={selectAtTouch}
            onResponderRelease={selectAtTouch}
          />
        </View>
      </View>
      <Text style={[styles.flowChartHint, { color: colors.textMuted }]}>紅線／左軸：加權指數收盤；藍線／右軸：證交所全市場整戶擔保維持率。按住圖表左右拖曳查看同日數值。兩軸獨立縮放，僅顯示同日資料；此指標含融資、融券及擔保品，與範例的融資部位維持率口徑不同。</Text>
    </View>
  );
}

function MarketPulseTile({ item, colors, onPress, selected, historicalPoint, loading = false }) {
  const quote = item.quote;
  const quoteLoading = loading && !quote && !historicalPoint;
  const chartable = item.chartable !== false;
  const change = historicalPoint ? historicalPoint.changePercent : quote?.change_percent == null ? null : Number(quote.change_percent);
  const changeColor = change > 0 ? colors.positive : change < 0 ? colors.negative : colors.textSub;
  return (
    <TouchableOpacity
      accessibilityRole={chartable ? 'button' : undefined}
      accessibilityLabel={chartable ? `${selected ? '收合' : '查看'}${item.name}${item.symbol === '^TWII' ? ' K 線與均線' : ' K 線'}` : `${item.name}行情`}
      accessibilityState={{ selected }}
      activeOpacity={0.72}
      onPress={chartable ? onPress : undefined}
      style={[styles.pulseTile, { backgroundColor: selected ? colors.accentSoft : colors.cardAlt, borderColor: selected ? colors.accent : colors.border }]}
    >
      <Text style={[styles.pulseMarket, { color: colors.textMuted }]} numberOfLines={1}>{item.marketLabel} · {item.category}</Text>
      <Text style={[styles.pulseName, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{item.name}</Text>
      <Text style={[styles.pulseSymbol, { color: colors.textMuted }]} numberOfLines={1}>{item.symbol}{item.proxy ? ' · ETF' : ''}</Text>
      {quoteLoading ? (
        <View style={styles.pulseLoadingRow} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={[styles.pulseLoadingText, { color: colors.accent }]}>載入行情…</Text>
        </View>
      ) : (
        <View style={styles.pulseValueRow}>
          <Text style={[styles.pulsePrice, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62}>{formatMarketPulsePrice(historicalPoint ? historicalPoint.close : quote?.price)}</Text>
          <Text style={[styles.pulseChange, { color: changeColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{percentText(change)}</Text>
        </View>
      )}
      <Text style={[styles.pulseMeta, { color: colors.textMuted }]}>{historicalPoint ? '歷史收盤' : quoteLoading ? '行情同步中' : quoteStateText(quote)}</Text>
      <Text style={[styles.pulseMeta, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>{historicalPoint ? historicalPoint.date : quoteTimeText(quote)}</Text>
    </TouchableOpacity>
  );
}

export default function MarketOverviewScreen({ navigation }) {
  const { colors } = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [spMetric, setSpMetric] = useState('index');
  const [spPeriod, setSpPeriod] = useState('1Y');
  const [yieldTenor, setYieldTenor] = useState('10Y');
  const [yieldPeriod, setYieldPeriod] = useState('1Y');
  const [spSelectedPoint, setSpSelectedPoint] = useState(null);
  const [cpiSelectedPoint, setCpiSelectedPoint] = useState(null);
  const [yieldSelectedPoint, setYieldSelectedPoint] = useState(null);
  const [yieldAnalysisOpen, setYieldAnalysisOpen] = useState(false);
  const [pulseMarket, setPulseMarket] = useState('ALL');
  const [flowMarket, setFlowMarket] = useState('combined');
  const [marginChartOpen, setMarginChartOpen] = useState(false);
  const [marginChartMode, setMarginChartMode] = useState('change');
  const [marginHistory, setMarginHistory] = useState(null);
  const [marginHistoryLoading, setMarginHistoryLoading] = useState(false);
  const [marginHistoryError, setMarginHistoryError] = useState(null);
  const [marginPeriod, setMarginPeriod] = useState('1M');
  const [marginLoadProgress, setMarginLoadProgress] = useState(null);
  const marginLoadId = useRef(0);
  const [foreignChartOpen, setForeignChartOpen] = useState(false);
  const [institutionalCategory, setInstitutionalCategory] = useState('all');
  const [institutionalChartMode, setInstitutionalChartMode] = useState('daily');
  const [foreignHistory, setForeignHistory] = useState(null);
  const [foreignHistoryLoading, setForeignHistoryLoading] = useState(false);
  const [foreignHistoryError, setForeignHistoryError] = useState(null);
  const [foreignPeriod, setForeignPeriod] = useState('1M');
  const [foreignLoadProgress, setForeignLoadProgress] = useState(null);
  const foreignLoadId = useRef(0);
  const [selectedSymbol, setSelectedSymbol] = useState('^TWII');
  const [chartExpanded, setChartExpanded] = useState(false);
  const [pulseHistoricalPoint, setPulseHistoricalPoint] = useState(null);
  const [chartRefresh, setChartRefresh] = useState(0);

  const load = useCallback(async (forceRefresh = false) => {
    forceRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const overviewRequest = fetchMarketOverview({ forceRefresh });
      const cachedPulse = await fetchCachedMarketPulse();
      if (cachedPulse.some(item => item.available)) {
        setData(current => {
          const currentQuotes = { TW: {}, US: {} };
          (current?.pulse || []).forEach(item => {
            if (!(Number(item?.quote?.price) > 0)) return;
            if (!currentQuotes[item.market]) currentQuotes[item.market] = {};
            currentQuotes[item.market][item.symbol] = item.quote;
          });
          const pulse = mergeMarketPulseQuotes(cachedPulse, currentQuotes, cachedPulse);
          if (!pulse.some(item => item.available)) return current;
          return {
            ...(current || {}),
            fetchedAt: current?.fetchedAt || new Date().toISOString(),
            pulse,
            sp500: current?.sp500 || null,
            pe: current?.pe || null,
            cpi: current?.cpi || null,
            taiwanFlow: current?.taiwanFlow || null,
            yields: current?.yields || [],
            spread10y2y: current?.spread10y2y ?? null,
            errors: current?.errors || [],
            sources: current?.sources || {},
          };
        });
      }
      setData(await overviewRequest);
      setSpSelectedPoint(null);
      setCpiSelectedPoint(null);
      setYieldSelectedPoint(null);
      if (forceRefresh) {
        setPulseHistoricalPoint(null);
        marginLoadId.current += 1;
        foreignLoadId.current += 1;
        setChartRefresh(value => value + 1);
        setMarginHistory(null);
        setMarginChartOpen(false);
        setMarginHistoryLoading(false);
        setMarginHistoryError(null);
        setMarginLoadProgress(null);
        void clearCachedTaiwanMarginHistory();
        setForeignHistory(null);
        setForeignChartOpen(false);
        setForeignHistoryLoading(false);
        setForeignHistoryError(null);
        setForeignLoadProgress(null);
        await clearCachedTaiwanForeignHistory();
      }
    } finally {
      forceRefresh ? setRefreshing(false) : setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(false); }, [load]));

  if (loading && !data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]} accessibilityLiveRegion="polite">
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={[styles.loadingTitle, { color: colors.text }]}>正在載入市場資料…</Text>
        <Text style={[styles.loadingHint, { color: colors.textMuted }]}>行情、估值與利率正在同步</Text>
      </View>
    );
  }

  const spread = data?.spread10y2y;
  const inverted = Number.isFinite(spread) && spread < 0;
  const pe = data?.pe;
  const cpi = data?.cpi;
  const cpiYoy = Number.isFinite(Number(cpi?.yoy)) ? Number(cpi.yoy) : null;
  const cpiSeries = filterPeriod(cpi?.history, '1Y');
  const selectedSpDate = spSelectedPoint?.date;
  const selectedSpIndexPoint = spMetric === 'index'
    ? spSelectedPoint
    : findHistoryPointAtOrBefore(data?.sp500?.history, selectedSpDate);
  const selectedPePoint = spMetric === 'pe'
    ? spSelectedPoint
    : findHistoryPointAtOrBefore(pe?.history, selectedSpDate);
  const displaySpIndex = selectedSpIndexPoint?.value ?? data?.sp500?.value;
  const displaySpIndexDate = selectedSpIndexPoint?.date ?? data?.sp500?.asOf;
  const displayPe = selectedPePoint?.value ?? pe?.value;
  const displayPeValue = displayPe != null && displayPe !== '' && Number.isFinite(Number(displayPe)) ? Number(displayPe) : null;
  const displayPeDate = selectedPePoint?.date ?? pe?.asOf;
  const displayPeEstimated = selectedPePoint?.estimated ?? pe?.estimated;
  const earningsYield = Number.isFinite(displayPeValue) && displayPeValue > 0 ? 100 / displayPeValue : null;
  const displayCpiPoint = cpiSelectedPoint || { value: cpi?.value, date: cpi?.asOf };
  const selectedCpiYearOverYear = cpiSelectedPoint ? calculateYearOverYear(cpi?.history, cpiSelectedPoint.date) : null;
  const displayCpiYoy = cpiSelectedPoint
    ? selectedCpiYearOverYear?.value ?? null
    : cpiYoy;
  const displayCpiPreviousAsOf = cpiSelectedPoint
    ? selectedCpiYearOverYear?.previousAsOf || null
    : cpi?.previousAsOf;
  const spSeries = filterPeriod(spMetric === 'index' ? data?.sp500?.history : pe?.history, spPeriod);
  const selectedYield = data?.yields?.find(item => item.tenor === yieldTenor) || data?.yields?.[0];
  const yieldSeries = filterPeriod(selectedYield?.history, yieldPeriod, YIELD_PERIODS);
  const displayYield = item => item.tenor === selectedYield?.tenor && yieldSelectedPoint
    ? { ...item, value: yieldSelectedPoint.value, asOf: yieldSelectedPoint.date }
    : item;
  const yieldFirst = yieldSeries[0];
  const yieldLast = yieldSeries[yieldSeries.length - 1];
  const yieldChange = Number.isFinite(yieldFirst?.value) && Number.isFinite(yieldLast?.value)
    ? yieldLast.value - yieldFirst.value
    : null;
  const periodLabel = YIELD_PERIODS.find(item => item.key === yieldPeriod)?.description || yieldPeriod;
  const yieldDirection = Number.isFinite(yieldChange) ? yieldChange > 0.02 ? '上升' : yieldChange < -0.02 ? '下降' : '大致持平' : null;
  const shortYield = data?.yields?.find(item => item.tenor === '3M')?.value;
  const longYield = data?.yields?.find(item => item.tenor === '30Y')?.value;
  const curveChange = Number.isFinite(shortYield) && Number.isFinite(longYield) ? longYield - shortYield : null;
  const pulseItems = (data?.pulse || []).filter(item => pulseMarket === 'ALL' || item.market === pulseMarket);
  const pulseAvailableCount = pulseItems.filter(item => item.available && Number(item.quote?.price) > 0).length;
  const selectedPulse = pulseItems.find(item => item.symbol === selectedSymbol) || pulseItems[0];
  const pulseGroups = pulseMarket === 'ALL'
    ? [
        { key: 'TW', label: '台股', items: pulseItems.filter(item => item.market === 'TW') },
        { key: 'US', label: '美股', items: pulseItems.filter(item => item.market === 'US') },
      ]
    : [{ key: pulseMarket, label: pulseMarket === 'TW' ? '台股' : '美股', items: pulseItems }];
  const openAnalysis = item => navigation.navigate('TechnicalAnalysis', {
    symbol: item.symbol, name: item.name, marketType: item.market,
    currency: item.market === 'TW' ? 'TWD' : 'USD', averageCost: 0, currentShares: 0,
  });
  const rankedPulse = pulseItems
    .filter(item => item.quote?.change_percent != null && item.quote.change_percent !== '' && Number.isFinite(Number(item.quote.change_percent)))
    .slice()
    .sort((left, right) => Number(right.quote.change_percent) - Number(left.quote.change_percent));
  const strongestPulse = rankedPulse[0];
  const weakestPulse = rankedPulse.at(-1);
  const flow = data?.taiwanFlow;
  const selectedFlow = flow?.[flowMarket];
  const margin = selectedFlow?.margin;
  const foreign = selectedFlow?.institutional?.[institutionalCategory] || (institutionalCategory === 'foreign' ? selectedFlow?.foreign : null);
  const marginChangeYi = margin?.change == null ? null : margin.change / 1e8;
  const foreignNetYi = foreign?.net == null ? null : foreign.net / 1e8;
  const latestForeignDate = ['twse', 'tpex'].flatMap(market => [
    flow?.[market]?.foreign?.date,
    ...INSTITUTIONAL_TYPES.map(type => flow?.[market]?.institutional?.[type.key]?.date),
  ]).filter(Boolean).sort().at(-1);
  const incompleteForeignPages = foreignHistory?.pages?.filter(page => !page.result || !foreignHistoryCoverage(page.result.history, page.endDate, institutionalCategory, flowMarket).complete) || [];
  const latestMarginDate = [flow?.twse?.margin?.date, flow?.tpex?.margin?.date].filter(Boolean).sort().at(-1);
  const marginPageEndDate = page => {
    const day = new Date(`${latestMarginDate}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - page * 31);
    return day.toISOString().slice(0, 10);
  };
  const loadMarginPeriod = async period => {
    if (!latestMarginDate) { setMarginHistoryError('尚無可用的融資資料'); return; }
    const requestStartedAt = Date.now();
    const loadId = ++marginLoadId.current;
    const firstDate = new Date(`${latestMarginDate}T00:00:00Z`);
    const dayOfMonth = firstDate.getUTCDate();
    firstDate.setUTCDate(1);
    firstDate.setUTCMonth(firstDate.getUTCMonth() - { '1M': 1, '3M': 3, '1Y': 12 }[period]);
    const lastDayOfMonth = new Date(Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth() + 1, 0)).getUTCDate();
    firstDate.setUTCDate(Math.min(dayOfMonth, lastDayOfMonth));
    const startDate = firstDate.toISOString().slice(0, 10);
    const dayCount = (Date.parse(`${latestMarginDate}T00:00:00Z`) - firstDate.getTime()) / 86_400_000 + 1;
    const pageCount = Math.ceil(dayCount / 31);
    setMarginPeriod(period);
    setMarginHistoryError(null);
    setMarginHistoryLoading(true);
    setMarginLoadProgress({ loaded: 0, total: pageCount, cached: 0, completed: 0, refreshTotal: pageCount });
    const pageSpecs = Array.from({ length: pageCount }, (_, offset) => ({ offset, endDate: marginPageEndDate(offset) }));
    const pages = new Map();
    let serverCacheHistory = [];
    const readyPages = new Set();
    const attemptedPages = new Set();
    const completedPages = new Set();
    const failures = [];
    const mergedHistory = () => [...new Map([...serverCacheHistory, ...[...pages.values()].flatMap(page => page.history || [])]
      .filter(row => row.date >= startDate && row.date <= latestMarginDate)
      .map(row => [row.date, row])).values()].sort((left, right) => left.date.localeCompare(right.date));
    const publishHistory = () => {
      const history = mergedHistory();
      if (history.length) setMarginHistory({ history });
      return history;
    };
    const updateProgress = () => setMarginLoadProgress({
      loaded: readyPages.size,
      total: pageCount,
      cached: pages.size,
      completed: completedPages.size,
      refreshTotal: Math.max(0, pageCount - readyPages.size),
    });
    const refreshPage = async page => {
      attemptedPages.add(page.endDate);
      const startedAt = Date.now();
      let result = null;
      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (loadId !== marginLoadId.current) return null;
        try {
          result = await fetchTaiwanMarginHistory(page.endDate);
          break;
        } catch (error) {
          lastError = error;
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 800));
        }
      }
      if (loadId !== marginLoadId.current) return null;
      completedPages.add(page.endDate);
      if (result) {
        pages.set(page.endDate, result);
        readyPages.add(page.endDate);
        void cacheTaiwanMarginHistory(page.endDate, result);
        publishHistory();
      } else {
        failures.push({ page, error: lastError });
      }
      updateProgress();
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('[market-overview] margin page refresh', {
        endDate: page.endDate, elapsedMs: Date.now() - startedAt, ok: Boolean(result),
      });
      return result;
    };
    try {
      // Read all page snapshots with one device-cache access. Fresh pages render immediately;
      // stale/missing pages are refreshed in the background without hiding the visible chart.
      const cachedPages = await readCachedTaiwanMarginHistoryPages(pageSpecs.map(page => page.endDate));
      if (loadId !== marginLoadId.current) return;
      for (const page of pageSpecs) {
        const cached = cachedPages.get(page.endDate);
        if (cached?.data?.history?.length) {
          pages.set(page.endDate, cached.data);
          if (isTaiwanMarginHistoryCacheFresh(cached)) readyPages.add(page.endDate);
        }
      }
      publishHistory();
      updateProgress();
      if (readyPages.size === pageCount) {
        if (!mergedHistory().length) throw new Error('這段期間沒有可用的融資資料');
        return;
      }

      // Cold starts prioritize the newest segment; once it is visible, fetch the
      // whole cached range in one query and only backfill pages absent from it.
      const newestPage = pageSpecs[0];
      if (!readyPages.has(newestPage.endDate)) await refreshPage(newestPage);
      if (loadId !== marginLoadId.current) return;
      if (readyPages.size === pageCount) return;

      try {
        const cachedRange = await fetchTaiwanMarginHistoryCacheRange(startDate, latestMarginDate);
        if (loadId !== marginLoadId.current) return;
        if (cachedRange?.cacheAvailable) {
          serverCacheHistory = cachedRange.history || [];
          publishHistory();
          const rangePagesToCache = [];
          for (const page of pageSpecs) {
            if (readyPages.has(page.endDate)) continue;
            const windowStart = new Date(`${page.endDate}T00:00:00Z`);
            windowStart.setUTCDate(windowStart.getUTCDate() - 30);
            const pageHistory = serverCacheHistory.filter(row => row.date >= windowStart.toISOString().slice(0, 10) && row.date <= page.endDate);
            if (!marginHistoryCoverage(pageHistory, page.endDate).complete) continue;
            if (page.offset === 0 && !pageHistory.some(row => row.date === page.endDate && row.twse && row.tpex)) continue;
            const pageData = {
              asOf: pageHistory.at(-1)?.date,
              history: pageHistory,
              windowDays: 31,
              basis: '官方資料庫快取的逐日融資餘額',
              indexSource: 'database-cache',
              maintenanceSource: 'database-cache',
            };
            pages.set(page.endDate, pageData);
            readyPages.add(page.endDate);
            rangePagesToCache.push([page.endDate, pageData]);
          }
          if (rangePagesToCache.length) void cacheTaiwanMarginHistoryPages(rangePagesToCache);
          publishHistory();
          updateProgress();
        }
      } catch (error) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('[market-overview] margin range cache unavailable', {
          elapsedMs: Date.now() - requestStartedAt,
          message: String(error?.message || error),
        });
      }

      const remainingPages = pageSpecs.filter(page => !readyPages.has(page.endDate) && !attemptedPages.has(page.endDate));
      updateProgress();
      let cursor = 0;
      const worker = async () => {
        while (cursor < remainingPages.length) {
          const page = remainingPages[cursor++];
          if (loadId !== marginLoadId.current) return;
          await refreshPage(page);
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, remainingPages.length) }, worker));
      if (loadId !== marginLoadId.current) return;
      const history = publishHistory();
      if (!history.length) throw failures[0]?.error || new Error('這段期間沒有可用的融資資料');
      const unresolvedFailures = failures.filter(failure => !readyPages.has(failure.page.endDate));
      if (unresolvedFailures.length) {
        setMarginHistoryError(`有 ${unresolvedFailures.length} 段資料更新失敗，仍先顯示已快取資料；可稍後重試。`);
      }
    } catch (error) {
      if (loadId === marginLoadId.current) {
        const history = publishHistory();
        setMarginHistoryError(history.length
          ? (error?.message || '部分融資資料暫時無法更新，仍顯示先前資料。')
          : error?.message || '融資走勢載入失敗');
      }
    } finally {
      if (loadId === marginLoadId.current) {
        setMarginHistoryLoading(false);
        setMarginLoadProgress(null);
      }
    }
  };
  const toggleMarginChart = async () => {
    if (marginChartOpen) { setMarginChartOpen(false); return; }
    setForeignChartOpen(false);
    setMarginChartOpen(true);
    if (marginHistory) return;
    if (!latestMarginDate) { setMarginHistoryError('尚無可用的融資資料'); return; }
    await loadMarginPeriod(marginPeriod);
  };
  const loadForeignPeriod = async (period, retryIncomplete = false) => {
    if (!latestForeignDate) { setForeignHistoryError('尚無可用的法人資料'); return; }
    const loadId = ++foreignLoadId.current;
    const firstDate = new Date(`${latestForeignDate}T00:00:00Z`);
    const dayOfMonth = firstDate.getUTCDate();
    firstDate.setUTCDate(1);
    firstDate.setUTCMonth(firstDate.getUTCMonth() - { '1M': 1, '3M': 3, '1Y': 12 }[period]);
    const lastDayOfMonth = new Date(Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth() + 1, 0)).getUTCDate();
    firstDate.setUTCDate(Math.min(dayOfMonth, lastDayOfMonth));
    const startDate = firstDate.toISOString().slice(0, 10);
    const dayCount = (Date.parse(`${latestForeignDate}T00:00:00Z`) - firstDate.getTime()) / 86_400_000 + 1;
    const pageCount = Math.ceil(dayCount / 31);
    setForeignPeriod(period);
    if (period !== foreignPeriod) setForeignHistory(null);
    setForeignHistoryError(null);
    setForeignHistoryLoading(true);
    setForeignLoadProgress({ loaded: 0, total: pageCount });
    const pageSpecs = Array.from({ length: pageCount }, (_, offset) => {
      const end = new Date(`${latestForeignDate}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() - offset * 31);
      return { endDate: end.toISOString().slice(0, 10) };
    });
    const pageResults = new Map();
    const readyPages = new Set();
    const completedPages = new Set();
    const attemptedPages = new Set();
    const publishHistory = () => {
      if (loadId !== foreignLoadId.current) return [];
      const pages = pageSpecs.map(page => ({ endDate: page.endDate, result: pageResults.get(page.endDate) || null }));
      const history = mergeInstitutionalHistoryRows(pages.flatMap(page => page.result?.history || [])
        .filter(row => row.date >= startDate && row.date <= latestForeignDate));
      if (history.length) setForeignHistory({ history, pages });
      return history;
    };
    const updateProgress = () => setForeignLoadProgress({ loaded: completedPages.size, total: pageCount });
    const refreshPage = async page => {
      attemptedPages.add(page.endDate);
      let result = pageResults.get(page.endDate);
      let fetched = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (loadId !== foreignLoadId.current) return;
        try {
          const fresh = await fetchTaiwanForeignHistory(page.endDate, institutionalCategory, flowMarket);
          result = result
            ? { ...fresh, history: mergeInstitutionalHistoryRows([...result.history, ...fresh.history]) }
            : fresh;
          fetched = true;
          break;
        } catch {
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 600));
        }
      }
      if (loadId !== foreignLoadId.current) return;
      if (result?.history?.length) {
        pageResults.set(page.endDate, result);
        if (fetched) void cacheTaiwanForeignHistoryPage(page.endDate, result);
      }
      completedPages.add(page.endDate);
      publishHistory();
      updateProgress();
    };
    try {
      const cachedPages = await readCachedTaiwanForeignHistoryPages(pageSpecs.map(page => page.endDate));
      if (loadId !== foreignLoadId.current) return;
      for (const page of pageSpecs) {
        const cached = cachedPages.get(page.endDate);
        if (!cached?.data?.history?.length) continue;
        pageResults.set(page.endDate, cached.data);
        const complete = foreignHistoryCoverage(cached.data.history, page.endDate, institutionalCategory, flowMarket).complete;
        if (isTaiwanForeignHistoryCacheFresh(cached) && (complete || !retryIncomplete)) {
          readyPages.add(page.endDate);
          completedPages.add(page.endDate);
        }
      }
      publishHistory();
      updateProgress();
      if (readyPages.size < pageCount && !readyPages.has(pageSpecs[0].endDate)) await refreshPage(pageSpecs[0]);
      if (loadId !== foreignLoadId.current) return;
      const remainingPages = pageSpecs.filter(page => !readyPages.has(page.endDate) && !attemptedPages.has(page.endDate));
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(3, remainingPages.length) }, async () => {
        while (cursor < remainingPages.length) {
          if (loadId !== foreignLoadId.current) return;
          await refreshPage(remainingPages[cursor++]);
        }
      }));
      if (loadId !== foreignLoadId.current) return;
      const history = publishHistory();
      if (!history.length) throw new Error('這段期間沒有可用的法人資料');
    } catch (error) {
      if (loadId === foreignLoadId.current) setForeignHistoryError(error?.message || '法人走勢載入失敗');
    } finally {
      if (loadId === foreignLoadId.current) {
        setForeignHistoryLoading(false);
        setForeignLoadProgress(null);
      }
    }
  };
  const toggleForeignChart = async () => {
    if (foreignChartOpen) { setForeignChartOpen(false); foreignLoadId.current += 1; return; }
    setMarginChartOpen(false);
    setForeignChartOpen(true);
    if (foreignHistory) return;
    await loadForeignPeriod(foreignPeriod);
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
    >
      {loading && (
        <View style={[styles.loadingBanner, { backgroundColor: colors.cardAlt, borderColor: colors.border }]} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={colors.accent} />
          <View style={styles.flex}>
            <Text style={[styles.loadingBannerTitle, { color: colors.text }]}>正在更新市場資料…</Text>
            <Text style={[styles.loadingBannerHint, { color: colors.textMuted }]}>先顯示目前資料，新的行情回來後會自動更新</Text>
          </View>
        </View>
      )}
      <View style={[styles.card, styles.pulseSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>大盤與產業</Text>
        <ChipRow
          items={[{ key: 'ALL', label: '全部' }, { key: 'TW', label: '台股' }, { key: 'US', label: '美股' }]}
          selected={pulseMarket}
          onSelect={market => { setPulseMarket(market); setChartExpanded(false); setPulseHistoricalPoint(null); }}
          colors={colors}
        />
        {!loading && pulseItems.length > 0 && pulseAvailableCount === 0 && (
          <View style={[styles.pulseUnavailableNotice, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
            <Text style={[styles.pulseUnavailableText, { color: colors.textMuted }]}>行情來源暫時沒有回應。若曾載入過，會優先保留最後快取行情；請稍後重試。</Text>
            <TouchableOpacity accessibilityRole="button" disabled={refreshing} onPress={() => load(true)} style={[styles.pulseRetryButton, { borderColor: colors.accent, opacity: refreshing ? 0.5 : 1 }]}>
              <Text style={[styles.pulseRetryText, { color: colors.accent }]}>{refreshing ? '更新中…' : '重試'}</Text>
            </TouchableOpacity>
          </View>
        )}
        {!loading && pulseItems.length > pulseAvailableCount && pulseAvailableCount > 0 && (
          <Text style={[styles.pulsePartialNotice, { color: colors.textMuted }]}>部分標的行情暫缺；其餘報價仍可查看。</Text>
        )}
        {strongestPulse && weakestPulse && (
          <View style={styles.pulseSummaryRow}>
            <View style={[styles.pulseSummary, { backgroundColor: colors.cardAlt }]}>
              <Text style={[styles.pulseSummaryLabel, { color: colors.textMuted }]}>相對最強</Text>
              <Text style={[styles.pulseSummaryValue, { color: colors.text }]}>{strongestPulse.name}</Text>
              <Text style={[styles.pulseSummaryValue, { color: strongestPulse.quote.change_percent < 0 ? colors.negative : strongestPulse.quote.change_percent > 0 ? colors.positive : colors.textSub }]}>{percentText(strongestPulse.quote.change_percent)}</Text>
            </View>
            <View style={[styles.pulseSummary, { backgroundColor: colors.cardAlt }]}>
              <Text style={[styles.pulseSummaryLabel, { color: colors.textMuted }]}>相對最弱</Text>
              <Text style={[styles.pulseSummaryValue, { color: colors.text }]}>{weakestPulse.name}</Text>
              <Text style={[styles.pulseSummaryValue, { color: weakestPulse.quote.change_percent < 0 ? colors.negative : weakestPulse.quote.change_percent > 0 ? colors.positive : colors.textSub }]}>{percentText(weakestPulse.quote.change_percent)}</Text>
            </View>
          </View>
        )}
        {pulseGroups.map(group => group.items.length > 0 && (
          <View key={group.key} style={styles.pulseGroup}>
            {pulseMarket === 'ALL' && <Text style={[styles.pulseGroupLabel, { color: colors.textSub }]}>{group.label}</Text>}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pulseRow}
              nestedScrollEnabled
            >
              {group.items.map(item => (
                <MarketPulseTile
                  key={`${item.market}:${item.symbol}`}
                  item={item}
                  colors={colors}
                  loading={loading}
                  selected={chartExpanded && item.symbol === selectedPulse?.symbol}
                  historicalPoint={chartExpanded && item.symbol === selectedPulse?.symbol ? pulseHistoricalPoint : null}
                  onPress={() => {
                    setChartExpanded(item.symbol === selectedPulse?.symbol ? !chartExpanded : true);
                    setSelectedSymbol(item.symbol);
                    setPulseHistoricalPoint(null);
                  }}
                />
              ))}
            </ScrollView>
            {chartExpanded && selectedPulse?.market === group.key && (
              <MarketPulseChart
                key={`${selectedPulse.market}:${selectedPulse.symbol}`}
                item={selectedPulse}
                colors={colors}
                refreshKey={chartRefresh}
                forceRefresh={chartRefresh > 0}
                quoteLabel={`${quoteStateText(selectedPulse.quote)} · ${quoteTimeText(selectedPulse.quote)}`}
                onPointChange={setPulseHistoricalPoint}
                onOpen={selectedPulse.provider === 'tpex' ? null : () => openAnalysis(selectedPulse)}
                onCollapse={() => { setChartExpanded(false); setPulseHistoricalPoint(null); }}
              />
            )}
          </View>
        ))}
        <Text style={[styles.seriesNote, { color: colors.textMuted }]}>漲跌幅對比前收；台美交易時段不同。台灣科技／半導體以 ETF 代理。</Text>
      </View>

      <View style={[styles.card, styles.flowCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.icon, styles.smallIcon, { backgroundColor: colors.accentSoft }]}><TrendingUp size={19} color={colors.accent} /></View>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>台股資金動向</Text>
            <Text style={[styles.cardSub, { color: colors.textMuted }]}>融資餘額與三大法人買賣超 · 盤後公布</Text>
          </View>
        </View>
        <ChipRow
          items={[{ key: 'combined', label: '上市＋上櫃' }, { key: 'twse', label: '上市' }, { key: 'tpex', label: '上櫃' }]}
          selected={flowMarket}
          onSelect={setFlowMarket}
          colors={colors}
        />
        <View style={styles.flowMetrics}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={marginChartOpen ? '收合融資增減圖' : '展開融資增減圖'} accessibilityState={{ expanded: marginChartOpen }} onPress={toggleMarginChart} activeOpacity={0.75} style={[styles.flowMetric, { backgroundColor: colors.cardAlt }]}>
            <View style={styles.flowMetricHeading}>
              <Text style={[styles.metricLabel, { color: colors.textMuted }]}>融資餘額</Text>
              <Text style={[styles.flowExpandHint, { color: colors.accent }]}>{marginChartOpen ? '收合 ↑' : '看圖 ↓'}</Text>
            </View>
            <Text style={[styles.flowValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{amountYi(margin?.balance == null ? null : margin.balance / 1e8)}</Text>
            <Text style={[styles.flowDelta, { color: marginChangeYi == null ? colors.textMuted : marginChangeYi > 0 ? colors.negative : marginChangeYi < 0 ? colors.positive : colors.textSub }]}>
              {marginChangeYi == null ? '較前日 —' : `較前日 ${marginChangeYi > 0 ? '+' : ''}${amountYi(marginChangeYi)}`}
            </Text>
            <Text style={[styles.metricDate, { color: colors.textMuted }]}>{dateText(margin?.date)}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={foreignChartOpen ? '收合法人買賣圖' : '展開法人買賣圖'} accessibilityState={{ expanded: foreignChartOpen }} onPress={toggleForeignChart} activeOpacity={0.75} style={[styles.flowMetric, { backgroundColor: colors.cardAlt }]}>
            <View style={styles.flowMetricHeading}>
              <Text style={[styles.metricLabel, { color: colors.textMuted, flex: 1 }]} numberOfLines={1} adjustsFontSizeToFit>{institutionalLabel(institutionalCategory)}買賣超</Text>
              <Text style={[styles.flowExpandHint, { color: colors.accent }]}>{foreignChartOpen ? '收合 ↑' : '看圖 ↓'}</Text>
            </View>
            <Text style={[styles.flowValue, { color: foreignNetYi == null ? colors.text : foreignNetYi > 0 ? colors.positive : foreignNetYi < 0 ? colors.negative : colors.textSub }]} numberOfLines={1} adjustsFontSizeToFit>
              {foreignNetYi == null ? '—' : `${foreignNetYi > 0 ? '+' : ''}${amountYi(foreignNetYi)}`}
            </Text>
            <Text style={[styles.flowDelta, { color: colors.textSub }]} numberOfLines={1} adjustsFontSizeToFit>買 {amountYi(foreign?.buy == null ? null : foreign.buy / 1e8)} · 賣 {amountYi(foreign?.sell == null ? null : foreign.sell / 1e8)}</Text>
            <Text style={[styles.metricDate, { color: colors.textMuted }]}>{dateText(foreign?.date)}</Text>
          </TouchableOpacity>
        </View>
        {marginChartOpen && (
          <>
            <View style={styles.flowChartModeRow}>
              {[{ key: 'change', label: '每日增減' }, { key: 'compare', label: '融資 × 指數' }, { key: 'maintenance', label: '維持率 × 指數' }].map(option => (
                <TouchableOpacity key={option.key} accessibilityRole="button" accessibilityState={{ selected: marginChartMode === option.key }} onPress={() => setMarginChartMode(option.key)} style={[styles.flowChartModeButton, { borderColor: marginChartMode === option.key ? colors.accent : colors.border, backgroundColor: marginChartMode === option.key ? colors.accentSoft : colors.cardAlt }]}>
                  <Text style={{ color: marginChartMode === option.key ? colors.accent : colors.textSub, fontWeight: '700', fontSize: 12 }}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {marginChartMode !== 'compare' && <Text style={[styles.flowChartPageRange, { color: colors.textSub, marginTop: 8 }]}>{marginHistoryLoading ? '載入中…' : marginHistory?.history?.length ? `${marginHistory.history[0].date} ～ ${marginHistory.history.at(-1).date}` : marginHistoryError ? '此段資料暫缺' : '—'}</Text>}
            {marginHistoryLoading && (
              <View style={styles.flowChartLoading}><ActivityIndicator size="small" color={colors.accent} /><Text style={{ color: colors.textMuted }}>{marginLoadProgress?.cached ? '已顯示快取，背景更新中…' : '正在載入逐日融資資料…'} {marginLoadProgress?.completed || 0}/{marginLoadProgress?.refreshTotal || 1}</Text></View>
            )}
            {marginHistoryError && (
              <View style={styles.flowChartRetry}>
                <Text style={[styles.flowChartEmpty, { color: colors.negative }]}>{marginHistoryError}</Text>
                <TouchableOpacity accessibilityRole="button" onPress={() => loadMarginPeriod(marginPeriod)}><Text style={{ color: colors.accent }}>重試</Text></TouchableOpacity>
              </View>
            )}
            {marginHistory?.history?.length > 0 && (
              marginChartMode === 'maintenance'
                ? <MarketMaintenanceChart history={marginHistory?.history} colors={colors} />
                : marginChartMode === 'compare'
                  ? <MarginIndexComparisonChart history={marginHistory?.history} market={flowMarket} colors={colors} period={marginPeriod} onPeriodChange={loadMarginPeriod} />
                  : <MarginChangeChart history={marginHistory?.history} market={flowMarket} colors={colors} />
            )}
            {(marginChartMode !== 'compare' || !marginHistory?.history?.length) && <MarginPeriodSelector period={marginPeriod} onSelect={loadMarginPeriod} colors={colors} />}
          </>
        )}
        {foreignChartOpen && (
          <>
            <ChipRow items={INSTITUTIONAL_TYPES} selected={institutionalCategory} onSelect={setInstitutionalCategory} colors={colors} />
            <View style={styles.flowChartModeRow}>
              {[{ key: 'daily', label: '每日買賣超' }, { key: 'compare', label: '法人 × 指數' }].map(option => (
                <TouchableOpacity key={option.key} accessibilityRole="button" accessibilityState={{ selected: institutionalChartMode === option.key }} onPress={() => setInstitutionalChartMode(option.key)} style={[styles.flowChartModeButton, { borderColor: institutionalChartMode === option.key ? colors.accent : colors.border, backgroundColor: institutionalChartMode === option.key ? colors.accentSoft : colors.cardAlt }]}>
                  <Text style={{ color: institutionalChartMode === option.key ? colors.accent : colors.textSub, fontWeight: '700', fontSize: 12 }}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.flowChartPageRange, { color: colors.textSub, marginTop: 12 }]}>{foreignHistory?.history?.length ? `${foreignHistory.history[0].date} ～ ${foreignHistory.history.at(-1).date}${foreignHistoryLoading ? ' · 更新中' : ''}` : foreignHistoryLoading ? '載入中…' : foreignHistoryError ? '此段資料暫缺' : '尚無逐日資料'}</Text>
            {foreignHistoryLoading && <View style={[styles.flowChartLoading, foreignHistory?.history?.length && styles.flowChartLoadingCompact]}><ActivityIndicator size="small" color={colors.accent} /><Text style={{ color: colors.textMuted }}>{foreignHistory?.history?.length ? '已顯示目前取得資料，背景補齊中' : '正在載入逐日法人資料'}… {foreignLoadProgress?.loaded || 0}/{foreignLoadProgress?.total || 1}</Text></View>}
            {foreignHistoryError && !foreignHistory?.history?.length ? (
              <View style={styles.flowChartRetry}>
                <Text style={[styles.flowChartEmpty, { color: colors.negative }]}>{foreignHistoryError}</Text>
                <TouchableOpacity accessibilityRole="button" onPress={() => loadForeignPeriod(foreignPeriod, true)}><Text style={{ color: colors.accent }}>重試</Text></TouchableOpacity>
              </View>
            ) : <>
              {!foreignHistoryLoading && incompleteForeignPages.length > 0 && <View style={styles.flowChartRetry}>
                <Text style={[styles.flowChartEmpty, { color: colors.negative, flex: 1 }]}>目前僅有 {foreignHistory.pages.length - incompleteForeignPages.length}/{foreignHistory.pages.length} 段{institutionalLabel(institutionalCategory)}資料達可用門檻；圖表僅顯示已取得的交易日，並非完整的{foreignPeriod === '1Y' ? '近一年' : foreignPeriod === '3M' ? '近三月' : '近一月'}。</Text>
                <TouchableOpacity accessibilityRole="button" onPress={() => loadForeignPeriod(foreignPeriod, true)} style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }}><Text style={{ color: colors.accent }}>重試缺漏</Text></TouchableOpacity>
              </View>}
              {foreignHistory?.history?.length > 0 && (institutionalChartMode === 'compare'
                ? <InstitutionalIndexChart history={foreignHistory?.history} market={flowMarket} category={institutionalCategory} colors={colors} />
                : <ForeignNetChart history={foreignHistory?.history} market={flowMarket} category={institutionalCategory} colors={colors} />)}
            </>}
            <MarginPeriodSelector period={foreignPeriod} onSelect={loadForeignPeriod} colors={colors} />
          </>
        )}
        {flowMarket === 'combined' && (!margin || !foreign) && (
          <Text style={[styles.seriesNote, { color: colors.textMuted }]}>上市與上櫃資料須同日且均已公布才合計；可切換查看個別市場。</Text>
        )}
        <Text style={[styles.seriesNote, { color: colors.textMuted }]}>融資為信用交易金額餘額；法人買賣超＝買進－賣出。外資不含外資自營商，自營商含自行買賣與避險；三大法人＝外資＋投信＋自營商。皆為盤後資料，非即時資金流。</Text>
        <View style={styles.sources}>
          <SourceLink label="證交所融資" url="https://www.twse.com.tw/zh/trading/margin/twt96u.html" colors={colors} />
          <SourceLink label="證交所三大法人" url="https://www.twse.com.tw/zh/trading/foreign/bfi82u.html" colors={colors} />
          <SourceLink label="櫃買融資" url="https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal.php?l=zh-tw" colors={colors} />
          <SourceLink label="櫃買三大法人" url="https://www.tpex.org.tw/zh-tw/mainboard/trading/major-institutional/summary/day.html" colors={colors} />
          {marginChartMode === 'compare' && marginChartOpen && <SourceLink label="加權指數歷史" url="https://www.twse.com.tw/zh/indices/taiex/mi-5min-hist.html" colors={colors} />}
          {foreignChartOpen && institutionalChartMode === 'compare' && <SourceLink label={flowMarket === 'tpex' ? '櫃買指數歷史' : '加權指數歷史'} url={flowMarket === 'tpex' ? 'https://www.tpex.org.tw/www/zh-tw/indexInfo/inx?response=json' : 'https://www.twse.com.tw/zh/indices/taiex/mi-5min-hist.html'} colors={colors} />}
          {marginChartMode === 'maintenance' && marginChartOpen && <SourceLink label="證交所擔保維持率" url="https://www.twse.com.tw/dashboard/zh/credit/margin.html" colors={colors} />}
        </View>
      </View>

      <View style={[styles.card, styles.valuationCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.icon, styles.smallIcon, { backgroundColor: colors.accentSoft }]}><TrendingUp size={19} color={colors.accent} /></View>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>市場估值</Text>
            <Text style={[styles.cardSub, { color: colors.textMuted }]}>S&P 500 指數與本益比 TTM</Text>
          </View>
        </View>
        <View style={styles.valuationGrid}>
          <View style={[styles.valuationMetric, { backgroundColor: colors.cardAlt }]}>
            <Text style={[styles.metricLabel, { color: colors.textMuted }]}>指數</Text>
            <Text style={[styles.valuationValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{numberText(displaySpIndex)}</Text>
            <Text style={[styles.metricDate, { color: colors.textMuted }]}>{dateText(displaySpIndexDate)}</Text>
          </View>
          <View style={[styles.valuationMetric, { backgroundColor: colors.cardAlt }]}>
            <Text style={[styles.metricLabel, { color: colors.textMuted }]}>本益比</Text>
            <Text style={[styles.valuationValue, { color: colors.accent }]}>{Number.isFinite(displayPeValue) ? `${numberText(displayPeValue)}×` : '—'}</Text>
            <Text style={[styles.metricDate, { color: colors.textMuted }]}>{displayPeEstimated ? '估計 · ' : ''}{dateText(displayPeDate)}</Text>
          </View>
          <View style={[styles.valuationMetric, { backgroundColor: colors.cardAlt }]}>
            <Text style={[styles.metricLabel, { color: colors.textMuted }]}>盈餘殖利率</Text>
            <Text style={[styles.valuationValue, { color: colors.text }]}>{Number.isFinite(earningsYield) ? `${numberText(earningsYield)}%` : '—'}</Text>
            <Text style={[styles.metricDate, { color: colors.textMuted }]}>由本益比換算</Text>
          </View>
        </View>
        <View style={styles.trendSection}>
          <View style={styles.compactSectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>歷史走勢</Text>
            <Text style={[styles.controlHelp, { color: colors.textMuted }]}>拖曳同步上方數值</Text>
          </View>
          <ChipRow items={[{ key: 'index', label: '指數' }, { key: 'pe', label: '本益比' }]} selected={spMetric} onSelect={metric => { setSpMetric(metric); setSpSelectedPoint(null); }} colors={colors} />
          <ChipRow items={PERIODS} selected={spPeriod} onSelect={period => { setSpPeriod(period); setSpSelectedPoint(null); }} colors={colors} />
          <HistoricalTrendChart
            key={`${spMetric}:${spPeriod}`}
            compact
            series={spSeries}
            colors={colors}
            suffix={spMetric === 'pe' ? '×' : ''}
            onPointChange={setSpSelectedPoint}
          />
        </View>
        <Text style={[styles.seriesNote, { color: colors.textMuted }]}>本益比越高，代表市場為同一單位盈餘支付的價格越高；需搭配利率與獲利成長判讀。</Text>
        <Text style={[styles.seriesNote, { color: colors.textMuted }]}>其他大盤也能做本益比，但必須取得同口徑的成分股獲利資料；目前資料源只提供 S&P 500，暫不混用 ETF 或不同定義的數字。</Text>
        <View style={styles.sources}><SourceLink label="FRED 指數資料" url={data?.sources?.fred} colors={colors} /><SourceLink label="Multpl 本益比" url={data?.sources?.pe} colors={colors} /></View>
      </View>

      <View style={[styles.card, styles.macroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.icon, styles.smallIcon, { backgroundColor: colors.accentSoft }]}><TrendingUp size={19} color={colors.accent} /></View>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>通膨指標</Text>
            <Text style={[styles.cardSub, { color: colors.textMuted }]}>美國 CPI-U（未季調）</Text>
          </View>
        </View>
        <View style={styles.valuationGrid}>
          <View style={[styles.valuationMetric, { backgroundColor: colors.cardAlt }]}>
            <Text style={[styles.metricLabel, { color: colors.textMuted }]}>CPI 指數</Text>
            <Text style={[styles.valuationValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{numberText(displayCpiPoint.value)}</Text>
            <Text style={[styles.metricDate, { color: colors.textMuted }]}>{dateText(displayCpiPoint.date)}</Text>
          </View>
          <View style={[styles.valuationMetric, { backgroundColor: colors.cardAlt }]}>
            <Text style={[styles.metricLabel, { color: colors.textMuted }]}>年增率</Text>
            <Text style={[styles.valuationValue, { color: displayCpiYoy == null ? colors.text : colors.accent }]}>{percentText(displayCpiYoy)}</Text>
            <Text style={[styles.metricDate, { color: colors.textMuted }]}>{displayCpiPreviousAsOf ? `較 ${displayCpiPreviousAsOf}` : '較去年同期'}</Text>
          </View>
        </View>
        <View style={styles.compactTrendSection}>
          <View style={styles.compactSectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>歷史走勢</Text>
            <Text style={[styles.controlHelp, { color: colors.textMuted }]}>拖曳同步上方數值</Text>
          </View>
          <HistoricalTrendChart compact series={cpiSeries} colors={colors} onPointChange={setCpiSelectedPoint} />
        </View>
        <Text style={[styles.seriesNote, { color: colors.textMuted }]}>CPI 指數代表物價水準；年增率較適合用來觀察通膨速度。資料月份通常比公告日晚一個月。</Text>
        <View style={styles.sources}><SourceLink label="FRED CPIAUCNS" url={data?.sources?.cpi || 'https://fred.stlouisfed.org/series/CPIAUCNS'} colors={colors} /><SourceLink label="BLS CPI 公告" url={data?.sources?.cpiRelease || 'https://www.bls.gov/cpi/'} colors={colors} /></View>
      </View>

      <View style={[styles.card, styles.treasuryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.cardHeader, styles.treasuryHeader]}>
          <View style={[styles.icon, styles.smallIcon, { backgroundColor: colors.accentSoft }]}><Landmark size={19} color={colors.accent} /></View>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>美國公債</Text>
            <Text style={[styles.cardSub, { color: colors.textMuted }]}>期限結構與殖利率走勢</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yieldStrip}>
          {(data?.yields || []).map(item => {
            const shown = displayYield(item);
            return (
              <View key={item.tenor} style={[styles.yieldItem, { backgroundColor: colors.cardAlt }]}>
                <Text style={[styles.yieldTenor, { color: colors.textMuted }]}>{item.tenor}</Text>
                <Text style={[styles.yieldValue, { color: colors.text }]}>{numberText(shown.value)}%</Text>
                <Text style={[styles.metricDate, { color: colors.textMuted }]}>{dateText(shown.asOf)}</Text>
              </View>
            );
          })}
        </ScrollView>
        <View style={[styles.curveWrap, styles.curvePanel, { backgroundColor: colors.cardAlt }]}><YieldCurve yields={data?.yields || []} colors={colors} compact /></View>
        <View style={[styles.spreadBox, { backgroundColor: inverted ? colors.negativeSoft || colors.cardAlt : colors.accentSoft }]}>
          <View style={styles.spreadHeader}>
            <Text style={[styles.spreadLabel, { color: colors.textSub }]}>10Y − 2Y 利差</Text>
            <Text style={[styles.spreadValue, { color: inverted ? colors.negative : colors.accent }]}>{Number.isFinite(spread) ? `${spread >= 0 ? '+' : ''}${numberText(spread)}%` : '—'}</Text>
          </View>
          <Text style={[styles.spreadHint, { color: colors.textSub }]}>{Number.isFinite(spread) ? inverted ? '殖利率曲線倒掛' : '殖利率曲線未倒掛' : '資料不足'}</Text>
        </View>
        <View style={styles.compactTrendSection}>
          <View style={styles.compactSectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>殖利率走勢</Text>
            <Text style={[styles.controlHelp, { color: colors.textMuted }]}>拖曳同步上方數值 · {selectedYield?.tenor || yieldTenor} · {periodLabel}</Text>
          </View>
          <ChipRow items={(data?.yields || []).map(item => ({ key: item.tenor, label: item.tenor }))} selected={yieldTenor} onSelect={tenor => { setYieldTenor(tenor); setYieldSelectedPoint(null); }} colors={colors} />
          <YieldCandlestickChart key={`${yieldTenor}:${yieldPeriod}`} series={yieldSeries} colors={colors} onPointChange={setYieldSelectedPoint} />
          <MarginPeriodSelector period={yieldPeriod} onSelect={period => { setYieldPeriod(period); setYieldSelectedPoint(null); }} colors={colors} />
          <Text style={[styles.seriesNote, { color: colors.textMuted }]}>週 K 的開收為當週首末日收盤，高低為每日收盤極值，並非盤中高低；殖利率是市場要求的年化利率參考，不是債券價格。期間內{yieldDirection || '方向未知'}。</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => setYieldAnalysisOpen(true)} style={[styles.marginAnalysisButton, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
            <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '800' }}>完整分析 · 查看每日資料 ›</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.sources}><SourceLink label="FRED 美國公債資料" url={data?.sources?.fred} colors={colors} /></View>
      </View>

      <YieldAnalysisModal visible={yieldAnalysisOpen} onClose={() => setYieldAnalysisOpen(false)} tenor={selectedYield?.tenor || yieldTenor} periodLabel={periodLabel} series={yieldSeries} colors={colors} />

      {data?.errors?.length > 0 && (
        <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.errorTitle, { color: colors.text }]}>部分資料未更新</Text>
          {data.errors.map(error => <Text key={error} style={[styles.errorText, { color: colors.textSub }]}>• {error}</Text>)}
          <Text style={[styles.errorText, { color: colors.textMuted }]}>可以下拉重新整理；其他成功載入的資料仍會保留。</Text>
        </View>
      )}

      <Text style={[styles.disclaimer, { color: colors.textMuted }]}>本頁供市場研究使用。殖利率為每日資料，本益比可能為估計值且不同資料商定義可能不同，不構成投資建議。</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTitle: { fontSize: 16, fontWeight: '700', marginTop: 14 },
  loadingHint: { fontSize: 12, marginTop: 5 },
  loadingBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10 },
  loadingBannerTitle: { fontSize: 13, fontWeight: '700' },
  loadingBannerHint: { fontSize: 11, marginTop: 2 },
  hero: { borderWidth: 1, borderRadius: 18, padding: 16 },
  heroTitle: { fontSize: 22, fontWeight: '800' },
  heroSub: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  updated: { fontSize: 11, marginTop: 10 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  treasuryHeader: { marginBottom: 6 },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  smallIcon: { width: 36, height: 36, borderRadius: 18 },
  flex: { flex: 1 },
  cardTitle: { fontSize: 18, fontWeight: '750' },
  cardSub: { fontSize: 12, marginTop: 3 },
  metricRow: { flexDirection: 'row', gap: 10 },
  metric: { flex: 1, borderRadius: 14, padding: 13 },
  metricLabel: { fontSize: 12 },
  metricValue: { fontSize: 24, fontWeight: '800', marginTop: 5 },
  metricDate: { fontSize: 10, marginTop: 5 },
  valuationCard: { padding: 10 },
  flowCard: { padding: 10 },
  flowMetrics: { flexDirection: 'row', gap: 6, marginTop: 5 },
  flowMetric: { flex: 1, minWidth: 0, borderRadius: 11, padding: 9 },
  flowValue: { fontSize: 18, fontWeight: '800', marginTop: 5, fontVariant: ['tabular-nums'] },
  flowDelta: { fontSize: 11, fontWeight: '700', marginTop: 4 },
  flowMetricHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  flowExpandHint: { fontSize: 10, fontWeight: '700' },
  flowChartPanel: { borderRadius: 12, marginTop: 9, paddingVertical: 10 },
  flowComparePanel: { borderWidth: 1, paddingBottom: 14 },
  flowChartZoomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 11, marginTop: 2 },
  flowChartZoomHint: { flex: 1, marginVertical: 2 },
  flowChartZoomReset: { minHeight: 34, paddingHorizontal: 10, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flowChartModeRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  flowChartModeButton: { flex: 1, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderRadius: 9 },
  flowPeriodRow: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginTop: 12, paddingHorizontal: 11 },
  flowPeriodButton: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  flowCompareReadout: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 11, marginTop: 6 },
  flowCompareValue: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  flowCompareModeRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 11, marginTop: 8 },
  flowCompareModeButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  flowCompareModeText: { fontSize: 12, fontWeight: '800' },
  marginAnalysisButton: { minHeight: 42, marginHorizontal: 11, marginTop: 12, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  marginAnalysisModal: { flex: 1, paddingHorizontal: 16, paddingTop: 18 },
  marginAnalysisHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  marginAnalysisTitle: { fontSize: 20, fontWeight: '800' },
  marginAnalysisClose: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  marginAnalysisSummary: { borderWidth: 1, borderRadius: 14, padding: 12 },
  foreignPeriodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  foreignPeriodCard: { width: '48%', flexGrow: 1, borderWidth: 1, borderRadius: 11, padding: 9 },
  foreignPeriodLabel: { fontSize: 11, fontWeight: '800' },
  foreignPeriodValue: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 3 },
  marginAnalysisSection: { fontSize: 15, fontWeight: '800', marginBottom: 5 },
  marginAnalysisMilestone: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  marginAnalysisBadge: { width: 32, fontSize: 12, fontWeight: '800' },
  marginAnalysisMilestoneDate: { width: 78, fontSize: 11, fontVariant: ['tabular-nums'] },
  marginAnalysisMilestoneValue: { flex: 1, fontSize: 11, fontVariant: ['tabular-nums'] },
  marginAnalysisMilestoneChange: { minWidth: 55, textAlign: 'right', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  marginAnalysisLegend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 8 },
  marginAnalysisColumns: { flexDirection: 'row', alignItems: 'center' },
  marginAnalysisTableScroll: { flex: 1 },
  marginAnalysisTable: { width: 520, flex: 1, paddingHorizontal: 6 },
  marginAnalysisTableHeader: { paddingVertical: 10, borderBottomWidth: 1 },
  marginAnalysisDate: { width: 58, fontSize: 11, fontVariant: ['tabular-nums'] },
  marginDailyCell: { width: 92, textAlign: 'right', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  marginAnalysisIndex: { width: 80, textAlign: 'right', fontSize: 11, fontVariant: ['tabular-nums'] },
  marginAnalysisBalance: { width: 86, textAlign: 'right', fontSize: 11, fontVariant: ['tabular-nums'] },
  marginAnalysisChange: { width: 92, textAlign: 'right', fontSize: 11, fontVariant: ['tabular-nums'] },
  marginAnalysisPeakChange: { width: 94, textAlign: 'right', fontSize: 11, fontVariant: ['tabular-nums'] },
  marginAnalysisRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  foreignAnalysisCell: { width: 92, textAlign: 'right', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  foreignAnalysisTotal: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 3 },
  marginAnalysisSub: { fontSize: 10, lineHeight: 15, marginTop: 3 },
  flowChartPageRange: { flex: 1, textAlign: 'center', fontSize: 10, fontVariant: ['tabular-nums'] },
  flowChartRetry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  flowChartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingHorizontal: 11 },
  flowChartTitle: { fontSize: 13, fontWeight: '800' },
  flowChartHint: { fontSize: 10, lineHeight: 15, paddingHorizontal: 11, marginTop: 3 },
  flowChartReadout: { alignItems: 'flex-end' },
  flowChartSelected: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  flowChartScroll: { paddingHorizontal: 6, paddingTop: 6 },
  flowChartEmpty: { fontSize: 11, lineHeight: 17, marginTop: 9, paddingHorizontal: 4 },
  flowChartLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 22 },
  flowChartLoadingCompact: { paddingVertical: 7 },
  macroCard: { padding: 10 },
  valuationGrid: { flexDirection: 'row', gap: 6 },
  valuationMetric: { flex: 1, minWidth: 0, borderRadius: 11, padding: 8 },
  valuationValue: { fontSize: 16, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] },
  treasuryCard: { padding: 10 },
  note: { borderRadius: 12, padding: 12, marginTop: 12 },
  noteText: { fontSize: 12, lineHeight: 19 },
  trendSection: { marginTop: 16 },
  compactTrendSection: { marginTop: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '750', marginTop: 8, marginBottom: 4 },
  sectionSub: { fontSize: 11, lineHeight: 17, marginBottom: 4 },
  controlLabel: { fontSize: 12, fontWeight: '700', marginTop: 10 },
  controlHelp: { fontSize: 10, lineHeight: 15, marginBottom: 3 },
  compactSectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  chipRow: { gap: 8, paddingVertical: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  chipText: { fontSize: 12, fontWeight: '700' },
  chartReadout: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 4 },
  chartValue: { fontSize: 19, fontWeight: '800' },
  chartDate: { fontSize: 11 },
  dragHint: { textAlign: 'center', fontSize: 10, marginTop: -2 },
  yieldAnalysisSummary: { borderWidth: 1, borderRadius: 14, padding: 12 },
  yieldAnalysisSummaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  yieldAnalysisLatest: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 3 },
  yieldAnalysisRow: { flexDirection: 'row', alignItems: 'center', minHeight: 42, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  yieldAnalysisHeader: { borderBottomWidth: 1 },
  yieldAnalysisDate: { flex: 1.1, fontSize: 11, fontVariant: ['tabular-nums'] },
  yieldAnalysisValue: { flex: 1, textAlign: 'right', fontSize: 11, fontVariant: ['tabular-nums'] },
  yieldAnalysisChange: { flex: 1, textAlign: 'right', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  noChart: { height: 120, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  seriesNote: { fontSize: 10, lineHeight: 16, marginTop: 6 },
  explainBox: { borderWidth: 1, borderRadius: 13, padding: 12, marginTop: 10, marginBottom: 4 },
  explainTitle: { fontSize: 11, fontWeight: '700' },
  explainFocus: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  explainText: { fontSize: 12, lineHeight: 18, marginTop: 5 },
  explainHint: { fontSize: 11, lineHeight: 17, marginTop: 7 },
  curveMeaning: { borderRadius: 12, padding: 10, marginTop: 6 },
  sources: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  sourceLink: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sourceText: { fontSize: 12, fontWeight: '600' },
  curveWrap: { alignItems: 'center', overflow: 'hidden' },
  curvePanel: { borderRadius: 12, paddingVertical: 2, marginTop: 6 },
  yieldStrip: { gap: 6, paddingVertical: 2 },
  yieldItem: { width: 88, borderRadius: 10, padding: 7 },
  yieldTenor: { fontSize: 11 },
  yieldValue: { fontSize: 17, fontWeight: '750', marginTop: 3 },
  spreadBox: { borderRadius: 11, padding: 9, marginTop: 6 },
  spreadHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  spreadLabel: { fontSize: 12 },
  spreadValue: { fontSize: 18, fontWeight: '800' },
  spreadHint: { fontSize: 11, marginTop: 3 },
  errorCard: { borderWidth: 1, borderRadius: 16, padding: 14 },
  errorTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  errorText: { fontSize: 12, lineHeight: 18 },
  disclaimer: { fontSize: 11, lineHeight: 17, paddingHorizontal: 4 },
  pulseSection: { padding: 10 },
  collapseChart: { alignItems: 'flex-end', paddingVertical: 8, minHeight: 44, justifyContent: 'center' },
  pulseGroup: { marginTop: 8 },
  pulseGroupLabel: { fontSize: 11, fontWeight: '800', marginBottom: 2, paddingHorizontal: 2 },
  pulseRow: { gap: 8, paddingVertical: 2, marginTop: 8 },
  pulseTile: { width: 142, minWidth: 0, borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 9 },
  pulseTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  pulseMarket: { fontSize: 10, fontWeight: '700' },
  pulseCategory: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  pulseCategoryText: { fontSize: 9, fontWeight: '800' },
  pulseName: { fontSize: 12, fontWeight: '800', marginTop: 5 },
  pulseSymbol: { fontSize: 9, marginTop: 2 },
  pulseValueRow: { gap: 2, marginTop: 6 },
  pulseLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 30, marginTop: 4 },
  pulseLoadingText: { fontSize: 11, fontWeight: '700' },
  pulsePrice: { fontSize: 16, fontWeight: '800', letterSpacing: -0.25, fontVariant: ['tabular-nums'] },
  pulseChange: { fontSize: 12, fontWeight: '800' },
  pulseMeta: { fontSize: 9, lineHeight: 12, marginTop: 2 },
  pulseOpenHint: { fontSize: 9, fontWeight: '700', marginTop: 5 },
  pulseSummaryRow: { flexDirection: 'row', gap: 6, marginTop: 3 },
  pulseSummary: { flex: 1, borderRadius: 10, padding: 7 },
  pulseSummaryLabel: { fontSize: 9 },
  pulseSummaryValue: { fontSize: 12, fontWeight: '800', marginTop: 3 },
  pulseUnavailableNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 8, marginTop: 8 },
  pulseUnavailableText: { flex: 1, fontSize: 10, lineHeight: 15 },
  pulseRetryButton: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  pulseRetryText: { fontSize: 11, fontWeight: '800' },
  pulsePartialNotice: { fontSize: 10, lineHeight: 14, marginTop: 6 },
});
