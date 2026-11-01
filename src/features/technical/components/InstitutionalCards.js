import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { BarChart3, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react-native';
import Svg, { Circle } from 'react-native-svg';
import CompactDataTable from '../../../components/CompactDataTable';
import { calculateInstitutionalPressurePrices, calculateInstitutionalTotals, joinInstitutionalRowsWithClosingPrices } from '../../../utils/institutionalTotals';

const compactShares = value => {
  const amount = Number(value || 0);
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  const absolute = Math.abs(amount);
  if (absolute >= 100000000) return `${sign}${(absolute / 100000000).toFixed(1)}億`;
  if (absolute >= 10000) return `${sign}${(absolute / 10000).toFixed(1)}萬`;
  return `${sign}${Math.round(absolute).toLocaleString('zh-TW')}`;
};

const exactShares = value => {
  const amount = Math.round(Number(value || 0));
  return `${amount < 0 ? '−' : ''}${Math.abs(amount).toLocaleString('zh-TW')}`;
};

export function InstitutionalDailyTable({ rows = [], priceRows = [], colors, styles }) {
  const [expanded, setExpanded] = useState(false);
  const tableRows = useMemo(() => joinInstitutionalRowsWithClosingPrices(rows, priceRows).slice(0, expanded ? 30 : 5), [rows, priceRows, expanded]);
  const totals = useMemo(() => calculateInstitutionalTotals(rows), [rows]);
  const pressurePrices = useMemo(() => new Map(calculateInstitutionalPressurePrices(rows, priceRows).map(item => [item.days, item])), [rows, priceRows]);
  if (!tableRows.length) return null;
  const columns = [
    ['foreign', '外資（股）'], ['trust', '投信（股）'], ['dealer', '自營商（股）'], ['all', '三大法人（股）'], ['close', '股價／力道參考價'],
  ];
  const entries = [
    ...totals.map(total => ({ id: `total-${total.days}`, total, label: `${total.days}日合計` })),
    ...tableRows.map(row => ({ id: row.time, row, label: row.time.slice(5).replace('-', '/') })),
  ];
  const cellValue = (entry, key) => {
    if (entry.total) {
      const total = entry.total;
      const value = total[key];
      const pressure = pressurePrices.get(total.days);
      return {
        text: key === 'close' ? pressure?.price != null ? `${pressure.direction === 'buy' ? '買超' : '賣超'} ${pressure.price.toFixed(2)}` : '—' : total.complete ? exactShares(value) : '—',
        color: key === 'close' ? pressure?.price != null ? colors.text : colors.textMuted : !total.complete ? colors.textMuted : value > 0 ? colors.positive : value < 0 ? colors.negative : colors.textSub,
      };
    }
    const value = entry.row[key];
    return {
      text: value === null ? '—' : key === 'close' ? value.toFixed(2) : exactShares(value),
      color: value === null ? colors.textMuted : key === 'close' ? colors.text : value > 0 ? colors.positive : value < 0 ? colors.negative : colors.textMuted,
    };
  };
  return <View style={[styles.institutionTableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.institutionTableTitleRow}><View><Text style={[styles.institutionTableTitle, { color: colors.text }]}>法人每日買賣超明細</Text><Text style={[styles.institutionTableSubtitle, { color: colors.textMuted }]}>單位：股 · 依已公布交易日由新到舊</Text></View><TouchableOpacity onPress={() => setExpanded(value => !value)} style={[styles.institutionTableToggle, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.institutionTableToggleText, { color: colors.accent }]}>{expanded ? '收合' : '近 30 日'}</Text>{expanded ? <ChevronUp size={13} color={colors.accent} /> : <ChevronDown size={13} color={colors.accent} />}</TouchableOpacity></View>
    <CompactDataTable style={{ marginHorizontal: 12 }} rows={entries} rowKey={entry => entry.id} colors={colors}
      fixedColumn={{ header: '日期／期間', width: 76, render: entry => entry.label }}
      columns={columns.map(([key, label]) => ({ key, header: label, width: 115, render: entry => cellValue(entry, key).text, color: entry => cellValue(entry, key).color }))} />
    <Text style={[styles.institutionTableNote, { color: colors.textMuted }]}>5／10／20／30 日合計採最近 N 個已公布交易日；不足 N 日或欄位缺值顯示「—」。最右欄每日為同日收盤價；合計列依期間三大法人淨買賣超方向，以同方向每日買賣超股數加權收盤價估算。這是買賣力道參考價，並非法人實際成交均價或持股成本；淨額為零時不顯示。自營商包含自行買賣與避險；三大法人＝外資＋投信＋自營商。</Text>
  </View>;
}

export function InstitutionalAnalysisCard({ analysis, selectedStrategy, distribution, distributionLoading, distributionError, onRefreshDistribution, isTaiwanMarket, colors, styles }) {
  const institutional = analysis?.institutional;
  if (!institutional) return isTaiwanMarket
    ? <InstitutionalDistributionCard data={distribution} loading={distributionLoading} error={distributionError} onRefresh={onRefreshDistribution} colors={colors} styles={styles} />
    : null;

  const periods = [
    { key: 'day1', label: '1 日' },
    { key: 'day3', label: '3 日' },
    { key: 'day5', label: '5 日' },
    { key: 'day20', label: '20 日' },
  ];
  const strategies = analysis?.strategies || [];
  const selectedResult = selectedStrategy === 'ALL'
    ? strategies.find(item => item.status === 'confirmed' && item.institutional)
      || strategies.find(item => item.status === 'watch' && item.institutional)
    : strategies.find(item => item.key === selectedStrategy);
  const confirmation = selectedResult?.institutional;
  const fiveDay = institutional.day5;
  const institutionalAsOf = fiveDay?.asOf || institutional.day1?.asOf || null;
  const candleAsOf = analysis?.latest?.time || null;
  const isInstitutionalLagging = Boolean(institutionalAsOf && candleAsOf && institutionalAsOf < candleAsOf);
  const direction = confirmation?.direction || (Number(fiveDay?.directional || 0) >= 0 ? 'bullish' : 'bearish');
  const statusColor = confirmation?.available
    ? (confirmation.passed ? (direction === 'bearish' ? colors.negative : colors.positive) : colors.warning)
    : colors.textMuted;
  const statusLabel = confirmation?.available
    ? (confirmation.passed ? '法人同向' : '法人未同向')
    : fiveDay ? (fiveDay.directional > 0 ? '近 5 日偏多' : fiveDay.directional < 0 ? '近 5 日偏空' : '近 5 日中性') : '資料待更新';
  const breakdown = [
    { label: '外資', value: fiveDay?.foreign },
    { label: '投信', value: fiveDay?.trust },
    { label: '自營商自行買賣', value: fiveDay?.dealerSelf },
  ];

  return (
    <View style={[styles.institutionalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.institutionalHeader}>
        <View style={styles.chartTitleRow}><BarChart3 size={17} color={colors.accent} /><View><Text style={[styles.institutionalTitle, { color: colors.text }]}>法人籌碼確認</Text><Text style={[styles.institutionalSubtitle, { color: colors.textMuted }]}>外資＋投信淨額 · 單位：股</Text><Text style={[styles.institutionalSubtitle, { color: isInstitutionalLagging ? colors.warning : colors.textMuted }]}>{institutionalAsOf ? `法人資料截至 ${institutionalAsOf}${isInstitutionalLagging ? `（日 K 截至 ${candleAsOf}）` : ''}` : '法人資料日期待更新'}</Text></View></View>
        <View style={[styles.institutionalBadge, { backgroundColor: `${statusColor}18`, borderColor: statusColor }]}><Text style={[styles.institutionalBadgeText, { color: statusColor }]}>{statusLabel}</Text></View>
      </View>

      <View style={styles.institutionalPeriods}>{periods.map(item => {
        const summary = institutional[item.key];
        const value = Number(summary?.directional || 0);
        const color = !summary ? colors.textMuted : value > 0 ? colors.positive : value < 0 ? colors.negative : colors.textSub;
        return <View key={item.key} style={[styles.institutionalPeriod, { backgroundColor: colors.cardAlt, borderColor: colors.borderLight }]}><Text style={[styles.institutionalPeriodLabel, { color: colors.textMuted }]}>{item.label}</Text><Text style={[styles.institutionalPeriodValue, { color }]}>{summary ? compactShares(value) : '—'}</Text></View>;
      })}</View>

      <View style={[styles.institutionalBreakdown, { borderTopColor: colors.borderLight }]}>{breakdown.map(item => {
        const value = Number(item.value || 0);
        const color = value > 0 ? colors.positive : value < 0 ? colors.negative : colors.textSub;
        return <View key={item.label} style={styles.institutionalBreakdownRow}><Text style={[styles.institutionalBreakdownLabel, { color: colors.textSub }]}>{item.label}近 5 日</Text><Text style={[styles.institutionalBreakdownValue, { color }]}>{fiveDay ? `${compactShares(value)} 股` : '—'}</Text></View>;
      })}</View>

      <View style={[styles.institutionalNote, { backgroundColor: colors.cardAlt }]}><Text style={[styles.institutionalNoteText, { color: colors.textSub }]}>「近 N 日」採用截至上方日期最近 N 個已公布的法人交易日。盤後資料尚未發布時，可能仍停在前一交易日；技術訊號為偏多時，外資＋投信近 5 日合計需買超且至少 3 日買超，偏空則反向。自營商避險部位不納入方向確認。</Text></View>
      {isTaiwanMarket && <View style={[styles.institutionalDistributionSection, { borderTopColor: colors.borderLight }]}>
        <InstitutionalDistributionCard data={distribution} loading={distributionLoading} error={distributionError} onRefresh={onRefreshDistribution} colors={colors} styles={styles} embedded />
      </View>}
    </View>
  );
}

const DISTRIBUTION_LABELS = {
  directors: '董監',
  foreign: '外資',
  trust: '投信',
  dealer: '自營商',
  other: '其他',
};

function InstitutionalDistributionCard({ data, loading, error, onRefresh, colors, styles, embedded = false }) {
  const categories = data?.categories || [];
  const palette = [colors.warning, colors.accent, colors.negative, '#A78BFA', '#A8C63A'];
  const categorizedTotal = categories.reduce((sum, item) => sum + Number(item.sharesLots || 0), 0);
  const total = Number(data?.issuedLots || 0) || categorizedTotal;
  const chartTotal = data?.overlaps ? categorizedTotal : total;
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  let progress = 0;

  return <View style={[styles.distributionCard, embedded ? { borderWidth: 0, padding: 0, backgroundColor: 'transparent' } : { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.distributionHeader}>
      <View style={styles.flex}>
        <Text style={[styles.distributionTitle, { color: colors.text }]}>籌碼分布</Text>
        <Text style={[styles.distributionSubtitle, { color: colors.textMuted }]}>{data?.asOf ? `資料截至 ${data.asOf}` : '法人與董監持股存量'}</Text>
      </View>
      <TouchableOpacity style={[styles.distributionRefresh, { backgroundColor: colors.cardAlt, borderColor: colors.border }]} onPress={onRefresh} disabled={loading}>
        {loading ? <ActivityIndicator size="small" color={colors.accent} /> : <RefreshCw size={14} color={colors.accent} />}
      </TouchableOpacity>
    </View>

    {error && !data ? <View style={[styles.distributionEmpty, { backgroundColor: colors.cardAlt }]}><Text style={[styles.distributionEmptyTitle, { color: colors.textSub }]}>籌碼分布暫時無法取得</Text><Text style={[styles.distributionEmptyText, { color: colors.textMuted }]}>{error}</Text></View> : null}

    {data ? <>
      <View style={styles.distributionOverview}>
        <View style={styles.donutWrap}>
          <Svg width={112} height={112} viewBox="0 0 112 112">
            <Circle cx="56" cy="56" r={radius} fill="none" stroke={colors.cardAlt} strokeWidth="20" />
            {categories.map((item, index) => {
              const fraction = chartTotal > 0 ? Math.max(0, Number(item.sharesLots || 0)) / chartTotal : 0;
              const length = Math.min(circumference, fraction * circumference);
              const offset = progress * circumference;
              progress += fraction;
              return <Circle key={item.key} cx="56" cy="56" r={radius} fill="none" stroke={palette[index % palette.length]} strokeWidth="20" strokeDasharray={`${length} ${Math.max(0, circumference - length)}`} strokeDashoffset={-offset} strokeLinecap="butt" transform="rotate(-90 56 56)" />;
            })}
          </Svg>
          <View style={styles.donutCenter}><Text style={[styles.donutCenterValue, { color: colors.text }]}>{data?.overlaps ? '重疊' : total ? compactShares(total) : '—'}</Text><Text style={[styles.donutCenterLabel, { color: colors.textMuted }]}>{data?.overlaps ? '分類持股' : '總發行張數'}</Text></View>
        </View>
        <View style={styles.distributionLegend}>{categories.map((item, index) => <View key={item.key} style={styles.legendRow}><View style={[styles.legendDot, { backgroundColor: palette[index % palette.length] }]} /><Text style={[styles.legendLabel, { color: colors.textSub }]}>{DISTRIBUTION_LABELS[item.key] || item.key}</Text><Text style={[styles.legendRatio, { color: colors.text }]}>{Number(item.ratio || 0).toFixed(2)}%</Text></View>)}</View>
      </View>

      <CompactDataTable style={{ marginTop: 8 }} rows={categories} rowKey={item => item.key} colors={colors} fixedColumn={{ header: '項目', width: 86, render: item => DISTRIBUTION_LABELS[item.key] || item.key }} columns={[{ key: 'shares', header: '持股張數', width: 112, render: item => Math.round(Number(item.sharesLots || 0)).toLocaleString('zh-TW') }, { key: 'ratio', header: '持股比', width: 88, render: item => `${Number(item.ratio || 0).toFixed(2)}%` }]} />

      <Text style={[styles.distributionNote, { color: data.overlaps ? colors.warning : colors.textMuted }]}>{data.overlaps ? '董監身分可能同時屬於外資，分類發生重疊，因此不以「其他」硬湊為 100%。' : '其他＝官方發行股數扣除董監、外資、投信與自營商；這是持股存量，不是當日買賣超。'}</Text>
      <TouchableOpacity onPress={() => data.sourceUrl && Linking.openURL(data.sourceUrl)} disabled={!data.sourceUrl}><Text style={[styles.distributionSource, { color: colors.accent }]}>{data.source || '查看資料來源'} ↗</Text></TouchableOpacity>
    </> : null}
  </View>;
}
