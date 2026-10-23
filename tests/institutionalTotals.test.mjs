import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateInstitutionalEstimatedBuyPrices, calculateInstitutionalFlowTotals, calculateInstitutionalPressurePrices, calculateInstitutionalTotals, joinInstitutionalRowsWithClosingPrices, normalizeInstitutionalRows } from '../src/utils/institutionalTotals.js';

test('full market analysis totals use latest unique trading days in 億元', () => {
  const points = Array.from({ length: 30 }, (_, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    buy: 10 + index, sell: 5, net: 5 + index,
  }));
  points.push({ ...points[29] });
  const totals = calculateInstitutionalFlowTotals(points);
  assert.deepEqual(totals.map(row => row.days), [5, 10, 20, 30]);
  assert.deepEqual(totals.map(row => row.net), [160, 295, 490, 585]);
  assert.equal(totals[0].buy - totals[0].sell, totals[0].net);
});

test('full analysis does not show a 20-day total when only 18 days are available', () => {
  const points = Array.from({ length: 18 }, (_, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, '0')}`,
    buy: 2, sell: 1, net: 1,
  }));
  const totals = calculateInstitutionalFlowTotals(points);
  assert.equal(totals[0].net, 5);
  assert.equal(totals[1].net, 10);
  assert.equal(totals[2].complete, false);
  assert.equal(totals[2].availableDays, 18);
  assert.equal(totals[3].complete, false);
});

test('institutional table matches only same-day close, never a nearby or intraday price', () => {
  const institutions = [
    { time: '2026-10-20', foreign: -10, trust: 2, dealer: 1 },
    { time: '2026-10-19', foreign: 5, trust: 0, dealer: 0 },
  ];
  const closes = [
    { time: '2026-10-19', close: 163.5 },
    { time: '2026-10-21', close: 168 },
  ];
  const joined = joinInstitutionalRowsWithClosingPrices(institutions, closes);
  assert.equal(joined[0].close, null);
  assert.equal(joined[1].close, 163.5);
});

test('5/10/20/30 trading-day totals use the latest unique published dates', () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    time: `2026-09-${String(index + 1).padStart(2, '0')}`,
    foreign: index + 1,
    trust: -(index + 1),
    dealerSelf: 2,
    dealerHedging: -1,
  }));
  rows.push({ ...rows[29], foreign: 9999 });
  const totals = calculateInstitutionalTotals(rows);
  assert.deepEqual(totals.map(row => row.days), [5, 10, 20, 30]);
  assert.deepEqual(totals.map(row => row.foreign), [140, 255, 410, 465]);
  assert.deepEqual(totals.map(row => row.trust), [-140, -255, -410, -465]);
  assert.deepEqual(totals.map(row => row.dealer), [5, 10, 20, 30]);
  assert.deepEqual(totals.map(row => row.all), [5, 10, 20, 30]);
});

test('incomplete periods and missing values do not produce misleading totals', () => {
  const rows = Array.from({ length: 9 }, (_, index) => ({
    time: `2026-10-${String(index + 1).padStart(2, '0')}`,
    foreign: 10, trust: 20, dealer: 30,
  }));
  assert.equal(calculateInstitutionalTotals(rows)[0].foreign, 50);
  assert.equal(calculateInstitutionalTotals(rows)[1].complete, false);
  rows[8].trust = null;
  assert.equal(calculateInstitutionalTotals(rows)[0].complete, false);
  assert.equal(normalizeInstitutionalRows(rows)[0].all, null);
});

test('estimated buy prices weight market average by gross institutional buys, not net flow', () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    time: `2026-10-${String(index + 1).padStart(2, '0')}`,
    foreign: -100, trust: 20, dealer: 0,
    foreignBuy: index === 4 ? 300 : 100,
    trustBuy: 100,
    dealerBuy: 0,
    referencePrice: index === 4 ? 110 : 100,
  }));
  const [five, ten] = calculateInstitutionalEstimatedBuyPrices(rows);
  assert.equal(five.foreign, 73000 / 700);
  assert.equal(five.trust, 102);
  assert.equal(five.dealer, null);
  assert.equal(five.all, 124000 / 1200);
  assert.equal(ten.all, null);
});

test('old payloads and missing market prices do not fabricate estimated costs', () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    time: `2026-10-${String(index + 1).padStart(2, '0')}`,
    foreign: 10, trust: 20, dealer: 30,
  }));
  assert.equal(calculateInstitutionalEstimatedBuyPrices(rows)[0].foreign, null);
  rows.forEach(row => { row.foreignBuy = 10; row.trustBuy = 10; row.dealerBuy = 10; row.referencePrice = 100; });
  rows[4].referencePrice = null;
  assert.equal(calculateInstitutionalEstimatedBuyPrices(rows)[0].foreign, null);
  rows[4].foreignBuy = 0;
  rows[4].trustBuy = 0;
  rows[4].dealerBuy = 0;
  assert.equal(calculateInstitutionalEstimatedBuyPrices(rows)[0].foreign, 100);
});

test('pressure price weights only same-direction net-flow days, not a simple closing-price average', () => {
  const rows = [
    { time: '2026-10-05', foreign: 100, trust: 0, dealer: 0 },
    { time: '2026-10-04', foreign: 300, trust: 0, dealer: 0 },
    { time: '2026-10-03', foreign: -200, trust: 0, dealer: 0 },
    { time: '2026-10-02', foreign: 100, trust: 0, dealer: 0 },
    { time: '2026-10-01', foreign: 100, trust: 0, dealer: 0 },
  ];
  const prices = [
    { time: '2026-10-05', close: 80 },
    { time: '2026-10-04', close: 100 },
    { time: '2026-10-03', close: 200 },
    { time: '2026-10-02', close: 120 },
    { time: '2026-10-01', close: 140 },
  ];
  const [five, ten] = calculateInstitutionalPressurePrices(rows, prices);
  assert.equal(five.direction, 'buy');
  assert.equal(five.price, (100 * 80 + 300 * 100 + 100 * 120 + 100 * 140) / 600);
  assert.equal(ten.price, null);
});

test('pressure price handles net selling, zero net, and missing same-day close', () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    time: `2026-10-0${index + 1}`,
    foreign: index === 4 ? 20 : -10,
    trust: 0,
    dealer: 0,
  }));
  const prices = rows.map((row, index) => ({ time: row.time, close: 100 + index * 10 }));
  const [selling] = calculateInstitutionalPressurePrices(rows, prices);
  assert.equal(selling.direction, 'sell');
  assert.equal(selling.price, (100 + 110 + 120 + 130) / 4);
  rows[4].foreign = 40;
  assert.deepEqual(calculateInstitutionalPressurePrices(rows, prices)[0], { days: 5, price: null, direction: null });
  rows[4].foreign = -20;
  prices.pop();
  assert.equal(calculateInstitutionalPressurePrices(rows, prices)[0].price, null);
});
