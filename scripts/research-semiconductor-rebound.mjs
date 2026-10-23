import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Same OHLC provider as the app's market-history function. Public data only.
const out = path.resolve('research/semiconductor-rebound');
const symbols = ['^SOX', 'SMH', 'SOXX', 'SPY', 'QQQ', '^VIX', 'KLAC', 'AVGO', 'QCOM', 'DRAM', 'CBRS', 'AAOI', '2330.TW', '3711.TW', '2454.TW', '2337.TW', '5347.TWO', '6291.TWO', '6488.TWO', '2379.TW'];
await fs.mkdir(path.join(out, 'data'), { recursive: true });
const manifest = { fetchedAt: new Date().toISOString(), provider: 'Yahoo Finance chart; same provider as WealthTracker market-history', symbols: [] };
for (const symbol of symbols) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d&events=div%2Csplits`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'WealthTracker research' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.text();
    const payload = JSON.parse(raw);
    const series = payload.chart?.result?.[0];
    if (!series) throw new Error(payload.chart?.error?.description || 'No series');
    const file = `${symbol.replaceAll('^', '_')}.json`;
    await fs.writeFile(path.join(out, 'data', file), raw);
    const record = { symbol, file, url, sha256: crypto.createHash('sha256').update(raw).digest('hex'), rows: series.timestamp?.length || 0, first: new Date(series.timestamp[0]*1000).toISOString(), last: new Date(series.timestamp.at(-1)*1000).toISOString(), timezone: series.meta.exchangeTimezoneName };
    manifest.symbols.push(record);
    console.log(`${symbol}: ${record.rows} rows; ${record.last}`);
  } catch (error) { manifest.symbols.push({ symbol, error: error.message }); console.log(`${symbol}: ${error.message}`); }
}
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
