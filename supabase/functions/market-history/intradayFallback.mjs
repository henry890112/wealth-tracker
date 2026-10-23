/**
 * @typedef {{ time: string, open: number, high: number, low: number, close: number, volume: number }} DailyBar
 */

/** @param {number} timestamp @param {Intl.DateTimeFormat} formatter */
function dateParts(timestamp, formatter) {
  const values = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
  };
}

/** @param {Date} date @param {string} timeZone */
export function dateInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

/** @param {Partial<DailyBar> | null | undefined} row @returns {boolean} */
export function hasCompleteDailyOhlc(row) {
  if (!row) return false;
  const { open, high, low, close } = row;
  if (typeof open !== "number" || typeof high !== "number" || typeof low !== "number" || typeof close !== "number") return false;
  if (![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) return false;
  return high >= Math.max(open, close)
    && low <= Math.min(open, close)
    && high >= low;
}

/**
 * Aggregate Yahoo 5-minute candles only when they cover a full regular trading
 * session. A current/in-progress session is never emitted as a daily candle.
 *
 * @param {any} result Yahoo chart result payload
 * @param {{ timeZone?: string, targetDates?: string[], todayDate?: string }} options
 * @returns {DailyBar[]}
 */
export function aggregateIntradayDailyRows(result, options = {}) {
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(timestamps) || !quote) return [];

  const timeZone = options.timeZone || result?.meta?.exchangeTimezoneName || "America/New_York";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const targetDates = options.targetDates ? new Set(options.targetDates) : null;
  const todayDate = options.todayDate || dateInTimeZone(new Date(), timeZone);
  /** @type {Map<string, Array<{ timestamp: number, minute: number, open: number, high: number, low: number, close: number, volume: number }>>} */
  const grouped = new Map();

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = Number(timestamps[index]) * 1000;
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    const { date, minute } = dateParts(timestamp, formatter);
    if (date >= todayDate || (targetDates && !targetDates.has(date))) continue;

    const bar = {
      timestamp,
      minute,
      open: Number(quote.open?.[index]),
      high: Number(quote.high?.[index]),
      low: Number(quote.low?.[index]),
      close: Number(quote.close?.[index]),
      volume: Number(quote.volume?.[index] || 0),
    };
    if (!hasCompleteDailyOhlc(bar)) continue;
    const day = grouped.get(date) || [];
    day.push(bar);
    grouped.set(date, day);
  }

  /** @type {DailyBar[]} */
  const dailyRows = [];
  for (const [time, bars] of grouped) {
    bars.sort((left, right) => left.timestamp - right.timestamp);
    const first = bars[0];
    const last = bars[bars.length - 1];
    if (!first || !last) continue;
    const firstMinute = first.minute;
    const lastMinute = last.minute;
    const maxGapMs = bars.slice(1).reduce(
      (largest, bar, index) => Math.max(largest, bar.timestamp - bars[index].timestamp),
      0,
    );
    const sessionCoverage = maxGapMs <= 10 * 60 * 1000;
    const fullSession = sessionCoverage && bars.length >= 70
      && firstMinute >= 570 && firstMinute <= 575
      && lastMinute >= 955 && lastMinute <= 965;
    const earlyCloseSession = sessionCoverage && bars.length >= 38
      && firstMinute >= 570 && firstMinute <= 575
      && lastMinute >= 775 && lastMinute <= 785;
    if (!fullSession && !earlyCloseSession) continue;

    dailyRows.push({
      time,
      open: first.open,
      high: Math.max(...bars.map((bar) => bar.high)),
      low: Math.min(...bars.map((bar) => bar.low)),
      close: last.close,
      volume: bars.reduce((sum, bar) => sum + bar.volume, 0),
    });
  }
  return dailyRows;
}

/**
 * Replace incomplete daily rows only with a validated intraday aggregation.
 *
 * @param {DailyBar[]} dailyRows
 * @param {DailyBar[]} intradayRows
 * @param {string[]} targetDates
 * @returns {DailyBar[]}
 */
export function mergeIntradayDailyRows(dailyRows, intradayRows, targetDates) {
  const targets = new Set(targetDates);
  /** @type {Map<string, DailyBar>} */
  const replacements = new Map();
  for (const row of intradayRows) {
    if (targets.has(row.time) && hasCompleteDailyOhlc(row)) replacements.set(row.time, row);
  }
  /** @type {Map<string, DailyBar>} */
  const merged = new Map();
  for (const row of dailyRows) {
    merged.set(row.time, hasCompleteDailyOhlc(row) ? row : (replacements.get(row.time) || row));
  }
  for (const [time, row] of replacements) {
    if (!merged.has(time)) merged.set(time, row);
  }
  return [...merged.values()].filter(hasCompleteDailyOhlc).sort((left, right) => left.time.localeCompare(right.time));
}
