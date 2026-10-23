import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nasdaqSourceDatesForMonth,
  taipeiNasdaqEvent,
} from '../supabase/functions/financial-reports/nasdaqCalendar.shared.js';

test('Nasdaq Alphabet after-hours earnings appears on Taiwan Oct 29 as 2026 Q3', () => {
  const event = taipeiNasdaqEvent('2026-10-28', {
    symbol: 'GOOGL',
    time: 'time-after-hours',
    fiscalQuarterEnding: 'Sep/2026',
  });
  assert.equal(event.date, '2026-10-29');
  assert.equal(event.sourceDate, '2026-10-28');
  assert.equal(event.quarter, '2026 Q3');
});

test('calendar requests include tomorrow and yesterday for the current month and adjacent source month', () => {
  const dates = nasdaqSourceDatesForMonth('2026-10', '2026-10-22');
  assert.equal(dates[0], '2026-10-21');
  assert.equal(dates.at(-1), '2026-10-31');
  assert.equal(nasdaqSourceDatesForMonth('2026-11', '2026-10-22')[0], '2026-10-31');
});
