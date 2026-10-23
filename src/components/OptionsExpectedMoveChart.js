import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { calculateExpectedMove, selectAtmIv } from '../services/optionsExpectedMove';
import { fetchOptionHistoricalPoints } from '../services/optionsPriceHistory';

const priceText = value => `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

export default function OptionsExpectedMoveChart({ symbol, expiration, spot, chain, colors }) {
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [width, setWidth] = useState(300);
  const [selection, setSelection] = useState(null);
  const pressTimer = useRef(null);
  const scrubbing = useRef(false);
  const iv = useMemo(() => selectAtmIv(chain?.contracts, spot, expiration), [chain?.contracts, spot, expiration]);
  const expected = useMemo(() => calculateExpectedMove({ spot, expiration, annualIv: iv?.annualIv }), [spot, expiration, iv?.annualIv]);

  useEffect(() => {
    let active = true;
    setHistory(null);
    setSelection(null);
    setHistoryLoading(true);
    fetchOptionHistoricalPoints(symbol).then(points => {
      if (active) setHistory(points);
    }).catch(() => {
      if (active) setHistory(null);
    }).finally(() => {
      if (active) setHistoryLoading(false);
    });
    return () => { active = false; };
  }, [symbol]);

  const chart = useMemo(() => {
    if (!expected) return null;
    const closes = (history || []).map(point => point.close);
    const height = 178;
    const left = 14;
    const right = width - 45;
    const split = left + (right - left) * 0.58;
    const top = 10;
    const bottom = height - 21;
    const allValues = [...closes, expected.lower, expected.upper, expected.spot];
    const low = Math.min(...allValues);
    const high = Math.max(...allValues);
    const padding = Math.max((high - low) * 0.12, expected.spot * 0.005);
    const min = Math.max(0, low - padding);
    const max = high + padding;
    const y = value => bottom - (value - min) / (max - min) * (bottom - top);
    const historical = closes.map((value, index) => ({
      x: left + index / Math.max(1, closes.length - 1) * (split - left - 5), y: y(value),
    }));
    const historicalPath = historical.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const fractions = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const band = fractions.map(fraction => ({
      x: split + fraction * (right - split),
      upper: y(expected.spot + expected.move * Math.sqrt(fraction)),
      lower: y(Math.max(0, expected.spot - expected.move * Math.sqrt(fraction))),
    }));
    const upperPath = band.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.upper.toFixed(1)}`).join(' ');
    const lowerPath = band.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.lower.toFixed(1)}`).join(' ');
    const fillPath = `${upperPath} ${band.slice().reverse().map(point => `L${point.x.toFixed(1)},${point.lower.toFixed(1)}`).join(' ')} Z`;
    return { height, left, right, split, top, bottom, y, historical, historicalPath, upperPath, lowerPath, fillPath };
  }, [expected, history, width]);

  const selectAtX = useMemo(() => x => {
    if (!chart || !expected) return;
    if (x < chart.split && history?.length) {
      const index = Math.max(0, Math.min(history.length - 1,
        Math.round((x - chart.left) / Math.max(1, chart.split - chart.left - 5) * (history.length - 1))));
      const prior = history[index - 1]?.close;
      const dayChange = prior > 0 ? (history[index].close / prior - 1) * 100 : null;
      setSelection({ kind: 'history', x: chart.historical[index].x, y: chart.historical[index].y, ...history[index], dayChange });
      return;
    }
    const progress = Math.max(0, Math.min(1, (x - chart.split) / (chart.right - chart.split)));
    const move = expected.move * Math.sqrt(progress);
    const upper = expected.spot + move;
    const lower = Math.max(0, expected.spot - move);
    setSelection({ kind: 'projection', x: chart.split + progress * (chart.right - chart.split), upper, lower,
      upperY: chart.y(upper), lowerY: chart.y(lower), days: Math.max(0, Math.round(expected.days * progress)) });
  }, [chart, expected, history]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => {
      const x = event.nativeEvent.locationX;
      scrubbing.current = false;
      clearTimeout(pressTimer.current);
      pressTimer.current = setTimeout(() => { scrubbing.current = true; selectAtX(x); }, 320);
    },
    onPanResponderMove: (event, gesture) => {
      if (!scrubbing.current && (Math.abs(gesture.dx) > 8 || Math.abs(gesture.dy) > 8)) clearTimeout(pressTimer.current);
      if (scrubbing.current) selectAtX(event.nativeEvent.locationX);
    },
    onPanResponderRelease: () => { clearTimeout(pressTimer.current); scrubbing.current = false; },
    onPanResponderTerminate: () => { clearTimeout(pressTimer.current); scrubbing.current = false; },
    onPanResponderTerminationRequest: () => !scrubbing.current,
  }), [selectAtX]);

  useEffect(() => () => clearTimeout(pressTimer.current), []);
  useEffect(() => setSelection(null), [expiration, spot]);

  return <View style={[styles.card, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
    <Text style={[styles.title, { color: colors.text }]}>近一個月股價 × 到期預期波動</Text>
    {!iv ? <Text style={[styles.note, { color: colors.warning }]}>選定到期日缺少可用的 ATM IV，暫時無法畫預期區間。</Text>
      : !expected ? <Text style={[styles.note, { color: colors.warning }]}>到期日已過或日期無效，暫時無法畫預期區間。</Text>
        : <>
          <View style={styles.summary}>
            <View><Text style={[styles.summaryLabel, { color: colors.textSub }]}>ATM IV · 年化</Text><Text style={[styles.summaryValue, { color: colors.accent }]}>{(expected.annualIv * 100).toFixed(1)}%</Text></View>
            <View><Text style={[styles.summaryLabel, { color: colors.textSub }]}>Expected Move · 約 {expected.days} 天</Text><Text style={[styles.summaryValue, { color: colors.text }]}>±{expected.movePercent.toFixed(1)}%</Text></View>
          </View>
          {selection && <View style={styles.selectionRow}>
            <Text style={[styles.selectionText, { color: colors.text }]}>
              {selection.kind === 'history'
                ? `${selection.date}  收盤 ${priceText(selection.close)}${selection.dayChange == null ? '' : `  日變動 ${selection.dayChange >= 0 ? '+' : ''}${selection.dayChange.toFixed(2)}%`}`
                : `約 ${selection.days} 天後  上緣 ${priceText(selection.upper)} · 下緣 ${priceText(selection.lower)}`}
            </Text>
            <TouchableOpacity onPress={() => setSelection(null)} accessibilityLabel="清除圖表選取"><Text style={{ color: colors.accent, fontSize: 11 }}>清除</Text></TouchableOpacity>
          </View>}
          <View onLayout={event => setWidth(Math.max(260, event.nativeEvent.layout.width))} style={styles.plot} {...responder.panHandlers}>
            <Svg width="100%" height={chart?.height || 178}>
              {chart && <>
                {[chart.top, chart.y(expected.spot), chart.bottom].map((lineY, index) => <Line key={index} x1={chart.left} y1={lineY} x2={chart.right} y2={lineY} stroke={colors.border} strokeWidth="1" />)}
                <Line x1={chart.split} y1={chart.top} x2={chart.split} y2={chart.bottom} stroke={colors.textMuted} strokeWidth="1" strokeDasharray="3 4" />
                {!!chart.historicalPath && <Path d={chart.historicalPath} fill="none" stroke={colors.accent} strokeWidth="2.5" strokeLinejoin="round" />}
                <Path d={chart.fillPath} fill={colors.accent} opacity="0.16" />
                <Path d={chart.upperPath} fill="none" stroke={colors.positive} strokeWidth="2" strokeDasharray="4 4" />
                <Path d={chart.lowerPath} fill="none" stroke={colors.negative} strokeWidth="2" strokeDasharray="4 4" />
                <Line x1={chart.split} y1={chart.y(expected.spot)} x2={chart.right} y2={chart.y(expected.spot)} stroke={colors.textMuted} strokeWidth="1" strokeDasharray="3 4" />
                <Circle cx={chart.split} cy={chart.y(expected.spot)} r="4" fill={colors.accent} />
                {selection && <>
                  <Line x1={selection.x} y1={chart.top} x2={selection.x} y2={chart.bottom} stroke={colors.textSub} strokeWidth="1" strokeDasharray="3 3" />
                  {selection.kind === 'history'
                    ? <Circle cx={selection.x} cy={selection.y} r="4" fill={colors.accent} stroke={colors.cardAlt} strokeWidth="1" />
                    : <><Circle cx={selection.x} cy={selection.upperY} r="4" fill={colors.positive} /><Circle cx={selection.x} cy={selection.lowerY} r="4" fill={colors.negative} /></>}
                </>}
                <SvgText x={chart.right + 3} y={Math.max(12, chart.y(expected.upper) + (chart.y(expected.lower) - chart.y(expected.upper) < 16 ? -4 : 4))} fontSize="9" fill={colors.positive}>上緣</SvgText>
                <SvgText x={chart.right + 3} y={Math.min(chart.bottom, chart.y(expected.lower) + (chart.y(expected.lower) - chart.y(expected.upper) < 16 ? 12 : 4))} fontSize="9" fill={colors.negative}>下緣</SvgText>
                <SvgText x={chart.left} y={chart.height - 4} fontSize="9" fill={colors.textMuted}>{history?.length ? '近一個月收盤' : '歷史收盤'}</SvgText>
                <SvgText x={chart.right} y={chart.height - 4} fontSize="9" textAnchor="end" fill={colors.textMuted}>{expiration.slice(5)} 到期</SvgText>
              </>}
            </Svg>
          </View>
          <View style={styles.rangeRow}><Text style={[styles.rangeValue, { color: colors.negative }]}>{priceText(expected.lower)}</Text><Text style={[styles.rangeValue, { color: colors.textSub }]}>{priceText(expected.spot)}</Text><Text style={[styles.rangeValue, { color: colors.positive }]}>{priceText(expected.upper)}</Text></View>
          <Text style={[styles.note, { color: colors.textMuted }]}>長按左側查看近一個月每日收盤與漲跌；右側為選定到期日前的 IV 推算區間。</Text>
          {historyLoading && <View style={styles.loading}><ActivityIndicator size="small" color={colors.accent} /><Text style={[styles.note, { color: colors.textMuted }]}>歷史收盤載入中，預期區間已先顯示</Text></View>}
          {!historyLoading && !history?.length && <Text style={[styles.note, { color: colors.textMuted }]}>歷史收盤暫時無法取得；右側 IV 區間仍可查看。</Text>}
          <Text style={[styles.note, { color: colors.textMuted }]}>±1σ＝現價×年化 IV×√(天數/365)；非價格預測或獲利機率。歷史與選擇權報價時間可能不同。</Text>
        </>}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 11, padding: 9, gap: 5 },
  title: { fontSize: 13, fontWeight: '900' }, note: { fontSize: 10, lineHeight: 14 },
  summary: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  summaryLabel: { fontSize: 10, fontWeight: '700' }, summaryValue: { fontSize: 15, fontWeight: '900', marginTop: 1 },
  selectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 }, selectionText: { flex: 1, fontSize: 10, fontWeight: '700' },
  plot: { width: '100%', minHeight: 178 }, rangeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 3 }, rangeValue: { fontSize: 11, fontWeight: '800' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
});
