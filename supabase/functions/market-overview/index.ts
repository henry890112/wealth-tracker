import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SP500_PE_URL = "https://www.multpl.com/s-p-500-pe-ratio/table/by-month";
const TPEX_INDEX_URL = "https://info.tpex.org.tw/api/mktRT";
const TPEX_INDEX_HISTORY_URL = "https://www.tpex.org.tw/www/zh-tw/indexInfo/inx?response=json";
const TAIEX_HISTORY_URL = "https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?response=json";
const MARKET_MAINTENANCE_URL = "https://www.twse.com.tw/rwd/zh/marginTrading/BFIJ3U_TREND?response=json";
const TWSE_MARGIN_URL = "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&selectType=MS";
const TWSE_MARGIN_TREND_URL = "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN_TREND?response=json";
const TWSE_FOREIGN_URL = "https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&type=day";
const TPEX_MARGIN_URL = "https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&o=json";
const TPEX_MARGIN_TREND_URL = "https://www.tpex.org.tw/www/zh-tw/dashboardOtc/marginTrend?lang=zh-tw";
const TPEX_FOREIGN_URL = "https://www.tpex.org.tw/www/zh-tw/insti/summary";
const HISTORY_DAYS = 3 * 366;
const MARGIN_CHART_DAYS = 31;
const marginHistoryCache = new Map<string, { at: number; value: unknown }>();
const marginHistoryInflight = new Map<string, Promise<unknown>>();
const foreignHistoryCache = new Map<string, { at: number; value: unknown }>();
let tpexIndexHistoryCache: { at: number; value: unknown } | null = null;
let marginCacheClient: any | null | undefined;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "public, max-age=900" },
});

function getMarginCacheClient() {
  if (marginCacheClient !== undefined) return marginCacheClient;
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  marginCacheClient = url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  return marginCacheClient;
}

const stripHtml = (value: string) => String(value || "")
  .replace(/<[^>]*>/g, " ")
  .replace(/&#x[0-9a-f]+;|&#\d+;/gi, " ")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ")
  .trim();

function parseHistory(html: string) {
  const table = html.match(/<table[^>]*(?:id=["']datatable["'])?[^>]*>[\s\S]*?<\/table>/i)?.[0] || html;
  const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  return rows.flatMap(row => {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 2) return [];
    const dateText = stripHtml(cells[0][1]);
    const valueText = stripHtml(cells[1][1]).replace(/†/g, "").trim();
    const value = Number(valueText.match(/-?\d+(?:\.\d+)?/g)?.at(-1));
    const parsedDate = new Date(`${dateText} UTC`);
    if (!Number.isFinite(value) || Number.isNaN(parsedDate.getTime())) return [];
    return [{ date: parsedDate.toISOString().slice(0, 10), value, estimated: /Estimate|†/i.test(cells[1][1]) }];
  }).sort((left, right) => left.date.localeCompare(right.date));
}

const numeric = (value: unknown) => {
  if (value == null || String(value).trim() === "") throw new Error("官方數值缺漏");
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(parsed)) throw new Error("官方數值格式無法辨識");
  return parsed;
};

const isoDate = (value: unknown) => {
  const raw = String(value || "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(raw)) throw new Error("官方資料日期無法辨識");
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
};

async function officialJson(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 WealthTracker/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`官方資料 HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.stat && String(payload.stat).toLowerCase() !== "ok") throw new Error("官方資料尚未發布");
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

type MarginBalance = { date: string; balance: number; previous: number | null; change: number | null };

function parseMargin(payload: any, market: "TWSE" | "TPEX"): MarginBalance {
  const row = market === "TWSE"
    ? payload?.tables?.[0]?.data?.find((item: unknown[]) => String(item?.[0]).includes("融資金額"))
    : payload?.tables?.[0]?.summary?.find((item: unknown[]) => String(item?.[1]).includes("融資金"));
  if (!row) throw new Error(`${market} 融資金額欄位不存在`);
  const previous = numeric(row[market === "TWSE" ? 4 : 2]) * 1000;
  const balance = numeric(row[market === "TWSE" ? 5 : 6]) * 1000;
  return { date: isoDate(payload.date), balance, previous, change: balance - previous };
}

function parseTwseMarginTrend(payload: any) {
  if (payload?.stat !== "OK" || !Array.isArray(payload?.data)) return [];
  return payload.data.flatMap((item: any, index: number, rows: any[]) => {
    const raw = String(item?.date || "");
    const balance = Number(item?.marginAmt) * 1000;
    const previous = Number(rows[index - 1]?.marginAmt) * 1000;
    if (!/^\d{8}$/.test(raw) || !Number.isFinite(balance) || balance <= 0) return [];
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    return [{ date, balance, previous: Number.isFinite(previous) && previous > 0 ? previous : null, change: Number.isFinite(previous) && previous > 0 ? balance - previous : null }];
  });
}

function parseTpexMarginTrend(payload: any) {
  if (String(payload?.stat).toLowerCase() !== "ok" || !Array.isArray(payload?.trend)) return [];
  return payload.trend.flatMap((item: any, index: number, rows: any[]) => {
    const raw = String(item?.date || "");
    const balance = Number(item?.marginBalance) * 1e8;
    const previous = Number(rows[index - 1]?.marginBalance) * 1e8;
    if (!/^\d{8}$/.test(raw) || !Number.isFinite(balance) || balance <= 0) return [];
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    return [{ date, balance, previous: Number.isFinite(previous) && previous > 0 ? previous : null, change: Number.isFinite(previous) && previous > 0 ? balance - previous : null }];
  });
}

function parseTaiexHistory(payload: any) {
  if (payload?.stat !== "OK" || !Array.isArray(payload?.data)) return [];
  const closeIndex = payload.fields?.indexOf("收盤指數");
  if (closeIndex == null || closeIndex < 0) return [];
  return payload.data.flatMap((row: unknown[]) => {
    const match = String(row?.[0] || "").match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
    const close = numeric(row?.[closeIndex]);
    if (!match || !Number.isFinite(close) || close <= 0) return [];
    const date = `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
    return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? [] : [{ date, close }];
  });
}

function parseMarketMaintenanceHistory(payload: any) {
  if (payload?.stat !== "OK" || !Array.isArray(payload?.data)) return [];
  return payload.data.flatMap((row: any) => {
    const raw = String(row?.date || "");
    const rate = Number(row?.keepRate);
    if (!/^\d{8}$/.test(raw) || !Number.isFinite(rate) || rate <= 0) return [];
    return [{ date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, rate }];
  });
}

function parseInstitutional(payload: any, market: "TWSE" | "TPEX") {
  const rows = market === "TWSE" ? payload?.data : payload?.tables?.[0]?.data;
  const date = isoDate(payload.date);
  const read = (label: string) => {
    const row = rows?.find((item: unknown[]) => String(item?.[0]).trim() === label);
    if (!row) return null;
    try { return { date, buy: numeric(row[1]), sell: numeric(row[2]), net: numeric(row[3]) }; }
    catch { return null; }
  };
  const add = (...parts: Array<ReturnType<typeof read>>) => parts.every(Boolean) ? {
    date, buy: parts.reduce((sum, item) => sum + item!.buy, 0),
    sell: parts.reduce((sum, item) => sum + item!.sell, 0), net: parts.reduce((sum, item) => sum + item!.net, 0),
  } : null;
  const foreign = read(market === "TWSE" ? "外資及陸資(不含外資自營商)" : "外資及陸資(不含自營商)");
  const trust = read("投信");
  const dealer = market === "TWSE" ? add(read("自營商(自行買賣)"), read("自營商(避險)")) : read("自營商合計");
  return foreign || trust || dealer ? { date, foreign, trust, dealer, directional: add(foreign, trust), all: add(foreign, trust, dealer) } : null;
}

function combineInstitutional(left: ReturnType<typeof parseInstitutional> | null, right: ReturnType<typeof parseInstitutional> | null) {
  if (!left || !right || left.date !== right.date) return null;
  const result: Record<string, unknown> = { date: left.date };
  for (const key of ["foreign", "trust", "dealer", "all", "directional"] as const) {
    const a = left[key]; const b = right[key];
    result[key] = a && b ? { date: left.date, buy: a.buy + b.buy, sell: a.sell + b.sell, net: a.net + b.net } : null;
  }
  return result;
}

async function fetchTaiwanMarketFlow() {
  const endpoints = [TWSE_MARGIN_URL, TWSE_FOREIGN_URL, TPEX_MARGIN_URL, TPEX_FOREIGN_URL];
  const results = await Promise.allSettled(endpoints.map(officialJson));
  const parsePart = (index: number, parser: (payload: any, market: "TWSE" | "TPEX") => unknown, market: "TWSE" | "TPEX") => {
    const result = results[index];
    if (result.status !== "fulfilled") return null;
    try { return parser(result.value, market); } catch { return null; }
  };
  const twseInstitutional = parsePart(1, parseInstitutional, "TWSE") as ReturnType<typeof parseInstitutional> | null;
  const tpexInstitutional = parsePart(3, parseInstitutional, "TPEX") as ReturnType<typeof parseInstitutional> | null;
  const twse = { margin: parsePart(0, parseMargin, "TWSE"), foreign: twseInstitutional?.foreign || null, institutional: twseInstitutional };
  const tpex = { margin: parsePart(2, parseMargin, "TPEX"), foreign: tpexInstitutional?.foreign || null, institutional: tpexInstitutional };
  if (!twse.margin && !twse.institutional && !tpex.margin && !tpex.institutional) throw new Error("上市與上櫃市場資料暫時無法取得");
  const aggregate = (key: "margin" | "foreign", fields: string[]) => {
    const left = twse[key] as Record<string, number | string> | null;
    const right = tpex[key] as Record<string, number | string> | null;
    if (!left || !right || left.date !== right.date) return null;
    return { date: left.date, ...Object.fromEntries(fields.map(field => [field, Number(left[field]) + Number(right[field])])) };
  };
  return {
    twse, tpex,
    combined: { margin: aggregate("margin", ["balance", "previous", "change"]), foreign: aggregate("foreign", ["buy", "sell", "net"]), institutional: combineInstitutional(twseInstitutional, tpexInstitutional) },
    sources: { twseMargin: TWSE_MARGIN_URL, twseForeign: TWSE_FOREIGN_URL, tpexMargin: TPEX_MARGIN_URL, tpexForeign: TPEX_FOREIGN_URL },
  };
}

type MarginCacheRow = {
  date: string;
  twse: MarginBalance | null;
  tpex: MarginBalance | null;
  taiex_close: number | null;
  maintenance_rate: number | null;
  fetched_at: string;
  index_fetched_at: string | null;
  maintenance_fetched_at: string | null;
};

async function fetchTaiwanMarginHistoryCacheRange(startDate: string, endDate: string) {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    throw new Error("融資快取查詢日期不正確");
  }
  const spanDays = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
  if (spanDays > 400) throw new Error("融資快取查詢區間不可超過 400 天");

  const startedAt = Date.now();
  const db = getMarginCacheClient();
  if (!db) return { startDate, endDate, history: [], cacheAvailable: false };
  try {
    const { data, error } = await db.from("tw_margin_history_cache")
      .select("date,twse,tpex,taiex_close,maintenance_rate")
      .gte("date", startDate).lte("date", endDate).order("date", { ascending: true });
    if (error) throw error;
    const history = ((data || []) as Pick<MarginCacheRow, "date" | "twse" | "tpex" | "taiex_close" | "maintenance_rate">[])
      .flatMap(row => {
        const twse = row.twse && row.twse.date === row.date ? row.twse : null;
        const tpex = row.tpex && row.tpex.date === row.date ? row.tpex : null;
        if (!twse && !tpex) return [];
        const combined = twse && tpex ? {
          date: row.date,
          balance: twse.balance + tpex.balance,
          previous: twse.previous != null && tpex.previous != null ? twse.previous + tpex.previous : null,
          change: twse.change != null && tpex.change != null ? twse.change + tpex.change : null,
        } : null;
        return [{
          date: row.date,
          twse,
          tpex,
          combined,
          taiexClose: row.taiex_close,
          maintenanceRate: row.maintenance_rate,
        }];
      });
    console.info("[market-overview] margin cache range", {
      startDate, endDate, rows: history.length, elapsedMs: Date.now() - startedAt, status: "ok",
    });
    return { startDate, endDate, history, cacheAvailable: true };
  } catch (error) {
    console.warn("[market-overview] margin cache range read failed", {
      startDate, endDate, elapsedMs: Date.now() - startedAt, message: String(error),
    });
    return { startDate, endDate, history: [], cacheAvailable: false };
  }
}

async function fetchTaiwanMarginHistoryFresh(endDate: string) {
  const startedAt = Date.now();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(Date.parse(`${endDate}T00:00:00Z`))) {
    throw new Error("融資圖表日期不正確");
  }

  const end = new Date(`${endDate}T00:00:00Z`);
  const dates = Array.from({ length: MARGIN_CHART_DAYS }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - (MARGIN_CHART_DAYS - 1 - index));
    return day;
  }).filter(day => day.getUTCDay() !== 0 && day.getUTCDay() !== 6)
    .map(day => day.toISOString().slice(0, 10));
  const startDate = dates[0];
  const db = getMarginCacheClient();
  let dbReadMs = 0;
  let dbWriteMs = 0;
  let cacheRows: MarginCacheRow[] = [];
  if (db) {
    const readStartedAt = Date.now();
    try {
      const { data, error } = await db.from("tw_margin_history_cache")
        .select("date,twse,tpex,taiex_close,maintenance_rate,fetched_at,index_fetched_at,maintenance_fetched_at")
        .gte("date", startDate).lte("date", endDate);
      dbReadMs = Date.now() - readStartedAt;
      if (error) console.warn("[market-overview] margin cache read failed", { message: error.message });
      else cacheRows = (data || []) as MarginCacheRow[];
    } catch (error) {
      dbReadMs = Date.now() - readStartedAt;
      console.warn("[market-overview] margin cache read failed", { message: String(error) });
    }
  }
  const rowsByDate = new Map<string, MarginCacheRow>(cacheRows.map(row => [String(row.date), row]));
  const refreshCutoff = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const providerTiming = { twseMs: 0, tpexMs: 0, twseCalls: 0, tpexCalls: 0 };
  const dailyRetryDates = new Set<string>();
  const dirtyDates = new Set<string>();
  let trendMs = 0;
  const hasMissingMarketRows = dates.some(date => {
    const row = rowsByDate.get(date);
    if (row?.twse && row?.tpex) return false;
    const age = Date.now() - new Date(row?.fetched_at || 0).getTime();
    return !row || age > 60 * 60_000 || (date >= refreshCutoff && age > 15 * 60_000);
  });
  if (hasMissingMarketRows) {
    const rocEnd = `${Number(endDate.slice(0, 4)) - 1911}/${endDate.slice(5, 7)}/${endDate.slice(8, 10)}`;
    const trendStartedAt = Date.now();
    providerTiming.twseCalls += 1;
    providerTiming.tpexCalls += 1;
    const timedTrend = async (market: "TWSE" | "TPEX", url: string) => {
      const sourceStartedAt = Date.now();
      try { return await officialJson(url); }
      finally { providerTiming[market === "TWSE" ? "twseMs" : "tpexMs"] += Date.now() - sourceStartedAt; }
    };
    const [twseTrendResult, tpexTrendResult] = await Promise.allSettled([
      timedTrend("TWSE", `${TWSE_MARGIN_TREND_URL}&date=${endDate.replace(/-/g, "")}&days=35`),
      timedTrend("TPEX", `${TPEX_MARGIN_TREND_URL}&date=${encodeURIComponent(rocEnd)}&days=35`),
    ]);
    trendMs = Date.now() - trendStartedAt;
    const minimumTrendRows = Math.max(2, Math.floor(dates.length * 0.55));
    const twseTrend = twseTrendResult.status === "fulfilled" ? parseTwseMarginTrend(twseTrendResult.value) : [];
    const tpexTrend = tpexTrendResult.status === "fulfilled" ? parseTpexMarginTrend(tpexTrendResult.value) : [];
    const twseUsable = twseTrend.length >= minimumTrendRows;
    const tpexUsable = tpexTrend.length >= minimumTrendRows;
    const twseByDate = new Map(twseTrend.map(point => [point.date, point]));
    const tpexByDate = new Map(tpexTrend.map(point => [point.date, point]));
    if (twseUsable || tpexUsable) {
      const checkedAt = new Date().toISOString();
      for (const date of dates) {
        const previous = rowsByDate.get(date);
        const twsePoint = twseUsable ? twseByDate.get(date) : null;
        const tpexPoint = tpexUsable ? tpexByDate.get(date) : null;
        const twse = previous?.twse || (twsePoint ? { date, balance: twsePoint.balance, previous: twsePoint.previous, change: twsePoint.change } : null);
        const tpex = previous?.tpex || (tpexPoint ? { date, balance: tpexPoint.balance, previous: tpexPoint.previous, change: tpexPoint.change } : null);
        if (twse || tpex) {
          rowsByDate.set(date, {
            date, twse, tpex,
            taiex_close: previous?.taiex_close ?? null,
            maintenance_rate: previous?.maintenance_rate ?? null,
            fetched_at: checkedAt,
            index_fetched_at: previous?.index_fetched_at || null,
            maintenance_fetched_at: previous?.maintenance_fetched_at || null,
          });
          dirtyDates.add(date);
        }
        if (!twse || !tpex) dailyRetryDates.add(date);
      }
    }
  }
  const pendingDates = dates.filter(date => {
    const row = rowsByDate.get(date);
    if (dailyRetryDates.has(date)) return true;
    if (!row) return true;
    const age = Date.now() - new Date(row.fetched_at || 0).getTime();
    if (date >= refreshCutoff && age > 15 * 60_000) return true;
    return (!row.twse || !row.tpex) && age > 60 * 60_000;
  });
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(2, pendingDates.length) }, async () => {
    while (cursor < pendingDates.length) {
      const date = pendingDates[cursor++];
      const previous = rowsByDate.get(date);
      const age = Date.now() - new Date(previous?.fetched_at || 0).getTime();
      const refreshBoth = Boolean(previous && date >= refreshCutoff && age > 15 * 60_000);
      const fetchTwse = !previous?.twse || refreshBoth;
      const fetchTpex = !previous?.tpex || refreshBoth;
      const compact = date.replace(/-/g, "");
      const rocDate = `${Number(date.slice(0, 4)) - 1911}/${date.slice(5, 7)}/${date.slice(8, 10)}`;
      const timed = async (market: "TWSE" | "TPEX", url: string) => {
        const key = market === "TWSE" ? "twseMs" : "tpexMs";
        const callsKey = market === "TWSE" ? "twseCalls" : "tpexCalls";
        const sourceStartedAt = Date.now();
        providerTiming[callsKey] += 1;
        try { return await officialJson(url); }
        finally { providerTiming[key] += Date.now() - sourceStartedAt; }
      };
      const [twseResult, tpexResult] = await Promise.allSettled([
        fetchTwse ? timed("TWSE", `${TWSE_MARGIN_URL}&date=${compact}`) : Promise.resolve(null),
        fetchTpex ? timed("TPEX", `${TPEX_MARGIN_URL}&d=${encodeURIComponent(rocDate)}`) : Promise.resolve(null),
      ]);
      const read = (result: PromiseSettledResult<any>, market: "TWSE" | "TPEX", existing: any) => {
        if (result.status !== "fulfilled" || !result.value) return existing || null;
        try {
          const value = parseMargin(result.value, market);
          return value?.date === date ? value : existing || null;
        } catch { return existing || null; }
      };
      rowsByDate.set(date, {
        date,
        twse: read(twseResult, "TWSE", previous?.twse),
        tpex: read(tpexResult, "TPEX", previous?.tpex),
        taiex_close: previous?.taiex_close ?? null,
        maintenance_rate: previous?.maintenance_rate ?? null,
        fetched_at: new Date().toISOString(),
        index_fetched_at: previous?.index_fetched_at || null,
        maintenance_fetched_at: previous?.maintenance_fetched_at || null,
      });
      dirtyDates.add(date);
    }
  }));
  const persistRows = async (targetRows: MarginCacheRow[]) => {
    if (!db || !targetRows.length) return;
    const writeStartedAt = Date.now();
    try {
      const { error } = await db.from("tw_margin_history_cache").upsert(targetRows, { onConflict: "date" });
      dbWriteMs += Date.now() - writeStartedAt;
      if (error) console.warn("[market-overview] margin cache write failed", { message: error.message, rows: targetRows.length });
    } catch (error) {
      dbWriteMs += Date.now() - writeStartedAt;
      console.warn("[market-overview] margin cache write failed", { message: String(error), rows: targetRows.length });
    }
  };
  const combine = (row: MarginCacheRow) => row.twse && row.tpex && row.twse.date === row.tpex.date
    ? {
        date: row.date,
        balance: row.twse.balance + row.tpex.balance,
        previous: row.twse.previous != null && row.tpex.previous != null ? row.twse.previous + row.tpex.previous : null,
        change: row.twse.change != null && row.tpex.change != null ? row.twse.change + row.tpex.change : null,
      }
    : null;
  let history = dates.flatMap(date => {
    const row = rowsByDate.get(date);
    return row?.twse || row?.tpex ? [{ date, twse: row.twse, tpex: row.tpex, combined: combine(row), taiexClose: row.taiex_close ?? null, maintenanceRate: row.maintenance_rate ?? null }] : [];
  });
  const minimum = Math.max(2, Math.floor(dates.length * 0.55));
  if (history.filter(row => row.twse).length < minimum || history.filter(row => row.tpex).length < minimum) {
    console.info("[market-overview] tw-margin-history", { endDate, totalMs: Date.now() - startedAt, dbReadMs, dbWriteMs, providerTiming, status: "incomplete" });
    throw new Error("這段期間的融資資料不完整，請稍後重試");
  }

  const months = [...new Set(history.map(row => row.date.slice(0, 7)))];
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthsToFetch = months.filter(month => {
    const checked = dates.map(date => rowsByDate.get(date)).find(row => row?.date.startsWith(month) && row.index_fetched_at);
    if (!checked) return true;
    return month === currentMonth && Date.now() - new Date(checked.index_fetched_at!).getTime() > 15 * 60_000;
  });
  const indexStartedAt = Date.now();
  let indexCursor = 0;
  await Promise.all(Array.from({ length: Math.min(2, monthsToFetch.length) }, async () => {
    while (indexCursor < monthsToFetch.length) {
      const month = monthsToFetch[indexCursor++];
      let payload: any = null;
      try { payload = await officialJson(`${TAIEX_HISTORY_URL}&date=${month.replace(/-/g, "")}01`); }
      catch (error) { console.warn("[market-overview] TAIEX monthly history failed", { month, message: String(error) }); }
      const indexHistory = parseTaiexHistory(payload);
      const closes = new Map(indexHistory.map(point => [point.date, point.close]));
      const checkedAt = new Date().toISOString();
      for (const date of dates.filter(item => item.startsWith(month))) {
        const existing = rowsByDate.get(date) || { date, twse: null, tpex: null, taiex_close: null, maintenance_rate: null, fetched_at: checkedAt, index_fetched_at: null, maintenance_fetched_at: null };
        rowsByDate.set(date, {
          ...existing,
          taiex_close: closes.get(date) ?? existing.taiex_close ?? null,
          index_fetched_at: indexHistory.length ? checkedAt : existing.index_fetched_at,
        });
        if (indexHistory.length) dirtyDates.add(date);
      }
    }
  }));
  const indexMs = Date.now() - indexStartedAt;

  const maintenanceRows = dates.map(date => rowsByDate.get(date)).filter(Boolean) as MarginCacheRow[];
  const latestMaintenanceCheck = maintenanceRows.map(row => row.maintenance_fetched_at).filter(Boolean).sort().at(-1);
  const refreshMaintenance = !latestMaintenanceCheck
    || (endDate >= refreshCutoff && Date.now() - new Date(latestMaintenanceCheck).getTime() > 15 * 60_000);
  let maintenanceMs = 0;
  if (refreshMaintenance) {
    const maintenanceStartedAt = Date.now();
    let payload: any = null;
    try { payload = await officialJson(`${MARKET_MAINTENANCE_URL}&date=${endDate.replace(/-/g, "")}&days=35`); }
    catch (error) { console.warn("[market-overview] maintenance history failed", { endDate, message: String(error) }); }
    maintenanceMs = Date.now() - maintenanceStartedAt;
    const maintenanceHistory = parseMarketMaintenanceHistory(payload);
    const rates = new Map(maintenanceHistory.map(point => [point.date, point.rate]));
    const checkedAt = new Date().toISOString();
    for (const date of dates) {
      const existing = rowsByDate.get(date) || { date, twse: null, tpex: null, taiex_close: null, maintenance_rate: null, fetched_at: checkedAt, index_fetched_at: null, maintenance_fetched_at: null };
      rowsByDate.set(date, {
        ...existing,
        maintenance_rate: rates.get(date) ?? existing.maintenance_rate ?? null,
        maintenance_fetched_at: maintenanceHistory.length ? checkedAt : existing.maintenance_fetched_at,
      });
      if (maintenanceHistory.length) dirtyDates.add(date);
    }
  }
  await persistRows([...dirtyDates].map(date => rowsByDate.get(date)!).filter(Boolean));
  history = history.map(row => {
    const cached = rowsByDate.get(row.date);
    return { ...row, taiexClose: cached?.taiex_close ?? null, maintenanceRate: cached?.maintenance_rate ?? null };
  });
  const value = {
    asOf: history.at(-1)?.date,
    history,
    windowDays: MARGIN_CHART_DAYS,
    basis: "各交易日報表的今日餘額減前日餘額",
    sources: [TWSE_MARGIN_URL, TPEX_MARGIN_URL],
    indexSource: TAIEX_HISTORY_URL,
    maintenanceSource: MARKET_MAINTENANCE_URL,
  };
  marginHistoryCache.set(endDate, { at: Date.now(), value });
  if (marginHistoryCache.size > 16) marginHistoryCache.delete(marginHistoryCache.keys().next().value!);
  console.info("[market-overview] tw-margin-history", {
    endDate, totalMs: Date.now() - startedAt, dbReadMs, dbWriteMs, trendMs, indexMs, maintenanceMs,
    providerTiming, cachedRows: cacheRows.length, fetchedDates: pendingDates.length,
    cache: db && pendingDates.length === 0 && monthsToFetch.length === 0 && !refreshMaintenance ? "database" : "mixed-or-provider",
    status: "ok",
  });
  return value;
}

async function fetchTaiwanMarginHistory(endDate: string) {
  const cached = marginHistoryCache.get(endDate);
  if (cached && Date.now() - cached.at < 15 * 60_000) {
    console.info("[market-overview] tw-margin-history", { endDate, totalMs: 0, cache: "memory", status: "ok" });
    return cached.value;
  }
  const existing = marginHistoryInflight.get(endDate);
  if (existing) {
    console.info("[market-overview] tw-margin-history", { endDate, totalMs: 0, cache: "inflight", status: "ok" });
    return existing;
  }
  const pending = fetchTaiwanMarginHistoryFresh(endDate);
  marginHistoryInflight.set(endDate, pending);
  try { return await pending; }
  finally { if (marginHistoryInflight.get(endDate) === pending) marginHistoryInflight.delete(endDate); }
}

async function fetchTaiwanForeignHistory(endDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(Date.parse(`${endDate}T00:00:00Z`))) {
    throw new Error("外資圖表日期不正確");
  }
  const cached = foreignHistoryCache.get(endDate);
  if (cached && Date.now() - cached.at < 15 * 60_000) return cached.value;
  const end = new Date(`${endDate}T00:00:00Z`);
  const dates = Array.from({ length: 31 }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - (30 - index));
    return day;
  }).filter(day => day.getUTCDay() !== 0 && day.getUTCDay() !== 6);
  const rows: Array<{ date: string; twse: ReturnType<typeof parseInstitutional> | null; tpex: ReturnType<typeof parseInstitutional> | null }> = new Array(dates.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(2, dates.length) }, async () => {
    while (cursor < dates.length) {
      const index = cursor++;
      const date = dates[index].toISOString().slice(0, 10);
      const compact = date.replace(/-/g, "");
      const rocDate = `${Number(date.slice(0, 4)) - 1911}/${date.slice(5, 7)}/${date.slice(8, 10)}`;
      const results = await Promise.allSettled([
        officialJson(`${TWSE_FOREIGN_URL}&dayDate=${compact}`),
        officialJson(`${TPEX_FOREIGN_URL}?date=${encodeURIComponent(rocDate)}`),
      ]);
      const read = (result: PromiseSettledResult<any>, market: "TWSE" | "TPEX") => {
        if (result.status !== "fulfilled") return null;
        try {
          const value = parseInstitutional(result.value, market);
          return value?.date === date ? value : null;
        } catch { return null; }
      };
      rows[index] = { date, twse: read(results[0], "TWSE"), tpex: read(results[1], "TPEX") };
    }
  }));
  const history = rows.filter(row => row.twse || row.tpex).map(row => ({
    ...row,
    combined: combineInstitutional(row.twse, row.tpex),
  }));
  if (!history.length) throw new Error("這段期間沒有可用的法人資料，請稍後重試");
  const minimum = Math.max(2, Math.ceil(dates.length * 0.75));
  const complete = rows.filter(row => row.twse?.foreign && row.tpex?.foreign).length >= minimum;
  const value = { asOf: history.at(-1)?.date, history, windowDays: 31, complete, sources: [TWSE_FOREIGN_URL, TPEX_FOREIGN_URL] };
  foreignHistoryCache.set(endDate, { at: Date.now(), value });
  if (foreignHistoryCache.size > 15) foreignHistoryCache.delete(foreignHistoryCache.keys().next().value!);
  return value;
}

async function fetchTpexIndexHistory() {
  if (tpexIndexHistoryCache && Date.now() - tpexIndexHistoryCache.at < 15 * 60_000) return tpexIndexHistoryCache.value;
  const now = new Date();
  const months = Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    return `${date.getUTCFullYear() - 1911}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const results = await Promise.allSettled(months.map(month => officialJson(`${TPEX_INDEX_HISTORY_URL}&date=${encodeURIComponent(month)}`)));
  const payloads = results.flatMap(result => result.status === "fulfilled" && Array.isArray(result.value?.tables) ? [result.value] : []);
  if (!payloads.length) throw new Error("櫃買指數歷史資料暫缺");
  const value = { payloads, source: TPEX_INDEX_HISTORY_URL };
  tpexIndexHistoryCache = { at: Date.now(), value };
  return value;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.action === "tpex-index") {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      let response: Response;
      try {
        response = await fetch(TPEX_INDEX_URL, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "WealthTracker/1.0",
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`TPEx HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.taiex?.index) throw new Error("TPEx 未回傳櫃買指數");
      return json({ taiex: payload.taiex, infoArray: payload.infoArray });
    }

    if (body?.action === "tw-market-flow") return json(await fetchTaiwanMarketFlow());
    if (body?.action === "tw-margin-history") return json(await fetchTaiwanMarginHistory(String(body?.endDate || "")));
    if (body?.action === "tw-margin-history-cache-range") {
      return json(await fetchTaiwanMarginHistoryCacheRange(String(body?.startDate || ""), String(body?.endDate || "")));
    }
    if (body?.action === "tw-foreign-history") return json(await fetchTaiwanForeignHistory(String(body?.endDate || "")));
    if (body?.action === "tpex-index-history") return json(await fetchTpexIndexHistory());

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await fetch(SP500_PE_URL, {
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`Multpl HTTP ${response.status}`);
    const fullHistory = parseHistory(await response.text());
    const latest = fullHistory.at(-1);
    if (!latest) throw new Error("Multpl 本益比格式無法辨識");
    const latestTime = new Date(`${latest.date}T00:00:00Z`).getTime();
    const cutoff = latestTime - HISTORY_DAYS * 86400000;
    const history = fullHistory.filter(item => item.value > 0 && item.value < 500 && new Date(`${item.date}T00:00:00Z`).getTime() >= cutoff);
    return json({ value: latest.value, asOf: latest.date, estimated: latest.estimated, history, source: SP500_PE_URL });
  } catch (error) {
    console.error("market-overview", error);
    return json({ error: error instanceof Error ? error.message : "本益比載入失敗" }, 502);
  }
});
