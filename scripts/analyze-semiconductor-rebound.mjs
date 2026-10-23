import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {reboundStrategies as strategies,simulateEvents,summarizeEvents} from './rebound-event-engine.mjs';

const root = 'research/semiconductor-rebound';
const manifest = JSON.parse(await fs.readFile(`${root}/manifest.json`, 'utf8'));
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
// Exploratory retrospective comparison, not a prospective validated strategy.
// Fixed definitions: 20-session holding period, next-open execution, 10bp each side.
// Split eras before calculating results; do not optimize parameters on the later era.
const output = { methodology: { fetchedAt: manifest.fetchedAt, horizon: 20, costPerSide: 0.001, train: 'through 2022-12-31', holdout: '2023-01-01 onward', adjustment: 'OHLC multiplied by adjclose/close; dividend-adjusted total-return proxy', limitations: ['Retrospective holdout, not prospective validation', 'Current selected stocks introduce survivorship/selection bias', 'No overlapping trades within each strategy; different strategies are not independent', 'No stops in this fixed-horizon event study; not a deployable trading system'] }, assets: [] };
assetLoop: for (const item of manifest.symbols) {
  if (item.error) continue;
  const raw = await fs.readFile(`${root}/data/${item.file}`, 'utf8');
  if (crypto.createHash('sha256').update(raw).digest('hex') !== item.sha256) throw Error(`Hash mismatch ${item.symbol}`);
  const s = JSON.parse(raw).chart.result[0], q = s.indicators.quote[0], adj = s.indicators.adjclose?.[0]?.adjclose;
  const rows = [], invalid = [];
  for (let i = 0; i < s.timestamp.length; i++) {
    const values = ['open', 'high', 'low', 'close'].map(k => q[k][i]);
    if (!values.every(v => Number.isFinite(v) && v > 0) || !(adj?.[i] > 0)) { invalid.push(i); continue; }
    const [o, h, l, c] = values;
    if (h + 0.01 < Math.max(o, c) || l - 0.01 > Math.min(o, c) || l > h) {
      output.assets.push({ symbol:item.symbol, excluded:true, reason:'OHLC inconsistent; requires independent source verification', date:new Date(s.timestamp[i]*1000).toISOString().slice(0,10), values:{open:o,high:h,low:l,close:c} });
      continue assetLoop;
    }
    const date = new Date(s.timestamp[i] * 1000).toISOString().slice(0, 10);
    if (rows.length && date <= rows.at(-1).date) throw Error(`Duplicate/order ${item.symbol}`);
    if (s.timestamp[i] >= s.meta.currentTradingPeriod.regular.start && Date.parse(manifest.fetchedAt) < s.meta.currentTradingPeriod.regular.end * 1000) continue;
    const f = adj[i] / c;
    rows.push({ originalIndex:i, date, open: o*f, high: h*f, low: l*f, close: c*f, volume: q.volume[i], rawClose: c });
  }
  let gain = 0, loss = 0, atr = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], p = rows[i-1];
    for (const n of [5, 20, 60, 200]) r[`ma${n}`] = i >= n-1 ? mean(rows.slice(i-n+1, i+1).map(x => x.close)) : null;
    if (!p) continue;
    const change = r.close-p.close, g = Math.max(change, 0), l = Math.max(-change, 0);
    const tr = Math.max(r.high-r.low, Math.abs(r.high-p.close), Math.abs(r.low-p.close));
    if (i <= 14) { gain += g/14; loss += l/14; atr += tr/14; }
    else { gain = (gain*13+g)/14; loss = (loss*13+l)/14; atr = (atr*13+tr)/14; }
    if (i >= 14) { r.rsi = loss === 0 ? (gain === 0 ? 50 : 100) : 100-100/(1+gain/loss); r.atr = atr; }
    r.drawdown60 = i >= 59 ? r.close/Math.max(...rows.slice(i-59,i+1).map(x => x.high))-1 : null;
    r.priorHigh3 = i >= 3 ? Math.max(...rows.slice(i-3,i).map(x => x.high)) : null;
    r.recentOversold = rows.slice(Math.max(0,i-10),i).some(x => x.rsi <= 30 && x.rsi != null);
  }
  const studies = {};
  for (const [name, signal] of Object.entries(strategies)) {
    const trades = simulateEvents(rows,signal);
    studies[name] = { trades };
    for (const era of ['train','holdout']) {
      const ts = trades.filter(t => (t.signalDate >= '2023-01-01') === (era === 'holdout'));
      studies[name][era] = summarizeEvents(ts);
    }
    studies[name].sensitivity=[];
    for(const horizon of [10,20,40])for(const cost of [0.001,0.003]){
      const ts=simulateEvents(rows,signal,{horizon,cost}).filter(t=>t.signalDate>='2023-01-01');
      studies[name].sensitivity.push({horizon,cost,...summarizeEvents(ts)});
    }
    const bracketTrades=simulateEvents(rows,signal,{riskManaged:true});
    studies[name].bracket={rules:'Signal ATR14 x1.5 below next open; target 2R above next open; maximum20 sessions; both hit same bar => stop first; 0.1% each side',trades:bracketTrades,holdout:summarizeEvents(bracketTrades.filter(t=>t.signalDate>='2023-01-01'))};
  }
  const last = rows.at(-1), prev = rows.at(-2);
  const recentGap = rows.length > 200 && last.originalIndex-rows.at(-201).originalIndex !== 200;
  output.assets.push({ symbol:item.symbol, first:rows[0].date, last:last.date, usableRows:rows.length, excludedRows:invalid.length, current:{...last, reliable:!recentGap, warning:recentGap?'Recent missing OHLC; these compressed-series indicators must not be used for entry decisions':null, dailyReturn:last.originalIndex-prev.originalIndex===1?last.close/prev.close-1:null, nextCloseToReclaimMA5:recentGap?null:mean(rows.slice(-4).map(x=>x.close)), signals:Object.fromEntries(Object.entries(strategies).filter(([name])=>name!=='unconditional').map(([name,signal])=>[name,!recentGap && rows.length>200 && signal(last,prev)]))}, studies });
}
await fs.writeFile(`${root}/event-study.json`, JSON.stringify(output,null,2));
for(const a of output.assets) console.log(JSON.stringify(a.excluded ? a : {symbol:a.symbol,close:a.current.rawClose,rsi:a.current.rsi,drawdown60:a.current.drawdown60,holdout:Object.fromEntries(Object.entries(a.studies).map(([k,v])=>[k,v.holdout]))}));
