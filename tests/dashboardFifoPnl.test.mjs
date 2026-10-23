import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const servicePath = path.resolve('src/services/investmentPerformance.js');

const loadPerformanceService = () => {
  const code = babel.transformFileSync(servicePath, {
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const loadedModule = new Module(servicePath);
  loadedModule.filename = servicePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(servicePath));

  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === servicePath) {
      if (request === '../lib/supabase') return { supabase: {} };
      if (request === '../lib/date') return { getTaipeiDateString: () => '2026-10-22' };
      if (request === './api') {
        return {
          convertToBaseCurrency: async amount => amount,
          fetchExchangeRatesBatch: async () => ({}),
        };
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    loadedModule._compile(code, servicePath);
  } finally {
    Module._load = originalLoad;
  }
  return loadedModule.exports;
};

const { buildCurrentFifoPerformanceContext, buildInvestmentTransactionFlows, calculateTradePerformance } = loadPerformanceService();

test('dashboard FIFO P&L includes matched open lots and fees, not assets with no buy history', async () => {
  const { transactionFlows } = await buildInvestmentTransactionFlows({
    baseCurrency: 'USD',
    rates: {},
    transactions: [
      {
        id: 'buy-1', asset_id: 'xyz', type: 'BUY', shares: 5, price: 10,
        total_amount: 50, fee: 1, tax: 1, trans_date: '2026-10-01',
        assets: { id: 'xyz', name: 'XYZ', symbol: 'XYZ', market_type: 'US', currency: 'USD' },
      },
      {
        id: 'sell-1', asset_id: 'xyz', type: 'SELL', shares: 2, price: 15,
        total_amount: 30, fee: 1, tax: 0, trans_date: '2026-10-02',
        assets: { id: 'xyz', name: 'XYZ', symbol: 'XYZ', market_type: 'US', currency: 'USD' },
      },
    ],
  });
  const context = buildCurrentFifoPerformanceContext([
    { id: 'xyz', category: 'investment', symbol: 'XYZ', market_type: 'US', current_shares: 3, converted_amount: 45 },
    { id: 'no-history', category: 'investment', symbol: 'NOHIST', market_type: 'US', current_shares: 4, converted_amount: 200 },
  ], transactionFlows, '2026-10-22T12:00:00.000Z');

  const summary = calculateTradePerformance(context, 'ALL', 'ALL');

  assert.equal(transactionFlows[0].amount, -52);
  assert.equal(transactionFlows[1].amount, 29);
  assert.ok(Math.abs(summary.openCost - 31.2) < 1e-8);
  assert.equal(summary.currentValue, 45);
  assert.ok(Math.abs(summary.unrealizedPnl - 13.8) < 1e-8);
  assert.equal(summary.assetRows.length, 1);
  assert.equal(summary.assetRows[0].symbol, 'XYZ');
  assert.equal(context.assetValuations['US:NOHIST'].currentValue, 200);
});

test('dashboard FIFO P&L excludes identities opted out of performance', () => {
  const flows = [
    { assetId: 'excluded', symbol: 'EXCL', market: 'US', type: 'BUY', shares: 2, amount: -20, date: '2026-10-01' },
  ];
  const context = buildCurrentFifoPerformanceContext([
    {
      id: 'excluded', category: 'investment', symbol: 'EXCL', market_type: 'US',
      current_shares: 2, converted_amount: 30, exclude_from_performance: true,
    },
  ], flows, '2026-10-22T12:00:00.000Z');

  const summary = calculateTradePerformance(context, 'ALL', 'ALL');

  assert.equal(context.transactionFlows.length, 0);
  assert.equal(summary.openCost, 0);
  assert.equal(summary.unrealizedPnl, 0);
});
