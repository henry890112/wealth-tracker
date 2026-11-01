const compareSymbols = (a, b) => String(a?.symbol || '').localeCompare(String(b?.symbol || ''), 'zh-TW', { numeric: true });

export const nextPerformanceSort = (current, key) => ({
  key,
  direction: current?.key === key && current.direction === 'desc' ? 'asc' :
    current?.key === key && current.direction === 'asc' ? 'desc' :
      key === 'symbol' ? 'asc' : 'desc',
});

export const sortPerformanceRows = (rows, sort) => {
  if (!sort?.key) return rows;
  const multiplier = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === 'symbol') return compareSymbols(a, b) * multiplier;
    const aValue = a?.[sort.key];
    const bValue = b?.[sort.key];
    const aValid = aValue != null && Number.isFinite(Number(aValue));
    const bValid = bValue != null && Number.isFinite(Number(bValue));
    if (aValid !== bValid) return aValid ? -1 : 1;
    if (!aValid) return compareSymbols(a, b);
    return (Number(aValue) - Number(bValue)) * multiplier || compareSymbols(a, b);
  });
};
