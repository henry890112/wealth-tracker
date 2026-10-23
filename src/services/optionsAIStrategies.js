const numeric = value => value === null || value === undefined || value === '' ? null : Number(value);
const valid = value => Number.isFinite(value) && value > 0;

export function optionPayoffAtExpiration(strategy, underlyingPrice) {
  const price = numeric(underlyingPrice);
  if (price === null || !Number.isFinite(price) || price < 0) return null;
  const intrinsic = strategy.legs.reduce((sum, leg) => sum + leg.side * (leg.type === 'call'
    ? Math.max(0, price - leg.strike)
    : Math.max(0, leg.strike - price)), 0);
  return Math.round((intrinsic - strategy.debit) * strategy.multiplier * 100) / 100;
}

function makeStrategy(key, title, legs, multiplier) {
  const debit = legs.reduce((sum, leg) => sum + (leg.side === 1 ? leg.ask : -leg.bid), 0);
  if (!valid(debit)) return null;
  const spread = legs.length === 2 && legs[0].type === legs[1].type && legs[0].side !== legs[1].side;
  const width = spread ? Math.abs(legs[0].strike - legs[1].strike) : null;
  if (spread && debit >= width) return null;
  const cost = Math.round(debit * multiplier * 100) / 100;
  const maxGain = spread ? Math.round((width - debit) * multiplier * 100) / 100
    : key === 'long_put' ? Math.round((legs[0].strike - debit) * multiplier * 100) / 100 : null;
  const breakeven = key === 'straddle'
    ? [legs[0].strike - debit, legs[0].strike + debit]
    : [key === 'long_put' || key === 'bear_put_spread' ? legs[0].strike - debit : legs[0].strike + debit];
  return { key, title, legs, debit, multiplier, cost, maxLoss: cost, maxGain, breakeven,
    minOpenInterest: Math.min(...legs.map(leg => leg.openInterest || 0)) };
}

export function buildOptionStrategies({ contracts = [], spot, budget = 500, expiration } = {}) {
  const underlying = numeric(spot);
  if (!valid(underlying)) return [];
  const budgetValue = numeric(budget);
  const rows = contracts.filter(row => (!expiration || row.expiration === expiration)
    && (row.type === 'call' || row.type === 'put')
    && valid(numeric(row.strike)) && valid(numeric(row.ask))
    && numeric(row.bid) !== null && numeric(row.bid) >= 0
    && numeric(row.ask) >= numeric(row.bid)
    && numeric(row.multiplier || 100) === 100)
    .map(row => ({ ...row, strike: Number(row.strike), ask: Number(row.ask), bid: Number(row.bid), multiplier: 100 }));
  const nearest = type => rows.filter(row => row.type === type)
    .sort((a, b) => Math.abs(a.strike - underlying) - Math.abs(b.strike - underlying) || b.openInterest - a.openInterest)[0];
  const call = nearest('call');
  const put = nearest('put');
  const choices = [];
  if (call) choices.push(makeStrategy('long_call', '買進 Call', [{ ...call, side: 1 }], 100));
  if (put) choices.push(makeStrategy('long_put', '買進 Put', [{ ...put, side: 1 }], 100));
  if (call) {
    const shorts = rows.filter(row => row.type === 'call' && row.strike > call.strike)
      .sort((a, b) => a.strike - b.strike);
    const spread = shorts.map(short => makeStrategy('bull_call_spread', '牛市 Call 價差', [{ ...call, side: 1 }, { ...short, side: -1 }], 100)).find(Boolean);
    if (spread) choices.push(spread);
  }
  if (put) {
    const shorts = rows.filter(row => row.type === 'put' && row.strike < put.strike)
      .sort((a, b) => b.strike - a.strike);
    const spread = shorts.map(short => makeStrategy('bear_put_spread', '熊市 Put 價差', [{ ...put, side: 1 }, { ...short, side: -1 }], 100)).find(Boolean);
    if (spread) choices.push(spread);
  }
  const putsByStrike = new Map(rows.filter(row => row.type === 'put').map(row => [row.strike, row]));
  const matchingPairs = rows.filter(row => row.type === 'call' && putsByStrike.has(row.strike))
    .map(c => ({ call: c, put: putsByStrike.get(c.strike) }));
  const pair = matchingPairs.sort((a, b) => Math.abs(a.call.strike - underlying) - Math.abs(b.call.strike - underlying))[0];
  if (pair) {
    choices.push(makeStrategy('straddle', '買進跨式', [{ ...pair.call, side: 1 }, { ...pair.put, side: 1 }], 100));
  }
  return choices.filter(Boolean).map(strategy => ({
    ...strategy,
    affordableContracts: valid(budgetValue) ? Math.min(100, Math.floor(budgetValue / strategy.cost)) : 0,
  }));
}
