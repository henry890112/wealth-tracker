import { getTaipeiMonthStart } from '../../lib/date.js';

export const PNL_GAIN_COLOR = '#0DBD8B';
const PNL_LOSS_COLOR = '#F03030';
export const PNL_GAIN_SOFT = 'rgba(13,189,139,0.13)';
export const PNL_LOSS_SOFT = 'rgba(240,48,48,0.10)';

export const PNL_METRICS = [
  { key: 'realized', label: '已實現', seriesKey: 'realizedPnl', changeKey: 'realizedChange', pctKey: 'realizedPct', color: PNL_GAIN_COLOR },
  { key: 'unrealized', label: '未實現', seriesKey: 'unrealizedPnl', changeKey: 'unrealizedChange', pctKey: 'unrealizedPct', color: '#F5A623' },
  { key: 'total', label: '總損益', seriesKey: 'totalPnl', changeKey: 'totalDiff', pctKey: 'totalPct', color: '#60A5FA' },
];

export const buildTradePnlViews = (points = []) => {
  const usable = points
    .filter(point => point?.date && Number.isFinite(Number(point.totalPnl)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const series = usable.map(point => ({
    date: point.date,
    realizedPnl: Number(point.realizedPnl) || 0,
    unrealizedPnl: Number(point.unrealizedPnl) || 0,
    totalPnl: Number(point.totalPnl) || 0,
  }));
  const daily = {};
  for (let index = 1; index < usable.length; index += 1) {
    const previous = usable[index - 1];
    const current = usable[index];
    const previousCost = Number(previous.totalCost) > 0
      ? Number(previous.totalCost)
      : Math.max(Number(previous.currentValue) || 0, 0);
    const realizedDiff = Number(current.realizedPnl) - Number(previous.realizedPnl);
    const unrealizedDiff = Number(current.unrealizedPnl) - Number(previous.unrealizedPnl);
    const totalDiff = Number(current.totalPnl) - Number(previous.totalPnl);
    const denominator = previousCost > 0 ? previousCost : Math.max(Number(current.totalCost) || 0, 0);
    daily[current.date] = {
      diff: totalDiff,
      realizedDiff,
      unrealizedDiff,
      totalDiff,
      prevValue: previousCost,
      realizedPnl: Number(current.realizedPnl) || 0,
      unrealizedPnl: Number(current.unrealizedPnl) || 0,
      totalPnl: Number(current.totalPnl),
      realizedPct: denominator > 0 ? (realizedDiff / denominator) * 100 : 0,
      unrealizedPct: denominator > 0 ? (unrealizedDiff / denominator) * 100 : 0,
      totalPct: denominator > 0 ? (totalDiff / denominator) * 100 : 0,
    };
  }

  const monthStart = getTaipeiMonthStart(23);
  const monthLast = {};
  usable
    .filter(point => point.date >= monthStart)
    .forEach(point => { monthLast[point.date.slice(0, 7)] = point; });
  const months = Object.entries(monthLast).sort(([a], [b]) => a.localeCompare(b));
  const monthly = [];
  for (let index = 1; index < months.length; index += 1) {
    const [ym, current] = months[index];
    const previous = months[index - 1][1];
    const realizedChange = Number(current.realizedPnl) - Number(previous.realizedPnl);
    const unrealizedChange = Number(current.unrealizedPnl) - Number(previous.unrealizedPnl);
    const totalChange = Number(current.totalPnl) - Number(previous.totalPnl);
    const denominator = Number(previous.totalCost) > 0
      ? Number(previous.totalCost)
      : Math.max(Number(current.totalCost) || Number(previous.currentValue) || 0, 0);
    const [year, month] = ym.split('-');
    monthly.push({
      label: `${year}/${parseInt(month, 10)}月`,
      realizedChange,
      unrealizedChange,
      totalChange,
      // PNL_METRICS uses `totalDiff` for both the daily calendar and the
      // monthly list. Keep the same key so signs and percentages stay aligned.
      totalDiff: totalChange,
      realizedPct: denominator > 0 ? (realizedChange / denominator) * 100 : 0,
      unrealizedPct: denominator > 0 ? (unrealizedChange / denominator) * 100 : 0,
      totalPct: denominator > 0 ? (totalChange / denominator) * 100 : 0,
    });
  }
  return { daily, monthly, series };
};

export const filterTradePnlSeries = (series = [], selectedPeriod, customRange) => {
  if (!series.length) return [];
  const ordered = [...series].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (customRange?.start && customRange?.end) {
    return ordered.filter(point => point.date >= customRange.start && point.date <= customRange.end);
  }
  const days = Number(selectedPeriod?.days);
  if (!Number.isFinite(days) || days <= 0) return ordered;
  const endDate = ordered.at(-1)?.date;
  if (!endDate) return ordered;
  const cutoff = new Date(`${endDate}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (Math.floor(days) - 1));
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  return ordered.filter(point => point.date >= cutoffKey && point.date <= endDate);
};

export const formatAmount = amount => Math.round(amount).toLocaleString('zh-TW');
const pnlSign = value => Number(value) > 0 ? '+' : Number(value) < 0 ? '−' : '';
export const pnlColor = (value, neutralColor) => Number(value) > 0
  ? PNL_GAIN_COLOR
  : Number(value) < 0 ? PNL_LOSS_COLOR : neutralColor;
export const pnlSoftColor = (value, neutralColor) => Number(value) > 0
  ? PNL_GAIN_SOFT
  : Number(value) < 0 ? PNL_LOSS_SOFT : neutralColor;
export const signedPnlAmount = (value, formatter = formatAmount) => {
  const number = Number(value) || 0;
  return `${pnlSign(number)}${formatter(Math.abs(number))}`;
};
export const signedPnlPercent = (value, digits = 2) => {
  const number = Number(value) || 0;
  const rounded = Number(number.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}%`;
};
