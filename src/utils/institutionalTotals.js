export const INSTITUTIONAL_TOTAL_PERIODS = [5, 10, 20, 30];

// Market-wide flows are in 億元; unlike the per-stock table, these are amounts, not shares.
export function calculateInstitutionalFlowTotals(points = [], periods = INSTITUTIONAL_TOTAL_PERIODS) {
  const byDate = new Map();
  for (const point of points) {
    const date = String(point?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const values = [point.buy, point.sell, point.net].map(value =>
      value == null || value === '' ? NaN : Number(value));
    if (values.every(Number.isFinite)) byDate.set(date, { date, buy: values[0], sell: values[1], net: values[2] });
  }
  const latestFirst = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  return periods.map(days => {
    const window = latestFirst.slice(0, days);
    if (window.length < days) return { days, complete: false, availableDays: window.length };
    return {
      days, complete: true, availableDays: days,
      buy: window.reduce((sum, point) => sum + point.buy, 0),
      sell: window.reduce((sum, point) => sum + point.sell, 0),
      net: window.reduce((sum, point) => sum + point.net, 0),
    };
  });
}

const shareValue = value => value === null || value === undefined || value === ''
  ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const buyValue = value => {
  const number = shareValue(value);
  return number !== null && number >= 0 ? number : null;
};
const priceValue = value => {
  const number = shareValue(value);
  return number !== null && number > 0 ? number : null;
};

export function normalizeInstitutionalRows(rows = []) {
  const byDate = new Map();
  for (const row of rows) {
    const time = String(row?.time || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(time) || byDate.has(time)) continue;
    const foreign = shareValue(row.foreign);
    const trust = shareValue(row.trust);
    const dealer = row.dealer != null
      ? shareValue(row.dealer)
      : [shareValue(row.dealerSelf), shareValue(row.dealerHedging)].every(value => value !== null)
        ? Number(row.dealerSelf) + Number(row.dealerHedging) : null;
    byDate.set(time, {
      time, foreign, trust, dealer,
      all: [foreign, trust, dealer].every(value => value !== null) ? foreign + trust + dealer : null,
      foreignBuy: buyValue(row.foreignBuy), trustBuy: buyValue(row.trustBuy),
      dealerBuy: buyValue(row.dealerBuy), referencePrice: priceValue(row.referencePrice),
    });
  }
  return [...byDate.values()].sort((a, b) => b.time.localeCompare(a.time));
}

export function joinInstitutionalRowsWithClosingPrices(institutionalRows = [], priceRows = []) {
  const closesByDate = new Map();
  for (const row of priceRows) {
    const time = String(row?.time || '');
    const close = priceValue(row?.close);
    if (/^\d{4}-\d{2}-\d{2}$/.test(time) && close !== null) closesByDate.set(time, close);
  }
  return normalizeInstitutionalRows(institutionalRows).map(row => ({ ...row, close: closesByDate.get(row.time) ?? null }));
}

export function calculateInstitutionalEstimatedBuyPrices(rows = [], periods = INSTITUTIONAL_TOTAL_PERIODS) {
  const ordered = normalizeInstitutionalRows(rows);
  return periods.map(days => {
    const window = ordered.slice(0, days);
    if (window.length < days) return { days, foreign: null, trust: null, dealer: null, all: null };
    const estimate = keys => {
      let shares = 0;
      let weightedPrice = 0;
      for (const row of window) {
        if (keys.some(key => row[key] === null)) return null;
        const dailyBuy = keys.reduce((sum, key) => sum + row[key], 0);
        if (dailyBuy > 0 && row.referencePrice === null) return null;
        shares += dailyBuy;
        weightedPrice += dailyBuy * (row.referencePrice || 0);
      }
      return shares > 0 ? weightedPrice / shares : null;
    };
    return {
      days,
      foreign: estimate(['foreignBuy']),
      trust: estimate(['trustBuy']),
      dealer: estimate(['dealerBuy']),
      all: estimate(['foreignBuy', 'trustBuy', 'dealerBuy']),
    };
  });
}

export function calculateInstitutionalTotals(rows = [], periods = INSTITUTIONAL_TOTAL_PERIODS) {
  const ordered = normalizeInstitutionalRows(rows);
  return periods.map(days => {
    const window = ordered.slice(0, days);
    const complete = window.length === days
      && window.every(row => ['foreign', 'trust', 'dealer'].every(key => row[key] !== null));
    if (!complete) return { days, complete: false, availableDays: window.length };
    const foreign = window.reduce((sum, row) => sum + row.foreign, 0);
    const trust = window.reduce((sum, row) => sum + row.trust, 0);
    const dealer = window.reduce((sum, row) => sum + row.dealer, 0);
    return { days, complete: true, availableDays: days, foreign, trust, dealer, all: foreign + trust + dealer };
  });
}

// A directional *reference* price, not an institution's execution price or cost basis.
// Weight same-direction net-flow days by shares using their same-day closing price.
export function calculateInstitutionalPressurePrices(institutionalRows = [], priceRows = [], periods = INSTITUTIONAL_TOTAL_PERIODS) {
  const ordered = joinInstitutionalRowsWithClosingPrices(institutionalRows, priceRows);
  return periods.map(days => {
    const window = ordered.slice(0, days);
    if (window.length < days || window.some(row => row.all === null || row.close === null)) {
      return { days, price: null, direction: null };
    }
    const netShares = window.reduce((sum, row) => sum + row.all, 0);
    const direction = Math.sign(netShares);
    if (!direction) return { days, price: null, direction: null };
    const weighted = window.reduce((acc, row) => {
      const weight = Math.max(direction * row.all, 0);
      return { shares: acc.shares + weight, value: acc.value + weight * row.close };
    }, { shares: 0, value: 0 });
    return {
      days,
      price: weighted.shares > 0 ? weighted.value / weighted.shares : null,
      direction: direction > 0 ? 'buy' : 'sell',
    };
  });
}
