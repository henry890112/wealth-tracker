export const asNumber = (value) => {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const hasNumericValue = value => value !== null
  && value !== undefined
  && String(value).trim() !== ''
  && Number.isFinite(Number(String(value).replace(/,/g, '').trim()));

export function normalizeEsunHolding(item = {}, quote = null) {
  const symbol = String(item.stkNo || '').trim().toUpperCase();
  const topLevelQuantity = hasNumericValue(item.qty) ? Math.max(0, asNumber(item.qty)) : null;
  const detailQuantity = Array.isArray(item.stkDats)
    ? item.stkDats.reduce((sum, row) => sum + Math.max(0, asNumber(row?.qty)), 0)
    : 0;
  const reportedMarketPrice = asNumber(item.priceMkt);
  const reportedMarketValue = asNumber(item.valueMkt);
  const impliedQuantityRaw = reportedMarketPrice > 0 && reportedMarketValue > 0
    ? reportedMarketValue / reportedMarketPrice
    : null;
  const impliedQuantity = impliedQuantityRaw != null && Math.abs(impliedQuantityRaw - Math.round(impliedQuantityRaw)) <= 0.05
    ? Math.round(impliedQuantityRaw)
    : null;

  // `item.qty` is the broker's current net position. `stkDats` can retain lot
  // or source details whose quantities no longer equal the remaining shares
  // after a partial sale, so it is only a fallback when the net field is absent.
  // If broker-reported price and market value imply a different whole-share
  // balance, prefer that internally consistent current-position quantity.
  const quantity = impliedQuantity != null
    && topLevelQuantity != null
    && Math.abs(impliedQuantity - topLevelQuantity) > 0.05
    ? impliedQuantity
    : topLevelQuantity ?? impliedQuantity ?? detailQuantity;
  const costBasis = Math.abs(asNumber(item.costSum));
  const reportedAverageCost = Math.abs(asNumber(item.priceAvg));
  // Keep cost, quantity and average cost internally consistent. The broker's
  // current cost sum is authoritative for the remaining position.
  const averageCost = quantity > 0 && costBasis > 0
    ? costBasis / quantity
    : reportedAverageCost;
  const marketPrice = reportedMarketPrice
    || asNumber(quote?.lastPrice || quote?.closePrice || quote?.previousClose);
  const marketValue = reportedMarketValue || marketPrice * quantity;

  return {
    symbol,
    name: item.stkNa || quote?.name || symbol,
    quantity,
    averageCost,
    costBasis,
    marketPrice,
    marketValue,
    currency: 'TWD',
    marketType: 'TW',
  };
}
