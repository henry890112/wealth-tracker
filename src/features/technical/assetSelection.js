export const switchAssetKey = asset => `${String(asset?.symbol || '').trim().toUpperCase()}:${String(asset?.market_type || 'US').trim().toUpperCase()}`;

export const normalizeMarketType = value => {
  const market = String(value || '').trim().toUpperCase();
  return market === 'CRYPTOCURRENCY' ? 'CRYPTO' : market;
};

export const normalizeComparisonTarget = (target, fallbackMarket = 'US') => {
  if (typeof target === 'string') return { symbol: target.trim().toUpperCase(), market_type: normalizeMarketType(fallbackMarket) };
  return {
    symbol: String(target?.symbol || '').trim().toUpperCase(),
    market_type: normalizeMarketType(target?.market_type || target?.marketType || target?.market || fallbackMarket),
  };
};

export const comparisonTargetKey = target => switchAssetKey(normalizeComparisonTarget(target));

export const buildSwitchAssets = (holdings = [], watchlist = [], current = null) => {
  const merged = new Map();
  const add = (asset, source) => {
    if (!asset?.symbol) return;
    const key = switchAssetKey(asset);
    const existing = merged.get(key);
    const shares = Number(asset.current_shares || 0);
    const cost = Number(asset.average_cost || 0);
    if (existing) {
      const previousShares = Number(existing.current_shares || 0);
      const totalShares = previousShares + shares;
      existing.average_cost = totalShares > 0
        ? ((previousShares * Number(existing.average_cost || 0)) + (shares * cost)) / totalShares
        : Number(existing.average_cost || cost || 0);
      existing.current_shares = totalShares;
      existing.isHolding = existing.isHolding || source === 'holding';
      existing.isWatchlist = existing.isWatchlist || source === 'watchlist';
      if ((!existing.name || existing.name === existing.symbol) && asset.name) existing.name = asset.name;
      return;
    }
    const symbol = String(asset.symbol).trim().toUpperCase();
    merged.set(key, {
      symbol,
      name: asset.name || symbol,
      market_type: asset.market_type || (/^\d+$/.test(symbol) ? 'TW' : 'US'),
      currency: asset.currency || (String(asset.market_type || '').toUpperCase() === 'TW' ? 'TWD' : 'USD'),
      current_shares: shares,
      average_cost: cost,
      isHolding: source === 'holding',
      isWatchlist: source === 'watchlist',
    });
  };
  holdings.forEach(asset => add(asset, 'holding'));
  watchlist.forEach(asset => add(asset, 'watchlist'));
  if (current?.symbol) add(current, 'current');
  return [...merged.values()].sort((a, b) => {
    if (a.isHolding !== b.isHolding) return a.isHolding ? -1 : 1;
    if (a.isWatchlist !== b.isWatchlist) return a.isWatchlist ? -1 : 1;
    return `${a.market_type}:${a.symbol}`.localeCompare(`${b.market_type}:${b.symbol}`);
  });
};
