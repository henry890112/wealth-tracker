function shiftWeekendDeadline(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  const day = value.getUTCDay();
  if (day === 6) value.setUTCDate(value.getUTCDate() + 2);
  else if (day === 0) value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function taiwanFilingDeadline(year, kind) {
  if (kind === 'Q1') return { date: `${year}-05-15`, quarter: `${year} Q1` };
  if (kind === 'Q2') return { date: `${year}-08-14`, quarter: `${year} Q2` };
  if (kind === 'Q3') return { date: `${year}-11-14`, quarter: `${year} Q3` };
  return { date: `${year + 1}-03-31`, quarter: `${year} 年度年報` };
}

export function taiwanFilingEventsForMonth(month, symbols, today) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !/^\d{4}-\d{2}-\d{2}$/.test(today || '')) return [];

  const [year, monthNumber] = month.split('-').map(Number);
  const candidates = monthNumber === 3
    ? [taiwanFilingDeadline(year - 1, 'ANNUAL')]
    : monthNumber === 5
      ? [taiwanFilingDeadline(year, 'Q1')]
      : monthNumber === 8
        ? [taiwanFilingDeadline(year, 'Q2')]
        : monthNumber === 11
          ? [taiwanFilingDeadline(year, 'Q3')]
          : [];

  const deadlines = candidates
    .map(candidate => ({ ...candidate, date: shiftWeekendDeadline(candidate.date) }))
    .filter(candidate => candidate.date.startsWith(`${month}-`) && candidate.date >= today);
  if (!deadlines.length) return [];

  const validSymbols = [...new Set((Array.isArray(symbols) ? symbols : [])
    .map(value => String(value || '').trim().toUpperCase())
    .filter(symbol => /^[A-Z0-9.-]{1,20}$/.test(symbol)
      && !symbol.startsWith('00')
      && !symbol.startsWith('^')))];

  return validSymbols.flatMap(symbol => deadlines.map(deadline => ({
    symbol,
    date: deadline.date,
    quarter: deadline.quarter,
    source: '證券交易法第36條一般申報期限推算',
    status: 'filing_deadline',
    eventType: 'filing_deadline',
  })));
}
