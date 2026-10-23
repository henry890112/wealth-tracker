import { supabase } from '../lib/supabase';
import { getTaipeiDateString } from '../lib/date';
import { convertToBaseCurrency, fetchExchangeRatesBatch } from './api';

export const PERFORMANCE_MARKETS = {
  ALL: '全部',
  TW: '台股',
  US: '美股',
  CRYPTO: '虛擬貨幣',
  OTHER: '其他',
};

export const normalizePerformanceMarket = value => {
  const market = String(value || 'OTHER').toUpperCase();
  return market === 'CRYPTO' ? 'CRYPTO' : market || 'OTHER';
};

export const marketCurrency = (market, baseCurrency = 'TWD') => {
  if (normalizePerformanceMarket(market) === 'TW') return 'TWD';
  if (['US', 'CRYPTO'].includes(normalizePerformanceMarket(market))) return 'USD';
  return baseCurrency;
};

const finite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const dateMs = value => new Date(value).getTime();

const performanceIdentity = asset => {
  const market = normalizePerformanceMarket(asset?.market || asset?.market_type);
  const symbol = String(asset?.symbol || '').trim().toUpperCase();
  return symbol ? `${market}:${symbol}` : `${market}:${asset?.assetId || asset?.id || asset?.name || 'UNKNOWN'}`;
};

export const getInvestmentPerformanceIdentity = performanceIdentity;

const tokenizedStockSource = asset => {
  const symbol = String(asset?.symbol || '').trim().toUpperCase();
  const name = String(asset?.assetName || asset?.name || '');
  if (normalizePerformanceMarket(asset?.market || asset?.market_type) !== 'CRYPTO') return null;
  // bStocks tokenized equities use the underlying US ticker plus a trailing B
  // (for example DRAMB -> DRAM). Their historical price is the underlying
  // equity's official daily close, not a Binance crypto pair.
  if (/bstocks\s+tokenized\s+stock/i.test(name) && /^[A-Z][A-Z0-9.-]*B$/.test(symbol)) {
    return { market: 'US', symbol: symbol.slice(0, -1) };
  }
  return null;
};

const unavailablePublicHistoryReason = asset => {
  const market = normalizePerformanceMarket(asset?.market || asset?.market_type);
  const symbol = String(asset?.symbol || '').trim().toUpperCase();
  const name = String(asset?.assetName || asset?.name || '');
  if (market !== 'US') return '';
  if (symbol === 'SPCX' && /space\s+exploration\s+technologies|spacex/i.test(name)) return '未上市公司沒有官方交易所日線';
  if (symbol === 'CBRS' && /cerebras\s+systems/i.test(name)) return '未上市公司沒有官方交易所日線';
  return '';
};

export const buildHistoricalPriceRequests = (context, market = 'ALL') => {
  const availableMarkets = (context?.markets || []).filter(key => SNAPSHOT_CATEGORY_BY_MARKET[key]);
  const selectedMarkets = market === 'ALL' ? availableMarkets : [market].filter(key => SNAPSHOT_CATEGORY_BY_MARKET[key]);
  const flows = (context?.transactionFlows || [])
    .filter(flow => selectedMarkets.includes(flow.market) && !flow.synthetic && flow.symbol);
  const incompleteKeys = findIncompleteTradeKeys(flows);
  const requests = new Map();
  for (const flow of flows) {
    if (incompleteKeys.has(tradeFlowKey(flow))) continue;
    const identity = performanceIdentity(flow);
    const unavailableReason = unavailablePublicHistoryReason(flow);
    if (unavailableReason) {
      if (!requests.has(identity)) requests.set(identity, {
        identity,
        symbol: String(flow.symbol).toUpperCase(),
        name: flow.assetName || flow.symbol,
        market: flow.market,
        currency: flow.currency,
        sourceMarket: null,
        sourceSymbol: null,
        unavailableReason,
      });
      continue;
    }
    const source = tokenizedStockSource(flow) || { market: flow.market, symbol: String(flow.symbol).toUpperCase() };
    if (!source.symbol || !['TW', 'US', 'CRYPTO'].includes(source.market)) continue;
    if (!requests.has(identity)) requests.set(identity, {
      identity,
      symbol: String(flow.symbol).toUpperCase(),
      name: flow.assetName || flow.symbol,
      market: flow.market,
      currency: flow.currency,
      sourceMarket: source.market,
      sourceSymbol: source.symbol,
      tokenizedUnderlying: source.market !== flow.market || source.symbol !== String(flow.symbol).toUpperCase(),
    });
  }
  return [...requests.values()];
};

const requestedDateWindow = (context, requestedDays, earliestDate) => {
  const todayKey = dateKey(context?.today || new Date().toISOString());
  if (requestedDays && typeof requestedDays === 'object') {
    return { start: dateKey(requestedDays.start), end: dateKey(requestedDays.end) || todayKey };
  }
  if (requestedDays === 'ALL') return { start: dateKey(earliestDate), end: todayKey };
  const days = Math.max(1, Math.floor(finite(requestedDays, 30)));
  const start = new Date(`${todayKey}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: todayKey };
};

/**
 * Rebuild a daily return series from the transaction ledger and each
 * security's official closes. The actual-profit mode uses the same FIFO cost
 * basis as the headline transaction return; instrument mode remains a
 * cash-flow-neutral price-performance comparison.
 */
export const calculateHistoricalNavSeries = (context, market = 'ALL', requestedDays = 30, historiesByIdentity = {}, options = {}) => {
  const curveMode = options?.mode === 'instrument' ? 'instrument' : 'actual';
  const actualMode = curveMode === 'actual';
  const targetReturn = actualMode && Number.isFinite(Number(options?.targetReturn))
    ? Number(options.targetReturn)
    : null;
  const requests = buildHistoricalPriceRequests(context, market);
  const supportedRequests = requests.filter(request => !request.unavailableReason);
  const excludedHistorySymbols = requests
    .filter(request => request.unavailableReason)
    .map(request => request.symbol);
  const selectedMarkets = market === 'ALL'
    ? (context?.markets || []).filter(key => SNAPSHOT_CATEGORY_BY_MARKET[key])
    : [market].filter(key => SNAPSHOT_CATEGORY_BY_MARKET[key]);
  if (!selectedMarkets.length) return { points: [], markets: [], reason: '這個市場沒有可重建的交易紀錄' };

  const allFlows = (context?.transactionFlows || [])
    .filter(flow => selectedMarkets.includes(flow.market) && !flow.synthetic && flow.symbol)
    .sort((a, b) => dateMs(a.date) - dateMs(b.date));
  const incompleteKeys = findIncompleteTradeKeys(allFlows);
  const flows = allFlows.filter(flow => !incompleteKeys.has(tradeFlowKey(flow)));
  const incompleteSymbols = findIncompleteTradeHistory(allFlows);
  const earliestDate = flows.map(flow => dateKey(flow.date)).filter(Boolean).sort()[0];
  if (!earliestDate) return { points: [], markets: selectedMarkets, reason: '沒有完整的買入交易可重建持股', incompleteSymbols };
  const window = requestedDateWindow(context, requestedDays, earliestDate);
  if (!window.start || !window.end || window.start > window.end) {
    return { points: [], markets: selectedMarkets, reason: '所選日期範圍無效', incompleteSymbols };
  }

  const flowIdentity = flow => performanceIdentity(flow);
  const relevantIdentities = new Set();
  for (const request of supportedRequests) {
    const assetFlows = flows.filter(flow => flowIdentity(flow) === request.identity);
    const sharesBeforeWindow = assetFlows
      .filter(flow => dateKey(flow.date) < window.start)
      .reduce((shares, flow) => shares + (flow.type === 'BUY' ? finite(flow.shares) : -finite(flow.shares)), 0);
    const hasWindowFlow = assetFlows.some(flow => {
      const date = dateKey(flow.date);
      return date >= window.start && date <= window.end;
    });
    if (sharesBeforeWindow > 1e-8 || hasWindowFlow) relevantIdentities.add(request.identity);
  }
  if (!relevantIdentities.size) {
    return { points: [], markets: selectedMarkets, requestedDays, periodStart: window.start, periodEnd: window.end, reason: '所選期間沒有持股或交易' };
  }

  const normalizedHistories = {};
  const missingHistorySymbols = [];
  for (const request of supportedRequests.filter(item => relevantIdentities.has(item.identity))) {
    const rows = (historiesByIdentity?.[request.identity]?.rows || historiesByIdentity?.[request.identity] || [])
      .map(row => ({ date: dateKey(row.time || row.date), close: finite(row.close) }))
      .filter(row => row.date && row.close > 0 && row.date <= window.end)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) missingHistorySymbols.push(request.symbol);
    else normalizedHistories[request.identity] = rows;
  }
  if (missingHistorySymbols.length) {
    return {
      points: [], markets: selectedMarkets, requestedDays,
      periodStart: window.start, periodEnd: window.end,
      missingHistorySymbols, incompleteSymbols,
      reason: `缺少歷史收盤價：${missingHistorySymbols.join('、')}`,
    };
  }

  // Transaction amounts were converted with one consistent current FX rate
  // when the context was loaded. Reuse that same implied rate for historical
  // market values so buys and daily closes remain in the same base currency.
  const fxByIdentity = {};
  for (const identity of relevantIdentities) {
    const samples = flows.filter(flow => flowIdentity(flow) === identity)
      .map(flow => {
        const native = Math.abs(finite(flow.amountNative));
        return native > 0 ? Math.abs(finite(flow.amount)) / native : 0;
      })
      .filter(rate => rate > 0);
    samples.sort((a, b) => a - b);
    fxByIdentity[identity] = samples.length ? samples[Math.floor(samples.length / 2)] : 1;
  }

  const tradingDates = [...new Set([...relevantIdentities].flatMap(identity =>
    (normalizedHistories[identity] || [])
      .map(row => row.date)
      .filter(date => date >= window.start && date <= window.end)
  ))].sort();
  const closeOnOrBefore = (identity, date) => (normalizedHistories[identity] || []).filter(row => row.date <= date).at(-1)?.close || 0;
  const sharesAt = (identity, date) => flows
    .filter(flow => flowIdentity(flow) === identity && dateKey(flow.date) <= date)
    .reduce((shares, flow) => shares + (flow.type === 'BUY' ? finite(flow.shares) : -finite(flow.shares)), 0);
  const valueAt = date => [...relevantIdentities].reduce((sum, identity) => {
    const shares = Math.max(0, sharesAt(identity, date));
    const close = closeOnOrBefore(identity, date);
    return sum + shares * close * finite(fxByIdentity[identity], 1);
  }, 0);

  let nav = 1;
  let previousDate = null;
  let previousValue = 0;
  const points = [];
  const adjustments = (context?.historicalAdjustments || []).filter(item => selectedMarkets.includes(item.market));
  const buyValuationAdjustment = (intervalFlows, currentDate) => intervalFlows.filter(flow => flow.type === 'BUY').reduce((sum, flow) => {
    const identity = flowIdentity(flow);
    const close = closeOnOrBefore(identity, currentDate);
    const closeValue = finite(flow.shares) * close * finite(fxByIdentity[identity], 1);
    const executionPrice = finite(flow.price, Math.abs(finite(flow.amountNative)) / Math.max(finite(flow.shares), 1));
    return sum + finite(flow.shares) * executionPrice * finite(fxByIdentity[identity], 1) - closeValue;
  }, 0);
  // The card above reports FIFO cost-basis return.  A time-weighted NAV and a
  // FIFO cost return are both valid metrics, but they do not generally end at
  // the same percentage after several buys at different prices.  The
  // "實際損益" curve is explicitly the former card's metric, so rebuild the
  // daily points with the same FIFO lots and current valuation.  Keep the
  // instrument curve below on its price-performance implementation.
  const actualReturnAt = (currentDate, useCurrentValuation = false) => {
    const periodStartMs = Date.parse(`${window.start}T00:00:00.000Z`);
    const todayKey = dateKey(context?.today || new Date().toISOString());
    const orderedFlows = flows
      .filter(flow => relevantIdentities.has(flowIdentity(flow)) && dateKey(flow.date) <= currentDate)
      .slice()
      .sort((a, b) => {
        const byDate = dateMs(a.date) - dateMs(b.date);
        if (byDate !== 0) return byDate;
        if (a.type === b.type) return 0;
        return a.type === 'BUY' ? -1 : 1;
      });
    const lotsByIdentity = new Map();
    let realizedCost = 0;
    let sellProceeds = 0;
    for (const flow of orderedFlows) {
      const identity = flowIdentity(flow);
      const lots = lotsByIdentity.get(identity) || [];
      const shares = Math.abs(finite(flow.shares));
      const value = Math.abs(finite(flow.amount));
      if (!(shares > 0) || !(value > 0)) continue;
      const flowDate = dateKey(flow.date);
      if (flow.type === 'BUY') {
        lots.push({ shares, remaining: shares, unitCost: value / shares, boughtAt: dateMs(flow.date) });
        lotsByIdentity.set(identity, lots);
        continue;
      }
      if (flow.type !== 'SELL') continue;
      let remainingToSell = shares;
      let matchedShares = 0;
      let matchedCost = 0;
      for (const lot of lots) {
        if (remainingToSell <= 1e-8) break;
        if (lot.remaining <= 1e-8) continue;
        const matched = Math.min(lot.remaining, remainingToSell);
        matchedShares += matched;
        matchedCost += matched * lot.unitCost;
        lot.remaining -= matched;
        remainingToSell -= matched;
      }
      if (flowDate >= window.start && matchedShares > 1e-8) {
        realizedCost += matchedCost;
        sellProceeds += value * (matchedShares / shares);
      }
      lotsByIdentity.set(identity, lots);
    }

    let openCost = 0;
    let currentValue = 0;
    for (const identity of relevantIdentities) {
      const lots = lotsByIdentity.get(identity) || [];
      const eligibleLots = lots.filter(lot => lot.boughtAt >= periodStartMs);
      const availableShares = eligibleLots.reduce((sum, lot) => sum + Math.max(0, lot.remaining), 0);
      const valuation = context?.assetValuations?.[identity] || {};
      const hasLiveValuation = useCurrentValuation && currentDate === todayKey
        && Number.isFinite(Number(valuation.currentShares))
        && Number.isFinite(Number(valuation.currentValue));
      const liveShares = hasLiveValuation ? Math.max(0, finite(valuation.currentShares)) : availableShares;
      let sharesToValue = Math.min(availableShares, liveShares);
      const liveUnitValue = hasLiveValuation && liveShares > 0
        ? finite(valuation.currentValue) / liveShares
        : 0;
      for (const lot of eligibleLots) {
        if (sharesToValue <= 1e-8) break;
        if (lot.remaining <= 1e-8) continue;
        const used = Math.min(lot.remaining, sharesToValue);
        openCost += used * lot.unitCost;
        if (hasLiveValuation) {
          currentValue += used * liveUnitValue;
        } else {
          const close = closeOnOrBefore(identity, currentDate);
          currentValue += used * close * finite(fxByIdentity[identity], 1);
        }
        sharesToValue -= used;
      }
    }
    const totalCost = realizedCost + openCost;
    const realizedPnl = sellProceeds - realizedCost;
    const unrealizedPnl = currentValue - openCost;
    const totalPnl = realizedPnl + unrealizedPnl;
    return {
      currentValue,
      totalCost,
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      return: totalCost > 0 ? totalPnl / totalCost : null,
    };
  };

  if (actualMode) {
    const currentDate = dateKey(context?.today || new Date().toISOString());
    const pointDates = [...new Set([
      ...tradingDates,
      ...(currentDate >= window.start && currentDate <= window.end ? [currentDate] : []),
    ])].sort();
    for (const pointDate of pointDates) {
      const actual = actualReturnAt(pointDate, pointDate === currentDate);
      if (!Number.isFinite(actual.return)) continue;
      if (!points.length) {
        points.push({
          date: pointDate,
          nav: 1,
          return: 0,
          value: actual.currentValue,
          totalCost: actual.totalCost,
          realizedPnl: actual.realizedPnl,
          unrealizedPnl: actual.unrealizedPnl,
          totalPnl: actual.totalPnl,
          intervalReturn: 0,
        });
        continue;
      }
      nav = 1 + actual.return;
      points.push({
        date: pointDate,
        nav,
        return: actual.return,
        value: actual.currentValue,
        totalCost: actual.totalCost,
        realizedPnl: actual.realizedPnl,
        unrealizedPnl: actual.unrealizedPnl,
        totalPnl: actual.totalPnl,
        intervalReturn: actual.return - (points.at(-1)?.return || 0),
      });
    }
  }

  for (const currentDate of actualMode ? [] : tradingDates) {
    const currentValue = valueAt(currentDate);
    if (!previousDate) {
      if (!(currentValue > 0)) continue;
      // The instrument curve intentionally starts at that day's official
      // close. (The actual-profit curve is built in the branch above.)
      const openingValue = currentValue;
      if (!(openingValue > 0)) continue;
      points.push({ date: currentDate, nav, return: 0, value: currentValue, intervalReturn: 0 });
      previousDate = currentDate;
      previousValue = openingValue;
      continue;
    }
    const inInterval = item => {
      const date = dateKey(item.date);
      return date > previousDate && date <= currentDate;
    };
    // Positive means capital entered the tracked holdings; negative means it
    // left through a sell. At day-level precision trades are treated as
    // end-of-day flows, which also handles a full liquidation without a -100%.
    const intervalFlows = flows.filter(flow => relevantIdentities.has(flowIdentity(flow)) && inInterval(flow));
    const buyCapital = intervalFlows.filter(flow => flow.type === 'BUY')
      .reduce((sum, flow) => sum + Math.abs(finite(flow.amount)), 0);
    const sellProceeds = intervalFlows.filter(flow => flow.type === 'SELL')
      .reduce((sum, flow) => sum + Math.abs(finite(flow.amount)), 0);
    const externalFlow = buyCapital - sellProceeds;
    const investmentIncome = adjustments.filter(inInterval).reduce((sum, item) => sum + finite(item.amount), 0);
    if (previousValue > 0) {
      // Transaction rows have day-level precision, not an exact execution
      // time. Value newly bought shares at their actual execution price on
      // the entry interval, then switch to official closes from the next
      // trading day. This prevents a manual/broker trade date mismatch from
      // manufacturing an immediate gain or loss. Buys enter at the start of
      // the interval; sell proceeds leave at the end. The instrument curve
      // keeps the historical behavior for comparison: only the first close
      // is its baseline, while later buys are still cash-flow neutralized.
      const intervalBuyAdjustment = buyValuationAdjustment(intervalFlows, currentDate);
      const performanceEndingValue = currentValue + intervalBuyAdjustment + sellProceeds + investmentIncome;
      const capitalBase = previousValue + buyCapital;
      const intervalReturn = capitalBase > 0 ? performanceEndingValue / capitalBase - 1 : 0;
      if (Number.isFinite(intervalReturn) && intervalReturn > -1) {
        nav *= 1 + intervalReturn;
        points.push({ date: currentDate, nav, return: nav - 1, value: currentValue, previousValue, externalFlow, buyCapital, sellProceeds, investmentIncome, intervalReturn });
      }
    } else if (currentValue > 0) {
      // A position was reopened after the portfolio had no invested balance.
      // Resume the existing NAV level; the new buy itself is not performance.
      points.push({ date: currentDate, nav, return: nav - 1, value: currentValue, externalFlow, investmentIncome, intervalReturn: 0 });
    }
    previousDate = currentDate;
    previousValue = currentValue;
  }

  // The FIFO summary also contains positions for which no official daily
  // history exists (for example private/unlisted holdings).  Their current
  // value is still valid for the transaction summary, but they cannot add
  // historical points to the price-reconstructed curve.  When the caller
  // supplies the displayed summary return, reconcile only the final point so
  // the chart and the headline never report two different current returns.
  let reconciledToTradeReturn = false;
  if (actualMode && targetReturn != null && points.length) {
    const last = points.at(-1);
    if (Math.abs(finite(last.return) - targetReturn) > 1e-9) {
      const nav = Math.max(0, 1 + targetReturn);
      points[points.length - 1] = {
        ...last,
        nav,
        return: targetReturn,
        reconciledToTradeReturn: true,
      };
      reconciledToTradeReturn = true;
    }
  }

  return {
    points,
    markets: selectedMarkets,
    firstDate: points[0]?.date,
    lastDate: points.at(-1)?.date,
    requestedDays,
    periodStart: points[0]?.date || window.start,
    periodEnd: points.at(-1)?.date || window.end,
    historyIncomplete: false,
    incompleteSymbols,
    excludedHistorySymbols,
    missingHistorySymbols: [],
    reconstructedFromPrices: true,
    curveMode,
    reconciledToTradeReturn,
    priceRequestCount: supportedRequests.length,
    reason: points.length < 2 ? '所選期間可用的歷史收盤價不足 2 個交易日' : '',
  };
};

const SNAPSHOT_CATEGORY_BY_MARKET = {
  TW: 'TW',
  US: 'US',
  CRYPTO: 'Crypto',
};

const PERFORMANCE_SNAPSHOT_CATEGORY_BY_MARKET = {
  TW: 'PERF_TW',
  US: 'PERF_US',
  CRYPTO: 'PERF_CRYPTO',
};

const fetchCategorySnapshots = async userId => {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('category_snapshots')
      .select('date, category, value')
      .eq('user_id', userId)
      .in('category', [
        ...Object.values(SNAPSHOT_CATEGORY_BY_MARKET),
        ...Object.values(PERFORMANCE_SNAPSHOT_CATEGORY_BY_MARKET),
      ])
      .order('date', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }
  return rows;
};

const dateKey = value => String(value || '').slice(0, 10);
const isMissingPerformanceIgnoreColumn = error => {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return ['42703', 'PGRST204', 'PGRST205'].includes(code)
    || /ignored_from_performance|column .* does not exist/i.test(message);
};

/**
 * Time-weighted NAV curve. Buy transactions are contributions to the stock-only
 * portfolio and sells are withdrawals, so neither creates a false return jump.
 * Dividends and fees remain investment performance and are included in return.
 */
export const calculateNavSeries = (context, market = 'ALL', requestedDays = 'ALL') => {
  const availableMarkets = (context?.markets || []).filter(key => SNAPSHOT_CATEGORY_BY_MARKET[key]);
  const selectedMarkets = market === 'ALL' ? availableMarkets : [market].filter(key => SNAPSHOT_CATEGORY_BY_MARKET[key]);
  if (!selectedMarkets.length) return { points: [], markets: [], reason: '這個市場尚無可用的績效快照' };
  const excludedMarkets = new Set(context?.excludedMarkets || []);
  const usesDedicatedSnapshots = selectedMarkets.some(key => excludedMarkets.has(key));

  // `category_snapshots` existed before performance tracking was enabled and
  // is also used by the asset-trend screen. Older rows can therefore contain
  // assets that were later deleted/reclassified without a matching SELL. If
  // those rows are treated as one continuous portfolio, removing an asset is
  // incorrectly reported as an investment loss. The performance baseline is
  // the first point where the tracked portfolio composition is known, so NAV
  // must never reach behind it.
  const trackingStartDate = dateKey(context?.performanceStartDate);
  const performanceBaselines = context?.performanceBaselines || {};
  const openingValuesByMarket = Object.fromEntries(selectedMarkets.map(key => [
    key,
    finite(performanceBaselines[key]),
  ]));
  const openingValue = Object.values(openingValuesByMarket).reduce((sum, value) => sum + value, 0);
  // The initialization baseline contains every asset that existed at that
  // time. Once a user excludes an asset, that aggregate baseline can no
  // longer be compared with the exclusion-aware PERF_* snapshots. Wait for
  // two dedicated snapshots instead of manufacturing a large false loss.
  const hasTrackingBaseline = Boolean(trackingStartDate && openingValue > 0 && !usesDedicatedSnapshots);

  const sourceCategory = Object.fromEntries(selectedMarkets.map(key => [
    key,
    excludedMarkets.has(key)
      ? PERFORMANCE_SNAPSHOT_CATEGORY_BY_MARKET[key]
      : SNAPSHOT_CATEGORY_BY_MARKET[key],
  ]));
  const rowsByMarket = Object.fromEntries(selectedMarkets.map(key => [key, new Map()]));
  for (const row of context?.categorySnapshots || []) {
    const matchedMarket = selectedMarkets.find(key => sourceCategory[key] === row.category);
    if (!matchedMarket) continue;
    rowsByMarket[matchedMarket].set(dateKey(row.date), finite(row.value));
  }

  const commonDates = selectedMarkets
    .map(key => new Set(rowsByMarket[key].keys()))
    .reduce((common, dates) => new Set([...common].filter(date => dates.has(date))));

  // A quote/API outage can write one very small (or very large) aggregate
  // snapshot and then recover on the next snapshot. Treat that single-day
  // round-trip as a data-quality gap instead of turning it into a real 95%+
  // portfolio drawdown. This keeps the curve continuous while retaining
  // genuine multi-day moves.
  const snapshotTotal = date => selectedMarkets.reduce(
    (sum, key) => sum + finite(rowsByMarket[key].get(date)),
    0,
  );
  const orderedCommonDates = [...commonDates].sort();
  const transientSnapshotDates = new Set();
  for (let index = 1; index < orderedCommonDates.length - 1; index += 1) {
    const previous = snapshotTotal(orderedCommonDates[index - 1]);
    const current = snapshotTotal(orderedCommonDates[index]);
    const next = snapshotTotal(orderedCommonDates[index + 1]);
    if (!(previous > 0) || !(current > 0) || !(next > 0)) continue;
    const fallsAndRecovers = current / previous < 0.2 && next / current > 5;
    const spikesAndReverts = current / previous > 5 && current / next > 5;
    if (fallsAndRecovers || spikesAndReverts) transientSnapshotDates.add(orderedCommonDates[index]);
  }

  const transactionFlows = (context?.transactionFlows || [])
    .filter(flow => selectedMarkets.includes(flow.market) && !flow.synthetic)
    .sort((a, b) => dateMs(a.date) - dateMs(b.date));
  const ignoredTransactionFlows = (context?.ignoredTransactionFlows || [])
    .filter(flow => selectedMarkets.includes(flow.market) && !flow.synthetic)
    .sort((a, b) => dateMs(a.date) - dateMs(b.date));
  const incompleteKeys = findIncompleteTradeKeys(transactionFlows);
  const incompleteSymbols = findIncompleteTradeHistory(transactionFlows);
  const completeTransactionFlows = transactionFlows.filter(flow => !incompleteKeys.has(tradeFlowKey(flow)));
  const completeIgnoredTransactionFlows = ignoredTransactionFlows.filter(flow => !incompleteKeys.has(tradeFlowKey(flow)));

  // Category snapshots can predate the transaction history in the selected
  // market (for example, an imported holding already existed before its first
  // recorded buy). Starting at the buy amount would then compare a small cash
  // outlay with a full portfolio snapshot and create a false +400% jump.
  // Use the latest complete snapshot on/before the first recorded buy as the
  // opening NAV, so existing holdings are part of the opening balance and the
  // later buy is treated as an external contribution.
  const startFlows = (context?.transactionFlows || [])
    .filter(flow => selectedMarkets.includes(flow.market)
      && flow.type === 'BUY'
      && !incompleteKeys.has(tradeFlowKey(flow)));
  const firstTradeDate = startFlows
    .filter(flow => flow.type === 'BUY')
    .map(flow => dateKey(flow.date))
    .filter(Boolean)
    .sort()[0];
  let dates = orderedCommonDates.filter(date => !transientSnapshotDates.has(date));
  if (hasTrackingBaseline) {
    // Replace any same-day generic category snapshot with the explicit value
    // captured when performance tracking was initialized.
    dates = [trackingStartDate, ...dates.filter(date => date > trackingStartDate)];
  } else if (firstTradeDate) {
    const openingDate = dates.filter(date => date <= firstTradeDate).at(-1)
      || dates.find(date => date >= firstTradeDate);
    dates = openingDate ? dates.filter(date => date >= openingDate) : [];
  }
  const customStartDate = requestedDays && typeof requestedDays === 'object' ? dateKey(requestedDays.start) : null;
  const customEndDate = requestedDays && typeof requestedDays === 'object' ? dateKey(requestedDays.end) : null;
  const parsedRequestedDays = requestedDays === 'ALL' || customStartDate ? null : Math.max(1, Math.floor(finite(requestedDays)));
  let periodStart = dates[0] || null;
  let periodEnd = dates.at(-1) || null;
  if (customStartDate && customEndDate && customStartDate <= customEndDate) {
    const openingDate = dates.filter(date => date < customStartDate).at(-1);
    const windowDates = dates.filter(date => date >= customStartDate && date <= customEndDate);
    dates = [openingDate, ...windowDates].filter((date, index, list) => date && list.indexOf(date) === index);
    periodStart = dates[0] || null;
    periodEnd = dates.at(-1) || null;
  } else if (parsedRequestedDays) {
    // Work with YYYY-MM-DD keys in UTC. Using local midnight followed by
    // toISOString() can shift the cutoff by one day in Asia/Taipei, which
    // previously made a 7-day selection render the full history.
    // Use the latest available snapshot as the right edge. The app can be
    // opened after market close (or with a stale context.today), but the chart
    // must still show the latest stored trading day rather than an old window.
    const todayKey = dateKey(context?.today || new Date().toISOString());
    const periodEndKey = dates.at(-1) || todayKey;
    const cutoff = new Date(`${periodEndKey}T00:00:00.000Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - (parsedRequestedDays - 1));
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    const openingDate = dates.filter(date => date < cutoffKey).at(-1);
    const windowDates = dates.filter(date => date >= cutoffKey && date <= periodEndKey);
    dates = [openingDate, ...windowDates].filter((date, index, list) => date && list.indexOf(date) === index);
    periodStart = dates[0] || null;
    periodEnd = dates.at(-1) || null;
  }
  if (dates.length < 2) {
    return {
      points: [],
      markets: selectedMarkets,
      requestedDays,
      periodStart,
      periodEnd,
      historyIncomplete: false,
      incompleteSymbols,
      ignoredSnapshotCount: transientSnapshotDates.size,
      reason: usesDedicatedSnapshots
        ? '排除標的後需重新累積至少 2 個每日績效快照'
        : '至少需要 2 個不同日期的資產快照',
    };
  }

  const navTransactionFlows = [...completeTransactionFlows, ...completeIgnoredTransactionFlows]
    .filter(flow => !hasTrackingBaseline || dateKey(flow.date) > trackingStartDate)
    .sort((a, b) => dateMs(a.date) - dateMs(b.date));

  const adjustments = (context?.historicalAdjustments || [])
    .filter(flow => selectedMarkets.includes(flow.market))
    .filter(flow => !hasTrackingBaseline || dateKey(flow.date) > trackingStartDate)
    .sort((a, b) => dateMs(a.date) - dateMs(b.date));
  const valuesForDate = date => date === trackingStartDate && hasTrackingBaseline
    ? openingValuesByMarket
    : Object.fromEntries(selectedMarkets.map(key => [
      key,
      finite(rowsByMarket[key].get(date)),
    ]));
  const totalForDate = date => Object.values(valuesForDate(date)).reduce((sum, value) => sum + value, 0);
  let nav = 1;
  const points = [{ date: dates[0], nav, return: 0, valuesByMarket: valuesForDate(dates[0]) }];

  for (let index = 1; index < dates.length; index += 1) {
    const previousDate = dates[index - 1];
    const currentDate = dates[index];
    const previousValue = totalForDate(previousDate);
    const currentValue = totalForDate(currentDate);
    if (!(previousValue > 0)) continue;
    const inWindow = flow => {
      const flowDate = dateKey(flow.date);
      // If the opening snapshot and first trade share a date, the trade still
      // belongs to the first measured interval; otherwise use half-open daily
      // windows so a flow is never counted twice.
      const startsAtOpening = index === 1 && flowDate === previousDate;
      return (startsAtOpening || flowDate > previousDate) && flowDate <= currentDate;
    };
    const contribution = navTransactionFlows
      .filter(inWindow)
      .reduce((sum, flow) => sum - finite(flow.amount), 0);
    const investmentIncome = adjustments
      .filter(inWindow)
      .reduce((sum, flow) => sum + finite(flow.amount), 0);
    // Daily category snapshots are end-of-day valuations while imported trade
    // records only carry a trading date. Treat the day's external cash flow as
    // entering at the start of this interval. Subtracting it from the ending
    // value (the old formula) made a buy on a snapshot date look like a large
    // loss whenever that snapshot was written just before the trade.
    const capitalBase = previousValue + contribution;
    const intervalReturn = (currentValue + investmentIncome) / capitalBase - 1;
    if (!Number.isFinite(intervalReturn) || capitalBase <= 0 || intervalReturn <= -1) continue;
    nav *= 1 + intervalReturn;
    points.push({
      date: currentDate,
      nav,
      return: nav - 1,
      intervalReturn,
      value: currentValue,
      contribution,
      investmentIncome,
      valuesByMarket: valuesForDate(currentDate),
    });
  }
  return {
    points,
    markets: selectedMarkets,
    firstDate: points[0]?.date,
    lastDate: points.at(-1)?.date,
    requestedDays,
    periodStart,
    periodEnd,
    historyIncomplete: false,
    incompleteSymbols,
    ignoredSnapshotCount: transientSnapshotDates.size,
    usesDedicatedSnapshots,
    trackingStartDate: hasTrackingBaseline ? trackingStartDate : null,
    limitedByTrackingStart: hasTrackingBaseline && (() => {
      const requestedStart = customStartDate || (() => {
        if (!parsedRequestedDays || !periodEnd) return null;
        const start = new Date(`${periodEnd}T00:00:00.000Z`);
        start.setUTCDate(start.getUTCDate() - (parsedRequestedDays - 1));
        return start.toISOString().slice(0, 10);
      })();
      return Boolean(requestedStart && requestedStart < trackingStartDate);
    })(),
    reason: points.length < 2 ? '可用快照不足以計算連續報酬' : '',
  };
};

export const combineBenchmarkSeries = (navSeries, rowsByBenchmark = {}) => {
  const points = navSeries?.points || [];
  const markets = navSeries?.markets || [];
  if (points.length < 2 || !markets.length) return points;
  const descriptors = Array.isArray(rowsByBenchmark)
    ? rowsByBenchmark
    : Object.entries(rowsByBenchmark).map(([key, value]) => ({
      key,
      market: value?.market || key,
      symbol: value?.symbol || key,
      label: value?.label || key,
      rows: Array.isArray(value) ? value : value?.rows,
    }));
  const normalizedRows = descriptors.map(descriptor => ({
    ...descriptor,
    rows: (descriptor.rows || [])
      .map(row => ({ date: dateKey(row.time || row.date), close: finite(row.close) }))
      .filter(row => row.date && row.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date)),
  }));
  const closeOnOrBefore = (rows, date) => {
    const previous = rows.filter(row => row.date <= date).at(-1);
    return previous || rows.find(row => row.date >= date) || null;
  };
  const openingClose = normalizedRows.map(descriptor => ({
    ...descriptor,
    close: closeOnOrBefore(descriptor.rows, points[0].date)?.close || 0,
  }));
  return points.map(point => {
    const benchmarkValues = Object.fromEntries(openingClose.map(descriptor => {
      const close = closeOnOrBefore(descriptor.rows, point.date)?.close || 0;
      const benchmarkNav = close > 0 && descriptor.close > 0 ? close / descriptor.close : null;
      return [descriptor.key, benchmarkNav];
    }));
    const firstBenchmarkNav = normalizedRows.length ? benchmarkValues[normalizedRows[0].key] : null;
    return {
      ...point,
      benchmarkValues,
      // Keep these fields for the summary card and existing callers. They
      // represent the first selected benchmark when several are displayed.
      benchmarkNav: firstBenchmarkNav,
      benchmarkReturn: Number.isFinite(firstBenchmarkNav) ? firstBenchmarkNav - 1 : null,
      alpha: Number.isFinite(firstBenchmarkNav) ? point.nav - firstBenchmarkNav : null,
    };
  });
};

/** Calculate an actual trailing-period money-weighted return from a stored opening snapshot. */
export const calculatePerformanceWindow = (context, market, requestedDays) => {
  const daysRequested = Math.max(1, Math.floor(finite(requestedDays)));
  const today = new Date(context?.today || Date.now());
  const todayKey = today.toISOString().slice(0, 10);
  const todayDate = new Date(`${todayKey}T00:00:00.000Z`);
  const cutoff = new Date(`${todayKey}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - daysRequested);
  const cutoffMs = cutoff.getTime();
  const selectedMarkets = market === 'ALL' ? (context?.markets || []).filter(key => SNAPSHOT_CATEGORY_BY_MARKET[key]) : [market];
  const categories = selectedMarkets.map(key => SNAPSHOT_CATEGORY_BY_MARKET[key]).filter(Boolean);
  if (!categories.length) return { unavailable: true, reason: '這個市場尚無可用的歷史快照' };

  const snapshotsByDate = (context?.categorySnapshots || []).reduce((map, row) => {
    if (!categories.includes(row.category)) return map;
    const key = String(row.date).slice(0, 10);
    if (!map[key]) map[key] = {};
    map[key][row.category] = finite(row.value);
    return map;
  }, {});
  const candidateDates = Object.keys(snapshotsByDate)
    .filter(date => date < todayKey)
    .sort((a, b) => Math.abs(dateMs(`${a}T00:00:00.000Z`) - cutoffMs) - Math.abs(dateMs(`${b}T00:00:00.000Z`) - cutoffMs));
  const firstDate = candidateDates[0];
  if (!firstDate) return { unavailable: true, reason: '尚未累積兩個交易日的資產快照' };

  const openingValue = categories.reduce((sum, category) => sum + finite(snapshotsByDate[firstDate][category]), 0);
  const firstMs = dateMs(`${firstDate}T00:00:00.000Z`);
  const tradeFlows = (context?.transactionFlows || []).filter(flow =>
    selectedMarkets.includes(flow.market) && dateMs(flow.date) > firstMs && dateMs(flow.date) <= dateMs(today)
  );
  const adjustments = (context?.historicalAdjustments || []).filter(flow =>
    selectedMarkets.includes(flow.market) && dateMs(flow.date) > firstMs && dateMs(flow.date) <= dateMs(today)
  );
  const holdingsValue = selectedMarkets.reduce((sum, key) => sum + finite(context?.historicalHoldingsByMarket?.[key]), 0);
  const flows = [
    ...(openingValue > 0 ? [{ amount: -openingValue, date: firstDate }] : []),
    ...tradeFlows.map(flow => ({ amount: flow.amount, date: flow.date })),
    ...adjustments.map(flow => ({ amount: flow.amount, date: flow.date })),
    ...(holdingsValue > 0 ? [{ amount: holdingsValue, date: todayDate }] : []),
  ];
  const calculationFlows = [
    ...(openingValue > 0 ? [{ kind: 'opening_value', amount: -openingValue, date: firstDate }] : []),
    ...tradeFlows.map(flow => ({ ...flow, kind: flow.type === 'BUY' ? 'trade_buy' : 'trade_sell' })),
    ...adjustments,
    ...(holdingsValue > 0 ? [{ kind: 'closing_value', amount: holdingsValue, date: todayDate }] : []),
  ].sort((a, b) => dateMs(a.date) - dateMs(b.date));
  const actualDays = Math.max(0, Math.round((dateMs(todayDate) - firstMs) / 86_400_000));
  const xirr = actualDays > 0 ? calculateXirr(flows) : null;
  const periodReturn = Number.isFinite(xirr) && xirr > -1
    ? ((1 + xirr) ** (actualDays / 365.25)) - 1
    : null;
  const grossBuys = tradeFlows.filter(flow => flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const grossSells = tradeFlows.filter(flow => flow.amount > 0).reduce((sum, flow) => sum + flow.amount, 0);
  const income = adjustments.filter(flow => flow.amount > 0).reduce((sum, flow) => sum + flow.amount, 0);
  const fees = adjustments.filter(flow => flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const affectedByExclusion = (context?.excludedMarkets || []).some(key => selectedMarkets.includes(key));
  return {
    market,
    historical: true,
    periodWindow: true,
    requestedDays: daysRequested,
    actualDays,
    partialWindow: Math.abs(actualDays - daysRequested) > 1,
    firstDate,
    openingValue,
    holdingsValue,
    currentValue: holdingsValue,
    grossBuys,
    grossSells,
    income,
    fees,
    netInvested: openingValue + grossBuys - grossSells - income + fees,
    transactionCount: tradeFlows.length,
    syntheticCount: tradeFlows.filter(flow => flow.synthetic).length,
    estimatedFx: tradeFlows.some(flow => flow.currency && flow.currency !== context?.baseCurrency),
    affectedByExclusion,
    xirr,
    periodReturn,
    calculationFlows,
    entries: [],
  };
};

/**
 * FIFO trade P&L. The selected window determines which sells contribute to
 * realized P&L and which still-open buys contribute to unrealized P&L. FIFO
 * matching always processes the full trade history, so a sell inside the window
 * can still use a buy from before the window as its cost basis.
 */
export const calculateTradePerformance = (context, market = 'ALL', requestedDays = 'ALL') => {
  const selectedMarkets = market === 'ALL' ? (context?.markets || []) : [market];
  const customStartDate = requestedDays && typeof requestedDays === 'object' ? dateKey(requestedDays.start) : null;
  const customEndDate = requestedDays && typeof requestedDays === 'object' ? dateKey(requestedDays.end) : null;
  const requested = requestedDays === 'ALL' || customStartDate ? null : Math.max(1, Math.floor(finite(requestedDays)));
  const now = new Date(context?.today || Date.now());
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const cutoff = requested ? new Date(todayStart) : null;
  if (cutoff) cutoff.setDate(cutoff.getDate() - (requested - 1));
  const cutoffMs = customStartDate ? dateMs(`${customStartDate}T00:00:00.000Z`) : (cutoff?.getTime() ?? null);
  const endMs = customEndDate ? dateMs(`${customEndDate}T23:59:59.999Z`) : null;
  const flows = (context?.transactionFlows || [])
    .filter(flow => !flow.synthetic && selectedMarkets.includes(flow.market))
    .sort((a, b) => dateMs(a.date) - dateMs(b.date));
  const incompleteKeys = findIncompleteTradeKeys(flows);
  const incompleteSymbols = findIncompleteTradeHistory(flows);
  const completeFlows = flows.filter(flow => !incompleteKeys.has(tradeFlowKey(flow)));
  const periodFlows = completeFlows.filter(flow => (cutoffMs == null || dateMs(flow.date) >= cutoffMs) && (endMs == null || dateMs(flow.date) <= endMs));
  const valuations = context?.assetValuations || {};
  const grouped = new Map();

  for (const flow of completeFlows) {
    const key = performanceIdentity(flow);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(flow);
  }

  const assetRows = [];
  const ignoredSymbols = new Set();
  let ignoredSellCount = 0;

  for (const [assetId, assetFlows] of grouped.entries()) {
    const first = assetFlows[0] || {};
    const lots = [];
    let realizedCost = 0;
    let sellProceeds = 0;
    let ignoredSellShares = 0;
    let matchedSellCount = 0;

    for (const flow of assetFlows) {
      const shares = Math.abs(finite(flow.shares));
      const value = Math.abs(finite(flow.amount));
      if (!(shares > 0) || !(value > 0)) continue;
      if (flow.type === 'BUY') {
        lots.push({ shares, remaining: shares, cost: value, unitCost: value / shares, boughtAt: dateMs(flow.date) });
        continue;
      }
      if (flow.type !== 'SELL') continue;
      const sellIsInWindow = (cutoffMs == null || dateMs(flow.date) >= cutoffMs) && (endMs == null || dateMs(flow.date) <= endMs);

      let remainingToSell = shares;
      let matchedShares = 0;
      let matchedCost = 0;
      for (const lot of lots) {
        if (remainingToSell <= 1e-8) break;
        if (lot.remaining <= 1e-8) continue;
        const matched = Math.min(lot.remaining, remainingToSell);
        matchedCost += matched * lot.unitCost;
        matchedShares += matched;
        lot.remaining -= matched;
        remainingToSell -= matched;
      }
      if (sellIsInWindow && matchedShares > 1e-8) {
        realizedCost += matchedCost;
        sellProceeds += value * (matchedShares / shares);
        matchedSellCount += 1;
      }
      if (sellIsInWindow && remainingToSell > 1e-8) {
        ignoredSellCount += 1;
        ignoredSellShares += remainingToSell;
        ignoredSymbols.add(flow.symbol || flow.assetName || '未識別標的');
      }
    }

    const valuation = valuations[assetId] || {};
    const eligibleOpenLots = cutoffMs == null ? lots : lots.filter(lot => lot.boughtAt >= cutoffMs);
    const availableOpenShares = eligibleOpenLots.reduce((sum, lot) => sum + lot.remaining, 0);
    const currentShares = Math.max(0, finite(valuation.currentShares));
    const openShares = Math.min(availableOpenShares, currentShares);
    let sharesToValue = openShares;
    let openCost = 0;
    for (const lot of eligibleOpenLots) {
      if (sharesToValue <= 1e-8) break;
      if (lot.remaining <= 1e-8) continue;
      const used = Math.min(lot.remaining, sharesToValue);
      openCost += used * lot.unitCost;
      sharesToValue -= used;
    }
    const currentUnitValue = currentShares > 0 ? finite(valuation.currentValue) / currentShares : 0;
    const currentValue = openShares * currentUnitValue;
    const realizedPnl = sellProceeds - realizedCost;
    const unrealizedPnl = currentValue - openCost;
    const totalPnl = realizedPnl + unrealizedPnl;
    if (realizedCost > 0 || openCost > 0 || ignoredSellShares > 0) {
      assetRows.push({
        assetId,
        symbol: first.symbol || valuation.symbol || first.assetName || '未識別標的',
        name: first.assetName || valuation.name || '',
        market: first.market || valuation.market,
        realizedCost,
        sellProceeds,
        realizedPnl,
        matchedSellCount,
        openShares,
        openCost,
        currentValue,
        unrealizedPnl,
        totalPnl,
        ignoredSellShares,
      });
    }
  }

  const totals = assetRows.reduce((sum, row) => ({
    realizedCost: sum.realizedCost + row.realizedCost,
    sellProceeds: sum.sellProceeds + row.sellProceeds,
    realizedPnl: sum.realizedPnl + row.realizedPnl,
    openCost: sum.openCost + row.openCost,
    currentValue: sum.currentValue + row.currentValue,
    unrealizedPnl: sum.unrealizedPnl + row.unrealizedPnl,
    totalPnl: sum.totalPnl + row.totalPnl,
  }), { realizedCost: 0, sellProceeds: 0, realizedPnl: 0, openCost: 0, currentValue: 0, unrealizedPnl: 0, totalPnl: 0 });
  const totalCost = totals.realizedCost + totals.openCost;
  const firstDate = periodFlows.length ? periodFlows[0].date : null;

  return {
    market,
    requestedDays: requestedDays,
    actualDays: customStartDate && customEndDate
      ? Math.max(1, Math.floor((dateMs(`${customEndDate}T00:00:00.000Z`) - dateMs(`${customStartDate}T00:00:00.000Z`)) / 86_400_000) + 1)
      : (requested || (firstDate ? Math.max(0, Math.floor((now.getTime() - dateMs(firstDate)) / 86_400_000)) : 0)),
    firstDate,
    transactionCount: periodFlows.length,
    assetRows: assetRows.sort((a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl)),
    ignoredSellCount,
    ignoredSymbols: [...ignoredSymbols],
    ignoredIncompleteSymbols: incompleteSymbols,
    ...totals,
    totalCost,
    realizedReturn: totals.realizedCost > 0 ? totals.realizedPnl / totals.realizedCost : null,
    unrealizedReturn: totals.openCost > 0 ? totals.unrealizedPnl / totals.openCost : null,
    totalReturn: totalCost > 0 ? totals.totalPnl / totalCost : null,
  };
};

/** Build the same current-position context used by the FIFO performance screen. */
export const buildCurrentFifoPerformanceContext = (valuedAssets = [], transactionFlows = [], today = new Date().toISOString()) => {
  const investmentAssets = (valuedAssets || []).filter(asset => asset?.category === 'investment');
  const excludedIdentities = new Set(investmentAssets
    .filter(asset => asset.exclude_from_performance)
    .map(performanceIdentity));
  const assetValuations = {};

  for (const asset of investmentAssets) {
    if (!(finite(asset.current_shares) > 0)) continue;
    const identity = performanceIdentity(asset);
    if (excludedIdentities.has(identity)) continue;
    const market = normalizePerformanceMarket(asset.market_type);
    if (!assetValuations[identity]) {
      assetValuations[identity] = {
        assetId: identity,
        symbol: asset.symbol,
        name: asset.name,
        market,
        currentShares: 0,
        currentValue: 0,
      };
    }
    assetValuations[identity].currentShares += finite(asset.current_shares);
    assetValuations[identity].currentValue += finite(asset.converted_amount);
  }

  const includedFlows = (transactionFlows || []).filter(flow => !excludedIdentities.has(performanceIdentity(flow)));
  const markets = [...new Set([
    ...Object.values(assetValuations).map(asset => asset.market),
    ...includedFlows.map(flow => normalizePerformanceMarket(flow.market)),
  ])].sort();

  return { markets, transactionFlows: includedFlows, assetValuations, today };
};

/** XIRR with irregular dates. Cash invested is negative; money returned is positive. */
export const calculateXirr = cashFlows => {
  const flows = (cashFlows || [])
    .map(flow => ({ amount: finite(flow.amount), date: new Date(flow.date) }))
    .filter(flow => flow.amount !== 0 && Number.isFinite(flow.date.getTime()))
    .sort((a, b) => a.date - b.date);
  if (flows.length < 2 || !flows.some(flow => flow.amount < 0) || !flows.some(flow => flow.amount > 0)) return null;
  const start = flows[0].date.getTime();
  const years = flow => (flow.date.getTime() - start) / 31_557_600_000;
  const npv = rate => flows.reduce((sum, flow) => sum + flow.amount / ((1 + rate) ** years(flow)), 0);
  let low = -0.9999;
  let high = 1;
  let lowValue = npv(low);
  let highValue = npv(high);
  for (let i = 0; i < 30 && Math.sign(lowValue) === Math.sign(highValue); i += 1) {
    high = high * 2 + 1;
    highValue = npv(high);
  }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || Math.sign(lowValue) === Math.sign(highValue)) return null;
  for (let i = 0; i < 160; i += 1) {
    const mid = (low + high) / 2;
    const value = npv(mid);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) < 1e-8) return mid;
    if (Math.sign(value) === Math.sign(lowValue)) {
      low = mid;
      lowValue = value;
    } else {
      high = mid;
      highValue = value;
    }
  }
  return (low + high) / 2;
};

/**
 * Broker APIs can expose only a rolling transaction window. If that window
 * starts with a sell, treating the proceeds as a complete investment return
 * creates an extreme, false XIRR because the corresponding purchase is absent.
 */
const tradeFlowKey = flow => flow?.assetId || flow?.symbol || flow?.id;

const findIncompleteTradeKeys = tradeFlows => {
  const positions = new Map();
  const incompleteKeys = new Set();
  const ordered = [...(tradeFlows || [])].sort((a, b) => {
    const byDate = dateMs(a.date) - dateMs(b.date);
    if (byDate !== 0) return byDate;
    // Transaction dates are day-level in the imported history. When a buy and
    // sell share a day, process the buy first so an intra-day rollover is not
    // incorrectly reported as a missing cost basis.
    if (a.type === b.type) return 0;
    return a.type === 'BUY' ? -1 : 1;
  });
  for (const flow of ordered) {
    if (flow.synthetic) continue;
    const key = tradeFlowKey(flow);
    const shares = Math.abs(finite(flow.shares));
    if (!key || !(shares > 0)) continue;
    const position = positions.get(key) || 0;
    if (flow.type === 'BUY') {
      positions.set(key, position + shares);
      continue;
    }
    if (flow.type === 'SELL') {
      if (shares > position + 1e-8) incompleteKeys.add(key);
      positions.set(key, Math.max(0, position - shares));
    }
  }
  return incompleteKeys;
};

const findIncompleteTradeHistory = tradeFlows => {
  const incompleteKeys = findIncompleteTradeKeys(tradeFlows);
  return [...new Set((tradeFlows || [])
    .filter(flow => incompleteKeys.has(tradeFlowKey(flow)))
    .map(flow => flow.symbol || flow.assetName || '未識別標的'))];
};

const externalFlowAmount = (entry, includeTransfers = false) => {
  const amount = Math.abs(finite(entry.amount_base_at_event));
  if (entry.kind === 'deposit') return -amount;
  if (entry.kind === 'withdrawal') return amount;
  if (includeTransfers && entry.kind === 'transfer_in') return -amount;
  if (includeTransfers && entry.kind === 'transfer_out') return amount;
  return 0;
};

export const fetchInvestmentTransactions = async (userId, assetIds = null) => {
  const scopedAssetIds = Array.isArray(assetIds)
    ? [...new Set(assetIds.filter(Boolean).map(String))]
    : null;
  if (scopedAssetIds?.length === 0) return [];
  const rows = [];
  const pageSize = 1000;
  let includeIgnoreColumn = true;
  for (let from = 0; ; from += pageSize) {
    const selectColumns = includeIgnoreColumn
      ? 'id, asset_id, type, shares, price, total_amount, fee, tax, trans_date, external_source, affects_position, ignored_from_performance, assets!inner(id, user_id, name, symbol, category, market_type, currency, exclude_from_performance)'
      : 'id, asset_id, type, shares, price, total_amount, fee, tax, assets!inner(id, user_id, name, symbol, category, market_type, currency, exclude_from_performance)';
    const makeQuery = columns => {
      let query = supabase
      .from('transactions')
        .select(columns)
        .eq('assets.user_id', userId)
        .eq('assets.category', 'investment');
      if (scopedAssetIds) query = query.in('asset_id', scopedAssetIds);
      return query
        .order('trans_date', { ascending: true })
        .range(from, from + pageSize - 1);
    };
    let { data, error } = await makeQuery(selectColumns);
    if (error && includeIgnoreColumn && isMissingPerformanceIgnoreColumn(error)) {
      // Keep existing users functional while the new migration is pending.
      // The ignore action itself remains unavailable until the column exists.
      includeIgnoreColumn = false;
      ({ data, error } = await makeQuery(selectColumns.replace('ignored_from_performance, ', '')));
    }
    if (error) throw error;
    rows.push(...(data || []).map(row => ({ ...row, ignored_from_performance: Boolean(row.ignored_from_performance) })));
    if ((data || []).length < pageSize) break;
  }
  return rows;
};

export const buildInvestmentTransactionFlows = async ({
  transactions = [],
  baseCurrency,
  rates,
  excludedAssetIds = new Set(),
  respectAssetExclusion = true,
} = {}) => {
  const transactionFlows = [];
  const ignoredTransactionFlows = [];
  const excludedIds = excludedAssetIds instanceof Set ? excludedAssetIds : new Set(excludedAssetIds || []);

  for (const transaction of transactions) {
    if (!['BUY', 'SELL'].includes(transaction.type)) continue;
    const asset = Array.isArray(transaction.assets) ? transaction.assets[0] : transaction.assets;
    if (!asset || (respectAssetExclusion && asset.exclude_from_performance) || excludedIds.has(transaction.asset_id)) continue;
    const grossAmount = Math.abs(finite(transaction.total_amount, finite(transaction.shares) * finite(transaction.price)));
    const nativeAmount = transaction.type === 'BUY'
      ? grossAmount + finite(transaction.fee) + finite(transaction.tax)
      : Math.max(grossAmount - finite(transaction.fee) - finite(transaction.tax), 0);
    const amountBase = await convertToBaseCurrency(nativeAmount, asset.currency, baseCurrency, rates);
    const flow = {
      id: transaction.id,
      assetId: transaction.asset_id,
      symbol: asset.symbol,
      assetName: asset.name,
      market: normalizePerformanceMarket(asset.market_type),
      currency: asset.currency,
      type: transaction.type,
      shares: finite(transaction.shares),
      price: finite(transaction.price),
      amountNative: nativeAmount,
      amount: transaction.type === 'BUY' ? -Math.abs(amountBase) : Math.abs(amountBase),
      date: transaction.trans_date,
      synthetic: false,
      ignoredFromPerformance: Boolean(transaction.ignored_from_performance),
    };
    if (flow.ignoredFromPerformance) ignoredTransactionFlows.push(flow);
    else transactionFlows.push(flow);
  }

  return { transactionFlows, ignoredTransactionFlows };
};

export async function setAssetPerformanceExclusion(assetIds, excluded) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('登入已失效');
  const ids = (Array.isArray(assetIds) ? assetIds : [assetIds]).filter(Boolean);
  if (!ids.length) throw new Error('找不到要更新的資產');
  const { error } = await supabase
    .from('assets')
    .update({ exclude_from_performance: Boolean(excluded) })
    .in('id', ids)
    .eq('user_id', user.id);
  if (error) throw error;
}

export async function initializeInvestmentPerformance({ baseCurrency, marketValues, openingCash }) {
  const startDate = new Date().toISOString().slice(0, 10);
  const currencies = [...new Set(openingCash.map(item => item.currency).filter(Boolean))];
  const rates = await fetchExchangeRatesBatch(currencies, baseCurrency);
  const cashRows = await Promise.all(openingCash.map(async item => ({
    market: normalizePerformanceMarket(item.market),
    currency: String(item.currency || baseCurrency).toUpperCase(),
    amount_native: finite(item.amountNative),
    amount_base_at_event: await convertToBaseCurrency(finite(item.amountNative), item.currency, baseCurrency, rates),
  })));
  const cashByMarket = cashRows.reduce((map, row) => {
    map[row.market] = (map[row.market] || 0) + row.amount_base_at_event;
    return map;
  }, {});
  const markets = [...new Set([...Object.keys(marketValues), ...cashRows.map(item => item.market)])];
  const baselines = markets.map(market => ({
    market,
    opening_value_base: finite(marketValues[market]) + finite(cashByMarket[market]),
  }));
  const { error } = await supabase.rpc('initialize_investment_performance', {
    p_start_date: startDate,
    p_base_currency: baseCurrency,
    p_baselines: baselines,
    p_opening_cash: cashRows,
  });
  if (error) throw error;
}

export async function addInvestmentCashEntry({ market, currency, kind, amount, occurredAt, note, baseCurrency }) {
  const nativeAmount = Math.abs(finite(amount));
  if (!(nativeAmount > 0)) throw new Error('請輸入大於 0 的金額');
  const signed = ['withdrawal', 'fee', 'transfer_out'].includes(kind) ? -nativeAmount : nativeAmount;
  const rates = await fetchExchangeRatesBatch([currency], baseCurrency);
  const baseAmount = await convertToBaseCurrency(nativeAmount, currency, baseCurrency, rates);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('登入已失效');
  const { error } = await supabase.from('investment_cash_ledger').insert({
    user_id: user.id,
    market: normalizePerformanceMarket(market),
    currency: String(currency).toUpperCase(),
    kind,
    amount_native: signed,
    amount_base_at_event: baseAmount,
    occurred_at: new Date(`${occurredAt}T12:00:00`).toISOString(),
    note: note?.trim() || null,
  });
  if (error) throw error;
}

export async function deleteInvestmentCashEntry(id) {
  const { error } = await supabase.from('investment_cash_ledger').delete().eq('id', id).is('transaction_id', null);
  if (error) throw error;
}

export async function loadInvestmentPerformance({ valuedAssets, baseCurrency }) {
  const [{ data: settings, error: settingsError }, { data: baselines, error: baselinesError }, { data: ledger, error: ledgerError }] = await Promise.all([
    supabase.from('investment_performance_settings').select('*').maybeSingle(),
    supabase.from('investment_performance_baselines').select('*'),
    supabase.from('investment_cash_ledger').select('*').order('occurred_at', { ascending: true }),
  ]);
  const missingTable = [settingsError, baselinesError, ledgerError].find(error => error?.code === '42P01' || error?.code === 'PGRST205');
  if (missingTable) return { unavailable: true, error: '投資績效功能尚未啟用，請先套用 Supabase 資料庫更新。' };
  if (settingsError) throw settingsError;
  if (baselinesError) throw baselinesError;
  if (ledgerError) throw ledgerError;
  if (!settings) return { initialized: false };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('登入已失效');
  const [{ data: performanceAssets, error: assetsError }, transactions, categorySnapshots] = await Promise.all([
    supabase
      .from('assets')
      .select('id, name, symbol, market_type, exclude_from_performance')
      .eq('user_id', user.id)
      .eq('category', 'investment')
      .order('name', { ascending: true }),
    fetchInvestmentTransactions(user.id),
    fetchCategorySnapshots(user.id),
  ]);
  if (assetsError) throw assetsError;
  const performanceAssetGroups = Object.values((performanceAssets || []).reduce((groups, asset) => {
    const key = performanceIdentity(asset);
    if (!groups[key]) groups[key] = { ...asset, id: key, ids: [], duplicateCount: 0, exclude_from_performance: false };
    groups[key].ids.push(asset.id);
    groups[key].duplicateCount += 1;
    groups[key].exclude_from_performance = groups[key].exclude_from_performance || Boolean(asset.exclude_from_performance);
    return groups;
  }, {}));
  const excludedAssetIds = new Set(performanceAssetGroups
    .filter(asset => asset.exclude_from_performance)
    .flatMap(asset => asset.ids));

  const allOpenAssets = (valuedAssets || []).filter(asset =>
    asset.category === 'investment' && finite(asset.current_shares) > 0
  );
  const assets = allOpenAssets.filter(asset => !excludedAssetIds.has(asset.id));
  const sumHoldingsByMarket = sourceAssets => sourceAssets.reduce((map, asset) => {
    const market = normalizePerformanceMarket(asset.market_type);
    map[market] = (map[market] || 0) + finite(asset.converted_amount);
    return map;
  }, {});
  const holdingsByMarket = sumHoldingsByMarket(allOpenAssets);
  const historicalHoldingsByMarket = sumHoldingsByMarket(assets);
  const snapshotDate = getTaipeiDateString();
  const snapshotMarkets = [...new Set(allOpenAssets.map(asset => normalizePerformanceMarket(asset.market_type)))]
    .filter(market => PERFORMANCE_SNAPSHOT_CATEGORY_BY_MARKET[market]);
  const currentPerformanceRows = snapshotMarkets.map(market => ({
    user_id: user.id,
    date: snapshotDate,
    category: PERFORMANCE_SNAPSHOT_CATEGORY_BY_MARKET[market],
    value: finite(historicalHoldingsByMarket[market]),
  }));
  if (currentPerformanceRows.length) {
    const { error: snapshotError } = await supabase.from('category_snapshots').upsert(currentPerformanceRows, {
      onConflict: 'user_id,date,category',
    });
    if (snapshotError) console.warn('investment performance snapshot:', snapshotError.message);
  }
  const snapshotsWithCurrentPerformance = [
    ...(categorySnapshots || []).filter(row => !currentPerformanceRows.some(current => (
      current.category === row.category && current.date === dateKey(row.date)
    ))),
    ...currentPerformanceRows.map(({ date, category, value }) => ({ date, category, value })),
  ];

  const currencies = [...new Set([
    ...(ledger || []).map(entry => entry.currency),
    ...transactions.map(transaction => transaction.assets?.currency),
  ].filter(Boolean))];
  const rates = await fetchExchangeRatesBatch(currencies, baseCurrency);
  const cashByMarket = {};
  for (const entry of ledger || []) {
    const market = normalizePerformanceMarket(entry.market);
    const converted = await convertToBaseCurrency(finite(entry.amount_native), entry.currency, baseCurrency, rates);
    cashByMarket[market] = (cashByMarket[market] || 0) + converted;
  }

  const { transactionFlows, ignoredTransactionFlows } = await buildInvestmentTransactionFlows({
    transactions,
    baseCurrency,
    rates,
    excludedAssetIds,
  });

  const transactionAssetIds = new Set(transactionFlows.map(flow => flow.assetId));
  for (const asset of assets) {
    if (transactionAssetIds.has(asset.id) || !(finite(asset.converted_cost) > 0)) continue;
    transactionFlows.push({
      id: `estimated-${asset.id}`,
      assetId: asset.id,
      market: normalizePerformanceMarket(asset.market_type),
      currency: asset.currency,
      type: 'BUY',
      amount: -Math.abs(finite(asset.converted_cost)),
      date: asset.created_at || settings.start_date,
      synthetic: true,
    });
  }

  const historicalAdjustments = [];
  for (const entry of ledger || []) {
    if (!['dividend', 'fee', 'adjustment'].includes(entry.kind)) continue;
    if (entry.asset_id && excludedAssetIds.has(entry.asset_id)) continue;
    const amountBase = finite(entry.amount_base_at_event) || await convertToBaseCurrency(
      Math.abs(finite(entry.amount_native)), entry.currency, baseCurrency, rates,
    );
    historicalAdjustments.push({
      market: normalizePerformanceMarket(entry.market),
      amount: entry.kind === 'fee' ? -Math.abs(amountBase) : Math.sign(finite(entry.amount_native) || 1) * Math.abs(amountBase),
      date: entry.occurred_at,
      kind: entry.kind,
    });
  }

  const baselineMap = Object.fromEntries((baselines || []).map(row => [normalizePerformanceMarket(row.market), finite(row.opening_value_base)]));
  const markets = [...new Set([
    ...Object.keys(baselineMap),
    ...Object.keys(holdingsByMarket),
    ...Object.keys(cashByMarket),
    ...(ledger || []).map(entry => normalizePerformanceMarket(entry.market)),
    ...transactionFlows.map(flow => flow.market),
    ...ignoredTransactionFlows.map(flow => flow.market),
  ])].sort();
  const today = new Date();
  const build = market => {
    const selectedMarkets = market === 'ALL' ? markets : [market];
    const openingValue = selectedMarkets.reduce((sum, key) => sum + finite(baselineMap[key]), 0);
    const holdingsValue = selectedMarkets.reduce((sum, key) => sum + finite(holdingsByMarket[key]), 0);
    const cashValue = selectedMarkets.reduce((sum, key) => sum + finite(cashByMarket[key]), 0);
    const entries = (ledger || []).filter(entry => selectedMarkets.includes(normalizePerformanceMarket(entry.market)));
    const external = entries
      .map(entry => ({
        amount: externalFlowAmount(entry, market !== 'ALL'),
        date: entry.occurred_at,
        kind: entry.kind,
        note: entry.note,
      }))
      .filter(flow => flow.amount !== 0);
    const flows = [
      { amount: -openingValue, date: settings.start_date },
      ...external,
      { amount: holdingsValue + cashValue, date: today },
    ];
    const deposits = entries.filter(entry => entry.kind === 'deposit').reduce((sum, entry) => sum + Math.abs(finite(entry.amount_base_at_event)), 0);
    const withdrawals = entries.filter(entry => entry.kind === 'withdrawal').reduce((sum, entry) => sum + Math.abs(finite(entry.amount_base_at_event)), 0);
    return {
      market,
      openingValue,
      holdingsValue,
      cashValue,
      currentValue: holdingsValue + cashValue,
      deposits,
      withdrawals,
      netInvested: openingValue + deposits - withdrawals,
      xirr: dateMs(today) > dateMs(settings.start_date) ? calculateXirr(flows) : null,
      firstDate: settings.start_date,
      calculationFlows: [
        ...(openingValue > 0 ? [{ kind: 'opening_value', amount: -openingValue, date: settings.start_date }] : []),
        ...external,
        ...(holdingsValue + cashValue > 0 ? [{ kind: 'closing_value', amount: holdingsValue + cashValue, date: today }] : []),
      ].sort((a, b) => dateMs(a.date) - dateMs(b.date)),
      entries: entries.slice().reverse(),
    };
  };

  const buildHistorical = market => {
    const selectedMarkets = market === 'ALL' ? markets : [market];
    const tradeFlows = transactionFlows.filter(flow => selectedMarkets.includes(flow.market));
    const incompleteSymbols = findIncompleteTradeHistory(tradeFlows);
    const historyIncomplete = incompleteSymbols.length > 0;
    const adjustments = historicalAdjustments.filter(flow => selectedMarkets.includes(flow.market));
    const holdingsValue = selectedMarkets.reduce((sum, key) => sum + finite(historicalHoldingsByMarket[key]), 0);
    const flows = [
      ...tradeFlows.map(flow => ({ amount: flow.amount, date: flow.date })),
      ...adjustments.map(flow => ({ amount: flow.amount, date: flow.date })),
      ...(holdingsValue > 0 ? [{ amount: holdingsValue, date: today }] : []),
    ];
    const firstDate = flows
      .filter(flow => dateMs(flow.date) < dateMs(today))
      .reduce((earliest, flow) => !earliest || dateMs(flow.date) < dateMs(earliest) ? flow.date : earliest, null);
    const grossBuys = tradeFlows.filter(flow => flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
    const grossSells = tradeFlows.filter(flow => flow.amount > 0).reduce((sum, flow) => sum + flow.amount, 0);
    const income = adjustments.filter(flow => flow.amount > 0).reduce((sum, flow) => sum + flow.amount, 0);
    const fees = adjustments.filter(flow => flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
    return {
      market,
      historical: true,
      firstDate,
      holdingsValue,
      currentValue: holdingsValue,
      grossBuys,
      grossSells,
      income,
      fees,
      netInvested: grossBuys - grossSells - income + fees,
      transactionCount: tradeFlows.length,
      syntheticCount: tradeFlows.filter(flow => flow.synthetic).length,
      estimatedFx: tradeFlows.some(flow => flow.currency && flow.currency !== baseCurrency),
      historyIncomplete,
      incompleteSymbols,
      xirr: !historyIncomplete && firstDate && dateMs(today) > dateMs(firstDate) ? calculateXirr(flows) : null,
      calculationFlows: [
        ...tradeFlows.map(flow => ({ ...flow, kind: flow.type === 'BUY' ? 'trade_buy' : 'trade_sell' })),
        ...adjustments,
        ...(holdingsValue > 0 ? [{ kind: 'closing_value', amount: holdingsValue, date: today }] : []),
      ].sort((a, b) => dateMs(a.date) - dateMs(b.date)),
      entries: [],
    };
  };

  return {
    initialized: true,
    settings,
    markets,
    performanceAssets: performanceAssetGroups,
    excludedAssets: performanceAssetGroups.filter(asset => asset.exclude_from_performance),
    summaries: Object.fromEntries(['ALL', ...markets].map(market => [market, build(market)])),
    historicalSummaries: Object.fromEntries(['ALL', ...markets].map(market => [market, buildHistorical(market)])),
    periodContext: {
      baseCurrency,
      today: today.toISOString(),
      markets,
      categorySnapshots: snapshotsWithCurrentPerformance,
      transactionFlows,
      ignoredTransactionFlows,
      historicalAdjustments,
      historicalHoldingsByMarket,
      assetValuations: assets.reduce((map, asset) => {
        const key = performanceIdentity(asset);
        if (!map[key]) map[key] = {
          assetId: key,
          symbol: asset.symbol,
          name: asset.name,
          market: normalizePerformanceMarket(asset.market_type),
          currentShares: 0,
          currentValue: 0,
          currentCost: 0,
        };
        map[key].currentShares += finite(asset.current_shares);
        map[key].currentValue += finite(asset.converted_amount);
        map[key].currentCost += finite(asset.converted_cost);
        return map;
      }, {}),
      excludedMarkets: [...new Set((performanceAssets || [])
        .filter(asset => asset.exclude_from_performance)
        .map(asset => normalizePerformanceMarket(asset.market_type)))],
      performanceStartDate: settings.start_date,
      performanceBaselines: baselineMap,
    },
  };
}
