import React, { useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { detectPriceGapEvents } from '../services/priceGaps.js';

const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
const MA_COLORS = {
  ma5: '#FBBF24',
  ma10: '#C084FC',
  ma20: '#2DD4BF',
  ma40: '#FB923C',
  ma60: '#38BDF8',
};
const BOLL_COLORS = {
  upper: '#F472B6',
  middle: '#E5E7EB',
  lower: '#22D3EE',
};
const RSI_COLORS = {
  short: '#FBBF24',
  long: '#38BDF8',
  base: '#A78BFA',
};
const FLOW_CHART_HEIGHT = 180;
const FLOW_PANE_HEADER_HEIGHT = 84;
const FLOW_PANE_HEIGHT = FLOW_PANE_HEADER_HEIGHT + FLOW_CHART_HEIGHT;
const TECHNICAL_PERIOD_LABELS = {
  '3M': '3 個月',
  '6M': '6 個月',
  '1Y': '1 年',
  '3Y': '3 年',
};

export default function TechnicalAnalysisChart({ analysis, colors, averageCost, layers, selectedStrategy = null, selectedStrategies = [], showCorporateActions = false, corporateActions = null, showFinancialReports = false, financialReports = null, liveQuote = null, atrPosition = null, exitManagement = null, entryScaling = null, marketType = 'TW', institutionalRows = [], periodKey = null, viewportKey = null }) {
  const rowsForViewport = analysis?.rows || [];
  const latestClose = rowsForViewport.at(-1)?.close;
  const hasLatestPrice = Number(liveQuote?.price) > 0 || (latestClose !== null && latestClose !== undefined && Number.isFinite(Number(latestClose)));
  const indicatorLegendRows = 1 + (rowsForViewport.length ? 1 : 0) + Number(Boolean(layers?.boll)) + Number(Boolean(layers?.ma)) + Number(Boolean(layers?.volume)) + Number(Number(averageCost) > 0) + Number(hasLatestPrice);
  const indicatorLegendHeight = indicatorLegendRows * 16 + 18;
  const resolvedViewportKey = String(viewportKey || `${marketType}:${periodKey || ''}:${rowsForViewport[0]?.time || ''}:${rowsForViewport.at(-1)?.time || ''}`);
  const visibleRangeRef = useRef({ key: null, range: null });
  const iframeRef = useRef(null);
  const savedVisibleRange = visibleRangeRef.current.key === resolvedViewportKey ? visibleRangeRef.current.range : null;

  const saveVisibleRange = rawMessage => {
    let message = rawMessage;
    if (typeof message === 'string') {
      try { message = JSON.parse(message); } catch { return; }
    }
    if (message?.source !== 'wealthtracker-technical-chart' || message?.type !== 'visibleLogicalRange' || message.key !== resolvedViewportKey) return;
    const from = Number(message.range?.from);
    const to = Number(message.range?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
    visibleRangeRef.current = { key: resolvedViewportKey, range: { from, to } };
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const handleMessage = event => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      saveVisibleRange(event.data);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [resolvedViewportKey]);

  const html = useMemo(() => {
    const rows = analysis.rows;
    const candles = rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
    const currentPrice = Number(liveQuote?.price || 0);
    const hasLivePrice = currentPrice > 0;
    const latestRow = rows.at(-1) || {};
    const formatIndicatorPrice = value => {
      if (value === null || value === undefined || value === '') return '—';
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      const digits = Math.abs(number) >= 1000 ? 2 : 3;
      return number.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    };
    const formatIndicatorValue = (value, digits = 2) => {
      if (value === null || value === undefined || value === '') return '—';
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      return number.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    };
    const formatIndicatorVolume = value => {
      if (value === null || value === undefined || value === '') return '—';
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      const absolute = Math.abs(number);
      if (absolute >= 1e8) return `${(number / 1e8).toFixed(3)}億`;
      if (absolute >= 1e6) return `${(number / 1e6).toFixed(3)}M`;
      if (absolute >= 1e3) return `${(number / 1e3).toFixed(1)}K`;
      return number.toFixed(0);
    };
    const quoteDate = String(liveQuote?.candleDate || liveQuote?.time || '').slice(0, 10);
    const priorClose = Number(candles.at(-1)?.close || currentPrice);
    const quoteOpen = Number(liveQuote?.open) > 0 ? Number(liveQuote.open) : priorClose;
    const quoteHigh = Number(liveQuote?.high) > 0 ? Math.max(Number(liveQuote.high), quoteOpen, currentPrice) : Math.max(quoteOpen, currentPrice);
    const quoteLow = Number(liveQuote?.low) > 0 ? Math.min(Number(liveQuote.low), quoteOpen, currentPrice) : Math.min(quoteOpen, currentPrice);
    const quoteCandle = liveQuote?.isLive && quoteDate && hasLivePrice
      ? { time: quoteDate, open: quoteOpen, high: quoteHigh, low: quoteLow, close: currentPrice }
      : null;
    const chartCandles = quoteCandle && quoteCandle.time > candles.at(-1)?.time ? [...candles, quoteCandle] : candles;
    const gapZoneData = layers?.gap ? detectPriceGapEvents(chartCandles) : [];
    const latestCandle = chartCandles.at(-1) || latestRow;
    const previousClose = chartCandles.length > 1 ? chartCandles.at(-2)?.close : null;
    const latestChange = Number(latestCandle.close) - Number(previousClose);
    const latestChangePercent = Number(previousClose) ? latestChange / Number(previousClose) * 100 : null;
    const latestChangeColor = Number.isFinite(latestChangePercent) ? (latestChange >= 0 ? colors.positive : colors.negative) : colors.textSub;
    const dailyChangeLabel = (change, changePercent) => Number.isFinite(change) && Number.isFinite(changePercent)
      ? `${change > 0 ? '+' : ''}${formatIndicatorPrice(change)} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%)`
      : '—';
    const indicatorToken = (key, label, value, color, formatter = formatIndicatorPrice) => {
      const formatted = formatter(value);
      return `<span class="indicatorToken"><span class="indicatorName" style="color:${color}">${label}</span><span id="indicator-${key}" class="indicatorValue" data-latest="${formatted}">${formatted}</span></span>`;
    };
    const paneIndicatorToken = (key, label, value, color, digits = 2) => {
      const formatted = formatIndicatorValue(value, digits);
      return `<span class="paneIndicatorToken"><span class="paneIndicatorName" style="color:${color}">${label}</span><span id="pane-indicator-${key}" class="paneIndicatorValue" data-latest="${formatted}">${formatted}</span></span>`;
    };
    const paneFlowToken = (key, label, value, color, formatter) => {
      const formatted = formatter(value);
      return `<span class="paneIndicatorToken"><span id="pane-indicator-${key}-name" class="paneIndicatorName" style="color:${color}">${label}</span><span id="pane-indicator-${key}" class="paneIndicatorValue" data-latest="${formatted}">${formatted}</span></span>`;
    };
    const paneIndicatorDate = (key, initial = '最新') => `<span id="pane-indicator-date-${key}" class="paneIndicatorDate">${initial}</span>`;
    const macdCrossHint = selectedStrategy === 'indicator-macd-cross' ? '<span class="paneIndicatorHint">↑金叉 ↓死叉・僅最新有字</span>' : '';
    const macdPaneLegend = `<div class="paneIndicatorLegend"><span class="paneIndicatorTitle">MACD (12, 26, 9)</span>${paneIndicatorToken('macd-dif', 'DIF', latestRow.macd, colors.accent, 2)}${paneIndicatorToken('macd-signal', 'Signal', latestRow.macdSignal, colors.warning, 2)}${paneIndicatorToken('macd-histogram', '柱', latestRow.macdHistogram, Number(latestRow.macdHistogram) >= 0 ? colors.positive : colors.negative, 2)}${macdCrossHint}${paneIndicatorDate('macd')}</div>`;
    const rsiCrossHint = selectedStrategy === 'rsi' ? '<span class="paneIndicatorHint">↑金叉 ↓死叉・僅最新有字</span>' : '';
    const rsiPaneLegend = `<div class="paneIndicatorLegend"><span class="paneIndicatorTitle">RSI (5, 10, 14)</span>${paneIndicatorToken('rsi5', 'RSI5', latestRow.rsi5, RSI_COLORS.short, 1)}${paneIndicatorToken('rsi10', 'RSI10', latestRow.rsi10, RSI_COLORS.long, 1)}${paneIndicatorToken('rsi14', 'RSI14', latestRow.rsi, RSI_COLORS.base, 1)}${rsiCrossHint}${paneIndicatorDate('rsi')}</div>`;
    const kdCrossHint = selectedStrategy === 'indicator-kd-cross' ? '<span class="paneIndicatorHint">↑金叉 ↓死叉・僅最新有字</span>' : '';
    const kdPaneLegend = `<div class="paneIndicatorLegend"><span class="paneIndicatorTitle">KD (9, 3, 3)</span>${paneIndicatorToken('kd-k', 'K', latestRow.k, colors.accent, 1)}${paneIndicatorToken('kd-d', 'D', latestRow.d, colors.warning, 1)}${kdCrossHint}${paneIndicatorDate('kd')}</div>`;
    const indicatorLegend = [
      `<style>#label{display:none}.indicatorLegend{position:relative;left:auto;right:auto;top:auto;height:auto;min-height:0;max-height:none;margin:0 10px 8px;padding:5px 8px;display:flex;flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:2px;overflow:visible;white-space:nowrap;pointer-events:auto}.indicatorDate{flex:0 0 12px;line-height:12px}.indicatorGroup{width:100%;height:14px;min-height:14px;flex:0 0 14px;flex-wrap:nowrap;align-items:center;overflow-x:auto;overflow-y:hidden;white-space:nowrap;touch-action:pan-x;-webkit-overflow-scrolling:touch;scrollbar-width:none}.indicatorGroup::-webkit-scrollbar{display:none}.indicatorToken{flex:none;white-space:nowrap}.indicatorPane{padding-right:${layers.volumeProfile ? '120px' : '0'}}.indicatorPane .cursorReadout{right:${layers.volumeProfile ? '128px' : '8px'}}.indicatorPane .flowTabs{right:${layers.volumeProfile ? '128px' : '8px'}}</style>`,
      `<span id="indicatorDate" class="indicatorDate">最新</span>`,
      rows.length ? `<span class="indicatorGroup">${indicatorToken('open', '開', latestCandle.open, colors.text)}${indicatorToken('high', '高', latestCandle.high, colors.positive)}${indicatorToken('low', '低', latestCandle.low, colors.negative)}${indicatorToken('selected-close', '收', latestCandle.close, colors.text)}<span class="indicatorToken"><span class="indicatorName" style="color:${latestChangeColor}">漲跌</span><span id="indicator-change" class="indicatorValue" data-latest="${dailyChangeLabel(latestChange, latestChangePercent)}" style="color:${latestChangeColor}">${dailyChangeLabel(latestChange, latestChangePercent)}</span></span></span>` : '',
      layers.boll ? `<span class="indicatorGroup"><span class="indicatorGroupName" style="color:${BOLL_COLORS.middle}">BOLL</span>${indicatorToken('boll-middle', 'MID', latestRow.bollMiddle, BOLL_COLORS.middle)}${indicatorToken('boll-upper', 'UPPER', latestRow.bollUpper, BOLL_COLORS.upper)}${indicatorToken('boll-lower', 'LOWER', latestRow.bollLower, BOLL_COLORS.lower)}</span>` : '',
      layers.ma ? `<span class="indicatorGroup"><span class="indicatorGroupName" style="color:${MA_COLORS.ma5}">MA</span>${indicatorToken('ma5', 'MA5', latestRow.ma5, MA_COLORS.ma5)}${indicatorToken('ma10', 'MA10', latestRow.ma10, MA_COLORS.ma10)}${indicatorToken('ma20', 'MA20', latestRow.ma20, MA_COLORS.ma20)}${indicatorToken('ma40', 'MA40', latestRow.ma40, MA_COLORS.ma40)}${indicatorToken('ma60', 'MA60', latestRow.ma60, MA_COLORS.ma60)}</span>` : '',
      layers.volume ? `<span class="indicatorGroup"><span class="indicatorGroupName" style="color:${colors.textSub}">VOL</span>${indicatorToken('volume', '量', latestRow.volume, colors.textSub, formatIndicatorVolume)}</span>` : '',
      averageCost > 0 ? `<span class="indicatorGroup"><span class="indicatorGroupName" style="color:${colors.accent}">成本</span><span id="indicator-cost" class="indicatorValue" data-latest="${formatIndicatorPrice(averageCost)}">${formatIndicatorPrice(averageCost)}</span></span>` : '',
      (hasLivePrice || (latestRow.close != null && Number.isFinite(Number(latestRow.close)))) ? `<span class="indicatorGroup"><span class="indicatorGroupName" style="color:${colors.text}">${hasLivePrice ? '最新' : '收盤'}</span><span id="indicator-close" class="indicatorValue" data-latest="${formatIndicatorPrice(hasLivePrice ? currentPrice : latestRow.close)}">${formatIndicatorPrice(hasLivePrice ? currentPrice : latestRow.close)}</span></span>` : '',
    ].filter(Boolean).join('');
    // The price pane may include today's provisional quote while CMF/OBV/MFI
    // must remain on completed daily bars. Keep the live date as synchronized
    // blank space, but do not let it become a fake completed money-flow bar.
    const provisionalFlowDate = liveQuote?.isLive && quoteDate ? quoteDate : '';
    const flowRows = provisionalFlowDate
      ? rows.filter(row => String(row.time) < provisionalFlowDate)
      : rows;
    const nearestCandleTime = value => {
      const date = String(value || '').slice(0, 10);
      if (!date || !chartCandles.length || date < chartCandles[0].time || date > chartCandles.at(-1).time) return null;
      return chartCandles.find(row => row.time >= date)?.time || null;
    };
    const corporateActionMarkers = showCorporateActions ? (corporateActions?.events || []).flatMap(event => {
      const time = String(event?.exDate || '');
      if (!time || !chartCandles.some(row => row.time === time)) return [];
      const type = event?.type || 'cash';
      const cashAmount = Number(event?.cashDividend);
      const stockAmount = Number(event?.stockDividend);
      const label = type === 'split'
        ? `拆 ${event?.ratioLabel || '併股'}`
        : type === 'mixed'
          ? `權息 ${Number.isFinite(cashAmount) ? cashAmount.toFixed(2) : '—'}`
          : type === 'stock'
            ? `權 ${Number.isFinite(stockAmount) ? stockAmount.toFixed(4) : '—'}`
            : `息 ${Number.isFinite(cashAmount) ? cashAmount.toFixed(2) : '—'}`;
      return [{
        time,
        position: type === 'cash' ? 'belowBar' : 'aboveBar',
        color: type === 'cash' ? colors.positive : type === 'mixed' ? colors.warning : colors.accent,
        shape: 'circle',
        text: label,
      }];
    }) : [];
    const financialReportMarkers = showFinancialReports ? (() => {
      // A filing can be matched to more than one period (especially when
      // SEC/Yahoo dates are merged). Keep one marker per trading day and use
      // the newest period so the chart never shows duplicate report labels.
      const markersByTime = new Map();
      (financialReports?.quarters || []).forEach(quarter => {
        const reportDate = quarter?.announcementDate || quarter?.filedAt;
        const time = nearestCandleTime(reportDate);
        if (!time) return;
        const candidate = {
          time,
          periodEnd: String(quarter?.periodEnd || quarter?.label || ''),
          position: 'aboveBar',
          color: colors.accent,
          shape: 'circle',
          text: `${quarter?.announcementDate ? '財報公布' : '財報申報'} ${quarter?.label || ''}`.trim(),
        };
        const current = markersByTime.get(time);
        if (!current || candidate.periodEnd > current.periodEnd) markersByTime.set(time, candidate);
      });
      return [...markersByTime.values()].map(({ periodEnd, ...marker }) => marker);
    })() : [];
    const timelineAnchorData = chartCandles.map(row => ({ time: row.time, value: 0 }));
    const volumes = rows.map(row => ({ time: row.time, value: row.volume, color: row.close >= row.open ? `${colors.positive}99` : `${colors.negative}99` }));
    const ma5 = rows.filter(row => row.ma5 != null).map(row => ({ time: row.time, value: row.ma5 }));
    const ma10 = rows.filter(row => row.ma10 != null).map(row => ({ time: row.time, value: row.ma10 }));
    const ma20 = rows.filter(row => row.ma20 != null).map(row => ({ time: row.time, value: row.ma20 }));
    const ma40 = rows.filter(row => row.ma40 != null).map(row => ({ time: row.time, value: row.ma40 }));
    const ma60 = rows.filter(row => row.ma60 != null).map(row => ({ time: row.time, value: row.ma60 }));
    const bollUpper = rows.filter(row => row.bollUpper != null).map(row => ({ time: row.time, value: row.bollUpper }));
    const bollMiddle = rows.filter(row => row.bollMiddle != null).map(row => ({ time: row.time, value: row.bollMiddle }));
    const bollLower = rows.filter(row => row.bollLower != null).map(row => ({ time: row.time, value: row.bollLower }));
    const sharedIndicatorSeries = (key, options = {}) => rows.map(row => {
      const value = Number(row[key]);
      // Lightweight Charts requires every line/histogram point to have a
      // finite value.  KD intentionally has nulls during its warm-up period;
      // passing `{ time }` without a value aborts the rest of the iframe
      // script, which also prevents the panes from being range-synchronised.
      if (!Number.isFinite(value)) return null;
      return {
        time: row.time,
        value,
        ...(options.color ? { color: options.color(value, row) } : {}),
      };
    }).filter(Boolean);
    const macd = sharedIndicatorSeries('macd');
    const signal = sharedIndicatorSeries('macdSignal');
    const histogram = sharedIndicatorSeries('macdHistogram', { color: value => value >= 0 ? `${colors.positive}B8` : `${colors.negative}B8` });
    const rsi = sharedIndicatorSeries('rsi');
    const rsi5 = sharedIndicatorSeries('rsi5');
    const rsi10 = sharedIndicatorSeries('rsi10');
    const kValues = sharedIndicatorSeries('k');
    const dValues = sharedIndicatorSeries('d');
    const mfiValues = rows.map((_, index) => {
      const start = Math.max(1, index - 14 + 1);
      let positive = 0;
      let negative = 0;
      for (let cursor = start; cursor <= index; cursor += 1) {
        const current = rows[cursor];
        const previous = rows[cursor - 1];
        if (!current || !previous) continue;
        const typical = (Number(current.high) + Number(current.low) + Number(current.close)) / 3;
        const previousTypical = (Number(previous.high) + Number(previous.low) + Number(previous.close)) / 3;
        const flow = typical * Number(current.volume || 0);
        if (![typical, previousTypical, flow].every(Number.isFinite)) continue;
        if (typical >= previousTypical) positive += flow;
        else negative += flow;
      }
      if (!negative) return positive ? 100 : 50;
      return 100 - (100 / (1 + positive / negative));
    });
    const cursorRows = rows.map((row, index) => ({
      time: row.time,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      ma5: row.ma5,
      ma10: row.ma10,
      ma20: row.ma20,
      ma40: row.ma40,
      ma60: row.ma60,
      bollUpper: row.bollUpper,
      bollMiddle: row.bollMiddle,
      bollLower: row.bollLower,
      macd: row.macd,
      macdSignal: row.macdSignal,
      macdHistogram: row.macdHistogram,
      rsi: row.rsi,
      rsi5: row.rsi5,
      rsi10: row.rsi10,
      k: row.k,
      d: row.d,
      cmf: row.cmf,
      obv: row.obv,
      mfi: mfiValues[index],
    }));
    const profileRows = layers.volumeProfile
      ? rows.map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume }))
      : [];
    const isTaiwanMarket = String(marketType || '').toUpperCase() === 'TW';
    // Keep OBV, MFI and CMF on separate scales. The detail strategy controls
    // which one is shown first; the user can still switch tabs afterwards.
    const flowModeForStrategy = key => ({
      'volume-obv-divergence': 'obv',
      'volume-mfi-divergence': 'mfi',
      'volume-cmf-divergence': 'cmf',
      'volume-mfi-cmf': 'mfi',
    })[key] || null;
    const selectedFlowMode = flowModeForStrategy(selectedStrategy)
      || selectedStrategies.slice().reverse().map(flowModeForStrategy).find(Boolean)
      || (isTaiwanMarket ? 'foreign' : 'obv');
    const institutionalByDate = new Map(institutionalRows.map(row => [String(row.time), row]));
    const institutionalFlow = layers.flow && isTaiwanMarket
      ? flowRows.map(row => {
        const source = institutionalByDate.get(String(row.time));
        if (!source) return { time: row.time, available: false, foreign: 0, trust: 0, dealer: 0, directional: 0, all: 0 };
        const foreign = Number(source.foreign || 0);
        const trust = Number(source.trust || 0);
        const dealer = Number(source.dealer ?? (Number(source.dealerSelf || 0) + Number(source.dealerHedging || 0)));
        return { time: row.time, available: true, foreign, trust, dealer, directional: foreign + trust, all: foreign + trust + dealer };
      })
      : [];
    const cmfFlow = layers.flow
      ? flowRows.filter(row => Number.isFinite(row.cmf)).map(row => ({ time: row.time, value: row.cmf, color: row.cmf >= 0 ? `${colors.positive}C8` : `${colors.negative}C8` }))
      : [];
    const obvFlow = layers.flow
      ? flowRows.filter(row => Number.isFinite(row.obv)).map(row => ({ time: row.time, value: row.obv }))
      : [];
    const mfiFlow = layers.flow
      ? mfiValues.map((value, index) => Number.isFinite(Number(value)) && (!provisionalFlowDate || String(rows[index].time) < provisionalFlowDate) ? ({ time: rows[index].time, value }) : null).filter(Boolean)
      : [];
    const flowClose = layers.flow
      ? flowRows.map(row => ({ time: row.time, value: row.close }))
      : [];
    const flowCursorRows = cursorRows.filter(row => !provisionalFlowDate || String(row.time) < provisionalFlowDate);
    const flowTitles = {
      obv: 'OBV 累積量價趨勢',
      mfi: 'MFI 資金流量指標',
      cmf: 'CMF20 資金流',
    };
    const flowTitle = flowTitles[selectedFlowMode] || '法人每日淨買賣・收盤價';
    const latestInstitutionalFlow = institutionalFlow.slice().reverse().find(row => row.available) || {};
    const latestFlowClose = flowClose.at(-1)?.value ?? latestRow.close;
    const latestCmf = cmfFlow.at(-1)?.value ?? latestRow.cmf;
    const latestObv = obvFlow.at(-1)?.value ?? latestRow.obv;
    const latestMfi = mfiFlow.at(-1)?.value ?? 50;
    const flowPaneLegend = `<div class="paneIndicatorLegend"><span id="pane-indicator-flow-title" class="paneIndicatorTitle">${flowTitle}</span>${isTaiwanMarket ? `<span id="flow-institutional-tokens" style="display:${flowTitles[selectedFlowMode] ? 'none' : ''}">${paneFlowToken('flow-institutional', '外資', latestInstitutionalFlow.foreign, colors.accent, formatIndicatorVolume)}${paneFlowToken('flow-institutional-close', '收盤', latestFlowClose, colors.textSub, value => formatIndicatorValue(value, 2))}</span>` : ''}<span id="flow-obv-tokens" style="display:${selectedFlowMode === 'obv' ? '' : 'none'}">${paneFlowToken('flow-obv', 'OBV', latestObv, colors.accent, formatIndicatorVolume)}${paneFlowToken('flow-obv-close', '股價', latestFlowClose, colors.textSub, value => formatIndicatorValue(value, 2))}</span><span id="flow-mfi-tokens" style="display:${selectedFlowMode === 'mfi' ? '' : 'none'}">${paneFlowToken('flow-mfi', 'MFI', latestMfi, colors.warning, value => formatIndicatorValue(value, 1))}${paneFlowToken('flow-mfi-close', '股價', latestFlowClose, colors.textSub, value => formatIndicatorValue(value, 2))}</span><span id="flow-cmf-tokens" style="display:${selectedFlowMode === 'cmf' ? '' : 'none'}">${paneFlowToken('flow-cmf', 'CMF20', latestCmf, Number(latestCmf) >= 0 ? colors.positive : colors.negative, value => formatIndicatorValue(value, 2))}${paneFlowToken('flow-cmf-close', '股價', latestFlowClose, colors.textSub, value => formatIndicatorValue(value, 2))}</span>${paneIndicatorDate('flow', flowRows.at(-1)?.time ? String(flowRows.at(-1).time).replaceAll('-', '/') : '最新')}</div>`;
    // Top-level selection controls the summary; the detail selection controls
    // the single strategy rendered on the chart so markers never mix.
    const activeStrategyKey = selectedStrategy || selectedStrategies.at(-1) || null;
    const activeStrategyKeys = activeStrategyKey ? [activeStrategyKey] : [];
    const showStrategy = key => activeStrategyKeys.includes(key);
    const strategies = analysis.strategies || [];
    const strategyByKey = key => strategies.find(item => item.key === key);
    const macdDivergences = analysis.divergences || [];
    const rsiDivergences = analysis.rsiDivergences || [];
    const kdDivergences = analysis.kdDivergences || [];
    const activeDivergenceFor = items => items.filter(item => item.status === 'confirmed' || item.status === 'pending').at(-1);
    const activeDivergence = showStrategy('divergence') ? activeDivergenceFor(macdDivergences) : null;
    const selectedDivergence = selectedStrategy === 'rsiDivergence'
      ? activeDivergenceFor(rsiDivergences)
      : selectedStrategy === 'kdDivergence'
        ? activeDivergenceFor(kdDivergences)
        : activeDivergence;
    const divergencePairsFor = (items, enabled, fallbackKey) => {
      const latest = activeDivergenceFor(items);
      return enabled && latest ? [latest].map(item => ({
        type: item.type,
        previousTime: item.previousTime,
        previousPrice: item.previousPrice,
        previousOscillator: item.previousOscillator ?? item.previousMacd,
        time: item.time,
        price: item.price,
        oscillator: item.oscillator ?? item[fallbackKey],
      })).filter(item => Number.isFinite(Number(item.previousOscillator)) && Number.isFinite(Number(item.oscillator))) : [];
    };
    const divergencePairs = divergencePairsFor(macdDivergences, showStrategy('divergence'), 'macd');
    const rsiDivergencePairs = divergencePairsFor(rsiDivergences, showStrategy('rsiDivergence'), 'rsi');
    const kdDivergencePairs = divergencePairsFor(kdDivergences, showStrategy('kdDivergence'), 'k');
    const divergenceMarkerText = (label, type, phase) => {
      const direction = type === 'bullish' ? '多' : '空';
      if (phase === 'point') return '';
      if (phase === 'divergence') return `${label}${direction}背離`;
      if (phase === 'confirmation') return `${label}確認`;
      return `${label}失效`;
    };
    const divergenceMarkerPosition = (type, phase, pane = false) => {
      const bullish = type === 'bullish';
      // The formation marker sits outside the pivot, while confirmation and
      // invalidation use the opposite side so the two labels do not stack.
      if (pane) {
        return phase === 'divergence' || phase === 'point'
          ? bullish ? 'aboveBar' : 'belowBar'
          : bullish ? 'belowBar' : 'aboveBar';
      }
      return phase === 'divergence' || phase === 'point'
        ? bullish ? 'belowBar' : 'aboveBar'
        : bullish ? 'aboveBar' : 'belowBar';
    };
    const divergenceMarkersFor = (items, enabled, label) => {
      const latest = activeDivergenceFor(items);
      return enabled && latest ? [latest].flatMap(item => {
        const bullish = item.type === 'bullish';
        const result = [
          { time: item.previousTime, position: divergenceMarkerPosition(item.type, 'point'), color: bullish ? colors.positive : colors.negative, shape: 'circle', text: divergenceMarkerText(label, item.type, 'point') },
          { time: item.time, position: divergenceMarkerPosition(item.type, 'divergence'), color: bullish ? colors.positive : colors.negative, shape: bullish ? 'arrowUp' : 'arrowDown', text: divergenceMarkerText(label, item.type, 'divergence') },
        ];
        if (item.confirmationTime) result.push({ time: item.confirmationTime, position: divergenceMarkerPosition(item.type, 'confirmation'), color: bullish ? colors.positive : colors.negative, shape: bullish ? 'arrowUp' : 'arrowDown', text: divergenceMarkerText(label, item.type, 'confirmation') });
        if (item.invalidationTime) result.push({ time: item.invalidationTime, position: divergenceMarkerPosition(item.type, 'invalidation'), color: colors.textMuted, shape: 'circle', text: divergenceMarkerText(label, item.type, 'invalidation') });
        return result;
      }) : [];
    };
    const divergenceMarkers = divergenceMarkersFor(macdDivergences, showStrategy('divergence'), 'MACD');
    const rsiDivergenceMarkers = divergenceMarkersFor(rsiDivergences, showStrategy('rsiDivergence'), 'RSI');
    const kdDivergenceMarkers = divergenceMarkersFor(kdDivergences, showStrategy('kdDivergence'), 'KD');
    const crossMarkersFor = (fastKey, slowKey, labels = { bullish: '黃金交叉', bearish: '死亡交叉' }, qualifies = () => true) => rows.slice(1).flatMap((row, index) => {
      const previous = rows[index];
      const previousFast = Number(previous?.[fastKey]);
      const previousSlow = Number(previous?.[slowKey]);
      const currentFast = Number(row?.[fastKey]);
      const currentSlow = Number(row?.[slowKey]);
      if (![previousFast, previousSlow, currentFast, currentSlow].every(Number.isFinite)) return [];
      const bullish = previousFast <= previousSlow && currentFast > currentSlow;
      const bearish = previousFast >= previousSlow && currentFast < currentSlow;
      if ((!bullish && !bearish) || !qualifies(row, { bullish, bearish })) return [];
      return [{
        time: row.time,
        position: bearish ? 'aboveBar' : 'belowBar',
        color: bearish ? colors.negative : colors.positive,
        shape: bearish ? 'arrowDown' : 'arrowUp',
        text: bullish ? labels.bullish : labels.bearish,
      }];
    });
    const macdCrossMarkers = showStrategy('indicator-macd-cross') ? crossMarkersFor('macd', 'macdSignal') : [];
    const maCrossMarkers = showStrategy('trend-ma-cross') ? crossMarkersFor('ema20', 'ema50') : [];
    const kdCrossMarkers = showStrategy('indicator-kd-cross') ? crossMarkersFor('k', 'd', { bullish: 'KD金叉', bearish: 'KD死叉' }, (row, cross) => (
      cross.bullish ? Number(row.k) <= 35 || Number(row.d) <= 35 : Number(row.k) >= 65 || Number(row.d) >= 65
    )) : [];
    // Keep RSI crossover markers consistent with the strategy condition:
    // bullish crosses must occur at RSI <= 40 and bearish crosses at RSI >= 60.
    const rsiCrossMarkers = showStrategy('rsi') ? crossMarkersFor('rsi5', 'rsi10', { bullish: '黃金交叉', bearish: '死亡交叉' }, (row, cross) => (
      cross.bullish ? Number(row.rsi5) <= 40 || Number(row.rsi10) <= 40 : Number(row.rsi5) >= 60 || Number(row.rsi10) >= 60
    )) : [];
    // Keep the arrow tip pointing at the actual DIF/Signal (or K/D) crossing:
    // an up arrow belongs below the series and a down arrow belongs above it.
    // Use short labels in the compact oscillator panes; the selected strategy
    // title already provides the full meaning of the signal.
    const readableOscillatorMarker = marker => ({
      ...marker,
      position: marker.shape === 'arrowUp' ? 'belowBar' : marker.shape === 'arrowDown' ? 'aboveBar' : marker.position,
      text: marker.text === '黃金交叉' || marker.text === 'KD金叉' ? '金叉'
        : marker.text === '死亡交叉' || marker.text === 'KD死叉' ? '死叉'
          : marker.text,
    });
    const fadedMarkerColor = color => /^#[0-9a-f]{6}$/i.test(String(color || ''))
      ? `${color}66`
      : color;
    const latestLabeledOscillatorCrossMarkers = items => {
      const result = items
        .filter(item => item?.time)
        .sort((a, b) => String(a.time).localeCompare(String(b.time)))
        .map(marker => ({ ...marker }));
      const latestIndex = result.length - 1;
      result.forEach((marker, index) => {
        const originalText = marker.text;
        if (index === latestIndex) {
          marker.text = originalText ? `最新${originalText}` : '最新交叉';
          return;
        }
        // Historical arrows remain visible for context, but only the latest
        // crossover gets a label so an empty label never implies a different
        // signal strength or confirmation state.
        marker.text = '';
        marker.color = fadedMarkerColor(marker.color);
      });
      return result;
    };
    const readableMacdCrossMarkers = latestLabeledOscillatorCrossMarkers(macdCrossMarkers.map(readableOscillatorMarker));
    const readableRsiCrossMarkers = latestLabeledOscillatorCrossMarkers(rsiCrossMarkers.map(readableOscillatorMarker));
    const readableKdCrossMarkers = latestLabeledOscillatorCrossMarkers(kdCrossMarkers.map(readableOscillatorMarker));
    const divergencePaneMarkersFor = (items, enabled, label) => enabled ? items.flatMap(item => {
      const bullish = item.type === 'bullish';
      const color = bullish ? colors.positive : colors.negative;
      const result = [
        // Keep the first pivot as a marker, but leave its text empty. The
        // divergence line and the second pivot identify the pair without
        // creating a second label at the same height.
        { time: item.previousTime, position: divergenceMarkerPosition(item.type, 'point', true), color, shape: 'circle', text: divergenceMarkerText(label, item.type, 'point') },
        { time: item.time, position: divergenceMarkerPosition(item.type, 'divergence', true), color, shape: bullish ? 'arrowUp' : 'arrowDown', text: divergenceMarkerText(label, item.type, 'divergence') },
      ];
      if (item.confirmationTime) result.push({ time: item.confirmationTime, position: divergenceMarkerPosition(item.type, 'confirmation', true), color, shape: bullish ? 'arrowUp' : 'arrowDown', text: divergenceMarkerText(label, item.type, 'confirmation') });
      if (item.invalidationTime) result.push({ time: item.invalidationTime, position: divergenceMarkerPosition(item.type, 'invalidation', true), color: colors.textMuted, shape: 'circle', text: divergenceMarkerText(label, item.type, 'invalidation') });
      return result;
    }) : [];
    const sortMarkers = items => items.filter(item => item?.time).sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const markerTextPriority = text => {
      const value = String(text || '');
      if (value.includes('失效')) return 4;
      if (value.includes('確認')) return 3;
      if (value.includes('背離')) return 2;
      return value ? 1 : 0;
    };
    const compactMarkers = (items, gapDivisor = 14, preserveDirectionalLabels = false) => {
      const indexByTime = new Map(rows.map((row, index) => [String(row.time), index]));
      const minimumGap = Math.max(4, Math.ceil(rows.length / gapDivisor));
      const result = sortMarkers(items).map(marker => ({ ...marker }));
      const lastLabelByPosition = new Map();
      result.forEach(marker => {
        if (!marker.text) return;
        const index = indexByTime.get(String(marker.time));
        if (!Number.isFinite(index)) return;
        const position = marker.position || 'aboveBar';
        const priority = markerTextPriority(marker.text);
        const previous = lastLabelByPosition.get(position);
        if (previous && index - previous.index < minimumGap) {
          // When two equally important labels are too close, prefer the
          // later signal because it is the one the user is most likely
          // checking now. The earlier marker and its line remain visible.
          if (priority >= previous.priority) {
            if (!preserveDirectionalLabels || !['arrowUp', 'arrowDown'].includes(previous.marker.shape)) previous.marker.text = '';
            lastLabelByPosition.set(position, { marker, index, priority });
          } else {
            if (!preserveDirectionalLabels || !['arrowUp', 'arrowDown'].includes(marker.shape)) marker.text = '';
          }
          return;
        }
        lastLabelByPosition.set(position, { marker, index, priority });
      });
      return result;
    };
    const macdDivergencePaneMarkers = divergencePaneMarkersFor(macdDivergences, showStrategy('divergence'), 'MACD');
    const rsiDivergencePaneMarkers = compactMarkers(divergencePaneMarkersFor(rsiDivergences, showStrategy('rsiDivergence'), 'RSI'));
    const kdDivergencePaneMarkers = divergencePaneMarkersFor(kdDivergences, showStrategy('kdDivergence'), 'KD');
    const macdPaneMarkers = compactMarkers([...readableMacdCrossMarkers, ...macdDivergencePaneMarkers]);
    const rsiPaneMarkers = compactMarkers(readableRsiCrossMarkers);
    const kdPaneMarkers = compactMarkers([...readableKdCrossMarkers, ...kdDivergencePaneMarkers]);
    const markerForEvent = (event, fallback) => {
      const contractionMarker = event.strategyKey === 'pattern-triangle-flag' || event.strategyKey === 'pattern-wedge';
      const contractionText = event.status === 'confirmed'
        ? event.type === 'bearish' ? '收斂跌破' : '收斂突破'
        : '收斂觀察';
      return {
        time: event.confirmationTime || event.time,
        // The long native marker text used to sit below the latest candle and
        // collide with the strategy price-line labels. Put contraction labels
        // above the candle and keep them short; the detail card still carries
        // the full explanation and calculated levels.
        position: contractionMarker ? 'aboveBar' : event.type === 'bearish' ? 'aboveBar' : 'belowBar',
        color: event.status === 'invalidated' || event.status === 'expired' || event.status === 'stale'
          ? colors.textMuted : event.type === 'bearish' ? colors.negative : event.status === 'confirmed' ? colors.positive : colors.warning,
        shape: event.type === 'bearish' ? 'arrowDown' : 'arrowUp',
        text: contractionMarker ? contractionText : event.text || fallback,
      };
    };
    const withInvalidation = (events, fallback) => events.flatMap(item => {
      const result = [markerForEvent(item, fallback)];
      if (item.invalidationTime) result.push({ time: item.invalidationTime, position: item.type === 'bearish' ? 'belowBar' : 'aboveBar', color: colors.textMuted, shape: 'circle', text: item.text || '訊號失效' });
      return result;
    });
    const pullbackMarkers = showStrategy('pullback') ? withInvalidation((strategyByKey('pullback')?.events || []).slice(-5), '趨勢回檔') : [];
    const breakoutMarkers = showStrategy('breakout') ? withInvalidation((strategyByKey('breakout')?.events || []).slice(-5), '放量突破') : [];
    const boundaryMarkers = showStrategy('boundary') ? (strategyByKey('boundary')?.events || []).slice(-2).flatMap(item => {
      const result = [markerForEvent({ ...item, confirmationTime: null }, item.subStrategy === 'sweep' ? '下邊界反轉' : '上邊界突破')];
      if (item.confirmationTime && item.confirmationTime !== item.time) result.push({ ...markerForEvent({ ...item, time: item.confirmationTime }, '回踩確認'), time: item.confirmationTime, text: '回踩確認' });
      if (item.invalidationTime) result.push({ time: item.invalidationTime, position: 'belowBar', color: colors.textMuted, shape: 'circle', text: '邊界訊號失效' });
      return result;
    }) : [];
    const smcStrategy = strategyByKey('smc');
    const smcVisibleEvents = smcStrategy?.signal
      ? [smcStrategy.signal]
      : smcStrategy?.latestEvent
        ? [smcStrategy.latestEvent]
        : (smcStrategy?.events || []).slice(-1);
    const smcMarkers = showStrategy('smc') ? smcVisibleEvents.flatMap(item => {
      const label = item.scenario === 'sweep' ? `${item.type === 'bullish' ? 'SSL' : 'BSL'} Sweep` : `${item.type === 'bullish' ? '多' : '空'}方 CHoCH`;
      const result = [markerForEvent({ ...item, confirmationTime: null, text: label }, label)];
      if (item.confirmationTime) result.push({ ...markerForEvent(item, `${item.zoneType || '區域'} 回踩`), time: item.confirmationTime, text: `${item.zoneType || '區域'} 回踩確認` });
      if (item.invalidationTime) result.push({ time: item.invalidationTime, position: item.type === 'bearish' ? 'belowBar' : 'aboveBar', color: colors.textMuted, shape: 'circle', text: 'SMC 訊號失效' });
      return result;
    }) : [];
    const candlestickMarkers = showStrategy('candlestick')
      ? (strategyByKey('candlestick')?.events || [])
        .filter(item => item.windowSize === 1)
        .map(item => ({
        time: item.time,
        position: item.type === 'bearish' ? 'aboveBar' : 'belowBar',
        color: item.type === 'bearish' ? colors.negative : colors.positive,
        shape: item.type === 'bearish' ? 'arrowDown' : 'arrowUp',
        text: item.patternLabel || item.text || 'K 線型態',
      }))
      : [];
    const candlestickBoxData = showStrategy('candlestick')
      ? (strategyByKey('candlestick')?.events || [])
        .filter(item => item.windowSize >= 2 && item.windowStartTime && item.windowEndTime)
        .map(item => ({
          startTime: item.windowStartTime,
          endTime: item.windowEndTime,
          high: Number(item.windowHigh),
          low: Number(item.windowLow),
          patternLabel: item.patternLabel || 'K 線型態',
          type: item.type,
        }))
      : [];
    const activeAtrPosition = atrPosition && ['active', 'risk', 'recovered'].includes(atrPosition.status) ? atrPosition : null;
    const requestedHybridMarkerTime = activeAtrPosition?.entry_date || null;
    const hybridMarkerTime = candles.some(item => item.time === requestedHybridMarkerTime) ? requestedHybridMarkerTime : null;
    const hybridMarker = selectedStrategy === 'ALL' && hybridMarkerTime && activeAtrPosition
      ? [{ time: hybridMarkerTime, position: 'belowBar', color: colors.positive, shape: 'arrowUp', text: '混合策略進場' }]
      : [];
    const estimatedAtrStop = Number(analysis.hybrid?.risk?.initialStop || 0);
    const atrOverlay = layers.atr && (selectedStrategy === 'ALL' || selectedStrategy === 'riskManagement' || selectedStrategy === 'entryScaling') ? selectedStrategy === 'riskManagement' ? {
      entry: Number(exitManagement?.entry || 0),
      initial: Number(exitManagement?.initialStop || 0),
      trailing: Number(exitManagement?.trailingStop || 0),
      effective: Number(exitManagement?.effectiveStop || 0),
      target1: Number(exitManagement?.target1 || 0),
      target2: Number(exitManagement?.target2 || 0),
      atr14: Number(exitManagement?.atr14 || 0),
      multiplier: Number(exitManagement?.atrMultiplier || 0),
    } : selectedStrategy === 'entryScaling' ? {
      entry: Number(entryScaling?.entry || 0),
      initial: Number(entryScaling?.initialStop || 0),
      effective: Number(entryScaling?.activeStop || 0),
      target1: Number(entryScaling?.oneR || 0),
      target2: Number(entryScaling?.twoR || 0),
      atr14: Number(entryScaling?.atr14 || 0),
      multiplier: Number(entryScaling?.atrMultiplier || 0),
    } : {
      entry: Number(activeAtrPosition?.entry_price || (analysis.hybrid?.status === 'confirmed' ? analysis.hybrid?.risk?.entryPrice : 0)),
      initial: Number(activeAtrPosition?.initial_stop || (analysis.hybrid?.status === 'confirmed' ? analysis.hybrid?.risk?.initialStop : 0)),
      trailing: Number(activeAtrPosition?.trailing_stop || 0),
      effective: Number(activeAtrPosition?.effective_stop || 0),
      estimated: !activeAtrPosition && analysis.hybrid?.status !== 'confirmed' ? estimatedAtrStop : 0,
      atr14: Number(activeAtrPosition?.entry_atr || analysis.hybrid?.risk?.atr14 || 0),
      multiplier: 2,
    } : null;
    const selected = selectedStrategy === 'ALL' || selectedStrategy === 'riskManagement' || selectedStrategy === 'entryScaling' ? null : strategyByKey(selectedStrategy);
    const requiresCurrentSignal = selectedStrategy === 'boundary' || selectedStrategy === 'smc';
    const selectedEvent = requiresCurrentSignal
      ? selected?.signal
      : selected?.signal || selected?.events?.filter(item => item.status === 'confirmed' || item.status === 'watch').at(-1) || selected?.events?.at(-1) || selected;
    const boundaryLevels = showStrategy('boundary') ? strategyByKey('boundary')?.levels : null;
    const smcLevels = showStrategy('smc') ? strategyByKey('smc')?.levels : null;
    const selectedOverlay = selected?.overlay || { priceLines: [], series: [] };
    const isMarketStructure = selectedStrategy === 'trend-market-structure';
    const structureNames = { HH: '高點墊高', LH: '高點降低', HL: '低點墊高', LL: '低點降低', EH: '高點持平', EL: '低點持平' };
    const structureComparisons = isMarketStructure && selectedEvent?.highState ? [
      { label: '高點', state: selectedEvent.highState, first: selectedEvent.previousHigh, last: selectedEvent.latestHigh, firstTime: selectedEvent.previousHighTime, lastTime: selectedEvent.latestHighTime },
      { label: '低點', state: selectedEvent.lowState, first: selectedEvent.previousLow, last: selectedEvent.latestLow, firstTime: selectedEvent.previousLowTime, lastTime: selectedEvent.latestLowTime },
    ] : [];
    const structureCandidateText = selectedEvent?.candidatePivotTime
      ? `灰色虛線為候選${selectedEvent.candidatePivotKind === 'high' ? '高點' : '低點'} ${Number(selectedEvent.candidatePivotValue).toFixed(2)}（${String(selectedEvent.candidatePivotTime).slice(5)}），尚待右側 ${Number(selectedEvent.candidateBarsRemaining || 0)} 根 K 棒`
      : '目前沒有新的候選轉折';
    const structureSummary = isMarketStructure ? `<div style="height:176px;padding:10px 12px;border-top:1px solid ${colors.border};font-size:12px;line-height:20px;overflow:auto">
      <strong>${!structureComparisons.length ? '交錯轉折資料不足，等待確認' : selectedEvent?.structureBroken ? '原結構已突破／跌破，重新觀察' : selected?.status === 'confirmed' ? '時間交錯結構成立' : '高低點結構觀察中'}</strong>
      ${structureComparisons.map(item => `<div><b>${structureNames[item.state]}（${item.state}）</b><br/>${Number(item.first).toFixed(2)} → ${Number(item.last).toFixed(2)} <span style="color:${colors.textMuted};font-size:10px">${String(item.firstTime).slice(5)} → ${String(item.lastTime).slice(5)}</span></div>`).join('')}
      <div style="color:${colors.textMuted};font-size:10px">實線依時間連接已確認轉折；${structureCandidateText}。</div></div>` : '';
    const moneyFlowDivergenceMode = ({
      'volume-obv-divergence': 'obv',
      'volume-mfi-divergence': 'mfi',
      'volume-cmf-divergence': 'cmf',
    })[selectedStrategy] || null;
    const moneyFlowDivergenceSignal = moneyFlowDivergenceMode ? (selected?.signal || selected?.latestEvent) : null;
    const moneyFlowDivergencePair = (() => {
      if (!moneyFlowDivergenceSignal?.firstTime || !moneyFlowDivergenceSignal?.secondTime) return null;
      const firstIndicator = moneyFlowDivergenceMode === 'obv'
        ? Number(moneyFlowDivergenceSignal.firstObv)
        : Number(moneyFlowDivergenceSignal.firstIndicator);
      const secondIndicator = moneyFlowDivergenceMode === 'obv'
        ? Number(moneyFlowDivergenceSignal.secondObv)
        : Number(moneyFlowDivergenceSignal.secondIndicator);
      const firstPrice = Number(moneyFlowDivergenceSignal.firstPrice);
      const secondPrice = Number(moneyFlowDivergenceSignal.secondPrice);
      if (![firstIndicator, secondIndicator, firstPrice, secondPrice].every(Number.isFinite)) return null;
      return {
        mode: moneyFlowDivergenceMode,
        label: moneyFlowDivergenceMode.toUpperCase(),
        type: moneyFlowDivergenceSignal.type === 'bullish' ? 'bullish' : 'bearish',
        firstTime: moneyFlowDivergenceSignal.firstTime,
        secondTime: moneyFlowDivergenceSignal.secondTime,
        firstPrice,
        secondPrice,
        firstIndicator,
        secondIndicator,
      };
    })();
    const contractionStrategyKeys = ['pattern-triangle-flag', 'pattern-wedge'];
    const isContractionStrategy = contractionStrategyKeys.includes(selectedStrategy);
    const showContractionGeometry = !isContractionStrategy || layers.contraction !== false;
    const genericStrategyMarkers = activeStrategyKeys.flatMap(key => {
      const item = strategyByKey(key);
      if (key === 'trend-market-structure') return [];
      if (!item?.computed || key === 'ALL' || key === 'candlestick' || ['rsi', 'trend-ma-cross', 'indicator-macd-cross', 'indicator-kd-cross', 'divergence', 'rsiDivergence', 'kdDivergence'].includes(key)) return [];
      return withInvalidation(
        (item.events || [])
          .filter(event => event.plotMarker === true)
          .map(event => ({ ...event, strategyKey: key })),
        item.label || '策略訊號',
      );
    });
    const overlayColor = colorKey => ({
      positive: 'C.positive',
      negative: 'C.negative',
      warning: 'C.warning',
      accent: 'C.accent',
      structure: 'C.text',
      white: "'#FFFFFF'",
      textMuted: 'C.textMuted',
      textSub: 'C.textSub',
    }[colorKey] || 'C.accent');
    // Strategy price levels use the chart's native right-axis label format.
    // Keep them out of the plot so the label never covers candles.
    const strategyAnnotations = [];
    const strategyAnnotationStatus = String(selected?.status || 'none');
    const strategyOverlayPriceLines = (selectedOverlay.priceLines || [])
      .filter(line => !isMarketStructure || !['target', 'stop'].includes(line?.role))
      .filter(line => Number.isFinite(Number(line?.price)))
      .map(line => `candle.createPriceLine({price:${Number(line.price)},color:${overlayColor(line.colorKey)},lineWidth:${Math.max(1, Number(line.lineWidth || 2))},lineStyle:${Number(line.lineStyle ?? 2)},axisLabelVisible:true,title:${JSON.stringify(String(line.title || ''))}});`)
      .join('');
    const exitManagementPriceLines = selectedStrategy === 'riskManagement' && exitManagement ? [
      ['entry', exitManagement.entry, 'C.accent', '進場／成本'],
      ['initial', exitManagement.initialStop, 'C.negative', '初始停損'],
      ['effective', exitManagement.effectiveStop, 'C.warning', '有效停損'],
      ['target1', exitManagement.target1, 'C.positive', '目標1'],
      ['target2', exitManagement.target2, 'C.positive', '目標2'],
    ].filter(([, price]) => Number.isFinite(Number(price)) && Number(price) > 0)
      .map(([, price, color, title]) => `candle.createPriceLine({price:${Number(price)},color:${color},lineWidth:1,lineStyle:2,axisLabelVisible:true,title:${JSON.stringify(title)}});`)
      .join('') : '';
    const entryScalingPriceLines = selectedStrategy === 'entryScaling' && entryScaling ? [
      [entryScaling.entry, 'C.accent', entryScaling.hasPosition ? '進場／成本' : '試算進場'],
      [entryScaling.initialStop, 'C.negative', '初始停損'],
      [entryScaling.activeStop, 'C.warning', '目前保護線'],
      [entryScaling.oneR, 'C.positive', '1R／加碼30%'],
      [entryScaling.twoR, 'C.positive', '2R／加碼20%'],
      [entryScaling.threeR, 'C.textMuted', '3R／停止加碼'],
    ].filter(([price]) => Number.isFinite(Number(price)) && Number(price) > 0)
      .map(([price, color, title]) => `candle.createPriceLine({price:${Number(price)},color:${color},lineWidth:1,lineStyle:2,axisLabelVisible:true,title:${JSON.stringify(title)}});`)
      .join('') : '';
    const strategyOverlaySeries = showContractionGeometry ? (selectedOverlay.series || [])
      .filter(series => !moneyFlowDivergencePair || !String(series?.name || '').includes('背離價格轉折'))
      .filter(series => Array.isArray(series?.points) && series.points.length >= 2)
      .map((series, index) => {
        const comparison = structureComparisons.find(item => String(series.name).includes(item.label === '高點' ? '波段高' : '波段低'));
        const metadataMarkers = Array.isArray(series.markers) ? series.markers.map(marker => ({
          ...marker,
          color: colors[marker.colorKey] || colors[series.colorKey] || colors.accent,
        })) : null;
        const pointMarkers = metadataMarkers || (comparison ? series.points.map((point, pointIndex) => ({
          time: point.time, position: comparison.label === '高點' ? 'aboveBar' : 'belowBar',
          color: colors[series.colorKey] || colors.accent, shape: 'circle',
          text: pointIndex === 0 ? `前${comparison.label}` : `${structureNames[comparison.state]} ${comparison.state}`,
        })) : []);
        return `const strategyOverlay${index}=priceChart.addLineSeries({color:${overlayColor(series.colorKey)},lineWidth:${comparison ? 3 : Math.max(1, Number(series.lineWidth || 2))},lineStyle:${comparison ? 0 : Number(series.lineStyle ?? 1)},crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:''});strategyOverlay${index}.setData(${safeJson(series.points)});${pointMarkers.length ? `strategyOverlay${index}.setMarkers(${safeJson(pointMarkers)});` : ''}`;
      })
      .join('') : '';
    const strategyRegions = (showContractionGeometry ? (selectedOverlay.regions || []) : [])
      .map(region => ({
        ...region,
        points: (region.points || [])
          .filter(point => point?.time && Number.isFinite(Number(point.value)))
          .map(point => ({ time: point.time, value: Number(point.value) })),
      }))
      .filter(region => region.points.length >= 3);
    const divergencePriceLine = selectedDivergence
      ? `candle.createPriceLine({price:${selectedDivergence.neckline},color:C.warning,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:${JSON.stringify(`${selectedDivergence.oscillatorLabel || '背離'} ${selectedDivergence.type === 'bullish' ? '多方' : '空方'}確認線`)}});`
      : '';
    // Keep every directional price marker labeled. The chart uses custom
    // boxes for these labels, so hiding a label would leave an unexplained
    // arrow on the K-line.
    const markers = compactMarkers([
      ...corporateActionMarkers,
      ...financialReportMarkers,
      ...divergenceMarkers,
      ...rsiDivergenceMarkers,
      ...kdDivergenceMarkers,
      ...pullbackMarkers,
      ...breakoutMarkers,
      ...boundaryMarkers,
      ...smcMarkers,
      ...candlestickMarkers,
      ...genericStrategyMarkers,
      ...maCrossMarkers,
      ...hybridMarker,
    ], 18, true);
    const markerColorKey = marker => marker.color === colors.negative
      ? 'negative'
      : marker.color === colors.positive
        ? 'positive'
        : marker.color === colors.warning
          ? 'warning'
          : marker.color === colors.textMuted
            ? 'textMuted'
            : 'accent';
    strategyAnnotations.push(...markers
      .filter(marker => marker?.text && marker?.time)
      .map(marker => {
        const row = chartCandles.find(item => String(item.time) === String(marker.time));
        if (!row) return null;
        const above = marker.position === 'aboveBar';
        return {
          // The current overlay renderer places event labels in the safe
          // annotation area and gives them the same arrow color as the marker.
          // Keeping the native marker text hidden avoids two copies of a label.
          time: marker.time,
          price: above ? Number(row.high) : Number(row.low),
          title: String(marker.text),
          colorKey: markerColorKey(marker),
          role: above ? 'eventAbove' : 'eventBelow',
        };
      })
      .filter(item => item && Number.isFinite(item.price)));
    markers.forEach(marker => { marker.text = ''; });
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>
      *{box-sizing:border-box}html,body{margin:0;background:${colors.card};color:${colors.text};font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden}.pane{position:relative}#priceRow{display:flex;width:100%;height:390px}#price{height:390px;min-width:0;flex:1;position:relative}#flow{height:${FLOW_CHART_HEIGHT}px;border-top:1px solid ${colors.border}}.flowPane{height:${FLOW_PANE_HEIGHT}px;padding-top:${FLOW_PANE_HEADER_HEIGHT}px;overflow:hidden}.flowPane #flowCursor{top:56px;left:8px;right:${layers.volumeProfile ? '128px' : '8px'};max-width:${layers.volumeProfile ? 'calc(100% - 148px)' : 'none'};text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.flowPane .flowTabs{top:31px}#macd{height:150px;border-top:1px solid ${colors.border}}#rsi,#kd{height:140px;border-top:1px solid ${colors.border}}#label{position:absolute;z-index:5;left:10px;top:8px;font-size:10px;color:${colors.textSub};background:${colors.card}E6;padding:5px 8px;border:1px solid ${colors.border};border-radius:7px;pointer-events:none}.maKey{font-weight:800}.indicatorLegend{position:absolute;z-index:7;left:10px;right:10px;top:39px;display:flex;flex-wrap:wrap;align-items:center;gap:2px 9px;max-height:54px;overflow:hidden;padding:5px 8px;border:1px solid ${colors.border};border-radius:7px;background:${colors.card}F2;pointer-events:none;font-size:8px;line-height:12px}.indicatorGroup{display:flex;flex-wrap:wrap;align-items:center;gap:0 5px;white-space:nowrap}.indicatorGroupName{font-weight:900;margin-right:1px}.indicatorToken{white-space:nowrap}.indicatorName{font-weight:700;margin-right:2px}.indicatorValue{color:${colors.text};font-weight:700}.paneIndicatorLegend{position:absolute;z-index:8;left:10px;right:8px;top:4px;display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;max-height:28px;overflow:hidden;padding:4px 6px;border:1px solid ${colors.border};border-radius:7px;background:${colors.card}F2;pointer-events:none;font-size:8px;line-height:11px}.paneIndicatorTitle{font-weight:900;color:${colors.textSub};white-space:nowrap}.paneIndicatorHint{font-weight:900;color:${colors.textSub};white-space:nowrap}.paneIndicatorToken,.paneIndicatorDate{white-space:nowrap}.paneIndicatorName{font-weight:800;margin-right:3px}.paneIndicatorValue{font-weight:800;color:${colors.text}}.paneIndicatorDate{color:${colors.textMuted};font-weight:700;font-size:7px}.thresholdAxisLabels{position:absolute;z-index:7;top:0;right:0;width:62px;height:140px;pointer-events:none}.thresholdAxisLabel{position:absolute;right:2px;min-width:52px;height:18px;padding:2px 5px;border-radius:3px;color:#fff;font-size:9px;font-weight:900;line-height:14px;text-align:center;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.24)}.atrLegend{position:absolute;z-index:6;left:10px;top:88px;display:flex;flex-wrap:wrap;gap:5px 9px;max-width:calc(100% - 144px);padding:6px 8px;border:1px solid ${colors.border};border-radius:8px;background:${colors.card}EB;pointer-events:none}.atrLegendItem{display:flex;align-items:center;gap:4px;font-size:8px;color:${colors.textSub};white-space:nowrap}.atrLegendLine{width:12px;height:2px;border-radius:2px}.atrLegendValue{color:${colors.text};font-weight:700}.strategyRegions{position:absolute;z-index:2;inset:0;pointer-events:none;overflow:hidden}.strategyRegions svg{position:absolute;z-index:1;inset:0;width:100%;height:100%;overflow:visible}.strategyRegionLabel{position:absolute;z-index:2;max-width:30%;overflow:hidden;text-overflow:ellipsis;padding:2px 5px;border-radius:4px;color:#fff;font-size:8px;line-height:11px;font-weight:800;white-space:nowrap;opacity:.78;box-shadow:0 1px 3px rgba(0,0,0,.18)}.candlestickBoxes{position:absolute;z-index:4;inset:0;pointer-events:none;overflow:visible}.candlestickBox{position:absolute;border:2px solid;border-radius:4px;background:transparent}.candlestickBoxLabel{position:absolute;left:-1px;padding:2px 5px;border-radius:4px;color:#fff;font-size:10px;font-weight:900;line-height:14px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.28)}.strategyAnnotations{position:absolute;z-index:9;inset:0;pointer-events:none;overflow:hidden}.strategyAnnotation{position:absolute;transform:translate(-50%,-50%);max-width:42%;overflow:hidden;text-overflow:ellipsis;padding:6px 9px;border-radius:10px;color:#fff;font-size:10px;line-height:13px;font-weight:900;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.18)}.strategyAnnotation.target{transform:translate(-42%,-115%)}.strategyAnnotation.neckline{transform:translate(-42%,-115%)}.strategyAnnotation.stop{transform:translate(-42%,15%)}.indicatorLabel{position:absolute;left:10px;top:6px;z-index:5;color:${colors.textSub};font-size:10px;pointer-events:none}.cursorReadout{display:none;position:absolute;z-index:12;right:8px;top:5px;max-width:72%;padding:4px 6px;border:1px solid ${colors.border};border-radius:6px;background:${colors.card}F2;color:${colors.text};font-size:8px;font-weight:750;line-height:12px;text-align:right;pointer-events:none;white-space:normal;box-shadow:0 1px 4px rgba(0,0,0,.18)}#priceCursor{top:87px;right:${layers.volumeProfile ? '128px' : '8px'};max-width:${layers.volumeProfile ? 'calc(100% - 148px)' : 'calc(100% - 18px)'}}#flowCursor{top:${isTaiwanMarket ? '56px' : '34px'}}.flowTabs{position:absolute;z-index:8;left:8px;right:8px;top:31px;display:flex;gap:5px;overflow-x:auto;scrollbar-width:none}.flowTabs::-webkit-scrollbar{display:none}.flowTabs::-webkit-scrollbar{display:none}.flowTab{flex:none;border:1px solid ${colors.border};border-radius:10px;background:${colors.cardAlt || colors.card};color:${colors.textSub};padding:4px 7px;font-size:8px;font-weight:800;white-space:nowrap}.flowTab.active{border-color:${colors.accent};background:${colors.accentSoft};color:${colors.accent}}#profilePane{position:relative;flex:none;width:120px;height:390px;border-left:1px solid ${colors.border};background:${colors.cardAlt || colors.card};overflow:hidden}#volumeProfile{position:absolute;left:6px;right:6px;top:30px;bottom:68px;pointer-events:none;overflow:hidden}.profileBar{position:absolute;right:0;min-width:2px;border-radius:3px 0 0 3px;opacity:.58}.profileTitle{position:absolute;z-index:5;left:7px;right:5px;top:8px;font-size:8px;line-height:12px;color:${colors.textMuted};white-space:nowrap;pointer-events:none}.profileLevel{position:absolute;left:3px;right:3px;height:1px;border-top:1px dashed}.profileLevelLabel{position:absolute;right:0;padding:2px 4px;border-radius:4px;font-size:8px;font-weight:900;color:${colors.card};line-height:11px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.28)}</style></head><body>
      <div class="pane"><div id="label">K線 · <span class="maKey" style="color:${MA_COLORS.ma5}">MA5</span> · <span class="maKey" style="color:${MA_COLORS.ma10}">MA10</span> · <span class="maKey" style="color:${MA_COLORS.ma20}">MA20</span> · <span class="maKey" style="color:${MA_COLORS.ma40}">MA40</span> · <span class="maKey" style="color:${MA_COLORS.ma60}">MA60</span>${layers.boll ? ` · <span class="maKey" style="color:${BOLL_COLORS.middle}">BOLL(20,2)</span>` : ''}${selectedStrategy === 'candlestick' ? ` · <span class="maKey" style="color:${colors.textSub}">綠漲／紅跌</span>` : ''}</div><div class="indicatorLegend">${indicatorLegend}</div><div class="cursorReadout" id="priceCursor"></div>${atrOverlay ? `<div class="atrLegend">${atrOverlay.atr14 > 0 ? `<div class="atrLegendItem">ATR14 <span class="atrLegendValue">${atrOverlay.atr14.toFixed(2)}</span></div>` : ''}${atrOverlay.multiplier > 0 ? `<div class="atrLegendItem">倍數 <span class="atrLegendValue">${atrOverlay.multiplier.toFixed(1)}×</span></div>` : ''}${atrOverlay.entry > 0 ? `<div class="atrLegendItem"><i class="atrLegendLine" style="background:${colors.accent}"></i>進場</div>` : ''}${atrOverlay.initial > 0 ? `<div class="atrLegendItem"><i class="atrLegendLine" style="background:${colors.negative}"></i>初始停損</div>` : ''}${atrOverlay.trailing > 0 || atrOverlay.effective > 0 ? `<div class="atrLegendItem"><i class="atrLegendLine" style="background:${colors.warning}"></i>移動／有效停損</div>` : ''}${atrOverlay.target1 > 0 ? `<div class="atrLegendItem"><i class="atrLegendLine" style="background:${colors.positive}"></i>目標1／2</div>` : ''}${atrOverlay.estimated > 0 ? `<div class="atrLegendItem"><i class="atrLegendLine" style="background:${colors.textMuted}"></i>預估 2ATR</div>` : ''}</div>` : ''}<div id="priceRow"><div id="price"><div class="strategyRegions" id="strategyRegions"></div><div class="candlestickBoxes" id="candlestickBoxes"></div><div class="strategyAnnotations" id="strategyAnnotations"></div></div>${layers.volumeProfile ? `<div id="profilePane"><div class="profileTitle">量價分佈・${TECHNICAL_PERIOD_LABELS[periodKey] || '選定期間'}</div><div id="volumeProfile"></div></div>` : ''}</div></div>
      <div class="pane indicatorPane flowPane" style="display:${layers.flow ? 'block' : 'none'}">${layers.flow ? flowPaneLegend : ''}<div class="cursorReadout" id="flowCursor"></div>${layers.flow ? (isTaiwanMarket ? '<div class="flowTabs"><button class="flowTab" data-flow="foreign">外資</button><button class="flowTab" data-flow="trust">投信</button><button class="flowTab" data-flow="dealer">自營商</button><button class="flowTab" data-flow="all">三大法人</button><button class="flowTab" data-flow="directional">外資＋投信</button><button class="flowTab" data-flow="obv">OBV</button><button class="flowTab" data-flow="mfi">MFI</button><button class="flowTab" data-flow="cmf">CMF</button></div>' : '<div class="flowTabs"><button class="flowTab" data-flow="obv">OBV</button><button class="flowTab" data-flow="mfi">MFI</button><button class="flowTab" data-flow="cmf">CMF</button></div>') : ''}<div id="flow"></div></div>
      ${structureSummary}
      <div class="pane indicatorPane" style="display:${layers.macd ? 'block' : 'none'}">${layers.macd ? macdPaneLegend : ''}<div id="macd"></div></div>
      <div class="pane indicatorPane" style="display:${layers.rsi ? 'block' : 'none'}">${layers.rsi ? rsiPaneLegend : ''}<div id="rsi"></div></div>
      <div class="pane indicatorPane" style="display:${layers.kd ? 'block' : 'none'}">${layers.kd ? kdPaneLegend : ''}<div id="kd"></div></div>
      <script>window.__wealthGapZones=${safeJson(gapZoneData)};</script><script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script><script>
      const C=${safeJson(colors)}, M=${safeJson(MA_COLORS)}, B=${safeJson(BOLL_COLORS)}, R=${safeJson(RSI_COLORS)}, candles=${safeJson(chartCandles)}, timelineAnchorData=${safeJson(timelineAnchorData)}, provisionalFlowDate=${JSON.stringify(provisionalFlowDate)}, volumes=${safeJson(volumes)}, ma5=${safeJson(ma5)}, ma10=${safeJson(ma10)}, ma20=${safeJson(ma20)}, ma40=${safeJson(ma40)}, ma60=${safeJson(ma60)}, bollUpper=${safeJson(bollUpper)}, bollMiddle=${safeJson(bollMiddle)}, bollLower=${safeJson(bollLower)}, macd=${safeJson(macd)}, signal=${safeJson(signal)}, histogram=${safeJson(histogram)}, rsi=${safeJson(rsi)}, rsi5=${safeJson(rsi5)}, rsi10=${safeJson(rsi10)}, kValues=${safeJson(kValues)}, dValues=${safeJson(dValues)}, markers=${safeJson(markers)}, macdCrossMarkers=${safeJson(macdCrossMarkers)}, kdCrossMarkers=${safeJson(kdCrossMarkers)}, rsiCrossMarkers=${safeJson(rsiCrossMarkers)}, macdPaneMarkers=${safeJson(macdPaneMarkers)}, rsiPaneMarkers=${safeJson(rsiPaneMarkers)}, rsiDivergencePaneMarkers=${safeJson(rsiDivergencePaneMarkers)}, kdPaneMarkers=${safeJson(kdPaneMarkers)}, candlestickBoxes=${safeJson(candlestickBoxData)}, strategyRegions=${safeJson(strategyRegions)}, divergencePairs=${safeJson(divergencePairs)}, rsiDivergencePairs=${safeJson(rsiDivergencePairs)}, kdDivergencePairs=${safeJson(kdDivergencePairs)}, moneyFlowDivergencePair=${safeJson(moneyFlowDivergencePair)}, profileRows=${safeJson(profileRows)}, institutionalFlow=${safeJson(institutionalFlow)}, cmfFlow=${safeJson(cmfFlow)}, obvFlow=${safeJson(obvFlow)}, mfiFlow=${safeJson(mfiFlow)}, flowClose=${safeJson(flowClose)}, cursorRows=${safeJson(cursorRows)}, flowCursorRows=${safeJson(flowCursorRows)}, strategyAnnotations=${safeJson(strategyAnnotations)}, strategyAnnotationStatus=${JSON.stringify(strategyAnnotationStatus)};
      const common={layout:{background:{color:C.card},textColor:C.textSub},grid:{vertLines:{color:C.borderLight},horzLines:{color:C.borderLight}},rightPriceScale:{borderColor:C.border},timeScale:{borderColor:C.border,timeVisible:false,rightOffset:6,fixLeftEdge:true,fixRightEdge:false,lockVisibleTimeRangeOnResize:true},crosshair:{mode:LightweightCharts.CrosshairMode.Normal,vertLine:{visible:false,labelVisible:false},horzLine:{visible:false,labelVisible:false}},handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{axisPressedMouseMove:{time:false,price:false},axisDoubleClickReset:{time:false,price:false},mouseWheel:true,pinch:true},kineticScroll:{mouse:false,touch:false}};
      const chartWidth=id=>document.getElementById(id)?.clientWidth||innerWidth;const chartTouchStarts=new WeakMap();const preventNativeChartScale=event=>{if(!event.touches||event.touches.length!==1)return;const start=chartTouchStarts.get(event.currentTarget);const touch=event.touches[0];if(!start)return;const dx=touch.clientX-start.x;const dy=touch.clientY-start.y;if(Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)){event.preventDefault()}};['price','flow','macd','rsi','kd'].forEach(id=>{const host=document.getElementById(id);if(host){host.style.touchAction='pan-y';host.style.userSelect='none';host.style.webkitUserSelect='none';host.style.overscrollBehavior='none';host.addEventListener('touchstart',event=>{if(event.touches.length===1){const touch=event.touches[0];chartTouchStarts.set(host,{x:touch.clientX,y:touch.clientY})}else chartTouchStarts.delete(host)},{passive:true});host.addEventListener('touchmove',preventNativeChartScale,{passive:false});host.addEventListener('touchend',()=>chartTouchStarts.delete(host),{passive:true});host.addEventListener('touchcancel',()=>chartTouchStarts.delete(host),{passive:true})}});const addTimelineAnchor=chart=>{const anchor=chart.addLineSeries({color:'rgba(0,0,0,0)',lineWidth:1,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:'',priceScaleId:'timeline-anchor',autoscaleInfoProvider:()=>null});anchor.setData(timelineAnchorData);anchor.priceScale().applyOptions({visible:false});return anchor};
      const priceWidth=()=>chartWidth('price');
      const priceChart=LightweightCharts.createChart(document.getElementById('price'),{...common,width:priceWidth(),height:390,rightPriceScale:{...common.rightPriceScale,scaleMargins:{top:.18,bottom:.24}}});const priceTimelineAnchor=addTimelineAnchor(priceChart);
      const candle=priceChart.addCandlestickSeries({upColor:C.positive,downColor:C.negative,borderVisible:false,wickUpColor:C.positive,wickDownColor:C.negative,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false});candle.setData(candles);candle.setMarkers(markers);const addIndicatorLine=(data,options)=>{const series=priceChart.addLineSeries({...options,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:''});series.setData(data);series.applyOptions({crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:''});return series};
      // Lightweight Charts draws its candles on a canvas at z-index 2. Keep
      // these translucent zones above that canvas so they are actually seen.
      const gapZoneHost=document.createElement('div');gapZoneHost.id='gapZones';Object.assign(gapZoneHost.style,{position:'absolute',inset:'0',zIndex:'3',pointerEvents:'none',overflow:'hidden'});document.getElementById('price').insertBefore(gapZoneHost,document.getElementById('strategyRegions'));const gapZones=window.__wealthGapZones||[];
      const createPriceLine=candle.createPriceLine.bind(candle);const pendingPriceLines=new Map();candle.createPriceLine=options=>{const price=Number(options?.price);if(!Number.isFinite(price))return null;pendingPriceLines.set(price.toFixed(8),options);return null};const flushPriceLines=()=>pendingPriceLines.forEach(options=>createPriceLine(options));
      ${layers.ma ? `const m5=addIndicatorLine(ma5,{color:M.ma5,lineWidth:1});const m10=addIndicatorLine(ma10,{color:M.ma10,lineWidth:1});const m20=addIndicatorLine(ma20,{color:M.ma20,lineWidth:1});const m40=addIndicatorLine(ma40,{color:M.ma40,lineWidth:1});const m60=addIndicatorLine(ma60,{color:M.ma60,lineWidth:1});` : ''}
      ${layers.boll ? `const bollUpperSeries=addIndicatorLine(bollUpper,{color:B.upper,lineWidth:1,lineStyle:0});const bollMiddleSeries=addIndicatorLine(bollMiddle,{color:B.middle,lineWidth:1,lineStyle:0});const bollLowerSeries=addIndicatorLine(bollLower,{color:B.lower,lineWidth:1,lineStyle:0});` : ''}
      ${layers.volume ? `const volume=priceChart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'',lastValueVisible:false,priceLineVisible:false,title:''});volume.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0}});volume.setData(volumes);` : ''}
      ${averageCost > 0 ? `candle.createPriceLine({price:${Number(averageCost)},color:C.accent,lineWidth:2,lineStyle:1,axisLabelVisible:false,title:'成本'});` : ''}
      ${layers.levels ? analysis.supports.map((level, index) => `candle.createPriceLine({price:${level.price},color:C.positive,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'S${index + 1}'});`).join('') : ''}
      ${layers.levels ? analysis.resistances.map((level, index) => `candle.createPriceLine({price:${level.price},color:C.negative,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'R${index + 1}'});`).join('') : ''}
      ${divergencePriceLine}
      ${selectedStrategy !== 'entryScaling' && atrOverlay?.entry > 0 ? `candle.createPriceLine({price:${atrOverlay.entry},color:C.accent,lineWidth:2,lineStyle:1,axisLabelVisible:true,title:'混合進場'});` : ''}
      ${selectedStrategy !== 'entryScaling' && atrOverlay?.initial > 0 ? `candle.createPriceLine({price:${atrOverlay.initial},color:C.negative,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'ATR 初始停損'});` : ''}
      ${selectedStrategy !== 'entryScaling' && atrOverlay?.trailing > 0 ? `candle.createPriceLine({price:${atrOverlay.trailing},color:C.warning,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'ATR 移動停損'});` : ''}
      ${selectedStrategy !== 'entryScaling' && atrOverlay?.effective > 0 && atrOverlay.effective !== atrOverlay.trailing ? `candle.createPriceLine({price:${atrOverlay.effective},color:C.warning,lineWidth:3,lineStyle:1,axisLabelVisible:true,title:'目前有效停損'});` : ''}
      ${atrOverlay?.estimated > 0 ? `candle.createPriceLine({price:${atrOverlay.estimated},color:C.textMuted,lineWidth:1,lineStyle:3,axisLabelVisible:true,title:'預估 2ATR 風險'});` : ''}
      ${selectedStrategy === 'pullback' && selectedEvent?.level ? `candle.createPriceLine({price:${selectedEvent.level},color:C.accent,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'MA20 回檔線'});` : ''}
      ${selectedStrategy === 'breakout' && selectedEvent?.level ? `candle.createPriceLine({price:${selectedEvent.level},color:${selectedEvent.type === 'bearish' ? 'C.negative' : 'C.positive'},lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'20日突破線'});` : ''}
      ${selectedStrategy === 'rsi' && strategyByKey('rsi')?.direction === 'bullish' && analysis.supports[0] ? `candle.createPriceLine({price:${analysis.supports[0].price},color:C.positive,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'RSI 支撐'});` : ''}
      ${selectedStrategy === 'rsi' && strategyByKey('rsi')?.direction === 'bearish' && analysis.resistances[0] ? `candle.createPriceLine({price:${analysis.resistances[0].price},color:C.negative,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'RSI 壓力'});` : ''}
      ${boundaryLevels ? `candle.createPriceLine({price:${boundaryLevels.lower},color:C.positive,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'下邊界'});candle.createPriceLine({price:${boundaryLevels.upper},color:C.negative,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'上邊界'});candle.createPriceLine({price:${boundaryLevels.midpoint},color:C.warning,lineWidth:1,lineStyle:3,axisLabelVisible:true,title:'中軸'});candle.createPriceLine({price:${boundaryLevels.neutralLower},color:C.textMuted,lineWidth:1,lineStyle:3,axisLabelVisible:false,title:''});candle.createPriceLine({price:${boundaryLevels.neutralUpper},color:C.textMuted,lineWidth:1,lineStyle:3,axisLabelVisible:false,title:''});` : ''}
      ${selectedStrategy === 'boundary' && selectedEvent?.entryLower ? `candle.createPriceLine({price:${selectedEvent.entryLower},color:C.accent,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'進場區下緣'});candle.createPriceLine({price:${selectedEvent.entryUpper},color:C.accent,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'進場區上緣'});candle.createPriceLine({price:${selectedEvent.stop},color:C.negative,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'停損'});candle.createPriceLine({price:${selectedEvent.target1},color:C.positive,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'目標1'});candle.createPriceLine({price:${selectedEvent.target2},color:C.positive,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'目標2'});` : ''}
      ${smcLevels ? `candle.createPriceLine({price:${smcLevels.ssl},color:C.positive,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'SSL'});candle.createPriceLine({price:${smcLevels.bsl},color:C.negative,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'BSL'});candle.createPriceLine({price:${smcLevels.eq},color:C.warning,lineWidth:2,lineStyle:3,axisLabelVisible:true,title:'EQ 50%'});candle.createPriceLine({price:${smcLevels.discountUpper},color:C.textMuted,lineWidth:1,lineStyle:3,axisLabelVisible:false,title:''});candle.createPriceLine({price:${smcLevels.premiumLower},color:C.textMuted,lineWidth:1,lineStyle:3,axisLabelVisible:false,title:''});` : ''}
      ${selectedStrategy === 'smc' && selectedEvent?.chochLevel ? `candle.createPriceLine({price:${selectedEvent.chochLevel},color:C.accent,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'CHoCH'});` : ''}
      ${selectedStrategy === 'smc' && selectedEvent?.entryLower ? `candle.createPriceLine({price:${selectedEvent.entryLower},color:C.accent,lineWidth:1,lineStyle:2,axisLabelVisible:false,title:''});candle.createPriceLine({price:${selectedEvent.entryUpper},color:C.accent,lineWidth:1,lineStyle:2,axisLabelVisible:false,title:''});candle.createPriceLine({price:${(selectedEvent.entryLower + selectedEvent.entryUpper) / 2},color:C.accent,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'${selectedEvent.zoneType || 'FVG/OB'}'});candle.createPriceLine({price:${selectedEvent.stop},color:C.negative,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'SL'});candle.createPriceLine({price:${selectedEvent.target},color:C.positive,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'TP'});` : ''}
      ${exitManagementPriceLines}
      ${entryScalingPriceLines}
      ${strategyOverlayPriceLines}
      [...divergencePairs,...rsiDivergencePairs,...kdDivergencePairs].forEach(item=>{const bullish=item.type==='bullish';const line=priceChart.addLineSeries({color:bullish?C.positive:C.negative,lineWidth:3,lineStyle:0,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:''});line.setData([{time:item.previousTime,value:item.previousPrice},{time:item.time,value:item.price}]);});
      if(moneyFlowDivergencePair){const bullish=moneyFlowDivergencePair.type==='bullish',color=bullish?C.positive:C.negative;const priceDivergenceLine=priceChart.addLineSeries({color,lineWidth:3,lineStyle:0,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:''});priceDivergenceLine.setData([{time:moneyFlowDivergencePair.firstTime,value:moneyFlowDivergencePair.firstPrice},{time:moneyFlowDivergencePair.secondTime,value:moneyFlowDivergencePair.secondPrice}]);priceDivergenceLine.setMarkers([{time:moneyFlowDivergencePair.firstTime,position:bullish?'belowBar':'aboveBar',color,shape:'circle',text:'價格 1'},{time:moneyFlowDivergencePair.secondTime,position:bullish?'belowBar':'aboveBar',color,shape:'circle',text:'價格 2'}]);}
      ${strategyOverlaySeries}
      flushPriceLines();priceChart.timeScale().fitContent();
      let gapZoneFrame=null,gapZoneRetry=0;
      const renderGapZones=()=>{
        gapZoneFrame=null;
        const width=gapZoneHost.clientWidth,height=gapZoneHost.clientHeight;
        gapZoneHost.innerHTML='';
        if(!width||!height){
          if(gapZones.length&&gapZoneRetry<12){gapZoneRetry+=1;scheduleGapZones()}
          return;
        }
        let rightScaleWidth=0;
        try{rightScaleWidth=Number(priceChart.priceScale('right').width())||0}catch(error){}
        const plotRight=Math.max(0,Math.min(width,width-rightScaleWidth));
        const timeScale=priceChart.timeScale(),visibleRange=timeScale.getVisibleLogicalRange();
        if(!visibleRange)return;
        const firstVisible=Math.max(0,Math.ceil(visibleRange.from));
        const lastVisible=Math.min(candles.length-1,Math.floor(visibleRange.to));
        let rendered=0;
        gapZones.filter(item=>item.startIndex>firstVisible&&item.startIndex<=lastVisible&&(item.filledIndex==null||item.filledIndex>lastVisible)).slice(-24).forEach(item=>{
          const x=timeScale.timeToCoordinate(item.startTime);
          const previousX=timeScale.timeToCoordinate(candles[item.startIndex-1]?.time);
          const upperY=candle.priceToCoordinate(item.upper),lowerY=candle.priceToCoordinate(item.lower);
          if(![x,upperY,lowerY].every(Number.isFinite)||x>=plotRight||Math.max(upperY,lowerY)<0||Math.min(upperY,lowerY)>height)return;
          const barSpacing=Number.isFinite(previousX)?Math.abs(x-previousX):Number(timeScale.options().barSpacing)||10;
          const left=Math.max(0,(Number.isFinite(previousX)?previousX:x-barSpacing)-barSpacing/2);
          const top=Math.max(0,Math.min(upperY,lowerY)),bottom=Math.min(height,Math.max(upperY,lowerY));
          if(plotRight-left<3||bottom-top<2)return;
          const box=document.createElement('div');
          Object.assign(box.style,{position:'absolute',left:left+'px',top:top+'px',width:(plotRight-left)+'px',height:(bottom-top)+'px',background:'rgba(148,163,184,.24)',border:'none'});
          box.title=(item.direction==='up'?'向上跳空':'向下跳空')+' '+item.lower+'–'+item.upper;
          gapZoneHost.appendChild(box);
          rendered+=1;
        });
        if(gapZones.length&&!rendered&&gapZoneRetry<12){gapZoneRetry+=1;scheduleGapZones()}else gapZoneRetry=0;
      };
      const scheduleGapZones=()=>{if(gapZoneFrame!=null)cancelAnimationFrame(gapZoneFrame);gapZoneFrame=requestAnimationFrame(renderGapZones)};
      const refreshGapZones=()=>{scheduleGapZones();setTimeout(scheduleGapZones,60);setTimeout(scheduleGapZones,200)};
      let candlestickBoxFrame=null,candlestickBoxRetry=0;const renderCandlestickBoxes=()=>{candlestickBoxFrame=null;const host=document.getElementById('candlestickBoxes');if(!host)return;const width=host.clientWidth,height=host.clientHeight;if(!width||!height){if(candlestickBoxes.length&&candlestickBoxRetry<12){candlestickBoxRetry+=1;scheduleCandlestickBoxes()}return}host.innerHTML='';let rendered=0;candlestickBoxes.forEach(item=>{const x1=priceChart.timeScale().timeToCoordinate(item.startTime),x2=priceChart.timeScale().timeToCoordinate(item.endTime),y1=candle.priceToCoordinate(item.high),y2=candle.priceToCoordinate(item.low);if(![x1,x2,y1,y2].every(value=>Number.isFinite(value)))return;const left=Math.max(1,Math.min(width-2,Math.min(x1,x2)-9)),right=Math.max(left+4,Math.min(width-1,Math.max(x1,x2)+9)),top=Math.max(1,Math.min(height-2,Math.min(y1,y2)-7)),bottom=Math.max(top+4,Math.min(height-1,Math.max(y1,y2)+7));const color=item.type==='bearish'?C.negative:C.positive;const box=document.createElement('div');box.className='candlestickBox';box.style.left=left+'px';box.style.top=top+'px';box.style.width=(right-left)+'px';box.style.height=(bottom-top)+'px';box.style.borderColor=color;const label=document.createElement('span');label.className='candlestickBoxLabel';label.style.backgroundColor=color;label.style.top=top<28?'2px':'-24px';label.textContent=item.patternLabel;box.appendChild(label);host.appendChild(box);rendered+=1});if(candlestickBoxes.length&&!rendered&&candlestickBoxRetry<12){candlestickBoxRetry+=1;scheduleCandlestickBoxes()}else candlestickBoxRetry=0};const scheduleCandlestickBoxes=()=>{if(candlestickBoxFrame!=null)cancelAnimationFrame(candlestickBoxFrame);candlestickBoxFrame=requestAnimationFrame(renderCandlestickBoxes)};const refreshCandlestickBoxes=()=>{scheduleCandlestickBoxes();setTimeout(scheduleCandlestickBoxes,50);setTimeout(scheduleCandlestickBoxes,180)};
      const strategyRegionColors={positive:C.positive,negative:C.negative,warning:C.warning,accent:C.accent,structure:C.text,white:'#FFFFFF',textMuted:C.textMuted,textSub:C.textSub};
      let strategyRegionFrame=null;const renderStrategyRegions=()=>{strategyRegionFrame=null;const host=document.getElementById('strategyRegions');if(!host)return;host.innerHTML='';const width=host.clientWidth,height=host.clientHeight;if(!width||!height||!strategyRegions.length)return;const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('viewBox','0 0 '+width+' '+height);strategyRegions.forEach(region=>{const mapped=(region.points||[]).map(point=>({x:priceChart.timeScale().timeToCoordinate(point.time),y:candle.priceToCoordinate(point.value)})).filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.y));if(mapped.length<3)return;const color=strategyRegionColors[region.colorKey]||C.accent;const polygon=document.createElementNS('http://www.w3.org/2000/svg','polygon');polygon.setAttribute('class','strategyRegionPolygon');polygon.setAttribute('points',mapped.map(point=>point.x+','+point.y).join(' '));polygon.setAttribute('fill',color);const opacity=Number(region.fillOpacity);polygon.setAttribute('fill-opacity',String(Number.isFinite(opacity)?Math.max(.04,Math.min(.2,opacity)):.08));polygon.setAttribute('stroke',color);polygon.setAttribute('stroke-opacity','.82');polygon.setAttribute('stroke-width',String(Math.max(1,Number(region.lineWidth||1))));polygon.setAttribute('stroke-linejoin','round');polygon.setAttribute('stroke-dasharray',Number(region.lineStyle||0)===2?'5 4':'none');svg.appendChild(polygon);if(region.label){const minX=Math.max(2,Math.min.apply(null,mapped.map(point=>point.x))),minY=Math.max(2,Math.min.apply(null,mapped.map(point=>point.y))),maxX=Math.max.apply(null,mapped.map(point=>point.x)),maxY=Math.max.apply(null,mapped.map(point=>point.y));if(maxX-minX>42&&maxY-minY>16){const label=document.createElement('div');label.className='strategyRegionLabel';label.textContent=region.label;label.style.left=Math.min(width-8,Math.max(2,minX+4))+'px';label.style.top=Math.min(height-14,Math.max(2,minY+4))+'px';label.style.backgroundColor=C.cardAlt||C.card;label.style.border='1px solid '+color;label.style.color=color;label.style.zIndex='3';host.appendChild(label)}}});host.appendChild(svg)};const scheduleStrategyRegions=()=>{if(strategyRegionFrame!=null)cancelAnimationFrame(strategyRegionFrame);strategyRegionFrame=requestAnimationFrame(renderStrategyRegions)};
      const strategyAnnotationColors={positive:C.positive,negative:C.negative,warning:C.warning,accent:C.accent,structure:C.text,textMuted:C.textMuted,textSub:C.textSub};
      const strategyAnnotationX={target:.72,neckline:.58,stop:.72};const candlestickBoxHost=document.getElementById('candlestickBoxes');if(candlestickBoxHost)candlestickBoxHost.style.zIndex='10';
      const withAlpha=(color,alpha)=>/^#[0-9a-fA-F]{6}$/.test(String(color||''))?String(color)+alpha:color;
      const renderStrategyAnnotations=()=>{const host=document.getElementById('strategyAnnotations');if(!host)return;host.innerHTML='';const width=host.clientWidth,height=host.clientHeight;if(!width||!height)return;const placed=[];strategyAnnotations.map(item=>({item,x:item.time?priceChart.timeScale().timeToCoordinate(item.time):null,y:candle.priceToCoordinate(item.price)})).filter(entry=>Number.isFinite(entry.y)&&entry.y>=0&&entry.y<=height&&(!entry.item.time||(Number.isFinite(entry.x)&&entry.x>=0&&entry.x<=width))).sort((a,b)=>a.y-b.y).forEach(({item,x,y})=>{const role=['target','neckline','stop','eventAbove','eventBelow'].includes(item.role)?item.role:'level';const isEvent=role==='eventAbove'||role==='eventBelow';const anchorY=isEvent?y+(role==='eventAbove'?-14:14):y;const tag=document.createElement('div');tag.className='strategyAnnotation '+role;tag.textContent=item.title;const color=strategyAnnotationColors[item.colorKey]||C.accent;tag.style.backgroundColor=withAlpha(color,'D9');tag.style.borderColor=withAlpha(color,'F2');tag.style.opacity=strategyAnnotationStatus==='confirmed'?'.92':'.82';if(role==='eventAbove')tag.style.transform='translate(-50%,-100%)';if(role==='eventBelow')tag.style.transform='translate(-50%,0)';const ratio=strategyAnnotationX[role]||.68;const baseLeft=Number.isFinite(x)?x:Math.max(70,Math.min(width-70,width*ratio));const baseTop=isEvent?anchorY:Math.max(28,Math.min(height-28,y));let left=baseLeft;let top=baseTop;if(!isEvent){for(let attempt=0;attempt<6;attempt+=1){if(!placed.some(other=>Math.abs(top-other.top)<25&&Math.abs(left-other.left)<120))break;const step=Math.ceil((attempt+1)/2)*24;top=Math.max(28,Math.min(height-28,baseTop+(attempt%2===0?-step:step)));if(top===28||top===height-28)left=Math.max(38,Math.min(width-38,baseLeft+(attempt%2===0?36:-36)))}}tag.style.left=left+'px';tag.style.top=top+'px';host.appendChild(tag);if(isEvent&&Number.isFinite(x)){const half=Math.max(8,tag.offsetWidth/2);const minLeft=Math.min(half+4,width/2);const maxLeft=Math.max(width-half-4,width/2);left=Math.max(minLeft,Math.min(maxLeft,x));tag.style.left=left+'px'}placed.push({left,top})})};
      let strategyAnnotationFrame=null;const scheduleStrategyAnnotations=()=>{if(strategyAnnotationFrame!=null)cancelAnimationFrame(strategyAnnotationFrame);strategyAnnotationFrame=requestAnimationFrame(()=>{strategyAnnotationFrame=null;renderStrategyAnnotations()})};
      scheduleStrategyRegions();scheduleStrategyAnnotations();priceChart.timeScale().subscribeVisibleLogicalRangeChange(()=>{scheduleStrategyRegions();scheduleStrategyAnnotations()});refreshGapZones();priceChart.timeScale().subscribeVisibleLogicalRangeChange(refreshGapZones);refreshCandlestickBoxes();priceChart.timeScale().subscribeVisibleLogicalRangeChange(refreshCandlestickBoxes);
      const buildVisibleProfile=(rows,binCount=42)=>{if(!rows.length)return null;const min=Math.min(...rows.map(row=>Number(row.low))),max=Math.max(...rows.map(row=>Number(row.high))),step=(max-min)/binCount;if(!(step>0))return null;const bins=Array.from({length:binCount},(_,index)=>({lower:min+index*step,upper:min+(index+1)*step,volume:0,upVolume:0,downVolume:0}));rows.forEach(row=>{const from=Math.max(0,Math.min(binCount-1,Math.floor((row.low-min)/step))),to=Math.max(from,Math.min(binCount-1,Math.floor((row.high-min)/step))),typical=(Number(row.high)+Number(row.low)+Number(row.close))/3,weights=[];let totalWeight=0;for(let index=from;index<=to;index+=1){const center=(bins[index].lower+bins[index].upper)/2,weight=1/(1+Math.abs(center-typical)/step);weights.push([index,weight]);totalWeight+=weight}weights.forEach(pair=>{const allocated=Number(row.volume||0)*pair[1]/totalWeight,b=bins[pair[0]];b.volume+=allocated;if(row.close>=row.open)b.upVolume+=allocated;else b.downVolume+=allocated})});const total=bins.reduce((sum,bin)=>sum+bin.volume,0),pocIndex=bins.reduce((best,bin,index)=>bin.volume>bins[best].volume?index:best,0);let lowIndex=pocIndex,highIndex=pocIndex,valueAreaVolume=bins[pocIndex].volume;while(valueAreaVolume<total*.7&&(lowIndex>0||highIndex<bins.length-1)){const below=lowIndex>0?bins[lowIndex-1].volume:-1,above=highIndex<bins.length-1?bins[highIndex+1].volume:-1;if(above>=below){highIndex+=1;valueAreaVolume+=bins[highIndex].volume}else{lowIndex-=1;valueAreaVolume+=bins[lowIndex].volume}}return{bins,maxVolume:Math.max(...bins.map(bin=>bin.volume)),poc:(bins[pocIndex].lower+bins[pocIndex].upper)/2,vah:bins[highIndex].upper,val:bins[lowIndex].lower}};
      // The selected 3M/6M/1Y/3Y period is the calculation boundary. Do not
      // reuse a narrower visible chart window here, otherwise switching from
      // 3M to 6M can keep calculating the old 3M profile until the chart is
      // manually panned or zoomed.
      const visibleProfileRows=()=>profileRows;
      const formatProfilePrice=value=>{const price=Number(value);const decimals=Math.abs(price)>=1?2:Math.abs(price)>=.01?4:6;return price.toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals})};
      let profileFrame=null;const renderVolumeProfile=()=>{profileFrame=null;const host=document.getElementById('volumeProfile');if(!host)return;host.innerHTML='';const volumeProfile=buildVisibleProfile(visibleProfileRows());if(!volumeProfile||!volumeProfile.maxVolume)return;volumeProfile.bins.forEach(bin=>{const top=candle.priceToCoordinate(bin.upper),bottom=candle.priceToCoordinate(bin.lower);if(top==null||bottom==null)return;const bar=document.createElement('div');bar.className='profileBar';bar.style.top=Math.max(0,top-30)+'px';bar.style.height=Math.max(2,bottom-top)+'px';bar.style.width=Math.max(2,bin.volume/volumeProfile.maxVolume*100)+'%';const up=bin.volume?bin.upVolume/bin.volume*100:50;bar.style.background='linear-gradient(to left,'+C.positive+' 0%,'+C.positive+' '+up+'%,'+C.negative+' '+up+'%,'+C.negative+' 100%)';host.appendChild(bar)});const levelItems=[['VAH',volumeProfile.vah,C.textMuted],['POC',volumeProfile.poc,C.warning],['VAL',volumeProfile.val,C.textMuted]].map(item=>{const y=candle.priceToCoordinate(item[1]);return y==null?null:{item,lineTop:Math.max(0,Math.min(host.clientHeight-1,y-30))}}).filter(Boolean).sort((a,b)=>a.lineTop-b.lineTop);const labelHeight=15,maxLabelTop=Math.max(0,host.clientHeight-labelHeight);levelItems.forEach((entry,index)=>{entry.labelTop=Math.max(0,entry.lineTop-7);if(index&&entry.labelTop<levelItems[index-1].labelTop+labelHeight)entry.labelTop=levelItems[index-1].labelTop+labelHeight});if(levelItems.length&&levelItems.at(-1).labelTop>maxLabelTop){const shift=levelItems.at(-1).labelTop-maxLabelTop;levelItems.forEach(entry=>{entry.labelTop-=shift})}if(levelItems.length&&levelItems[0].labelTop<0){const shift=-levelItems[0].labelTop;levelItems.forEach(entry=>{entry.labelTop+=shift})}levelItems.forEach(({item,lineTop,labelTop})=>{const level=document.createElement('div');level.className='profileLevel';level.style.top=lineTop+'px';level.style.borderColor=item[2];const label=document.createElement('span');label.className='profileLevelLabel';label.style.top=(labelTop-lineTop)+'px';label.style.background=item[2];label.textContent=item[0]+' '+formatProfilePrice(item[1]);level.appendChild(label);host.appendChild(level)})};
      const scheduleVolumeProfile=()=>{if(profileFrame!=null)cancelAnimationFrame(profileFrame);profileFrame=requestAnimationFrame(renderVolumeProfile)};
      scheduleVolumeProfile();priceChart.timeScale().subscribeVisibleLogicalRangeChange(scheduleVolumeProfile);
      const priceHost=document.getElementById('price');priceHost.addEventListener('wheel',scheduleVolumeProfile,{passive:true});priceHost.addEventListener('touchmove',scheduleVolumeProfile,{passive:true});priceHost.addEventListener('pointermove',event=>{if(event.buttons)scheduleVolumeProfile()},{passive:true});
      const linkedCharts=[priceChart];
      let activeFlowMode=${JSON.stringify(selectedFlowMode)};
      let flowChart=null;
      if(${layers.flow}){
        flowChart=LightweightCharts.createChart(document.getElementById('flow'),{...common,width:innerWidth,height:${FLOW_CHART_HEIGHT},leftPriceScale:{visible:true,borderColor:C.border,scaleMargins:{top:${isTaiwanMarket ? '.32' : '.2'},bottom:.14}},rightPriceScale:{...common.rightPriceScale,scaleMargins:{top:${isTaiwanMarket ? '.32' : '.2'},bottom:.14}}});
        addTimelineAnchor(flowChart);
        const flowDivergenceLine=moneyFlowDivergencePair?flowChart.addLineSeries({priceScaleId:moneyFlowDivergencePair.mode==='cmf'?'left':moneyFlowDivergencePair.mode,color:moneyFlowDivergencePair.type==='bullish'?C.positive:C.negative,lineWidth:3,lineStyle:0,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:'',visible:false}):null;
        if(flowDivergenceLine){const bullish=moneyFlowDivergencePair.type==='bullish',color=bullish?C.positive:C.negative;flowDivergenceLine.setData([{time:moneyFlowDivergencePair.firstTime,value:moneyFlowDivergencePair.firstIndicator},{time:moneyFlowDivergencePair.secondTime,value:moneyFlowDivergencePair.secondIndicator}]);flowDivergenceLine.setMarkers([{time:moneyFlowDivergencePair.firstTime,position:bullish?'belowBar':'aboveBar',color,shape:'circle',text:moneyFlowDivergencePair.label+' 1'},{time:moneyFlowDivergencePair.secondTime,position:bullish?'belowBar':'aboveBar',color,shape:'circle',text:moneyFlowDivergencePair.label+' 2'}]);}
        if(${isTaiwanMarket}){
          const institutionBars=flowChart.addHistogramSeries({priceScaleId:'left',priceFormat:{type:'volume'},title:'外資',lastValueVisible:false,priceLineVisible:false});
          const cmfBars=flowChart.addHistogramSeries({priceScaleId:'left',title:'CMF20',priceFormat:{type:'price',precision:2,minMove:.01},visible:false,lastValueVisible:false,priceLineVisible:false});
          const obvLine=flowChart.addLineSeries({priceScaleId:'obv',color:C.accent,lineWidth:1,crosshairMarkerVisible:false,title:'OBV',visible:false,priceFormat:{type:'volume'},lastValueVisible:false,priceLineVisible:false});
          const mfiLine=flowChart.addLineSeries({priceScaleId:'mfi',color:C.warning,lineWidth:1,crosshairMarkerVisible:false,title:'MFI',visible:false,priceFormat:{type:'price',precision:1,minMove:.1},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}}),lastValueVisible:false,priceLineVisible:false});
          obvLine.priceScale().applyOptions({visible:false,scaleMargins:{top:.2,bottom:.14}});
          mfiLine.priceScale().applyOptions({visible:false,scaleMargins:{top:.2,bottom:.14}});
          cmfBars.createPriceLine({price:0,color:C.textMuted,lineWidth:1,lineStyle:2,axisLabelVisible:false,title:''});
          mfiLine.createPriceLine({price:80,color:C.negative,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});
          mfiLine.createPriceLine({price:50,color:C.textMuted,lineWidth:1,lineStyle:2,axisLabelVisible:false,title:''});
          mfiLine.createPriceLine({price:20,color:C.positive,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});
          const closeLine=flowChart.addLineSeries({priceScaleId:'right',color:C.textSub,lineWidth:1,crosshairMarkerVisible:false,title:'股價',priceFormat:{type:'price',precision:2,minMove:.01},lastValueVisible:false,priceLineVisible:false});
          closeLine.setData(flowClose);
          const flowNames={foreign:'外資',trust:'投信',dealer:'自營商',all:'三大法人',directional:'外資＋投信'};
          const indicatorTitles={obv:'OBV 累積量價趨勢',mfi:'MFI 資金流量指標',cmf:'CMF20 資金流'};
          const setFlow=mode=>{
            const obvMode=mode==='obv';
            const mfiMode=mode==='mfi';
            const cmfMode=mode==='cmf';
            const institutionMode=!obvMode&&!mfiMode&&!cmfMode;
            activeFlowMode=mode;
            const points=institutionalFlow.filter(row=>row.available).map(row=>{const value=Number(row[mode]||0);return{time:row.time,value,color:value>=0?C.positive+'C8':C.negative+'C8'}});
            institutionBars.applyOptions({title:institutionMode?flowNames[mode]:'法人',visible:institutionMode});
            institutionBars.setData(institutionMode?points:[]);
            cmfBars.applyOptions({visible:cmfMode});
            cmfBars.setData(cmfMode?cmfFlow:[]);
            obvLine.applyOptions({visible:obvMode});
            obvLine.setData(obvMode?obvFlow:[]);
            mfiLine.applyOptions({visible:mfiMode});
            mfiLine.setData(mfiMode?mfiFlow:[]);
            if(flowDivergenceLine)flowDivergenceLine.applyOptions({visible:mode===moneyFlowDivergencePair.mode});
            flowChart.priceScale('left').applyOptions({visible:institutionMode||cmfMode,scaleMargins:{top:.32,bottom:.14}});
            flowChart.priceScale('obv').applyOptions({visible:obvMode,scaleMargins:{top:.2,bottom:.14}});
            flowChart.priceScale('mfi').applyOptions({visible:mfiMode,scaleMargins:{top:.2,bottom:.14}});
            const title=document.getElementById('pane-indicator-flow-title');
            if(title)title.textContent=(indicatorTitles[mode]||flowNames[mode]+'每日淨買賣・收盤價')+(moneyFlowDivergencePair?.mode===mode?' · 背離線':'');
            const institutionTokens=document.getElementById('flow-institutional-tokens');
            const obvTokens=document.getElementById('flow-obv-tokens');
            const mfiTokens=document.getElementById('flow-mfi-tokens');
            const cmfTokens=document.getElementById('flow-cmf-tokens');
            if(institutionTokens)institutionTokens.style.display=institutionMode?'':'none';
            if(obvTokens)obvTokens.style.display=obvMode?'':'none';
            if(mfiTokens)mfiTokens.style.display=mfiMode?'':'none';
            if(cmfTokens)cmfTokens.style.display=cmfMode?'':'none';
            const name=document.getElementById('pane-indicator-flow-institutional-name');
            const value=document.getElementById('pane-indicator-flow-institutional');
            const latest=institutionalFlow.slice().reverse().find(row=>row.available);
            if(institutionMode&&name)name.textContent=flowNames[mode];
            if(institutionMode&&value&&latest){const amount=Number(latest[mode]||0);const formatted=Math.abs(amount)>=1e8?(amount/1e8).toFixed(3)+'億':Math.abs(amount)>=1e6?(amount/1e6).toFixed(3)+'M':Math.abs(amount)>=1e3?(amount/1e3).toFixed(1)+'K':amount.toFixed(0);value.dataset.latest=formatted;value.textContent=formatted}
            document.querySelectorAll('.flowTab').forEach(button=>button.classList.toggle('active',button.dataset.flow===mode));
          };
          document.querySelectorAll('.flowTab').forEach(button=>button.addEventListener('click',()=>setFlow(button.dataset.flow)));
          setFlow(activeFlowMode);
        }else{
          const indicatorTitles={obv:'OBV 累積量價趨勢',mfi:'MFI 資金流量指標',cmf:'CMF20 資金流'};
          const cmfBars=flowChart.addHistogramSeries({priceScaleId:'left',title:'CMF20',priceFormat:{type:'price',precision:2,minMove:.01},lastValueVisible:false,priceLineVisible:false,visible:false});
          cmfBars.createPriceLine({price:0,color:C.textMuted,lineWidth:1,lineStyle:2,axisLabelVisible:false,title:''});
          const obvLine=flowChart.addLineSeries({priceScaleId:'obv',color:C.accent,lineWidth:1,crosshairMarkerVisible:false,title:'OBV',priceFormat:{type:'volume'},lastValueVisible:false,priceLineVisible:false,visible:false});
          obvLine.priceScale().applyOptions({visible:false,scaleMargins:{top:.2,bottom:.14}});
          const mfiLine=flowChart.addLineSeries({priceScaleId:'mfi',color:C.warning,lineWidth:1,crosshairMarkerVisible:false,title:'MFI',priceFormat:{type:'price',precision:1,minMove:.1},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}}),lastValueVisible:false,priceLineVisible:false,visible:false});
          mfiLine.priceScale().applyOptions({visible:false,scaleMargins:{top:.2,bottom:.14}});
          mfiLine.createPriceLine({price:80,color:C.negative,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});
          mfiLine.createPriceLine({price:50,color:C.textMuted,lineWidth:1,lineStyle:2,axisLabelVisible:false,title:''});
          mfiLine.createPriceLine({price:20,color:C.positive,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});
          const closeLine=flowChart.addLineSeries({priceScaleId:'right',color:C.textSub,lineWidth:1,crosshairMarkerVisible:false,title:'股價',priceFormat:{type:'price',precision:2,minMove:.01},lastValueVisible:false,priceLineVisible:false});
          closeLine.setData(flowClose);
          const setFlow=mode=>{
            const obvMode=mode==='obv';
            const mfiMode=mode==='mfi';
            const cmfMode=mode==='cmf';
            activeFlowMode=indicatorTitles[mode]?mode:'obv';
            cmfBars.applyOptions({visible:cmfMode});
            cmfBars.setData(cmfMode?cmfFlow:[]);
            obvLine.applyOptions({visible:obvMode});
            obvLine.setData(obvMode?obvFlow:[]);
            flowChart.priceScale('left').applyOptions({visible:cmfMode,scaleMargins:{top:.2,bottom:.14}});
            flowChart.priceScale('obv').applyOptions({visible:obvMode,scaleMargins:{top:.2,bottom:.14}});
            mfiLine.applyOptions({visible:mfiMode});
            mfiLine.setData(mfiMode?mfiFlow:[]);
            if(flowDivergenceLine)flowDivergenceLine.applyOptions({visible:activeFlowMode===moneyFlowDivergencePair.mode});
            flowChart.priceScale('mfi').applyOptions({visible:mfiMode,scaleMargins:{top:.2,bottom:.14}});
            const title=document.getElementById('pane-indicator-flow-title');
            if(title)title.textContent=indicatorTitles[activeFlowMode]+(moneyFlowDivergencePair?.mode===activeFlowMode?' · 背離線':'');
            const obvTokens=document.getElementById('flow-obv-tokens');
            const mfiTokens=document.getElementById('flow-mfi-tokens');
            const cmfTokens=document.getElementById('flow-cmf-tokens');
            if(obvTokens)obvTokens.style.display=obvMode?'':'none';
            if(mfiTokens)mfiTokens.style.display=mfiMode?'':'none';
            if(cmfTokens)cmfTokens.style.display=cmfMode?'':'none';
            document.querySelectorAll('.flowTab').forEach(button=>button.classList.toggle('active',button.dataset.flow===activeFlowMode));
          };
          document.querySelectorAll('.flowTab').forEach(button=>button.addEventListener('click',()=>setFlow(button.dataset.flow)));
          setFlow(activeFlowMode);
        }
        linkedCharts.push(flowChart);
        flowChart.timeScale().fitContent();
      }
      const drawOscillatorDivergences=(chart,pairs)=>{if(!chart)return;pairs.forEach(item=>{const bullish=item.type==='bullish',color=bullish?C.positive:C.negative;const line=chart.addLineSeries({color,lineWidth:3,lineStyle:0,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:''});line.setData([{time:item.previousTime,value:item.previousOscillator},{time:item.time,value:item.oscillator}]);});};
      let macdChart=null,macdLine=null;if(${layers.macd}){macdChart=LightweightCharts.createChart(document.getElementById('macd'),{...common,width:innerWidth,height:150,rightPriceScale:{...common.rightPriceScale,scaleMargins:{top:.28,bottom:.12}}});addTimelineAnchor(macdChart);const hist=macdChart.addHistogramSeries({priceScaleId:'right',lastValueVisible:false,priceLineVisible:false,title:''});hist.setData(histogram);macdLine=macdChart.addLineSeries({color:C.chartPalette[1]||C.accent,lineWidth:1,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:''});macdLine.setData(macd);macdLine.setMarkers(macdPaneMarkers);const sig=macdChart.addLineSeries({color:C.warning,lineWidth:1,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:''});sig.setData(signal);drawOscillatorDivergences(macdChart,divergencePairs,'MACD');linkedCharts.push(macdChart);macdChart.timeScale().fitContent();}
      let rsiChart=null,rsi5Line=null,rsi10Line=null,rsi14Line=null;if(${layers.rsi}){rsiChart=LightweightCharts.createChart(document.getElementById('rsi'),{...common,width:innerWidth,height:140,rightPriceScale:{...common.rightPriceScale,scaleMargins:{top:.28,bottom:.12}}});addTimelineAnchor(rsiChart);rsi5Line=rsiChart.addLineSeries({color:R.short,lineWidth:1,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:'',priceFormat:{type:'price',precision:1,minMove:.1},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});rsi5Line.setData(rsi5);rsi5Line.setMarkers(rsiPaneMarkers);rsi10Line=rsiChart.addLineSeries({color:R.long,lineWidth:1,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:'',priceFormat:{type:'price',precision:1,minMove:.1},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});rsi10Line.setData(rsi10);rsi14Line=rsiChart.addLineSeries({color:R.base,lineWidth:1,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:'',priceFormat:{type:'price',precision:1,minMove:.1},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});rsi14Line.setData(rsi);rsi14Line.setMarkers(rsiDivergencePaneMarkers);rsi5Line.createPriceLine({price:70,color:C.textMuted,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});rsi5Line.createPriceLine({price:30,color:C.textMuted,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});drawOscillatorDivergences(rsiChart,rsiDivergencePairs);linkedCharts.push(rsiChart);rsiChart.timeScale().fitContent();}
      let kdChart=null,kLine=null;if(${layers.kd}){kdChart=LightweightCharts.createChart(document.getElementById('kd'),{...common,width:innerWidth,height:140,rightPriceScale:{...common.rightPriceScale,scaleMargins:{top:.28,bottom:.12}}});addTimelineAnchor(kdChart);kLine=kdChart.addLineSeries({color:C.accent,lineWidth:1,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:'',priceFormat:{type:'price',precision:1,minMove:.1},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});kLine.setData(kValues);kLine.setMarkers(kdPaneMarkers);const dLine=kdChart.addLineSeries({color:C.warning,lineWidth:1,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:'',priceFormat:{type:'price',precision:1,minMove:.1},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});dLine.setData(dValues);kLine.createPriceLine({price:80,color:C.textMuted,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});kLine.createPriceLine({price:20,color:C.textMuted,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});drawOscillatorDivergences(kdChart,kdDivergencePairs);linkedCharts.push(kdChart);kdChart.timeScale().fitContent();}
      const scheduleRightIndicatorLabels=()=>{};
      const flowCrosshairSeries=flowChart?flowChart.addLineSeries({color:'rgba(0,0,0,0)',lineWidth:1,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:''}):null;if(flowCrosshairSeries)flowCrosshairSeries.setData(flowClose);
      const macdCrosshairSeries=macdChart?macdChart.addLineSeries({color:'rgba(0,0,0,0)',lineWidth:1,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:''}):null;if(macdCrosshairSeries)macdCrosshairSeries.setData(macd);
      const rsiCrosshairSeries=rsiChart?rsiChart.addLineSeries({color:'rgba(0,0,0,0)',lineWidth:1,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:'',autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})}):null;if(rsiCrosshairSeries)rsiCrosshairSeries.setData(rsi5);
      const kdCrosshairSeries=kdChart?kdChart.addLineSeries({color:'rgba(0,0,0,0)',lineWidth:1,crosshairMarkerVisible:false,lastValueVisible:false,priceLineVisible:false,title:'',autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})}):null;if(kdCrosshairSeries)kdCrosshairSeries.setData(kValues);
      const createSynchronizedCrosshairLine=(hostId,id)=>{const host=document.getElementById(hostId);if(!host)return null;host.style.position='relative';const line=document.createElement('div');line.id=id;line.style.cssText='display:none;position:absolute;top:0;bottom:0;width:0;border-left:1px dashed '+C.textMuted+';z-index:4;pointer-events:none;';host.appendChild(line);return line};
      const synchronizedCrosshairLines=[{chart:priceChart,line:createSynchronizedCrosshairLine('price','priceCrosshair')},{chart:flowChart,line:createSynchronizedCrosshairLine('flow','flowCrosshair')},{chart:macdChart,line:createSynchronizedCrosshairLine('macd','macdCrosshair')},{chart:rsiChart,line:createSynchronizedCrosshairLine('rsi','rsiCrosshair')},{chart:kdChart,line:createSynchronizedCrosshairLine('kd','kdCrosshair')}].filter(item=>item.chart&&item.line);
      const chartBindings=[{chart:priceChart,series:candle,value:row=>row.close},{chart:flowChart,series:flowCrosshairSeries,value:row=>row.close},{chart:macdChart,series:macdCrosshairSeries,value:row=>row.macd},{chart:rsiChart,series:rsiCrosshairSeries,value:row=>row.rsi5},{chart:kdChart,series:kdCrosshairSeries,value:row=>row.k}].filter(binding=>binding.chart&&binding.series);
      const crosshairOnlySeries=new Set([flowCrosshairSeries,macdCrosshairSeries,rsiCrosshairSeries,kdCrosshairSeries].filter(Boolean));
      const cursorByTime=new Map(cursorRows.map(row=>[String(row.time),row]));
      const candleCursorByTime=new Map(candles.map((row,index)=>[String(row.time),{...row,previousClose:candles[index-1]?.close}]));
      const flowCursorByTime=new Map(flowCursorRows.map(row=>[String(row.time),row]));
      const institutionalCursorByTime=new Map(institutionalFlow.map(row=>[String(row.time),row]));
      const readoutIds=['flowCursor','macdCursor','rsiCursor','kdCursor'];
      const timeKey=time=>{if(typeof time==='string')return time;if(typeof time==='number'&&Number.isFinite(time)){const date=new Date((time>1e12?time:time*1000));return Number.isNaN(date.getTime())?'':date.toISOString().slice(0,10)}if(time&&typeof time==='object'&&time.year)return String(time.year)+'-'+String(time.month).padStart(2,'0')+'-'+String(time.day).padStart(2,'0');return ''};
      const isDataClick=param=>{if(!param?.point||!param?.seriesData||!timeKey(param.time))return false;let nearest=Infinity;param.seriesData.forEach((data,series)=>{if(crosshairOnlySeries.has(series)||typeof series.priceToCoordinate!=='function')return;const values=[data?.value,data?.open,data?.high,data?.low,data?.close].map(Number).filter(Number.isFinite);values.forEach(value=>{const y=series.priceToCoordinate(value);if(Number.isFinite(y))nearest=Math.min(nearest,Math.abs(param.point.y-y))})});return nearest<=18};
      const dateLabel=value=>String(value||'').replaceAll('-','/');
      const numberLabel=(value,digits=2)=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
      const indicatorNumber=value=>{const number=Number(value);if(!Number.isFinite(number))return '—';const digits=Math.abs(number)>=1000?2:3;return number.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits})};
      const indicatorVolumeNumber=value=>{const number=Number(value);if(!Number.isFinite(number))return '—';const absolute=Math.abs(number);if(absolute>=1e8)return(number/1e8).toFixed(3)+'億';if(absolute>=1e6)return(number/1e6).toFixed(3)+'M';if(absolute>=1e3)return(number/1e3).toFixed(1)+'K';return number.toFixed(0)};
      const updateIndicatorLegend=(row,time)=>{
        const latest=!row;
        const values=[['indicator-boll-middle','bollMiddle'],['indicator-boll-upper','bollUpper'],['indicator-boll-lower','bollLower'],['indicator-ma5','ma5'],['indicator-ma10','ma10'],['indicator-ma20','ma20'],['indicator-ma40','ma40'],['indicator-ma60','ma60'],['indicator-volume','volume',indicatorVolumeNumber]];
        values.forEach(([id,key,formatter])=>{const element=document.getElementById(id);if(element)element.textContent=latest?element.dataset.latest:(formatter?formatter(row?.[key]):indicatorNumber(row?.[key]))});
        const close=document.getElementById('indicator-close');if(close)close.textContent=close.dataset.latest;
        const selectedCandle=time?candleCursorByTime.get(String(time)):null;
        const candle=selectedCandle||(!time?candles.at(-1):null);
        [['indicator-open','open'],['indicator-high','high'],['indicator-low','low'],['indicator-selected-close','close']].forEach(([id,key])=>{const element=document.getElementById(id);if(element)element.textContent=candle?indicatorNumber(candle[key]):'—'});
        const changeElement=document.getElementById('indicator-change');
        if(changeElement){const previous=Number(candle?.previousClose),current=Number(candle?.close),change=current-previous,changePercent=previous?change/previous*100:NaN;changeElement.textContent=Number.isFinite(changePercent)?(change>0?'+':'')+indicatorNumber(change)+' ('+(changePercent>0?'+':'')+changePercent.toFixed(2)+'%)':'—';changeElement.style.color=Number.isFinite(changePercent)?(change>=0?C.positive:C.negative):C.textSub}
        const date=document.getElementById('indicatorDate');if(date)date.textContent=selectedCandle?dateLabel(time):'最新';
      };
      const updatePaneIndicatorLegends=(row,time)=>{
        const latest=!row;
        const values=[['pane-indicator-macd-dif','macd',2],['pane-indicator-macd-signal','macdSignal',2],['pane-indicator-macd-histogram','macdHistogram',2],['pane-indicator-rsi5','rsi5',1],['pane-indicator-rsi10','rsi10',1],['pane-indicator-rsi14','rsi',1],['pane-indicator-kd-k','k',1],['pane-indicator-kd-d','d',1]];
        values.forEach(([id,key,digits])=>{const element=document.getElementById(id);if(element)element.textContent=latest?element.dataset.latest:numberLabel(row?.[key],digits)});
        const obvMode=activeFlowMode==='obv';
        const mfiMode=activeFlowMode==='mfi';
        const cmfMode=activeFlowMode==='cmf';
        const flowRow=latest?flowCursorRows.at(-1):flowCursorByTime.get(String(time));
        const flowPending=!latest&&!flowRow&&Boolean(provisionalFlowDate&&String(time)>=provisionalFlowDate);
        if(${isTaiwanMarket}){
          const flowNames={foreign:'外資',trust:'投信',dealer:'自營商',all:'三大法人',directional:'外資＋投信'};
          const flow=latest?institutionalFlow.slice().reverse().find(item=>item.available):institutionalCursorByTime.get(String(time));
          const title=document.getElementById('pane-indicator-flow-title');
          if(mfiMode){
            if(title)title.textContent='MFI 資金流量指標'+(moneyFlowDivergencePair?.mode==='mfi'?' · 背離線':'');
            const mfi=document.getElementById('pane-indicator-flow-mfi');
            const close=document.getElementById('pane-indicator-flow-mfi-close');
            if(mfi)mfi.textContent=latest?mfi.dataset.latest:numberLabel(flowRow?.mfi,1);
            if(close)close.textContent=latest?close.dataset.latest:numberLabel(flowRow?.close,2);
          }else if(obvMode){
            if(title)title.textContent='OBV 累積量價趨勢'+(moneyFlowDivergencePair?.mode==='obv'?' · 背離線':'');
            const obv=document.getElementById('pane-indicator-flow-obv');
            const close=document.getElementById('pane-indicator-flow-obv-close');
            if(obv)obv.textContent=latest?obv.dataset.latest:compactLabel(flowRow?.obv);
            if(close)close.textContent=latest?close.dataset.latest:numberLabel(flowRow?.close,2);
          }else if(cmfMode){
            if(title)title.textContent='CMF20 資金流'+(moneyFlowDivergencePair?.mode==='cmf'?' · 背離線':'');
            const cmf=document.getElementById('pane-indicator-flow-cmf');
            const close=document.getElementById('pane-indicator-flow-cmf-close');
            if(cmf)cmf.textContent=latest?cmf.dataset.latest:numberLabel(flowRow?.cmf,2);
            if(close)close.textContent=latest?close.dataset.latest:numberLabel(flowRow?.close,2);
          }else{
            const name=document.getElementById('pane-indicator-flow-institutional-name');
            const value=document.getElementById('pane-indicator-flow-institutional');
            const close=document.getElementById('pane-indicator-flow-institutional-close');
            if(title)title.textContent=flowNames[activeFlowMode]+'每日淨買賣・收盤價';
            if(name)name.textContent=flowNames[activeFlowMode];
            if(value)value.textContent=latest?value.dataset.latest:(flow&&flow.available?compactLabel(flow[activeFlowMode]):'—');
            if(close)close.textContent=latest?close.dataset.latest:numberLabel(flowRow?.close,2);
          }
        }else if(mfiMode){
          const title=document.getElementById('pane-indicator-flow-title');
          if(title)title.textContent='MFI 資金流量指標'+(moneyFlowDivergencePair?.mode==='mfi'?' · 背離線':'');
          const mfi=document.getElementById('pane-indicator-flow-mfi');
          const close=document.getElementById('pane-indicator-flow-mfi-close');
          if(mfi)mfi.textContent=latest?mfi.dataset.latest:numberLabel(flowRow?.mfi,1);
          if(close)close.textContent=latest?close.dataset.latest:numberLabel(flowRow?.close,2);
        }else if(obvMode){
          const title=document.getElementById('pane-indicator-flow-title');
          if(title)title.textContent='OBV 累積量價趨勢'+(moneyFlowDivergencePair?.mode==='obv'?' · 背離線':'');
          [['pane-indicator-flow-obv','obv','volume'],['pane-indicator-flow-obv-close','close',2]].forEach(([id,key,digits])=>{const element=document.getElementById(id);if(element)element.textContent=latest?element.dataset.latest:(digits==='volume'?compactLabel(flowRow?.[key]):numberLabel(flowRow?.[key],digits))});
        }else if(cmfMode){
          const title=document.getElementById('pane-indicator-flow-title');
          if(title)title.textContent='CMF20 資金流'+(moneyFlowDivergencePair?.mode==='cmf'?' · 背離線':'');
          [['pane-indicator-flow-cmf','cmf',2],['pane-indicator-flow-cmf-close','close',2]].forEach(([id,key,digits])=>{const element=document.getElementById(id);if(element)element.textContent=latest?element.dataset.latest:numberLabel(flowRow?.[key],digits)});
        }
        ['flow','macd','rsi','kd'].forEach(key=>{const date=document.getElementById('pane-indicator-date-'+key);if(date)date.textContent=latest?(key==='flow'&&flowCursorRows.at(-1)?.time?dateLabel(flowCursorRows.at(-1).time):'最新'):key==='flow'&&flowPending?'盤中未完成':dateLabel(time)});
      };
      const compactLabel=value=>{if(value===null||value===undefined||value==='')return '—';const number=Number(value);if(!Number.isFinite(number))return '—';const abs=Math.abs(number);if(abs>=1e9)return (number/1e9).toFixed(2)+'B';if(abs>=1e6)return (number/1e6).toFixed(2)+'M';if(abs>=1e3)return (number/1e3).toFixed(2)+'K';return number.toFixed(0)};
      const showReadout=(id,value)=>{const element=document.getElementById(id);if(!element)return;element.textContent=value;element.style.display='block'};
      const hideReadouts=()=>readoutIds.forEach(id=>{const element=document.getElementById(id);if(element)element.style.display='none'});
      const updateCursorReadouts=time=>{
        const key=timeKey(time),row=cursorByTime.get(key);
        scheduleRightIndicatorLabels();
        updateIndicatorLegend(row,key);
        updatePaneIndicatorLegends(row,key);
        if(!row){hideReadouts();return}
        const date=dateLabel(key);
        if(${layers.flow}){
          const obvMode=activeFlowMode==='obv';
          const mfiMode=activeFlowMode==='mfi';
          const cmfMode=activeFlowMode==='cmf';
          const flowRow=flowCursorByTime.get(key);
          const flowPending=!flowRow&&Boolean(provisionalFlowDate&&String(key)>=provisionalFlowDate);
          if(${isTaiwanMarket}){
            if(flowPending)showReadout('flowCursor',date+'  盤中未完成，資金流待收盤');
            else if(mfiMode)showReadout('flowCursor',date+'  MFI '+numberLabel(flowRow?.mfi,1)+'  ｜ 股價 '+numberLabel(flowRow?.close));
            else if(obvMode)showReadout('flowCursor',date+'  OBV '+compactLabel(flowRow?.obv)+'  ｜ 收盤 '+numberLabel(flowRow?.close));
            else if(cmfMode)showReadout('flowCursor',date+'  CMF20 '+numberLabel(flowRow?.cmf)+'  ｜ 收盤 '+numberLabel(flowRow?.close));
            else{const flow=institutionalCursorByTime.get(key),flowNames={foreign:'外資',trust:'投信',dealer:'自營商',all:'三大法人',directional:'外資＋投信'};showReadout('flowCursor',date+'  '+flowNames[activeFlowMode]+' '+(flow&&flow.available?compactLabel(flow[activeFlowMode]):'無資料')+' 股  ｜ 收盤 '+numberLabel(flowRow?.close))}
          }else if(flowPending)showReadout('flowCursor',date+'  盤中未完成，資金流待收盤');
          else if(mfiMode)showReadout('flowCursor',date+'  MFI '+numberLabel(flowRow?.mfi,1)+'  ｜ 股價 '+numberLabel(flowRow?.close));
          else if(cmfMode)showReadout('flowCursor',date+'  CMF20 '+numberLabel(flowRow?.cmf)+'  ｜ 收盤 '+numberLabel(flowRow?.close));
          else showReadout('flowCursor',date+'  OBV '+compactLabel(flowRow?.obv)+'  ｜ 收盤 '+numberLabel(flowRow?.close));
        }
      };
      const synchronizedCrosshairX=(chart,time)=>{const x=chart.timeScale().timeToCoordinate(time);if(!Number.isFinite(x))return null;let leftScaleWidth=0;try{leftScaleWidth=Number(chart.priceScale('left').width())||0}catch(error){}return x+leftScaleWidth};
      let synchronizedCrosshairKey='';const clearSynchronizedCrosshair=()=>{synchronizedCrosshairKey='';synchronizedCrosshairLines.forEach(({line})=>{line.style.display='none'})};const syncCrosshair=param=>{const key=timeKey(param.time);if(!key){clearSynchronizedCrosshair();return}const row=cursorByTime.get(key);if(!row){clearSynchronizedCrosshair();return}synchronizedCrosshairKey=key;synchronizedCrosshairLines.forEach(({chart,line})=>{const x=synchronizedCrosshairX(chart,key);if(Number.isFinite(x)){line.style.left=x+'px';line.style.display='block'}else line.style.display='none'})};
      let pinnedCrosshairKey='';
      const handleCrosshairMove=param=>{const key=timeKey(param.time);if(key){pinnedCrosshairKey=key;updateCursorReadouts(param.time);syncCrosshair(param)}else if(!pinnedCrosshairKey){updateCursorReadouts(undefined);syncCrosshair(param)}};
      const clearPinnedCrosshair=()=>{pinnedCrosshairKey='';updateCursorReadouts(undefined);syncCrosshair({time:undefined})};
      const handleChartClick=param=>{const key=timeKey(param.time);if(key&&isDataClick(param)){pinnedCrosshairKey=key;updateCursorReadouts(param.time);syncCrosshair(param)}else clearPinnedCrosshair()};
      linkedCharts.forEach(chart=>{chart.subscribeCrosshairMove(handleCrosshairMove);chart.subscribeClick(handleChartClick)});
      document.body.addEventListener('click',event=>{if(!event.target?.closest?.('canvas'))clearPinnedCrosshair()});
      const sameVisibleLogicalRange=(first,second)=>Boolean(first&&second&&Number.isFinite(Number(first.from))&&Number.isFinite(Number(first.to))&&Number.isFinite(Number(second.from))&&Number.isFinite(Number(second.to))&&Math.abs(Number(first.from)-Number(second.from))<.001&&Math.abs(Number(first.to)-Number(second.to))<.001);const pendingVisibleLogicalRanges=new Map();const pendingVisibleLogicalRangeTimers=new Map();const clearPendingVisibleLogicalRange=chart=>{pendingVisibleLogicalRanges.delete(chart);const timer=pendingVisibleLogicalRangeTimers.get(chart);if(timer!=null){clearTimeout(timer);pendingVisibleLogicalRangeTimers.delete(chart)}};const markPendingVisibleLogicalRange=(chart,range)=>{clearPendingVisibleLogicalRange(chart);pendingVisibleLogicalRanges.set(chart,range);pendingVisibleLogicalRangeTimers.set(chart,setTimeout(()=>{if(pendingVisibleLogicalRanges.get(chart)===range)pendingVisibleLogicalRanges.delete(chart);pendingVisibleLogicalRangeTimers.delete(chart)},300))};const applyVisibleLogicalRange=(chart,range)=>{if(typeof chart.timeScale().setVisibleLogicalRange!=='function')return;const current=typeof chart.timeScale().getVisibleLogicalRange==='function'?chart.timeScale().getVisibleLogicalRange():null;if(sameVisibleLogicalRange(current,range)){clearPendingVisibleLogicalRange(chart);return}markPendingVisibleLogicalRange(chart,range);try{chart.timeScale().setVisibleLogicalRange(range)}catch(error){clearPendingVisibleLogicalRange(chart)}};const syncVisibleLogicalRange=(source,callbackRange)=>{if(!source||typeof source.timeScale().getVisibleLogicalRange!=='function')return;const range=callbackRange||source.timeScale().getVisibleLogicalRange();if(!range)return;const pendingRange=pendingVisibleLogicalRanges.get(source);if(pendingRange&&sameVisibleLogicalRange(pendingRange,range)){clearPendingVisibleLogicalRange(source);return}clearPendingVisibleLogicalRange(source);linkedCharts.forEach(target=>{if(target!==source)applyVisibleLogicalRange(target,range)})};const validVisibleRange=range=>Boolean(range&&Number.isFinite(Number(range.from))&&Number.isFinite(Number(range.to))&&Number(range.to)>Number(range.from));const publishVisibleRange=range=>{if(!validVisibleRange(range))return;const payload={source:'wealthtracker-technical-chart',type:'visibleLogicalRange',key:${safeJson(resolvedViewportKey)},range:{from:Number(range.from),to:Number(range.to)}};try{if(window.ReactNativeWebView?.postMessage)window.ReactNativeWebView.postMessage(JSON.stringify(payload));else if(window.parent!==window)window.parent.postMessage(payload,'*')}catch(error){}};const initialVisibleRange=${safeJson(savedVisibleRange)};linkedCharts.forEach(source=>{source.timeScale().subscribeVisibleLogicalRangeChange(range=>{syncVisibleLogicalRange(source,range);publishVisibleRange(range)})});syncVisibleLogicalRange(priceChart);
      const resizeCharts=()=>{priceChart.applyOptions({width:priceWidth()});if(flowChart)flowChart.applyOptions({width:chartWidth('flow')});if(macdChart)macdChart.applyOptions({width:chartWidth('macd')});if(rsiChart)rsiChart.applyOptions({width:chartWidth('rsi')});if(kdChart)kdChart.applyOptions({width:chartWidth('kd')});syncVisibleLogicalRange(priceChart);if(synchronizedCrosshairKey)requestAnimationFrame(()=>syncCrosshair({time:synchronizedCrosshairKey}));refreshGapZones();refreshCandlestickBoxes();scheduleStrategyRegions();scheduleRightIndicatorLabels()};resizeCharts();requestAnimationFrame(()=>requestAnimationFrame(()=>{if(validVisibleRange(initialVisibleRange)){try{priceChart.timeScale().setVisibleLogicalRange(initialVisibleRange)}catch(error){syncVisibleLogicalRange(priceChart)}}else syncVisibleLogicalRange(priceChart)}));addEventListener('resize',()=>{resizeCharts();scheduleVolumeProfile();scheduleStrategyRegions();scheduleStrategyAnnotations();refreshGapZones();refreshCandlestickBoxes();scheduleRightIndicatorLabels()});</script></body></html>`;
  }, [analysis, colors, averageCost, layers, selectedStrategy, selectedStrategies, showCorporateActions, corporateActions, showFinancialReports, financialReports, liveQuote, atrPosition, exitManagement, entryScaling, marketType, institutionalRows, periodKey, resolvedViewportKey, savedVisibleRange]);

  const height = 390 + indicatorLegendHeight + (selectedStrategy === 'trend-market-structure' ? 156 : 0) + (layers.flow ? FLOW_PANE_HEIGHT : 0) + (layers.macd ? 150 : 0) + (layers.rsi ? 140 : 0) + (layers.kd ? 140 : 0);
  if (Platform.OS === 'web') {
    return React.createElement('iframe', {
      ref: iframeRef,
      title: 'K 線技術圖',
      srcDoc: html,
      style: { width: '100%', height, border: 0, display: 'block', backgroundColor: colors.card },
      sandbox: 'allow-scripts',
    });
  }
  return <WebView style={{ height, backgroundColor: colors.card }} source={{ html }} javaScriptEnabled domStorageEnabled originWhitelist={['*']} scrollEnabled={false} bounces={false} overScrollMode="never" onMessage={event => saveVisibleRange(event.nativeEvent?.data)} />;
}
