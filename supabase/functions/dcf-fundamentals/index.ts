import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.1";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const FINMIND = "https://api.finmindtrade.com/api/v4/data";
// Bump this whenever the SEC/FinMind mapping changes so an old unsupported
// response cannot remain in the 12-hour fundamentals cache.
const CALCULATION_VERSION = 10;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function auth(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "", { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user } } = await client.auth.getUser(token);
  return user;
}
async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try { const response = await fetch(url, { headers, signal: controller.signal }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(`HTTP ${response.status}`); return body; } finally { clearTimeout(timer); }
}
function serviceClient() { const url = Deno.env.get("SUPABASE_URL") || ""; const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""; return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null; }
async function cached(market: string, symbol: string) { const client = serviceClient(); if (!client) return null; const { data } = await client.from("dcf_fundamentals_cache").select("payload,expires_at").eq("market_type", market).eq("symbol", symbol).maybeSingle(); return data && new Date(data.expires_at).getTime() > Date.now() && Number(data.payload?.calculationVersion) === CALCULATION_VERSION ? data.payload : null; }
async function saveCache(market: string, symbol: string, payload: Record<string, unknown>) { const client = serviceClient(); if (!client) return; await client.from("dcf_fundamentals_cache").upsert({ market_type: market, symbol, payload, source_as_of: payload.asOf || null, fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() }, { onConflict: "market_type,symbol" }); }
const finite = (value: unknown) => Number.isFinite(Number(value));
const number = (value: unknown) => {
  const normalized = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  return finite(normalized) ? Number(normalized) : null;
};
const dateBefore = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

type Fact = { start?: string; end?: string; filed?: string; val?: number; form?: string; fp?: string; frame?: string };
function facts(companyFacts: Record<string, unknown>, namespaces: string[], concepts: string[], unit: string) {
  for (const namespace of namespaces) for (const concept of concepts) {
    const rows = ((companyFacts.facts as Record<string, Record<string, unknown>> | undefined)?.[namespace]?.[concept] as { units?: Record<string, Fact[]> } | undefined)?.units?.[unit];
    if (Array.isArray(rows) && rows.length) return rows.filter(row => row.end && row.filed && finite(row.val));
  }
  return [];
}

const VALID_FORMS = new Set(["10-Q", "10-K", "10-Q/A", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]);
function durationDays(item: Fact) {
  const start = new Date(String(item.start || "")).getTime();
  const end = new Date(String(item.end || "")).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86400000) : 0;
}

// Company Facts contains both cumulative YTD facts and standalone quarter
// facts.  Only 60–150 day periods are treated as standalone quarters; Q4 is
// derived from FY minus Q1–Q3.  This prevents a six-month Q2 value from being
// counted as a full quarter in TTM.
type Quarter = { start: string; end: string; filed: string; value: number; frame?: string };
function quarterlyFacts(rows: Fact[]): Quarter[] {
  const candidates = rows.filter(item => VALID_FORMS.has(String(item.form)) && item.start && item.end && item.filed && finite(item.val));
  type Period = { item: Fact; filed: string };
  const quarterly = new Map<string, Period>();
  const annual = new Map<string, Period>();
  const update = (target: Map<string, Period>, key: string, item: Fact) => {
    const filed = String(item.filed);
    const current = target.get(key);
    if (!current || filed >= current.filed) target.set(key, { item, filed });
  };
  for (const item of candidates) {
    const fp = String(item.fp || "");
    const days = durationDays(item);
    const key = `${item.start}|${item.end}`;
    if (["Q1", "Q2", "Q3"].includes(fp) && days >= 60 && days <= 150) update(quarterly, key, item);
    if (fp === "FY" && days >= 300 && days <= 390) update(annual, key, item);
  }
  const result: Quarter[] = [...quarterly.values()].map(period => ({ start: String(period.item.start), end: String(period.item.end), filed: period.filed, value: Number(period.item.val), frame: period.item.frame }));
  for (const period of annual.values()) {
    const item = period.item;
    const start = String(item.start);
    const end = String(item.end);
    if (quarterly.has(`${start}|${end}`)) continue;
    const firstThree = [...quarterly.values()]
      .map(entry => entry.item)
      .filter(entry => String(entry.start) >= start && String(entry.end) < end)
      .sort((a, b) => String(a.end).localeCompare(String(b.end)));
    if (firstThree.length !== 3) continue;
    result.push({ start, end, filed: period.filed, value: Number(item.val) - firstThree.reduce((sum, entry) => sum + Number(entry.val || 0), 0), frame: `${item.frame || end}Q4` });
  }
  return result.sort((a, b) => a.end.localeCompare(b.end) || a.filed.localeCompare(b.filed));
}

// A number of issuers publish cash-flow adjustments only as year-to-date
// values (for example AVGO's depreciation).  When standalone quarters are
// unavailable, derive TTM from the latest annual and matching prior-year YTD:
// FY + current YTD - prior-year YTD.
function ytdTtmDetail(rows: Fact[]) {
  const candidates = rows.filter(item => VALID_FORMS.has(String(item.form)) && item.start && item.end && item.filed && finite(item.val));
  const ytd = candidates
    .filter(item => ["Q2", "Q3"].includes(String(item.fp)) && durationDays(item) > 150 && durationDays(item) < 330)
    .sort((a, b) => String(a.end).localeCompare(String(b.end)) || String(a.filed).localeCompare(String(b.filed)))
    .at(-1);
  if (!ytd) return null;
  const ytdDays = durationDays(ytd);
  const priorYtd = candidates
    .filter(item => String(item.fp) === String(ytd.fp) && durationDays(item) > 150 && durationDays(item) < 330 && Math.abs(durationDays(item) - ytdDays) <= 10 && String(item.end) < String(ytd.start))
    .sort((a, b) => String(a.end).localeCompare(String(b.end)) || String(a.filed).localeCompare(String(b.filed)))
    .at(-1);
  const annual = candidates
    .filter(item => String(item.fp) === "FY" && durationDays(item) >= 300 && durationDays(item) <= 390 && String(item.end) < String(ytd.start))
    .sort((a, b) => String(a.end).localeCompare(String(b.end)) || String(a.filed).localeCompare(String(b.filed)))
    .at(-1);
  if (!priorYtd || !annual) return null;
  return {
    value: Number(annual.val) + Number(ytd.val) - Number(priorYtd.val),
    end: String(ytd.end),
    filed: [String(annual.filed), String(ytd.filed), String(priorYtd.filed)].sort().at(-1) || String(ytd.filed),
    basis: "TTM（年度＋當期累計−去年同期）",
  };
}

function ttmDetail(rows: Fact[]) {
  const quarters = quarterlyFacts(rows);
  if (quarters.length >= 4) {
    const window = quarters.slice(-4);
    const span = (new Date(window.at(-1)!.end).getTime() - new Date(window[0].end).getTime()) / 86400000;
    if (span >= 250 && span <= 390) {
      return { value: window.reduce((sum, item) => sum + item.value, 0), end: window.at(-1)!.end, filed: window.reduce((latest, item) => item.filed > latest ? item.filed : latest, ""), basis: "TTM（近四季）" };
    }
  }
  const ytd = ytdTtmDetail(rows);
  if (ytd) return ytd;
  const annual = rows.filter(item => VALID_FORMS.has(String(item.form)) && String(item.fp) === "FY" && durationDays(item) >= 300 && durationDays(item) <= 390 && finite(item.val)).sort((a, b) => String(a.end).localeCompare(String(b.end)) || String(a.filed).localeCompare(String(b.filed)));
  const item = annual.at(-1);
  return item ? { value: Number(item.val), end: String(item.end), filed: String(item.filed), basis: "最新完整年度（財報不足四季）" } : null;
}
function ttm(rows: Fact[]) { return ttmDetail(rows)?.value ?? null; }
type TtmDetail = ReturnType<typeof ttmDetail>;
function sumTtmDetails(details: TtmDetail[]) {
  const usable = details.filter((item): item is NonNullable<TtmDetail> => Boolean(item));
  if (!usable.length) return null;
  const end = usable[0].end;
  // D&A components must describe the same reporting period.  Refuse to add
  // mismatched periods instead of silently combining a stale annual value with
  // a fresh quarter.
  if (usable.some(item => item.end !== end)) return null;
  return {
    value: usable.reduce((sum, item) => sum + Number(item.value), 0),
    end,
    filed: usable.reduce((latest, item) => item.filed > latest ? item.filed : latest, ""),
    basis: usable.some(item => item.basis.includes("最新完整年度")) ? "最新完整年度（拆分欄位合計）" : "TTM（拆分欄位合計）",
  };
}
function latestDetail(rows: Fact[]) {
  const byEnd = new Map<string, Fact>();
  for (const row of rows.filter(item => finite(item.val) && item.end)) {
    const end = String(row.end);
    const current = byEnd.get(end);
    if (!current || String(row.filed || "") >= String(current.filed || "")) byEnd.set(end, row);
  }
  const row = [...byEnd.values()].sort((a, b) => String(a.end).localeCompare(String(b.end)) || String(a.filed).localeCompare(String(b.filed))).at(-1);
  return row ? { value: Number(row.val), end: String(row.end), filed: String(row.filed || "") } : null;
}
function latest(rows: Fact[]) { return latestDetail(rows)?.value ?? null; }
function latestTwo(rows: Fact[]) {
  const byEnd = new Map<string, Fact>();
  for (const row of rows.filter(item => finite(item.val) && item.end)) {
    const end = String(row.end);
    const current = byEnd.get(end);
    if (!current || String(row.filed || "") >= String(current.filed || "")) byEnd.set(end, row);
  }
  const values = [...byEnd.values()].sort((a, b) => String(a.end).localeCompare(String(b.end)));
  return [values.at(-1)?.val ?? null, values.at(-2)?.val ?? null];
}

async function us(symbol: string) {
  const headers = { "User-Agent": Deno.env.get("SEC_USER_AGENT") || "WealthTracker/1.0 personal-research-app", Accept: "application/json" };
  const tickers = await fetchJson("https://www.sec.gov/files/company_tickers.json", headers);
  const match = Object.values(tickers).find((item: unknown) => String((item as { ticker?: string }).ticker || "").toUpperCase() === symbol) as { cik_str?: number; title?: string } | undefined;
  if (!match?.cik_str) return { unsupported: true, reason: "SEC 找不到公司財報，ETF、部分 ADR 或特殊證券不支援 DCF。" };
  const cik = String(match.cik_str).padStart(10, "0");
  const [companyFacts, submissions] = await Promise.all([
    fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, headers),
    fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, headers),
  ]);
  const sic = Number(submissions?.sic || 0);
  if ((sic >= 6000 && sic <= 6799) || (sic >= 6200 && sic <= 6299)) {
    return { unsupported: true, reason: "金融業不適用一般 FCFF DCF，建議使用 DDM、P/B 或剩餘收益模型。", currency: "USD" };
  }
  const ebitRows = facts(companyFacts, ["us-gaap"], ["OperatingIncomeLoss", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"], "USD");
  const taxRows = facts(companyFacts, ["us-gaap"], ["IncomeTaxExpenseBenefit"], "USD");
  const pretaxRows = facts(companyFacts, ["us-gaap"], ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"], "USD");
  // SEC does not require one aggregate D&A concept.  Broadcom, for example,
  // exposes current-period depreciation and amortization as separate facts:
  // `us-gaap:Depreciation` and `us-gaap:AmortizationOfIntangibleAssets`.
  // Company Facts intentionally publishes standard us-gaap/dei namespaces;
  // a filing's custom `avgo:` presentation tag is not available here.  Prefer
  // a current aggregate concept when one exists, otherwise add the standard
  // components for the same TTM/annual period.
  const daAggregateConcepts = [
    "DepreciationDepletionAndAmortizationPropertyPlantAndEquipment",
    "DepreciationAndAmortization",
    "DepreciationDepletionAndAmortization",
  ];
  const daAggregateDetails = daAggregateConcepts
    .map(concept => ttmDetail(facts(companyFacts, ["us-gaap"], [concept], "USD")))
    .filter((detail): detail is NonNullable<TtmDetail> => Boolean(detail));
  const daAggregateDetail = daAggregateDetails
    .sort((a, b) => String(b.end).localeCompare(String(a.end)) || String(b.filed).localeCompare(String(a.filed)))[0] || null;
  const daComponentDetails = [
    ttmDetail(facts(companyFacts, ["us-gaap"], ["Depreciation", "DepreciationExpense"], "USD")),
    ttmDetail(facts(companyFacts, ["us-gaap"], ["AmortizationOfIntangibleAssets"], "USD")),
  ].filter((detail): detail is NonNullable<TtmDetail> => Boolean(detail));
  // Issuers use both the property/plant/equipment tag and the broader
  // productive-assets tag for capital expenditure.  Pick the newest valid
  // TTM/YTD-derived detail instead of treating either label as universal.
  const capexDetails = [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
  ]
    .map(concept => ttmDetail(facts(companyFacts, ["us-gaap"], [concept], "USD")))
    .filter((detail): detail is NonNullable<TtmDetail> => Boolean(detail));
  const capexDetail = capexDetails
    .sort((a, b) => String(b.end).localeCompare(String(a.end)) || String(b.filed).localeCompare(String(a.filed)))[0] || null;
  const revenueRows = facts(companyFacts, ["us-gaap"], ["RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "Revenues"], "USD");
  const ebitDetail = ttmDetail(ebitRows);
  const taxDetail = ttmDetail(taxRows);
  const pretaxDetail = ttmDetail(pretaxRows);
  const daComponentsDetail = sumTtmDetails(daComponentDetails);
  // Some issuers publish an old aggregate concept in Company Facts while
  // their current filing only has component facts.  Never let that stale
  // aggregate hide a newer component sum.
  const daDetail = daAggregateDetail && (!daComponentsDetail || daAggregateDetail.end > daComponentsDetail.end)
    ? daAggregateDetail
    : daComponentsDetail;
  const revenueDetail = ttmDetail(revenueRows);
  const ebit = ebitDetail?.value ?? null;
  const tax = taxDetail?.value ?? null;
  const pretax = pretaxDetail?.value ?? null;
  const da = daDetail?.value ?? null;
  const capex = capexDetail?.value ?? null;
  const cashRows = facts(companyFacts, ["us-gaap"], ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], "USD");
  const cash = latest(cashRows);
  const debt = (latest(facts(companyFacts, ["us-gaap"], ["LongTermDebtCurrent", "DebtCurrent"], "USD")) || 0) + (latest(facts(companyFacts, ["us-gaap"], ["LongTermDebtNoncurrent", "LongTermDebt"], "USD")) || 0);
  const sharesRows = facts(companyFacts, ["dei", "us-gaap"], ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"], "shares");
  const sharesDetail = latestDetail(sharesRows);
  const shares = sharesDetail?.value ?? null;
  const revenue = revenueDetail?.value ?? null;
  const [assetsCurrent, assetsPrevious] = latestTwo(facts(companyFacts, ["us-gaap"], ["AssetsCurrent"], "USD"));
  const [liabilitiesCurrent, liabilitiesPrevious] = latestTwo(facts(companyFacts, ["us-gaap"], ["LiabilitiesCurrent"], "USD"));
  const [cashCurrent, cashPrevious] = latestTwo(facts(companyFacts, ["us-gaap"], ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], "USD"));
  const [shortDebtCurrent, shortDebtPrevious] = latestTwo(facts(companyFacts, ["us-gaap"], ["ShortTermBorrowings", "LongTermDebtCurrent"], "USD"));
  const taxRate = pretax && pretax > 0 && tax != null ? Math.max(0, Math.min(0.5, tax / pretax)) : 0.21;
  const deltaNwc = assetsCurrent != null && liabilitiesCurrent != null && assetsPrevious != null && liabilitiesPrevious != null && cashCurrent != null && cashPrevious != null
    ? ((assetsCurrent - cashCurrent) - (liabilitiesCurrent - (shortDebtCurrent || 0))) - ((assetsPrevious - cashPrevious) - (liabilitiesPrevious - (shortDebtPrevious || 0)))
    : null;
  const missing = [ebit == null && "EBIT", da == null && "D&A", capex == null && "Capex", deltaNwc == null && "ΔNWC", cash == null && "現金", shares == null && "流通股數"].filter(Boolean);
  const asOf = [ebitDetail?.end, daDetail?.end, capexDetail?.end, latestDetail(facts(companyFacts, ["us-gaap"], ["AssetsCurrent"], "USD"))?.end].filter(Boolean).sort().at(-1) || null;
  const filedAsOf = [ebitDetail?.filed, daDetail?.filed, capexDetail?.filed, sharesDetail?.filed].filter(Boolean).sort().at(-1) || null;
  if (missing.length) return { unsupported: true, reason: `SEC 財報缺少必要欄位：${missing.join('、')}`, currency: "USD", asOf, calculationVersion: CALCULATION_VERSION, dataQuality: { periodBasis: "TTM（近四季）", sharesBasis: "SEC 流通股數（拆股後）", warnings: [filedAsOf ? `最後申報日 ${filedAsOf}` : "缺少申報日期"] } };
  if (!Number.isFinite(Number(ebit) * (1 - taxRate) + Math.abs(Number(da)) - Math.abs(Number(capex)) - Number(deltaNwc))) return { unsupported: true, reason: "SEC 財報數值無法組成有效 FCFF。", currency: "USD", asOf, calculationVersion: CALCULATION_VERSION };
  const ebitValue = Number(ebit);
  const daValue = Number(da);
  const capexValue = Number(capex);
  const cashValue = Number(cash);
  const sharesValue = Number(shares);
  const baseFcf = ebitValue * (1 - taxRate) + Math.abs(daValue) - Math.abs(capexValue) - Number(deltaNwc);
  const warnings = ["股權價值以 SEC 拆股後流通股數除算；不會額外除以 10。"];
  if (daDetail?.basis.includes("拆分欄位合計")) warnings.push("D&A 由 SEC Company Facts 的折舊與無形資產攤銷標準欄位合計。");
  return { symbol, marketType: "US", companyName: match.title || symbol, source: "SEC Company Facts", asOf, currency: "USD", calculationVersion: CALCULATION_VERSION, dataQuality: { periodBasis: [ebitDetail?.basis, daDetail?.basis, capexDetail?.basis].some(item => item?.includes("最新完整年度")) ? "最新完整年度（部分欄位財報不足四季）" : "TTM（近四季）", sharesBasis: "SEC EntityCommonStockSharesOutstanding（拆股後股數，單位：股）", units: "USD", filedAsOf, warnings }, fundamentals: { baseFcf, ebit: ebitValue, taxRate: taxRate * 100, da: Math.abs(daValue), capex: Math.abs(capexValue), deltaNwc: Number(deltaNwc), cash: cashValue, debt, shares: sharesValue, revenue } };
}

async function tw(symbol: string) {
  const token = Deno.env.get("FINMIND_API_TOKEN") || "";
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const query = (dataset: string) => fetchJson(`${FINMIND}?${new URLSearchParams({ dataset, data_id: symbol, start_date: dateBefore(900) })}`, headers);
  // TaiwanStockInfo is a bulk catalogue; passing data_id returns an empty
  // list on FinMind, so query it separately for industry/ETF filtering.
  const infoQuery = () => fetchJson(`${FINMIND}?${new URLSearchParams({ dataset: "TaiwanStockInfo" })}`, headers);
  const [income, cashflow, balance, info] = await Promise.all([query("TaiwanStockFinancialStatements"), query("TaiwanStockCashFlowsStatement"), query("TaiwanStockBalanceSheet"), infoQuery().catch(() => ({ data: [] }))]);
  const companyInfo = (info.data || []).find((row: Record<string, unknown>) => String(row.stock_id || row.data_id || "") === symbol);
  const industry = String(companyInfo?.industry_category || companyInfo?.industry || companyInfo?.industry_category_name || "");
  const securityType = String(companyInfo?.type || companyInfo?.stock_type || companyInfo?.category || "");
  if (/銀行|金融|保險|證券|金控/.test(industry) || /ETF|指數|受益/.test(`${industry}${securityType}`)) return { unsupported: true, reason: /ETF|指數|受益/.test(`${industry}${securityType}`) ? "ETF／指數型商品不適用單一公司 FCFF DCF。" : "金融業不適用一般 FCFF DCF，建議使用 DDM、P/B 或剩餘收益模型。", currency: "TWD", calculationVersion: CALCULATION_VERSION };
  const rows = [...(income.data || []), ...(cashflow.data || []), ...(balance.data || [])];
  const findRows = (names: string[]) => rows.filter((row: Record<string, unknown>) => names.includes(String(row.type || row.item || "")) && number(row.value) != null).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const uniqueRows = (names: string[]) => {
    const byDate = new Map<string, Record<string, unknown>>();
    for (const row of findRows(names)) byDate.set(String(row.date), row);
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  };
  const latestRow = (names: string[], offset = 0) => uniqueRows(names).at(-(offset + 1));
  const ttmValue = (names: string[]) => {
    const series = uniqueRows(names);
    const recent = series.slice(-4);
    return recent.length >= 4 ? recent.reduce((sum, row) => sum + Number(row.value), 0) : null;
  };
  const latestValue = (names: string[]) => number(latestRow(names)?.value);
  // FinMind fundamental values are reported in actual TWD (not thousands).
  // Income/cash-flow series are quarterly; summing four periods creates TTM.
  const ebit = ttmValue(["OperatingIncome", "營業利益"]);
  const da = ttmValue(["Depreciation", "DepreciationExpense", "DepreciationAndAmortization", "折舊費用"]);
  const capex = ttmValue(["PropertyAndPlantAndEquipment", "取得不動產、廠房及設備"]);
  const cash = latestValue(["CashAndCashEquivalents", "CashAndCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "現金及約當現金"]);
  const debt = (latestValue(["CurrentDebt", "ShortTermLoans", "ShortTermBorrowings", "短期借款"]) || 0) + (latestValue(["LongTermDebt", "LongTermBorrowings", "LongTermLoans", "LongTermLiabilitiesDueWithinOneYear", "長期借款"]) || 0);
  const pretax = ttmValue(["NetIncomeBeforeTax", "IncomeBeforeTax", "稅前淨利", "本期稅前淨利（淨損）"]);
  const taxExpense = ttmValue(["IncomeTaxExpense", "IncomeTax", "所得稅費用"]);
  let shares = null;
  try {
    const [listed, otc] = await Promise.all([
      fetchJson("https://openapi.twse.com.tw/v1/opendata/t187ap03_L"),
      fetchJson("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O"),
    ]);
    const listedRow = (listed || []).find((row: Record<string, unknown>) => String(row["公司代號"] || "").trim() === symbol);
    const otcRow = (otc || []).find((row: Record<string, unknown>) => String(row.SecuritiesCompanyCode || "").trim() === symbol);
    shares = number(listedRow?.["已發行普通股數或TDR原股發行股數"] || otcRow?.IssueShares || otcRow?.["已發行普通股數"]);
  } catch { shares = null; }
  const currentAssets = latestRow(["CurrentAssets", "流動資產"]);
  const priorAssets = latestRow(["CurrentAssets", "流動資產"], 1);
  const currentLiabilities = latestRow(["CurrentLiabilities", "流動負債"]);
  const priorLiabilities = latestRow(["CurrentLiabilities", "流動負債"], 1);
  const currentCash = latestRow(["CashAndCashEquivalents", "現金及約當現金"]);
  const priorCash = latestRow(["CashAndCashEquivalents", "現金及約當現金"], 1);
  const currentShortDebt = latestRow(["CurrentDebt", "ShortTermLoans", "短期借款"]);
  const priorShortDebt = latestRow(["CurrentDebt", "ShortTermLoans", "短期借款"], 1);
  const deltaNwc = currentAssets && priorAssets && currentLiabilities && priorLiabilities && currentCash && priorCash
    ? ((Number(currentAssets.value) - Number(currentCash.value)) - (Number(currentLiabilities.value) - Number(currentShortDebt?.value || 0))) - ((Number(priorAssets.value) - Number(priorCash.value)) - (Number(priorLiabilities.value) - Number(priorShortDebt?.value || 0)))
    : null;
  const missing = [ebit == null && "EBIT（近四季）", da == null && "D&A（近四季）", capex == null && "Capex（近四季）", deltaNwc == null && "ΔNWC", cash == null && "現金", shares == null && "流通股數"].filter(Boolean);
  const asOf = rows.map(row => String(row.date || "")).filter(Boolean).sort().at(-1) || null;
  if (missing.length) return { unsupported: true, reason: `台股財報缺少必要欄位：${missing.join('、')}`, currency: "TWD", asOf, calculationVersion: CALCULATION_VERSION, dataQuality: { periodBasis: "TTM（近四季）", sharesBasis: "TWSE／TPEX 已發行股數（單位：股）", units: "TWD", warnings: ["FinMind 財報資料不足四季或欄位名稱未對應。"] } };
  const taxRate = pretax != null && pretax > 0 && taxExpense != null ? Math.max(0, Math.min(0.5, taxExpense / pretax)) * 100 : 20;
  const baseFcf = Number(ebit) * (1 - taxRate / 100) + Math.abs(Number(da)) - Math.abs(Number(capex)) - Number(deltaNwc);
  return { symbol, marketType: "TW", source: "FinMind 臺灣財報", asOf, currency: "TWD", calculationVersion: CALCULATION_VERSION, dataQuality: { periodBasis: "TTM（近四季）", sharesBasis: "TWSE／TPEX 已發行股數（單位：股）", units: "TWD（FinMind 原始數值）", warnings: ["台股不額外套用拆股倍率；股數直接採官方已發行股數。", ...(pretax == null || taxExpense == null ? ["財報缺少稅前淨利或所得稅，稅率採 20% 預設。"] : [])] }, fundamentals: { baseFcf, ebit: Number(ebit), taxRate, da: Math.abs(Number(da)), capex: Math.abs(Number(capex)), deltaNwc, cash: Number(cash), debt, shares } };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!await auth(request)) return json({ error: "Unauthorized" }, 401);
    const { symbol, marketType, forceRefresh = false } = await request.json();
    const safeSymbol = String(symbol || "").trim().toUpperCase();
    const market = String(marketType || (/^\d+$/.test(safeSymbol) ? "TW" : "US")).toUpperCase();
    if (!/^[A-Z0-9.-]{1,20}$/.test(safeSymbol) || !["TW", "US"].includes(market)) return json({ error: "DCF 僅支援台股與美股個股" }, 400);
    if (!forceRefresh) { const hit = await cached(market, safeSymbol).catch(() => null); if (hit) return json({ ...hit, cached: true }); }
    const result = market === "TW" ? await tw(safeSymbol) : await us(safeSymbol);
    await saveCache(market, safeSymbol, result).catch(() => undefined);
    return json(result);
  } catch (error) { console.error("dcf-fundamentals", error); return json({ error: error instanceof Error ? error.message : "無法取得 DCF 財報資料" }, 502); }
});
