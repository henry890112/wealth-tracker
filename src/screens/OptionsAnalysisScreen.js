import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { RefreshCw, Search } from 'lucide-react-native';
import Svg, { Path, Line, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../lib/ThemeContext';
import OptionsAICard from '../components/OptionsAICard';
import { expirationCountdownLabel } from '../utils/optionsExpiration';
import { fetchLatestMarketQuote } from '../services/api';
import {
  calculateOptionsAnalytics,
  fetchOptionChain,
  fetchOptionExpirations,
  filterContractsByRange,
  normalizeOptionSymbol,
  normalizeTaiwanOptionSymbol,
} from '../services/optionsAnalytics';

const RANGE_OPTIONS = [
  { key: '15', label: '±15%', value: 0.15 },
  { key: '30', label: '±30%', value: 0.30 },
  { key: 'ALL', label: '全部', value: null },
];
const OPTIONS_SNAPSHOT_TTL = 30 * 1000;
const EMPTY_SCENARIO_GEX_CURVE = [];

const numberText = (value, digits = 2) => Number.isFinite(Number(value))
  ? Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  : '—';

const compact = value => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const absolute = Math.abs(amount);
  if (absolute >= 1e9) return `${(amount / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${(amount / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `${(amount / 1e3).toFixed(1)}K`;
  return amount.toFixed(0);
};

function Metric({ label, value, hint, color, colors }) {
  return (
    <View style={[styles.metric, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
      <Text style={[styles.metricLabel, { color: colors.textSub }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: color || colors.text }]}>{value}</Text>
      {!!hint && <Text style={[styles.metricHint, { color: colors.textMuted }]}>{hint}</Text>}
    </View>
  );
}

function DistributionChart({ rows, mode, spot, callWall, putWall, scenarioGexCurve = EMPTY_SCENARIO_GEX_CURVE, colors, availableWidth }) {
  const [selected, setSelected] = useState(null);
  const longPressTimer = useRef(null);
  const scrubActive = useRef(false);
  const startX = useRef(0);
  const selectAtXRef = useRef(null);
  const beginScrubRef = useRef(null);
  const endScrubRef = useRef(null);
  const panResponderRef = useRef(null);
  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);
  useEffect(() => {
    // A quote/chain refresh changes every GEX value. Do not keep a tooltip
    // object from the previous snapshot, otherwise the bars and detail box
    // can temporarily show two different calculations.
    setSelected(null);
    scrubActive.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }, [mode, rows, scenarioGexCurve, spot]);
  const values = rows.map(row => mode === 'gex'
    ? { positive: row.callGex, negative: row.putGex }
    : { positive: row.callVolume, negative: -row.putVolume });
  const maximum = Math.max(1, ...values.flatMap(value => [Math.abs(value.positive), Math.abs(value.negative)]));
  const width = Math.max(290, availableWidth);
  const height = mode === 'gex' ? 252 : 224;
  const left = 44;
  const right = mode === 'gex' ? 44 : 14;
  // Reserve annotation bands above and below the plot so marker badges never
  // cover the bars or the profile curve.
  const top = mode === 'gex' ? 58 : 18;
  const bottom = mode === 'gex' ? 58 : 44;
  const zeroY = top + (height - top - bottom) / 2;
  const halfHeight = zeroY - top - 8;
  const minimumPrice = Number(rows[0]?.strike || 0);
  const maximumPrice = Number(rows.at(-1)?.strike || minimumPrice + 1);
  const priceSpan = Math.max(maximumPrice - minimumPrice, 1);
  const chartSpan = width - left - right;
  const xForPrice = price => left + (Math.max(minimumPrice, Math.min(maximumPrice, Number(price))) - minimumPrice) / priceSpan * chartSpan;
  const gaps = rows.slice(1).map((row, index) => xForPrice(row.strike) - xForPrice(rows[index].strike)).filter(gap => gap > 0);
  const minimumGap = gaps.length ? Math.min(...gaps) : chartSpan;
  const barWidth = Math.max(2, Math.min(13, minimumGap * 0.72));
  const spotIndex = rows.reduce((best, row, index) => Math.abs(row.strike - spot) < Math.abs(rows[best]?.strike - spot) ? index : best, 0);
  const labelEvery = Math.max(1, Math.ceil(rows.length / 7));
  const scenarioByPrice = new Map(scenarioGexCurve.map(point => [Number(point.price), point]));
  const hasScenarioCurve = mode === 'gex' && rows.every(row => scenarioByPrice.has(Number(row.strike)));
  const netProfile = rows.map(row => hasScenarioCurve
    ? Number(scenarioByPrice.get(Number(row.strike))?.totalGex || 0)
    : Number(row.netGex || 0));
  const profileMaximum = Math.max(1, ...netProfile.map(Math.abs));
  const profilePoints = netProfile.map((value, index) => {
    const x = xForPrice(rows[index].strike);
    const y = zeroY - value / profileMaximum * halfHeight * 0.82;
    return { x, y };
  });
  const profilePath = profilePoints.length ? profilePoints.slice(1).reduce((path, point, index) => {
    const previous = profilePoints[index];
    const midX = (previous.x + point.x) / 2;
    const midY = (previous.y + point.y) / 2;
    return `${path} Q ${previous.x.toFixed(2)} ${previous.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
  }, `M ${profilePoints[0].x.toFixed(2)} ${profilePoints[0].y.toFixed(2)}`) + (profilePoints.length > 1 ? ` T ${profilePoints.at(-1).x.toFixed(2)} ${profilePoints.at(-1).y.toFixed(2)}` : '') : '';
  let zeroGammaIndex = 0;
  let zeroGammaStrike = rows[0]?.strike ?? null;
  let zeroGammaX = left;
  if (netProfile.length) {
    zeroGammaIndex = netProfile.reduce((best, value, index) => Math.abs(value) < Math.abs(netProfile[best]) ? index : best, 0);
    const crossings = netProfile.flatMap((value, index) => index > 0 && Math.sign(value) !== Math.sign(netProfile[index - 1]) ? [index] : []);
    if (crossings.length) zeroGammaIndex = crossings.reduce((best, index) => Math.abs(index - spotIndex) < Math.abs(best - spotIndex) ? index : best, crossings[0]);
    const previousIndex = Math.max(0, zeroGammaIndex - 1);
    const previousValue = netProfile[previousIndex];
    const currentValue = netProfile[zeroGammaIndex];
    const denominator = Math.abs(previousValue) + Math.abs(currentValue);
    const ratio = previousIndex === zeroGammaIndex || denominator === 0 ? 1 : Math.abs(previousValue) / denominator;
    const previousStrike = Number(rows[previousIndex]?.strike);
    const currentStrike = Number(rows[zeroGammaIndex]?.strike);
    zeroGammaStrike = previousIndex === zeroGammaIndex ? currentStrike : previousStrike + (currentStrike - previousStrike) * ratio;
    zeroGammaX = xForPrice(zeroGammaStrike);
  }

  if (!rows.length) return <View style={[styles.emptyChart, { backgroundColor: colors.cardAlt }]}><Text style={{ color: colors.textMuted }}>此範圍沒有可繪製的選擇權資料</Text></View>;

  const clampMarkerX = (center, markerWidth) => Math.max(left, Math.min(width - right - markerWidth, center - markerWidth / 2));
  const renderMarkerBadge = (key, center, y, label, color, markerWidth = 78) => {
    const x = clampMarkerX(center, markerWidth);
    return (
      <React.Fragment key={key}>
        <Rect x={x} y={y} width={markerWidth} height="18" rx="6" fill={colors.cardAlt} stroke={color} strokeWidth="1" opacity="0.96" />
        <SvgText x={x + markerWidth / 2} y={y + 12} fill={color} fontSize="8.5" fontWeight="700" textAnchor="middle">{label}</SvgText>
      </React.Fragment>
    );
  };
  const callWallIndex = rows.findIndex(row => row.strike === callWall);
  const putWallIndex = rows.findIndex(row => row.strike === putWall);
  const callWallBadgeY = callWallIndex >= 0 ? 20 : null;
  const putWallBadgeY = putWallIndex >= 0 ? height - bottom + 4 : null;
  const zeroGammaBadgeY = 40;

  const clearTimer = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };
  const selectAtX = xValue => {
    const bounded = Math.max(left, Math.min(width - right, Number(xValue) || left));
    const selectedPrice = minimumPrice + (bounded - left) / Math.max(chartSpan, 1) * priceSpan;
    const index = rows.reduce((best, row, rowIndex) => Math.abs(row.strike - selectedPrice) < Math.abs(rows[best].strike - selectedPrice) ? rowIndex : best, 0);
    setSelected({
      row: rows[index],
      value: values[index],
      // The plotted profile is a different measure from the two bars:
      // for US chains it is full-chain GEX repriced at this hypothetical
      // underlying price; for chains without IV it falls back to row net GEX.
      profileValue: netProfile[index],
      index,
    });
  };
  const beginScrub = xValue => {
    clearTimer();
    startX.current = Number(xValue) || left;
    longPressTimer.current = setTimeout(() => {
      scrubActive.current = true;
      selectAtX(startX.current);
    }, 320);
  };
  const endScrub = () => {
    clearTimer();
    scrubActive.current = false;
  };
  selectAtXRef.current = selectAtX;
  beginScrubRef.current = beginScrub;
  endScrubRef.current = endScrub;
  if (!panResponderRef.current) panResponderRef.current = PanResponder.create({
    onStartShouldSetPanResponderCapture: event => {
      beginScrubRef.current?.(event.nativeEvent.locationX);
      // The chart must own this gesture; otherwise the surrounding ScrollView
      // consumes it before the long-press timer can enter scrub mode.
      return true;
    },
    onMoveShouldSetPanResponder: () => scrubActive.current,
    onPanResponderMove: event => {
      if (scrubActive.current) selectAtXRef.current?.(event.nativeEvent.locationX);
    },
    onPanResponderRelease: () => endScrubRef.current?.(),
    onPanResponderTerminate: () => endScrubRef.current?.(),
  });
  const selectedX = selected ? xForPrice(selected.row.strike) : null;

  return (
    <View>
      {selected && <View style={[styles.chartTooltip, { backgroundColor: colors.cardAlt, borderColor: colors.accent }]}>
        <View style={styles.chartTooltipHeader}><Text numberOfLines={1} style={[styles.chartTooltipTitle, { color: colors.text }]}>履約價 {numberText(selected.row.strike)}</Text><TouchableOpacity onPress={() => setSelected(null)} style={styles.chartTooltipCloseButton}><Text style={[styles.chartTooltipClose, { color: colors.textMuted }]}>關閉</Text></TouchableOpacity></View>
        <View style={styles.chartTooltipMetrics}>
          {(mode === 'gex' ? [
            { label: '看漲 GEX', value: compact(selected.row.callGex), color: colors.positive },
            { label: '看跌 GEX', value: compact(Math.abs(selected.row.putGex)), color: colors.negative },
            { label: hasScenarioCurve ? '情境總 GEX' : '淨 GEX', value: compact(selected.profileValue), color: selected.profileValue >= 0 ? colors.positive : colors.negative },
          ] : [
            { label: '看漲量', value: compact(selected.row.callVolume), color: colors.positive },
            { label: '看跌量', value: compact(selected.row.putVolume), color: colors.negative },
            { label: '差額', value: compact(selected.row.callVolume - selected.row.putVolume), color: colors.text },
          ]).map(item => <View key={item.label} style={styles.chartTooltipMetric}><Text numberOfLines={1} style={[styles.chartTooltipMetricLabel, { color: colors.textMuted }]}>{item.label}</Text><Text numberOfLines={1} style={[styles.chartTooltipMetricValue, { color: item.color }]}>{item.value}</Text></View>)}
        </View>
        <Text numberOfLines={1} style={[styles.chartTooltipFooter, { color: colors.textSub }]}>未平倉量　Call {compact(selected.row.callOpenInterest)}　／　Put {compact(selected.row.putOpenInterest)}</Text>
      </View>}
      <Text style={[styles.longPressHint, { color: colors.textMuted }]}>長按圖表後左右滑動，可逐一查看履約價明細</Text>
      <View style={{ width, height }} onTouchEnd={endScrub} onTouchCancel={endScrub} {...panResponderRef.current.panHandlers}>
        <Svg width={width} height={height}>
        {mode === 'gex' && <>
          <Rect x={left} y={top} width={Math.max(0, zeroGammaX - left)} height={height - top - bottom} fill={colors.negative} opacity="0.055" />
          <Rect x={zeroGammaX} y={top} width={Math.max(0, width - right - zeroGammaX)} height={height - top - bottom} fill={colors.positive} opacity="0.055" />
        </>}
        <Line x1={left} x2={width - right} y1={zeroY} y2={zeroY} stroke={colors.border} strokeWidth="1" />
        <SvgText x={6} y={zeroY - halfHeight + 8} fill={colors.textMuted} fontSize="9">{compact(maximum)}</SvgText>
        <SvgText x={18} y={zeroY + 4} fill={colors.textMuted} fontSize="9">0</SvgText>
        <SvgText x={4} y={zeroY + halfHeight} fill={colors.textMuted} fontSize="9">-{compact(maximum)}</SvgText>
        {mode === 'gex' && <>
          <SvgText x={width - 2} y={zeroY - halfHeight + 8} fill={colors.textMuted} fontSize="9" textAnchor="end">{compact(profileMaximum)}</SvgText>
          <SvgText x={width - 2} y={zeroY + halfHeight} fill={colors.textMuted} fontSize="9" textAnchor="end">-{compact(profileMaximum)}</SvgText>
        </>}
        {rows.map((row, index) => {
          const x = xForPrice(row.strike);
          const value = values[index];
          const positiveHeight = Math.abs(value.positive) / maximum * halfHeight;
          const negativeHeight = Math.abs(value.negative) / maximum * halfHeight;
          const showLabel = index % labelEvery === 0 || index === rows.length - 1;
          return (
            <React.Fragment key={row.strike}>
              <Rect
                x={x - barWidth / 2}
                y={zeroY - positiveHeight}
                width={barWidth}
                height={Math.max(1, positiveHeight)}
                rx="2"
                fill={colors.positive}
                opacity="0.88"
              />
              <Rect
                x={x - barWidth / 2}
                y={zeroY}
                width={barWidth}
                height={Math.max(1, negativeHeight)}
                rx="2"
                fill={colors.negative}
                opacity="0.88"
              />
              {showLabel && <SvgText x={x} y={height - 13} fill={colors.textMuted} fontSize="8" textAnchor="middle">{numberText(row.strike, row.strike >= 100 ? 0 : 1)}</SvgText>}
            </React.Fragment>
          );
        })}
        {mode === 'gex' && <>
          <Path d={profilePath} fill="none" stroke={colors.accent} strokeWidth="2" opacity="0.9" />
          <Line x1={zeroGammaX} x2={zeroGammaX} y1={top} y2={height - bottom} stroke={colors.warning} strokeWidth="1.5" />
          {renderMarkerBadge('zero-gamma', zeroGammaX, zeroGammaBadgeY, `零 Gamma ${numberText(zeroGammaStrike)}`, colors.warning, 82)}
          {callWallBadgeY !== null && renderMarkerBadge('call-wall', xForPrice(callWall), callWallBadgeY, `看漲牆 ${numberText(callWall)}`, colors.positive, 82)}
          {putWallBadgeY !== null && renderMarkerBadge('put-wall', xForPrice(putWall), putWallBadgeY, `看跌牆 ${numberText(putWall)}`, colors.negative, 82)}
        </>}
        {Number.isFinite(Number(spot)) && <>
          <Line x1={xForPrice(spot)} x2={xForPrice(spot)} y1={top} y2={height - bottom} stroke={colors.accent} strokeWidth="1.5" strokeDasharray="5 4" />
          {renderMarkerBadge('spot', xForPrice(spot), 0, `現價 ${numberText(spot)}`, colors.accent, 76)}
        </>}
        {selectedX !== null && <Line x1={selectedX} x2={selectedX} y1={top} y2={height - bottom} stroke={colors.text} strokeWidth="1" strokeDasharray="3 3" opacity="0.75" />}
        </Svg>
      </View>
      <View style={styles.chartLegend}>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.positive }]} /><Text style={[styles.legendText, { color: colors.textSub }]}>{mode === 'gex' ? '看漲 GEX' : '看漲成交量'}</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.negative }]} /><Text style={[styles.legendText, { color: colors.textSub }]}>{mode === 'gex' ? '看跌 GEX' : '看跌成交量'}</Text></View>
        {mode === 'gex' && <><View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: colors.accent }]} /><Text style={[styles.legendText, { color: colors.textSub }]}>{hasScenarioCurve ? '情境總 GEX' : '本履約價淨 GEX'}</Text></View><View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: colors.warning }]} /><Text style={[styles.legendText, { color: colors.textSub }]}>{hasScenarioCurve ? '零 Gamma' : 'GEX 平衡點'}</Text></View></>}
      </View>
    </View>
  );
}

export function OptionsAnalysisContent({
  initialMarket: requestedMarket = 'US',
  initialSymbol: requestedSymbol = '',
  embedded = false,
}) {
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const requestedSymbolIsTaiwan = /^\d{4,6}$/.test(String(requestedSymbol || '').trim());
  const initialMarket = requestedSymbolIsTaiwan || String(requestedMarket || '').toUpperCase() === 'TW' ? 'TW' : 'US';
  const initialSymbol = initialMarket === 'TW'
    ? normalizeTaiwanOptionSymbol(requestedSymbol) || '2330'
    : normalizeOptionSymbol(requestedSymbol) || 'SPY';
  const [market, setMarket] = useState(initialMarket);
  const [draftSymbol, setDraftSymbol] = useState(initialSymbol);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [expirations, setExpirations] = useState([]);
  const [expiration, setExpiration] = useState('');
  const [chain, setChain] = useState(null);
  const [latestQuote, setLatestQuote] = useState(null);
  const [rangeKey, setRangeKey] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showNotice, setShowNotice] = useState(false);
  const [calendarNow, setCalendarNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setCalendarNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const nextMarket = /^\d{4,6}$/.test(String(requestedSymbol || '').trim()) || String(requestedMarket || '').toUpperCase() === 'TW' ? 'TW' : 'US';
    const nextSymbol = nextMarket === 'TW'
      ? normalizeTaiwanOptionSymbol(requestedSymbol) || '2330'
      : normalizeOptionSymbol(requestedSymbol) || 'SPY';
    setMarket(nextMarket);
    setDraftSymbol(nextSymbol);
    setSymbol(nextSymbol);
    setExpirations([]);
    setExpiration('');
    setChain(null);
    setLatestQuote(null);
    setError('');
  }, [requestedMarket, requestedSymbol]);

  const loadLatestSpot = useCallback(async ({ forceRefresh = false } = {}) => {
    // Index option codes such as TXO are not equity quote symbols. Their
    // reference level continues to come from put-call parity in the chain.
    if (market === 'TW' && !/^\d{4,6}$/.test(symbol)) {
      setLatestQuote(null);
      return null;
    }
    try {
      const quote = await fetchLatestMarketQuote(symbol, market, {
        forceRefresh,
        cacheTtl: OPTIONS_SNAPSHOT_TTL,
        // Share the same short-lived quote snapshot as the technical page so
        // embedded and standalone option analysis show the same spot.
        snapshotKey: 'default',
      });
      setLatestQuote(quote);
      return quote;
    } catch {
      setLatestQuote(null);
      return null;
    }
  }, [market, symbol]);

  useEffect(() => { loadLatestSpot(); }, [loadLatestSpot]);
  useEffect(() => {
    const timer = setInterval(() => loadLatestSpot(), OPTIONS_SNAPSHOT_TTL);
    return () => clearInterval(timer);
  }, [loadLatestSpot]);

  const loadChain = useCallback(async (targetSymbol, targetExpiration, options = {}) => {
    const response = await fetchOptionChain(targetSymbol, targetExpiration, { ...options, market });
    setChain(response);
    return response;
  }, [market]);

  const loadSymbol = useCallback(async (targetSymbol, { forceRefresh = false, preferredExpiration = '' } = {}) => {
    setError('');
    try {
      const result = await fetchOptionExpirations(targetSymbol, { forceRefresh, market });
      const dates = result.expirations || [];
      setExpirations(dates);
      const nextExpiration = dates.includes(preferredExpiration) ? preferredExpiration : dates[0] || '';
      setExpiration(nextExpiration);
      if (!nextExpiration) {
        setChain(null);
        throw new Error(`${targetSymbol} 目前沒有可用的選擇權到期日`);
      }
      // The expiration request and the chain request share the provider
      // snapshot cache.  Do not force a second fetch here: two consecutive
      // provider snapshots can have different spot/OI values and produce a
      // chart whose labels and GEX no longer agree.
      await loadChain(targetSymbol, nextExpiration, { forceRefresh: false });
    } catch (loadError) {
      setChain(null);
      setError(loadError?.message || '選擇權資料載入失敗');
    }
  }, [loadChain, market]);

  useEffect(() => {
    setLoading(true);
    loadSymbol(symbol).finally(() => setLoading(false));
  }, [loadSymbol, symbol]);

  const selectExpiration = useCallback(async value => {
    if (!value || value === expiration) return;
    setExpiration(value);
    setLoading(true);
    setError('');
    try {
      await loadChain(symbol, value);
    } catch (loadError) {
      setChain(null);
      setError(loadError?.message || '選擇權資料載入失敗');
    } finally {
      setLoading(false);
    }
  }, [expiration, loadChain, symbol]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([
      loadSymbol(symbol, { forceRefresh: true, preferredExpiration: expiration }),
      loadLatestSpot({ forceRefresh: true }),
    ]);
    setRefreshing(false);
  }, [expiration, loadLatestSpot, loadSymbol, symbol]);

  const submitSymbol = () => {
    Keyboard.dismiss();
    const next = market === 'TW' ? normalizeTaiwanOptionSymbol(draftSymbol) : normalizeOptionSymbol(draftSymbol);
    if (!next) return setError(market === 'TW' ? '請輸入台股代號或 TXO' : '請輸入美股代號');
    setDraftSymbol(next);
    if (next === symbol) refresh();
    else setSymbol(next);
  };

  const selectMarket = nextMarket => {
    if (nextMarket === market) return;
    const nextSymbol = nextMarket === 'TW' ? '2330' : 'SPY';
    setMarket(nextMarket);
    setDraftSymbol(nextSymbol);
    setSymbol(nextSymbol);
    setExpirations([]);
    setExpiration('');
    setChain(null);
    setError('');
  };

  const chainSpot = Number(chain?.spot) > 0 ? Number(chain.spot) : null;
  // The option chain's contracts, OI and Greeks can be delayed. Use the same
  // latest underlying quote as the technical page for the current spot and
  // recalculate GEX with it; keep the chain's provider timestamp visible as a
  // separate data-age indicator.
  const optionsQuote = Number(latestQuote?.price) > 0 ? latestQuote : null;
  const effectiveSpot = Number(optionsQuote?.price) || chainSpot || null;
  const spotSource = optionsQuote?.source || chain?.provider || '選擇權鏈推算';
  const spotTimeValue = optionsQuote?.source_time || optionsQuote?.time || chain?.providerAsOf || chain?.fetchedAt;
  const spotTime = spotTimeValue ? new Date(spotTimeValue).toLocaleString('zh-TW', { hour12: false }) : '—';
  const optionChainTimeValue = chain?.providerAsOf || chain?.fetchedAt;
  const optionChainTime = optionChainTimeValue ? new Date(optionChainTimeValue).toLocaleString('zh-TW', { hour12: false }) : '—';
  const range = RANGE_OPTIONS.find(item => item.key === rangeKey)?.value ?? null;
  const filteredContracts = useMemo(() => filterContractsByRange(chain?.contracts, effectiveSpot, range), [chain?.contracts, effectiveSpot, range]);
  const analytics = useMemo(() => calculateOptionsAnalytics({
    contracts: filteredContracts,
    spot: effectiveSpot,
    asOf: chain?.providerAsOf || chain?.fetchedAt,
  }), [chain?.fetchedAt, chain?.providerAsOf, effectiveSpot, filteredContracts]);
  const totalCallGex = analytics.rows.reduce((sum, row) => sum + Number(row.callGex || 0), 0);
  const totalPutGex = analytics.rows.reduce((sum, row) => sum + Number(row.putGex || 0), 0);
  const chartWidth = Math.max(290, windowWidth - 68);
  const timestamp = chain?.fetchedAt ? new Date(chain.fetchedAt).toLocaleString('zh-TW', { hour12: false }) : '—';
  const currencyPrefix = chain?.currency === 'TWD' ? 'NT$' : '$';

  return (
    <View style={[styles.content, embedded && styles.embeddedContent]}>
      {!embedded && <View style={[styles.marketTabs, { backgroundColor: colors.cardAlt }]}>
        {[{ key: 'US', label: '美股' }, { key: 'TW', label: '台股' }].map(item => (
          <TouchableOpacity key={item.key} onPress={() => selectMarket(item.key)} style={[styles.marketTab, market === item.key && { backgroundColor: colors.accent }]}>
            <Text style={[styles.marketTabText, { color: market === item.key ? colors.accentContrast : colors.textSub }]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>}
      {embedded ? <View style={[styles.embeddedHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.flex}><Text style={[styles.sectionTitle, { color: colors.text }]}>{symbol} 選擇權分析</Text><Text style={[styles.explanation, { color: colors.textSub }]}>自動使用目前技術分析標的 · {market === 'TW' ? '台股期交所商品' : '美股選擇權'}</Text></View>
        <TouchableOpacity accessibilityLabel="更新選擇權資料" onPress={refresh} disabled={refreshing} style={[styles.refreshButton, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>{refreshing ? <ActivityIndicator size="small" color={colors.accent} /> : <RefreshCw size={17} color={colors.textSub} />}</TouchableOpacity>
      </View> : <View style={[styles.searchCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.searchHeader}><View style={styles.flex}><Text style={[styles.sectionTitle, { color: colors.text }]}>{market === 'TW' ? '台股選擇權 Gamma 敞口' : '美股選擇權 Gamma 敞口'}</Text></View><TouchableOpacity accessibilityLabel="更新選擇權資料" onPress={refresh} disabled={refreshing} style={[styles.refreshButton, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>{refreshing ? <ActivityIndicator size="small" color={colors.accent} /> : <RefreshCw size={17} color={colors.textSub} />}</TouchableOpacity></View>
        <Text style={[styles.explanation, { color: colors.textSub }]}>{market === 'TW' ? '輸入台股代號（例如 2330、0050）或 TXO；僅支援期交所實際掛牌商品。' : '輸入美股代號，依到期日查看估算 GEX、Call／Put Wall 與成交量分布。'}</Text>
        <View style={styles.searchRow}>
          <TextInput
            value={draftSymbol}
            onChangeText={setDraftSymbol}
            onSubmitEditing={submitSymbol}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            placeholder={market === 'TW' ? '例如 2330、0050、TXO' : '例如 SPY、AAPL、FICO'}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { color: colors.text, backgroundColor: colors.cardAlt, borderColor: colors.border }]}
          />
          <TouchableOpacity onPress={submitSymbol} style={[styles.searchButton, { backgroundColor: colors.accent }]} accessibilityLabel="搜尋選擇權資料">
            <Search size={20} color={colors.accentContrast} />
          </TouchableOpacity>
        </View>
      </View>}

      {!!expirations.length && <View style={styles.controlSection}>
        <Text style={[styles.controlLabel, { color: colors.textSub }]}>到期日</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {expirations.slice(0, 18).map(date => <TouchableOpacity key={date} onPress={() => selectExpiration(date)} accessibilityLabel={`${date}，${expirationCountdownLabel(date, market, calendarNow)}`} style={[styles.chip, styles.expirationChip, { backgroundColor: expiration === date ? colors.accentSoft : colors.card, borderColor: expiration === date ? colors.accent : colors.border }]}><Text style={[styles.chipText, { color: expiration === date ? colors.accent : colors.textSub }]}>{date}</Text><Text style={[styles.expirationCountdown, { color: expiration === date ? colors.accent : colors.textMuted }]}>{expirationCountdownLabel(date, market, calendarNow)}</Text></TouchableOpacity>)}
        </ScrollView>
        <Text style={[styles.controlLabel, { color: colors.textSub }]}>履約價範圍</Text>
        <View style={styles.chips}>{RANGE_OPTIONS.map(item => <TouchableOpacity key={item.key} onPress={() => setRangeKey(item.key)} style={[styles.chip, { backgroundColor: rangeKey === item.key ? colors.accentSoft : colors.card, borderColor: rangeKey === item.key ? colors.accent : colors.border }]}><Text style={[styles.chipText, { color: rangeKey === item.key ? colors.accent : colors.textSub }]}>{item.label}</Text></TouchableOpacity>)}</View>
      </View>}

      {loading && <View style={styles.loading}><ActivityIndicator size="large" color={colors.accent} /><Text style={{ color: colors.textSub }}>載入選擇權鏈…</Text></View>}

      {!loading && !!error && <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.warning }]}><Text style={[styles.errorTitle, { color: colors.warning }]}>目前無法取得資料</Text><Text style={[styles.explanation, { color: colors.textSub }]}>{error}</Text>{error.includes('TRADIER_ACCESS_TOKEN') && <Text style={[styles.setupText, { color: colors.textMuted }]}>需在 Supabase 設定伺服器端密鑰後部署 options-analysis；不可放在 EXPO_PUBLIC 環境變數。</Text>}</View>}

      {!loading && chain && <>
        <View style={styles.metricsGrid}>
          <Metric label={optionsQuote ? '標的最新價' : chainSpot ? '選擇權鏈基準價' : market === 'TW' ? '推算標的基準' : '選擇權快照價'} value={`${currencyPrefix}${numberText(effectiveSpot)}`} hint={`${spotSource} · ${spotTime}`} colors={colors} />
          <Metric label="目前淨 GEX（每 1%）" value={`${currencyPrefix}${compact(analytics.totalGex)}`} hint={analytics.totalGex >= 0 ? '正 Gamma 環境估算' : '負 Gamma 環境估算'} color={analytics.totalGex >= 0 ? colors.positive : colors.negative} colors={colors} />
          <Metric label="Call Wall" value={numberText(analytics.callWall)} hint="最大正 GEX 履約價" color={colors.positive} colors={colors} />
          <Metric label="Put Wall" value={numberText(analytics.putWall)} hint="最大負 GEX 履約價" color={colors.negative} colors={colors} />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}><View><Text style={[styles.cardTitle, { color: colors.text }]}>Gamma 敞口分布</Text><Text style={[styles.cardSub, { color: colors.textMuted }]}>同一履約價上下對齊：Call 向上／Put 向下</Text></View><View style={styles.expirationHeader}><Text style={[styles.asOf, { color: colors.textMuted }]}>{expiration}</Text><Text style={[styles.asOf, { color: colors.accent }]}>{expirationCountdownLabel(expiration, market, calendarNow)}</Text></View></View>
          <View style={styles.gammaSummary}>
            <View style={[styles.gammaSummaryItem, { backgroundColor: colors.cardAlt }]}><Text style={[styles.gammaSummaryLabel, { color: colors.textMuted }]}>看漲 GEX</Text><Text style={[styles.gammaSummaryValue, { color: colors.positive }]}>{compact(totalCallGex)}</Text></View>
            <View style={[styles.gammaSummaryItem, { backgroundColor: colors.cardAlt }]}><Text style={[styles.gammaSummaryLabel, { color: colors.textMuted }]}>看跌 GEX</Text><Text style={[styles.gammaSummaryValue, { color: colors.negative }]}>{compact(Math.abs(totalPutGex))}</Text></View>
            <View style={[styles.gammaSummaryItem, { backgroundColor: colors.cardAlt }]}><Text style={[styles.gammaSummaryLabel, { color: colors.textMuted }]}>目前淨 GEX</Text><Text style={[styles.gammaSummaryValue, { color: analytics.totalGex >= 0 ? colors.positive : colors.negative }]}>{compact(analytics.totalGex)}</Text></View>
          </View>
          <DistributionChart rows={analytics.rows} mode="gex" spot={effectiveSpot} callWall={analytics.callWall} putWall={analytics.putWall} scenarioGexCurve={analytics.scenarioGexCurve} colors={colors} availableWidth={chartWidth} />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}><View><Text style={[styles.cardTitle, { color: colors.text }]}>選擇權成交量分布</Text><Text style={[styles.cardSub, { color: colors.textMuted }]}>Call {compact(analytics.totalCallVolume)}／Put {compact(analytics.totalPutVolume)} · 同履約價上下對齊</Text></View></View>
          <DistributionChart rows={analytics.rows} mode="volume" spot={effectiveSpot} callWall={null} putWall={null} colors={colors} availableWidth={chartWidth} />
        </View>

        {market === 'US' && <OptionsAICard symbol={symbol} expiration={expiration} spot={effectiveSpot} spotAsOf={spotTimeValue || null} spotSource={spotSource} chain={chain} colors={colors} />}

        <View style={[styles.notice, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
          <TouchableOpacity onPress={() => setShowNotice(value => !value)} accessibilityRole="button" accessibilityLabel={showNotice ? '收合資料與計算說明' : '展開資料與計算說明'} style={styles.noticeToggle}><Text style={[styles.noticeTitle, { color: colors.text }]}>資料與計算說明</Text><Text style={[styles.noticeTitle, { color: colors.accent }]}>{showNotice ? '收合 ↑' : '展開 ↓'}</Text></TouchableOpacity>
          <Text style={[styles.noticeText, { color: colors.textSub }]}>來源：{chain.provider} · {chain.priceDelay} · {chain.greeksDelay} · 更新 {timestamp}</Text>
          {showNotice && <>
            <Text style={[styles.noticeText, { color: colors.textSub }]}>GEX = Gamma × 未平倉量 × 契約乘數 × 現價² × 1%。Call 設為正、Put 設為負是常見的部位模型，不代表造市商真實持倉。</Text>
            <Text style={[styles.noticeText, { color: colors.textSub }]}>目前淨 GEX 是以畫面顯示的標的報價快照計算；藍線則把橫軸視為假設股價，依每份合約的 IV、剩餘期限與未平倉量重新計算整條選擇權鏈的情境總 GEX，橘線是情境總 GEX 穿越零的位置。</Text>
            {market === 'TW' && <Text style={[styles.noticeText, { color: colors.warning }]}>台股為盤後估算：基準價由同履約價買賣權結算價差推回，Gamma 由期交所每日 Delta 曲線估算，不是即時造市商部位。</Text>}
            <Text style={[styles.noticeText, { color: colors.textSub }]}>標的現價：{spotSource} · {spotTime}；圖表、GEX 與情境曲線使用此最新現價重算。</Text>
            <Text style={[styles.noticeText, { color: colors.textSub }]}>選擇權鏈快照：{chain?.provider || '—'} · {optionChainTime}；未平倉量、成交量與 Greeks 依此快照。</Text>
            <Text style={[styles.noticeText, { color: colors.textSub }]}>本次使用 {analytics.usableContracts} 筆含 Gamma 合約；{analytics.missingGammaContracts > 0 ? `${analytics.missingGammaContracts} 筆缺少 Gamma，未納入 GEX。` : '未發現缺少 Gamma 的合約。'}</Text>
          </>}
        </View>
      </>}
    </View>
  );
}

export default function OptionsAnalysisScreen({ route }) {
  const { colors } = useTheme();
  const routeSymbol = route?.params?.symbol || '';
  const routeMarket = route?.params?.market || (/^\d+$/.test(String(routeSymbol)) ? 'TW' : 'US');
  return <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} keyboardShouldPersistTaps="handled"><OptionsAnalysisContent initialMarket={routeMarket} initialSymbol={routeSymbol} /></ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 12, paddingBottom: 88, gap: 10 },
  embeddedContent: { padding: 0, paddingBottom: 0 },
  embeddedHeader: { minHeight: 68, borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex: { flex: 1 },
  marketTabs: { flexDirection: 'row', borderRadius: 14, padding: 4 },
  marketTab: { flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  marketTabText: { fontSize: 14, fontWeight: '900' },
  searchCard: { borderWidth: 1, borderRadius: 15, padding: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '900', marginBottom: 3 },
  searchHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  refreshButton: { width: 38, height: 38, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  explanation: { fontSize: 13, lineHeight: 20 },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 9 },
  input: { flex: 1, height: 42, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, fontSize: 15, fontWeight: '800' },
  searchButton: { width: 44, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  controlSection: { gap: 6 },
  controlLabel: { fontSize: 12, fontWeight: '800', marginTop: 2 },
  chips: { flexDirection: 'row', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  chipText: { fontSize: 12, fontWeight: '800' },
  expirationChip: { alignItems: 'center', gap: 2 },
  expirationCountdown: { fontSize: 10, fontWeight: '700' },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorCard: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 8 },
  errorTitle: { fontSize: 17, fontWeight: '900' },
  setupText: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  metric: { width: '48.8%', minHeight: 86, borderWidth: 1, borderRadius: 13, padding: 10 },
  metricLabel: { fontSize: 11, fontWeight: '800' },
  metricValue: { fontSize: 19, fontWeight: '900', marginTop: 5 },
  metricHint: { fontSize: 10, lineHeight: 13, marginTop: 3 },
  card: { borderWidth: 1, borderRadius: 15, paddingVertical: 10, overflow: 'hidden' },
  cardHeader: { paddingHorizontal: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 },
  cardTitle: { fontSize: 16, fontWeight: '900' },
  cardSub: { fontSize: 10, marginTop: 2 },
  asOf: { fontSize: 10, fontWeight: '700' },
  expirationHeader: { alignItems: 'flex-end', gap: 2 },
  emptyChart: { height: 160, margin: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  longPressHint: { fontSize: 10, paddingHorizontal: 11, paddingTop: 5 },
  chartTooltip: { height: 108, marginHorizontal: 14, marginTop: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, gap: 5, overflow: 'hidden' },
  chartTooltipHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chartTooltipTitle: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '900' },
  chartTooltipCloseButton: { width: 42, minHeight: 22, alignItems: 'flex-end', justifyContent: 'center' },
  chartTooltipClose: { fontSize: 11, fontWeight: '800' },
  chartTooltipMetrics: { height: 39, flexDirection: 'row', gap: 6 },
  chartTooltipMetric: { flex: 1, minWidth: 0, justifyContent: 'center' },
  chartTooltipMetricLabel: { fontSize: 10, fontWeight: '700' },
  chartTooltipMetricValue: { fontSize: 13, lineHeight: 17, fontWeight: '900', marginTop: 1 },
  chartTooltipFooter: { height: 17, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  gammaSummary: { flexDirection: 'row', gap: 6, paddingHorizontal: 11, paddingTop: 5 },
  gammaSummaryItem: { flex: 1, minWidth: 0, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 6 },
  gammaSummaryLabel: { fontSize: 9, fontWeight: '800' },
  gammaSummaryValue: { fontSize: 12, fontWeight: '900', marginTop: 2 },
  chartLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 11, paddingBottom: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLine: { width: 14, height: 2, borderRadius: 1 },
  legendText: { fontSize: 9, fontWeight: '700' },
  notice: { borderWidth: 1, borderRadius: 13, padding: 10, gap: 5 },
  noticeToggle: { minHeight: 30, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  noticeTitle: { fontSize: 13, fontWeight: '900' },
  noticeText: { fontSize: 10, lineHeight: 15 },
});
