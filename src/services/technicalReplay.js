const rowDate = row => String(row?.time || row?.date || row?.timestamp || '').slice(0, 10);

export const TECHNICAL_REPLAY_MAX_DATES = 30;

const dateOrEmpty = value => String(value || '').slice(0, 10);

const filterRowsThroughDate = (rows, cutoff) => {
  if (!Array.isArray(rows)) return [];
  if (!cutoff) return rows;
  return rows.filter(row => {
    const date = rowDate(row);
    return date && date <= cutoff;
  });
};

/**
 * Returns the latest trading-day dates that can be replayed for the selected
 * period. The analysis still receives all rows through the selected date so
 * indicator warm-up remains correct; only the dates exposed by the control are
 * limited to the most recent 30 trading days.
 */
export const getTechnicalReplayDates = (rawRows = [], periodRows = 260, minimumRows = 60, maxDates = TECHNICAL_REPLAY_MAX_DATES) => {
  if (!Array.isArray(rawRows) || rawRows.length < minimumRows) return [];
  const start = Math.max(minimumRows - 1, rawRows.length - periodRows);
  const seen = new Set();
  const dates = rawRows.slice(start).map(rowDate).filter(date => {
    if (!date || seen.has(date)) return false;
    seen.add(date);
    return true;
  });
  const limit = Math.max(1, Number(maxDates) || TECHNICAL_REPLAY_MAX_DATES);
  return dates.slice(-limit);
};

/**
 * Builds the data/context used by a historical technical replay.
 * Indicators must be calculated from all rows through the cutoff so their
 * warm-up remains correct, while every future-dated auxiliary series is
 * removed to prevent look-ahead leakage.
 */
export const buildTechnicalReplayInput = (rawRows = [], context = {}, asOfDate = null, displayCount = 260) => {
  const cutoff = dateOrEmpty(asOfDate) || null;
  const rows = filterRowsThroughDate(rawRows, cutoff);
  const replayContext = cutoff
    ? {
      ...context,
      institutional: filterRowsThroughDate(context.institutional, cutoff),
      benchmarkRows: filterRowsThroughDate(context.benchmarkRows, cutoff),
      relativeStrengthRows: filterRowsThroughDate(context.relativeStrengthRows, cutoff),
      pairRows: filterRowsThroughDate(context.pairRows, cutoff),
      comparisonRows: Array.isArray(context.comparisonRows)
        ? context.comparisonRows.map(item => ({
          ...item,
          rows: filterRowsThroughDate(item?.rows, cutoff),
        }))
        : [],
      quote: null,
      quoteSource: '',
      quoteStatus: 'historical_replay',
      quoteTime: '',
      isIntraday: false,
      intradayUnavailable: false,
    }
    : context;

  return {
    rows,
    context: replayContext,
    displayCount: Math.min(Number(displayCount) || rows.length, rows.length),
    asOfDate: rowDate(rows.at(-1)) || cutoff,
  };
};

export const getTechnicalRowDate = rowDate;
