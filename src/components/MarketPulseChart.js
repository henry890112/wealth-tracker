import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { fetchMarketTechnicalContext } from '../services/technicalAnalysis';
import { fetchTpexIndexHistory, formatMarketPulsePrice, marketPulseDailyChangePercent, withDailyMovingAverages } from '../services/marketOverview';

const ranges = [{ days: 31, label: '近一月' }, { days: 93, label: '近三月' }, { days: 366, label: '近一年' }];
const MA20_COLOR = '#EF8D52';
const MA60_COLOR = '#B69AF4';

export default function MarketPulseChart({ item, colors, refreshKey, forceRefresh, quoteLabel, onOpen, onCollapse, onPointChange }) {
  const [context, setContext] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [days, setDays] = useState(93);
  const [width, setWidth] = useState(300);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setContext(null);
    setError(false);
    setSelected(null);
    const request = item.provider === 'tpex'
      ? fetchTpexIndexHistory()
      : fetchMarketTechnicalContext(item.symbol, item.market, 400, retry > 0 || forceRefresh, true);
    request
      .then(result => { if (active) setContext(result); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [item.symbol, item.market, item.provider, refreshKey, retry, forceRefresh]);
  const allRows = useMemo(() => withDailyMovingAverages((context?.rows || [])
    .filter(row => row.time && ['open', 'high', 'low', 'close'].every(key => typeof row[key] === 'number' && Number.isFinite(row[key])) && row.low > 0 && row.high >= Math.max(row.open, row.close) && row.low <= Math.min(row.open, row.close))
    .sort((a, b) => String(a.time).localeCompare(String(b.time)))), [context]);
  const showIndexAverages = item.symbol === '^TWII';
  const rows = useMemo(() => {
    const last = allRows.at(-1);
    if (!last) return [];
    const cutoff = new Date(last.time).getTime() - days * 86400000;
    return allRows.filter(row => new Date(row.time).getTime() >= cutoff);
  }, [allRows, days]);
  const left = 4;
  const right = 62;
  const plotWidth = Math.max(1, width - left - right);
  const choose = x => {
    if (!rows.length) return;
    const index = Math.max(0, Math.min(rows.length - 1, Math.floor((x - left) / plotWidth * rows.length)));
    const row = rows[index];
    const allIndex = allRows.findIndex(candidate => candidate.time === row.time);
    setSelected(index);
    onPointChange?.({ date: row.time, close: row.close, changePercent: marketPulseDailyChangePercent(row.close, allIndex > 0 ? allRows[allIndex - 1].close : null) });
  };
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 5 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: event => choose(event.nativeEvent.locationX),
    onPanResponderMove: event => choose(event.nativeEvent.locationX),
  });
  const chosen = rows[selected === null ? rows.length - 1 : Math.min(selected, rows.length - 1)];
  const low = Math.min(...rows.flatMap(row => [row.low, ...(showIndexAverages ? [row.ma20, row.ma60].filter(Number.isFinite) : [])]));
  const high = Math.max(...rows.flatMap(row => [row.high, ...(showIndexAverages ? [row.ma20, row.ma60].filter(Number.isFinite) : [])]));
  const margin = Math.max((high - low) * 0.12, high * 0.002);
  const min = low - margin;
  const max = high + margin;
  const y = value => 10 + (max - value) / (max - min) * 126;
  const step = plotWidth / Math.max(1, rows.length);
  const x = index => left + (index + 0.5) * step;
  const selectedRowIndex = selected === null || !chosen ? -1 : allRows.findIndex(row => row.time === chosen.time);
  const previousClose = selectedRowIndex > 0 ? allRows[selectedRowIndex - 1].close : null;
  const change = selected === null ? item.quote?.change_percent : marketPulseDailyChangePercent(chosen?.close, previousClose);
  const color = change > 0 ? colors.positive : change < 0 ? colors.negative : colors.textSub;
  return (
    <View style={[styles.card, { backgroundColor: colors.cardAlt, borderColor: colors.accent }]}>
      <View style={styles.header}>
        <Text style={[styles.name, { color: colors.text }]}>{item.name}</Text>
        <TouchableOpacity onPress={onCollapse} accessibilityRole="button" accessibilityLabel={showIndexAverages ? '收合 K 線與均線' : '收合 K 線'} style={styles.collapse}><Text style={{ color: colors.accent, fontSize: 12 }}>收合 ⌃</Text></TouchableOpacity>
      </View>
      <View style={styles.header}>
        <Text style={[styles.price, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{formatMarketPulsePrice(selected === null ? item.quote?.price : chosen?.close)}</Text>
        <Text style={{ color, fontSize: 16, fontWeight: '700' }}>{change != null && Number.isFinite(Number(change)) ? `${change > 0 ? '+' : ''}${Number(change).toFixed(2)}%` : '—'}</Text>
      </View>
      <Text style={[styles.meta, { color: colors.textMuted }]}>{selected === null ? `${quoteLabel} · 日 K` : `${chosen?.time} · 歷史日 K · 較前一交易日`}</Text>
      <View onLayout={event => setWidth(event.nativeEvent.layout.width)}>
        {loading ? <View style={styles.empty}><ActivityIndicator color={colors.accent} /><Text style={{ color: colors.textMuted }}>載入 K 線中</Text></View> : error || !rows.length ? (
          <View style={styles.empty}><Text style={{ color: colors.textMuted }}>暫時無法取得 K 線資料</Text><TouchableOpacity onPress={() => setRetry(value => value + 1)} accessibilityRole="button"><Text style={{ color: colors.accent }}>重新載入</Text></TouchableOpacity></View>
        ) : <>
          {selected !== null && <Text style={[styles.readout, { color: colors.textSub }]}>{chosen?.time}　開 {formatMarketPulsePrice(chosen?.open)}　高 {formatMarketPulsePrice(chosen?.high)}{'\n'}低 {formatMarketPulsePrice(chosen?.low)}　收 {formatMarketPulsePrice(chosen?.close)}</Text>}
          {showIndexAverages && <View style={styles.averageLegend}>
            <Text style={[styles.averageText, { color: MA20_COLOR }]}>月線 MA20 {chosen?.ma20 == null ? '—' : formatMarketPulsePrice(chosen.ma20)}</Text>
            <Text style={[styles.averageText, { color: MA60_COLOR }]}>季線 MA60 {chosen?.ma60 == null ? '—' : formatMarketPulsePrice(chosen.ma60)}</Text>
          </View>}
          <View {...responder.panHandlers} onTouchEnd={event => choose(event.nativeEvent.locationX)}>
            <Svg width={width} height={158}>
              {[0, 0.5, 1].map(ratio => {
                const value = max - (max - min) * ratio;
                return <React.Fragment key={ratio}><Line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke={colors.border} /><SvgText x={width - right + 5} y={y(value) + 4} fill={colors.textMuted} fontSize={10}>{formatMarketPulsePrice(value)}</SvgText></React.Fragment>;
              })}
              {rows.map((row, index) => {
                const candleColor = row.close >= row.open ? colors.positive : colors.negative;
                const bodyWidth = Math.max(1, step * 0.65);
                return <React.Fragment key={`${row.time}:${index}`}><Line x1={x(index)} x2={x(index)} y1={y(row.high)} y2={y(row.low)} stroke={candleColor} /><Rect x={x(index) - bodyWidth / 2} y={Math.min(y(row.open), y(row.close))} width={bodyWidth} height={Math.max(1, Math.abs(y(row.open) - y(row.close)))} fill={candleColor} /></React.Fragment>;
              })}
              {showIndexAverages && [
                { key: 'ma20', color: MA20_COLOR }, { key: 'ma60', color: MA60_COLOR },
              ].map(average => {
                const points = rows.flatMap((row, index) => Number.isFinite(row[average.key]) ? [`${x(index)},${y(row[average.key])}`] : []);
                return points.length >= 2 ? <Polyline key={average.key} points={points.join(' ')} fill="none" stroke={average.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" /> : null;
              })}
              {selected !== null && <Line x1={x(Math.min(selected, rows.length - 1))} x2={x(Math.min(selected, rows.length - 1))} y1={10} y2={136} stroke={colors.accent} strokeDasharray="3 3" />}
              <SvgText x={left} y={152} fill={colors.textMuted} fontSize={10}>{rows[0].time}</SvgText>
              <SvgText x={width - right} y={152} textAnchor="end" fill={colors.textMuted} fontSize={10}>{rows.at(-1).time}</SvgText>
            </Svg>
          </View>
          <Text style={[styles.meta, { color: colors.textMuted }]}>{context?.isIntraday ? (showIndexAverages ? '當日 K 與均線未定稿 · ' : '當日 K 未定稿 · ') : ''}{showIndexAverages ? '拖曳查看開高低收、月線與季線' : '拖曳查看開高低收'}</Text>
        </>}
      </View>
      <View style={styles.ranges}>{ranges.map(range => <TouchableOpacity key={range.days} accessibilityRole="button" accessibilityState={{ selected: days === range.days }} onPress={() => { setDays(range.days); setSelected(null); onPointChange?.(null); }} style={[styles.range, { backgroundColor: days === range.days ? colors.accentSoft : colors.card }]}><Text style={{ color: days === range.days ? colors.accent : colors.textSub }}>{range.label}</Text></TouchableOpacity>)}</View>
      {onOpen && <TouchableOpacity onPress={onOpen} accessibilityRole="button" style={styles.open}><Text style={{ color: colors.accent, fontWeight: '700' }}>完整技術分析 ›</Text></TouchableOpacity>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 10, marginTop: 6, marginBottom: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginVertical: 0 },
  collapse: { minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '800', flexShrink: 1 },
  price: { fontSize: 21, fontWeight: '800', flexShrink: 1, fontVariant: ['tabular-nums'] },
  meta: { fontSize: 10, lineHeight: 14, marginVertical: 3 },
  readout: { fontSize: 10, lineHeight: 15, marginTop: 3 },
  averageLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 3 },
  averageText: { fontSize: 10, fontWeight: '700' },
  empty: { height: 158, alignItems: 'center', justifyContent: 'center', gap: 10 },
  ranges: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 0 },
  range: { paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', borderRadius: 18 },
  open: { alignItems: 'center', minHeight: 44, justifyContent: 'center' },
});
