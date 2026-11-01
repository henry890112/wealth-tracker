export const relativeChangePercent = (value, base) => {
  if (value == null || base == null || value === '' || base === '') return null;
  const current = Number(value);
  const baseline = Number(base);
  return Number.isFinite(current) && Number.isFinite(baseline) && baseline > 0
    ? (current / baseline - 1) * 100
    : null;
};

// Both series use the same first shared trading day. Moving averages are
// index prices, so they use the index baseline rather than their own starts.
export const marginIndexRelativePoints = (points = []) => {
  if (!points.length) return [];
  const first = points[0];
  return points.map(point => ({
    ...point,
    indexPercent: relativeChangePercent(point.index, first.index),
    marginPercent: relativeChangePercent(point.margin, first.margin),
    ma20Percent: point.ma20 == null ? null : relativeChangePercent(point.ma20, first.index),
    ma60Percent: point.ma60 == null ? null : relativeChangePercent(point.ma60, first.index),
  }));
};
