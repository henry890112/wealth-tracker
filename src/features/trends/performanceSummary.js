const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

// Use the same FIFO row fields and cost bases as calculateTradePerformance.
// This keeps the detail header aligned with the visible market/search/position rows.
export const summarizeVisiblePerformanceRows = (rows = []) => {
  const totals = rows.reduce((sum, row) => ({
    realizedCost: sum.realizedCost + finite(row.realizedCost),
    realizedPnl: sum.realizedPnl + finite(row.realizedPnl),
    openCost: sum.openCost + finite(row.openCost),
    unrealizedPnl: sum.unrealizedPnl + finite(row.unrealizedPnl),
  }), { realizedCost: 0, realizedPnl: 0, openCost: 0, unrealizedPnl: 0 });
  const totalCost = totals.realizedCost + totals.openCost;
  const totalPnl = totals.realizedPnl + totals.unrealizedPnl;
  return {
    ...totals,
    totalCost,
    totalPnl,
    realizedReturn: totals.realizedCost > 0 ? totals.realizedPnl / totals.realizedCost : null,
    unrealizedReturn: totals.openCost > 0 ? totals.unrealizedPnl / totals.openCost : null,
    totalReturn: totalCost > 0 ? totalPnl / totalCost : null,
  };
};
