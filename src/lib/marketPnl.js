const MARKET_TIME_ZONES = {
  TW: 'Asia/Taipei',
  US: 'America/New_York',
};

const datePartsInTimeZone = (date, timeZone) => {
  const parsed = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  return Object.fromEntries(parts
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, value]));
};

export const getMarketDateString = (date, marketType) => {
  const timeZone = MARKET_TIME_ZONES[marketType];
  if (!timeZone) return null;
  const parts = datePartsInTimeZone(date, timeZone);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : null;
};

const formatShortDate = (dateString) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ''));
  if (!match) return null;
  return `${Number(match[2])}/${Number(match[3])}`;
};

/**
 * Describe what the dashboard's one-day P&L represents.
 * Stock quotes may be a valid previous-session close while the local calendar
 * already says "today".  In that case the value remains useful, but must not
 * be labelled as today's market move.
 */
export const getDayPnlPresentation = (assets = [], selectedMarket = 'ALL', now = new Date()) => {
  const quotedAssets = assets.filter(asset => (
    asset?.day_pnl !== null &&
    asset?.day_pnl !== undefined &&
    Number.isFinite(Number(asset.day_pnl))
  ));
  const markets = new Set(quotedAssets.map(asset => asset?.market_type).filter(Boolean));
  const hasCrypto = markets.has('Crypto');
  const stockQuotes = quotedAssets
    .filter(asset => MARKET_TIME_ZONES[asset?.market_type])
    .map(asset => {
      const sourceTime = asset.price_source_time || asset.price_time;
      return {
        market: asset.market_type,
        quoteDate: getMarketDateString(sourceTime, asset.market_type),
        currentDate: getMarketDateString(now, asset.market_type),
      };
    })
    .filter(item => item.quoteDate && item.currentDate);

  if (selectedMarket === 'Crypto' || (hasCrypto && stockQuotes.length === 0)) {
    return {
      label: '近 24 小時損益',
      quoteDate: null,
      quoteDateLabel: null,
      isPreviousSession: false,
    };
  }

  const stockMarkets = [...new Set(stockQuotes.map(item => item.market))];
  if (stockMarkets.length === 1 && !hasCrypto) {
    const latestQuoteDate = stockQuotes
      .map(item => item.quoteDate)
      .sort((first, second) => second.localeCompare(first))[0];
    const currentDate = stockQuotes.find(item => item.market === stockMarkets[0])?.currentDate;
    if (latestQuoteDate && currentDate && latestQuoteDate !== currentDate) {
      const quoteDateLabel = formatShortDate(latestQuoteDate);
      return {
        label: quoteDateLabel ? `上一交易日損益（${quoteDateLabel}）` : '上一交易日損益',
        quoteDate: latestQuoteDate,
        quoteDateLabel,
        isPreviousSession: true,
      };
    }
    return {
      label: '今日損益',
      quoteDate: latestQuoteDate || null,
      quoteDateLabel: formatShortDate(latestQuoteDate),
      isPreviousSession: false,
    };
  }

  if (stockQuotes.length > 0) {
    const hasPreviousSession = stockQuotes.some(item => item.quoteDate !== item.currentDate);
    return {
      label: hasPreviousSession ? '各市場最近交易日損益' : (hasCrypto ? '今日／近 24 小時損益' : '今日損益'),
      quoteDate: null,
      quoteDateLabel: null,
      isPreviousSession: hasPreviousSession,
    };
  }

  return {
    label: '單日損益',
    quoteDate: null,
    quoteDateLabel: null,
    isPreviousSession: false,
  };
};
