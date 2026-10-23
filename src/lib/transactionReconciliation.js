const finiteNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const dateMs = value => {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Find opening-position snapshots that are duplicates of an imported broker
 * fill. Opening snapshots remain visible for audit, but should stop affecting
 * FIFO and cash-flow performance once the matching real fill is available.
 */
export const findOverlappingInitialPositionIds = (
  initialTransactions = [],
  brokerTransactions = [],
  { maxHoursApart = 36, maxPriceDifferenceRatio = 0.03 } = {},
) => {
  const maxDifferenceMs = maxHoursApart * 60 * 60 * 1000;

  return initialTransactions
    .filter(initial => initial?.id && initial.type === 'BUY' && initial.external_source === 'initial_position')
    .filter(initial => brokerTransactions.some(broker => {
      if (broker?.type !== 'BUY' || broker.asset_id !== initial.asset_id) return false;
      const initialShares = Math.abs(finiteNumber(initial.shares));
      const brokerShares = Math.abs(finiteNumber(broker.shares));
      if (!(initialShares > 0) || Math.abs(initialShares - brokerShares) > 1e-8) return false;

      const initialPrice = Math.abs(finiteNumber(initial.price));
      const brokerPrice = Math.abs(finiteNumber(broker.price));
      if (!(initialPrice > 0) || !(brokerPrice > 0)) return false;
      const priceDifferenceRatio = Math.abs(initialPrice - brokerPrice) / brokerPrice;
      if (priceDifferenceRatio > maxPriceDifferenceRatio) return false;

      const initialTime = dateMs(initial.trans_date);
      const brokerTime = dateMs(broker.trans_date);
      return initialTime != null && brokerTime != null
        && Math.abs(initialTime - brokerTime) <= maxDifferenceMs;
    }))
    .map(initial => initial.id);
};

export const getTransactionSourceLabel = transaction => {
  if (transaction?.external_source === 'esun') return '玉山成交';
  if (transaction?.external_source === 'initial_position') return '期初持倉';
  return '一般交易';
};
