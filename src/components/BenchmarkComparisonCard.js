import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { Calendar, Plus, X } from 'lucide-react-native';

const SERIES_COLORS = ['#60A5FA', '#FBBF24', '#A78BFA', '#2DD4BF', '#FB7185'];
const RANGE_OPTIONS = [['ALL', '全部'], ['7d', '7d'], ['30d', '30d'], ['90d', '90d'], ['180d', '180d'], ['1Y', '1Y'], ['CUSTOM', '自定義']];

const number = value => Number(value);
const normalizeMarket = value => String(value || '').trim().toUpperCase();
const assetSymbol = value => String(value?.symbol || value || '').trim().toUpperCase();
const assetMarket = value => normalizeMarket(value?.market_type || value?.marketType || value?.market);
const assetKey = value => `${assetSymbol(value)}:${assetMarket(value)}`;
const marketLabel = value => ({ TW: '台股', US: '美股', CRYPTO: '虛擬貨幣' }[assetMarket(value)] || '其他市場');

const buildSeries = (rows, targetRows, label, color, key) => {
  const targetTimes = targetRows.map(row => String(row.time));
  const byTime = new Map((rows || []).map(row => [String(row.time), number(row.close)]));
  const common = targetTimes
    .map((time, index) => ({ time, index, close: byTime.get(time) }))
    .filter(row => Number.isFinite(row.close) && row.close > 0);
  const first = common[0]?.close;
  if (!Number.isFinite(first) || first <= 0 || common.length < 2) return null;
  return {
    key,
    label,
    color,
    points: common.map(row => ({ index: row.index, time: row.time, value: (row.close / first - 1) * 100 })),
    latest: common.at(-1)?.value || 0,
  };
};

export default function BenchmarkComparisonCard({
  symbol,
  rows = [],
  benchmarkRows = [],
  benchmarkLabel = '大盤',
  comparisonRows = [],
  comparisonAssets = [],
  comparisonSymbols = [],
  initialRangeKey = '1Y',
  loading = false,
  error = null,
  colors,
  onManage,
}) {
  const [width, setWidth] = useState(0);
  const [rangeKey, setRangeKey] = useState(initialRangeKey);
  const [customVisible, setCustomVisible] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [customError, setCustomError] = useState('');
  const [activeIndex, setActiveIndex] = useState(null);
  const chartHeight = 210;
  const chartPadding = { left: 42, right: 12, top: 16, bottom: 28 };
  const allTargetRows = rows.filter(row => Number(row.close) > 0).sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const latestDate = allTargetRows.at(-1)?.time || '';
  const targetRows = useMemo(() => {
    if (!allTargetRows.length) return [];
    if (rangeKey === 'ALL') return allTargetRows;
    if (rangeKey === 'CUSTOM') return allTargetRows.filter(row => (!customStart || String(row.time) >= customStart) && (!customEnd || String(row.time) <= customEnd));
    const days = rangeKey === '1Y' ? 365 : Number.parseInt(rangeKey, 10);
    if (!Number.isFinite(days)) return allTargetRows;
    const cutoff = new Date(`${latestDate}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    return allTargetRows.filter(row => String(row.time) >= cutoffKey);
  }, [allTargetRows, customEnd, customStart, latestDate, rangeKey]);
  const rangeLabel = RANGE_OPTIONS.find(([key]) => key === rangeKey)?.[1] || '1Y';
  const selectedAssets = comparisonSymbols.map(selected => {
    const target = typeof selected === 'object' ? selected : { symbol: selected };
    return comparisonAssets.find(asset => assetKey(asset) === assetKey(target))
      || comparisonAssets.find(asset => !assetMarket(target) && assetSymbol(asset) === assetSymbol(target))
      || { ...target, symbol: assetSymbol(target), name: assetSymbol(target) };
  });
  const comparisonByKey = new Map();
  const comparisonBySymbol = new Map();
  (comparisonRows || []).forEach(item => {
    const key = assetKey(item);
    comparisonByKey.set(key, item);
    if (!assetMarket(item)) comparisonBySymbol.set(assetSymbol(item), item);
  });
  const comparisonRowFor = asset => comparisonByKey.get(assetKey(asset)) || comparisonBySymbol.get(assetSymbol(asset));
  const chart = useMemo(() => {
    const series = [
      buildSeries(targetRows, targetRows, symbol, SERIES_COLORS[0], 'target'),
      buildSeries(benchmarkRows, targetRows, benchmarkLabel, SERIES_COLORS[1], 'benchmark'),
      ...selectedAssets.map((asset, index) => buildSeries(
        comparisonRowFor(asset)?.rows || [],
        targetRows,
        `${asset.symbol}${asset.name && asset.name !== asset.symbol ? ` ${asset.name}` : ''} · ${marketLabel(asset)}`,
        SERIES_COLORS[index + 2],
        assetKey(asset),
      )),
    ].filter(Boolean);
    const allValues = series.flatMap(item => item.points.map(point => point.value));
    const min = Math.min(0, ...allValues);
    const max = Math.max(0, ...allValues);
    const padding = Math.max(1, (max - min) * 0.12);
    return { series, min: min - padding, max: max + padding, dates: targetRows.map(row => String(row.time)) };
  }, [benchmarkLabel, benchmarkRows, comparisonByKey, comparisonBySymbol, selectedAssets, symbol, targetRows]);

  const chartWidth = Math.max(0, width - chartPadding.left - chartPadding.right);
  const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const xFor = index => chart.dates.length <= 1 ? chartPadding.left : chartPadding.left + (index / (chart.dates.length - 1)) * chartWidth;
  const yFor = value => chartPadding.top + ((chart.max - value) / Math.max(0.0001, chart.max - chart.min)) * plotHeight;
  const pathFor = points => points.map((point, index) => `${index ? 'L' : 'M'} ${xFor(point.index).toFixed(2)} ${yFor(point.value).toFixed(2)}`).join(' ');
  const zeroY = yFor(0);
  const latest = chart.series.map(item => ({ ...item, latest: item.points.at(-1)?.value || 0 }));
  const readoutIndex = activeIndex === null ? Math.max(0, chart.dates.length - 1) : activeIndex;
  const readoutDate = chart.dates[readoutIndex] || latest[0]?.points?.at(-1)?.time || '';
  const readout = chart.series.map(item => ({
    ...item,
    point: activeIndex === null ? item.points.at(-1) : item.points.find(point => point.index === readoutIndex),
  }));
  const missing = selectedAssets.filter(asset => !comparisonRowFor(asset)?.rows?.length);

  useEffect(() => {
    setActiveIndex(null);
  }, [comparisonSymbols, customEnd, customStart, rangeKey, targetRows.length]);

  const updateActiveIndex = event => {
    const nativeEvent = event?.nativeEvent || {};
    const locationX = Number(nativeEvent.locationX ?? nativeEvent.offsetX);
    if (!Number.isFinite(locationX) || !chart.dates.length || chartWidth <= 0) return;
    const plotX = Math.min(Math.max(locationX - chartPadding.left, 0), chartWidth);
    const nextIndex = Math.round((plotX / chartWidth) * Math.max(0, chart.dates.length - 1));
    setActiveIndex(nextIndex);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={[styles.title, { color: colors.text }]}>標的比較</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>起點 0% · {rangeLabel} · 累積報酬率</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="加入比較標的" onPress={onManage} style={[styles.manageButton, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
          <Plus size={15} color={colors.accent} />
          <Text style={[styles.manageText, { color: colors.accent }]}>比較</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rangeRow}>
        {RANGE_OPTIONS.map(([key, label]) => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: rangeKey === key }} onPress={() => key === 'CUSTOM' ? (setCustomError(''), setCustomVisible(true)) : setRangeKey(key)} style={[styles.rangeButton, { backgroundColor: rangeKey === key ? colors.accent : colors.cardAlt, borderColor: rangeKey === key ? colors.accent : colors.border }]}>
          {key === 'CUSTOM' && <Calendar size={14} color={rangeKey === key ? colors.accentContrast : colors.textSub} />}
          <Text style={[styles.rangeText, { color: rangeKey === key ? colors.accentContrast : colors.textSub }]}>{label}</Text>
        </Pressable>)}
      </ScrollView>

      {chart.series.length >= 2 && !loading && <View style={[styles.chartReadout, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
        <View style={styles.chartReadoutHeader}>
          <Text style={[styles.chartReadoutDate, { color: colors.text }]}>{activeIndex === null ? '最新值' : readoutDate}</Text>
          <Text style={[styles.chartReadoutHint, { color: colors.textMuted }]}>點按或拖曳圖表查看日期</Text>
        </View>
        <View style={styles.chartReadoutValues}>
          {readout.map(item => {
            const value = item.point?.value;
            return <View key={`readout-${item.key}`} style={styles.chartReadoutItem}>
              <View style={[styles.chartReadoutDot, { backgroundColor: item.color }]} />
              <Text numberOfLines={1} style={[styles.chartReadoutLabel, { color: colors.textSub }]}>{item.label}</Text>
              <Text style={[styles.chartReadoutValue, { color: Number(value) >= 0 ? colors.positive : colors.negative }]}>{Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '—'}</Text>
            </View>;
          })}
        </View>
      </View>}

      <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={styles.chartWrap}>
        {loading ? <View style={styles.state}><ActivityIndicator color={colors.accent} /><Text style={[styles.stateText, { color: colors.textMuted }]}>載入比較資料…</Text></View>
          : chart.series.length < 2 ? <View style={styles.state}><Text style={[styles.stateText, { color: colors.textMuted }]}>目前缺少可比較的共同交易日資料</Text></View>
            : <Svg width="100%" height={chartHeight} viewBox={`0 0 ${Math.max(width, 1)} ${chartHeight}`}>
              {[0, 0.5, 1].map(ratio => <Line key={ratio} x1={chartPadding.left} x2={Math.max(chartPadding.left, width - chartPadding.right)} y1={chartPadding.top + plotHeight * ratio} y2={chartPadding.top + plotHeight * ratio} stroke={colors.borderLight} strokeWidth="1" />)}
              <Line x1={chartPadding.left} x2={Math.max(chartPadding.left, width - chartPadding.right)} y1={zeroY} y2={zeroY} stroke={colors.textMuted} strokeDasharray="4 4" strokeWidth="1" />
              {chart.series.map(item => <Path key={item.key} d={pathFor(item.points)} fill="none" stroke={item.color} strokeWidth={item.key === 'target' ? 2 : 1} strokeLinejoin="round" strokeLinecap="round" />)}
              {activeIndex !== null && <Line x1={xFor(readoutIndex)} x2={xFor(readoutIndex)} y1={chartPadding.top} y2={chartHeight - chartPadding.bottom} stroke={colors.textMuted} strokeDasharray="4 4" strokeWidth="1" />}
              {chart.series.map(item => {
                const point = item.points.at(-1);
                return point ? <Circle key={`${item.key}-point`} cx={xFor(point.index)} cy={yFor(point.value)} r={item.key === 'target' ? 4 : 3} fill={item.color} /> : null;
              })}
              {activeIndex !== null && chart.series.map(item => {
                const point = item.points.find(candidate => candidate.index === readoutIndex);
                return point ? <Circle key={`${item.key}-active-point`} cx={xFor(point.index)} cy={yFor(point.value)} r={item.key === 'target' ? 4 : 3} fill={item.color} stroke={colors.card} strokeWidth="1" /> : null;
              })}
              <SvgText x="4" y={yFor(chart.max) + 4} fill={colors.textMuted} fontSize="11">{chart.max.toFixed(1)}%</SvgText>
              <SvgText x="4" y={zeroY + 4} fill={colors.textMuted} fontSize="11">0%</SvgText>
              <SvgText x="4" y={yFor(chart.min) + 4} fill={colors.textMuted} fontSize="11">{chart.min.toFixed(1)}%</SvgText>
              <SvgText x={chartPadding.left} y={chartHeight - 7} fill={colors.textMuted} fontSize="11">{chart.dates[0] || ''}</SvgText>
              <SvgText x={Math.max(chartPadding.left, width - chartPadding.right - 68)} y={chartHeight - 7} fill={colors.textMuted} fontSize="11">{chart.dates.at(-1) || ''}</SvgText>
            </Svg>}
        {!loading && chart.series.length >= 2 && <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="標的比較圖表，點按或拖曳查看指定日期"
          style={StyleSheet.absoluteFill}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={updateActiveIndex}
          onResponderMove={updateActiveIndex}
          onResponderRelease={updateActiveIndex}
        />}
      </View>

      <View style={styles.legend}>{latest.map(item => <View key={item.key} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: item.color }]} /><Text numberOfLines={1} style={[styles.legendLabel, { color: colors.textSub }]}>{item.label}</Text><Text style={[styles.legendValue, { color: item.latest >= 0 ? colors.positive : colors.negative }]}>{item.latest >= 0 ? '+' : ''}{item.latest.toFixed(2)}%</Text></View>)}</View>
      {error && <Text style={[styles.note, { color: colors.warning }]}>{error}</Text>}
      {missing.length > 0 && <Text style={[styles.note, { color: colors.warning }]}>比較資料不足：{missing.map(asset => asset.symbol).join('、')}</Text>}
      <Modal visible={customVisible} transparent animationType="fade" onRequestClose={() => setCustomVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}><View style={styles.flex}><Text style={[styles.modalTitle, { color: colors.text }]}>自定義比較期間</Text><Text style={[styles.subtitle, { color: colors.textMuted }]}>格式：YYYY-MM-DD</Text></View><Pressable onPress={() => setCustomVisible(false)}><X size={19} color={colors.textSub} /></Pressable></View>
            <TextInput value={customStart} onChangeText={setCustomStart} placeholder="開始日期，例如 2026-01-01" placeholderTextColor={colors.textMuted} autoCapitalize="none" style={[styles.dateInput, { color: colors.text, backgroundColor: colors.cardAlt, borderColor: colors.border }]} />
            <TextInput value={customEnd || latestDate} onChangeText={setCustomEnd} placeholder="結束日期" placeholderTextColor={colors.textMuted} autoCapitalize="none" style={[styles.dateInput, { color: colors.text, backgroundColor: colors.cardAlt, borderColor: colors.border }]} />
            {!!customError && <Text style={[styles.note, { color: colors.warning }]}>{customError}</Text>}
            <Pressable onPress={() => {
              const start = customStart.trim();
              const end = (customEnd || latestDate).trim();
              if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
                setCustomError('請輸入有效的日期區間。');
                return;
              }
              setCustomEnd(end);
              setRangeKey('CUSTOM');
              setCustomVisible(false);
            }} style={[styles.applyButton, { backgroundColor: colors.accent }]}><Text style={[styles.applyText, { color: colors.accentContrast }]}>套用期間</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 14 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 18, fontWeight: '900' },
  subtitle: { fontSize: 12, marginTop: 4 },
  rangeRow: { gap: 7, paddingVertical: 8, paddingRight: 4 },
  rangeButton: { minHeight: 34, borderWidth: 1, borderRadius: 17, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  rangeText: { fontSize: 12, fontWeight: '800' },
  manageButton: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  manageText: { fontSize: 12, fontWeight: '800' },
  chartWrap: { width: '100%', minHeight: 210, position: 'relative' },
  chartReadout: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginTop: 4 },
  chartReadoutHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  chartReadoutDate: { fontSize: 12, fontWeight: '900' },
  chartReadoutHint: { fontSize: 10 },
  chartReadoutValues: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6, columnGap: 4 },
  chartReadoutItem: { flexDirection: 'row', alignItems: 'center', width: '48%', minHeight: 18 },
  chartReadoutDot: { width: 7, height: 7, borderRadius: 4, marginRight: 5 },
  chartReadoutLabel: { flex: 1, fontSize: 10 },
  chartReadoutValue: { marginLeft: 5, fontSize: 11, fontWeight: '900' },
  state: { minHeight: 210, alignItems: 'center', justifyContent: 'center', gap: 8 },
  stateText: { fontSize: 13 },
  legend: { gap: 7, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  legendLabel: { flex: 1, fontSize: 12 },
  legendValue: { fontSize: 13, fontWeight: '900' },
  note: { fontSize: 12, marginTop: 9 },
  modalOverlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', padding: 22 },
  modalCard: { borderWidth: 1, borderRadius: 18, padding: 18 },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  modalTitle: { fontSize: 17, fontWeight: '900' },
  dateInput: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, marginTop: 9, fontSize: 13 },
  applyButton: { minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  applyText: { fontSize: 14, fontWeight: '900' },
});
