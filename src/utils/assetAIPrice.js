const positivePrice = value => {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
};

export function resolveAssetAIPrice(quote, historicalClose, now = Date.now()) {
  const quotedPrice = positivePrice(quote?.price);
  const sourceTime = quote?.source_time || quote?.price_time || null;
  const sourceMs = sourceTime ? Date.parse(sourceTime) : NaN;
  const recent = Number.isFinite(sourceMs) && sourceMs <= now && now - sourceMs <= 10 * 60 * 1000;
  if (quotedPrice !== null && !quote?.is_stale) {
    const isLive = quote.quote_status === 'intraday' && recent;
    return {
      price: quotedPrice,
      label: isLive ? '盤中報價' : quote.quote_status === 'official_close' ? '最近正式收盤價' : '最近報價（非即時）',
      source: quote.source || '',
      sourceTime,
      isLive,
    };
  }
  const close = positivePrice(historicalClose);
  return {
    price: close,
    label: close === null ? '無可用價格' : '最近歷史收盤價（非即時）',
    source: close === null ? '' : '歷史日線',
    sourceTime: null,
    isLive: false,
  };
}

export function estimateHoldingPriceReturnPct(price, averageCost, leverage, shares) {
  const current = positivePrice(price);
  const cost = positivePrice(averageCost);
  const quantity = positivePrice(shares);
  const multiplier = positivePrice(leverage) || 1;
  if (current === null || cost === null || quantity === null) return null;
  return ((current - cost) / cost) * multiplier * 100;
}
