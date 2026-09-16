const STATUS_LABELS = {
  intraday: '盤中',
  official_close: '正式收盤',
  stale: '舊資料',
  reference: '參考價',
  unavailable: '取得失敗',
  unknown: '報價',
};

export const getQuoteStatusLabel = (status, isStale = false) => (
  isStale ? STATUS_LABELS.stale : (STATUS_LABELS[status] || STATUS_LABELS.unknown)
);

export const getQuoteStatusColor = (status, isStale, colors) => {
  if (isStale || status === 'stale' || status === 'unavailable') return colors.negative;
  if (status === 'intraday') return colors.accent;
  return colors.textMuted;
};

export const formatQuoteTime = (isoString, { includeSeconds = false } = {}) => {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  });
};

export const describeQuote = ({
  source,
  source_time: sourceTime,
  price_time: priceTime,
  quote_status: quoteStatus,
  is_stale: isStale,
} = {}) => {
  const parts = [
    getQuoteStatusLabel(quoteStatus, isStale),
    source && source !== 'unknown' ? source : null,
    formatQuoteTime(sourceTime || priceTime),
  ].filter(Boolean);
  return parts.join(' · ');
};
