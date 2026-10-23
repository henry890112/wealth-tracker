import test from 'node:test';
import assert from 'node:assert/strict';
import { taiwanFilingEventsForMonth } from '../supabase/functions/financial-reports/taiwanFilingCalendar.shared.js';

test('Taiwan Q3 general filing deadline moves from Saturday Nov 14 to Monday Nov 16, 2026', () => {
  const events = taiwanFilingEventsForMonth('2026-11', ['2330', '2454'], '2026-10-24');
  assert.deepEqual(events.map(({ symbol, date, quarter, status }) => ({ symbol, date, quarter, status })), [
    { symbol: '2330', date: '2026-11-16', quarter: '2026 Q3', status: 'filing_deadline' },
    { symbol: '2454', date: '2026-11-16', quarter: '2026 Q3', status: 'filing_deadline' },
  ]);
});

test('annual filing reminders use the prior fiscal year and keep the calendar month', () => {
  const events = taiwanFilingEventsForMonth('2027-03', ['2330'], '2027-03-01');
  assert.equal(events[0]?.date, '2027-03-31');
  assert.equal(events[0]?.quarter, '2026 年度年報');
});

test('past deadlines, invalid symbols, and Taiwan ETF/index symbols are omitted', () => {
  assert.deepEqual(taiwanFilingEventsForMonth('2026-11', ['2330'], '2026-11-17'), []);
  assert.deepEqual(taiwanFilingEventsForMonth('2026-11', ['0050', '^TWII'], '2026-10-24'), []);
  assert.deepEqual(taiwanFilingEventsForMonth('2026-10', ['2330'], '2026-10-24'), []);
});
