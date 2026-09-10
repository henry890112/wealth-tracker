import React, { useMemo } from 'react';
import { WebView } from 'react-native-webview';

const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');

export default function TechnicalAnalysisChart({ analysis, colors, averageCost, layers }) {
  const html = useMemo(() => {
    const rows = analysis.rows;
    const candles = rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
    const volumes = rows.map(row => ({ time: row.time, value: row.volume, color: row.close >= row.open ? `${colors.positive}99` : `${colors.negative}99` }));
    const ma20 = rows.filter(row => row.ma20 != null).map(row => ({ time: row.time, value: row.ma20 }));
    const ma60 = rows.filter(row => row.ma60 != null).map(row => ({ time: row.time, value: row.ma60 }));
    const macd = rows.map(row => ({ time: row.time, value: row.macd }));
    const signal = rows.map(row => ({ time: row.time, value: row.macdSignal }));
    const histogram = rows.map(row => ({ time: row.time, value: row.macdHistogram, color: row.macdHistogram >= 0 ? `${colors.positive}B8` : `${colors.negative}B8` }));
    const rsi = rows.filter(row => row.rsi != null).map(row => ({ time: row.time, value: row.rsi }));
    const activeDivergence = analysis.divergences.filter(item => item.status === 'confirmed' || item.status === 'pending').at(-1);
    const divergencePairs = layers.macd ? analysis.divergences.map(item => ({
      type: item.type,
      previousTime: item.previousTime,
      previousPrice: item.previousPrice,
      previousMacd: item.previousMacd,
      time: item.time,
      price: item.price,
      macd: item.macd,
    })) : [];
    const divergenceMarkers = layers.macd ? analysis.divergences.flatMap(item => {
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
    const markers = [
      ...(layers.volume ? analysis.volumeSpikes.map(item => ({ time: item.time, position: 'aboveBar', color: colors.warning, shape: 'circle', text: `量 ${item.ratio.toFixed(1)}x` })) : []),
      ...divergenceMarkers,
    ].sort((a, b) => a.time.localeCompare(b.time));
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>
      *{box-sizing:border-box}html,body{margin:0;background:${colors.card};color:${colors.text};font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden}#price{height:390px}#macd{height:150px;border-top:1px solid ${colors.border}}#rsi{height:140px;border-top:1px solid ${colors.border}}#label{position:absolute;z-index:5;left:10px;top:8px;font-size:11px;color:${colors.textSub};background:${colors.card}E6;padding:5px 8px;border:1px solid ${colors.border};border-radius:7px;pointer-events:none}.pane{position:relative}.indicatorLabel{position:absolute;left:10px;top:6px;z-index:5;color:${colors.textSub};font-size:10px;pointer-events:none} </style></head><body>
      <div class="pane"><div id="label">K線 · MA20 · MA60</div><div id="price"></div></div>
      <div class="pane" style="display:${layers.macd ? 'block' : 'none'}"><div class="indicatorLabel">MACD (12, 26, 9)</div><div id="macd"></div></div>
      <div class="pane" style="display:${layers.rsi ? 'block' : 'none'}"><div class="indicatorLabel">RSI (14) · 70 超買 · 30 超賣</div><div id="rsi"></div></div>
      <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script><script>
      const C=${safeJson(colors)}, candles=${safeJson(candles)}, volumes=${safeJson(volumes)}, ma20=${safeJson(ma20)}, ma60=${safeJson(ma60)}, macd=${safeJson(macd)}, signal=${safeJson(signal)}, histogram=${safeJson(histogram)}, rsi=${safeJson(rsi)}, markers=${safeJson(markers)}, divergencePairs=${safeJson(divergencePairs)};
      const common={layout:{background:{color:C.card},textColor:C.textSub},grid:{vertLines:{color:C.borderLight},horzLines:{color:C.borderLight}},rightPriceScale:{borderColor:C.border},timeScale:{borderColor:C.border,timeVisible:false},crosshair:{mode:LightweightCharts.CrosshairMode.Normal},handleScroll:true,handleScale:true};
      const priceChart=LightweightCharts.createChart(document.getElementById('price'),{...common,width:innerWidth,height:390,rightPriceScale:{...common.rightPriceScale,scaleMargins:{top:.08,bottom:.24}}});
      const candle=priceChart.addCandlestickSeries({upColor:C.positive,downColor:C.negative,borderVisible:false,wickUpColor:C.positive,wickDownColor:C.negative});candle.setData(candles);candle.setMarkers(markers);
      ${layers.ma ? `const m20=priceChart.addLineSeries({color:C.chartPalette[1]||C.accent,lineWidth:2,title:'MA20'});m20.setData(ma20);const m60=priceChart.addLineSeries({color:C.chartPalette[2]||C.warning,lineWidth:2,title:'MA60'});m60.setData(ma60);` : ''}
      ${layers.volume ? `const volume=priceChart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:''});volume.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0}});volume.setData(volumes);` : ''}
      ${layers.levels ? analysis.supports.map((level, index) => `candle.createPriceLine({price:${level.price},color:C.positive,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'S${index + 1}'});`).join('') : ''}
      ${layers.levels ? analysis.resistances.map((level, index) => `candle.createPriceLine({price:${level.price},color:C.negative,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'R${index + 1}'});`).join('') : ''}
      ${layers.macd && activeDivergence ? `candle.createPriceLine({price:${activeDivergence.neckline},color:C.warning,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'${activeDivergence.type === 'bullish' ? '多方確認線' : '空方確認線'}'});` : ''}
      ${averageCost > 0 ? `candle.createPriceLine({price:${Number(averageCost)},color:C.accent,lineWidth:2,lineStyle:1,axisLabelVisible:true,title:'成本'});` : ''}
      divergencePairs.forEach((item,index)=>{const bullish=item.type==='bullish';const line=priceChart.addLineSeries({color:bullish?C.positive:C.negative,lineWidth:2,lineStyle:2,lastValueVisible:false,priceLineVisible:false,title:''});line.setData([{time:item.previousTime,value:item.previousPrice},{time:item.time,value:item.price}]);});
      priceChart.timeScale().fitContent();
      const linkedCharts=[priceChart];
      let macdChart=null;if(${layers.macd}){macdChart=LightweightCharts.createChart(document.getElementById('macd'),{...common,width:innerWidth,height:150,rightPriceScale:{...common.rightPriceScale,scaleMargins:{top:.16,bottom:.12}}});const hist=macdChart.addHistogramSeries({priceScaleId:'right'});hist.setData(histogram);const dif=macdChart.addLineSeries({color:C.chartPalette[1]||C.accent,lineWidth:1,title:'DIF'});dif.setData(macd);const sig=macdChart.addLineSeries({color:C.warning,lineWidth:1,title:'Signal'});sig.setData(signal);divergencePairs.forEach(item=>{const bullish=item.type==='bullish';const line=macdChart.addLineSeries({color:bullish?C.positive:C.negative,lineWidth:2,lineStyle:2,lastValueVisible:false,priceLineVisible:false,title:''});line.setData([{time:item.previousTime,value:item.previousMacd},{time:item.time,value:item.macd}]);});linkedCharts.push(macdChart);macdChart.timeScale().fitContent();}
      let rsiChart=null;if(${layers.rsi}){rsiChart=LightweightCharts.createChart(document.getElementById('rsi'),{...common,width:innerWidth,height:140,rightPriceScale:{...common.rightPriceScale,scaleMargins:{top:.12,bottom:.12}}});const rsiLine=rsiChart.addLineSeries({color:C.accent,lineWidth:2,title:'RSI14',priceFormat:{type:'price',precision:1,minMove:.1},autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});rsiLine.setData(rsi);rsiLine.createPriceLine({price:70,color:C.negative,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'70'});rsiLine.createPriceLine({price:30,color:C.positive,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'30'});linkedCharts.push(rsiChart);rsiChart.timeScale().fitContent();}
      let syncing=false;linkedCharts.forEach(source=>source.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(!range||syncing)return;syncing=true;linkedCharts.forEach(target=>{if(target!==source)target.timeScale().setVisibleLogicalRange(range)});syncing=false}));
      addEventListener('resize',()=>linkedCharts.forEach(chart=>chart.applyOptions({width:innerWidth})));</script></body></html>`;
  }, [analysis, colors, averageCost, layers]);

  const height = 390 + (layers.macd ? 150 : 0) + (layers.rsi ? 140 : 0);
  return <WebView style={{ height, backgroundColor: colors.card }} source={{ html }} javaScriptEnabled domStorageEnabled originWhitelist={['*']} scrollEnabled={false} />;
}
