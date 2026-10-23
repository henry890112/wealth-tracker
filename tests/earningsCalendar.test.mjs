import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYahooCalendar } from '../supabase/functions/financial-reports/earningsCalendar.shared.js';

test('converts a US earnings timestamp to the Taiwan calendar date after midnight', () => {
  const result = parseYahooCalendar({
    calendarEvents: { earnings: { earningsDate: [{ raw: 1792526400, fmt: '2026-10-20' }] } },
    earnings: { earningsChart: { quarterly: [{ reportedDate: { raw: 1792526451, fmt: '2026-10-20' } }] } },
  }, new Date('2026-10-22T14:18:00.000Z'));

  assert.equal(result.previousDate, '2026-10-21');
  assert.equal(result.nextDate, null);
});

test('keeps a same-day upcoming earnings timestamp on the Taiwan date', () => {
  const result = parseYahooCalendar({
    calendarEvents: { earnings: { earningsDate: [{ raw: 1792672200, fmt: '2026-10-22' }] } },
    earnings: { earningsChart: { quarterly: [] } },
  }, new Date('2026-10-22T14:18:00.000Z'));

  assert.equal(result.nextDate, '2026-10-22');
  assert.equal(result.previousDate, null);
});

test('falls back to the provider date when no timestamp is present', () => {
  const result = parseYahooCalendar({
    calendarEvents: { earnings: { earningsDate: [{ fmt: '2026-10-29' }] } },
  }, new Date('2026-10-22T14:18:00.000Z'));

  assert.equal(result.nextDate, '2026-10-29');
});
