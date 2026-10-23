const dateOnly = value => {
  const result = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(result) ? result.slice(0, 10) : null;
};

const dateInTimeZone = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const yahooEventDate = value => {
  const raw = Number(value?.raw);
  if (Number.isFinite(raw) && raw > 0) {
    return dateInTimeZone(new Date(raw * 1000), 'Asia/Taipei');
  }
  return dateOnly(value?.fmt) || dateOnly(value);
};

export function parseYahooCalendar(result, now = new Date()) {
  const calendar = result?.calendarEvents || {};
  const earningsChart = result?.earnings?.earningsChart || {};
  const rawDates = calendar?.earnings?.earningsDate || calendar?.earningsDate || earningsChart?.earningsDate || [];
  const dates = (Array.isArray(rawDates) ? rawDates : [rawDates])
    .map(yahooEventDate)
    .filter(Boolean)
    .sort();
  const reportedDates = (earningsChart?.quarterly || [])
    .map(item => yahooEventDate(item?.reportedDate))
    .filter(Boolean)
    .sort();
  const today = dateInTimeZone(now, 'Asia/Taipei');
  const nextDate = dates.find(date => date >= today) || null;
  const previousDate = reportedDates.filter(date => date < today).at(-1)
    || dates.filter(date => date < today).at(-1)
    || null;
  return { nextDate, previousDate };
}
