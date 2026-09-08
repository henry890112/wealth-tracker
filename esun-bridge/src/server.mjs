import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// This intentionally loads only the bridge's private .env file. Values are
// never returned from an HTTP endpoint or logged.
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
const configPath = process.env.ESUN_CONFIG_PATH;
const bridgeToken = process.env.ESUN_BRIDGE_TOKEN;
const allowedOrigins = new Set((process.env.BRIDGE_ALLOWED_ORIGINS || 'http://127.0.0.1:8084,http://localhost:8084')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean));

if (!configPath) {
  throw new Error('Missing ESUN_CONFIG_PATH. Copy .env.example to a private .env and set the absolute config.ini path.');
}
if (host !== '127.0.0.1' && !bridgeToken) {
  throw new Error('ESUN_BRIDGE_TOKEN is required when the bridge listens outside localhost.');
}

let clients;
let clientsPromise;
async function getClients() {
  if (clients) return clients;
  if (!clientsPromise) {
    clientsPromise = (async () => {
      const [{ EsunTrade }, { EsunMarketdata }] = await Promise.all([
        import('@esun/trade'),
        import('@esun/marketdata'),
      ]);
      const trade = new EsunTrade({ configPath });
      const marketdata = new EsunMarketdata({ configPath });

      // The official SDK prompts for the broker and certificate passwords locally.
      // No password is accepted by this HTTP service or stored in the repository.
      await trade.login();
      await marketdata.login();
      clients = { trade, stock: marketdata.restClient.stock };
      return clients;
    })().catch((error) => {
      // A failed first login must not poison later retry attempts.
      clientsPromise = null;
      throw error;
    });
  }
  return clientsPromise;
}

// The broker SDK returns numeric fields as formatted strings (for example
// "1,234.50"). `Number()` cannot parse the thousands separator and silently
// produced zero before, which could erase an existing cost basis on sync.
const asNumber = (value) => {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

async function getHoldings() {
  const { trade, stock } = await getClients();
  const inventories = await trade.getInventories();
  const holdings = await Promise.all((inventories || []).map(async (item) => {
    const symbol = item.stkNo;
    let quote = null;
    try {
      quote = await stock.intraday.quote({ symbol });
    } catch {
      // Market may be closed or the quote endpoint may be temporarily unavailable.
    }
    const quantity = asNumber(item.stkDats?.reduce((sum, row) => sum + asNumber(row.qty), 0)) || asNumber(item.qty);
    // The broker returns purchase cost as a negative cash outflow. WealthTracker
    // stores cost basis as a positive amount so P&L remains market value − cost.
    const costBasis = Math.abs(asNumber(item.costSum));
    const averageCost = asNumber(item.priceAvg) || (quantity > 0 ? costBasis / quantity : 0);
    // Prefer the price and value from the broker inventory response. They use
    // the same valuation basis as the broker's own unrealized P&L screen.
    const marketPrice = asNumber(item.priceMkt) || asNumber(quote?.lastPrice || quote?.closePrice || quote?.previousClose);
    const marketValue = asNumber(item.valueMkt) || marketPrice * quantity;
    return {
      symbol,
      name: item.stkNa || quote?.name || symbol,
      quantity,
      averageCost,
      costBasis,
      marketPrice,
      marketValue,
      currency: 'TWD',
      marketType: 'TW',
    };
  }));
  return holdings.filter((item) => item.symbol && item.quantity > 0);
}

async function getBalance() {
  const { trade } = await getClients();
  const balance = await trade.getBalance();
  return {
    availableBalance: asNumber(balance?.availableBalance),
    exchangeBalance: asNumber(balance?.exchangeBalance),
    stockPreSaveAmount: asNumber(balance?.stockPreSaveAmount),
    currency: 'TWD',
  };
}

function respond(req, res, status, body) {
  const origin = req.headers.origin;
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin && allowedOrigins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    const headers = origin && allowedOrigins.has(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization', Vary: 'Origin' }
      : {};
    res.writeHead(204, headers);
    return res.end();
  }
  if (bridgeToken && req.headers.authorization !== `Bearer ${bridgeToken}`) {
    return respond(req, res, 401, { error: 'Unauthorized' });
  }
  if (req.method !== 'GET') return respond(req, res, 405, { error: 'Read-only service: GET only' });
  if (url.pathname === '/health') return respond(req, res, 200, { status: 'ok', mode: 'read-only' });
  if (url.pathname !== '/v1/holdings' && url.pathname !== '/v1/balance') return respond(req, res, 404, { error: 'Not found' });

  try {
    if (url.pathname === '/v1/balance') {
      const balance = await getBalance();
      return respond(req, res, 200, { provider: 'esun', fetchedAt: new Date().toISOString(), balance });
    }
    const holdings = await getHoldings();
    return respond(req, res, 200, { provider: 'esun', fetchedAt: new Date().toISOString(), holdings });
  } catch (error) {
    console.error('E.Sun read-only sync failed:', error.message);
    return respond(req, res, 502, { error: 'Unable to read E.Sun holdings. Check the local SDK login and configuration.' });
  }
}).listen(port, host, () => {
  console.log(`E.Sun read-only bridge listening on http://${host}:${port}`);
});
