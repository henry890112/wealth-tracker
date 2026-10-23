import {test} from 'node:test';
import assert from 'node:assert/strict';
import {closeIndicators} from '../scripts/rebound-close-indicators.mjs';
import {simulateEvents,summarizeEvents} from '../scripts/rebound-event-engine.mjs';
import fs from 'node:fs';
import {calculateRSI,calculateMA} from '../src/services/indicators.js';

const bars=()=>Array.from({length:12},(_,i)=>({originalIndex:i,date:`2024-01-${String(i+1).padStart(2,'0')}`,open:100,close:100,high:101,low:99,atr:2}));
const onlyFirst=(r)=>r.originalIndex===1;
const settings={warmup:1,horizon:3,cost:0};
test('Signal close is not an executable entry; use following open and correct horizon',()=>{
  const rs=bars();rs[1].close=50;rs[2].open=110;rs[4].close=121;
  const [t]=simulateEvents(rs,onlyFirst,settings);
  assert.equal(t.entry,110);assert.equal(t.exit,121);assert.equal(t.exitDate,'2024-01-05');assert.ok(Math.abs(t.netReturn-0.1)<1e-12);
});
test('Fees apply on both entry and exit',()=>{
  const [t]=simulateEvents(bars(),onlyFirst,{...settings,cost:0.003});
  assert.ok(Math.abs(t.netReturn-(0.997/1.003-1))<1e-12);
});
test('Trades do not overlap and signals on final incomplete horizons are ignored',()=>{
  const ts=simulateEvents(bars(),()=>true,settings);
  assert.equal(ts.length,3);
  for(let i=1;i<ts.length;i++)assert.ok(ts[i].entryDate>ts[i-1].exitDate);
});
test('Missing session in warmup or outcome suppresses event rather than compressing time',()=>{
  const rs=bars();rs.splice(3,1);
  assert.equal(simulateEvents(rs,onlyFirst,settings).length,0);
});
test('Holding across the era boundary is excluded',()=>{
  assert.equal(simulateEvents(bars(),onlyFirst,{...settings,split:'2024-01-04'}).length,0);
});
test('Gap below stop executes at open, not an impossible stop fill',()=>{
  const rs=bars();Object.assign(rs[3],{open:90,low:89,high:92,close:91});
  const [t]=simulateEvents(rs,onlyFirst,{...settings,riskManaged:true});
  assert.equal(t.stop,97);assert.equal(t.exit,90);assert.equal(t.exitReason,'gap-stop');
});
test('Both bracket levels in a daily bar conservatively stop first',()=>{
  const rs=bars();rs[2].low=95;rs[2].high=110;
  const [t]=simulateEvents(rs,onlyFirst,{...settings,riskManaged:true});
  assert.equal(t.exit,97);assert.equal(t.exitReason,'stop');assert.equal(t.adverseExcursion,null);
});
test('Bracket target and max-duration exits are distinct',()=>{
  const rs=bars();rs[3].high=107;
  assert.equal(simulateEvents(rs,onlyFirst,{...settings,riskManaged:true})[0].exit,106);
  assert.equal(simulateEvents(bars(),onlyFirst,{...settings,riskManaged:true})[0].exitReason,'horizon');
});
test('Appending future bars leaves completed executions unchanged',()=>{
  const rs=bars();assert.deepEqual(simulateEvents(rs,onlyFirst,settings),simulateEvents(rs.slice(0,6),onlyFirst,settings));
});
test('Statistics use trade order for drawdown, not sorted returns',()=>{
  const s=summarizeEvents([{netReturn:0.2,adverseExcursion:-0.1},{netReturn:-0.1,adverseExcursion:-0.15}]);
  assert.equal(s.median,0.05);assert.equal(s.profitFactor,2);assert.ok(Math.abs(s.exitToExitDrawdown+0.1)<1e-12);
});

test('Wilder RSI seed and subsequent smoothing match hand arithmetic',()=>{
  const closes=[100];for(let i=1;i<=14;i++)closes.push(closes.at(-1)+(i%2?2:-1));
  const result=closeIndicators([...closes,closes.at(-1)+3]);
  assert.ok(Math.abs(result[14].rsi-66.66666666666667)<1e-10);
  const gain=(1*13+3)/14,loss=(0.5*13)/14;
  assert.ok(Math.abs(result[15].rsi-(100-100/(1+gain/loss)))<1e-10);
});
test('Appending future values never changes earlier indicators',()=>{
  const xs=Array.from({length:230},(_,i)=>100+i/10+Math.sin(i));
  assert.deepEqual(closeIndicators(xs).slice(0,210),closeIndicators(xs.slice(0,210)));
});
test('MA5 includes current close and requires five observations',()=>{
  const rs=closeIndicators([10,20,30,40,50,60]);
  assert.equal(rs[3].ma5,null);assert.equal(rs[4].ma5,30);assert.equal(rs[5].ma5,40);
});
test('Missing close cannot silently become zero or disappear',()=>{
  for(const bad of [null,NaN,undefined,0])assert.throws(()=>closeIndicators([100,bad,101]));
});
test('Flat, rising and falling markets have explicit RSI conventions',()=>{
  assert.equal(closeIndicators(Array(20).fill(100)).at(-1).rsi,50);
  assert.equal(closeIndicators(Array.from({length:20},(_,i)=>100+i)).at(-1).rsi,100);
  assert.equal(closeIndicators(Array.from({length:20},(_,i)=>100-i)).at(-1).rsi,0);
});
test('Research RSI and MA agree with the app implementation on real KLAC data',()=>{
  const s=JSON.parse(fs.readFileSync(new URL('../research/semiconductor-rebound/data/KLAC.json',import.meta.url))).chart.result[0];
  const closes=s.indicators.adjclose[0].adjclose,actual=closeIndicators(closes).at(-1);
  assert.ok(Math.abs(actual.rsi-calculateRSI(closes))<1e-10);
  for(const n of [5,20,60,200])assert.equal(actual[`ma${n}`],calculateMA(closes,n));
});
test('SOX report uses verified missing close, not prior available day',()=>{
  const get=name=>JSON.parse(fs.readFileSync(new URL(`../research/semiconductor-rebound/${name}`,import.meta.url)));
  const s=get('data/_SOX.json').chart.result[0],fix=get('verified-closes.json')['^SOX'],out=get('sox-corrected-close-indicators.json');
  const closes=s.timestamp.map((t,i)=>s.indicators.quote[0].close[i]??fix[new Date(t*1000).toISOString().slice(0,10)]?.close);
  assert.equal(closes.at(-2),11505.56);assert.ok(Math.abs(out.last.rsi-calculateRSI(closes))<1e-10);
  assert.ok(Math.abs(out.last.dailyReturn-(closes.at(-1)/11505.56-1))<1e-12);
});
