import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { asNumber, normalizeEsunHolding } from './holdings.mjs';
import { normalizeEsunTransactions } from './transactions.mjs';

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

function resetClients() {
  clients = undefined;
  clientsPromise = undefined;
}

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

async function withClientRetry(operation) {
  try {
    return await operation(await getClients());
  } catch (firstError) {
    // Broker sessions can expire while this long-running bridge process stays
    // alive. Recreate both SDK clients once before surfacing the error.
    resetClients();
    try {
      return await operation(await getClients());
    } catch (retryError) {
      retryError.cause ??= firstError;
      throw retryError;
    }
  }
}

async function getHoldings() {
  return withClientRetry(async ({ trade, stock }) => {
    const inventories = await trade.getInventories();
    const holdings = await Promise.all((inventories || []).map(async (item) => {
      const symbol = item.stkNo;
      let quote = null;
      try {
        quote = await stock.intraday.quote({ symbol });
      } catch {
        // Market may be closed or the quote endpoint may be temporarily unavailable.
      }
      return normalizeEsunHolding(item, quote);
    }));
    return holdings.filter((item) => item.symbol && item.quantity > 0);
  });
}

async function getBalance() {
  return withClientRetry(async ({ trade }) => {
    const balance = await trade.getBalance();
    return {
      availableBalance: asNumber(balance?.availableBalance),
      exchangeBalance: asNumber(balance?.exchangeBalance),
      stockPreSaveAmount: asNumber(balance?.stockPreSaveAmount),
      currency: 'TWD',
    };
  });
}

async function getTransactions(duration = '3m') {
  return withClientRetry(async ({ trade }) => {
    const transactions = await trade.getTransactions({ duration });
    return normalizeEsunTransactions(transactions);
  });
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
  if (!['/v1/holdings', '/v1/balance', '/v1/transactions'].includes(url.pathname)) return respond(req, res, 404, { error: 'Not found' });

  try {
    if (url.pathname === '/v1/transactions') {
      const duration = url.searchParams.get('duration') || '3m';
      if (!['0d', '3d', '1m', '3m'].includes(duration)) {
        return respond(req, res, 400, { error: 'duration must be one of 0d, 3d, 1m, 3m' });
      }
      const transactions = await getTransactions(duration);
      return respond(req, res, 200, { provider: 'esun', duration, fetchedAt: new Date().toISOString(), transactions });
    }
    if (url.pathname === '/v1/balance') {
      const balance = await getBalance();
      return respond(req, res, 200, { provider: 'esun', fetchedAt: new Date().toISOString(), balance });
    }
    const holdings = await getHoldings();
    return respond(req, res, 200, { provider: 'esun', fetchedAt: new Date().toISOString(), holdings });
  } catch (error) {
    const resource = url.pathname === '/v1/balance' ? 'balance' : url.pathname === '/v1/transactions' ? 'transactions' : 'holdings';
    console.error(`E.Sun read-only ${resource} sync failed:`, error.message);
    const message = resource === 'balance'
      ? '無法讀取玉山帳務餘額；模擬環境或目前帳戶可能不提供此查詢，持倉仍可獨立更新。'
      : resource === 'transactions'
        ? '無法讀取玉山成交明細；模擬環境或目前帳戶可能沒有可用的近期成交。'
        : '無法讀取玉山持倉；請確認本機 SDK 登入、憑證與設定。';
    return respond(req, res, 502, { error: message, resource });
  }
}).listen(port, host, () => {
  console.log(`E.Sun read-only bridge listening on http://${host}:${port}`);
});
