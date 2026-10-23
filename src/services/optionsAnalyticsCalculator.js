const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeOptionSymbol = value => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9./-]/g, '')
  .slice(0, 12);

export const normalizeTaiwanOptionSymbol = value => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .slice(0, 8);

const cleanHtmlText = value => String(value || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/\s+/g, ' ')
  .trim();

export const parseTaifexStockProducts = html => {
  const products = [];
  const rows = String(html || '').match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  rows.forEach(row => {
    if (!row.includes('是股票選擇權標的')) return;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(match => cleanHtmlText(match[1]));
    const baseCode = normalizeTaiwanOptionSymbol(cells[0]);
    const symbol = normalizeTaiwanOptionSymbol(cells[2]);
    const multiplier = Number(String(cells[11] || '').replace(/,/g, ''));
    if (!baseCode || !symbol || !(multiplier > 0)) return;
    products.push({
      baseCode,
      contract: `${baseCode}O`,
      symbol,
      name: cells[3] || symbol,
      multiplier,
      weekly: row.includes('是股票選擇權週契約標的'),
    });
  });
  return products;
};

const median = values => {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const inferSpotFromPutCallParity = rows => {
  const pairs = new Map();
  (rows || []).forEach(row => {
    const strike = number(row?.strike);
    const price = number(row?.settlementPrice ?? row?.last);
    const type = String(row?.type || '').toLowerCase();
    if (!(strike > 0) || !(price >= 0) || !['call', 'put'].includes(type)) return;
    const pair = pairs.get(strike) || { strike };
    pair[type] = price;
    pairs.set(strike, pair);
  });
  return median([...pairs.values()]
    .filter(pair => Number.isFinite(pair.call) && Number.isFinite(pair.put))
    .map(pair => pair.strike + pair.call - pair.put)
    .filter(value => value > 0));
};

export const estimateGammaFromDeltaCurve = ({ rows = [], spot }) => {
  const current = number(spot);
  if (!(current > 0)) return rows.map(row => ({ ...row, gamma: null }));
  const groups = new Map();
  rows.forEach((row, index) => {
    const key = `${row?.expiration || ''}:${String(row?.type || '').toLowerCase()}`;
    const items = groups.get(key) || [];
    items.push({ row, index, strike: number(row?.strike), delta: number(row?.delta) });
    groups.set(key, items);
  });
  const gammaByIndex = new Map();
  groups.forEach(items => {
    const valid = items.filter(item => item.strike > 0 && item.delta !== null).sort((a, b) => a.strike - b.strike);
    valid.forEach((item, index) => {
      const previous = valid[index - 1];
      const next = valid[index + 1];
      let derivative = null;
      if (previous && next && next.strike !== previous.strike) derivative = (next.delta - previous.delta) / (next.strike - previous.strike);
      else if (next && next.strike !== item.strike) derivative = (next.delta - item.delta) / (next.strike - item.strike);
      else if (previous && item.strike !== previous.strike) derivative = (item.delta - previous.delta) / (item.strike - previous.strike);
      gammaByIndex.set(item.index, derivative === null ? null : Math.abs((item.strike / current) * derivative));
    });
  });
  return rows.map((row, index) => ({ ...row, gamma: gammaByIndex.get(index) ?? null }));
};

export const filterContractsByRange = (contracts, spot, rangePercent = 0.25) => {
  const current = number(spot);
  if (!Array.isArray(contracts)) return [];
  if (!(current > 0) || rangePercent === null) return contracts;
  const lower = current * (1 - rangePercent);
  const upper = current * (1 + rangePercent);
  return contracts.filter(contract => Number(contract?.strike) >= lower && Number(contract?.strike) <= upper);
};

const normalDensity = value => Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);

const yearsToExpiration = (expiration, asOf) => {
  const expiryText = String(expiration || '');
  const expiry = /^\d{4}-\d{2}-\d{2}$/.test(expiryText)
    ? Date.parse(`${expiryText}T20:00:00Z`)
    : Date.parse(expiryText);
  const asOfText = String(asOf || '').trim();
  // Cboe timestamps omit the zone but represent the provider snapshot clock.
  // Parse that wire format consistently as UTC instead of using the device's
  // local timezone, which otherwise changes Zero Gamma by locale.
  const normalizedAsOf = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(asOfText)
    ? `${asOfText.replace(' ', 'T')}Z`
    : asOfText;
  const parsedAsOf = Date.parse(normalizedAsOf);
  const now = Number.isFinite(parsedAsOf) ? parsedAsOf : Date.now();
  if (!Number.isFinite(expiry)) return null;
  // Keep same-day contracts numerically stable during the final session.
  return Math.max((expiry - now) / (365.25 * 24 * 60 * 60 * 1000), 1 / 365.25);
};

export const calculateScenarioGexCurve = ({ contracts = [], prices = [], asOf, riskFreeRate = 0.04 }) => {
  const scenarios = [...new Set((prices || []).map(number).filter(value => value > 0))].sort((a, b) => a - b);
  const prepared = (contracts || []).flatMap(contract => {
    const strike = number(contract?.strike);
    const openInterest = Math.max(0, number(contract?.openInterest) || 0);
    const multiplier = Math.max(1, number(contract?.multiplier) || 100);
    const type = String(contract?.type || '').toLowerCase();
    let volatility = number(contract?.impliedVolatility);
    if (volatility > 3) volatility /= 100;
    const time = yearsToExpiration(contract?.expiration, asOf);
    if (!(strike > 0) || !(openInterest > 0) || !(volatility > 0) || !(time > 0) || !['call', 'put'].includes(type)) return [];
    return [{ strike, openInterest, multiplier, type, volatility, time }];
  });
  if (!prepared.length) return [];
  const rate = Number.isFinite(Number(riskFreeRate)) ? Number(riskFreeRate) : 0.04;
  return scenarios.map(price => {
    let callGex = 0;
    let putGex = 0;
    for (const contract of prepared) {
      const rootTime = Math.sqrt(contract.time);
      const d1 = (Math.log(price / contract.strike) + (rate + 0.5 * contract.volatility ** 2) * contract.time)
        / (contract.volatility * rootTime);
      const gamma = normalDensity(d1) / (price * contract.volatility * rootTime);
      const exposure = gamma * contract.openInterest * contract.multiplier * price * price * 0.01;
      if (contract.type === 'call') callGex += exposure;
      else putGex -= exposure;
    }
    return { price, callGex, putGex, totalGex: callGex + putGex };
  });
};

export const calculateOptionsAnalytics = ({ contracts = [], spot, asOf }) => {
  const underlyingPrice = number(spot);
  if (!(underlyingPrice > 0)) return {
    rows: [], scenarioGexCurve: [], totalGex: null, callWall: null, putWall: null, totalCallVolume: 0, totalPutVolume: 0,
    usableContracts: 0, missingGammaContracts: 0,
  };

  const byStrike = new Map();
  let usableContracts = 0;
  let missingGammaContracts = 0;

  contracts.forEach(contract => {
    const strike = number(contract?.strike);
    const gamma = number(contract?.gamma);
    const openInterest = Math.max(0, number(contract?.openInterest) || 0);
    const volume = Math.max(0, number(contract?.volume) || 0);
    const multiplier = Math.max(1, number(contract?.multiplier) || 100);
    const type = String(contract?.type || '').toLowerCase();
    if (!(strike > 0) || !['call', 'put'].includes(type)) return;

    const row = byStrike.get(strike) || {
      strike, callGex: 0, putGex: 0, netGex: 0,
      callVolume: 0, putVolume: 0, callOpenInterest: 0, putOpenInterest: 0,
    };
    if (type === 'call') {
      row.callVolume += volume;
      row.callOpenInterest += openInterest;
    } else {
      row.putVolume += volume;
      row.putOpenInterest += openInterest;
    }

    if (gamma === null || gamma < 0) {
      missingGammaContracts += 1;
    } else {
      // Estimated dollar gamma for a 1% move in the underlying. Calls are
      // treated as positive and puts as negative; this is a positioning model,
      // not a disclosure of dealers' actual inventory.
      const absoluteGex = gamma * openInterest * multiplier * underlyingPrice * underlyingPrice * 0.01;
      if (type === 'call') row.callGex += absoluteGex;
      else row.putGex -= absoluteGex;
      usableContracts += 1;
    }
    row.netGex = row.callGex + row.putGex;
    byStrike.set(strike, row);
  });

  const rows = [...byStrike.values()].sort((left, right) => left.strike - right.strike);
  const callWallRow = rows.reduce((best, row) => !best || row.callGex > best.callGex ? row : best, null);
  const putWallRow = rows.reduce((best, row) => !best || Math.abs(row.putGex) > Math.abs(best.putGex) ? row : best, null);
  const scenarioGexCurve = calculateScenarioGexCurve({ contracts, prices: rows.map(row => row.strike), asOf });
  return {
    rows,
    scenarioGexCurve,
    totalGex: rows.reduce((sum, row) => sum + row.netGex, 0),
    callWall: callWallRow?.callGex > 0 ? callWallRow.strike : null,
    putWall: Math.abs(putWallRow?.putGex || 0) > 0 ? putWallRow.strike : null,
    totalCallVolume: rows.reduce((sum, row) => sum + row.callVolume, 0),
    totalPutVolume: rows.reduce((sum, row) => sum + row.putVolume, 0),
    usableContracts,
    missingGammaContracts,
  };
};
