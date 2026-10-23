// Close-only calculations are separate from OHLC calculations: a verified close
// does not supply an open/high/low, volume, ATR, or executable next-open trade.
export function closeIndicators(closes) {
  if (!closes.every(x => Number.isFinite(x) && x > 0)) throw Error('Missing/invalid close');
  let gain=0, loss=0;
  const result=[];
  for(let i=0;i<closes.length;i++) {
    const r={close:closes[i]};
    for(const n of [5,20,60,200]) r[`ma${n}`]=i+1>=n?closes.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n:null;
    if(i>0) {
      const delta=closes[i]-closes[i-1],g=Math.max(delta,0),l=Math.max(-delta,0);
      if(i<=14){gain+=g/14;loss+=l/14;}else{gain=(gain*13+g)/14;loss=(loss*13+l)/14;}
      if(i>=14)r.rsi=loss===0?(gain===0?50:100):100-100/(1+gain/loss);
      r.dailyReturn=closes[i]/closes[i-1]-1;
    }
    result.push(r);
  }
  return result;
}
