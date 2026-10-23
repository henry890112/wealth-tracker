import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { RefreshCw } from 'lucide-react-native';

const METRICS = [
  { key: 'per', label: '本益比 TTM', short: 'PER', suffix: ' 倍', reverse: false },
  { key: 'pbr', label: '股價淨值比', short: 'PBR', suffix: ' 倍', reverse: false },
  { key: 'ps', label: '市銷率 TTM', short: 'P/S', suffix: ' 倍', reverse: false },
  { key: 'dividendYield', label: '現金殖利率', short: '殖利率', suffix: '%', reverse: true },
];
const PERIODS = [{ key: 1, label: '1 年' }, { key: 3, label: '3 年' }, { key: 5, label: '5 年' }];

const finite = value => Number.isFinite(Number(value));
const quantile = (values, ratio) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * ratio;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] == null ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
};
const formatValue = (value, metric) => finite(value) ? `${Number(value).toFixed(metric.key === 'dividendYield' ? 2 : 2)}${metric.suffix}` : '—';
const percentileOf = (values, value) => {
  if (!values.length || !finite(value)) return null;
  const below = values.filter(item => item <= value).length;
  return Math.max(0, Math.min(100, Math.round((below / values.length) * 100)));
};
const tierFor = (percentile, reverse) => {
  if (!finite(percentile)) return { label: '資料不足', color: '#94A3B8' };
  const adjusted = reverse ? 100 - percentile : percentile;
  if (adjusted <= 20) return { label: '便宜', color: '#22C55E' };
  if (adjusted <= 40) return { label: '偏低', color: '#14B8A6' };
  if (adjusted <= 60) return { label: '合理', color: '#EAB308' };
  if (adjusted <= 80) return { label: '偏高', color: '#F59E0B' };
  return { label: '昂貴', color: '#EF4444' };
};

function ValuationChart({ rows, metric, colors, width }) {
  const W = width;
  const H = 230;
  const margin = { left: 38, right: 12, top: 14, bottom: 28 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  const values = rows.map(row => Number(row.value)).filter(finite);
  const q25 = quantile(values, 0.25);
  const q75 = quantile(values, 0.75);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const rawMin = quantile(values, 0.02) ?? Math.min(...values);
  const rawMax = quantile(values, 0.98) ?? Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.12, Math.abs(rawMax || 1) * 0.04, 0.1);
  const min = Math.max(0, rawMin - padding);
  const max = rawMax + padding;
  const y = value => margin.top + ((max - Math.max(min, Math.min(max, value))) / Math.max(max - min, 0.0001)) * plotH;
  const x = index => margin.left + (index / Math.max(rows.length - 1, 1)) * plotW;
  const points = rows.map((row, index) => ({ x: x(index), y: y(Number(row.value)), row }));
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const first = rows[0]?.date?.slice(0, 7)?.replace('-', '/');
  const middle = rows[Math.floor(rows.length / 2)]?.date?.slice(0, 7)?.replace('-', '/');
  const last = rows.at(-1)?.date?.slice(0, 7)?.replace('-', '/');
  const latest = points.at(-1);
  return <Svg width={W} height={H}>
    {[0, 0.5, 1].map((ratio, index) => {
      const yy = margin.top + ratio * plotH;
      const label = max - ratio * (max - min);
      return <React.Fragment key={index}><Line x1={margin.left} y1={yy} x2={W - margin.right} y2={yy} stroke={colors.borderLight} strokeDasharray="4 5" /><SvgText x={margin.left - 5} y={yy + 4} textAnchor="end" fill={colors.textMuted} fontSize="9">{label.toFixed(2)}</SvgText></React.Fragment>;
    })}
    {finite(q25) && finite(q75) && <Rect x={margin.left} y={y(q75)} width={plotW} height={Math.max(2, y(q25) - y(q75))} fill={`${colors.accent}22`} />}
    {finite(average) && <Line x1={margin.left} y1={y(average)} x2={W - margin.right} y2={y(average)} stroke={colors.textMuted} strokeWidth="1" strokeDasharray="5 4" />}
    <Path d={path} fill="none" stroke={colors.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    {latest && <Circle cx={latest.x} cy={latest.y} r="3.5" fill={colors.accent} stroke={colors.card} strokeWidth="1.5" />}
    <SvgText x={margin.left} y={H - 7} fill={colors.textMuted} fontSize="9">{first}</SvgText>
    <SvgText x={margin.left + plotW / 2} y={H - 7} textAnchor="middle" fill={colors.textMuted} fontSize="9">{middle}</SvgText>
    <SvgText x={W - margin.right} y={H - 7} textAnchor="end" fill={colors.textMuted} fontSize="9">{last}</SvgText>
  </Svg>;
}

export default function ValuationHistoryCard({ data, loading, error, colors, livePrice, officialClose, onRefresh }) {
  const { width: viewportWidth } = useWindowDimensions();
  const [metricKey, setMetricKey] = React.useState('per');
  const [years, setYears] = React.useState(5);
  const metric = METRICS.find(item => item.key === metricKey) || METRICS[0];
  const rawRows = data?.metrics?.[metricKey] || [];
  const rows = useMemo(() => {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - years);
    const filtered = rawRows.filter(row => String(row.date) >= cutoff.toISOString().slice(0, 10) && finite(row.value));
    if (!filtered.length) return filtered;
    if (!(livePrice > 0) || !(officialClose > 0)) return filtered;
    const latest = filtered.at(-1);
    const referenceClose = Number(data?.referenceClose || officialClose);
    if (!(referenceClose > 0)) return filtered;
    const ratio = livePrice / referenceClose;
    const provisionalValue = metricKey === 'dividendYield' ? Number(latest.value) / ratio : Number(latest.value) * ratio;
    const today = new Date().toISOString().slice(0, 10);
    return [...filtered.filter(row => row.date !== today), { date: today, value: provisionalValue, provisional: true }];
  }, [rawRows, years, livePrice, officialClose, metricKey, data?.referenceClose]);
  const values = rows.map(row => Number(row.value)).filter(finite);
  const latest = rows.at(-1);
  const percentile = percentileOf(values, latest?.value);
  const tier = tierFor(percentile, metric.reverse);
  const chartWidth = Math.max(270, Math.min(viewportWidth - 62, 680));
  const isUnsupported = !loading && !error && rows.length < 60;

  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.header}><View><Text style={[styles.title, { color: colors.text }]}>公司估值</Text><Text style={[styles.subtitle, { color: colors.textMuted }]}>{data?.source || '歷史估值'} · {data?.asOf || '等待資料'}</Text></View><TouchableOpacity onPress={onRefresh} disabled={loading} style={[styles.refresh, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>{loading ? <ActivityIndicator size="small" color={colors.accent} /> : <RefreshCw size={14} color={colors.textSub} />}</TouchableOpacity></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{METRICS.map(item => <TouchableOpacity key={item.key} onPress={() => setMetricKey(item.key)} style={[styles.tab, { borderColor: metricKey === item.key ? colors.accent : colors.border, backgroundColor: metricKey === item.key ? colors.accentSoft : colors.cardAlt }]}><Text style={[styles.tabText, { color: metricKey === item.key ? colors.accent : colors.textSub }]}>{item.short}</Text></TouchableOpacity>)}</ScrollView>
    <View style={styles.summary}><View style={styles.summaryItem}><Text style={[styles.summaryLabel, { color: colors.textMuted }]}>{metric.label}</Text><Text style={[styles.summaryValue, { color: colors.text }]}>{formatValue(latest?.value, metric)}</Text>{latest?.provisional && <Text style={[styles.provisional, { color: colors.warning }]}>盤中暫估</Text>}</View><View style={[styles.divider, { backgroundColor: colors.border }]} /><View style={styles.summaryItem}><Text style={[styles.summaryLabel, { color: colors.textMuted }]}>近 {years} 年的水平</Text><Text style={[styles.summaryValue, { color: tier.color }]}>{finite(percentile) ? `${percentile}%` : '—'}</Text><Text style={[styles.provisional, { color: tier.color }]}>{tier.label}</Text></View></View>
    <View style={styles.periods}>{PERIODS.map(item => <TouchableOpacity key={item.key} onPress={() => setYears(item.key)} style={[styles.period, { backgroundColor: years === item.key ? colors.accentSoft : 'transparent', borderColor: years === item.key ? colors.accent : colors.border }]}><Text style={[styles.periodText, { color: years === item.key ? colors.accent : colors.textSub }]}>{item.label}</Text></TouchableOpacity>)}</View>
    {loading && !data ? <View style={styles.state}><ActivityIndicator color={colors.accent} /><Text style={[styles.stateText, { color: colors.textSub }]}>正在整理歷史估值…</Text></View> : error ? <View style={[styles.state, { backgroundColor: colors.cardAlt }]}><Text style={[styles.stateTitle, { color: colors.text }]}>暫時無法取得估值資料</Text><Text style={[styles.stateText, { color: colors.textSub }]}>{error}</Text></View> : isUnsupported ? <View style={[styles.state, { backgroundColor: colors.cardAlt }]}><Text style={[styles.stateTitle, { color: colors.text }]}>這項估值資料不足</Text><Text style={[styles.stateText, { color: colors.textSub }]}>有效資料不足 60 筆；可能是虧損、ETF／ADR，或來源未提供完整歷史。可切換其他估值指標。</Text></View> : <>
      <ValuationChart rows={rows} metric={metric} colors={colors} width={chartWidth} />
      <View style={styles.legend}><View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.accent }]} /><Text style={[styles.legendText, { color: colors.textSub }]}>{metric.label}</Text></View><View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: colors.textMuted }]} /><Text style={[styles.legendText, { color: colors.textSub }]}>歷史平均值</Text></View><View style={styles.legendItem}><View style={[styles.legendBox, { backgroundColor: `${colors.accent}22` }]} /><Text style={[styles.legendText, { color: colors.textSub }]}>25%–75% 合理區間</Text></View></View>
    </>}
    {!!data?.warnings?.length && <Text style={[styles.warning, { color: colors.textMuted }]}>{data.warnings.join('；')}</Text>}
    <Text style={[styles.note, { color: colors.textMuted }]}>估值位階是與這家公司自身歷史相比，不代表絕對便宜，也不構成買賣建議。</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 14, overflow: 'hidden' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, title: { fontSize: 17, fontWeight: '900' }, subtitle: { fontSize: 9, marginTop: 3 }, refresh: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tabs: { gap: 7, paddingVertical: 12 }, tab: { minWidth: 62, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, tabText: { fontSize: 10, fontWeight: '900' },
  summary: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 }, summaryItem: { flex: 1, alignItems: 'center' }, summaryLabel: { fontSize: 11 }, summaryValue: { fontSize: 27, fontWeight: '900', marginTop: 5 }, provisional: { fontSize: 9, fontWeight: '800', marginTop: 2 }, divider: { width: StyleSheet.hairlineWidth, height: 58 },
  periods: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginVertical: 8 }, period: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }, periodText: { fontSize: 9, fontWeight: '800' },
  state: { minHeight: 190, alignItems: 'center', justifyContent: 'center', borderRadius: 13, padding: 20, gap: 7 }, stateTitle: { fontSize: 13, fontWeight: '900' }, stateText: { fontSize: 10, lineHeight: 16, textAlign: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 2 }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, legendDot: { width: 7, height: 7, borderRadius: 4 }, legendLine: { width: 13, height: 1 }, legendBox: { width: 13, height: 8, borderRadius: 2 }, legendText: { fontSize: 9 }, warning: { fontSize: 9, lineHeight: 14, marginTop: 10 }, note: { fontSize: 9, lineHeight: 14, marginTop: 9 },
});
