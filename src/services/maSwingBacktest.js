import { MA_SWING_PERIODS, MA_SWING_PERIOD_OPTIONS, normalizeMaSwingSettings } from './strategyEngines.js';

export const BACKTEST_MONTHS = [1, 3, 6, 12, 36];
export const isValidMaSwingExitPair = (partialExit, fullExit) => partialExit == null
  || fullExit == null
  || partialExit <= fullExit;
const VALID_EXIT_PAIR_COUNT = MA_SWING_PERIOD_OPTIONS.reduce((count, partialExit) => count
  + MA_SWING_PERIOD_OPTIONS.filter(fullExit => isValidMaSwingExitPair(partialExit, fullExit)).length, 0);
export const BACKTEST_COMBINATION_COUNT = MA_SWING_PERIODS.length
  * VALID_EXIT_PAIR_COUNT
  * MA_SWING_PERIOD_OPTIONS.length ** 2;
export const BACKTEST_WARMUP_BARS = Math.max(...MA_SWING_PERIODS) + 5;

// The live quote loop replaces the current rows array every 30 seconds. The
// backtest only depends on each session's date, open and close, so keep its
// prepared data stable when those closed-session values have not changed.
export function areMaBacktestRowsEqual(previous, next) {
  if (previous === next) return true;
  if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) return false;
  return previous.every((row, index) => {
    const candidate = next[index];
    return String(row?.time || '') === String(candidate?.time || '')
      && Object.is(Number(row?.open), Number(candidate?.open))
      && Object.is(Number(row?.close), Number(candidate?.close));
  });
}

export function prepareMaBacktest(input) {
  const rows = [...input].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const valid = rows.every((r, i) => Number.isFinite(r.close) && r.close > 0
    && Number.isFinite(r.open) && r.open > 0 && (!i || r.time > rows[i - 1].time));
  const averages = {};
  for (const p of MA_SWING_PERIODS) {
    let sum = 0;
    averages[p] = rows.map((r, i) => { sum += r.close; if (i >= p) sum -= rows[i - p].close; return i >= p - 1 ? sum / p : null; });
  }
  return { rows, averages, valid };
}

// Build the strategy event stream from the full history so chart annotations
// and backtests share the same position state. A shorter performance window
// must not manufacture a second entry while the full-history strategy is held.
export function buildMaSwingActions(data, selection) {
  const { rows, averages, valid } = data;
  if (!valid || !rows.length) return [];
  const s = normalizeMaSwingSettings(selection);
  const periods = [...new Set(['entry', 'shortExit', 'longExit', 'abovePeriod', 'risingPeriod']
    .map(key => s[key])
    .filter(period => period != null && Number.isFinite(Number(period))))];
  const start = Math.max(1, ...periods.map(period => period + (period === s.risingPeriod ? 5 : 0)));
  if (rows.length <= start) return [];
  const above = (period, index) => period != null && rows[index].close > averages[period][index];
  const ready = index => s.entry != null && above(s.entry, index)
    && (s.abovePeriod == null || above(s.abovePeriod, index))
    && (s.risingPeriod == null || averages[s.risingPeriod][index] > averages[s.risingPeriod][index - 5]);
  let shortHeld = false;
  let longHeld = false;
  let readyBefore = false;
  const actions = [];
  for (let index = start; index < rows.length; index += 1) {
    const isReady = ready(index);
    const down = period => period != null
      && rows[index - 1].close >= averages[period][index - 1]
      && rows[index].close < averages[period][index];
    let action = null;
    let legs = [];
    if (longHeld && down(s.longExit)) {
      action = 'longExit';
      legs = [0, 1];
      shortHeld = false;
      longHeld = false;
    } else if (shortHeld && down(s.shortExit)) {
      action = 'shortExit';
      legs = [0];
      shortHeld = false;
    } else if (isReady && !readyBefore && (!shortHeld || !longHeld)) {
      action = 'entry';
      if (!shortHeld) legs.push(0);
      if (!longHeld) legs.push(1);
      shortHeld = true;
      longHeld = true;
    }
    readyBefore = isReady;
    if (action) actions.push({ index, time: rows[index].time, action, legs });
  }
  return actions;
}

// Each window starts in cash, but only full-history strategy events can create trades.
export function backtestMaSwing(data, selection, months, fee = 0.001) {
  const { rows, valid } = data;
  if (!valid || !rows.length) return null;
  const end = new Date(`${rows.at(-1).time}T00:00:00Z`);
  const target = new Date(end);
  const day = target.getUTCDate();
  target.setUTCDate(1); target.setUTCMonth(target.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  const date = target.toISOString().slice(0, 10);
  const first = rows.findIndex(r => r.time >= date);
  // Same warm-up for every candidate, ensuring comparable search windows.
  if (first < BACKTEST_WARMUP_BARS || rows[0].time > date || rows.length - first < 2) return null;
  const actions = buildMaSwingActions(data, selection);
  const actionsByIndex = new Map(actions.map(action => [action.index, action]));
  const cash = [0.5, 0.5], units = [0, 0], held = [false, false];
  let pending = null, peak = 1, drawdown = 0, trades = 0, entries = 0;
  for (let i = first; i < rows.length; i++) {
    if (pending) {
      for (const leg of pending.legs) {
        if (pending.action === 'entry' && !held[leg]) {
          units[leg] = cash[leg] / (rows[i].open * (1 + fee)); cash[leg] = 0; held[leg] = true;
        } else if (pending.action !== 'entry' && held[leg]) {
          cash[leg] = units[leg] * rows[i].open * (1 - fee); units[leg] = 0; held[leg] = false; trades++;
        }
      }
      if (pending.action === 'entry' && pending.legs.some(leg => held[leg])) entries++;
    }
    const equity = cash[0] + cash[1] + (units[0] + units[1]) * rows[i].close;
    peak = Math.max(peak, equity); drawdown = Math.max(drawdown, 1 - equity / peak);
    pending = actionsByIndex.get(i) || null;
  }
  return { returnPct: (cash[0] + cash[1] + (units[0] + units[1]) * rows.at(-1).close - 1) * 100,
    drawdownPct: drawdown * 100, entries, closedLegs: trades,
    start: rows[first].time, end: rows.at(-1).time };
}

export async function searchMaSwing(data, months, onProgress, cancelled = () => false) {
  let best = null, count = 0;
  const total = BACKTEST_COMBINATION_COUNT;
  if (!backtestMaSwing(data, {}, months)) throw new Error('所選期間資料不足（含均線暖機資料），無法比較。');
  for (const entry of MA_SWING_PERIODS) for (const shortExit of MA_SWING_PERIOD_OPTIONS)
    for (const longExit of MA_SWING_PERIOD_OPTIONS) for (const abovePeriod of MA_SWING_PERIOD_OPTIONS)
      for (const risingPeriod of MA_SWING_PERIOD_OPTIONS) {
        if (cancelled()) return null;
        if (!isValidMaSwingExitPair(shortExit, longExit)) continue;
        const settings = { entry, shortExit, longExit, abovePeriod, risingPeriod };
        const result = backtestMaSwing(data, settings, months);
        if (result.entries && (!best || result.returnPct > best.result.returnPct
          || (result.returnPct === best.result.returnPct && result.drawdownPct < best.result.drawdownPct))) best = { settings, result };
        if (++count % 64 === 0) { onProgress(count / total); await new Promise(resolve => setTimeout(resolve, 0)); }
      }
  onProgress(1);
  return best;
}
