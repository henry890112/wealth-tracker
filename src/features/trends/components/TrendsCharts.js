import { useRef, useState } from 'react';
import { Dimensions, PanResponder, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Line as SvgLine, Path, Stop, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../../../lib/ThemeContext';
import { PNL_METRICS, pnlColor, signedPnlAmount } from '../tradePnl';

const { width: screenWidth } = Dimensions.get('window');

// ── Straight Polyline Path ──
function buildSmoothPath(pts) {
  if (pts.length === 0) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
}

// ── Amber Gradient Area Chart with Crosshair Tooltip ──
export function TrendLineChart({ snapshots, currency }) {
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
export function PnlBreakdownChart({ series, currency, metric = 'total', onPointSelect }) {
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
  const onPointSelectRef = useRef(onPointSelect);
  onPointSelectRef.current = onPointSelect;
  const touchedIndexRef = useRef(null);
  const selectIndexAt = x => {
    const count = seriesRef.current.length;
    if (count < 2) return;
    const index = Math.round(Math.max(0, Math.min(1, (x - PAD_H) / plotW)) * (count - 1));
    touchedIndexRef.current = index;
    setTouchIdx(index);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: event => selectIndexAt(event.nativeEvent.locationX),
      onPanResponderMove: event => selectIndexAt(event.nativeEvent.locationX),
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dx) < 8 && Math.abs(gesture.dy) < 8) {
          const point = seriesRef.current[touchedIndexRef.current];
          if (point?.date) onPointSelectRef.current?.(point.date);
        }
        touchedIndexRef.current = null;
        setTouchIdx(null);
      },
      onPanResponderTerminate: () => {
        touchedIndexRef.current = null;
        setTouchIdx(null);
      },
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

export function DonutChart({ data, size = 180, strokeWidth = 28, selectedIndex, onSelect }) {
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
