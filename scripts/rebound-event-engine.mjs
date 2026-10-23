export const reboundStrategies = {
  unconditional: () => true,
  oversold: (r,p) => r.rsi <= 30 && p.rsi > 30,
  rsiRecovery: (r,p) => r.rsi > 30 && p.rsi <= 30,
  maRecovery: (r,p) => r.drawdown60 <= -0.08 && r.close > r.ma5 && p.close <= p.ma5,
  breakoutRecovery: (r,p) => r.recentOversold && r.close > r.priorHigh3 && r.rsi > p.rsi && r.close > r.ma5,
};

export function simulateEvents(rows, signal, {horizon=20,cost=0.001,warmup=200,riskManaged=false,split='2023-01-01'}={}) {
  const trades=[];let nextEligible=warmup;
  for(let i=warmup;i+horizon<rows.length;i++) {
    if(i<nextEligible || rows[i+horizon].originalIndex-rows[i-warmup].originalIndex!==warmup+horizon)continue;
    if(!signal(rows[i],rows[i-1]))continue;
    if(rows[i].date<split && rows[i+horizon].date>=split)continue;
    const entry=rows[i+1];let exitIndex=i+horizon,exit=rows[exitIndex].close,exitReason='horizon';
    const risk=1.5*rows[i].atr,stop=entry.open-risk,target=entry.open+2*risk;
    if(riskManaged && (!(risk>0)||!(stop>0)))continue;
    if(riskManaged) {
      for(let j=i+1;j<=i+horizon;j++) {
        const r=rows[j];
        // No entry-bar gap stop: bracket is established at that bar's open.
        // Later gap exits at opening price; both intrabar levels => stop first.
        if(r.open<=stop){exit=r.open;exitReason='gap-stop';exitIndex=j;break;}
        if(r.open>=target){exit=r.open;exitReason='gap-target';exitIndex=j;break;}
        if(r.low<=stop){exit=stop;exitReason='stop';exitIndex=j;break;}
        if(r.high>=target){exit=target;exitReason='target';exitIndex=j;break;}
      }
    }
    const held=rows.slice(i+1,exitIndex+1);
    trades.push({signalDate:rows[i].date,entryDate:entry.date,exitDate:rows[exitIndex].date,entry:entry.open,exit,exitReason,netReturn:exit*(1-cost)/(entry.open*(1+cost))-1,
      // Full exit-bar range can include prices AFTER an intraday bracket exit;
      // do not mislabel these as realized trade excursions for bracket tests.
      adverseExcursion:riskManaged?null:Math.min(...held.map(x=>x.low))/entry.open-1,
      favorableExcursion:riskManaged?null:Math.max(...held.map(x=>x.high))/entry.open-1,
      ...(riskManaged?{stop,target,initialRisk:risk}:{}),
    });
    nextEligible=exitIndex;
  }
  return trades;
}

export function summarizeEvents(ts) {
  const n=ts.length;if(!n)return {count:0};
  const returns=ts.map(t=>t.netReturn).sort((a,b)=>a-b),wins=returns.filter(r=>r>0).length,p=wins/n,z=1.96;
  const center=(p+z*z/(2*n))/(1+z*z/n),half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n);
  const sum=xs=>xs.reduce((a,b)=>a+b,0);
  const grossProfit=sum(returns.filter(x=>x>0)),grossLoss=-sum(returns.filter(x=>x<0));
  let equity=1,peak=1,drawdown=0;
  for(const t of ts){equity*=1+t.netReturn;peak=Math.max(peak,equity);drawdown=Math.min(drawdown,equity/peak-1);}
  return {count:n,winRate:p,winRateWilson95:[center-half,center+half],mean:sum(returns)/n,median:n%2?returns[(n-1)/2]:(returns[n/2-1]+returns[n/2])/2,worst:returns[0],worstAdverseExcursion:ts.every(t=>Number.isFinite(t.adverseExcursion))?Math.min(...ts.map(t=>t.adverseExcursion)):null,profitFactor:grossLoss?grossProfit/grossLoss:null,exitToExitDrawdown:drawdown};
}
