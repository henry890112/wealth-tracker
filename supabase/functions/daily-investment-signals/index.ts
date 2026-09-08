import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.1";

type MarketRow = Record<string, unknown>;

const FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data";
const STRATEGY = "value_trend_v1";
const TAIPEI = "Asia/Taipei";
const MAX_SYMBOLS_PER_USER = 50;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-signal-cron-secret",
};

const dateInTaipei = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: TAIPEI, year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const dateBefore = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};
const num = (value: unknown) => {
  const result = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(result) ? result : 0;
};
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

async function finmind(dataset: string, symbol: string, startDate: string, token: string) {
  const params = new URLSearchParams({ dataset, data_id: symbol, start_date: startDate, end_date: dateInTaipei() });
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${FINMIND_BASE}?${params}`, { headers });
  if (!response.ok) throw new Error(`FinMind ${dataset} HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.status !== 200) throw new Error(`FinMind ${dataset}: ${payload.msg || payload.status}`);
  return (payload.data || []) as MarketRow[];
}

let taiwanStockNamesPromise: Promise<Map<string, string>> | null = null;
async function taiwanStockNames(token: string) {
  if (!taiwanStockNamesPromise) {
    taiwanStockNamesPromise = (async () => {
      // TaiwanStockInfo is a catalogue: FinMind documents it as a bulk endpoint
      // without data_id or date filters. Filtering it returned an empty list.
      const params = new URLSearchParams({ dataset: "TaiwanStockInfo" });
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${FINMIND_BASE}?${params}`, { headers });
      if (!response.ok) throw new Error(`FinMind TaiwanStockInfo HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.status !== 200) throw new Error(`FinMind TaiwanStockInfo: ${payload.msg || payload.status}`);
      const names = new Map<string, string>();
      for (const row of (payload.data || []) as MarketRow[]) {
        const symbol = String(row.stock_id ?? "").toUpperCase();
        const name = String(row.stock_name ?? "").trim();
        if (symbol && name) names.set(symbol, name);
      }
      return names;
    })().catch((error) => {
      taiwanStockNamesPromise = null;
      throw error;
    });
  }
  return taiwanStockNamesPromise;
}

async function stockName(symbol: string, token: string) {
  // Watchlist rows only keep a symbol. Resolve the official company name instead
  // of persisting an unhelpful "2454 / 2454" label in the result card.
  try {
    return (await taiwanStockNames(token)).get(symbol) || symbol;
  } catch {
    // A temporary metadata error should never discard an otherwise valid analysis.
    return symbol;
  }
}

function scoreSymbol(symbol: string, name: string, prices: MarketRow[], pers: MarketRow[], institutional: MarketRow[], allowStale = false) {
  const priceRows = [...prices].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const closes = priceRows.map(row => num(row.close)).filter(value => value > 0);
  const latestPrice = priceRows.at(-1);
  const latestClose = closes.at(-1) || 0;
  const ma20 = average(closes.slice(-20));
  const ma60 = average(closes.slice(-60));
  const avgTradingMoney = average(priceRows.slice(-20).map(row => num(row.Trading_money ?? row.trading_money)));
  const averageVolume = average(priceRows.slice(-20).map(row => num(row.Trading_Volume ?? row.trading_volume)));

  const perRows = [...pers].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const validPers = perRows.map(row => num(row.PER ?? row.per)).filter(value => value > 0 && value <= 100);
  const latestPer = validPers.at(-1) || 0;
  const perP25 = validPers.length >= 12 ? percentile(validPers, 0.25) : 0;

  const byDate = new Map<string, { foreign: number; trust: number }>();
  for (const row of institutional) {
    const date = String(row.date || "");
    if (!date) continue;
    const bucket = byDate.get(date) || { foreign: 0, trust: 0 };
    const net = num(row.buy) - num(row.sell);
    const type = String(row.name || "");
    if (type === "Foreign_Investor" || type === "Foreign_Dealer_Self") bucket.foreign += net;
    if (type === "Investment_Trust") bucket.trust += net;
    byDate.set(date, bucket);
  }
  const institutionalDays = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-5);
  const foreignNetBuy = institutionalDays.reduce((sum, [, row]) => sum + row.foreign, 0);
  const trustNetBuy = institutionalDays.reduce((sum, [, row]) => sum + row.trust, 0);
  const institutionalNetBuy = foreignNetBuy + trustNetBuy;
  const netBuyThreshold = averageVolume * 0.005;

  const reasons: string[] = [];
  const risks: string[] = [];
  let score = 0;
  const lowValuation = latestPer > 0 && perP25 > 0 && latestPer <= perP25;
  if (lowValuation) { score += 30; reasons.push(`本益比 ${latestPer.toFixed(2)} 倍，低於近三年 25% 分位 ${perP25.toFixed(2)} 倍`); }
  else risks.push(validPers.length < 12 ? "本益比歷史資料不足" : "估值未達策略門檻");
  if (foreignNetBuy >= netBuyThreshold && netBuyThreshold > 0) { score += 20; reasons.push(`外資近 5 日淨買超 ${Math.round(foreignNetBuy).toLocaleString()} 股`); }
  if (trustNetBuy >= netBuyThreshold && netBuyThreshold > 0) { score += 15; reasons.push(`投信近 5 日淨買超 ${Math.round(trustNetBuy).toLocaleString()} 股`); }
  if (foreignNetBuy < netBuyThreshold && trustNetBuy < netBuyThreshold) risks.push("法人買超未達策略門檻");
  const trendConfirmed = closes.length >= 60 && latestClose > ma20 && ma20 > ma60;
  if (trendConfirmed) { score += 25; reasons.push("收盤價站上 MA20，且 MA20 高於 MA60"); }
  else risks.push("中期趨勢尚未確認");
  if (avgTradingMoney >= 20_000_000) { score += 10; reasons.push(`20 日平均成交額 ${Math.round(avgTradingMoney).toLocaleString()} 元`); }
  else risks.push("20 日平均成交額低於 2,000 萬元");
  const sourceAsOf = String(latestPrice?.date || perRows.at(-1)?.date || "");
  const freshData = sourceAsOf === dateInTaipei();
  if (!freshData) risks.push("今日收盤資料尚未完成更新");
  return {
    eligible: (freshData || allowStale) && score >= 70 && lowValuation && trendConfirmed && avgTradingMoney >= 20_000_000,
    symbol, name, score, reasons, risks,
    sourceAsOf: sourceAsOf || dateInTaipei(),
    metrics: { per: latestPer || null, per_p25: perP25 || null, foreign_net_buy: foreignNetBuy, trust_net_buy: trustNetBuy, institutional_net_buy: institutionalNetBuy, avg_trading_money: avgTradingMoney, close: latestClose || null, ma20: ma20 || null, ma60: ma60 || null },
  };
}

async function sendExpoSummary(supabase: ReturnType<typeof createClient>, userId: string, events: { id: string; symbol: string }[]) {
  const { data: devices } = await supabase.from("push_devices").select("id, expo_push_token").eq("user_id", userId).eq("is_active", true);
  if (!devices?.length) return;
  const symbols = events.slice(0, 3).map(event => event.symbol).join("、");
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(devices.map(device => ({ to: device.expo_push_token, title: "WealthTracker 研究訊號", body: `今日有 ${events.length} 檔台股符合研究條件：${symbols}${events.length > 3 ? "…" : ""}`, sound: "default", data: { screen: "InvestmentSignals" } }))),
  });
  if (!response.ok) throw new Error(`Expo push HTTP ${response.status}`);
  const payload = await response.json();
  const tickets = payload.data || [];
  await Promise.all(tickets.map((ticket: { status?: string; details?: { error?: string } }, index: number) => ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered"
    ? supabase.from("push_devices").update({ is_active: false }).eq("id", devices[index].id) : Promise.resolve()));
  await supabase.from("investment_signal_events").update({ notification_sent_at: new Date().toISOString() }).in("id", events.map(event => event.id));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return new Response(JSON.stringify({ error: "Server unavailable" }), { status: 503, headers: { ...CORS, "Content-Type": "application/json" } });
  const supabase = createClient(supabaseUrl, serviceRole);
  const cronSecret = Deno.env.get("SIGNAL_CRON_SECRET");
  const isCron = Boolean(cronSecret) && req.headers.get("x-signal-cron-secret") === cronSecret;
  const authorization = req.headers.get("Authorization") || "";
  const isService = authorization === `Bearer ${serviceRole}`;
  let requestedUserId: string | null = null;
  if (!isCron && !isService) {
    const token = authorization.replace(/^Bearer\s+/i, "");
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    requestedUserId = user.id;
  }
  // A server-only token raises FinMind rate limits when configured. The public
  // datasets used here can still be queried without it for a small personal watchlist.
  const finmindToken = Deno.env.get("FINMIND_API_TOKEN") || "";
  try {
    let preferenceQuery = supabase.from("investment_signal_preferences").select("user_id, enabled, push_enabled, max_symbols").eq("enabled", true);
    if (requestedUserId) preferenceQuery = preferenceQuery.eq("user_id", requestedUserId);
    const [{ data: preferences, error: prefError }, { data: assets, error: assetError }, { data: watchlist, error: watchError }] = await Promise.all([
      preferenceQuery,
      supabase.from("assets").select("user_id, symbol, name, market_type").eq("market_type", "TW").not("symbol", "is", null),
      supabase.from("watchlist").select("user_id, symbol, market_type").eq("market_type", "TW"),
    ]);
    if (prefError || assetError || watchError) throw prefError || assetError || watchError;
    const names = new Map((assets || []).map(asset => [`${asset.user_id}:${asset.symbol}`, asset.name]));
    const candidates = new Map<string, Map<string, string>>();
    for (const preference of preferences || []) candidates.set(preference.user_id, new Map());
    for (const item of [...(assets || []), ...(watchlist || [])]) {
      const items = candidates.get(item.user_id);
      if (items && item.symbol) {
        const symbol = String(item.symbol).toUpperCase();
        const displayName = names.get(`${item.user_id}:${item.symbol}`) || symbol;
        // A watchlist only has the symbol, so it must not overwrite the name
        // already supplied by a matching asset record.
        if (!items.has(symbol) || items.get(symbol) === symbol) items.set(symbol, displayName);
      }
    }
    const marketCache = new Map<string, ReturnType<typeof scoreSymbol>>();
    const nameCache = new Map<string, string>();
    const newEvents = new Map<string, { id: string; symbol: string }[]>();
    let analyzedSymbols = 0;
    let qualifiedSymbols = 0;
    for (const preference of preferences || []) {
      const symbols = [...(candidates.get(preference.user_id)?.entries() || [])].slice(0, Math.min(preference.max_symbols || MAX_SYMBOLS_PER_USER, MAX_SYMBOLS_PER_USER));
      for (const [symbol, name] of symbols) {
        if (!marketCache.has(symbol)) {
          const [prices, pers, institutional] = await Promise.all([
            finmind("TaiwanStockPrice", symbol, dateBefore(100), finmindToken),
            finmind("TaiwanStockPER", symbol, dateBefore(1095), finmindToken),
            finmind("TaiwanStockInstitutionalInvestorsBuySell", symbol, dateBefore(35), finmindToken),
          ]);
          marketCache.set(symbol, scoreSymbol(symbol, symbol, prices, pers, institutional, Boolean(requestedUserId)));
        }
        let displayName = name;
        if (!displayName || displayName === symbol) {
          if (!nameCache.has(symbol)) nameCache.set(symbol, await stockName(symbol, finmindToken));
          displayName = nameCache.get(symbol) || symbol;
        }
        const signal = { ...marketCache.get(symbol)!, name: displayName };
        analyzedSymbols += 1;
        if (signal.eligible) qualifiedSymbols += 1;
        const { data: event, error } = await supabase.from("investment_signal_events").upsert({
          user_id: preference.user_id, symbol, name, signal_date: dateInTaipei(), strategy: STRATEGY, score: signal.score,
          is_candidate: signal.eligible, reasons: signal.reasons, metrics: signal.metrics, risk_flags: signal.risks, source_as_of: signal.sourceAsOf,
        }, { onConflict: "user_id,symbol,signal_date,strategy" }).select("id, symbol").single();
        if (error) throw error;
        if (signal.eligible && event) newEvents.set(preference.user_id, [...(newEvents.get(preference.user_id) || []), event]);
      }
    }
    for (const preference of preferences || []) {
      const events = newEvents.get(preference.user_id) || [];
      if (!requestedUserId && preference.push_enabled && events.length) await sendExpoSummary(supabase, preference.user_id, events);
    }
    return new Response(JSON.stringify({ mode: requestedUserId ? "on_demand" : "scheduled", processed_users: (preferences || []).length, analyzed_symbols: analyzedSymbols, qualified_symbols: qualifiedSymbols, as_of: dateInTaipei() }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("daily-investment-signals", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Signal job failed" }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
