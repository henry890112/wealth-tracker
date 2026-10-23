import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TRADIER_BASE_URL = "https://api.tradier.com/v1";
const CBOE_BASE_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options";
const TAIFEX_API = "https://openapi.taifex.com.tw/v1";
const TAIFEX_PRODUCTS_URL = "https://www.taifex.com.tw/cht/2/stockLists";
const MAX_CONTRACTS = 1200;

const json = (body: unknown, status = 200, maxAge = 300) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...CORS_HEADERS,
    "Content-Type": "application/json",
    "Cache-Control": `private, max-age=${maxAge}`,
  },
});

const symbolText = (value: unknown) => String(value || "")
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9./-]/g, "")
  .slice(0, 12);

const list = <T>(value: T | T[] | null | undefined): T[] => value == null ? [] : Array.isArray(value) ? value : [value];

const finite = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const ymdToIso = (value: unknown) => {
  const text = String(value || "").replace(/\D/g, "");
  return text.length === 8 ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : String(value || "");
};

const stripHtml = (value: string) => value
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ")
  .trim();

function taifexProducts(html: string) {
  const products: any[] = [{ contract: "TXO", symbol: "TXO", name: "臺指選擇權", multiplier: 50 }];
  for (const row of html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    if (!row.includes("是股票選擇權標的")) continue;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(match => stripHtml(match[1]));
    const baseCode = String(cells[0] || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const symbol = String(cells[2] || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const multiplier = Number(String(cells[11] || "").replace(/,/g, ""));
    if (baseCode && symbol && multiplier > 0) products.push({ contract: `${baseCode}O`, symbol, name: cells[3] || symbol, multiplier });
  }
  return products;
}

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function inferTaifexSpot(contracts: any[]) {
  const pairs = new Map<number, any>();
  for (const item of contracts) {
    if (!(item.strike > 0) || !(item.settlementPrice >= 0)) continue;
    const pair = pairs.get(item.strike) || { strike: item.strike };
    pair[item.type] = item.settlementPrice;
    pairs.set(item.strike, pair);
  }
  return median([...pairs.values()].filter(pair => Number.isFinite(pair.call) && Number.isFinite(pair.put)).map(pair => pair.strike + pair.call - pair.put).filter(value => value > 0));
}

function addEstimatedGamma(contracts: any[], spot: number | null) {
  if (!(Number(spot) > 0)) return contracts;
  const groups = new Map<string, any[]>();
  contracts.forEach((item, originalIndex) => {
    const key = `${item.expiration}:${item.type}`;
    const group = groups.get(key) || [];
    group.push({ ...item, originalIndex });
    groups.set(key, group);
  });
  const gamma = new Map<number, number | null>();
  for (const group of groups.values()) {
    const valid = group.filter(item => item.strike > 0 && Number.isFinite(item.delta)).sort((a, b) => a.strike - b.strike);
    valid.forEach((item, index) => {
      const previous = valid[index - 1];
      const next = valid[index + 1];
      let derivative = null;
      if (previous && next && next.strike !== previous.strike) derivative = (next.delta - previous.delta) / (next.strike - previous.strike);
      else if (next && next.strike !== item.strike) derivative = (next.delta - item.delta) / (next.strike - item.strike);
      else if (previous && item.strike !== previous.strike) derivative = (item.delta - previous.delta) / (item.strike - previous.strike);
      gamma.set(item.originalIndex, derivative === null ? null : Math.abs((item.strike / Number(spot)) * derivative));
    });
  }
  return contracts.map((item, index) => ({ ...item, gamma: gamma.get(index) ?? null }));
}

async function taifexSnapshot(input: string) {
  const [marketResponse, deltaResponse, productsResponse] = await Promise.all([
    fetch(`${TAIFEX_API}/DailyMarketReportOpt`, { headers: { Accept: "application/json" } }),
    fetch(`${TAIFEX_API}/DailyOptionsDelta`, { headers: { Accept: "application/json" } }),
    fetch(TAIFEX_PRODUCTS_URL),
  ]);
  if (!marketResponse.ok || !deltaResponse.ok || !productsResponse.ok) throw new Error("期交所公開資料暫時無法使用");
  const [marketRows, deltaRows, productHtml] = await Promise.all([marketResponse.json(), deltaResponse.json(), productsResponse.text()]);
  const query = String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const active = new Set((marketRows as any[]).map(row => String(row?.Contract || "").toUpperCase()));
  const product = taifexProducts(productHtml).find(item => (item.symbol === query || item.contract === query) && active.has(item.contract));
  if (!product) throw new Error(`${query || "此標的"}目前沒有期交所掛牌且有行情的選擇權商品`);
  const rows = (marketRows as any[]).filter(row => String(row?.Contract || "").toUpperCase() === product.contract && (!row?.TradingSession || row.TradingSession === "一般"));
  const deltas = (deltaRows as any[]).filter(row => String(row?.Contract || "").toUpperCase() === product.contract);
  const settlementByMonth = new Map(deltas.map(row => [String(row?.["ContractMonth(Week)"] || ""), ymdToIso(row?.ContractSettlementDay)]));
  const deltaByKey = new Map(deltas.map(row => [`${row?.["ContractMonth(Week)"]}:${finite(row?.StrikePrice)}:${row?.CallPut}`, finite(row?.Delta)]));
  const contracts = rows.flatMap(row => {
    const strike = finite(row?.StrikePrice);
    const type = row?.CallPut === "買權" ? "call" : row?.CallPut === "賣權" ? "put" : "";
    const contractMonth = String(row?.["ContractMonth(Week)"] || "");
    if (!(Number(strike) > 0) || !type) return [];
    return [{
      symbol: `${product.contract}-${contractMonth}-${type}-${strike}`,
      type,
      strike,
      expiration: settlementByMonth.get(contractMonth) || contractMonth,
      contractMonth,
      multiplier: product.multiplier,
      bid: finite(row?.BestBid), ask: finite(row?.BestAsk), last: finite(row?.Close), settlementPrice: finite(row?.SettlementPrice),
      volume: Math.max(0, finite(row?.Volume) || 0), openInterest: Math.max(0, finite(row?.OpenInterest) || 0),
      delta: deltaByKey.get(`${contractMonth}:${strike}:${row?.CallPut}`) ?? null,
      impliedVolatility: null, greeksUpdatedAt: ymdToIso(row?.Date),
    }];
  });
  const spot = inferTaifexSpot(contracts);
  return {
    configured: true, market: "TW", symbol: product.symbol, productName: product.name, contractCode: product.contract,
    currency: "TWD", multiplier: product.multiplier, spot, contracts: addEstimatedGamma(contracts, spot),
    expirations: [...new Set(contracts.map((item: any) => item.expiration))].filter(Boolean).sort(),
    provider: "臺灣期貨交易所 OpenAPI", priceDelay: "盤後每日官方資料", greeksDelay: "Gamma 依官方每日 Delta 曲線估算",
    gammaMethod: "official-delta-curve-estimate", providerAsOf: ymdToIso(rows[0]?.Date), fetchedAt: new Date().toISOString(),
  };
}

async function tradier(path: string, token: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${TRADIER_BASE_URL}${path}`, {
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.fault?.faultstring || payload?.errors?.error || payload?.error || `HTTP ${response.status}`;
      throw new Error(`Tradier：${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function quotePrice(payload: any) {
  const quote = list(payload?.quotes?.quote)[0] as any;
  const bid = Number(quote?.bid);
  const ask = Number(quote?.ask);
  const values = [quote?.last, quote?.close, Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : null, quote?.prevclose];
  return values.map(Number).find(value => Number.isFinite(value) && value > 0) || null;
}

function normalizedContract(item: any) {
  const strike = Number(item?.strike);
  const type = String(item?.option_type || "").toLowerCase();
  if (!(strike > 0) || !["call", "put"].includes(type)) return null;
  const multiplier = Number(item?.contract_size);
  return {
    symbol: String(item?.symbol || ""),
    type,
    strike,
    expiration: String(item?.expiration_date || ""),
    multiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 100,
    bid: Number.isFinite(Number(item?.bid)) ? Number(item.bid) : null,
    ask: Number.isFinite(Number(item?.ask)) ? Number(item.ask) : null,
    last: Number.isFinite(Number(item?.last)) ? Number(item.last) : null,
    volume: Number.isFinite(Number(item?.volume)) ? Math.max(0, Number(item.volume)) : 0,
    openInterest: Number.isFinite(Number(item?.open_interest)) ? Math.max(0, Number(item.open_interest)) : 0,
    gamma: Number.isFinite(Number(item?.greeks?.gamma)) ? Number(item.greeks.gamma) : null,
    delta: Number.isFinite(Number(item?.greeks?.delta)) ? Number(item.greeks.delta) : null,
    impliedVolatility: Number.isFinite(Number(item?.greeks?.mid_iv))
      ? Number(item.greeks.mid_iv)
      : Number.isFinite(Number(item?.greeks?.smv_vol)) ? Number(item.greeks.smv_vol) : null,
    greeksUpdatedAt: item?.greeks?.updated_at || null,
  };
}

function parseCboeOption(item: any, timestamp: string | null) {
  const match = String(item?.option || "").match(/^(.+?)(\d{6})([CP])(\d{8})$/);
  if (!match) return null;
  const strike = Number(match[4]) / 1000;
  if (!(strike > 0)) return null;
  return {
    symbol: String(item.option),
    type: match[3] === "C" ? "call" : "put",
    strike,
    expiration: `20${match[2].slice(0, 2)}-${match[2].slice(2, 4)}-${match[2].slice(4, 6)}`,
    multiplier: 100,
    bid: Number.isFinite(Number(item?.bid)) ? Number(item.bid) : null,
    ask: Number.isFinite(Number(item?.ask)) ? Number(item.ask) : null,
    last: Number.isFinite(Number(item?.last_trade_price)) ? Number(item.last_trade_price) : null,
    volume: Number.isFinite(Number(item?.volume)) ? Math.max(0, Number(item.volume)) : 0,
    openInterest: Number.isFinite(Number(item?.open_interest)) ? Math.max(0, Number(item.open_interest)) : 0,
    gamma: Number.isFinite(Number(item?.gamma)) ? Number(item.gamma) : null,
    delta: Number.isFinite(Number(item?.delta)) ? Number(item.delta) : null,
    impliedVolatility: Number.isFinite(Number(item?.iv)) ? Number(item.iv) : null,
    greeksUpdatedAt: timestamp,
  };
}

async function cboeSnapshot(symbol: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${CBOE_BASE_URL}/${encodeURIComponent(symbol)}.json`, {
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Cboe HTTP ${response.status}`);
    const payload = await response.json();
    const contracts = list(payload?.data?.options).map(item => parseCboeOption(item, payload?.timestamp || null)).filter(Boolean);
    const spot = [payload?.data?.current_price, payload?.data?.close, payload?.data?.prev_day_close]
      .map(Number)
      .find(value => Number.isFinite(value) && value > 0) || null;
    return { payload, contracts, spot };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, 0);

  const token = Deno.env.get("TRADIER_ACCESS_TOKEN")?.trim();
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "expirations");
    const market = String(body?.market || "US").toUpperCase();
    const symbol = symbolText(body?.symbol);
    if (!symbol) return json({ configured: true, error: market === "TW" ? "請輸入有效的台股代號或 TXO" : "請輸入有效的美股代號" }, 400, 0);

    if (market === "TW") {
      const snapshot = await taifexSnapshot(symbol);
      if (action === "expirations") return json(snapshot, 200, 300);
      if (action === "chain") {
        const expiration = String(body?.expiration || "");
        return json({ ...snapshot, expiration, contracts: snapshot.contracts.filter((item: any) => item.expiration === expiration) }, 200, 300);
      }
      return json({ configured: true, error: "不支援的操作" }, 400, 0);
    }

    if (action === "expirations") {
      if (!token) {
        const { payload, contracts } = await cboeSnapshot(symbol);
        return json({
          configured: true,
          symbol,
          expirations: [...new Set(contracts.map((item: any) => item.expiration))].sort(),
          provider: "Cboe Delayed Quotes",
          priceDelay: "約 15 分鐘延遲",
          greeksDelay: "隨 Cboe 延遲快照更新",
          providerAsOf: payload?.timestamp || null,
          fetchedAt: new Date().toISOString(),
        });
      }
      const payload = await tradier(`/markets/options/expirations?symbol=${encodeURIComponent(symbol)}&includeAllRoots=true&strikes=false`, token);
      const expirations = list(payload?.expirations?.date)
        .map(value => String(value || ""))
        .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
        .sort();
      return json({
        configured: true,
        symbol,
        expirations,
        provider: "Tradier",
        priceDelay: "即時（依帳戶權限）",
        greeksDelay: "Greeks 約每小時更新",
        fetchedAt: new Date().toISOString(),
      });
    }

    if (action === "chain") {
      const expiration = String(body?.expiration || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration)) return json({ configured: true, error: "到期日格式錯誤" }, 400, 0);
      if (!token) {
        const { payload, contracts, spot } = await cboeSnapshot(symbol);
        return json({
          configured: true,
          symbol,
          expiration,
          spot,
          contracts: contracts.filter((item: any) => item.expiration === expiration).slice(0, MAX_CONTRACTS),
          provider: "Cboe Delayed Quotes",
          priceDelay: "約 15 分鐘延遲",
          greeksDelay: "隨 Cboe 延遲快照更新",
          providerAsOf: payload?.timestamp || null,
          fetchedAt: new Date().toISOString(),
        });
      }
      const [chainPayload, quotePayload] = await Promise.all([
        tradier(`/markets/options/chains?symbol=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(expiration)}&greeks=true`, token),
        tradier(`/markets/quotes?symbols=${encodeURIComponent(symbol)}&greeks=false`, token),
      ]);
      const contracts = list(chainPayload?.options?.option)
        .slice(0, MAX_CONTRACTS)
        .map(normalizedContract)
        .filter(Boolean);
      return json({
        configured: true,
        symbol,
        expiration,
        spot: quotePrice(quotePayload),
        contracts,
        provider: "Tradier",
        priceDelay: "即時（依帳戶權限）",
        greeksDelay: "Greeks 約每小時更新",
        fetchedAt: new Date().toISOString(),
      });
    }

    return json({ configured: true, error: "不支援的操作" }, 400, 0);
  } catch (error) {
    console.error("options-analysis", error);
    const message = error instanceof Error ? error.message : "選擇權資料載入失敗";
    return json({ configured: true, error: message }, 502, 0);
  }
});
