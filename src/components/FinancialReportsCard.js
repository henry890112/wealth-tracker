import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { RefreshCw } from 'lucide-react-native';
import CompactDataTable from './CompactDataTable';

const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const numberText = (value, digits = 2) => finite(value) ? Number(value).toFixed(digits) : '—';
const percentText = value => finite(value) ? `${Number(value).toFixed(1)}%` : '—';
const chartGrowthText = value => finite(value) ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}%` : '—';
const growthPercent = (current, previous) => {
  if (!finite(current) || !finite(previous) || Number(previous) === 0) return null;
  return (Number(current) - Number(previous)) / Math.abs(Number(previous)) * 100;
};
const dateText = value => String(value || '').replaceAll('-', '/').slice(0, 10) || '—';
const compactNumber = (value, currency = '') => {
  if (!finite(value)) return '—';
  const number = Number(value);
  const absolute = Math.abs(number);
  const suffix = absolute >= 1e9 ? 'B' : absolute >= 1e6 ? 'M' : absolute >= 1e3 ? 'K' : '';
  const divisor = suffix === 'B' ? 1e9 : suffix === 'M' ? 1e6 : suffix === 'K' ? 1e3 : 1;
  return `${number < 0 ? '-' : ''}${currency}${(absolute / divisor).toFixed(suffix ? 2 : 0)}${suffix}`;
};

const FINANCIAL_CHART_METRICS = [
  { key: 'eps', label: '每股收益', kind: 'number', digits: 2 },
  { key: 'revenue', label: '營業收入', kind: 'money' },
  { key: 'netIncome', label: '淨利潤', kind: 'money' },
  { key: 'freeCashFlow', label: '自由現金流', kind: 'money' },
  { key: 'grossMargin', label: '毛利率', kind: 'percent' },
  { key: 'operatingMargin', label: '營益率', kind: 'percent' },
  { key: 'netMargin', label: '淨利率', kind: 'percent' },
  { key: 'currentRatio', label: '流動比率', kind: 'ratio' },
  { key: 'equityRatio', label: '股東權益比率', kind: 'percent' },
  { key: 'roe', label: '淨資產收益率', kind: 'percent' },
  { key: 'roa', label: '總資產收益率', kind: 'percent' },
];

const chartMetricValue = (value, metric, currency = '') => {
  if (!finite(value)) return '—';
  if (metric.kind === 'money') return compactNumber(value, currency);
  if (metric.kind === 'percent') return `${Number(value).toFixed(1)}%`;
  if (metric.kind === 'ratio') return `${Number(value).toFixed(2)}x`;
  return Number(value).toFixed(metric.digits ?? 2);
};

const chartAxisValue = (value, metric, currency = '') => {
  if (!finite(value)) return '—';
  if (metric.kind === 'money') return compactNumber(value, currency);
  if (metric.kind === 'percent') return `${Number(value).toFixed(0)}%`;
  if (metric.kind === 'ratio') return `${Number(value).toFixed(1)}x`;
  return Number(value).toFixed(1);
};

const chartGrowthLabel = metric => metric.key === 'revenue'
  ? '營收年增率'
  : metric.key === 'eps'
    ? '同比增長率'
    : `${metric.label}同比增長率`;

function FinancialTrendChart({ rows, metric, currency, colors }) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [chartWidth, setChartWidth] = useState(0);
  const isLongPressingRef = useRef(false);
  const growthKey = `${metric.key}YoY`;
  const growthLabel = chartGrowthLabel(metric);
  const chartRows = useMemo(() => {
    const allRows = [...(rows || [])]
      .sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)))
    const withGrowth = allRows.map((row, index) => {
      // Keep an absent quarter absent. Number(null) becomes 0 in JavaScript,
      // which previously made missing EPS look like a real 0.00 result.
      const value = finite(row?.[metric.key]) ? Number(row[metric.key]) : null;
      // Calculate from the full history before trimming to the five displayed
      // quarters, so the first visible quarter can still use its prior-year
      // value. Every growth rate uses an absolute comparison base, so a move
      // from a loss to a profit remains positive: -0.03 -> 0.44.
      const prior = allRows[index - 4]?.[metric.key];
      const calculatedYoY = growthPercent(value, prior);
      const sourceYoY = finite(row?.[growthKey]) ? Number(row[growthKey]) : null;
      // Prefer the local calculation so an older cached/server value cannot
      // override the unified growth-rate logic.
      const yoy = calculatedYoY ?? sourceYoY;
      return { ...row, value, yoy: finite(yoy) ? yoy : null };
    });
    return withGrowth.slice(-5);
  }, [growthKey, metric.key, rows]);

  const valueRows = chartRows.filter(row => finite(row.value));
  const lineRows = chartRows.filter(row => finite(row.yoy));
  const W = 360;
  const H = 270;
  const margin = { left: 38, right: 38, top: 14, bottom: 78 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  const values = valueRows.map(row => Number(row.value));
  const lineValues = lineRows.map(row => Number(row.yoy));
  const rawValueMin = values.length ? Math.min(0, ...values) : 0;
  const rawValueMax = values.length ? Math.max(0, ...values) : 1;
  const valuePadding = Math.max((rawValueMax - rawValueMin) * 0.14, metric.kind === 'number' ? 0.15 : 1);
  const valueMin = rawValueMin - valuePadding;
  const valueMax = rawValueMax + valuePadding;
  const rawLineMin = lineValues.length ? Math.min(0, ...lineValues) : 0;
  const rawLineMax = lineValues.length ? Math.max(0, ...lineValues) : 1;
  const linePadding = Math.max((rawLineMax - rawLineMin) * 0.14, 5);
  const lineMin = rawLineMin - linePadding;
  const lineMax = rawLineMax + linePadding;
  const xFor = index => margin.left + (index / Math.max(chartRows.length - 1, 1)) * plotW;
  const yForValue = value => margin.top + ((valueMax - Math.max(valueMin, Math.min(valueMax, Number(value)))) / Math.max(valueMax - valueMin, 0.0001)) * plotH;
  const yForLine = value => margin.top + ((lineMax - Math.max(lineMin, Math.min(lineMax, Number(value)))) / Math.max(lineMax - lineMin, 0.0001)) * plotH;
  const barWidth = Math.min(24, Math.max(12, plotW / Math.max(chartRows.length, 1) * 0.42));
  const linePath = lineRows.map(row => ({ x: xFor(chartRows.indexOf(row)), y: yForLine(row.yoy) }))
    .map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const valueAxis = [valueMax, 0, valueMin].map(value => ({ value, y: yForValue(value) }));
  const lineAxis = [lineMax, 0, lineMin].map(value => ({ value, y: yForLine(value) }));
  const latest = chartRows.at(-1);
  const selectedRow = Number.isInteger(selectedIndex) ? chartRows[selectedIndex] : null;
  const selectAt = event => {
    if (!chartRows.length || !chartWidth) return;
    const locationX = Number(event?.nativeEvent?.locationX);
    if (!Number.isFinite(locationX)) return;
    const viewBoxX = Math.max(0, Math.min(W, (locationX / chartWidth) * W));
    const index = Math.max(0, Math.min(chartRows.length - 1, Math.round(((viewBoxX - margin.left) / plotW) * Math.max(chartRows.length - 1, 1))));
    setSelectedIndex(current => current === index ? current : index);
  };
  const handleLongPress = event => {
    isLongPressingRef.current = true;
    selectAt(event);
  };
  const handleTouchMove = event => {
    if (isLongPressingRef.current) selectAt(event);
  };
  const clearLongPress = () => {
    isLongPressingRef.current = false;
  };

  return <View style={[styles.financialChart, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
    <View style={styles.financialChartHeader}><View style={styles.flex}><Text style={[styles.financialChartTitle, { color: colors.text }]}>財務指標</Text><Text style={[styles.financialChartSubtitle, { color: colors.textMuted }]}>近 5 季 · 柱狀為{metric.label}，折線為{growthLabel} · 長按查看</Text></View><Text style={[styles.financialChartPeriod, { color: colors.textMuted }]}>單季報</Text></View>
    {selectedRow && <View style={[styles.financialChartSelection, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
      <View style={styles.financialChartSelectionHeader}><Text style={[styles.financialChartSelectionPeriod, { color: colors.text }]}>{selectedRow.label || dateText(selectedRow.periodEnd)}</Text><Text style={[styles.financialChartSelectionHint, { color: colors.textMuted }]}>長按可左右切換</Text></View>
      <View style={styles.financialChartSelectionValues}><Text style={[styles.financialChartSelectionValue, { color: colors.accent }]}>{metric.label} {chartMetricValue(selectedRow.value, metric, currency)}</Text><Text style={[styles.financialChartSelectionValue, { color: finite(selectedRow.yoy) && selectedRow.yoy >= 0 ? colors.positive : colors.negative }]}>{growthLabel} {chartGrowthText(selectedRow.yoy)}</Text></View>
    </View>}
    <Pressable
      delayLongPress={450}
      onLayout={event => setChartWidth(event.nativeEvent.layout.width)}
      onLongPress={handleLongPress}
      onTouchMove={handleTouchMove}
      onTouchEnd={clearLongPress}
      onTouchCancel={clearLongPress}
      style={styles.financialChartTouchArea}
    >
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <SvgText x={margin.left} y={10} fill={colors.accent} fontSize="8">{metric.label}</SvgText>
      {valueAxis.map(({ value, y }, index) => <React.Fragment key={`financial-value-axis-${index}`}><Line x1={margin.left} x2={W - margin.right} y1={y} y2={y} stroke={index === 1 ? colors.accent : colors.borderLight} strokeDasharray={index === 1 ? '4 4' : '4 5'} strokeWidth="1" /><SvgText x={margin.left - 6} y={y + 4} textAnchor="end" fill={colors.accent} fontSize="9">{chartAxisValue(value, metric, currency)}</SvgText></React.Fragment>)}
      {lineRows.length > 0 && <><SvgText x={W - margin.right} y={10} textAnchor="end" fill={colors.warning} fontSize="8">{growthLabel}</SvgText>{lineAxis.map(({ value, y }, index) => <React.Fragment key={`financial-line-axis-${index}`}><Line x1={margin.left} x2={W - margin.right} y1={y} y2={y} stroke={index === 1 ? colors.warning : `${colors.warning}44`} strokeDasharray="3 5" strokeWidth="1" /><SvgText x={W - margin.right + 5} y={y + 4} fill={colors.warning} fontSize="9">{chartAxisValue(value, { kind: 'percent' })}</SvgText></React.Fragment>)}</>}
      {chartRows.map((row, index) => finite(row.value) ? <Rect key={`financial-bar-${row.periodEnd || index}`} x={xFor(index) - barWidth / 2} y={Math.min(yForValue(0), yForValue(row.value))} width={barWidth} height={Math.max(2, Math.abs(yForValue(row.value) - yForValue(0)))} rx="2" fill={colors.accent} opacity="0.92" /> : null)}
      {linePath && <Path d={linePath} fill="none" stroke={colors.warning} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
      {lineRows.map(row => { const index = chartRows.indexOf(row); return <Circle key={`financial-line-point-${row.periodEnd || index}`} cx={xFor(index)} cy={yForLine(row.yoy)} r="3" fill={colors.warning} />; })}
      {selectedRow && <Line x1={xFor(selectedIndex)} x2={xFor(selectedIndex)} y1={margin.top} y2={H - margin.bottom} stroke={colors.textMuted} strokeDasharray="3 4" strokeWidth="1" />}
      {selectedRow && finite(selectedRow.value) && <Circle cx={xFor(selectedIndex)} cy={yForValue(selectedRow.value)} r="4" fill={colors.accent} stroke={colors.text} strokeWidth="1" />}
      {selectedRow && finite(selectedRow.yoy) && <Circle cx={xFor(selectedIndex)} cy={yForLine(selectedRow.yoy)} r="4" fill={colors.warning} stroke={colors.text} strokeWidth="1" />}
      {chartRows.map((row, index) => <React.Fragment key={`financial-label-${row.periodEnd || index}`}><SvgText x={xFor(index)} y={H - 54} textAnchor="middle" fill={colors.textSub} fontSize="8">{row.label || row.periodEnd || ''}</SvgText><SvgText x={xFor(index)} y={H - 34} textAnchor="middle" fill={colors.accent} fontSize="9">{chartMetricValue(row.value, metric, currency)}</SvgText><SvgText x={xFor(index)} y={H - 17} textAnchor="middle" fill={finite(row.yoy) && row.yoy >= 0 ? colors.positive : colors.negative} fontSize="8">{chartGrowthText(row.yoy)}</SvgText></React.Fragment>)}
    </Svg>
    </Pressable>
    <View style={styles.financialChartLegend}><View style={styles.financialLegendItem}><View style={[styles.financialLegendBar, { backgroundColor: colors.accent }]} /><Text style={[styles.financialLegendText, { color: colors.textSub }]}>{metric.label}</Text></View><View style={styles.financialLegendItem}><View style={[styles.financialLegendLine, { backgroundColor: colors.warning }]} /><Text style={[styles.financialLegendText, { color: colors.textSub }]}>{growthLabel}</Text></View></View>
    {latest && <Text style={[styles.financialChartNote, { color: colors.textMuted }]}>最新 {latest.label || dateText(latest.periodEnd)}：{chartMetricValue(latest.value, metric, currency)}{finite(latest.yoy) ? ` · ${growthLabel} ${chartGrowthText(latest.yoy)}` : ` · ${growthLabel}資料不足`}</Text>}
  </View>;
}

function Metric({ label, value, colors, tone = 'text', index }) {
  return <View style={[styles.metric, styles.metricCompact, { borderRightColor: colors.borderLight, borderBottomColor: colors.borderLight }, index % 2 === 0 && styles.metricLeft, index < 4 && styles.metricUpper]}>
    <Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text>
    <Text style={[styles.metricValue, { color: colors[tone] || colors.text }]}>{value}</Text>
  </View>;
}

function QuarterCard({ row, currency, colors }) {
  const revenueChange = finite(row?.revenueYoY) ? row.revenueYoY : row?.revenueQoQ;
  const changeTone = finite(revenueChange) && Number(revenueChange) < 0 ? colors.negative : colors.positive;
  return <View style={[styles.quarterCard, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
    <View style={styles.quarterHeader}><Text style={[styles.quarterLabel, { color: colors.text }]}>{row?.label || dateText(row?.periodEnd)}</Text><Text style={[styles.quarterDate, { color: colors.textMuted }]}>{dateText(row?.periodEnd)}</Text></View>
    <Text style={[styles.quarterRevenue, { color: colors.text }]}>{compactNumber(row?.revenue, currency)}</Text>
    <Text style={[styles.quarterCaption, { color: colors.textMuted }]}>營收</Text>
    <View style={styles.quarterLine}><Text style={[styles.quarterKey, { color: colors.textSub }]}>EPS</Text><Text style={[styles.quarterValue, { color: colors.text }]}>{numberText(row?.eps)}</Text></View>
    <View style={styles.quarterLine}><Text style={[styles.quarterKey, { color: colors.textSub }]}>淨利率</Text><Text style={[styles.quarterValue, { color: colors.text }]}>{percentText(row?.netMargin)}</Text></View>
    <View style={styles.quarterLine}><Text style={[styles.quarterKey, { color: colors.textSub }]}>營收年增</Text><Text style={[styles.quarterValue, { color: changeTone }]}>{percentText(row?.revenueYoY)}</Text></View>
    <Text style={[styles.quarterFiled, { color: colors.textMuted }]}>{row?.sourceLabel
      ? `${dateText(row.filedAt)} · ${row.sourceLabel}`
      : row?.filedAt ? `申報 ${dateText(row.filedAt)}` : '申報日期未提供'}</Text>
  </View>;
}

export default function FinancialReportsCard({ data, calendarEvent = null, loading, error, colors, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [chartMetricKey, setChartMetricKey] = useState('eps');
  // Keep the newest report at the leading edge of the horizontal list so it
  // is visible immediately on mobile without swiping to the right.
  const quarters = useMemo(() => [...(data?.quarters || [])].sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd))), [data?.quarters]);
  const visibleQuarters = expanded ? quarters : quarters.slice(0, 4);
  const latest = quarters[0] || {};
  const currency = data?.currency === 'TWD' ? 'NT$' : data?.currency === 'EUR' ? '€' : '$';
  const chartMetrics = useMemo(() => FINANCIAL_CHART_METRICS.filter(metric => quarters.some(row => finite(row?.[metric.key]))), [quarters]);
  const chartMetric = chartMetrics.find(metric => metric.key === chartMetricKey) || chartMetrics[0] || null;
  const calendarNextDate = calendarEvent?.status === 'upcoming' ? calendarEvent?.date : null;
  const nextDate = calendarNextDate || data?.earningsCalendar?.nextDate;
  const nextDateMeta = calendarNextDate
    ? `${calendarEvent?.source || '財報日曆'} 預估日期${calendarEvent?.sourceDate ? ` · 美國 ${dateText(calendarEvent.sourceDate)}` : ''}${calendarEvent?.time ? ` ${calendarEvent.time}` : ''}`
    : nextDate
      ? `${data?.earningsCalendar?.nextSource || '第三方'}日期，請以公司公告為準`
      : '目前來源未提供日期；不代表公司尚未公告';
  const recentReleaseDate = data?.earningsCalendar?.previousDate;
  const latestRelease = data?.latestEarningsRelease;
  const hasNewerRelease = !!latestRelease?.date && latestRelease.date > (latest.announcementDate || latest.filedAt || latest.periodEnd || '');
  const nextEstimate = useMemo(() => [...(data?.estimates || [])]
    .filter(row => row?.endDate)
    .sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)))[0] || null, [data?.estimates]);
  const monthlyGrowth = useMemo(() => {
    const monthly = [...(data?.monthlyRevenue || [])]
      .filter(row => row?.month)
      .sort((a, b) => String(a.month).localeCompare(String(b.month)));
    let consecutivePositive = 0;
    for (let index = monthly.length - 1; index >= 0; index -= 1) {
      if (!finite(monthly[index]?.yoy) || Number(monthly[index].yoy) <= 0) break;
      consecutivePositive += 1;
    }
    return {
      consecutivePositive,
      latest: monthly.at(-1) || null,
    };
  }, [data?.monthlyRevenue]);
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.header}>
      <View style={styles.flex}><Text style={[styles.title, { color: colors.text }]}>財報分析</Text><Text style={[styles.subtitle, { color: colors.textMuted }]}>{data?.source || '財報與財測資料'} · 財報期間截至 {dateText(data?.asOf)}</Text></View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="更新財報資料" onPress={onRefresh} disabled={loading} style={[styles.refresh, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>{loading ? <ActivityIndicator size="small" color={colors.accent} /> : <RefreshCw size={14} color={colors.textSub} />}</TouchableOpacity>
    </View>

    {loading && !data ? <View style={[styles.state, { backgroundColor: colors.cardAlt }]}><ActivityIndicator color={colors.accent} /><Text style={[styles.stateText, { color: colors.textSub }]}>正在整理近 8 季財報…</Text></View>
      : error && !data ? <View style={[styles.state, { backgroundColor: colors.cardAlt }]}><Text style={[styles.stateTitle, { color: colors.text }]}>暫時無法取得財報</Text><Text style={[styles.stateText, { color: colors.textSub }]}>{error}</Text></View>
        : <>
          {hasNewerRelease && <View style={[styles.releaseNotice, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
            <Text style={[styles.releaseNoticeTitle, { color: colors.accent }]}>官方財報公告已更新 · {dateText(latestRelease.date)}</Text>
            <Text style={[styles.releaseNoticeText, { color: colors.textSub }]}>{latestRelease.source || '公司公告'} 已公布業績；下方季度資料目前截至 {latest.label || dateText(latest.periodEnd)}。</Text>
            {/^https:\/\/www\.sec\.gov\/Archives\//.test(latestRelease.url || '') && <TouchableOpacity accessibilityRole="link" onPress={() => Linking.openURL(latestRelease.url).catch(() => {})}><Text style={[styles.releaseNoticeLink, { color: colors.accent }]}>查看 SEC 官方公告 ›</Text></TouchableOpacity>}
          </View>}
          <View style={[styles.latestTitle, styles.latestTitleCompact]}><Text style={[styles.sectionTitle, { color: colors.text }]}>最新季度 {latest.label || dateText(latest.periodEnd)}</Text><Text style={[styles.sectionMeta, { color: colors.textMuted, textAlign: 'right', flexShrink: 1 }]}>{latest.sourceLabel ? `${latest.sourceLabel} · ${dateText(latest.filedAt)}` : (latest.filedAt ? `申報 ${dateText(latest.filedAt)}` : '申報日期未提供')}</Text></View>
          <View style={[styles.metricGrid, styles.metricGridCompact, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
            <Metric index={0} label="營收" value={compactNumber(latest.revenue, currency)} colors={colors} />
            <Metric index={1} label="淨利潤" value={compactNumber(latest.netIncome, currency)} colors={colors} tone={finite(latest.netIncome) ? Number(latest.netIncome) < 0 ? 'negative' : 'positive' : 'text'} />
            <Metric index={2} label="稀釋 EPS" value={numberText(latest.eps)} colors={colors} tone={finite(latest.eps) ? Number(latest.eps) < 0 ? 'negative' : 'positive' : 'text'} />
            <Metric index={3} label="自由現金流" value={compactNumber(latest.freeCashFlow, currency)} colors={colors} tone={finite(latest.freeCashFlow) ? Number(latest.freeCashFlow) < 0 ? 'negative' : 'positive' : 'text'} />
            <Metric index={4} label="營益率" value={percentText(latest.operatingMargin)} colors={colors} />
            <Metric index={5} label="淨利率" value={percentText(latest.netMargin)} colors={colors} />
          </View>
          {latest.sourceLabel && <Text style={[styles.warning, { color: colors.textMuted }]}>以上為{latest.sourceLabel}中的季度數字；公告未提供的欄位保持空白，不沿用舊季數值。</Text>}
          <View style={[styles.calendarRow, styles.calendarRowCompact]}>
            <View style={[styles.calendarBox, styles.calendarBoxCompact, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}><Text style={[styles.calendarLabel, { color: colors.accent }]}>下一次預計公布</Text><Text style={[styles.calendarValue, styles.calendarValueCompact, { color: colors.text }]}>{nextDate ? dateText(nextDate) : '暫無預估日期'}</Text><Text style={[styles.calendarMeta, { color: colors.textSub }]}>{nextDateMeta}</Text></View>
            <View style={[styles.calendarBox, styles.calendarBoxCompact, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.calendarLabel, { color: colors.textMuted }]}>最近公布</Text><Text style={[styles.calendarValue, styles.calendarValueCompact, { color: colors.text }]}>{recentReleaseDate ? dateText(recentReleaseDate) : '尚未提供'}</Text><Text style={[styles.calendarMeta, { color: colors.textSub }]}>{data?.earningsCalendar?.previousSource || '公司公告日期未提供'}</Text></View>
          </View>
          {!!chartMetric && <View style={styles.financialChartSection}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.financialMetricRow}>{chartMetrics.map(metric => <TouchableOpacity key={metric.key} accessibilityRole="button" accessibilityState={{ selected: chartMetric.key === metric.key }} onPress={() => setChartMetricKey(metric.key)} style={[styles.financialMetricChip, { backgroundColor: chartMetric.key === metric.key ? colors.accentSoft : colors.cardAlt, borderColor: chartMetric.key === metric.key ? colors.accent : colors.border }]}><Text style={[styles.financialMetricChipText, { color: chartMetric.key === metric.key ? colors.accent : colors.textSub }]}>{metric.label}</Text></TouchableOpacity>)}</ScrollView><FinancialTrendChart rows={quarters} metric={chartMetric} currency={currency} colors={colors} /></View>}
          <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: colors.text }]}>季度趨勢</Text><Text style={[styles.sectionMeta, { color: colors.textMuted }]}>年增優先，缺資料時保留空白</Text></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quarterRow}>{visibleQuarters.map(row => <QuarterCard key={row.periodEnd} row={row} currency={currency} colors={colors} />)}</ScrollView>
          {quarters.length > 4 && <TouchableOpacity onPress={() => setExpanded(value => !value)} style={[styles.expand, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}><Text style={[styles.expandText, { color: colors.accent }]}>{expanded ? '收合季度資料' : `查看全部 ${quarters.length} 季`}</Text></TouchableOpacity>}
          {!!data?.monthlyRevenue?.length && <>
            <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: colors.text }]}>台股月營收</Text><Text style={[styles.sectionMeta, { color: colors.textMuted }]}>近 {data.monthlyRevenue.length} 個月</Text></View>
            <CompactDataTable style={{ marginTop: 7 }} rows={data.monthlyRevenue.slice(-6).reverse()} rowKey={row => row.month} colors={colors} fixedColumn={{ header: '月份', width: 78, render: row => dateText(row.month).slice(0, 7) }} columns={[{ key: 'revenue', header: '營收', width: 120, render: row => compactNumber(row.revenue, currency) }, { key: 'yoy', header: '年增率', width: 100, render: row => percentText(row.yoy), color: row => finite(row.yoy) ? Number(row.yoy) < 0 ? colors.negative : colors.positive : colors.textMuted }]} />
            <View style={[styles.monthlyGrowthBox, { backgroundColor: colors.cardAlt, borderColor: monthlyGrowth.consecutivePositive >= 3 ? colors.positive : colors.border }]}>
              <View style={styles.monthlyGrowthHeader}><View style={styles.flex}><Text style={[styles.monthlyGrowthTitle, { color: colors.text }]}>月營收成長趨勢</Text><Text style={[styles.monthlyGrowthHint, { color: colors.textMuted }]}>以實際營收月份比較去年同月</Text></View><Text style={[styles.monthlyGrowthBadge, { color: monthlyGrowth.consecutivePositive >= 3 ? colors.positive : colors.warning }]}>{monthlyGrowth.consecutivePositive >= 3 ? '連續正成長' : '尚未連三月'}</Text></View>
              <View style={styles.monthlyGrowthStats}><View style={styles.monthlyGrowthStat}><Text style={[styles.monthlyGrowthLabel, { color: colors.textMuted }]}>目前連續正成長</Text><Text style={[styles.monthlyGrowthValue, { color: monthlyGrowth.consecutivePositive >= 3 ? colors.positive : colors.text }]}>{monthlyGrowth.consecutivePositive} 個月</Text></View><View style={styles.monthlyGrowthStat}><Text style={[styles.monthlyGrowthLabel, { color: colors.textMuted }]}>最新月營收年增</Text><Text style={[styles.monthlyGrowthValue, { color: finite(monthlyGrowth.latest?.yoy) && Number(monthlyGrowth.latest.yoy) >= 0 ? colors.positive : colors.text }]}>{finite(monthlyGrowth.latest?.yoy) ? percentText(monthlyGrowth.latest.yoy) : '—'}</Text></View></View>
              <Text style={[styles.monthlyGrowthDescription, { color: colors.textSub }]}>{monthlyGrowth.consecutivePositive >= 3 ? `最近已連續 ${monthlyGrowth.consecutivePositive} 個月年增率為正。` : '目前尚未達到連續三個月正成長，缺少年增率的月份不會視為正成長。'}</Text>
            </View>
          </>}
          {(finite(latest.epsEstimate) || nextEstimate) && <View style={[styles.estimateBox, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
            {finite(latest.epsEstimate) && <><Text style={[styles.estimateTitle, { color: colors.text }]}>已公布季度市場 EPS 對照</Text><Text style={[styles.estimateText, { color: colors.textSub }]}>市場調整後實際 {numberText(latest.epsActual)} · 預估 {numberText(latest.epsEstimate)} · 差異 {percentText(latest.epsSurprisePercent)}</Text></>}
            {!!nextEstimate && <View style={styles.estimateDivider}><Text style={[styles.estimateTitle, { color: colors.text }]}>下一季市場預估</Text><Text style={[styles.estimateText, { color: colors.textSub }]}>營收 {compactNumber(nextEstimate.revenueEstimate, currency)} · EPS {numberText(nextEstimate.epsEstimate)} · 期間 {dateText(nextEstimate.endDate)}</Text></View>}
          </View>}
        </>}
    {!!data?.warnings?.length && <Text style={[styles.warning, { color: colors.textMuted }]}>{data.warnings.join('；')}</Text>}
    {error && data && <Text style={[styles.warning, { color: colors.warning }]}>更新失敗，畫面保留上次成功資料：{error}</Text>}
    <Text style={[styles.note, { color: colors.textMuted }]}>正式財報數字與第三方財報日期／預估分開呈現；公告日期仍應以公司或交易所正式資訊為準，不構成買賣建議。</Text>
  </View>;
}

const styles = StyleSheet.create({
  latestTitleCompact: { marginTop: 9, gap: 8 },
  metricGridCompact: { gap: 0, marginTop: 7, borderWidth: 1, borderRadius: 11, overflow: 'hidden' },
  metricCompact: { width: '50%', minHeight: 49, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 0, borderRadius: 0 },
  metricLeft: { borderRightWidth: StyleSheet.hairlineWidth },
  metricUpper: { borderBottomWidth: StyleSheet.hairlineWidth },
  calendarRowCompact: { marginTop: 7 },
  calendarBoxCompact: { minHeight: 64, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 11 },
  calendarValueCompact: { fontSize: 13, marginTop: 2 },
  card: { borderWidth: 1, borderRadius: 18, padding: 14, overflow: 'hidden' }, flex: { flex: 1, minWidth: 0 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, title: { fontSize: 17, fontWeight: '900' }, subtitle: { fontSize: 9, marginTop: 3 }, refresh: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  releaseNotice: { borderWidth: 1, borderRadius: 12, padding: 11, marginTop: 13, gap: 5 }, releaseNoticeTitle: { fontSize: 12, fontWeight: '900' }, releaseNoticeText: { fontSize: 9, lineHeight: 14 }, releaseNoticeLink: { fontSize: 10, fontWeight: '900', marginTop: 3 },
  latestTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 13 }, sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 14, marginBottom: 8 }, sectionTitle: { fontSize: 13, fontWeight: '900' }, sectionMeta: { fontSize: 9 }, metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 }, metric: { width: '48%', borderWidth: 1, borderRadius: 12, padding: 10, minHeight: 64 }, metricLabel: { fontSize: 9 }, metricValue: { fontSize: 16, fontWeight: '900', marginTop: 6 },
  calendarRow: { flexDirection: 'row', gap: 8, marginTop: 10 }, calendarBox: { flex: 1, borderWidth: 1, borderRadius: 13, padding: 10, minHeight: 78 }, calendarLabel: { fontSize: 10, fontWeight: '800' }, calendarValue: { fontSize: 17, fontWeight: '900', marginTop: 4 }, calendarMeta: { fontSize: 8, lineHeight: 12, marginTop: 3 }, filingMeta: { borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }, filingLabel: { fontSize: 9 }, filingValue: { fontSize: 10, fontWeight: '900' }, filingHint: { flex: 1, fontSize: 8, textAlign: 'right' }, financialChartSection: { marginTop: 14 }, financialMetricRow: { gap: 7, paddingBottom: 9 }, financialMetricChip: { borderWidth: 1, borderRadius: 9, minHeight: 30, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }, financialMetricChipText: { fontSize: 10, fontWeight: '800' }, financialChart: { borderWidth: 1, borderRadius: 12, padding: 8, overflow: 'hidden' }, financialChartHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 3 }, financialChartTitle: { fontSize: 13, fontWeight: '900' }, financialChartSubtitle: { fontSize: 8, marginTop: 2 }, financialChartPeriod: { fontSize: 9 }, financialChartSelection: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 7, marginTop: 7, marginBottom: 5 }, financialChartSelectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }, financialChartSelectionPeriod: { fontSize: 10, fontWeight: '900' }, financialChartSelectionHint: { fontSize: 8 }, financialChartSelectionValues: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 3, marginTop: 4 }, financialChartSelectionValue: { fontSize: 10, fontWeight: '800' }, financialChartTouchArea: { width: '100%' }, financialChartLegend: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: -2 }, financialLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, financialLegendBar: { width: 8, height: 8, borderRadius: 2 }, financialLegendLine: { width: 13, height: 2, borderRadius: 2 }, financialLegendText: { fontSize: 9 }, financialChartNote: { fontSize: 8, textAlign: 'center', marginTop: 7 }, quarterRow: { gap: 8, paddingRight: 4 }, quarterCard: { width: 142, borderWidth: 1, borderRadius: 12, padding: 10 }, quarterHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 }, quarterLabel: { fontSize: 10, fontWeight: '900' }, quarterDate: { fontSize: 8 }, quarterRevenue: { fontSize: 17, fontWeight: '900', marginTop: 10 }, quarterCaption: { fontSize: 8, marginBottom: 7 }, quarterLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 5, marginTop: 4 }, quarterKey: { fontSize: 9 }, quarterValue: { fontSize: 9, fontWeight: '800' }, quarterFiled: { fontSize: 8, marginTop: 9 }, expand: { borderWidth: 1, borderRadius: 10, minHeight: 32, alignItems: 'center', justifyContent: 'center', marginTop: 9 }, expandText: { fontSize: 10, fontWeight: '900' }, monthlyTable: { borderWidth: 1, borderRadius: 11, paddingHorizontal: 10 }, monthlyRow: { minHeight: 32, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8 }, monthlyMonth: { width: 62, fontSize: 9 }, monthlyRevenue: { flex: 1, fontSize: 10, fontWeight: '800' }, monthlyYoy: { width: 82, fontSize: 9, textAlign: 'right' }, monthlyGrowthBox: { borderWidth: 1, borderRadius: 11, padding: 10, marginTop: 9 }, monthlyGrowthHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, monthlyGrowthTitle: { fontSize: 10, fontWeight: '900' }, monthlyGrowthHint: { fontSize: 8, marginTop: 2 }, monthlyGrowthBadge: { fontSize: 9, fontWeight: '900' }, monthlyGrowthStats: { flexDirection: 'row', gap: 8, marginTop: 9 }, monthlyGrowthStat: { flex: 1 }, monthlyGrowthLabel: { fontSize: 8 }, monthlyGrowthValue: { fontSize: 15, fontWeight: '900', marginTop: 3 }, monthlyGrowthDescription: { fontSize: 8, lineHeight: 13, marginTop: 8 }, estimateBox: { borderWidth: 1, borderRadius: 11, padding: 10, marginTop: 10 }, estimateDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#64748B55', marginTop: 9, paddingTop: 8 }, estimateTitle: { fontSize: 10, fontWeight: '900' }, estimateText: { fontSize: 9, marginTop: 5 }, state: { minHeight: 140, alignItems: 'center', justifyContent: 'center', borderRadius: 13, padding: 20, gap: 7, marginTop: 12 }, stateTitle: { fontSize: 13, fontWeight: '900' }, stateText: { fontSize: 10, lineHeight: 16, textAlign: 'center' }, warning: { fontSize: 9, lineHeight: 14, marginTop: 10 }, note: { fontSize: 9, lineHeight: 14, marginTop: 9 },
});
