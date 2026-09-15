import React, { useMemo } from 'react';
import { Platform } from 'react-native';
import { WebView } from 'react-native-webview';

const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
const MA_COLORS = {
  ma5: '#FBBF24',
  ma10: '#C084FC',
  ma20: '#2DD4BF',
  ma60: '#38BDF8',
};

export default function TechnicalAnalysisChart({ analysis, colors, averageCost, layers, selectedStrategy = 'divergence', liveQuote = null, atrPosition = null }) {
  const html = useMemo(() => {
    const rows = analysis.rows;
    const candles = rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
    const currentPrice = Number(liveQuote?.price || 0);
    const hasLivePrice = currentPrice > 0;
    const quoteDate = String(liveQuote?.candleDate || liveQuote?.time || '').slice(0, 10);
    const priorClose = Number(candles.at(-1)?.close || currentPrice);
    const quoteOpen = Number(liveQuote?.open) > 0 ? Number(liveQuote.open) : priorClose;
    const quoteHigh = Number(liveQuote?.high) > 0 ? Math.max(Number(liveQuote.high), quoteOpen, currentPrice) : Math.max(quoteOpen, currentPrice);
    const quoteLow = Number(liveQuote?.low) > 0 ? Math.min(Number(liveQuote.low), quoteOpen, currentPrice) : Math.min(quoteOpen, currentPrice);
    const quoteCandle = quoteDate && hasLivePrice
      ? { time: quoteDate, open: quoteOpen, high: quoteHigh, low: quoteLow, close: currentPrice }
      : null;
    const chartCandles = quoteCandle && quoteCandle.time > candles.at(-1)?.time ? [...candles, quoteCandle] : candles;
    const volumes = rows.map(row => ({ time: row.time, value: row.volume, color: row.close >= row.open ? `${colors.positive}99` : `${colors.negative}99` }));
    const ma5 = rows.filter(row => row.ma5 != null).map(row => ({ time: row.time, value: row.ma5 }));
    const ma10 = rows.filter(row => row.ma10 != null).map(row => ({ time: row.time, value: row.ma10 }));
    const ma20 = rows.filter(row => row.ma20 != null).map(row => ({ time: row.time, value: row.ma20 }));
    const ma60 = rows.filter(row => row.ma60 != null).map(row => ({ time: row.time, value: row.ma60 }));
    const macd = rows.map(row => ({ time: row.time, value: row.macd }));
    const signal = rows.map(row => ({ time: row.time, value: row.macdSignal }));
    const histogram = rows.map(row => ({ time: row.time, value: row.macdHistogram, color: row.macdHistogram >= 0 ? `${colors.positive}B8` : `${colors.negative}B8` }));
    const rsi = rows.filter(row => row.rsi != null).map(row => ({ time: row.time, value: row.rsi }));
    const kValues = rows.filter(row => row.k != null).map(row => ({ time: row.time, value: row.k }));
    const dValues = rows.filter(row => row.d != null).map(row => ({ time: row.time, value: row.d }));
    const profileRows = layers.volumeProfile
      ? rows.map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume }))
      : [];
    const showStrategy = key => selectedStrategy === key;
    const strategies = analysis.strategies || [];
    const strategyByKey = key => strategies.find(item => item.key === key);
    const activeDivergence = showStrategy('divergence') ? analysis.divergences.filter(item => item.status === 'confirmed' || item.status === 'pending').at(-1) : null;
    const divergencePairs = showStrategy('divergence') ? analysis.divergences.map(item => ({
      type: item.type,
      previousTime: item.previousTime,
      previousPrice: item.previousPrice,
      previousMacd: item.previousMacd,
      time: item.time,
      price: item.price,
      macd: item.macd,
    })) : [];
    const divergenceMarkers = showStrategy('divergence') ? analysis.divergences.flatMap(item => {
      const bullish = item.type === 'bullish';
      const candidateLabel = item.status === 'expired'
        ? `${bullish ? '多' : '空'}背離逾期`
        : `${bullish ? '多' : '空'}背離候選`;
      const result = [
        { time: item.previousTime, position: bullish ? 'belowBar' : 'aboveBar', color: bullish ? colors.positive : colors.negative, shape: 'circle', text: bullish ? '背離低點 1' : '背離高點 1' },
        { time: item.time, position: bullish ? 'belowBar' : 'aboveBar', color: bullish ? colors.positive : colors.negative, shape: bullish ? 'arrowUp' : 'arrowDown', text: `${bullish ? '低點 2 · ' : '高點 2 · '}${candidateLabel}` },
      ];
      if (item.confirmationTime) result.push({ time: item.confirmationTime, position: bullish ? 'belowBar' : 'aboveBar', color: bullish ? colors.positive : colors.negative, shape: bullish ? 'arrowUp' : 'arrowDown', text: bullish ? '偏多確認' : '偏空確認' });
      if (item.invalidationTime) result.push({ time: item.invalidationTime, position: bullish ? 'belowBar' : 'aboveBar', color: colors.textMuted, shape: 'circle', text: `${bullish ? '多' : '空'}背離失效` });
      return result;
    }) : [];
    const markerForEvent = (event, fallback) => ({
      time: event.confirmationTime || event.time,
      position: event.type === 'bearish' ? 'aboveBar' : 'belowBar',
      color: event.status === 'invalidated' || event.status === 'expired' || event.status === 'stale'
        ? colors.textMuted : event.type === 'bearish' ? colors.negative : event.status === 'confirmed' ? colors.positive : colors.warning,
      shape: event.type === 'bearish' ? 'arrowDown' : 'arrowUp',
      text: event.text || fallback,
    });
    const withInvalidation = (events, fallback) => events.flatMap(item => {
      const result = [markerForEvent(item, fallback)];
      if (item.invalidationTime) result.push({ time: item.invalidationTime, position: item.type === 'bearish' ? 'belowBar' : 'aboveBar', color: colors.textMuted, shape: 'circle', text: item.text || '訊號失效' });
      return result;
    });
    const pullbackMarkers = showStrategy('pullback') ? withInvalidation((strategyByKey('pullback')?.events || []).slice(-5), '趨勢回檔') : [];
    const breakoutMarkers = showStrategy('breakout') ? withInvalidation((strategyByKey('breakout')?.events || []).slice(-5), '放量突破') : [];
    const rsiMarkers = showStrategy('rsi') ? (strategyByKey('rsi')?.events || []).slice(-5).map(item => markerForEvent(item, 'RSI 反轉')) : [];
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
    const activeAtrPosition = atrPosition && ['active', 'risk', 'recovered'].includes(atrPosition.status) ? atrPosition : null;
    const requestedHybridMarkerTime = activeAtrPosition?.entry_date || analysis.latest.time;
    const hybridMarkerTime = candles.some(item => item.time === requestedHybridMarkerTime) ? requestedHybridMarkerTime : null;
    const hybridMarker = selectedStrategy === 'ALL' && hybridMarkerTime && (activeAtrPosition || analysis.hybrid?.status === 'confirmed')
      ? [{ time: hybridMarkerTime, position: 'belowBar', color: colors.positive, shape: 'arrowUp', text: activeAtrPosition ? '混合策略進場' : `混合 BUY · ${analysis.hybrid.route === 'breakout' ? '突破' : '回檔'}` }]
      : [];
    const estimatedAtrStop = Number(analysis.hybrid?.risk?.initialStop || 0);
    const atrOverlay = selectedStrategy === 'ALL' && layers.atr ? {
      entry: Number(activeAtrPosition?.entry_price || (analysis.hybrid?.status === 'confirmed' ? analysis.hybrid?.risk?.entryPrice : 0)),
      initial: Number(activeAtrPosition?.initial_stop || (analysis.hybrid?.status === 'confirmed' ? analysis.hybrid?.risk?.initialStop : 0)),
      trailing: Number(activeAtrPosition?.trailing_stop || 0),
      effective: Number(activeAtrPosition?.effective_stop || 0),
      estimated: !activeAtrPosition && analysis.hybrid?.status !== 'confirmed' ? estimatedAtrStop : 0,
      atr14: Number(activeAtrPosition?.entry_atr || analysis.hybrid?.risk?.atr14 || 0),
    } : null;
    const markers = [...divergenceMarkers, ...pullbackMarkers, ...breakoutMarkers, ...rsiMarkers, ...boundaryMarkers, ...smcMarkers, ...hybridMarker]
      .sort((a, b) => a.time.localeCompare(b.time));
    const selected = selectedStrategy === 'ALL' ? null : strategyByKey(selectedStrategy);
    const requiresCurrentSignal = selectedStrategy === 'boundary' || selectedStrategy === 'smc';
    const selectedEvent = requiresCurrentSignal
      ? selected?.signal
      : selected?.signal || selected?.events?.filter(item => item.status === 'confirmed' || item.status === 'watch').at(-1) || selected?.events?.at(-1) || selected;
    const boundaryLevels = showStrategy('boundary') ? strategyByKey('boundary')?.levels : null;
    const smcLevels = showStrategy('smc') ? strategyByKey('smc')?.levels : null;
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>
      *{box-sizing:border-box}html,body{margin:0;background:${colors.card};color:${colors.text};font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden}.pane{position:relative}#priceRow{display:flex;width:100%;height:390px}#price{height:390px;min-width:0;flex:1}#macd{height:150px;border-top:1px solid ${colors.border}}#rsi,#kd{height:140px;border-top:1px solid ${colors.border}}#label{position:absolute;z-index:5;left:10px;top:8px;font-size:11px;color:${colors.textSub};background:${colors.card}E6;padding:5px 8px;border:1px solid ${colors.border};border-radius:7px;pointer-events:none}.maKey{font-weight:800}.atrLegend{position:absolute;z-index:6;left:10px;top:42px;display:flex;flex-wrap:wrap;gap:5px 9px;max-width:calc(100% - 128px);padding:6px 8px;border:1px solid ${colors.border};border-radius:8px;background:${colors.card}EB;pointer-events:none}.atrLegendItem{display:flex;align-items:center;gap:4px;font-size:8px;color:${colors.textSub};white-space:nowrap}.atrLegendLine{width:12px;height:2px;border-radius:2px}.atrLegendValue{color:${colors.text};font-weight:700}.indicatorLabel{position:absolute;left:10px;top:6px;z-index:5;color:${colors.textSub};font-size:10px;pointer-events:none}#profilePane{position:relative;flex:none;width:104px;height:390px;border-left:1px solid ${colors.border};background:${colors.cardAlt || colors.card};overflow:hidden}#volumeProfile{position:absolute;left:6px;right:6px;top:30px;bottom:68px;pointer-events:none;overflow:hidden}.profileBar{position:absolute;right:0;min-width:2px;border-radius:3px 0 0 3px;opacity:.58}.profileTitle{position:absolute;z-index:5;left:7px;right:5px;top:8px;font-size:8px;line-height:12px;color:${colors.textMuted};white-space:nowrap;pointer-events:none}.profileLevel{position:absolute;left:3px;right:3px;height:1px;border-top:1px dashed}.profileLevelLabel{position:absolute;right:0;top:-8px;padding:1px 3px;border-radius:4px;font-size:7px;font-weight:800;color:${colors.card};line-height:11px}</style></head><body>
      <div class="pane"><div id="label">K線 · <span class="maKey" style="color:${MA_COLORS.ma5}">MA5</span> · <span class="maKey" style="color:${MA_COLORS.ma10}">MA10</span> · <span class="maKey" style="color:${MA_COLORS.ma20}">MA20</span> · <span class="maKey" style="color:${MA_COLORS.ma60}">MA60</span>${quoteCandle && quoteCandle.time > candles.at(-1)?.time ? ` · ${quoteCandle.time} 盤中暫估` : hasLivePrice ? ` · ${liveQuote?.isLive ? '盤中' : '最新'} ${currentPrice.toFixed(2)}` : ''}</div>${atrOverlay ? `<div class="atrLegend">${atrOverlay.atr14 > 0 ? `<div class="atrLegendItem">ATR14 <span class="atrLegendValue">${atrOverlay.atr14.toFixed(2)}</span></div>` : ''}${atrOverlay.entry > 0 ? `<div class="atrLegendItem"><i class="atrLegendLine" style="background:${colors.accent}"></i>進場</div>` : ''}${atrOverlay.initial > 0 ? `<div class="atrLegendItem"><i class="atrLegendLine" style="background:${colors.negative}"></i>初始停損</div>` : ''}${atrOverlay.trailing > 0 || atrOverlay.effective > 0 ? `<div class="atrLegendItem"><i class="atrLegendLine" style="background:${colors.warning}"></i>移動／有效停損</div>` : ''}${atrOverlay.estimated > 0 ? `<div class="atrLegendItem"><i class="atrLegendLine" style="background:${colors.textMuted}"></i>預估 2ATR</div>` : ''}</div>` : ''}<div id="priceRow"><div id="price"></div>${layers.volumeProfile ? '<div id="profilePane"><div class="profileTitle">量價分佈・日 K 推估</div><div id="volumeProfile"></div></div>' : ''}</div></div>
      <div class="pane" style="display:${layers.macd ? 'block' : 'none'}"><div class="indicatorLabel">MACD (12, 26, 9)</div><div id="macd"></div></div>
      <div class="pane" style="display:${layers.rsi ? 'block' : 'none'}"><div class="indicatorLabel">RSI (14) · 70 超買 · 30 超賣</div><div id="rsi"></div></div>
      <div class="pane" style="display:${layers.kd ? 'block' : 'none'}"><div class="indicatorLabel">KD (9, 3, 3) · 80 超買 · 20 超賣</div><div id="kd"></div></div>
      <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script><script>
      const C=${safeJson(colors)}, M=${safeJson(MA_COLORS)}, candles=${safeJson(chartCandles)}, volumes=${safeJson(volumes)}, ma5=${safeJson(ma5)}, ma10=${safeJson(ma10)}, ma20=${safeJson(ma20)}, ma60=${safeJson(ma60)}, macd=${safeJson(macd)}, signal=${safeJson(signal)}, histogram=${safeJson(histogram)}, rsi=${safeJson(rsi)}, kValues=${safeJson(kValues)}, dValues=${safeJson(dValues)}, markers=${safeJson(markers)}, divergencePairs=${safeJson(divergencePairs)}, profileRows=${safeJson(profileRows)};
      const common={layout:{background:{color:C.card},textColor:C.textSub},grid:{vertLines:{color:C.borderLight},horzLines:{color:C.borderLight}},rightPriceScale:{borderColor:C.border},timeScale:{borderColor:C.border,timeVisible:false},crosshair:{mode:LightweightCharts.CrosshairMode.Normal},handleScroll:true,handleScale:true};
      const priceWidth=()=>document.getElementById('price').clientWidth||innerWidth;
      const priceChart=LightweightCharts.createChart(document.getElementById('price'),{...common,width:priceWidth(),height:390,rightPriceScale:{...common.rightPriceScale,scaleMargins:{top:.08,bottom:.24}}});
      const candle=priceChart.addCandlestickSeries({upColor:C.positive,downColor:C.negative,borderVisible:false,wickUpColor:C.positive,wickDownColor:C.negative});candle.setData(candles);candle.setMarkers(markers);
      ${layers.ma ? `const m5=priceChart.addLineSeries({color:M.ma5,lineWidth:1,title:'MA5'});m5.setData(ma5);const m10=priceChart.addLineSeries({color:M.ma10,lineWidth:1,title:'MA10'});m10.setData(ma10);const m20=priceChart.addLineSeries({color:M.ma20,lineWidth:1,title:'MA20'});m20.setData(ma20);const m60=priceChart.addLineSeries({color:M.ma60,lineWidth:1,title:'MA60'});m60.setData(ma60);` : ''}
      ${layers.volume ? `const volume=priceChart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:''});volume.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0}});volume.setData(volumes);` : ''}
      ${layers.levels ? analysis.supports.map((level, index) => `candle.createPriceLine({price:${level.price},color:C.positive,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'S${index + 1}'});`).join('') : ''}
      ${layers.levels ? analysis.resistances.map((level, index) => `candle.createPriceLine({price:${level.price},color:C.negative,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'R${index + 1}'});`).join('') : ''}
      ${activeDivergence ? `candle.createPriceLine({price:${activeDivergence.neckline},color:C.warning,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'${activeDivergence.type === 'bullish' ? '多方確認線' : '空方確認線'}'});` : ''}
      ${atrOverlay?.entry > 0 ? `candle.createPriceLine({price:${atrOverlay.entry},color:C.accent,lineWidth:2,lineStyle:1,axisLabelVisible:true,title:'混合進場'});` : ''}
      ${atrOverlay?.initial > 0 ? `candle.createPriceLine({price:${atrOverlay.initial},color:C.negative,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'ATR 初始停損'});` : ''}
      ${atrOverlay?.trailing > 0 ? `candle.createPriceLine({price:${atrOverlay.trailing},color:C.warning,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'ATR 移動停損'});` : ''}
      ${atrOverlay?.effective > 0 && atrOverlay.effective !== atrOverlay.trailing ? `candle.createPriceLine({price:${atrOverlay.effective},color:C.warning,lineWidth:3,lineStyle:1,axisLabelVisible:true,title:'目前有效停損'});` : ''}
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
      ${averageCost > 0 ? `candle.createPriceLine({price:${Number(averageCost)},color:C.accent,lineWidth:2,lineStyle:1,axisLabelVisible:true,title:'成本'});` : ''}
      ${hasLivePrice ? `candle.createPriceLine({price:${currentPrice},color:C.accent,lineWidth:2,lineStyle:2,axisLabelVisible:true,title:'${liveQuote?.isLive ? '盤中價' : '最新價'}'});` : ''}
      divergencePairs.forEach((item,index)=>{const bullish=item.type==='bullish';const line=priceChart.addLineSeries({color:bullish?C.positive:C.negative,lineWidth:2,lineStyle:2,lastValueVisible:false,priceLineVisible:false,title:''});line.setData([{time:item.previousTime,value:item.previousPrice},{time:item.time,value:item.price}]);});
      priceChart.timeScale().fitContent();
      const buildVisibleProfile=(rows,binCount=42)=>{if(!rows.length)return null;const min=Math.min(...rows.map(row=>Number(row.low))),max=Math.max(...rows.map(row=>Number(row.high))),step=(max-min)/binCount;if(!(step>0))return null;const bins=Array.from({length:binCount},(_,index)=>({lower:min+index*step,upper:min+(index+1)*step,volume:0,upVolume:0,downVolume:0}));rows.forEach(row=>{const from=Math.max(0,Math.min(binCount-1,Math.floor((row.low-min)/step))),to=Math.max(from,Math.min(binCount-1,Math.floor((row.high-min)/step))),typical=(Number(row.high)+Number(row.low)+Number(row.close))/3,weights=[];let totalWeight=0;for(let index=from;index<=to;index+=1){const center=(bins[index].lower+bins[index].upper)/2,weight=1/(1+Math.abs(center-typical)/step);weights.push([index,weight]);totalWeight+=weight}weights.forEach(pair=>{const allocated=Number(row.volume||0)*pair[1]/totalWeight,b=bins[pair[0]];b.volume+=allocated;if(row.close>=row.open)b.upVolume+=allocated;else b.downVolume+=allocated})});const total=bins.reduce((sum,bin)=>sum+bin.volume,0),pocIndex=bins.reduce((best,bin,index)=>bin.volume>bins[best].volume?index:best,0);let lowIndex=pocIndex,highIndex=pocIndex,valueAreaVolume=bins[pocIndex].volume;while(valueAreaVolume<total*.7&&(lowIndex>0||highIndex<bins.length-1)){const below=lowIndex>0?bins[lowIndex-1].volume:-1,above=highIndex<bins.length-1?bins[highIndex+1].volume:-1;if(above>=below){highIndex+=1;valueAreaVolume+=bins[highIndex].volume}else{lowIndex-=1;valueAreaVolume+=bins[lowIndex].volume}}return{bins,maxVolume:Math.max(...bins.map(bin=>bin.volume)),poc:(bins[pocIndex].lower+bins[pocIndex].upper)/2,vah:bins[highIndex].upper,val:bins[lowIndex].lower}};
      const visibleProfileRows=()=>{const range=priceChart.timeScale().getVisibleLogicalRange();if(!range)return profileRows;const from=Math.max(0,Math.floor(range.from)),to=Math.min(profileRows.length-1,Math.ceil(range.to));return profileRows.slice(from,to+1)};
      let profileFrame=null;const renderVolumeProfile=()=>{profileFrame=null;const host=document.getElementById('volumeProfile');if(!host)return;host.innerHTML='';const volumeProfile=buildVisibleProfile(visibleProfileRows());if(!volumeProfile||!volumeProfile.maxVolume)return;volumeProfile.bins.forEach(bin=>{const top=candle.priceToCoordinate(bin.upper),bottom=candle.priceToCoordinate(bin.lower);if(top==null||bottom==null)return;const bar=document.createElement('div');bar.className='profileBar';bar.style.top=Math.max(0,top-30)+'px';bar.style.height=Math.max(2,bottom-top)+'px';bar.style.width=Math.max(2,bin.volume/volumeProfile.maxVolume*100)+'%';const up=bin.volume?bin.upVolume/bin.volume*100:50;bar.style.background='linear-gradient(to left,'+C.positive+' 0%,'+C.positive+' '+up+'%,'+C.negative+' '+up+'%,'+C.negative+' 100%)';host.appendChild(bar)});[['VAH',volumeProfile.vah,C.textMuted],['POC',volumeProfile.poc,C.warning],['VAL',volumeProfile.val,C.textMuted]].forEach(item=>{const y=candle.priceToCoordinate(item[1]);if(y==null)return;const level=document.createElement('div');level.className='profileLevel';level.style.top=Math.max(0,y-30)+'px';level.style.borderColor=item[2];const label=document.createElement('span');label.className='profileLevelLabel';label.style.background=item[2];label.textContent=item[0];level.appendChild(label);host.appendChild(level)})};
      const scheduleVolumeProfile=()=>{if(profileFrame!=null)cancelAnimationFrame(profileFrame);profileFrame=requestAnimationFrame(renderVolumeProfile)};
      scheduleVolumeProfile();priceChart.timeScale().subscribeVisibleLogicalRangeChange(scheduleVolumeProfile);
      const priceHost=document.getElementById('price');priceHost.addEventListener('wheel',scheduleVolumeProfile,{passive:true});priceHost.addEventListener('touchmove',scheduleVolumeProfile,{passive:true});priceHost.addEventListener('pointermove',event=>{if(event.buttons)scheduleVolumeProfile()},{passive:true});
      const linkedCharts=[priceChart];
      let macdChart=null;if(${layers.macd}){macdChart=LightweightCharts.createChart(document.getElementById('macd'),{...common,width:innerWidth,height:150,rightPriceScale:{...common.rightPriceScale,scaleMargins:{top:.16,bottom:.12}}});const hist=macdChart.addHistogramSeries({priceScaleId:'right'});hist.setData(histogram);const dif=macdChart.addLineSeries({color:C.chartPalette[1]||C.accent,lineWidth:1,title:'DIF'});dif.setData(macd);const sig=macdChart.addLineSeries({color:C.warning,lineWidth:1,title:'Signal'});sig.setData(signal);divergencePairs.forEach(item=>{const bullish=item.type==='bullish';const line=macdChart.addLineSeries({color:bullish?C.positive:C.negative,lineWidth:2,lineStyle:2,lastValueVisible:false,priceLineVisible:false,title:''});line.setData([{time:item.previousTime,value:item.previousMacd},{time:item.time,value:item.macd}]);});linkedCharts.push(macdChart);macdChart.timeScale().fitContent();}
      let rsiChart=null;if(${layers.rsi}){rsiChart=LightweightCharts.createChart(document.getElementById('rsi'),{...common,width:innerWidth,height:140,rightPriceScale:{...common.rightPriceScale,scaleMargins:{top:.12,bottom:.12}}});const rsiLine=rsiChart.addLineSeries({color:C.accent,lineWidth:2,title:'RSI14',priceFormat:{type:'price',precision:1,minMove:.1},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});rsiLine.setData(rsi);rsiLine.createPriceLine({price:70,color:C.negative,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'70'});rsiLine.createPriceLine({price:30,color:C.positive,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'30'});linkedCharts.push(rsiChart);rsiChart.timeScale().fitContent();}
      let kdChart=null;if(${layers.kd}){kdChart=LightweightCharts.createChart(document.getElementById('kd'),{...common,width:innerWidth,height:140,rightPriceScale:{...common.rightPriceScale,scaleMargins:{top:.12,bottom:.12}}});const kLine=kdChart.addLineSeries({color:C.accent,lineWidth:2,title:'K',priceFormat:{type:'price',precision:1,minMove:.1},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});kLine.setData(kValues);const dLine=kdChart.addLineSeries({color:C.warning,lineWidth:2,title:'D',priceFormat:{type:'price',precision:1,minMove:.1}});dLine.setData(dValues);kLine.createPriceLine({price:80,color:C.negative,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'80'});kLine.createPriceLine({price:20,color:C.positive,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'20'});linkedCharts.push(kdChart);kdChart.timeScale().fitContent();}
      let syncing=false;linkedCharts.forEach(source=>source.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(!range||syncing)return;syncing=true;linkedCharts.forEach(target=>{if(target!==source)target.timeScale().setVisibleLogicalRange(range)});syncing=false}));
      addEventListener('resize',()=>{priceChart.applyOptions({width:priceWidth()});linkedCharts.filter(chart=>chart!==priceChart).forEach(chart=>chart.applyOptions({width:innerWidth}));scheduleVolumeProfile()});</script></body></html>`;
  }, [analysis, colors, averageCost, layers, selectedStrategy, liveQuote, atrPosition]);

  const height = 390 + (layers.macd ? 150 : 0) + (layers.rsi ? 140 : 0) + (layers.kd ? 140 : 0);
  if (Platform.OS === 'web') {
    return React.createElement('iframe', {
      title: 'K 線技術圖',
      srcDoc: html,
      style: { width: '100%', height, border: 0, display: 'block', backgroundColor: colors.card },
      sandbox: 'allow-scripts',
    });
  }
  return <WebView style={{ height, backgroundColor: colors.card }} source={{ html }} javaScriptEnabled domStorageEnabled originWhitelist={['*']} scrollEnabled={false} />;
}
