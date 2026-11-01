// SEC filings can switch between equivalent GAAP concepts. Keep the
// preferred concept for periods where it exists, then fill missing periods
// from each fallback without replacing reported values with another concept.
export function mergeQuarterSeriesByPriority(seriesByConcept) {
  const byPeriod = new Map();
  for (const series of seriesByConcept) {
    for (const point of series || []) {
      if (point?.end && !byPeriod.has(point.end)) byPeriod.set(point.end, point);
    }
  }
  return [...byPeriod.values()].sort((a, b) => a.end.localeCompare(b.end)).slice(-12);
}
