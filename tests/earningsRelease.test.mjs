import test from 'node:test';
import assert from 'node:assert/strict';
import { latestSecEarningsRelease, parseSecEarningsReleaseHtml } from '../supabase/functions/financial-reports/earningsRelease.shared.js';

test('selects the newest SEC item 2.02 earnings release, not an unrelated 8-K', () => {
  const submissions = { filings: { recent: {
    form: ['8-K', '8-K', '8-K', '10-Q'],
    items: ['1.01,9.01', '2.02,9.01', '2.02,9.01', ''],
    filingDate: ['2026-10-21', '2026-10-20', '2026-08-04', '2026-08-04'],
    accessionNumber: ['0001628280-26-066500', '0001628280-26-066482', '0001628280-26-052515', '0001628280-26-052516'],
    primaryDocument: ['other.htm', 'spcx-20261020.htm', 'spcx-20260804.htm', 'quarter.htm'],
  } } };
  assert.deepEqual(latestSecEarningsRelease(submissions, '0001181412'), {
    date: '2026-10-20',
    accession: '0001628280-26-066482',
    primaryDocument: 'spcx-20261020.htm',
    form: '8-K',
    source: 'SEC 8-K・業績新聞稿',
    url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026066482/spcx-20261020.htm',
  });
});

test('rejects malformed or missing SEC filing links rather than fabricating an announcement', () => {
  const recent = { form: ['8-K'], items: ['2.02'], filingDate: ['2026-10-20'], accessionNumber: ['0001628280-26-066482'], primaryDocument: ['../unsafe.htm'] };
  assert.equal(latestSecEarningsRelease({ filings: { recent } }, '1181412'), null);
  recent.primaryDocument = 'release.htm';
  assert.equal(latestSecEarningsRelease({ filings: { recent } }, 'not-a-cik'), null);
});

test('parses quarterly values and period from an SEC 8-K consolidated income statement', () => {
  const html = `<div>Space Exploration Technologies Corp. Consolidated Statements of Operations (in millions, except per share data) (unaudited)</div>
    <table>
      <tr><td></td><td>Three Months Ended September 30,</td><td></td><td>Nine Months Ended September 30,</td></tr>
      <tr><td></td><td>2026</td><td></td><td>2025</td></tr>
      <tr><td>Revenue</td><td>$14,575</td><td></td><td>$5,576</td></tr>
      <tr><td>Income (loss) from operations</td><td>$2,791</td><td></td><td>$(273)</td></tr>
      <tr><td>Net income (loss)</td><td>$4,404</td><td></td><td>$(1,054)</td></tr>
      <tr><td>Net income (loss) per share of common stock</td><td></td><td></td></tr>
      <tr><td>Basic</td><td>$0.37</td><td></td><td>$(0.36)</td></tr>
      <tr><td>Diluted</td><td>$0.35</td><td></td><td>$(0.36)</td></tr>
    </table>`;
  const row = parseSecEarningsReleaseHtml(html, { date: '2026-10-20' });
  assert.equal(row.periodEnd, '2026-09-30');
  assert.equal(row.label, '2026 Q3');
  assert.equal(row.revenue, 14_575_000_000);
  assert.equal(row.revenueYoY, (14_575 - 5_576) / 5_576 * 100);
  assert.equal(row.operatingIncome, 2_791_000_000);
  assert.equal(row.netIncome, 4_404_000_000);
  assert.equal(row.eps, 0.35);
  assert.equal(row.freeCashFlow, null);
});

test('does not infer quarter figures when the release lacks a recognizable dated statement', () => {
  const html = '<table><tr><td>Consolidated Statements of Operations</td></tr><tr><td>Revenue</td><td>$1,200</td></tr></table>';
  assert.equal(parseSecEarningsReleaseHtml(html, { date: '2026-10-20' }), null);
});
