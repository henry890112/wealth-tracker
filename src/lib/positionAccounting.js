const EPSILON = 1e-8;

const finite = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const transactionDate = transaction => {
  const value = new Date(transaction?.trans_date || transaction?.date || 0).getTime();
  return Number.isFinite(value) ? value : 0;
};

const compareTransactions = (left, right) =>
  transactionDate(left) - transactionDate(right)
  || String(left?.created_at || '').localeCompare(String(right?.created_at || ''))
  || String(left?.id || '').localeCompare(String(right?.id || ''));

const expectedEntries = expectedSharesByAssetId => {
  if (expectedSharesByAssetId instanceof Map) return [...expectedSharesByAssetId.entries()];
  if (expectedSharesByAssetId && typeof expectedSharesByAssetId === 'object') {
    return Object.entries(expectedSharesByAssetId);
  }
  return [];
};

/**
 * Rebuild open position cost and realized P&L using FIFO lots.
 * Fees and taxes are added to buy-lot cost and deducted from matched sell proceeds.
 */
export const calculateFifoPositionAccounting = (transactions = [], expectedSharesByAssetId = null) => {
  const groups = new Map();
  const keyFor = transaction => String(transaction?.asset_id || '__position__');

  for (const [assetId, shares] of expectedEntries(expectedSharesByAssetId)) {
    groups.set(String(assetId), { expectedShares: finite(shares), transactions: [] });
  }

  for (const transaction of transactions || []) {
    const type = String(transaction?.type || '').toUpperCase();
    if (!['BUY', 'SELL'].includes(type) || transaction?.affects_position === false) continue;
    const key = keyFor(transaction);
    if (!groups.has(key)) groups.set(key, { expectedShares: null, transactions: [] });
    groups.get(key).transactions.push({ ...transaction, type });
  }

  const assets = [];
  for (const [assetId, group] of groups) {
    const lots = [];
    let realizedPnl = 0;
    let realizedShares = 0;
    let unmatchedSellShares = 0;

    group.transactions.sort(compareTransactions);
    for (const transaction of group.transactions) {
      const shares = Math.abs(finite(transaction.shares));
      const price = finite(transaction.price);
      if (!(shares > EPSILON) || price < 0) continue;
      const charges = Math.max(0, finite(transaction.fee)) + Math.max(0, finite(transaction.tax));

      if (transaction.type === 'BUY') {
        lots.push({
          remaining: shares,
          unitCost: price + charges / shares,
        });
        continue;
      }

      let remainingToSell = shares;
      let matchedShares = 0;
      let matchedCost = 0;
      for (const lot of lots) {
        if (remainingToSell <= EPSILON) break;
        if (lot.remaining <= EPSILON) continue;
        const matched = Math.min(lot.remaining, remainingToSell);
        matchedShares += matched;
        matchedCost += matched * lot.unitCost;
        lot.remaining -= matched;
        remainingToSell -= matched;
      }

      if (matchedShares > EPSILON) {
        const matchedSellCharges = charges * (matchedShares / shares);
        realizedPnl += matchedShares * price - matchedSellCharges - matchedCost;
        realizedShares += matchedShares;
      }
      unmatchedSellShares += remainingToSell;
    }

    const openShares = lots.reduce((sum, lot) => sum + Math.max(0, lot.remaining), 0);
    const openCost = lots.reduce((sum, lot) => sum + Math.max(0, lot.remaining) * lot.unitCost, 0);
    const sharesMatch = group.expectedShares == null
      || Math.abs(openShares - group.expectedShares) <= 1e-6;
    assets.push({
      assetId,
      expectedShares: group.expectedShares,
      openShares,
      openCost,
      averageCost: openShares > EPSILON ? openCost / openShares : 0,
      realizedPnl,
      realizedShares,
      unmatchedSellShares,
      isComplete: sharesMatch && unmatchedSellShares <= 1e-6,
    });
  }

  const openShares = assets.reduce((sum, asset) => sum + asset.openShares, 0);
  const openCost = assets.reduce((sum, asset) => sum + asset.openCost, 0);
  const realizedPnl = assets.reduce((sum, asset) => sum + asset.realizedPnl, 0);
  const realizedShares = assets.reduce((sum, asset) => sum + asset.realizedShares, 0);
  const unmatchedSellShares = assets.reduce((sum, asset) => sum + asset.unmatchedSellShares, 0);
  const hasExpectedShares = assets.some(asset => asset.expectedShares != null);
  const allExpectedSharesMatch = !hasExpectedShares || assets.every(asset =>
    asset.expectedShares != null && Math.abs(asset.openShares - asset.expectedShares) <= 1e-6
  );
  const isComplete = allExpectedSharesMatch && unmatchedSellShares <= 1e-6;

  return {
    assets,
    openShares,
    openCost,
    averageCost: openShares > EPSILON ? openCost / openShares : 0,
    realizedPnl,
    realizedShares,
    unmatchedSellShares,
    isComplete,
  };
};

/**
 * Use FIFO costs only when a position's transaction ledger reconciles to its
 * saved share count. Incomplete broker/import histories keep their trusted
 * persisted cost instead of producing a misleading partial FIFO result.
 */
export const applyCompleteFifoPositionCosts = (assets = [], transactions = []) => {
  const investments = assets.filter(asset =>
    asset?.category === 'investment' && asset?.id != null
  );
  if (investments.length === 0) return assets;

  const expectedSharesByAssetId = Object.fromEntries(investments.map(asset => [
    String(asset.id), finite(asset.current_shares),
  ]));
  const accounting = calculateFifoPositionAccounting(transactions, expectedSharesByAssetId);
  const rowsByAssetId = new Map(accounting.assets.map(row => [String(row.assetId), row]));

  return assets.map(asset => {
    if (asset?.category !== 'investment' || asset?.id == null) return asset;
    const row = rowsByAssetId.get(String(asset.id));
    if (!row?.isComplete) return asset;
    return {
      ...asset,
      average_cost: row.openShares > EPSILON ? row.averageCost : 0,
      position_cost_source: 'fifo',
    };
  });
};
