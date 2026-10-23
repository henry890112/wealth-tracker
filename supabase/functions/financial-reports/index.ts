import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.1";
import { latestSecEarningsRelease, parseNokia6KEarningsReleaseHtml, parseSecEarningsReleaseHtml } from "./earningsRelease.shared.js";
import { parseYahooCalendar } from "./earningsCalendar.shared.js";
import { nasdaqSourceDatesForMonth, taipeiNasdaqEvent } from "./nasdaqCalendar.shared.js";
import { taiwanFilingEventsForMonth } from "./taiwanFilingCalendar.shared.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const FINMIND = "https://api.finmindtrade.com/api/v4/data";
const CALCULATION_VERSION = 12;
const CACHE_HOURS = 6;
const nasdaqDayCache = new Map<string, { rows: Row[]; expiresAt: number }>();
const VALID_FORMS = new Set(["10-Q", "10-K", "10-Q/A", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]);

type Row = Record<string, any>;
type MetricKey = "revenue" | "grossProfit" | "operatingIncome" | "netIncome" | "eps" | "operatingCashFlow" | "capex";
type MetricPoint = { end: string; filedAt?: string | null; announcementDate?: string | null; value: number };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string"
    ? value.replace(/,/g, "").replace(/^\((.*)\)$/, "-$1").trim()
    : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
const dateOnly = (value: unknown) => {
  const result = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(result) ? result.slice(0, 10) : null;
};
const unixDate = (value: unknown) => {
  const parsed = number(value);
  return parsed && parsed > 0 ? new Date(parsed * 1000).toISOString().slice(0, 10) : null;
};
const dateBefore = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const latestDate = (values: unknown[]) => values.map(dateOnly).filter(Boolean).sort().at(-1) || null;
const finite = (value: unknown): value is number => Number.isFinite(Number(value));
const growthPercent = (current: number | null, previous: number | null) => {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous) * 100;
};

async function fetchJson(url: string, headers: Record<string, string> = {}, timeoutMs = 25_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, headers: Record<string, string> = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const payload = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function nasdaqEarningsDay(date: string): Promise<Row[]> {
  const cachedDay = nasdaqDayCache.get(date);
  if (cachedDay && cachedDay.expiresAt > Date.now()) return cachedDay.rows;
  const payload = await fetchJson(
    `https://api.nasdaq.com/api/calendar/earnings?date=${date}`,
    { "User-Agent": "Mozilla/5.0", Accept: "application/json", Origin: "https://www.nasdaq.com" },
    8_000,
  );
  if (!payload?.data || (payload.data.rows != null && !Array.isArray(payload.data.rows))) {
    throw new Error('Nasdaq 財報日曆格式異常');
  }
  const rows = payload.data.rows || [];
  nasdaqDayCache.set(date, { rows, expiresAt: Date.now() + 30 * 60_000 });
  return rows;
}

async function nasdaqEarningsMonth(month: string, symbols: string[]) {
  const taipeiParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const parts = Object.fromEntries(taipeiParts.map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const dates = nasdaqSourceDatesForMonth(month, today);
  const wanted = new Set(symbols);
  const events: Row[] = [];
  let failures = 0;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, dates.length) }, async () => {
    while (cursor < dates.length) {
      const sourceDate = dates[cursor++];
      try {
        const rows = await nasdaqEarningsDay(sourceDate);
        for (const row of rows) {
          if (!wanted.has(String(row.symbol || '').toUpperCase())) continue;
          const event = taipeiNasdaqEvent(sourceDate, row);
          if (event?.date.startsWith(month)) events.push(event);
        }
      } catch (error) {
        failures += 1;
        console.warn('nasdaq earnings calendar', sourceDate, error);
      }
    }
  }));
  if (dates.length && failures === dates.length) throw new Error('Nasdaq 財報日曆暫時無法連線');
  return { events, incompleteDays: failures };
}

async function authenticate(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!url || !anonKey) return null;
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  return error ? null : user;
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

async function cached(market: string, symbol: string) {
  const client = serviceClient();
  if (!client) return null;
  const { data } = await client.from("financial_reports_cache")
    .select("payload,expires_at")
    .eq("market_type", market)
    .eq("symbol", symbol)
    .maybeSingle();
  return data
    && new Date(data.expires_at).getTime() > Date.now()
    && Number(data.payload?.calculationVersion) === CALCULATION_VERSION
    ? data.payload
    : null;
}

async function saveCache(market: string, symbol: string, payload: Row) {
  const client = serviceClient();
  if (!client) return;
  await client.from("financial_reports_cache").upsert({
    market_type: market,
    symbol,
    payload,
    source_as_of: payload.asOf || null,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + (market === "US" ? 1 : CACHE_HOURS) * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "market_type,symbol" });
}

function valueFromRow(row: Row, keys: string[]) {
  for (const key of keys) {
    const result = number(row[key]);
    if (result !== null) return result;
  }
  return null;
}

function filedDateFromRow(row: Row) {
  return dateOnly(
    row.announcement_date ||
      row.announce_date ||
      row.announcementDate ||
      row.filing_date ||
      row.filingDate ||
      row.published_at ||
      row.publishedAt,
  );
}

function periodLabel(end: string, quarterHint = "") {
  const year = end.slice(0, 4);
  const month = Number(end.slice(5, 7));
  const quarter = quarterHint.match(/Q[1-4]/)?.[0] || (month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4");
  return `${year} ${quarter}`;
}

function durationDays(row: Row) {
  const start = new Date(String(row.start || "")).getTime();
  const end = new Date(String(row.end || "")).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86400000) : 0;
}

function secRows(companyFacts: Row, concepts: string[], unit: string) {
  for (const namespace of ["us-gaap", "dei"]) {
    for (const concept of concepts) {
      const rows = companyFacts?.facts?.[namespace]?.[concept]?.units?.[unit];
      if (Array.isArray(rows) && rows.length) return rows.filter((item: Row) => item.end && finite(item.val));
    }
  }
  return [];
}

function secQuarterSeries(rows: Row[], deriveQ4 = true): MetricPoint[] {
  const direct = new Map<string, Row>();
  const cumulative = new Map<string, Row>();
  const annual = new Map<string, Row>();
  const putLatest = (target: Map<string, Row>, key: string, item: Row) => {
    const current = target.get(key);
    if (!current || text(item.filed) > text(current.filed)) target.set(key, item);
  };
  for (const item of rows) {
    if (!VALID_FORMS.has(text(item.form)) || !item.start || !item.end || !item.filed || !finite(item.val)) continue;
    const key = `${item.start}|${item.end}`;
    const days = durationDays(item);
    const quarter = text(item.fp);
    if (["Q1", "Q2", "Q3"].includes(quarter) && days >= 60 && days <= 150) putLatest(direct, key, item);
    if (["Q2", "Q3"].includes(quarter) && days > 150 && days <= 300) putLatest(cumulative, key, item);
    if (quarter === "FY" && days >= 300 && days <= 390) putLatest(annual, key, item);
  }
  const result = new Map<string, MetricPoint>();
  const addPoint = (item: Row, value: number) => {
    if (!finite(value)) return;
    const end = text(item.end);
    const filedAt = dateOnly(item.filed);
    const current = result.get(end);
    if (!current || text(filedAt) >= text(current.filedAt)) result.set(end, { end, filedAt, value: Number(value) });
  };
  for (const item of direct.values()) addPoint(item, Number(item.val));

  const cumulativeRows = [...cumulative.values()].sort((a, b) => text(a.end).localeCompare(text(b.end)));
  for (const item of cumulativeRows) {
    if (result.has(text(item.end))) continue;
    const previous = cumulativeRows
      .filter(row => text(row.start) === text(item.start) && text(row.end) < text(item.end))
      .sort((a, b) => text(a.end).localeCompare(text(b.end)))
      .at(-1);
    const priorDirect = [...direct.values()]
      .filter(row => text(row.start) >= text(item.start) && text(row.end) < text(item.end))
      .sort((a, b) => text(a.end).localeCompare(text(b.end)));
    const baseline = previous ? Number(previous.val) : priorDirect.reduce((sum, row) => sum + Number(row.val || 0), 0);
    addPoint(item, Number(item.val) - baseline);
  }

  if (deriveQ4) {
    for (const item of annual.values()) {
      if (result.has(text(item.end))) continue;
      const yearStart = text(item.start);
      const priorYtd = cumulativeRows
        .filter(row => text(row.start) === yearStart && text(row.end) < text(item.end))
        .sort((a, b) => text(a.end).localeCompare(text(b.end)))
        .at(-1);
      const priorDirect = [...direct.values()]
        .filter(row => text(row.start) >= yearStart && text(row.end) < text(item.end))
        .sort((a, b) => text(a.end).localeCompare(text(b.end)));
      const baseline = priorYtd ? Number(priorYtd.val) : priorDirect.reduce((sum, row) => sum + Number(row.val || 0), 0);
      if (priorYtd || priorDirect.length) addPoint(item, Number(item.val) - baseline);
    }
  }
  return [...result.values()].sort((a, b) => a.end.localeCompare(b.end)).slice(-12);
}

function secInstant(rows: Row[]) {
  return rows
    .filter(item => item.end && item.filed && finite(item.val))
    .sort((a, b) => `${a.end}|${a.filed}`.localeCompare(`${b.end}|${b.filed}`))
    .at(-1);
}

function secEarningsAnnouncements(submissions: Row) {
  const recent = submissions?.filings?.recent || {};
  const length = Array.isArray(recent.form) ? recent.form.length : 0;
  return Array.from({ length }, (_, index) => ({
    form: text(recent.form?.[index]),
    items: text(recent.items?.[index]),
    date: dateOnly(recent.filingDate?.[index]),
    reportDate: dateOnly(recent.reportDate?.[index]),
  })).filter(item => item.date && item.form.startsWith("8-K") && /\b2\.02\b/.test(item.items));
}

function announcementDateForPeriod(end: string, filedAt: string | null | undefined, announcements: Row[]) {
  return announcements
    .filter(item => item.date >= end && (!filedAt || item.date <= filedAt))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .at(-1)?.date || null;
}

function attachAnnouncementDates(series: Partial<Record<MetricKey, MetricPoint[]>>, announcements: Row[]) {
  for (const points of Object.values(series)) {
    for (const point of points || []) {
      point.announcementDate = announcementDateForPeriod(point.end, point.filedAt, announcements);
    }
  }
}

function mergeMetricSeries(series: Partial<Record<MetricKey, MetricPoint[]>>, market: string, source: string, warnings: string[]) {
  // Keep the complete available date range while calculating growth. We trim
  // the returned payload only after YoY is calculated so the first displayed
  // quarter still has its prior-year comparison available.
  const dates = [...new Set(Object.values(series).flatMap(items => (items || []).map(item => item.end)))].sort();
  const rows = dates.map(end => {
    const values: Row = { periodEnd: end, label: periodLabel(end), filedAt: null, announcementDate: null };
    for (const key of Object.keys(series) as MetricKey[]) {
      const item = (series[key] || []).find(point => point.end === end);
      values[key] = item?.value ?? null;
      if (!values.filedAt && item?.filedAt) values.filedAt = item.filedAt;
      if (!values.announcementDate && item?.announcementDate) values.announcementDate = item.announcementDate;
    }
    if (values.revenue !== null && values.revenue !== undefined && values.grossProfit !== null) values.grossMargin = values.revenue ? values.grossProfit / values.revenue * 100 : null;
    if (values.revenue !== null && values.revenue !== undefined && values.operatingIncome !== null) values.operatingMargin = values.revenue ? values.operatingIncome / values.revenue * 100 : null;
    if (values.revenue !== null && values.revenue !== undefined && values.netIncome !== null) values.netMargin = values.revenue ? values.netIncome / values.revenue * 100 : null;
    if (values.operatingCashFlow !== null && values.capex !== null) values.freeCashFlow = Number(values.operatingCashFlow) - Math.abs(Number(values.capex));
    return values;
  });
  const numericKeys = ["revenue", "grossProfit", "operatingIncome", "netIncome", "eps", "operatingCashFlow", "capex", "freeCashFlow"];
  rows.forEach((row, index) => {
    for (const key of numericKeys) {
      const current = number(row[key]);
      const previous = number(rows[index - 1]?.[key]);
      const yearAgo = number(rows[index - 4]?.[key]);
      // All growth rates use the absolute value of the comparison period as
      // the base. A move from a loss to a profit stays positive: -0.03 ->
      // 0.44 = (0.44 - (-0.03)) / abs(-0.03) = +1566.67%.
      row[`${key}QoQ`] = growthPercent(current, previous);
      row[`${key}YoY`] = growthPercent(current, yearAgo);
    }
  });
  const missing = ["revenue", "eps", "netIncome"].filter(key => !rows.some(row => finite(row[key])));
  if (missing.length) warnings.push(`${market === "TW" ? "FinMind" : "SEC"} 缺少 ${missing.join('、')}，部分趨勢不顯示。`);
  return rows.slice(-8);
}

function mergeEarningsHistory(rows: Row[], quarters: Row[]) {
  const history = rows.map(item => {
    const quarter = unixDate(item.quarter?.raw || item.quarter);
    const surpriseRaw = number(item.surprisePercent?.raw ?? item.surprisePercent);
    return {
      periodEnd: quarter,
      reportedAt: dateOnly(item.reportedDate?.fmt) || unixDate(item.reportedDate?.raw),
      actualEps: number(item.epsActual?.raw ?? item.epsActual),
      estimateEps: number(item.epsEstimate?.raw ?? item.epsEstimate),
      surprise: number(item.epsDifference?.raw ?? item.epsDifference),
      surprisePercent: surpriseRaw === null ? null : Math.abs(surpriseRaw) <= 1 ? surpriseRaw * 100 : surpriseRaw,
      source: "Yahoo Finance・盈餘預估",
    };
  }).filter(item => item.periodEnd).sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)));
  for (const quarter of quarters) {
    const match = history.find(item => item.periodEnd === quarter.periodEnd)
      || history.find(item => item.periodEnd && Math.abs(new Date(item.periodEnd).getTime() - new Date(quarter.periodEnd).getTime()) < 45 * 86400000);
    if (match) Object.assign(quarter, {
      epsEstimate: match.estimateEps,
      epsActual: match.actualEps,
      epsSurprise: match.surprise,
      epsSurprisePercent: match.surprisePercent,
      estimateSource: match.source,
      announcementDate: quarter.announcementDate || match.reportedAt || null,
    });
    // SEC Company Facts may omit the standalone Q4 EPS because the 10-K
    // commonly reports only the full-year EPS. Yahoo's published actual EPS
    // is a supplementary quarter-level value; use it only when SEC has no
    // EPS so a missing value is not rendered as a false zero.
    if (!finite(quarter.eps) && finite(match?.actualEps)) {
      quarter.eps = match.actualEps;
      quarter.epsSource = match.source;
    }
  }
  return history.slice(-8);
}

function yahooCookieHeader(raw: string) {
  return raw
    .split(/,(?=[A-Za-z0-9_]+=)/)
    .map(part => part.split(";", 1)[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function yahooQuoteSummary(candidate: string, headers: Record<string, string>) {
  const landing = await fetch(`https://fc.yahoo.com`, { headers });
  const cookie = yahooCookieHeader(landing.headers.get("set-cookie") || "");
  const authHeaders = cookie ? { ...headers, Cookie: cookie } : headers;
  const crumb = text(await fetchText("https://query1.finance.yahoo.com/v1/test/getcrumb", authHeaders));
  if (!crumb) throw new Error("Yahoo crumb unavailable");
  return fetchJson(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(candidate)}?modules=calendarEvents,earnings,earningsHistory,earningsTrend&crumb=${encodeURIComponent(crumb)}`,
    authHeaders,
    12_000,
  );
}

async function yahooSupplement(symbol: string, market: string) {
  const candidates = market === "TW" ? [`${symbol}.TW`, `${symbol}.TWO`] : [symbol];
  const headers = { "User-Agent": "WealthTracker/1.0" };
  for (const candidate of candidates) {
    try {
      const payload = await yahooQuoteSummary(candidate, headers);
      const result = payload?.quoteSummary?.result?.[0];
      if (!result) continue;
      const calendar = parseYahooCalendar(result);
      const earningsRows = result?.earnings?.earningsChart?.quarterly || [];
      const historyRows = earningsRows.length
        ? earningsRows.map((item: Row) => ({
          quarter: item.periodEndDate,
          reportedDate: item.reportedDate,
          epsActual: item.actual,
          epsEstimate: item.estimate,
          epsDifference: item.difference,
          surprisePercent: item.surprisePct,
        }))
        : result?.earningsHistory?.history || [];
      const trendRows = result?.earningsTrend?.trend || [];
      const trend = trendRows.map((item: Row) => ({
        period: text(item.period), endDate: dateOnly(item.endDate?.fmt) || unixDate(item.endDate?.raw),
        epsEstimate: number(item.earningsEstimate?.avg?.raw ?? item.earningsEstimate?.avg),
        revenueEstimate: number(item.revenueEstimate?.avg?.raw ?? item.revenueEstimate?.avg),
      })).filter(item => item.endDate || item.period);
      return {
        calendar,
        earningsHistory: historyRows,
        estimates: trend,
        source: "Yahoo Finance・財報公布日與市場預估",
      };
    } catch {
      // Yahoo metadata is supplementary. Actual SEC/FinMind values remain usable.
    }
  }
  return { calendar: { nextDate: null, previousDate: null }, earningsHistory: [], estimates: [], source: null };
}

async function secReports(symbol: string) {
  const headers = {
    "User-Agent": Deno.env.get("SEC_USER_AGENT") || "WealthTracker/1.0 personal-research-app",
    Accept: "application/json",
  };
  const tickerPayload = await fetchJson("https://www.sec.gov/files/company_tickers.json", headers);
  const match = Object.values(tickerPayload || {}).find((item: any) => text(item.ticker).toUpperCase() === symbol);
  if (!match?.cik_str) throw new Error("SEC 找不到這個美股代號，可能是 ETF、ADR 或特殊證券。");
  const cik = String(match.cik_str).padStart(10, "0");
  const [facts, submissions] = await Promise.all([
    fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, headers),
    fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, headers).catch(() => ({})),
  ]);
  const announcements = secEarningsAnnouncements(submissions);
  let latestEarningsRelease = latestSecEarningsRelease(submissions, cik, symbol === "NOK");
  const series: Partial<Record<MetricKey, MetricPoint[]>> = {
    revenue: secQuarterSeries(secRows(facts, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], "USD")),
    grossProfit: secQuarterSeries(secRows(facts, ["GrossProfit"], "USD")),
    operatingIncome: secQuarterSeries(secRows(facts, ["OperatingIncomeLoss"], "USD")),
    netIncome: secQuarterSeries(secRows(facts, ["NetIncomeLoss", "ProfitLoss"], "USD")),
    // SEC often reports AVGO's full-year EPS without a standalone Q4 fact.
    // Derive Q4 from FY EPS minus the three reported quarters so the chart
    // does not lose the fourth bar (the reference provider does the same).
    eps: secQuarterSeries(secRows(facts, ["EarningsPerShareDiluted", "EarningsPerShareBasic"], "USD/shares")),
    operatingCashFlow: secQuarterSeries(secRows(facts, ["NetCashProvidedByUsedInOperatingActivities"], "USD")),
    capex: secQuarterSeries(secRows(facts, ["PaymentsToAcquireProductiveAssets", "PaymentsToAcquirePropertyPlantAndEquipment"], "USD")),
  };
  attachAnnouncementDates(series, announcements);
  const instant = {
    cash: number(secInstant(secRows(facts, ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], "USD"))?.val),
    assets: number(secInstant(secRows(facts, ["Assets"], "USD"))?.val),
    liabilities: number(secInstant(secRows(facts, ["Liabilities"], "USD"))?.val),
  };
  const asOf = latestDate(Object.values(series).flatMap(items => (items || []).map(item => item.end)));
  let releaseQuarter: Row | null = null;
  if (symbol === "NOK") {
    // NOK submits many non-earnings 6-Ks. Walk recent filings until the
    // attached report table is confirmed, so an unrelated 6-K cannot be
    // mistaken for an earnings date in the calendar.
    let candidate = latestEarningsRelease;
    for (let attempt = 0; candidate && attempt < 12; attempt += 1) {
      try {
        releaseQuarter = await secEarningsReleaseQuarter(candidate, cik, headers);
      } catch {
        releaseQuarter = null;
      }
      if (releaseQuarter) {
        latestEarningsRelease = candidate;
        break;
      }
      candidate = latestSecEarningsRelease(submissions, cik, true, candidate.date);
    }
    if (!releaseQuarter) latestEarningsRelease = null;
  } else if (latestEarningsRelease?.date && (!asOf || latestEarningsRelease.date > asOf)) {
    try {
      releaseQuarter = await secEarningsReleaseQuarter(latestEarningsRelease, cik, headers);
    } catch {
      // The filing date remains useful even if its optional release table
      // cannot be parsed; never let supplementary parsing hide SEC facts.
    }
  }
  return {
    companyName: text(match.title || symbol),
    source: symbol === "NOK" ? "SEC 6-K 公司財報公告 ＋ SEC Company Facts" : "SEC Company Facts",
    currency: symbol === "NOK" ? "EUR" : "USD",
    series,
    instant,
    latestEarningsRelease,
    releaseQuarter,
    asOf,
  };
}

async function secEarningsReleaseQuarter(release: Row, cik: string, headers: Record<string, string>) {
  if (release.form === "6-K") {
    const html = await fetchText(release.url, {
      ...headers,
      Accept: "text/html,application/xhtml+xml",
    });
    return parseNokia6KEarningsReleaseHtml(html, release);
  }
  const accessionPath = String(release.accession || "").replace(/-/g, "");
  if (!/^\d{18}$/.test(accessionPath)) return null;
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionPath}/`;
  const indexHtml = await fetchText(`${base}${release.accession}-index.htm`, {
    ...headers,
    Accept: "text/html,application/xhtml+xml",
  });
  const exhibitRow = [...indexHtml.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map(match => match[0])
    .find(row => /\bEX-99\.1\b/i.test(row));
  const href = exhibitRow?.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
  if (!href) return null;
  const exhibitUrl = new URL(href, "https://www.sec.gov");
  if (exhibitUrl.origin !== "https://www.sec.gov" || !exhibitUrl.pathname.startsWith(`/Archives/edgar/data/${Number(cik)}/`)) return null;
  const html = await fetchText(exhibitUrl.toString(), {
    ...headers,
    Accept: "text/html,application/xhtml+xml",
  });
  return parseSecEarningsReleaseHtml(html, release);
}

async function finmindDataset(dataset: string, symbol: string, startDate: string) {
  const token = Deno.env.get("FINMIND_API_TOKEN") || "";
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const query = new URLSearchParams({ dataset, data_id: symbol, start_date: startDate });
  const payload = await fetchJson(`${FINMIND}?${query}`, headers);
  if (Number(payload.status) !== 200) throw new Error(payload.msg || `FinMind ${dataset} 資料錯誤`);
  return Array.isArray(payload.data) ? payload.data as Row[] : [];
}

function twSeries(rows: Row[], names: string[], scale = 1): MetricPoint[] {
  const map = new Map<string, MetricPoint>();
  for (const row of rows) {
    if (!names.includes(text(row.type || row.item || row.origin_name))) continue;
    const end = dateOnly(row.date || row.end_date || row.report_date);
    const value = valueFromRow(row, ["value", "amount", "val"]);
    if (!end || value === null) continue;
    const current = map.get(end);
    const filedAt = filedDateFromRow(row);
    if (!current || end >= current.end) map.set(end, { end, filedAt, value: value * scale });
  }
  return [...map.values()].sort((a, b) => a.end.localeCompare(b.end)).slice(-12);
}

function twMonthlyRevenue(rows: Row[]) {
  const byPeriod = new Map<string, { month: string; revenue: number; reportedAt: string | null }>();
  for (const row of rows) {
    const year = number(row.revenue_year);
    const month = number(row.revenue_month);
    const reportedAt = dateOnly(row.date);
    const period = year !== null && month !== null && month >= 1 && month <= 12
      ? `${String(Math.trunc(year)).padStart(4, "0")}-${String(Math.trunc(month)).padStart(2, "0")}`
      : reportedAt?.slice(0, 7) || null;
    const revenue = valueFromRow(row, ["revenue", "Revenue", "value"]);
    if (!period || revenue === null) continue;
    const current = byPeriod.get(period);
    if (!current || String(reportedAt || "") >= String(current.reportedAt || "")) {
      byPeriod.set(period, { month: `${period}-01`, revenue, reportedAt });
    }
  }
  const sorted = [...byPeriod.values()].sort((a, b) => a.month.localeCompare(b.month));
  const revenueByPeriod = new Map(sorted.map(row => [row.month.slice(0, 7), row.revenue]));
  return sorted.slice(-12).map(row => {
    const [year, month] = row.month.slice(0, 7).split("-").map(Number);
    const priorPeriod = `${String(year - 1).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    const priorRevenue = revenueByPeriod.get(priorPeriod);
    const yoy = growthPercent(row.revenue, priorRevenue ?? null);
    return { month: row.month, revenue: row.revenue, yoy };
  });
}

async function twReports(symbol: string) {
  const [financial, cashflow, monthlyRevenue] = await Promise.all([
    finmindDataset("TaiwanStockFinancialStatements", symbol, dateBefore(1200)),
    finmindDataset("TaiwanStockCashFlowsStatement", symbol, dateBefore(1200)).catch(() => []),
    // Keep enough history to calculate YoY for every one of the latest
    // twelve revenue months, including the prior-year comparison months.
    finmindDataset("TaiwanStockMonthRevenue", symbol, dateBefore(800)).catch(() => []),
  ]);
  const rows = [...financial, ...cashflow];
  const series: Partial<Record<MetricKey, MetricPoint[]>> = {
    revenue: twSeries(rows, ["Revenue", "OperatingRevenue", "NetOperatingRevenue", "營業收入", "營業收入合計", "營業收入淨額"]),
    grossProfit: twSeries(rows, ["GrossProfit", "GrossProfitLoss", "營業毛利"]),
    operatingIncome: twSeries(rows, ["OperatingIncome", "OperatingIncomeLoss", "營業利益"]),
    netIncome: twSeries(rows, ["NetIncome", "NetIncomeLoss", "ProfitLoss", "本期淨利(淨損)", "本期淨利（淨損）"]),
    eps: twSeries(rows, ["EPS", "BasicEarningsPerShare", "稅後每股盈餘", "基本每股盈餘"]),
    operatingCashFlow: twSeries(rows, ["CashFlowsFromOperatingActivities", "CashFlowsFromOperating", "營業活動之淨現金流入（流出）"]),
    capex: twSeries(rows, ["PropertyAndPlantAndEquipment", "取得不動產、廠房及設備"]),
  };
  return {
    companyName: symbol,
    source: "FinMind・臺灣財報",
    series,
    latestEarningsRelease: null,
    monthlyRevenue: twMonthlyRevenue(monthlyRevenue),
    asOf: latestDate(rows.map(row => row.date || row.end_date)),
  };
}

async function buildReports(symbol: string, market: string) {
  const warnings: string[] = [];
  const [actual, yahoo] = await Promise.all([
    market === "TW" ? twReports(symbol) : secReports(symbol),
    yahooSupplement(symbol, market),
  ]);
  const quarters = mergeMetricSeries(actual.series, market, actual.source, warnings);
  const releaseQuarter = actual.releaseQuarter as Row | null;
  if (releaseQuarter?.periodEnd) {
    const priorYearEnd = `${Number(String(releaseQuarter.periodEnd).slice(0, 4)) - 1}${String(releaseQuarter.periodEnd).slice(4)}`;
    const priorYearQuarter = quarters.find(row => row.periodEnd === priorYearEnd);
    if (priorYearQuarter) {
      releaseQuarter.revenueYoY ??= growthPercent(number(releaseQuarter.revenue), number(priorYearQuarter.revenue));
      releaseQuarter.epsYoY ??= growthPercent(number(releaseQuarter.eps), number(priorYearQuarter.eps));
    }
    const existingIndex = quarters.findIndex(row => row.periodEnd === releaseQuarter.periodEnd);
    if (existingIndex >= 0) {
      const existing = quarters[existingIndex];
      for (const [key, value] of Object.entries(releaseQuarter)) {
        if (value !== null && value !== undefined) existing[key] = value;
      }
    } else if (releaseQuarter.periodEnd > (quarters.at(-1)?.periodEnd || "")) {
      quarters.push(releaseQuarter);
    }
    quarters.sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)));
    if (quarters.length > 8) quarters.splice(0, quarters.length - 8);
    if (releaseQuarter.revenue !== null && releaseQuarter.eps !== null && releaseQuarter.netIncome !== null) {
      for (let index = warnings.length - 1; index >= 0; index -= 1) {
        if (warnings[index].startsWith("SEC 缺少 ")) warnings.splice(index, 1);
      }
    }
  }
  const earningsHistory = mergeEarningsHistory(yahoo.earningsHistory || [], quarters);
  const nextDate = yahoo.calendar?.nextDate || null;
  const latestRelease = actual.latestEarningsRelease || null;
  const previousCandidates = [
    { date: latestRelease?.date, source: latestRelease?.source },
    { date: yahoo.calendar?.previousDate, source: yahoo.source },
    { date: quarters.at(-1)?.announcementDate, source: "SEC 8-K・公司公告" },
  ].filter(item => item.date).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const previousDate = previousCandidates[0]?.date || null;
  if (!nextDate) warnings.push("資料來源目前沒有可信的下一次財報日期。");
  if (!quarters.length) warnings.push("目前沒有可用的季度財報資料。");
  if (market === "US" && latestRelease?.date > (actual.asOf || "") && !releaseQuarter) {
    warnings.push(`最新 SEC ${latestRelease.form || "8-K"} 已公告；新聞稿格式未能安全解析，季度數字仍以已結構化申報資料為準。`);
  }
  if (market === "TW" && !actual.monthlyRevenue?.length) warnings.push("目前沒有可用的近 12 個月營收資料。");
  const source = [actual.source, yahoo.source].filter(Boolean).join(" ＋ ");
  return {
    symbol,
    marketType: market,
    companyName: actual.companyName || symbol,
    currency: actual.currency || (market === "TW" ? "TWD" : "USD"),
    source: source || (market === "TW" ? "FinMind" : "SEC Company Facts"),
    asOf: releaseQuarter?.periodEnd && releaseQuarter.periodEnd > (actual.asOf || "")
      ? releaseQuarter.periodEnd
      : actual.asOf || quarters.at(-1)?.periodEnd || null,
    calculationVersion: CALCULATION_VERSION,
    quarters,
    monthlyRevenue: actual.monthlyRevenue || [],
    earningsCalendar: {
      previousDate,
      nextDate,
      previousSource: previousCandidates[0]?.source || null,
      nextSource: nextDate ? yahoo.source : null,
    },
    latestEarningsRelease: latestRelease,
    releaseQuarter: releaseQuarter?.periodEnd && releaseQuarter.periodEnd > (actual.asOf || "") ? releaseQuarter : null,
    earningsHistory,
    estimates: yahoo.estimates || [],
    warnings,
  };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!await authenticate(request)) return json({ error: "Unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    if (body.calendarMonth) {
      const month = text(body.calendarMonth);
      const market = text(body.marketType || "US").toUpperCase();
      const symbols: string[] = [...new Set<string>((Array.isArray(body.symbols) ? body.symbols : [])
        .map((value: unknown) => text(value).toUpperCase()))];
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !["TW", "US"].includes(market) || symbols.length > 100
        || symbols.some((value: string) => !/^[A-Z0-9.-]{1,20}$/.test(value))) {
        return json({ error: '財報日曆月份或代號不正確' }, 400);
      }
      if (market === "TW") {
        const taipeiParts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(new Date());
        const parts = Object.fromEntries(taipeiParts.map(part => [part.type, part.value]));
        const today = `${parts.year}-${parts.month}-${parts.day}`;
        return json({ events: taiwanFilingEventsForMonth(month, symbols, today) });
      }
      return json(await nasdaqEarningsMonth(month, symbols));
    }
    const symbol = text(body.symbol).toUpperCase();
    const market = text(body.marketType || (/^\d+$/.test(symbol) ? "TW" : "US")).toUpperCase();
    const forceRefresh = Boolean(body.forceRefresh);
    if (!/^[A-Z0-9.-]{1,20}$/.test(symbol) || !["TW", "US"].includes(market)) return json({ error: "財報分析僅支援台股與美股個股" }, 400);
    if (!forceRefresh) {
      const hit = await cached(market, symbol);
      if (hit) return json(hit);
    }
    const result = await buildReports(symbol, market);
    await saveCache(market, symbol, result);
    return json(result);
  } catch (error) {
    console.error("financial-reports", error);
    return json({ error: error instanceof Error ? error.message : "無法取得財報資料" }, 502);
  }
});
