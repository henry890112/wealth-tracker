import {
  convertToBaseCurrency,
  fetchCryptoPriceBatch,
  fetchTWStockPriceBatch,
  fetchUSStockPriceBatch,
} from './api';

const INVESTMENT_CATEGORY = 'investment';
const LIABILITY_CATEGORY = 'liability';

export const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const priceKey = (marketType, symbol) => `${marketType || 'other'}:${symbol || ''}`;

export const getLiveQuote = (prices, asset) =>
  prices?.[priceKey(asset?.market_type, asset?.symbol)] ?? null;

export const calculateInvestmentEquity = (asset, marketPrice) => {
  const shares = toFiniteNumber(asset?.current_shares);
  const averageCost = toFiniteNumber(asset?.average_cost);
  const leverage = Math.max(toFiniteNumber(asset?.leverage, 1), 1);
  const price = toFiniteNumber(marketPrice, averageCost);
  const borrowed = shares * averageCost * (leverage - 1) / leverage;
  return price * shares - borrowed;
};

export const calculateInvestmentCostBasis = (asset) => {
  const shares = toFiniteNumber(asset?.current_shares);
  const averageCost = toFiniteNumber(asset?.average_cost);
  const leverage = Math.max(toFiniteNumber(asset?.leverage, 1), 1);
  return shares * averageCost / leverage;
};

/**
 * Fetch all supported market prices once and namespace them by market type.
 * Namespacing avoids collisions when two markets happen to use the same symbol.
 */
export const fetchLiveAssetPrices = async (assets = []) => {
  const investments = assets.filter(asset =>
    asset?.category === INVESTMENT_CATEGORY &&
    asset?.symbol &&
    toFiniteNumber(asset.current_shares) > 0
  );

  const byMarket = {
    TW: investments.filter(asset => asset.market_type === 'TW'),
    US: investments.filter(asset => asset.market_type === 'US'),
    Crypto: investments.filter(asset => asset.market_type === 'Crypto'),
  };

  const uniqueSymbols = marketAssets => [...new Set(marketAssets.map(asset => asset.symbol))];
  const [twPrices, usPrices, cryptoPrices] = await Promise.all([
    fetchTWStockPriceBatch(uniqueSymbols(byMarket.TW)),
    fetchUSStockPriceBatch(uniqueSymbols(byMarket.US)),
    fetchCryptoPriceBatch(uniqueSymbols(byMarket.Crypto)),
  ]);

  const result = {};
  for (const [marketType, marketAssets, marketPrices] of [
    ['TW', byMarket.TW, twPrices],
    ['US', byMarket.US, usPrices],
    ['Crypto', byMarket.Crypto, cryptoPrices],
  ]) {
    for (const asset of marketAssets) {
      const quote = marketPrices?.[asset.symbol] ?? marketPrices?.[asset.symbol.toUpperCase()];
      if (quote?.price != null) result[priceKey(marketType, asset.symbol)] = quote;
    }
  }
  return result;
};

/** Add base-currency valuation and P&L fields to assets. */
export const valueAssets = async (
  assets = [],
  baseCurrency,
  { ratesMap = null, livePrices = null } = {},
) => Promise.all(assets.map(async asset => {
  const quote = getLiveQuote(livePrices, asset);
  const usesLivePrice =
    asset.category === INVESTMENT_CATEGORY &&
    toFiniteNumber(asset.current_shares) > 0 &&
    quote?.price != null;
  const currentAmount = usesLivePrice
    ? calculateInvestmentEquity(asset, quote.price)
    : toFiniteNumber(asset.current_amount);
  const convertedAmount = await convertToBaseCurrency(
    currentAmount,
    asset.currency || baseCurrency,
    baseCurrency,
    ratesMap,
  );

  let convertedCost = null;
  let pnl = null;
  let pnlPct = null;
  let dayPnl = null;
  let dayPnlPct = null;
  const quoteChangePct = Number(quote?.change_percent);
  if (usesLivePrice && Number.isFinite(quoteChangePct) && quoteChangePct > -100) {
    const previousClose = quote.price / (1 + quoteChangePct / 100);
    const nativeDayPnl = toFiniteNumber(asset.current_shares) * (quote.price - previousClose);
    dayPnl = await convertToBaseCurrency(
      nativeDayPnl,
      asset.currency || baseCurrency,
      baseCurrency,
      ratesMap,
    );
    const previousEquity = convertedAmount - dayPnl;
    dayPnlPct = previousEquity !== 0 ? (dayPnl / Math.abs(previousEquity)) * 100 : null;
  }
  if (
    asset.category === INVESTMENT_CATEGORY &&
    toFiniteNumber(asset.current_shares) > 0 &&
    toFiniteNumber(asset.average_cost) > 0
  ) {
    convertedCost = await convertToBaseCurrency(
      calculateInvestmentCostBasis(asset),
      asset.currency || baseCurrency,
      baseCurrency,
      ratesMap,
    );
    pnl = convertedAmount - convertedCost;
    pnlPct = convertedCost > 0 ? (pnl / convertedCost) * 100 : 0;
  }

  return {
    ...asset,
    current_amount: currentAmount,
    converted_amount: convertedAmount,
    converted_cost: convertedCost,
    pnl,
    pnl_pct: pnlPct,
    day_pnl: dayPnl,
    day_pnl_pct: dayPnlPct,
    live_price: usesLivePrice ? quote.price : null,
    price_change_pct: Number.isFinite(quoteChangePct) ? quoteChangePct : null,
    price_time: quote?.price_time || asset.price_time || null,
  };
}));

export const calculatePortfolioTotals = (assets = []) => {
  let assetsTotal = 0;
  let liabilitiesTotal = 0;
  for (const asset of assets) {
    const amount = toFiniteNumber(asset.converted_amount);
    if (asset.category === LIABILITY_CATEGORY) liabilitiesTotal += amount;
    else assetsTotal += amount;
  }
  return {
    assetsTotal,
    liabilitiesTotal,
    netWorth: assetsTotal - liabilitiesTotal,
  };
};

export const getSnapshotCategory = (asset) => {
  if (['TW', 'US', 'Crypto'].includes(asset?.market_type)) return asset.market_type;
  if (['liquid', 'fixed', 'receivable', 'liability'].includes(asset?.category)) {
    return asset.category;
  }
  return 'other';
};

export const groupSnapshotTotals = (assets = []) => assets.reduce((totals, asset) => {
  const key = getSnapshotCategory(asset);
  totals[key] = (totals[key] || 0) + toFiniteNumber(asset.converted_amount);
  return totals;
}, {});
