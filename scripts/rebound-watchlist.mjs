import fs from 'node:fs/promises';
import {closeIndicators} from './rebound-close-indicators.mjs';
const root='research/semiconductor-rebound';
const manifest=JSON.parse(await fs.readFile(`${root}/manifest.json`,'utf8'));
const verified=JSON.parse(await fs.readFile(`${root}/verified-closes.json`,'utf8'));
const series=new Map();
for(const item of manifest.symbols){
  if(item.error)continue;
  const s=JSON.parse(await fs.readFile(`${root}/data/${item.file}`,'utf8')).chart.result[0],q=s.indicators.quote[0],adj=s.indicators.adjclose[0].adjclose;
  const rows=s.timestamp.map((t,i)=>{
    const date=new Date(t*1000).toISOString().slice(0,10),factor=q.close[i]>0&&adj[i]>0?adj[i]/q.close[i]:null;
    return {date,open:factor?q.open[i]*factor:null,high:factor?q.high[i]*factor:null,low:factor?q.low[i]*factor:null,close:adj[i]??verified[item.symbol]?.[date]?.close??null,volume:q.volume[i]};
  });
  series.set(item.symbol,rows);
}
const output={asOf:manifest.fetchedAt,notes:['Current snapshot only; not a backtested composite strategy','Breadth uses the current selected basket, not historic SOX membership','Taiwan and US sessions are evaluated separately; no same-date US-close to earlier Taiwan-close causal claim'],assets:[]};
const validClose=r=>Number.isFinite(r.close)&&r.close>0;
for(const [symbol,rows]of series){
  const tail=rows.slice(-201),last=rows.at(-1);
  const gaps=tail.filter(r=>!validClose(r));
  if(gaps.length){output.assets.push({symbol,date:last.date,available:false,missingDates:gaps.map(r=>r.date)});continue;}
  // Start at the last missing close. Do not silently join non-adjacent sessions.
  const start=rows.findLastIndex(r=>!validClose(r))+1,closes=rows.slice(start).map(r=>r.close);
  const indicators=closeIndicators(closes),c=indicators.at(-1),p=indicators.at(-2);
  const before=rows.slice(-4,-1),highsValid=before.every(r=>Number.isFinite(r.high)&&r.high>=r.close&&r.low<=r.close);
  const threshold=highsValid?Math.max(...before.map(r=>r.high)):null;
  const vols=rows.slice(-21,-1).map(r=>r.volume),volRatio=vols.every(v=>Number.isFinite(v)&&v>=0)&&vols.reduce((a,b)=>a+b,0)>0?last.volume/(vols.reduce((a,b)=>a+b,0)/20):null;
  const riskLowRows=rows.slice(-5),lowValid=riskLowRows.every(r=>Number.isFinite(r.low)&&r.low>0&&r.low<=r.close);
  let relative20QQQ=null;
  if(!symbol.endsWith('.TW')&&!symbol.endsWith('.TWO')){
    const benchmark=new Map(series.get('QQQ').map(r=>[r.date,r.close])),first=rows.at(-21),base=benchmark.get(first.date),end=benchmark.get(last.date);
    if(base>0&&end>0&&first.close>0)relative20QQQ=(last.close/first.close)/(end/base)-1;
  }
  const recentOversold=indicators.slice(-11,-1).some(r=>r.rsi<=30);
  const state=c.rsi<=30?'超賣觀察':recentOversold&&c.close>c.ma5&&threshold!=null&&c.close>threshold&&c.rsi>p.rsi?'反彈確認候選（未驗證綜合策略）':c.close<c.ma5?'尚未站回MA5':c.close<c.ma20?'短線回升，仍低於MA20':'高於MA5與MA20，不屬跌深反彈確認';
  output.assets.push({symbol,date:last.date,available:true,close:c.close,rsi:c.rsi,ma5:c.ma5,ma20:c.ma20,ma60:c.ma60,ma200:c.ma200,nextMA5:closes.slice(-4).reduce((a,b)=>a+b,0)/4,priorHigh3:threshold,fiveSessionLow:lowValid?Math.min(...riskLowRows.map(r=>r.low)):null,volumeRatio20:volRatio,relative20QQQ,aboveMA5:c.close>c.ma5,aboveMA20:c.close>c.ma20,rsiRising:c.rsi>p.rsi,recentOversold,state,warmupRows:closes.length});
}
const groups={usHeld:['KLAC','AVGO','QCOM','DRAM','CBRS'],taiwanSelected:['2330.TW','3711.TW','2454.TW','2337.TW','5347.TWO','6291.TWO','6488.TWO','2379.TW']};
output.breadth=Object.fromEntries(Object.entries(groups).map(([group,symbols])=>{const valid=output.assets.filter(a=>symbols.includes(a.symbol)&&a.available);return[group,{selected:symbols.length,usable:valid.length,aboveMA5:valid.filter(a=>a.aboveMA5).length,aboveMA20:valid.filter(a=>a.aboveMA20).length,excluded:symbols.filter(s=>!valid.some(a=>a.symbol===s))}];}));
await fs.writeFile(`${root}/watchlist.json`,JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
