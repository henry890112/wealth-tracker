const pad2 = value => String(value).padStart(2, '0');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function taipeiNasdaqEvent(sourceDate, row) {
  const symbol = String(row?.symbol || '').trim().toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) || !/^[A-Z0-9.-]{1,20}$/.test(symbol)) return null;
  const afterHours = row?.time === 'time-after-hours';
  const date = new Date(`${sourceDate}T00:00:00.000Z`);
  if (afterHours) date.setUTCDate(date.getUTCDate() + 1);
  const period = String(row?.fiscalQuarterEnding || '').match(/^([A-Za-z]{3})\/(\d{4})$/);
  const month = period ? MONTHS.indexOf(period[1].toLowerCase()) + 1 : 0;
  const quarter = month ? `${period[2]} Q${Math.ceil(month / 3)}` : null;
  return {
    symbol,
    date: date.toISOString().slice(0, 10),
    sourceDate,
    quarter,
    source: 'Nasdaq 財報日曆',
    status: 'upcoming',
    time: afterHours ? '美國盤後' : row?.time === 'time-before-market' ? '美國盤前' : null,
  };
}

export function nasdaqSourceDatesForMonth(month, today) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  first.setUTCDate(first.getUTCDate() - 1);
  const last = new Date(Date.UTC(year, monthNumber, 0));
  const todayDate = /^\d{4}-\d{2}-\d{2}$/.test(today || '') ? today : null;
  if (todayDate && month < todayDate.slice(0, 7)) return [];
  const cutoff = todayDate && month === todayDate.slice(0, 7)
    ? new Date(`${todayDate}T00:00:00.000Z`)
    : null;
  cutoff?.setUTCDate(cutoff.getUTCDate() - 1);
  const cutoffKey = cutoff?.toISOString().slice(0, 10) || null;
  const dates = [];
  for (const date = first; date <= last; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
    if (!cutoffKey || key >= cutoffKey) dates.push(key);
  }
  return dates;
}
