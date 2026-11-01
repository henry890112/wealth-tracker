import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MARKET_PULSE_ITEMS,
  formatMarketPulsePrice,
  marketPulseDailyChangePercent,
  marginHistoryCoverage,
  foreignHistoryCoverage,
  mergeInstitutionalHistoryRows,
  parseTwseMarginTrend,
  parseTpexMarginTrend,
  parseTwseIihMarketIndex,
  parseTpexIndexHistory,
  mergeMarketPulseQuotes,
  parseTpexRealtime,
  calculateYearOverYear,
  findHistoryPointAtOrBefore,
  parseFredLatestValue,
  parseFredSeries,
  parseMultplSp500Pe,
  parseMultplSp500PeHistory,
  parseTaiwanMarketFlowPayloads,
  parseTwseTaiexHistory,
  parseTwseTaiexCandles,
  withDailyMovingAverages,
  parseTwseMarketMaintenanceHistory,
  isTaiwanMarginHistoryCacheFresh,
  isTaiwanForeignHistoryCacheFresh,
} from '../src/services/marketOverview.js';

test('foreign history cache keeps older pages for a day but refreshes recent pages', () => {
  const originalNow = Date.now;
  const now = Date.parse('2026-10-20T12:00:00Z');
  Date.now = () => now;
  try {
    assert.equal(isTaiwanForeignHistoryCacheFresh({ cachedAt: now - 20 * 60_000, data: { asOf: '2026-10-19' } }), false);
    assert.equal(isTaiwanForeignHistoryCacheFresh({ cachedAt: now - 23 * 60 * 60_000, data: { asOf: '2026-09-01' } }), true);
    assert.equal(isTaiwanForeignHistoryCacheFresh({ cachedAt: now - 25 * 60 * 60_000, data: { asOf: '2026-09-01' } }), false);
    assert.equal(isTaiwanForeignHistoryCacheFresh(null), false);
  } finally {
    Date.now = originalNow;
  }
});

test('margin history cache refreshes recent data frequently but retains historical pages for a day', () => {
  const originalNow = Date.now;
  const now = Date.parse('2026-10-20T12:00:00Z');
  Date.now = () => now;
  try {
    assert.equal(isTaiwanMarginHistoryCacheFresh({ cachedAt: now - 20 * 60_000, data: { asOf: '2026-10-19' } }), false);
    assert.equal(isTaiwanMarginHistoryCacheFresh({ cachedAt: now - 23 * 60 * 60_000, data: { asOf: '2026-09-01' } }), true);
    assert.equal(isTaiwanMarginHistoryCacheFresh({ cachedAt: now - 25 * 60 * 60_000, data: { asOf: '2026-09-01' } }), false);
  } finally {
    Date.now = originalNow;
  }
});

test('TWSE whole-market collateral maintenance history preserves dates and percent units', () => {
  assert.deepEqual(parseTwseMarketMaintenanceHistory({
    stat: 'OK',
    data: [
      { date: '20261015', keepRate: 183.04 },
      { date: '20261016', keepRate: 184.6 },
      { date: 'bad', keepRate: 200 },
    ],
  }), [
    { date: '2026-10-15', rate: 183.04 },
    { date: '2026-10-16', rate: 184.6 },
  ]);
});

test('TWSE monthly TAIEX history parses ROC dates and closing index only', () => {
  const rows = parseTwseTaiexHistory({
    stat: 'OK',
    fields: ['日期', '開盤指數', '最高指數', '最低指數', '收盤指數'],
    data: [
      ['115/10/15', '47,000.00', '48,000.00', '46,000.00', '47,200.50'],
      ['115/10/16', '46,995.03', '47,520.60', '46,995.03', '47,111.26'],
      ['bad', '1', '2', '3', '4'],
    ],
  });
  assert.deepEqual(rows, [
    { date: '2026-10-15', close: 47200.5 },
    { date: '2026-10-16', close: 47111.26 },
  ]);
});

test('TWSE daily TAIEX candles require valid official OHLC fields', () => {
  assert.deepEqual(parseTwseTaiexCandles({ stat: 'OK', fields: ['日期', '開盤指數', '最高指數', '最低指數', '收盤指數'], data: [
    ['115/10/16', '46,995.03', '47,520.60', '46,995.03', '47,111.26'],
    ['115/10/15', '48,000', '47,000', '46,000', '47,000'],
  ] }), [{ date: '2026-10-16', open: 46995.03, high: 47520.6, low: 46995.03, close: 47111.26 }]);
});

test('MA20 and MA60 use prior trading closes, including candles before the visible period', () => {
  const candles = Array.from({ length: 61 }, (_, index) => ({ date: `day-${String(index).padStart(2, '0')}`, close: index + 1 }));
  const result = withDailyMovingAverages(candles);
  assert.equal(result[18].ma20, null);
  assert.equal(result[19].ma20, 10.5);
  assert.equal(result[58].ma60, null);
  assert.equal(result[59].ma60, 30.5);
  assert.equal(result[60].ma20, 51.5);
  assert.equal(result[60].ma60, 31.5);
  assert.equal(result.slice(-2)[0].ma60, 30.5);
});

test('official Taiwan market summaries convert units and add only matching dates', () => {
  const twseMargin = { date: '20261016', tables: [{ data: [['融資金額(仟元)', '0', '0', '0', '646,415,871', '645,594,048']] }] };
  const twseForeign = { date: '20261016', data: [
    ['自營商(自行買賣)', '8,381,436,969', '18,560,032,105', '-10,178,595,136'],
    ['自營商(避險)', '28,653,271,647', '51,888,684,916', '-23,235,413,269'],
    ['投信', '43,848,499,145', '32,800,992,175', '11,047,506,970'],
    ['外資及陸資(不含外資自營商)', '356,324,360,692', '402,471,523,529', '-46,147,162,837'],
    ['合計', '437,207,568,453', '505,721,232,725', '-68,513,664,272'],
  ] };
  const tpexMargin = { date: '20261016', tables: [{ summary: [['', '融資金(仟元)', '218,961,719', '', '', '', '218,250,119']] }] };
  const tpexForeign = { date: '20261016', tables: [{ data: [
    ['外資及陸資合計', '73,677,462,203', '76,961,795,204', '-3,284,333,001'],
    ['　外資及陸資(不含自營商)', '73,677,462,203', '76,961,795,204', '-3,284,333,001'],
    ['投信', '6,056,353,497', '4,682,247,965', '1,374,105,532'],
    ['自營商合計', '5,836,459,951', '9,116,991,593', '-3,280,531,642'],
    ['　自營商(自行買賣)', '1,511,400,251', '4,619,670,128', '-3,108,269,877'],
    ['　自營商(避險)', '4,325,059,700', '4,497,321,465', '-172,261,765'],
  ] }] };
  const result = parseTaiwanMarketFlowPayloads([twseMargin, twseForeign, tpexMargin, tpexForeign]);
  assert.equal(result.combined.margin.balance, 863844167000);
  assert.equal(result.combined.margin.change, -1533423000);
  assert.equal(result.combined.foreign.net, -49431495838);
  assert.equal(result.combined.foreign.buy - result.combined.foreign.sell, result.combined.foreign.net);
  assert.equal(result.twse.institutional.dealer.net, -33414008405);
  assert.equal(result.tpex.institutional.dealer.net, -3280531642);
  assert.equal(result.combined.institutional.trust.net, 12421612502);
  assert.equal(result.combined.institutional.directional.net, result.combined.institutional.foreign.net + result.combined.institutional.trust.net);
  assert.equal(result.combined.institutional.all.net, result.combined.institutional.directional.net + result.combined.institutional.dealer.net);
  assert.equal(result.combined.margin.date, '2026-10-16');

  tpexForeign.date = '20261015';
  assert.equal(parseTaiwanMarketFlowPayloads([twseMargin, twseForeign, tpexMargin, tpexForeign]).combined.foreign, null);
  assert.equal(parseTaiwanMarketFlowPayloads([twseMargin, twseForeign, tpexMargin, tpexForeign]).combined.institutional, null);
});

test('missing institutional subcategories do not fabricate a three-institution total', () => {
  const result = parseTaiwanMarketFlowPayloads([
    null, { date: '20261016', data: [['外資及陸資(不含外資自營商)', '10', '4', '6']] },
    null, { date: '20261016', tables: [{ data: [['外資及陸資(不含自營商)', '3', '1', '2']] }] },
  ]);
  assert.equal(result.combined.foreign.net, 8);
  assert.equal(result.combined.institutional.all, null);
  assert.equal(result.combined.institutional.directional, null);
});

test('sparse monthly margin pages are rejected instead of presented as a full period', () => {
  const endDate = '2026-10-16';
  const row = date => ({ date, twse: { date, balance: 100 }, tpex: { date, balance: 50 } });
  assert.equal(marginHistoryCoverage(['2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-10-16'].map(row), endDate).complete, false);
  const dates = ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
  assert.equal(marginHistoryCoverage(dates.map(row), endDate).complete, true);
});

test('foreign history requires both markets on dated, sufficiently covered pages', () => {
  const endDate = '2026-10-16';
  const dates = ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
  const rows = dates.map(date => ({ date, twse: { date, foreign: { buy: 10, sell: 8, net: 2 } }, tpex: { date, foreign: { buy: 0, sell: 1, net: -1 } } }));
  assert.equal(foreignHistoryCoverage(rows, endDate).complete, true);
  assert.equal(foreignHistoryCoverage(rows.slice(0, 4), endDate).complete, false);
  assert.equal(foreignHistoryCoverage(rows.slice(0, 14), endDate).complete, false);
  assert.equal(foreignHistoryCoverage(rows.map(row => ({ ...row, tpex: null })), endDate).complete, false);
  assert.equal(foreignHistoryCoverage(rows.map(row => ({ ...row, twse: { ...row.twse, date: '2026-10-16' } })), endDate).complete, false);
});

test('institutional coverage follows the selected category and market', () => {
  const endDate = '2026-10-16';
  const dates = ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
  const trust = { buy: 20, sell: 10, net: 10 };
  const rows = dates.map(date => ({ date, twse: { date, trust }, tpex: null }));
  assert.equal(foreignHistoryCoverage(rows, endDate, 'trust', 'twse').complete, true);
  assert.equal(foreignHistoryCoverage(rows, endDate, 'foreign', 'twse').complete, false);
  assert.equal(foreignHistoryCoverage(rows, endDate, 'trust', 'combined').complete, false);
});

test('institutional payload keeps trust data when foreign data is absent', () => {
  const result = parseTaiwanMarketFlowPayloads([
    null,
    { date: '20261016', data: [['投信', '2000000000', '1000000000', '1000000000']] },
    null,
    null,
  ]);
  assert.equal(result.twse.foreign, null);
  assert.equal(result.twse.institutional.trust.net, 1000000000);
});

test('partial institutional retries preserve previously loaded categories and index closes', () => {
  const date = '2026-10-16';
  const foreign = { date, buy: 30, sell: 20, net: 10 };
  const trust = { date, buy: 20, sell: 15, net: 5 };
  const rows = mergeInstitutionalHistoryRows([
    { date, twse: { date, foreign }, tpex: null, taiexClose: 47111 },
    { date, twse: { date, trust }, tpex: { date, trust }, taiexClose: null },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].twse.foreign.net, 10);
  assert.equal(rows[0].twse.trust.net, 5);
  assert.equal(rows[0].combined.trust.net, 10);
  assert.equal(rows[0].taiexClose, 47111);
});

test('official batch margin trends preserve money units and daily balance changes', () => {
  assert.deepEqual(parseTwseMarginTrend({ stat: 'OK', data: [
    { date: '20261015', marginAmt: 646415015 },
    { date: '20261016', marginAmt: 645594048 },
  ] }), [
    { date: '2026-10-15', balance: 646415015000, previous: null, change: null },
    { date: '2026-10-16', balance: 645594048000, previous: 646415015000, change: -820967000 },
  ]);
  assert.deepEqual(parseTpexMarginTrend({ stat: 'ok', trend: [
    { date: '20261015', marginBalance: 2180.5 },
    { date: '20261016', marginBalance: 2182.5 },
  ] }), [
    { date: '2026-10-15', balance: 218050000000, previous: null, change: null },
    { date: '2026-10-16', balance: 218250000000, previous: 218050000000, change: 200000000 },
  ]);
});

test('official IIH market series yields same-day TAIEX closes for margin comparison', () => {
  assert.deepEqual(parseTwseIihMarketIndex({ taiex: {
    categories: ['2026/10/15', '2026/10/16'],
    series: [{ data: [46969.87, 47111.26] }],
  } }), [
    { date: '2026-10-15', close: 46969.87 },
    { date: '2026-10-16', close: 47111.26 },
  ]);
});

test('market pulse formats large index values compactly for one-line cards', () => {
  assert.equal(formatMarketPulsePrice(49301.96), '49,301.96');
  assert.equal(formatMarketPulsePrice(7804.47), '7,804.47');
  assert.equal(formatMarketPulsePrice(66.8), '66.80');
  assert.equal(formatMarketPulsePrice(null), '—');
});

test('market pulse historical change uses the selected close and previous trading close', () => {
  assert.equal(marketPulseDailyChangePercent(48024.6, 47111.26), (48024.6 - 47111.26) / 47111.26 * 100);
  assert.equal(marketPulseDailyChangePercent(90, 100), -10);
  assert.equal(marketPulseDailyChangePercent(100, null), null);
  assert.equal(marketPulseDailyChangePercent(100, 0), null);
});

test('market pulse keeps Taiwan and US index and sector groups in a stable order', () => {
  assert.deepEqual(MARKET_PULSE_ITEMS.map(item => `${item.market}:${item.category}`), [
    'TW:大盤', 'TW:中小型股', 'TW:大型股', 'TW:科技', 'TW:半導體',
    'US:大盤', 'US:藍籌', 'US:小型股', 'US:科技成長', 'US:科技廣度', 'US:半導體', 'US:市場風險',
  ]);
  assert.ok(MARKET_PULSE_ITEMS.every(item => item.chartable !== false));
});

test('TPEx monthly history provides dated OHLC candles for the shared pulse chart', () => {
  assert.deepEqual(parseTpexIndexHistory({ tables: [{
    fields: ['日期', '開市', '最高', '最低', '收市', '漲/跌'],
    data: [
      ['2026/10/01', '417.48', '421.21', '417.09', '418.82', '1.75'],
      ['2026/10/02', '418.82', '420.00', '410.00', '411.50', '-7.32'],
      ['bad', '418.82', '420.00', '410.00', '411.50', '0'],
    ],
  }] }), [
    { time: '2026-10-01', open: 417.48, high: 421.21, low: 417.09, close: 418.82, volume: 0 },
    { time: '2026-10-02', open: 418.82, high: 420, low: 410, close: 411.5, volume: 0 },
  ]);
});

test('TPEx realtime payload becomes a normalized market quote', () => {
  const quote = parseTpexRealtime({
    infoArray: { v: '2057.78', h: '415.3', y: '420.13', l: '395.18', o: '415.3' },
    taiex: { datetime: '2026/10/15 12:36:00', index: '398.82', diff: '-21.31', percent: '-5.07' },
  });
  assert.equal(quote.symbol, 'TPEX');
  assert.equal(quote.price, 398.82);
  assert.equal(quote.change_percent, -5.07);
  assert.equal(quote.previous_close, 420.13);
  assert.equal(quote.source, 'TPEx Official');
});

test('market pulse joins quotes without hiding unavailable markets', () => {
  const pulse = mergeMarketPulseQuotes(MARKET_PULSE_ITEMS, {
    TW: { '^TWII': { price: 25000, change_percent: 1.2 } },
    US: { '^GSPC': { price: 6800, change_percent: -0.4 } },
  });
  assert.equal(pulse.length, 12);
  assert.equal(pulse[0].available, true);
  assert.equal(pulse[0].quote.price, 25000);
  assert.equal(pulse[1].available, false);
  assert.equal(pulse[5].quote.change_percent, -0.4);
});

test('market pulse refresh keeps the last known quote as stale when the refresh has no result', () => {
  const previous = [{
    ...MARKET_PULSE_ITEMS[0],
    quote: { price: 25000, change_percent: 1.2, quote_status: 'intraday', is_stale: false },
  }];
  const pulse = mergeMarketPulseQuotes(MARKET_PULSE_ITEMS, { TW: { '^TWII': null }, US: {} }, previous);
  assert.equal(pulse[0].available, true);
  assert.equal(pulse[0].quote.price, 25000);
  assert.equal(pulse[0].quote.is_stale, true);
  assert.equal(pulse[0].quote.quote_status, 'stale');
  assert.equal(pulse[1].available, false);
});

test('market pulse refresh prefers a valid new quote over its stale fallback', () => {
  const previous = [{ ...MARKET_PULSE_ITEMS[0], quote: { price: 25000, is_stale: false } }];
  const pulse = mergeMarketPulseQuotes(MARKET_PULSE_ITEMS, { TW: { '^TWII': { price: 25100, is_stale: false } } }, previous);
  assert.equal(pulse[0].quote.price, 25100);
  assert.equal(pulse[0].quote.is_stale, false);
});

test('FRED parser uses the newest available non-empty value', () => {
  const csv = [
    'observation_date,DGS10',
    '2026-10-01,5.24',
    '2026-10-02,5.28',
    '2026-10-03,',
  ].join('\n');
  assert.deepEqual(parseFredLatestValue(csv, 'DGS10'), { value: 5.28, asOf: '2026-10-02' });
});

test('FRED parser keeps chronological history and skips missing values', () => {
  const csv = 'observation_date,DGS30\n2026-10-01,5.60\n2026-10-02,.\n2026-10-03,5.63';
  assert.deepEqual(parseFredSeries(csv, 'DGS30'), [
    { date: '2026-10-01', value: 5.6 },
    { date: '2026-10-03', value: 5.63 },
  ]);
});

test('CPI year-over-year compares the latest month with the same month last year', () => {
  const history = [
    { date: '2025-08-01', value: 100 },
    { date: '2025-09-01', value: 100 },
    { date: '2025-11-01', value: 100 },
    { date: '2026-08-01', value: 105 },
    { date: '2026-09-01', value: 110 },
  ];
  const result = calculateYearOverYear(history);
  assert.ok(Math.abs(result.value - 10) < 1e-9);
  assert.equal(result.asOf, '2026-09-01');
  assert.equal(result.previousAsOf, '2025-09-01');
  assert.equal(calculateYearOverYear(history, '2026-08-01').previousAsOf, '2025-08-01');
});

test('historical market cards synchronize to the nearest available point before the dragged date', () => {
  const history = [
    { date: '2026-08-01', value: 100 },
    { date: '2026-08-03', value: 102 },
    { date: '2026-08-05', value: 104 },
  ];
  assert.deepEqual(findHistoryPointAtOrBefore(history, '2026-08-04'), { date: '2026-08-03', value: 102 });
  assert.equal(findHistoryPointAtOrBefore(history, '2026-07-31'), null);
});

test('Multpl parser reads the first table row and estimate marker', () => {
  const html = '<table><tr><th>Date</th><th>Value</th></tr><tr class="odd"><td>Oct 5, 2026</td><td><abbr title="Estimate">†</abbr>26.53</td></tr></table>';
  assert.deepEqual(parseMultplSp500Pe(html), { value: 26.53, asOf: '2026-10-05', estimated: true });
});

test('Multpl parser sorts monthly history from oldest to newest', () => {
  const html = '<table id="datatable"><tr><td>Oct 5, 2026</td><td>†26.53</td></tr><tr><td>Sep 1, 2026</td><td>26.04</td></tr></table>';
  assert.deepEqual(parseMultplSp500PeHistory(html), [
    { date: '2026-09-01', value: 26.04, estimated: false },
    { date: '2026-10-05', value: 26.53, estimated: true },
  ]);
});

test('Multpl parser ignores numeric HTML spacing entities instead of reading 2002 as the PE', () => {
  const html = '<table id="datatable"><tr><td>Oct 1, 2025</td><td>&#x2002; 28.42</td></tr></table>';
  assert.deepEqual(parseMultplSp500PeHistory(html), [
    { date: '2025-10-01', value: 28.42, estimated: false },
  ]);
});
