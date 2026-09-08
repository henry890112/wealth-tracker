// Persisted financial snapshots are calendar-day records.  Always derive the
// date in the user's primary market timezone instead of UTC, otherwise Taiwan
// mornings can accidentally overwrite the prior day's snapshot.
const taipeiParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return Object.fromEntries(parts
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, value]));
};

export const getTaipeiDateString = (date = new Date()) => {
  const { year, month, day } = taipeiParts(date);
  return `${year}-${month}-${day}`;
};

export const getTaipeiMonthStart = (monthsAgo = 0) => {
  const { year, month } = taipeiParts();
  const monthDate = new Date(Date.UTC(Number(year), Number(month) - 1 - monthsAgo, 1));
  return `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
};
