import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.1";
import { analyzeTechnicalData as analyzeSharedTechnicalData } from "./technicalAnalysis.shared.js";

type PriceRow = { time: string; open: number; high: number; low: number; close: number; volume: number };
type InstitutionalRow = { time: string; foreign: number; trust: number; dealerSelf: number; dealerHedging: number };
type MarketData = { rows: PriceRow[]; institutional: InstitutionalRow[]; benchmarkRows?: PriceRow[]; relativeStrengthRows?: PriceRow[]; relativeStrengthBenchmark?: string; name?: string };
type Preference = {
  user_id: string; enabled: boolean; schedule_frequency: "hourly" | "daily"; daily_hour: number;
  timezone: string; email_enabled: boolean; notification_email: string | null;
  line_enabled: boolean; line_user_id: string | null; include_holdings: boolean;
  include_watchlist: boolean; markets: string[]; strategies: string[];
  signal_statuses: string[]; signal_directions: string[]; strategy_settings: Record<string, unknown> | null;
  max_symbols: number; last_notification_run_at: string | null;
};
type Target = { symbol: string; market: string; name: string; holding: boolean; watchlist: boolean };
type FlowConfirmation = {
  available: boolean; passed: boolean; sourceLabel: string; label: string; asOf?: string;
  days?: number; net?: number; sameDirectionDays?: number; cmf20?: number; obvChange?: number;
};
type Signal = {
  strategy: string; direction: "bullish" | "bearish"; status: "confirmed" | "watch"; reason: string;
  invalidationLevel?: number;
  flow?: FlowConfirmation;
  route?: "breakout" | "pullback" | null;
  gates?: Record<string, { passed?: boolean; label?: string }>;
  risk?: { entryPrice?: number; atr14?: number; initialStop?: number; trailingStop?: number | null; effectiveStop?: number };
  eventType?: "entry" | "exit";
};
type AlertItem = Target & {
  close: number;
  candleDate: string;
  signal: Signal;
  isIntraday?: boolean;
  quoteTime?: string;
};
type ScanDiagnostic = {
  symbol: string;
  market: string;
  status: "matched" | "no_match" | "failed";
  alerts: number;
  reason?: string;
};
type ClientIntradayCandidate = {
  symbol?: unknown; market?: unknown; strategy?: unknown; direction?: unknown;
  candleDate?: unknown; invalidationLevel?: unknown;
};
type IntradayState = { id: string; user_id: string; symbol: string; market: string; name: string; strategy: string; direction: "bullish" | "bearish"; candle_date: string; invalidation_level: number; status: "active" | "risk" | "recovered" | "invalidated"; last_price: number | null; last_event_at: string | null };
type HybridPosition = {
  id: string; user_id: string; symbol: string; market: string; name: string;
  entry_date: string; entry_price: number; entry_atr: number; highest_price: number;
  initial_stop: number; trailing_stop: number; effective_stop: number;
  status: "active" | "risk" | "recovered" | "exited" | "cancelled";
  last_price: number | null; last_event_at: string | null;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-line-signature, x-signal-cron-secret",
};
const STRATEGY_NAMES: Record<string, string> = {
  hybrid: "混合策略",
  candlestick: "K 線型態",
  divergence: "MACD 背離", rsiDivergence: "RSI 背離", kdDivergence: "KD 背離", pullback: "趨勢回檔", breakout: "放量突破",
  rsi: "RSI5／RSI10 交叉", boundary: "雙軌邊界", smc: "SMC", institutional: "法人籌碼／資金動能",
  "pattern-double-top-bottom": "雙底／雙頂", "pattern-head-shoulders": "頭肩底／頭肩頂",
  "pattern-triangle-flag": "三角收斂／旗型", "pattern-wedge": "楔型突破", "pattern-range": "矩形區間突破", "pattern-cup-handle": "杯柄型",
  "trend-ma-cross": "均線交叉／多空排列", "trend-donchian": "Donchian 通道突破", "trend-adx": "ADX 趨勢濾網",
  "trend-ichimoku": "一目均衡表雲層突破", "trend-supertrend": "Supertrend 趨勢跟隨",
  "indicator-macd-cross": "MACD 黃金／死亡交叉", "indicator-kd-cross": "KD／Stochastic 交叉",
  "indicator-bollinger-squeeze": "TTM Squeeze／布林波動擠壓", "indicator-bollinger-reversion": "布林帶均值回歸", "indicator-rsi-regime": "RSI 趨勢區間",
  "price-sr-flip": "支撐／阻力互換", "price-bos-choch": "BOS／CHoCH 結構反轉", "price-liquidity-sweep": "流動性獵取",
  "price-order-block": "Order Block 回踩", "price-fvg-retest": "FVG／失衡回補", "price-candlestick": "Pin Bar／吞噬 K",
  "volume-vwap": "VWAP 回踩／均值回歸", "volume-breakout": "成交量突破確認", "volume-obv-divergence": "OBV 背離",
  "volume-mfi-cmf": "MFI／CMF 資金流", "volume-profile": "Volume Profile POC／價值區", "volume-wyckoff": "威科夫吸籌／派發",
  "stats-zscore": "Z-Score 均值回歸", "stats-pairs": "配對交易／價差回歸", "stats-momentum-ranking": "動能排名",
  "stats-atr-breakout": "ATR 波動突破", "stats-volatility-contraction": "波動率收縮／擴張",
  "price-sr-touch": "接近支撐／壓力",
};
const MARKET_NAMES: Record<string, string> = { TW: "台股", US: "美股", CRYPTO: "加密貨幣" };
const strategyName = (strategy: string, market = "") => strategy === "institutional"
  ? (market === "TW" ? "法人籌碼" : "資金動能")
  : (STRATEGY_NAMES[strategy] || strategy);
const MARKET_ORDER = ["TW", "US", "CRYPTO"];
const CRYPTO_NAMES: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ethereum", USDT: "Tether", BNB: "BNB", SOL: "Solana", XRP: "XRP",
  USDC: "USD Coin", DOGE: "Dogecoin", ADA: "Cardano", AVAX: "Avalanche",
};
const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, "Content-Type": "application/json" },
});

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor; cursor += 1;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

async function fetchJson(url: string, options: RequestInit = {}, timeoutMs = 15_000) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(options.headers);
      // Yahoo throttles anonymous/default-runtime requests aggressively. A
      // stable application User-Agent keeps US daily and intraday data from
      // being silently dropped by the notification scan.
      if (!headers.has("User-Agent")) headers.set("User-Agent", "WealthTracker/1.0");
      const response = await fetch(url, { ...options, headers, signal: controller.signal });
      if (response.ok) return await response.json();
      const detail = (await response.text()).slice(0, 300);
      const error = new Error(`HTTP ${response.status}: ${detail}`);
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 2) await sleep(500 * (attempt + 1));
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function base64(bytes: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function validLineSignature(body: string, signature: string, secret: string) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = base64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}

function ema(values: number[], period: number) {
  const multiplier = 2 / (period + 1);
  let previous = values[0] || 0;
  return values.map((value, index) => previous = index ? value * multiplier + previous * (1 - multiplier) : value);
}

function rsi(values: number[], period = 14) {
  const output = new Array(values.length).fill(null) as Array<number | null>;
  if (values.length <= period) return output;
  let gains = 0; let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0); losses += Math.max(-change, 0);
  }
  let gain = gains / period; let loss = losses / period;
  output[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    output[index] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return output;
}

function stochastic(rows: PriceRow[], period = 9) {
  let k = 50; let d = 50; let previousK = 50; let previousD = 50;
  rows.forEach((row, index) => {
    if (index < period - 1) return;
    const window = rows.slice(index - period + 1, index + 1);
    const low = Math.min(...window.map(item => item.low));
    const high = Math.max(...window.map(item => item.high));
    const raw = high > low ? ((row.close - low) / (high - low)) * 100 : 50;
    previousK = k; previousD = d;
    k = k * 2 / 3 + raw / 3; d = d * 2 / 3 + k / 3;
  });
  return { k, d, previousK, previousD };
}

function pivots(values: number[], kind: "low" | "high", radius = 3) {
  const result: number[] = [];
  for (let index = radius; index < values.length - radius; index += 1) {
    const window = values.slice(index - radius, index + radius + 1);
    const extreme = kind === "low" ? Math.min(...window) : Math.max(...window);
    if (values[index] === extreme && window.filter(value => value === extreme).length === 1) result.push(index);
  }
  return result;
}

type DivergenceCandidate = {
  type: "bullish" | "bearish"; currentIndex: number; price: number; neckline: number;
  status: "confirmed" | "pending" | "invalidated" | "expired" | "stale";
};

function activeDivergenceForWindow(rows: PriceRow[], macd: number[], histogram: number[], windowSize: number) {
  const start = Math.max(0, rows.length - windowSize);
  const windowRows = rows.slice(start);
  const candidates: DivergenceCandidate[] = [];
  const resolve = (type: "bullish" | "bearish", previous: number, current: number) => {
    const bullish = type === "bullish";
    const price = bullish ? rows[current].low : rows[current].high;
    const neckline = bullish
      ? Math.max(...rows.slice(previous, current + 1).map(row => row.high))
      : Math.min(...rows.slice(previous, current + 1).map(row => row.low));
    const detectedIndex = Math.min(rows.length - 1, current + 3);
    const expiryIndex = Math.min(rows.length - 1, current + 40);
    let status: DivergenceCandidate["status"] = "pending";
    let confirmationIndex = -1;
    for (let index = current + 1; index <= expiryIndex; index += 1) {
      const invalidated = bullish ? rows[index].low < price * 0.995 : rows[index].high > price * 1.005;
      if (invalidated) { status = "invalidated"; break; }
      const ma20AtIndex = index >= 19 ? average(rows.slice(index - 19, index + 1).map(row => row.close)) : NaN;
      const structure = bullish ? rows[index].close > neckline * 1.001 : rows[index].close < neckline * 0.999;
      const momentum = bullish ? histogram[index] > 0 : histogram[index] < 0;
      const trend = Number.isFinite(ma20AtIndex) && (bullish ? rows[index].close > ma20AtIndex : rows[index].close < ma20AtIndex);
      if (index >= detectedIndex && structure && momentum && trend) {
        status = "confirmed";
        confirmationIndex = index;
        break;
      }
    }
    if (status === "pending" && rows.length - 1 > current + 40) status = "expired";
    if (status === "confirmed") {
      const activeUntil = Math.min(rows.length - 1, confirmationIndex + 20);
      for (let index = confirmationIndex + 1; index <= activeUntil; index += 1) {
        const lost = bullish ? rows[index].close < neckline * 0.995 : rows[index].close > neckline * 1.005;
        if (lost) { status = "invalidated"; break; }
      }
      if (status === "confirmed" && rows.length - 1 > confirmationIndex + 20) status = "stale";
    }
    candidates.push({ type, currentIndex: current, price, neckline, status });
  };
  const compare = (indexes: number[], type: "bullish" | "bearish") => {
    for (let cursor = 1; cursor < indexes.length; cursor += 1) {
      const previous = indexes[cursor - 1] + start;
      const current = indexes[cursor] + start;
      if (current - previous < 5) continue;
      if (type === "bullish" && rows[current].low < rows[previous].low * 0.995 && macd[current] > macd[previous]) resolve(type, previous, current);
      if (type === "bearish" && rows[current].high > rows[previous].high * 1.005 && macd[current] < macd[previous]) resolve(type, previous, current);
    }
  };
  compare(pivots(windowRows.map(row => row.low), "low"), "bullish");
  compare(pivots(windowRows.map(row => row.high), "high"), "bearish");
  return candidates
    .filter(item => item.status === "confirmed" || item.status === "pending")
    .sort((a, b) => a.currentIndex - b.currentIndex)
    .at(-1) || null;
}

function institutionalConfirmation(rows: PriceRow[], institutional: InstitutionalRow[], direction: "bullish" | "bearish") {
  const candleDate = rows.at(-1)?.time;
  const flows = institutional
    .filter(item => item.time && (!candleDate || item.time <= candleDate))
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(-5);
  if (!flows.length) return { available: false, passed: false, sourceLabel: "法人籌碼", label: "法人資料待更新" };
  const daily = flows.map(item => number(item.foreign) + number(item.trust));
  const net = daily.reduce((sum, value) => sum + value, 0);
  const sameDirectionDays = daily.filter(value => direction === "bullish" ? value > 0 : value < 0).length;
  const passed = direction === "bullish" ? net > 0 && sameDirectionDays >= 3 : net < 0 && sameDirectionDays >= 3;
  return {
    available: true,
    passed,
    sourceLabel: "法人籌碼",
    asOf: flows.at(-1)?.time,
    days: flows.length,
    net,
    sameDirectionDays,
    label: passed
      ? `外資＋投信近 ${flows.length} 日淨額 ${net.toLocaleString("zh-TW")} 股，${sameDirectionDays} 日與技術方向同向`
      : `外資＋投信近 ${flows.length} 日淨額 ${net.toLocaleString("zh-TW")} 股，僅 ${sameDirectionDays} 日與技術方向同向`,
  };
}

function volumeFlowConfirmation(rows: PriceRow[], direction: "bullish" | "bearish", market: string): FlowConfirmation {
  if (rows.length < 21) return { available: false, passed: false, sourceLabel: "量價資金動能", label: "量價資料不足" };
  const window = rows.slice(-20);
  let moneyFlowVolume = 0;
  let totalVolume = 0;
  for (const row of window) {
    const spread = row.high - row.low;
    const multiplier = spread > 0 ? ((row.close - row.low) - (row.high - row.close)) / spread : 0;
    moneyFlowVolume += multiplier * row.volume;
    totalVolume += row.volume;
  }
  const cmf20 = totalVolume > 0 ? moneyFlowVolume / totalVolume : 0;
  const recent = rows.slice(-6);
  let obvChange = 0;
  for (let index = 1; index < recent.length; index += 1) {
    if (recent[index].close > recent[index - 1].close) obvChange += recent[index].volume;
    else if (recent[index].close < recent[index - 1].close) obvChange -= recent[index].volume;
  }
  const passed = direction === "bullish" ? cmf20 > 0 && obvChange > 0 : cmf20 < 0 && obvChange < 0;
  const directionLabel = direction === "bullish" ? "偏多" : "偏空";
  const obvLabel = obvChange > 0 ? "上升" : obvChange < 0 ? "下降" : "持平";
  return {
    available: true,
    passed,
    sourceLabel: market === "CRYPTO" ? "鏈外量價資金動能" : "量價資金動能",
    asOf: rows.at(-1)?.time,
    cmf20,
    obvChange,
    label: `CMF20 ${cmf20 >= 0 ? "+" : ""}${cmf20.toFixed(2)}、OBV 近 5 期${obvLabel}${passed ? `，與${directionLabel}訊號同向` : `，未與${directionLabel}訊號同向`}`,
  };
}

function analyze(rows: PriceRow[], institutional: InstitutionalRow[] = [], market = "US"): Signal[] {
  if (rows.length < 65) return [];
  const closes = rows.map(row => row.close);
  const latest = rows.at(-1)!; const previous = rows.at(-2)!;
  const ma20 = average(closes.slice(-20)); const ma60 = average(closes.slice(-60));
  const previousMa20 = average(closes.slice(-21, -1));
  const averageVolume = average(rows.slice(-21, -1).map(row => row.volume));
  const volumeRatio = averageVolume ? latest.volume / averageVolume : 0;
  const fast = ema(closes, 12); const slow = ema(closes, 26);
  const macd = fast.map((value, index) => value - slow[index]);
  const macdSignal = ema(macd, 9); const histogram = macd.map((value, index) => value - macdSignal[index]);
  const rsiValues = rsi(closes); const latestRsi = rsiValues.at(-1) ?? 50; const previousRsi = rsiValues.at(-2) ?? 50;
  const kd = stochastic(rows);
  const prior20 = rows.slice(-21, -1); const prior60 = rows.slice(-61, -1);
  const high20 = Math.max(...prior20.map(row => row.high)); const low20 = Math.min(...prior20.map(row => row.low));
  const bsl = Math.max(...prior60.map(row => row.high)); const ssl = Math.min(...prior60.map(row => row.low));
  const eq = (bsl + ssl) / 2; const range = Math.max(latest.high - latest.low, latest.close * 0.002);
  const lowerWick = Math.min(latest.open, latest.close) - latest.low;
  const upperWick = latest.high - Math.max(latest.open, latest.close);
  const body = Math.abs(latest.close - latest.open);
  const trueRanges = rows.slice(-14).map((row, index, source) => index
    ? Math.max(row.high - row.low, Math.abs(row.high - source[index - 1].close), Math.abs(row.low - source[index - 1].close))
    : row.high - row.low);
  const atr = average(trueRanges);
  const signals: Signal[] = [];
  const add = (strategy: string, direction: "bullish" | "bearish", status: "confirmed" | "watch", reason: string, invalidationLevel?: number) => signals.push({ strategy, direction, status, reason, invalidationLevel });

  // Match the App card: prefer the 3-month trigger (65 bars), otherwise use
  // the 6-month setup (130 bars). A confirmed 6-month setup is still a watch
  // until the 3-month trigger confirms it.
  const mediumDivergence = activeDivergenceForWindow(rows, macd, histogram, 130);
  const shortDivergence = activeDivergenceForWindow(rows, macd, histogram, 65);
  const divergenceConflict = mediumDivergence && shortDivergence && mediumDivergence.type !== shortDivergence.type;
  const selectedDivergence = divergenceConflict ? null : shortDivergence || mediumDivergence;
  if (selectedDivergence) {
    const period = shortDivergence ? "3 個月" : "6 個月";
    const confirmed = Boolean(shortDivergence && shortDivergence.status === "confirmed");
    add(
      "divergence",
      selectedDivergence.type,
      confirmed ? "confirmed" : "watch",
      confirmed
        ? `${period} MACD 背離已突破確認線 ${selectedDivergence.neckline.toFixed(2)}`
        : `${period}已出現${selectedDivergence.type === "bullish" ? "偏多" : "偏空"}背離型態，等待 3 個月確認線、MACD 與 MA20 條件`,
      selectedDivergence.price,
    );
  }

  if (ma20 > ma60 && latest.close > ma60 && Math.abs(latest.low - ma20) / ma20 <= 0.03) {
    add("pullback", "bullish", latest.close > ma20 && latest.close > previous.close ? "confirmed" : "watch", `多頭均線回測 MA20 ${ma20.toFixed(2)}`, ma20);
  } else if (ma20 < ma60 && latest.close < ma60 && Math.abs(latest.high - ma20) / ma20 <= 0.03) {
    add("pullback", "bearish", latest.close < ma20 && latest.close < previous.close ? "confirmed" : "watch", `空頭均線反彈至 MA20 ${ma20.toFixed(2)}`, ma20);
  }

  if (latest.close > high20 * 1.001) add("breakout", "bullish", volumeRatio >= 1.5 ? "confirmed" : "watch", `突破 20 日高點，量比 ${volumeRatio.toFixed(1)}x`, high20);
  else if (latest.close < low20 * 0.999) add("breakout", "bearish", volumeRatio >= 1.5 ? "confirmed" : "watch", `跌破 20 日低點，量比 ${volumeRatio.toFixed(1)}x`, low20);
  else if ((high20 - latest.close) / latest.close < 0.02) add("breakout", "bullish", "watch", `距 20 日高點僅 ${(((high20 - latest.close) / latest.close) * 100).toFixed(1)}%`);
  else if ((latest.close - low20) / latest.close < 0.02) add("breakout", "bearish", "watch", `距 20 日低點僅 ${(((latest.close - low20) / latest.close) * 100).toFixed(1)}%`);

  if (previousRsi < 30 && latestRsi >= 30 && latest.close <= ssl * 1.04) add("rsi", "bullish", "confirmed", `RSI ${latestRsi.toFixed(1)} 站回 30 且靠近支撐`, ssl);
  else if (previousRsi > 70 && latestRsi <= 70 && latest.close >= bsl * 0.96) add("rsi", "bearish", "confirmed", `RSI ${latestRsi.toFixed(1)} 跌回 70 且靠近壓力`, bsl);
  else if (latestRsi <= 35 && latest.close <= ssl * 1.05) add("rsi", "bullish", "watch", `RSI ${latestRsi.toFixed(1)} 接近超賣區`);
  else if (latestRsi >= 65 && latest.close >= bsl * 0.95) add("rsi", "bearish", "watch", `RSI ${latestRsi.toFixed(1)} 接近超買區`);

  const lowerSweep = latest.low < ssl && latest.close > ssl && lowerWick > body * 1.5;
  const upperSweep = latest.high > bsl && latest.close < bsl && upperWick > body * 1.5;
  if (lowerSweep) add("boundary", "bullish", ((kd.previousK <= kd.previousD && kd.k > kd.d && kd.k < 30) || (histogram.at(-2)! <= 0 && histogram.at(-1)! > 0)) && volumeRatio >= 1.2 ? "confirmed" : "watch", `下邊界 ${ssl.toFixed(2)} 刺破收回，量比 ${volumeRatio.toFixed(1)}x`, latest.low - atr * 0.1);
  else if (upperSweep) add("boundary", "bearish", ((kd.previousK >= kd.previousD && kd.k < kd.d && kd.k > 70) || (histogram.at(-2)! >= 0 && histogram.at(-1)! < 0)) && volumeRatio >= 1.2 ? "confirmed" : "watch", `上邊界 ${bsl.toFixed(2)} 刺破收回，量比 ${volumeRatio.toFixed(1)}x`, latest.high + atr * 0.1);
  else if (latest.close > bsl) add("boundary", "bullish", volumeRatio >= 1.2 ? "confirmed" : "watch", `實體突破上邊界 ${bsl.toFixed(2)}，等待回踩`, bsl - atr * 0.5);
  else if (latest.close < ssl) add("boundary", "bearish", volumeRatio >= 1.2 ? "confirmed" : "watch", `實體跌破下邊界 ${ssl.toFixed(2)}，等待反抽`, ssl + atr * 0.5);
  else if (latest.close <= ssl + atr) add("boundary", "bullish", "watch", `接近下邊界 ${ssl.toFixed(2)}，等待刺破收回與動能確認`);
  else if (latest.close >= bsl - atr) add("boundary", "bearish", "watch", `接近上邊界 ${bsl.toFixed(2)}，等待放量突破或反轉確認`);

  const bullishChoch = latest.close > high20 && latest.close > latest.open && body >= atr * 0.8;
  const bearishChoch = latest.close < low20 && latest.close < latest.open && body >= atr * 0.8;
  if (lowerSweep && latest.close < eq) add("smc", "bullish", volumeRatio >= 1.2 ? "confirmed" : "watch", `折價區 SSL Sweep；EQ ${eq.toFixed(2)}`, latest.low - atr * 0.1);
  else if (upperSweep && latest.close > eq) add("smc", "bearish", volumeRatio >= 1.2 ? "confirmed" : "watch", `溢價區 BSL Sweep；EQ ${eq.toFixed(2)}`, latest.high + atr * 0.1);
  else if (bullishChoch) add("smc", "bullish", volumeRatio >= 1.2 ? "confirmed" : "watch", `多方 CHoCH，等待 FVG／OB 回踩；量比 ${volumeRatio.toFixed(1)}x`, low20);
  else if (bearishChoch) add("smc", "bearish", volumeRatio >= 1.2 ? "confirmed" : "watch", `空方 CHoCH，等待 FVG／OB 反抽；量比 ${volumeRatio.toFixed(1)}x`, high20);
  else {
    const noManHalfWidth = Math.max(atr * 0.25, (bsl - ssl) * 0.08);
    if (latest.close < eq - noManHalfWidth) add("smc", "bullish", "watch", `折價區觀察；等待 SSL Sweep 或 CHoCH 回踩，EQ ${eq.toFixed(2)}`);
    else if (latest.close > eq + noManHalfWidth) add("smc", "bearish", "watch", `溢價區觀察；等待 BSL Sweep 或 CHoCH 回踩，EQ ${eq.toFixed(2)}`);
  }

  return signals.map(signal => {
    const flow = market === "TW"
      ? institutionalConfirmation(rows, institutional, signal.direction)
      : volumeFlowConfirmation(rows, signal.direction, market);
    return { ...signal, flow };
  });
}

let taiwanStockNamesPromise: Promise<Map<string, string>> | null = null;
async function taiwanStockName(symbol: string, token: string) {
  if (!taiwanStockNamesPromise) {
    taiwanStockNamesPromise = (async () => {
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const payload = await fetchJson("https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo", { headers }, 20_000);
      if (payload.status !== 200) throw new Error(`FinMind TaiwanStockInfo: ${payload.msg || payload.status}`);
      const names = new Map<string, string>();
      for (const row of payload.data || []) {
        const id = text(row.stock_id).toUpperCase(); const name = text(row.stock_name);
        if (id && name) names.set(id, name);
      }
      return names;
    })().catch(error => {
      taiwanStockNamesPromise = null;
      throw error;
    });
  }
  try {
    return (await taiwanStockNamesPromise).get(symbol.toUpperCase()) || undefined;
  } catch {
    // A name lookup failure must not prevent an otherwise valid notification.
    return undefined;
  }
}

async function yahooDailyRows(symbol: string): Promise<{ rows: PriceRow[]; name?: string }> {
  const period1 = Math.floor((Date.now() - 1095 * 86400000) / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  let payload: Record<string, any> | null = null;
  let yahooError: unknown;
  for (const host of ["query1", "query2"]) {
    try {
      payload = await fetchJson(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`, { headers: { "User-Agent": "WealthTracker/1.0" } });
      break;
    } catch (error) {
      yahooError = error;
    }
  }
  if (!payload) throw yahooError instanceof Error ? yahooError : new Error("Yahoo 無行情資料");
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote) throw new Error(payload.chart?.error?.description || "Yahoo 無行情資料");
  const rows = result.timestamp.map((timestamp: number, index: number) => ({
    time: new Date(timestamp * 1000).toISOString().slice(0, 10),
    open: number(quote.open[index]), high: number(quote.high[index]), low: number(quote.low[index]),
    close: number(quote.close[index]), volume: number(quote.volume[index]),
  })).filter((row: PriceRow) => row.close > 0 && row.high > 0 && row.low > 0);
  return { rows, name: text(result.meta?.longName || result.meta?.shortName) || undefined };
}

async function marketRows(symbol: string, market: string, finmindToken: string): Promise<MarketData> {
  const normalizedMarket = market.toUpperCase();
  if (normalizedMarket === "TW") {
    const start = new Date(); start.setUTCDate(start.getUTCDate() - 1095);
    const startDate = start.toISOString().slice(0, 10);
    const priceParams = new URLSearchParams({ dataset: "TaiwanStockPrice", data_id: symbol, start_date: startDate });
    const institutionParams = new URLSearchParams({ dataset: "TaiwanStockInstitutionalInvestorsBuySell", data_id: symbol, start_date: startDate });
    const headers: Record<string, string> = finmindToken ? { Authorization: `Bearer ${finmindToken}` } : {};
    const [payload, institutions] = await Promise.all([
      fetchJson(`https://api.finmindtrade.com/api/v4/data?${priceParams}`, { headers }),
      fetchJson(`https://api.finmindtrade.com/api/v4/data?${institutionParams}`, { headers }).catch(() => ({ status: 200, data: [] })),
    ]);
    if (payload.status !== 200) throw new Error(`FinMind: ${payload.msg || payload.status}`);
    const rows = (payload.data || []).map((row: Record<string, unknown>) => ({
      time: text(row.date), open: number(row.open), high: number(row.max), low: number(row.min), close: number(row.close), volume: number(row.Trading_Volume),
    })).filter((row: PriceRow) => row.close > 0);
    const grouped = new Map<string, InstitutionalRow>();
    for (const row of institutions.data || []) {
      const time = text(row.date); if (!time) continue;
      const item = grouped.get(time) || { time, foreign: 0, trust: 0, dealerSelf: 0, dealerHedging: 0 };
      const net = number(row.buy) - number(row.sell); const name = text(row.name);
      if (name === "Foreign_Investor" || name === "Foreign_Dealer_Self") item.foreign += net;
      else if (name === "Investment_Trust") item.trust += net;
      else if (name === "Dealer_self") item.dealerSelf += net;
      else if (name === "Dealer_Hedging") item.dealerHedging += net;
      grouped.set(time, item);
    }
    return { rows, institutional: [...grouped.values()].sort((a, b) => a.time.localeCompare(b.time)), name: await taiwanStockName(symbol, finmindToken) };
  }
  if (normalizedMarket === "CRYPTO") {
    const compact = symbol.toUpperCase().replaceAll("-", "").replaceAll("/", "").replace("USD", "USDT");
    const pair = compact.endsWith("USDT") ? compact : `${compact}USDT`;
    const payload = await fetchJson(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=1d&limit=1000`);
    return { rows: (payload || []).map((row: unknown[]) => ({ time: new Date(number(row[0])).toISOString().slice(0, 10), open: number(row[1]), high: number(row[2]), low: number(row[3]), close: number(row[4]), volume: number(row[5]) })), institutional: [], name: CRYPTO_NAMES[symbol.toUpperCase().replaceAll("-", "").replaceAll("/", "").replace(/USDT$|USD$/u, "")] };
  }
  const yahoo = await yahooDailyRows(symbol.includes(".") ? symbol : symbol.toUpperCase());
  return { ...yahoo, institutional: [] };
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

function marketClock(market: string, now = new Date()) {
  const timeZone = market === "TW" ? "Asia/Taipei" : market === "US" ? "America/New_York" : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    timeZone,
  };
}

function marketIsOpen(market: string, now = new Date()) {
  if (market === "CRYPTO") return true;
  const clock = marketClock(market, now);
  if (["Sat", "Sun"].includes(clock.weekday)) return false;
  const openMinutes = market === "TW" ? 9 * 60 : 9 * 60 + 30;
  const closeMinutes = market === "TW" ? 13 * 60 + 35 : 16 * 60 + 10;
  return clock.minutes >= openMinutes && clock.minutes < closeMinutes;
}

function marketDate(timestamp: number, market: string) {
  return marketClock(market, new Date(timestamp * 1000)).date;
}

async function yahooIntradayCandle(symbol: string, market: string): Promise<{ row: PriceRow; quoteTime: string } | null> {
  const clock = marketClock(market);
  const symbols = market === "TW" && !symbol.includes(".") ? [`${symbol}.TW`, `${symbol}.TWO`] : [symbol];
  for (const candidate of symbols) {
    try {
      const payload = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(candidate)}?range=1d&interval=1m`);
      const result = payload.chart?.result?.[0];
      const quote = result?.indicators?.quote?.[0];
      const timestamps = result?.timestamp || [];
      if (!quote || !timestamps.length) continue;
      const bars: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }> = timestamps.map((timestamp: number, index: number) => ({
        timestamp,
        open: number(quote.open?.[index]), high: number(quote.high?.[index]),
        low: number(quote.low?.[index]), close: number(quote.close?.[index]),
        volume: number(quote.volume?.[index]),
      })).filter((bar: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }) => marketDate(bar.timestamp, market) === clock.date
        && bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0);
      if (!bars.length) continue;
      const last = bars.at(-1)!;
      const metaPrice = number(result?.meta?.regularMarketPrice);
      return {
        row: {
          time: clock.date,
          open: bars[0].open,
          high: Math.max(...bars.map(bar => bar.high), metaPrice),
          low: Math.min(...bars.map(bar => bar.low), metaPrice || Infinity),
          close: metaPrice > 0 ? metaPrice : last.close,
          volume: bars.reduce((total: number, bar) => total + bar.volume, 0),
        },
        quoteTime: new Date(number(result?.meta?.regularMarketTime) * 1000 || last.timestamp * 1000).toISOString(),
      };
    } catch {
      // Listed/OTC suffixes and Yahoo hosts are tried independently.
    }
  }
  return null;
}

const numericText = (value: unknown) => number(text(value).replace(/[^0-9.-]/g, ""));

function nasdaqClockMinutes(value: unknown) {
  const match = text(value).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return -1;
  let hour = number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + number(match[2]);
}

async function nasdaqIntradayCandle(symbol: string): Promise<{ row: PriceRow; quoteTime: string } | null> {
  const normalized = symbol === "^GSPC" ? "SPY" : symbol;
  const assetClasses = ["QQQ", "SPY"].includes(normalized) ? ["etf", "stocks"] : ["stocks", "etf"];
  const current = marketClock("US");
  for (const assetClass of assetClasses) {
    try {
      const payload = await fetchJson(
        `https://api.nasdaq.com/api/quote/${encodeURIComponent(normalized)}/chart?assetclass=${assetClass}`,
        { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } },
      );
      if (number(payload?.status?.rCode) !== 200 || !Array.isArray(payload?.data?.chart)) continue;
      const bars = payload.data.chart.map((point: Record<string, unknown>) => {
        const timestamp = number(point.x);
        // Nasdaq's x value is a timezone-less wall-clock epoch. Read the
        // explicit Eastern Time label instead so regular-session bars survive.
        return { timestamp, minutes: nasdaqClockMinutes((point.z as Record<string, unknown> | undefined)?.dateTime), price: number(point.y) };
      }).filter((bar: { timestamp: number; minutes: number; price: number }) => bar.minutes >= 9 * 60 + 30
        && bar.minutes <= 16 * 60 && bar.price > 0);
      if (!bars.length || !marketIsOpen("US")) return null;
      const last = bars.at(-1)!;
      return {
        row: {
          time: current.date,
          open: bars[0].price,
          high: Math.max(...bars.map((bar: { price: number }) => bar.price)),
          low: Math.min(...bars.map((bar: { price: number }) => bar.price)),
          close: last.price,
          volume: numericText(payload.data.volume),
        },
        quoteTime: new Date().toISOString(),
      };
    } catch {
      // Try the other Nasdaq asset class.
    }
  }
  return null;
}

function mergeLatestRow(rows: PriceRow[], row: PriceRow) {
  const result = [...rows];
  const index = result.findIndex(item => item.time === row.time);
  if (index >= 0) result[index] = row;
  else result.push(row);
  return result.sort((a, b) => a.time.localeCompare(b.time));
}

async function analysisSnapshot(
  rows: PriceRow[], symbol: string, market: string, includeIntraday: boolean,
  intradayCache: Map<string, Promise<{ row: PriceRow; quoteTime: string } | null>>,
) {
  const completedRows = completedDailyRows(rows, market);
  if (!includeIntraday || !marketIsOpen(market)) return { rows: completedRows, isIntraday: false, quoteTime: "" };
  if (market === "CRYPTO") {
    const latest = rows.at(-1);
    const currentDate = marketClock(market).date;
    return latest?.time === currentDate
      ? { rows: [...rows], isIntraday: true, quoteTime: new Date().toISOString() }
      : { rows: completedRows, isIntraday: false, quoteTime: "" };
  }
  const key = `${market}:${symbol}`;
  if (!intradayCache.has(key)) intradayCache.set(key, market === "US"
    ? nasdaqIntradayCandle(symbol)
    : yahooIntradayCandle(symbol, market));
  const candle = await intradayCache.get(key)!;
  return candle
    ? { rows: mergeLatestRow(completedRows, candle.row), isIntraday: true, quoteTime: candle.quoteTime }
    : { rows: completedRows, isIntraday: false, quoteTime: "" };
}

function completedDailyRows(rows: PriceRow[], market: string) {
  if (!rows.length) return rows;
  if (market === "CRYPTO") {
    const utcDate = new Date().toISOString().slice(0, 10);
    return rows.at(-1)?.time === utcDate ? rows.slice(0, -1) : rows;
  }
  const timeZone = market === "TW" ? "Asia/Taipei" : "America/New_York";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)?.value || "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const weekday = !["Sat", "Sun"].includes(get("weekday"));
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const closeMinutes = market === "TW" ? 13 * 60 + 35 : 16 * 60 + 10;
  return weekday && minutes < closeMinutes && rows.at(-1)?.time === date ? rows.slice(0, -1) : rows;
}

function isDue(preference: Preference, now = new Date()) {
  if (!preference.last_notification_run_at) return true;
  const last = new Date(preference.last_notification_run_at);
  // The hourly scan is split into minute-sized batches; compare the completed
  // hour, not elapsed minutes since the final batch at HH:09.
  if (preference.schedule_frequency === "hourly") return now.toISOString().slice(0, 13) !== last.toISOString().slice(0, 13);
  const currentLocal = localParts(now, preference.timezone); const lastLocal = localParts(last, preference.timezone);
  return currentLocal.hour >= preference.daily_hour && currentLocal.date !== lastLocal.date;
}

function normalizeMarket(value: unknown, symbol: string) {
  const market = text(value).toUpperCase();
  if (["TW", "US", "CRYPTO"].includes(market)) return market;
  return /^\d+$/.test(symbol) ? "TW" : "US";
}

async function targetsForUser(admin: ReturnType<typeof createClient>, preference: Preference): Promise<Target[]> {
  const [assetsResult, watchlistResult] = await Promise.all([
    preference.include_holdings ? admin.from("assets").select("symbol,name,market_type,current_shares").eq("user_id", preference.user_id).eq("category", "investment").gt("current_shares", 0) : Promise.resolve({ data: [], error: null }),
    preference.include_watchlist ? admin.from("watchlist").select("symbol,market_type").eq("user_id", preference.user_id) : Promise.resolve({ data: [], error: null }),
  ]);
  if (assetsResult.error) throw assetsResult.error;
  if (watchlistResult.error) throw watchlistResult.error;
  const map = new Map<string, Target>();
  for (const asset of assetsResult.data || []) {
    const symbol = text(asset.symbol).toUpperCase(); if (!symbol) continue;
    const market = normalizeMarket(asset.market_type, symbol); const key = `${market}:${symbol}`;
    map.set(key, { symbol, market, name: text(asset.name) || symbol, holding: true, watchlist: false });
  }
  for (const item of watchlistResult.data || []) {
    const symbol = text(item.symbol).toUpperCase(); if (!symbol) continue;
    const market = normalizeMarket(item.market_type, symbol); const key = `${market}:${symbol}`; const existing = map.get(key);
    map.set(key, existing ? { ...existing, watchlist: true } : { symbol, market, name: symbol, holding: false, watchlist: true });
  }
  return [...map.values()].filter(item => preference.markets.includes(item.market)).slice(0, Math.min(preference.max_symbols || 50, 75));
}

type MessageOptions = { manualTest?: boolean; markets?: string[]; includeAll?: boolean };
type SignalCardPosition = { index: number; total: number };

function testPreferenceOverrides(preference: Preference, body: Record<string, unknown>): Preference {
  const filters = body.filters && typeof body.filters === "object"
    ? body.filters as Record<string, unknown>
    : {};
  const selected = (value: unknown, allowed: string[], fallback: string[]) => {
    if (!Array.isArray(value)) return fallback;
    return [...new Set(value.map(item => text(item)).filter(item => allowed.includes(item)))];
  };
  return {
    ...preference,
    include_holdings: typeof filters.include_holdings === "boolean" ? filters.include_holdings : preference.include_holdings,
    include_watchlist: typeof filters.include_watchlist === "boolean" ? filters.include_watchlist : preference.include_watchlist,
    markets: selected(filters.markets, MARKET_ORDER, preference.markets),
    strategies: selected(filters.strategies, Object.keys(STRATEGY_NAMES), preference.strategies),
    signal_statuses: selected(filters.signal_statuses, ["confirmed", "watch"], preference.signal_statuses),
    signal_directions: selected(filters.signal_directions, ["bullish", "bearish"], preference.signal_directions),
  };
}

function alertBreakdown(alerts: AlertItem[]) {
  return Object.fromEntries(MARKET_ORDER.map(market => [market, alerts.filter(item => item.market === market).length]));
}

function sharedSignals(marketData: MarketData, market: string, symbol: string, strategySettings: Record<string, unknown> | null = null, selectedStrategies: string[] = []): Signal[] {
  const analysisRows = marketData.rows.slice(-320);
  const analysis = analyzeSharedTechnicalData(
    analysisRows,
    Math.min(260, analysisRows.length),
    {
      marketType: market,
      symbol,
      institutional: marketData.institutional,
      benchmarkRows: marketData.benchmarkRows || [],
      relativeStrengthRows: marketData.relativeStrengthRows || [],
      relativeStrengthBenchmark: marketData.relativeStrengthBenchmark || "",
      strategySettings: strategySettings || {},
      notificationStrategies: selectedStrategies,
    },
  );
  const candidates = [...(analysis?.strategies || []), ...(analysis?.hybrid ? [analysis.hybrid] : [])];
  return candidates
    .filter((strategy: Record<string, any>) => ["confirmed", "watch"].includes(strategy.status) && ["bullish", "bearish"].includes(strategy.direction))
    .map((strategy: Record<string, any>) => {
      const institutional = strategy.institutional;
      const flow: FlowConfirmation | undefined = institutional ? {
        available: Boolean(institutional.available),
        passed: Boolean(institutional.passed),
        sourceLabel: market === "TW" ? "法人籌碼" : market === "CRYPTO" ? "鏈外量價資金動能" : "量價資金動能",
        label: text(institutional.label),
        asOf: text(institutional.asOf) || marketData.rows.at(-1)?.time,
        days: number(institutional.days),
        net: number(institutional.directional),
        sameDirectionDays: strategy.direction === "bullish" ? number(institutional.positiveDays) : number(institutional.negativeDays),
      } : undefined;
      const candidateLevel = strategy.signal?.stop ?? strategy.signal?.price ?? strategy.level;
      return {
        strategy: text(strategy.key),
        direction: strategy.direction,
        status: strategy.status,
        reason: text(strategy.reason),
        invalidationLevel: Number.isFinite(Number(candidateLevel)) ? Number(candidateLevel) : undefined,
        flow,
        route: strategy.route || null,
        gates: strategy.gates,
        risk: strategy.risk,
        eventType: strategy.key === "hybrid" ? "entry" : undefined,
      } as Signal;
    });
}

async function relativeStrengthRowsForMarket(market: string, finmindToken: string, cache: Map<string, Promise<MarketData>>) {
  const benchmark = market === "TW" ? "^TWII" : market === "US" ? "QQQ" : "BTC";
  const key = `RELATIVE:${market}`;
  if (!cache.has(key)) {
    cache.set(key, market === "TW"
      ? yahooDailyRows(benchmark).then(data => ({ ...data, institutional: [] }))
      : marketRows(benchmark, market, finmindToken));
  }
  try {
    return { rows: (await cache.get(key)!).rows, benchmark: market === "TW" ? "加權指數" : benchmark };
  } catch (error) {
    console.warn("relative-strength-data", market, error);
    return { rows: [] as PriceRow[], benchmark: market === "TW" ? "加權指數" : benchmark };
  }
}

function hybridAnalysis(marketData: MarketData, market: string, symbol: string, strategySettings: Record<string, unknown> | null = null) {
  return analyzeSharedTechnicalData(
    marketData.rows,
    Math.min(260, marketData.rows.length),
    {
      marketType: market,
      symbol,
      institutional: marketData.institutional,
      benchmarkRows: marketData.benchmarkRows || [],
      relativeStrengthRows: marketData.relativeStrengthRows || [],
      relativeStrengthBenchmark: marketData.relativeStrengthBenchmark || "",
      strategySettings: strategySettings || {},
    },
  );
}

async function syncHybridPosition(
  admin: ReturnType<typeof createClient>,
  preference: Preference,
  target: Target,
  marketData: MarketData,
) {
  const analysis = hybridAnalysis(marketData, target.market, target.symbol, preference.strategy_settings);
  const hybrid = analysis?.hybrid;
  const latest = analysis?.latest;
  if (!latest) return { suppressEntry: false, exitSignal: null as Signal | null };
  const { data, error } = await admin.from("hybrid_strategy_positions")
    .select("id,user_id,symbol,market,name,entry_date,entry_price,entry_atr,highest_price,initial_stop,trailing_stop,effective_stop,status,last_price,last_event_at")
    .eq("user_id", preference.user_id).eq("market", target.market).eq("symbol", target.symbol)
    .in("status", ["active", "risk", "recovered"]).maybeSingle();
  if (error) throw error;
  const existing = data as HybridPosition | null;
  const atr14 = number(latest.atr14);
  if (existing) {
    if (!(atr14 > 0)) return { suppressEntry: true, exitSignal: null as Signal | null };
    const highestPrice = Math.max(number(existing.highest_price), number(latest.high));
    const trailingStop = Math.max(number(existing.trailing_stop), highestPrice - atr14 * 2.5);
    const effectiveStop = Math.max(number(existing.initial_stop), trailingStop);
    const exited = number(latest.close) <= effectiveStop;
    await admin.from("hybrid_strategy_positions").update(exited ? {
      highest_price: highestPrice, trailing_stop: trailingStop, effective_stop: effectiveStop,
      status: "exited", exit_date: latest.time, exit_price: latest.close,
      exit_reason: `日 K 收盤 ${number(latest.close).toFixed(2)} 跌破 ATR 停損 ${effectiveStop.toFixed(2)}`,
      last_price: latest.close, last_event_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    } : {
      highest_price: highestPrice, trailing_stop: trailingStop, effective_stop: effectiveStop,
      status: existing.status === "risk" ? "recovered" : existing.status,
      last_price: latest.close, updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
    const exitSignal: Signal | null = exited ? {
      strategy: "hybrid", direction: "bearish", status: "confirmed", eventType: "exit",
      reason: `日 K 收盤跌破 ATR 移動停損 ${effectiveStop.toFixed(2)}，原混合策略多單結束。`,
      invalidationLevel: effectiveStop,
      risk: { entryPrice: number(existing.entry_price), atr14, initialStop: number(existing.initial_stop), trailingStop, effectiveStop },
    } : null;
    return { suppressEntry: true, exitSignal };
  }
  if (hybrid?.status === "confirmed" && atr14 > 0) {
    const entryPrice = number(latest.close);
    const initialStop = entryPrice - atr14 * 2;
    const trailingStop = number(latest.high) - atr14 * 2.5;
    const effectiveStop = Math.max(initialStop, trailingStop);
    const { error: insertError } = await admin.from("hybrid_strategy_positions").insert({
      user_id: preference.user_id, symbol: target.symbol, market: target.market, name: target.name || target.symbol,
      entry_date: latest.time, entry_price: entryPrice, entry_atr: atr14, highest_price: latest.high,
      initial_stop: initialStop, trailing_stop: trailingStop, effective_stop: effectiveStop,
      status: "active", last_price: entryPrice, updated_at: new Date().toISOString(),
    });
    if (insertError) throw insertError;
  }
  return { suppressEntry: false, exitSignal: null as Signal | null };
}

async function benchmarkRowsForMarket(market: string, finmindToken: string, cache: Map<string, Promise<MarketData>>) {
  const benchmark = market === "TW" ? "^TWII" : market === "US" ? "^GSPC" : "BTC";
  const key = `BENCHMARK:${market}`;
  if (!cache.has(key)) {
    cache.set(key, market === "TW"
      ? yahooDailyRows(benchmark).then(data => ({ ...data, institutional: [] }))
      : marketRows(benchmark, market, finmindToken));
  }
  try {
    return (await cache.get(key)!).rows;
  } catch (error) {
    console.warn("benchmark-data", market, error);
    return [];
  }
}

function signalCardPosition(alerts: AlertItem[], item: AlertItem): SignalCardPosition {
  const sameSymbol = alerts.filter(candidate => candidate.market === item.market && candidate.symbol === item.symbol);
  return { index: Math.max(1, sameSymbol.indexOf(item) + 1), total: Math.max(1, sameSymbol.length) };
}

function hybridGateSummary(signal: Signal) {
  if (signal.strategy !== "hybrid" || !signal.gates) return "";
  const names: Record<string, string> = { trend: "趨勢", breakout: "突破", pullback: "回檔", volume: "量能", relativeStrength: "相對強弱" };
  return Object.entries(signal.gates).map(([key, gate]) => `${gate?.passed ? "✓" : "○"}${names[key] || key}`).join(" · ");
}

function hybridRiskSummary(signal: Signal) {
  if (signal.strategy !== "hybrid" || !signal.risk) return "";
  const risk = signal.risk;
  const route = signal.eventType === "exit" ? "ATR 出場" : signal.route === "breakout" ? "放量突破" : signal.route === "pullback" ? "趨勢回檔" : "等待路線";
  const stop = number(risk.effectiveStop || risk.initialStop);
  return `${route}${stop > 0 ? `｜ATR 停損 ${stop.toFixed(2)}` : ""}`;
}

function alertQuoteTime(item: AlertItem) {
  if (!item.quoteTime) return "";
  try {
    const timeZone = item.market === "TW" ? "Asia/Taipei" : item.market === "US" ? "America/New_York" : "UTC";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(item.quoteTime));
    const get = (type: string) => parts.find(part => part.type === type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  } catch {
    return item.quoteTime.replace("T", " ").slice(0, 16);
  }
}

function digestText(alerts: AlertItem[], { manualTest = false }: MessageOptions = {}) {
  const lines = alerts.slice(0, 20).map(item => {
    const direction = item.signal.direction === "bullish" ? "偏多／進場注意" : "偏空／出場注意";
    const status = item.isIntraday
      ? item.signal.status === "confirmed" ? "盤中暫估成立" : "盤中暫估觀察"
      : item.signal.status === "confirmed" ? "已確認" : "等待確認";
    const displayName = text(item.name) && text(item.name).toUpperCase() !== item.symbol.toUpperCase()
      ? ` ${text(item.name)}`
      : "";
    const flow = item.signal.flow
      ? `\n  ${item.signal.flow.sourceLabel}：${item.signal.flow.passed ? "✅ 同向" : item.signal.flow.available ? "○ 未同向" : "— 資料待更新"}｜${item.signal.flow.label}${item.signal.flow.asOf ? `（截至 ${item.signal.flow.asOf}）` : ""}`
      : "";
    const hybrid = hybridGateSummary(item.signal);
    const risk = hybridRiskSummary(item.signal);
    const priceLabel = item.isIntraday ? "盤中暫估" : "收盤";
    return `• ${MARKET_NAMES[item.market] || item.market}｜${item.symbol}${displayName}｜${strategyName(item.signal.strategy, item.market)}｜${direction}・${status}\n  技術依據：${item.signal.reason}（${priceLabel}截至 ${item.candleDate}，${item.close.toFixed(2)}）${hybrid ? `\n  條件：${hybrid}` : ""}${risk ? `\n  路線／風控：${risk}` : ""}${flow}`;
  });
  const extra = alerts.length > 20 ? `\n另有 ${alerts.length - 20} 筆，請回 App 查看。` : "";
  const manual = manualTest ? "【手動測試】\n這是依 App 畫面目前選擇即時掃描的測試通知，不影響正式排程與去重紀錄。\n\n" : "";
  const body = lines.length ? `${lines.join("\n\n")}${extra}` : `目前沒有符合${manualTest ? "畫面目前選擇" : "已儲存通知條件"}的訊號；正式排程此刻也不會寄送通知。`;
  return `${manual}WealthTracker 進出場訊號\n\n${body}\n\n研究訊號僅供參考，不構成投資建議，也不會自動下單。`;
}

const lineText = (value: unknown, max = 240) => {
  const output = text(value).trim();
  return output.length > max ? `${output.slice(0, Math.max(0, max - 1))}…` : output;
};

function lineSignalBubble(item: AlertItem, manualTest = false, position: SignalCardPosition = { index: 1, total: 1 }) {
  const bullish = item.signal.direction === "bullish";
  const accent = bullish ? "#0F9D87" : "#E5484D";
  const accentSoft = bullish ? "#E8F7F2" : "#FDEBEC";
  const direction = bullish ? "偏多・進場注意" : "偏空・出場注意";
  const status = item.isIntraday
    ? item.signal.status === "confirmed" ? "盤中暫估成立" : "盤中暫估觀察"
    : item.signal.status === "confirmed" ? "已確認" : "等待確認";
  const displayName = text(item.name) && text(item.name).toUpperCase() !== item.symbol.toUpperCase() ? text(item.name) : "";
  const flow = item.signal.flow;
  const flowState = flow ? (flow.passed ? "同向確認" : flow.available ? "尚未同向" : "資料待更新") : "未提供";
  return {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#172033",
      paddingAll: "18px",
      contents: [
        ...(manualTest ? [{ type: "text", text: "手動測試", size: "xs", weight: "bold", color: "#93C5FD" }] : []),
        { type: "text", text: item.isIntraday ? "盤中暫估日 K" : "正式收盤日 K", size: "xs", weight: "bold", color: item.isIntraday ? "#FBBF24" : "#94A3B8", margin: manualTest ? "sm" : "none" },
        { type: "box", layout: "horizontal", margin: manualTest ? "sm" : "none", contents: [
          { type: "text", text: lineText(item.symbol, 20), size: "xl", weight: "bold", color: "#FFFFFF", flex: 1 },
          { type: "box", layout: "vertical", backgroundColor: accent, cornerRadius: "10px", paddingAll: "7px", flex: 0, contents: [
            { type: "text", text: status, size: "xs", weight: "bold", color: "#FFFFFF", align: "center" },
          ] },
        ] },
        { type: "box", layout: "horizontal", margin: "sm", contents: [
          { type: "text", text: MARKET_NAMES[item.market] || item.market, size: "xs", weight: "bold", color: "#60A5FA", flex: 1 },
          { type: "text", text: `此標的第 ${position.index}/${position.total} 張`, size: "xs", weight: "bold", color: "#CBD5E1", align: "end", flex: 2 },
        ] },
        ...(displayName ? [{ type: "text", text: lineText(displayName, 50), size: "sm", color: "#CBD5E1", margin: "sm", wrap: true }] : []),
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#FFFFFF",
      paddingAll: "18px",
      contents: [
        { type: "text", text: direction, size: "lg", weight: "bold", color: accent },
        { type: "box", layout: "horizontal", margin: "md", contents: [
          { type: "text", text: "策略", size: "xs", color: "#64748B", flex: 2 },
          { type: "text", text: lineText(strategyName(item.signal.strategy, item.market), 30), size: "sm", weight: "bold", color: "#172033", align: "end", flex: 5, wrap: true },
        ] },
        { type: "separator", margin: "lg", color: "#E2E8F0" },
        { type: "text", text: "技術依據", size: "xs", color: "#64748B", margin: "lg" },
        { type: "text", text: lineText(item.signal.reason, 260), size: "sm", color: "#334155", margin: "sm", wrap: true },
        ...(hybridGateSummary(item.signal) ? [{ type: "text", text: lineText(hybridGateSummary(item.signal), 160), size: "xs", color: "#2563A6", margin: "md", wrap: true }] : []),
        ...(hybridRiskSummary(item.signal) ? [{ type: "text", text: lineText(hybridRiskSummary(item.signal), 120), size: "xs", weight: "bold", color: accent, margin: "sm", wrap: true }] : []),
        { type: "box", layout: "vertical", margin: "lg", paddingAll: "12px", backgroundColor: "#F8FAFC", cornerRadius: "10px", contents: [
          { type: "box", layout: "horizontal", contents: [
            { type: "text", text: item.isIntraday ? "盤中價格" : "最新收盤", size: "xs", color: "#64748B", flex: 2 },
            { type: "text", text: item.close.toFixed(2), size: "sm", weight: "bold", color: "#172033", align: "end", flex: 3 },
          ] },
          { type: "box", layout: "horizontal", margin: "sm", contents: [
            { type: "text", text: "行情日期", size: "xs", color: "#64748B", flex: 2 },
            { type: "text", text: lineText(item.candleDate, 20), size: "xs", color: "#475569", align: "end", flex: 3 },
          ] },
          ...(item.isIntraday && item.quoteTime ? [{ type: "box", layout: "horizontal", margin: "sm", contents: [
            { type: "text", text: "掃描時間", size: "xs", color: "#64748B", flex: 2 },
            { type: "text", text: lineText(alertQuoteTime(item), 20), size: "xs", color: "#475569", align: "end", flex: 3 },
          ] }] : []),
        ] },
        ...(flow ? [{ type: "box", layout: "vertical", margin: "md", paddingAll: "12px", backgroundColor: accentSoft, cornerRadius: "10px", contents: [
          { type: "box", layout: "horizontal", contents: [
            { type: "text", text: lineText(flow.sourceLabel, 20), size: "xs", color: "#64748B", flex: 2 },
            { type: "text", text: flowState, size: "xs", weight: "bold", color: flow.passed ? accent : "#B7791F", align: "end", flex: 3 },
          ] },
          { type: "text", text: lineText(flow.label, 180), size: "xs", color: "#475569", margin: "sm", wrap: true },
          ...(flow.asOf ? [{ type: "text", text: `資料截至 ${lineText(flow.asOf, 20)}`, size: "xxs", color: "#64748B", margin: "sm" }] : []),
        ] }] : []),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "14px",
      backgroundColor: "#F8FAFC",
      contents: [{ type: "text", text: "研究訊號僅供參考，不構成投資建議", size: "xxs", color: "#94A3B8", align: "center", wrap: true }],
    },
  };
}

function lineEmptyBubble(manualTest = false, market = "") {
  const marketName = MARKET_NAMES[market] || market;
  return {
    type: "bubble",
    size: "kilo",
    header: { type: "box", layout: "vertical", backgroundColor: "#172033", paddingAll: "18px", contents: [
      ...(manualTest ? [{ type: "text", text: "手動測試", size: "xs", weight: "bold", color: "#93C5FD" }] : []),
      { type: "text", text: marketName || "WealthTracker", size: "xl", weight: "bold", color: "#FFFFFF", margin: manualTest ? "sm" : "none" },
      ...(marketName ? [{ type: "text", text: "WealthTracker 市場掃描", size: "xs", color: "#93C5FD", margin: "sm" }] : []),
    ] },
    body: { type: "box", layout: "vertical", paddingAll: "20px", contents: [
      { type: "text", text: "目前沒有符合條件的訊號", size: "lg", weight: "bold", color: "#172033", wrap: true },
      { type: "text", text: `已依${manualTest ? "App 畫面目前選擇" : "你儲存的通知條件"}完成掃描。正式排程此刻不會寄送通知。`, size: "sm", color: "#64748B", margin: "md", wrap: true },
    ] },
    footer: { type: "box", layout: "vertical", paddingAll: "14px", backgroundColor: "#F8FAFC", contents: [
      { type: "text", text: "研究訊號僅供參考，不構成投資建議", size: "xxs", color: "#94A3B8", align: "center", wrap: true },
    ] },
  };
}

function roundRobinByMarket(alerts: AlertItem[], limit = 50) {
  const queues = MARKET_ORDER.map(market => alerts.filter(item => item.market === market));
  const other = alerts.filter(item => !MARKET_ORDER.includes(item.market));
  if (other.length) queues.push(other);
  const result: AlertItem[] = [];
  while (result.length < limit && queues.some(queue => queue.length)) {
    for (const queue of queues) {
      const item = queue.shift();
      if (item) result.push(item);
      if (result.length >= limit) break;
    }
  }
  return result;
}

function lineFlexMessages(alerts: AlertItem[], options: MessageOptions = {}) {
  // Keep each carousel market-specific. LINE accepts at most five message
  // objects per push and each carousel contains at most ten cards. Reserve the
  // first message for every active market before adding overflow pages, so a
  // busy market cannot hide another market's results.
  const requestedMarkets = (options.markets || []).map(market => text(market).toUpperCase()).filter(Boolean);
  const availableMarkets = [...new Set([...requestedMarkets, ...alerts.map(item => item.market)])];
  const orderedMarkets = [
    ...MARKET_ORDER.filter(market => availableMarkets.includes(market)),
    ...availableMarkets.filter(market => !MARKET_ORDER.includes(market)),
  ];
  if (!orderedMarkets.length) return [{
    type: "flex",
    altText: `${options.manualTest ? "【手動測試】" : ""}WealthTracker：目前沒有符合條件的訊號`,
    contents: lineEmptyBubble(Boolean(options.manualTest)),
  }];
  const pages = orderedMarkets.map(market => {
    const marketAlerts = alerts.filter(item => item.market === market);
    const chunks: AlertItem[][] = [];
    for (let index = 0; index < marketAlerts.length; index += 10) chunks.push(marketAlerts.slice(index, index + 10));
    return { market, chunks };
  });
  const selected: Array<{ market: string; chunk: AlertItem[]; page: number }> = [];
  for (const entry of pages) {
    const chunk = entry.chunks.shift();
    // Keep an empty market summary so users can distinguish "scanned with no
    // signal" from "the market was not scanned".
    selected.push({ market: entry.market, chunk: chunk || [], page: 1 });
  }
  while ((options.includeAll || selected.length < 5) && pages.some(entry => entry.chunks.length)) {
    for (const entry of pages) {
      const chunk = entry.chunks.shift();
      if (chunk) selected.push({ market: entry.market, chunk, page: selected.filter(item => item.market === entry.market).length + 1 });
      if (!options.includeAll && selected.length >= 5) break;
    }
  }

  const selectedPages = options.includeAll ? selected : selected.slice(0, 5);
  return selectedPages.map(({ market, chunk, page }) => {
    const marketName = MARKET_NAMES[market] || market;
    const totalPages = Math.ceil(alerts.filter(item => item.market === market).length / 10);
    const pageLabel = totalPages > 1 ? `（${page}/${totalPages}）` : "";
    return {
      type: "flex",
      altText: `${options.manualTest ? "【手動測試】" : ""}WealthTracker ${marketName}${pageLabel}：${chunk.length ? `${chunk.length} 筆訊號` : "目前無符合條件"}`.slice(0, 400),
      contents: chunk.length === 0
        ? lineEmptyBubble(Boolean(options.manualTest), market)
        : chunk.length === 1
        ? lineSignalBubble(chunk[0], Boolean(options.manualTest), signalCardPosition(alerts, chunk[0]))
        : { type: "carousel", contents: chunk.map(item => lineSignalBubble(item, Boolean(options.manualTest), signalCardPosition(alerts, item))) },
    };
  });
}

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const emailHint = (value: string) => value.replace(/^(.{2}).*(@.*)$/, "$1***$2");
type EmailOptions = { manualTest?: boolean; includeAll?: boolean };

function emailSubject(alerts: AlertItem[], { manualTest = false }: EmailOptions = {}) {
  const prefix = manualTest ? "【手動測試】" : "";
  const snapshot = alerts.some(item => item.isIntraday) ? "【盤中暫估】" : "";
  return `${prefix}${snapshot}WealthTracker：${alerts.length} 筆進出場訊號`;
}

function emailHtml(alerts: AlertItem[], { manualTest = false, includeAll = false }: EmailOptions = {}) {
  const visible = includeAll ? roundRobinByMarket(alerts, alerts.length) : roundRobinByMarket(alerts, 50);
  const sections = MARKET_ORDER.map(market => {
    const marketAlerts = visible.filter(item => item.market === market);
    if (!marketAlerts.length) return "";
    const symbolGroups = new Map<string, AlertItem[]>();
    for (const item of marketAlerts) {
      const key = `${item.market}:${item.symbol}`;
      symbolGroups.set(key, [...(symbolGroups.get(key) || []), item]);
    }
    const cards = [...symbolGroups.values()].map(items => {
      const first = items[0];
      const displayName = text(first.name) && text(first.name).toUpperCase() !== first.symbol.toUpperCase()
        ? escapeHtml(text(first.name))
        : "";
      const signals = items.map((item, index) => {
        const bullish = item.signal.direction === "bullish";
        const accent = bullish ? "#2dd4bf" : "#fb7185";
        const flow = item.signal.flow;
        const marker = flow
          ? `<div style="margin-top:8px;padding:9px 10px;border-radius:8px;background-color:#1d2633;color:#cbd5e1;font-size:12px;line-height:1.55;overflow-wrap:anywhere"><strong style="color:#e2e8f0">${escapeHtml(flow.sourceLabel)}：</strong>${flow.passed ? "✅ 同向" : flow.available ? "○ 未同向" : "— 資料待更新"}｜${escapeHtml(flow.label)}${flow.asOf ? `（截至 ${escapeHtml(flow.asOf)}）` : ""}</div>`
          : "";
        const hybridDetails = item.signal.strategy === "hybrid"
          ? `<div style="margin-top:8px;padding:9px 10px;border-radius:8px;background-color:#17263a;color:#93c5fd;font-size:12px;line-height:1.55;overflow-wrap:anywhere"><strong style="color:#bfdbfe">分層條件：</strong>${escapeHtml(hybridGateSummary(item.signal))}<br/><strong style="color:#bfdbfe">路線／風控：</strong>${escapeHtml(hybridRiskSummary(item.signal))}</div>`
          : "";
        return `<div style="margin-top:${index ? "10" : "0"}px;padding:12px;border:1px solid #334155;border-radius:10px;background-color:#101722;color:#e5edf7;overflow:hidden;word-break:break-word">
          <div style="font-size:12px;color:#94a3b8;line-height:1.45"><strong style="color:#e2e8f0">此標的第 ${index + 1}/${items.length} 張</strong> · ${escapeHtml(strategyName(item.signal.strategy, item.market))}</div>
          <div style="margin-top:5px;font-size:14px;font-weight:700;color:${accent}">${bullish ? "偏多／進場注意" : "偏空／出場注意"} · ${item.isIntraday ? item.signal.status === "confirmed" ? "盤中暫估成立" : "盤中暫估觀察" : item.signal.status === "confirmed" ? "已確認" : "等待確認"}</div>
          <div style="margin-top:7px;font-size:13px;line-height:1.6;color:#dbe4ef;overflow-wrap:anywhere"><strong style="color:#f1f5f9">技術依據：</strong>${escapeHtml(item.signal.reason)}</div>
          <div style="margin-top:6px;font-size:12px;line-height:1.5;color:${item.isIntraday ? "#fbbf24" : "#94a3b8"}">${item.isIntraday ? "盤中暫估" : "行情截至"} ${escapeHtml(item.candleDate)} · ${item.isIntraday ? "盤中價" : "收盤"} ${item.close.toFixed(2)}${item.isIntraday && item.quoteTime ? ` · 掃描 ${escapeHtml(alertQuoteTime(item))}` : ""}</div>${hybridDetails}${marker}
        </div>`;
      }).join("");
      return `<div style="margin:0 0 14px;padding:15px;border:1px solid #2d3748;border-radius:14px;background-color:#151b26;color:#f8fafc;overflow:hidden;word-break:break-word">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed"><tr>
          <td style="vertical-align:top;padding:0"><div style="font-size:20px;font-weight:800;color:#f8fafc;line-height:1.2">${escapeHtml(first.symbol)}</div>${displayName ? `<div style="margin-top:4px;color:#aeb9c8;font-size:13px;line-height:1.4;overflow-wrap:anywhere">${displayName}</div>` : ""}</td>
          <td width="96" align="right" style="width:96px;vertical-align:top;padding:0 0 0 8px"><span style="display:inline-block;padding:5px 8px;border-radius:999px;background-color:#1d3452;color:#93c5fd;font-size:11px;font-weight:700;white-space:nowrap">${items.length} 張訊號卡</span></td>
        </tr></table>
        <div style="margin-top:12px">${signals}</div>
      </div>`;
    }).join("");
    return `<div style="margin-top:22px"><h3 style="margin:0 0 10px;color:#f8fafc;font-size:19px;line-height:1.3">${escapeHtml(MARKET_NAMES[market] || market)} <span style="font-size:12px;font-weight:500;color:#94a3b8">${marketAlerts.length} 筆</span></h3>${cards}</div>`;
  }).join("");
  const manualBanner = manualTest
    ? `<div style="margin:0 0 16px;padding:11px 13px;border:1px solid #7c5c16;border-radius:10px;background-color:#2d250f;color:#fde68a;font-size:13px;line-height:1.55"><strong style="color:#fbbf24">手動測試</strong><br/>此封信依 App 畫面目前選擇的範圍、策略與訊號條件即時掃描；不影響排程、不寫入已寄送紀錄。</div>`
    : "";
  const counts = alertBreakdown(visible);
  const summary = MARKET_ORDER.map(market => `${MARKET_NAMES[market]} ${counts[market]} 筆`).join(" · ");
  const body = sections || `<div style="padding:20px;border:1px solid #334155;border-radius:12px;background-color:#151b26;color:#cbd5e1;line-height:1.6">目前沒有符合${manualTest ? "畫面目前選擇" : "已儲存通知條件"}的訊號；正式排程此刻不會寄送通知。</div>`;
  const basis = visible.some(item => item.isIntraday)
    ? "判斷基準：開盤市場使用盤中暫估日 K；未開盤市場使用最新正式收盤"
    : "判斷基準：最新正式日 K 收盤資料";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>WealthTracker 訊號摘要</title></head><body style="margin:0;padding:0;background-color:#0b0f17;color:#f8fafc"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b0f17" style="width:100%;border-collapse:collapse;background-color:#0b0f17"><tr><td align="center" style="padding:16px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b0f17" style="width:100%;max-width:680px;border-collapse:collapse;background-color:#0b0f17"><tr><td style="padding:4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#f8fafc;word-break:break-word"><h2 style="margin:0 0 7px;color:#f8fafc;font-size:24px;line-height:1.3">日 K 進出場訊號摘要</h2><div style="margin-bottom:16px;color:#94a3b8;font-size:13px;line-height:1.55">${basis} · ${summary}</div>${manualBanner}${body}<p style="margin:22px 0 4px;color:#8491a3;font-size:12px;line-height:1.6">盤中結果會隨價格與成交量變動，不覆寫正式收盤結論。研究訊號僅供參考，不構成投資建議，也不會自動下單。</p></td></tr></table></td></tr></table></body></html>`;
}

async function sendEmail(to: string, alerts: AlertItem[], options: EmailOptions = {}) {
  const apiKey = Deno.env.get("RESEND_API_KEY") || ""; const from = Deno.env.get("SIGNAL_EMAIL_FROM") || "";
  if (!apiKey || !from) throw new Error("Email provider 尚未設定");
  if (!to) throw new Error("使用者尚未設定通知 Email");
  const payload = await fetchJson("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject: emailSubject(alerts, options), html: emailHtml(alerts, options) }) });
  return text(payload.id);
}

async function sendIntradayEmail(to: string, events: Array<{ state: IntradayState; price: number; kind: "risk" | "recovered" }>) {
  if (!events.length) return "";
  const apiKey = Deno.env.get("RESEND_API_KEY") || ""; const from = Deno.env.get("SIGNAL_EMAIL_FROM") || "";
  if (!apiKey || !from) throw new Error("Email provider 尚未設定");
  const cards = events.map(({ state, price, kind }) => {
    const accent = kind === "risk" ? "#fb7185" : "#2dd4bf";
    const status = kind === "risk" ? "盤中風險觸發" : "盤中已收回";
    return `<div style="margin:0 0 12px;padding:15px;border:1px solid #334155;border-radius:12px;background-color:#151b26;color:#f8fafc;overflow:hidden;word-break:break-word">
      <div style="font-size:20px;font-weight:800;color:#f8fafc;line-height:1.25">${escapeHtml(state.symbol)}</div>
      ${state.name ? `<div style="margin-top:4px;color:#aeb9c8;font-size:13px;line-height:1.4;overflow-wrap:anywhere">${escapeHtml(state.name)}</div>` : ""}
      <div style="margin-top:11px;font-size:15px;font-weight:700;color:${accent}">${status}</div>
      <div style="margin-top:8px;padding:10px;border-radius:9px;background-color:#101722;color:#dbe4ef;font-size:13px;line-height:1.65">
        <strong style="color:#f1f5f9">策略：</strong>${escapeHtml(strategyName(state.strategy, state.market))}<br/>
        <strong style="color:#f1f5f9">盤中現價：</strong>${price.toFixed(2)}<br/>
        <strong style="color:#f1f5f9">日線失效價：</strong>${Number(state.invalidation_level).toFixed(2)}
      </div>
    </div>`;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>WealthTracker 盤中監控</title></head><body style="margin:0;padding:0;background-color:#0b0f17;color:#f8fafc"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b0f17" style="width:100%;border-collapse:collapse;background-color:#0b0f17"><tr><td align="center" style="padding:16px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b0f17" style="width:100%;max-width:680px;border-collapse:collapse;background-color:#0b0f17"><tr><td style="padding:4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#f8fafc;word-break:break-word"><h2 style="margin:0 0 7px;color:#f8fafc;font-size:24px;line-height:1.3">日線策略・盤中監控</h2><div style="margin:0 0 16px;padding:11px 13px;border:1px solid #7c5c16;border-radius:10px;background-color:#2d250f;color:#fde68a;font-size:13px;line-height:1.55">此訊息依盤中現價觸發；日線策略的正式確認／失效仍以收盤日 K 為準。</div>${cards}<p style="margin:22px 0 4px;color:#8491a3;font-size:12px;line-height:1.6">研究訊號僅供參考，不構成投資建議，也不會自動下單。</p></td></tr></table></td></tr></table></body></html>`;
  const payload = await fetchJson("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject: `WealthTracker：${events.length} 筆盤中風險更新`, html }) });
  return text(payload.id);
}

async function sendTestEmail(request: Request, body: Record<string, unknown>, admin: ReturnType<typeof createClient>) {
  const authorization = request.headers.get("Authorization") || ""; const jwt = authorization.replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return json({ error: "登入已失效，請重新登入" }, 401);
  const requestedEmail = text(body.email); const destination = requestedEmail || text(data.user.email);
  if (!/^\S+@\S+\.\S+$/.test(destination)) return json({ error: "通知 Email 格式不正確" }, 400);
  const { data: preference, error: preferenceError } = await admin.from("investment_signal_preferences")
    .select("user_id,enabled,schedule_frequency,daily_hour,timezone,email_enabled,notification_email,line_enabled,line_user_id,include_holdings,include_watchlist,markets,strategies,signal_statuses,signal_directions,strategy_settings,max_symbols,last_notification_run_at")
    .eq("user_id", data.user.id).maybeSingle();
  if (preferenceError) return json({ error: preferenceError.message }, 500);
  if (!preference) return json({ error: "請先儲存通知設定後，再寄送目前訊號測試信" }, 400);
  const effectivePreference = testPreferenceOverrides(preference as Preference, body);
  if (!effectivePreference.include_holdings && !effectivePreference.include_watchlist) return json({ error: "請至少選擇持倉或自選清單" }, 400);
  if (!effectivePreference.markets.length || !effectivePreference.strategies.length || !effectivePreference.signal_statuses.length || !effectivePreference.signal_directions.length) return json({ error: "請至少選擇一個市場、策略、訊號狀態與方向" }, 400);
  const targets = await targetsForUser(admin, effectivePreference);
  const diagnostics: ScanDiagnostic[] = [];
  const alerts = await scanPreference(admin, effectivePreference, new Map(), diagnostics, { includeIntraday: true });
  const id = await sendEmail(destination, alerts, { manualTest: true, includeAll: true });
  return json({ sent: true, id, destination: emailHint(destination), targetsScanned: targets.length, alertsFound: alerts.length, alertsByMarket: alertBreakdown(alerts), diagnostics: diagnostics.sort((a, b) => `${a.market}:${a.symbol}`.localeCompare(`${b.market}:${b.symbol}`)), manualTest: true });
}

async function sendLine(userId: string, alerts: AlertItem[], options: MessageOptions = {}) {
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
  if (!token) throw new Error("LINE Messaging API 尚未設定");
  const messages = lineFlexMessages(alerts, options);
  const requestIds: string[] = [];
  for (let index = 0; index < messages.length; index += 5) {
    const response = await fetch("https://api.line.me/v2/bot/message/push", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ to: userId, messages: messages.slice(index, index + 5) }) });
    if (!response.ok) throw new Error(`LINE HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const requestId = response.headers.get("x-line-request-id");
    if (requestId) requestIds.push(requestId);
  }
  return requestIds.join(",");
}

async function sendTestLine(request: Request, body: Record<string, unknown>, admin: ReturnType<typeof createClient>) {
  const authorization = request.headers.get("Authorization") || ""; const jwt = authorization.replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return json({ error: "登入已失效，請重新登入" }, 401);
  const { data: preference, error: preferenceError } = await admin.from("investment_signal_preferences")
    .select("user_id,enabled,schedule_frequency,daily_hour,timezone,email_enabled,notification_email,line_enabled,line_user_id,include_holdings,include_watchlist,markets,strategies,signal_statuses,signal_directions,strategy_settings,max_symbols,last_notification_run_at")
    .eq("user_id", data.user.id).maybeSingle();
  if (preferenceError) return json({ error: preferenceError.message }, 500);
  if (!preference) return json({ error: "請先儲存通知設定後，再寄送目前訊號測試 LINE" }, 400);
  if (!preference.line_user_id) return json({ error: "請先完成 LINE 綁定" }, 400);
  const effectivePreference = testPreferenceOverrides(preference as Preference, body);
  if (!effectivePreference.include_holdings && !effectivePreference.include_watchlist) return json({ error: "請至少選擇持倉或自選清單" }, 400);
  if (!effectivePreference.markets.length || !effectivePreference.strategies.length || !effectivePreference.signal_statuses.length || !effectivePreference.signal_directions.length) return json({ error: "請至少選擇一個市場、策略、訊號狀態與方向" }, 400);
  const targets = await targetsForUser(admin, effectivePreference);
  const diagnostics: ScanDiagnostic[] = [];
  const alerts = await scanPreference(admin, effectivePreference, new Map(), diagnostics, { includeIntraday: true });
  const id = await sendLine(preference.line_user_id, alerts, { manualTest: true, markets: effectivePreference.markets, includeAll: true });
  return json({ sent: true, id, targetsScanned: targets.length, alertsFound: alerts.length, alertsByMarket: alertBreakdown(alerts), diagnostics: diagnostics.sort((a, b) => `${a.market}:${a.symbol}`.localeCompare(`${b.market}:${b.symbol}`)), manualTest: true });
}

async function createLineLink(request: Request, admin: ReturnType<typeof createClient>) {
  const authorization = request.headers.get("Authorization") || ""; const jwt = authorization.replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return json({ error: "登入已失效，請重新登入" }, 401);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
  const codeHash = await sha256(code); const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await admin.from("line_link_codes").delete().eq("user_id", data.user.id).is("used_at", null);
  const { error: insertError } = await admin.from("line_link_codes").insert({ user_id: data.user.id, code_hash: codeHash, expires_at: expiresAt });
  if (insertError) return json({ error: insertError.message }, 500);
  return json({ code, expiresInMinutes: 10 });
}

async function replyLine(replyToken: string, message: string) {
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
  if (!token || !replyToken) return;
  await fetch("https://api.line.me/v2/bot/message/reply", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ replyToken, messages: [{ type: "text", text: message }] }) });
}

async function lineWebhook(request: Request, rawBody: string, admin: ReturnType<typeof createClient>) {
  const signature = request.headers.get("x-line-signature") || ""; const secret = Deno.env.get("LINE_CHANNEL_SECRET") || "";
  if (!await validLineSignature(rawBody, signature, secret)) return json({ error: "Invalid LINE signature" }, 401);
  const payload = JSON.parse(rawBody || "{}");
  for (const event of payload.events || []) {
    if (event.type !== "message" || event.message?.type !== "text" || !event.source?.userId) continue;
    const match = text(event.message.text).match(/^綁定\s+([A-Z0-9]{8})$/i);
    if (!match) { await replyLine(event.replyToken, "若要綁定 WealthTracker，請輸入 App 顯示的「綁定 XXXXXXXX」。"); continue; }
    const codeHash = await sha256(match[1].toUpperCase());
    const { data: link } = await admin.from("line_link_codes").select("id,user_id,expires_at,used_at").eq("code_hash", codeHash).maybeSingle();
    if (!link || link.used_at || new Date(link.expires_at).getTime() < Date.now()) { await replyLine(event.replyToken, "綁定碼無效或已過期，請回 App 重新產生。"); continue; }
    const now = new Date().toISOString();
    const { error } = await admin.from("investment_signal_preferences").upsert({ user_id: link.user_id, line_user_id: event.source.userId, line_enabled: true, updated_at: now }, { onConflict: "user_id" });
    if (error) { await replyLine(event.replyToken, "綁定暫時失敗，請稍後重試。"); continue; }
    await admin.from("line_link_codes").update({ used_at: now }).eq("id", link.id);
    await replyLine(event.replyToken, "WealthTracker LINE 綁定完成。回到 App 點「檢查 LINE 綁定狀態」即可開啟通知。");
  }
  return json({ ok: true });
}

async function recordDelivery(admin: ReturnType<typeof createClient>, preference: Preference, channel: "email" | "line", fingerprint: string, status: "sent" | "failed" | "skipped", destination: string, providerId = "", error = "") {
  await admin.from("signal_notification_deliveries").upsert({ user_id: preference.user_id, channel, fingerprint, destination_hint: destination, status, provider_message_id: providerId || null, error_message: error.slice(0, 500) || null, created_at: new Date().toISOString() }, { onConflict: "user_id,channel,fingerprint" });
}

type ScanOptions = { persistHybrid?: boolean; includeIntraday?: boolean; batchIndex?: number; batchSize?: number };

async function scanPreference(
  admin: ReturnType<typeof createClient>, preference: Preference, cache: Map<string, Promise<MarketData>>,
  diagnostics?: ScanDiagnostic[], options: ScanOptions = {},
) {
  const finmindToken = Deno.env.get("FINMIND_API_TOKEN") || "";
  const allTargets = await targetsForUser(admin, preference);
  const targets = options.batchIndex === undefined ? allTargets
    : allTargets.slice(options.batchIndex * (options.batchSize || 5), (options.batchIndex + 1) * (options.batchSize || 5));
  const intradayCache = new Map<string, Promise<{ row: PriceRow; quoteTime: string } | null>>();
  const analyzed = await mapWithConcurrency(targets, 4, async target => {
    const key = `${target.market}:${target.symbol}`;
    if (!cache.has(key)) cache.set(key, marketRows(target.symbol, target.market, finmindToken));
    try {
      const sourceData = await cache.get(key)!;
      const completedRows = completedDailyRows(sourceData.rows, target.market);
      const primarySnapshot = await analysisSnapshot(sourceData.rows, target.symbol, target.market, Boolean(options.includeIntraday), intradayCache);
      const marketData: MarketData = { ...sourceData, rows: primarySnapshot.rows };
      const latest = marketData.rows.at(-1); if (!latest) return [] as AlertItem[];
      const benchmarkSymbol = target.market === "TW" ? "^TWII" : target.market === "US" ? "^GSPC" : "BTC";
      const benchmarkSource = await benchmarkRowsForMarket(target.market, finmindToken, cache);
      marketData.benchmarkRows = (await analysisSnapshot(benchmarkSource, benchmarkSymbol, target.market, Boolean(options.includeIntraday), intradayCache)).rows;
      const relativeStrength = await relativeStrengthRowsForMarket(target.market, finmindToken, cache);
      const relativeSymbol = target.market === "TW" ? "^TWII" : target.market === "US" ? "QQQ" : "BTC";
      marketData.relativeStrengthRows = (await analysisSnapshot(relativeStrength.rows, relativeSymbol, target.market, Boolean(options.includeIntraday), intradayCache)).rows;
      marketData.relativeStrengthBenchmark = relativeStrength.benchmark;
      const namedTarget = marketData.name && marketData.name.toUpperCase() !== target.symbol.toUpperCase()
        ? { ...target, name: marketData.name }
        : target;
      let signals = sharedSignals(marketData, target.market, target.symbol, preference.strategy_settings, preference.strategies);
      if (options.persistHybrid && preference.strategies.includes("hybrid")) {
        const completedMarketData = {
          ...marketData,
          rows: completedRows,
          benchmarkRows: completedDailyRows(benchmarkSource, target.market),
          relativeStrengthRows: completedDailyRows(relativeStrength.rows, target.market),
        };
        const hybridState = await syncHybridPosition(admin, preference, namedTarget, completedMarketData);
        if (hybridState.suppressEntry) signals = signals.filter(signal => signal.strategy !== "hybrid");
        if (hybridState.exitSignal) signals.push(hybridState.exitSignal);
      }
      const matched = signals
        .filter(signal => preference.strategies.includes(signal.strategy)
          && (signal.strategy === "price-sr-touch" || preference.signal_statuses.includes(signal.status))
          && preference.signal_directions.includes(signal.direction))
        .map(signal => ({
          ...namedTarget, close: latest.close, candleDate: latest.time, signal,
          isIntraday: primarySnapshot.isIntraday,
          quoteTime: primarySnapshot.quoteTime,
        }));
      diagnostics?.push({ symbol: target.symbol, market: target.market, status: matched.length ? "matched" : "no_match", alerts: matched.length, reason: matched.length ? undefined : "目前策略與訊號狀態均未成立" });
      return matched;
    } catch (marketError) {
      console.error("market-data", key, marketError);
      diagnostics?.push({ symbol: target.symbol, market: target.market, status: "failed", alerts: 0, reason: marketError instanceof Error ? marketError.message.slice(0, 160) : "行情讀取失敗" });
      return [] as AlertItem[];
    }
  });
  return analyzed.flat();
}

async function livePrice(symbol: string, market: string, finmindToken: string) {
  if (market === "CRYPTO") {
    const compact = symbol.toUpperCase().replaceAll("-", "").replaceAll("/", "").replace("USD", "USDT");
    const pair = compact.endsWith("USDT") ? compact : `${compact}USDT`;
    const quote = await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(pair)}`);
    return number(quote.price);
  }
  if (market === "TW") {
    const date = new Date().toISOString().slice(0, 10);
    const headers: Record<string, string> = finmindToken ? { Authorization: `Bearer ${finmindToken}` } : {};
    try {
      const payload = await fetchJson(`https://api.finmindtrade.com/api/v4/data?${new URLSearchParams({ dataset: "TaiwanStockPriceMinute", data_id: symbol, start_date: date })}`, { headers });
      const last = (payload.data || []).at(-1) || {};
      const price = number(last.close || last.price);
      if (price > 0) return price;
    } catch {
      // FinMind minute data may be unavailable for a given account or session.
    }
    const payload = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${symbol}.TW`)}?range=1d&interval=1m`);
    const result = payload.chart?.result?.[0]; const quote = result?.indicators?.quote?.[0];
    const values = quote?.close || [];
    return number(result?.meta?.regularMarketPrice || values.filter((value: unknown) => number(value) > 0).at(-1));
  }
  const payload = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`);
  const result = payload.chart?.result?.[0]; const quote = result?.indicators?.quote?.[0];
  const values = quote?.close || [];
  return number(result?.meta?.regularMarketPrice || values.filter((value: unknown) => number(value) > 0).at(-1));
}

function clientIntradayAlerts(candidates: unknown, targets: Target[], preference: Preference): AlertItem[] {
  if (!Array.isArray(candidates)) return [];
  const targetMap = new Map(targets.map(target => [`${target.market}:${target.symbol}`, target]));
  const permittedStrategies = new Set(preference.strategies);
  const seen = new Set<string>();
  const alerts: AlertItem[] = [];
  for (const candidate of candidates.slice(0, 150) as ClientIntradayCandidate[]) {
    const symbol = text(candidate?.symbol).toUpperCase();
    const market = text(candidate?.market).toUpperCase();
    const strategy = text(candidate?.strategy);
    const direction = text(candidate?.direction);
    const candleDate = text(candidate?.candleDate);
    const invalidationLevel = number(candidate?.invalidationLevel);
    const target = targetMap.get(`${market}:${symbol}`);
    if (!target || !permittedStrategies.has(strategy) || !["bullish", "bearish"].includes(direction)
      || !/^\d{4}-\d{2}-\d{2}$/.test(candleDate) || !(invalidationLevel > 0)) continue;
    const key = `${market}:${symbol}:${strategy}:${direction}:${candleDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    alerts.push({
      ...target,
      close: invalidationLevel,
      candleDate,
      signal: { strategy, direction: direction as "bullish" | "bearish", status: "confirmed", reason: "App 日 K 已確認", invalidationLevel },
    });
  }
  return alerts;
}

async function seedIntradayStates(admin: ReturnType<typeof createClient>, userId: string, alerts: AlertItem[]) {
  const rows = alerts.filter(item => !item.isIntraday && item.signal.strategy !== "hybrid" && item.signal.status === "confirmed" && number(item.signal.invalidationLevel) > 0).map(item => ({
    user_id: userId, symbol: item.symbol, market: item.market, name: item.name || item.symbol,
    strategy: item.signal.strategy, direction: item.signal.direction, candle_date: item.candleDate,
    invalidation_level: item.signal.invalidationLevel, status: "active", updated_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error } = await admin.from("signal_intraday_states").upsert(rows, { onConflict: "user_id,symbol,market,strategy,direction,candle_date", ignoreDuplicates: true });
    if (error) throw error;
  }
}

async function monitorIntradayRisk(admin: ReturnType<typeof createClient>, preference: Preference) {
  const { data, error } = await admin.from("signal_intraday_states").select("id,user_id,symbol,market,name,strategy,direction,candle_date,invalidation_level,status,last_price,last_event_at").eq("user_id", preference.user_id).in("status", ["active", "risk", "recovered"]);
  if (error) throw error;
  const finmindToken = Deno.env.get("FINMIND_API_TOKEN") || "";
  const changed: Array<{ state: IntradayState; price: number; kind: "risk" | "recovered" }> = [];
  for (const state of (data || []) as IntradayState[]) {
    try {
      const price = await livePrice(state.symbol, state.market, finmindToken);
      if (!price) continue;
      const level = number(state.invalidation_level); const buffer = level * 0.003;
      const breached = state.direction === "bullish" ? price <= level - buffer : price >= level + buffer;
      const recovered = state.direction === "bullish" ? price >= level + buffer : price <= level - buffer;
      const next = breached ? "risk" : (state.status === "risk" && recovered ? "recovered" : state.status);
      await admin.from("signal_intraday_states").update({ status: next, last_price: price, last_event_at: next !== state.status ? new Date().toISOString() : state.last_event_at, updated_at: new Date().toISOString() }).eq("id", state.id);
      if (next !== state.status && (next === "risk" || next === "recovered")) changed.push({ state: { ...state, status: next }, price, kind: next });
    } catch (liveError) { console.error("intraday-price", state.symbol, liveError); }
  }
  return changed;
}

async function monitorHybridRisk(admin: ReturnType<typeof createClient>, preference: Preference) {
  const { data, error } = await admin.from("hybrid_strategy_positions")
    .select("id,user_id,symbol,market,name,entry_date,entry_price,entry_atr,highest_price,initial_stop,trailing_stop,effective_stop,status,last_price,last_event_at")
    .eq("user_id", preference.user_id).in("status", ["active", "risk", "recovered"]);
  if (error) throw error;
  const finmindToken = Deno.env.get("FINMIND_API_TOKEN") || "";
  const changed: Array<{ state: IntradayState; price: number; kind: "risk" | "recovered" }> = [];
  for (const position of (data || []) as HybridPosition[]) {
    try {
      const price = await livePrice(position.symbol, position.market, finmindToken);
      if (!(price > 0)) continue;
      const stop = number(position.effective_stop);
      const buffer = stop * 0.003;
      const breached = price <= stop - buffer;
      const recovered = price >= stop + buffer;
      const next = breached ? "risk" : (position.status === "risk" && recovered ? "recovered" : position.status);
      await admin.from("hybrid_strategy_positions").update({
        status: next, last_price: price,
        last_event_at: next !== position.status ? new Date().toISOString() : position.last_event_at,
        updated_at: new Date().toISOString(),
      }).eq("id", position.id);
      if (next !== position.status && (next === "risk" || next === "recovered")) {
        changed.push({
          state: {
            id: position.id, user_id: position.user_id, symbol: position.symbol, market: position.market,
            name: position.name, strategy: "hybrid", direction: "bullish", candle_date: position.entry_date,
            invalidation_level: stop, status: next, last_price: price, last_event_at: new Date().toISOString(),
          },
          price,
          kind: next,
        });
      }
    } catch (liveError) {
      console.error("hybrid-intraday-price", position.symbol, liveError);
    }
  }
  return changed;
}

/**
 * A signed-in user can manually refresh their own intraday state without
 * sending an email. Daily strategy verdicts remain end-of-day only.
 */
async function refreshIntradayForUser(request: Request, admin: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const jwt = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !auth.user) return json({ error: "登入已失效，請重新登入" }, 401);

  const { data: preference, error: preferenceError } = await admin
    .from("investment_signal_preferences")
    .select("user_id,enabled,schedule_frequency,daily_hour,timezone,email_enabled,notification_email,line_enabled,line_user_id,include_holdings,include_watchlist,markets,strategies,signal_statuses,signal_directions,strategy_settings,max_symbols,last_notification_run_at")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (preferenceError) return json({ error: preferenceError.message }, 500);
  if (!preference) return json({ error: "尚未建立訊號通知設定，請先儲存通知設定後再檢查" }, 400);

  const typedPreference = preference as Preference;
  const targets = await targetsForUser(admin, typedPreference);
  const serverAlerts = await scanPreference(admin, typedPreference, new Map<string, Promise<MarketData>>(), undefined, { persistHybrid: true });
  const displayAlerts = clientIntradayAlerts(body.candidates, targets, typedPreference);
  const alerts = [...new Map([...serverAlerts, ...displayAlerts].map(item => [
    `${item.market}:${item.symbol}:${item.signal.strategy}:${item.signal.direction}:${item.candleDate}`, item,
  ])).values()];
  await seedIntradayStates(admin, auth.user.id, alerts);
  await monitorIntradayRisk(admin, typedPreference);
  await monitorHybridRisk(admin, typedPreference);
  const [{ data: states, error: statesError }, { data: hybridStates, error: hybridStatesError }] = await Promise.all([
    admin.from("signal_intraday_states")
      .select("symbol,market,strategy,direction,invalidation_level,status,last_price,last_event_at,updated_at")
      .eq("user_id", auth.user.id).in("status", ["active", "risk", "recovered"]),
    admin.from("hybrid_strategy_positions")
      .select("symbol,market,status,last_price,last_event_at,updated_at,effective_stop,entry_date")
      .eq("user_id", auth.user.id).in("status", ["active", "risk", "recovered"]),
  ]);
  if (statesError) return json({ error: statesError.message }, 500);
  if (hybridStatesError) return json({ error: hybridStatesError.message }, 500);
  const normalizedHybrid = (hybridStates || []).map(position => ({
    symbol: position.symbol, market: position.market, strategy: "hybrid", direction: "bullish",
    invalidation_level: position.effective_stop, status: position.status, last_price: position.last_price,
    last_event_at: position.last_event_at, updated_at: position.updated_at, candle_date: position.entry_date,
  }));
  return json({ states: [...(states || []), ...normalizedHybrid], monitoredSignals: alerts.filter(item => item.signal.status === "confirmed").length });
}

async function runScheduled(admin: ReturnType<typeof createClient>, batchIndex: number) {
  if (batchIndex < 0 || batchIndex >= 10) return { checkedUsers: 0, alertsFound: 0, sent: 0, failed: 0, skipped: true };
  const { data, error } = await admin.from("investment_signal_preferences").select("user_id,enabled,schedule_frequency,daily_hour,timezone,email_enabled,notification_email,line_enabled,line_user_id,include_holdings,include_watchlist,markets,strategies,signal_statuses,signal_directions,strategy_settings,max_symbols,last_notification_run_at").eq("enabled", true);
  if (error) throw error;
  const due = ((data || []) as Preference[]).filter(preference => isDue(preference));
  const cache = new Map<string, Promise<MarketData>>();
  let alertsFound = 0; let sent = 0; let failed = 0;
  for (const preference of due) {
    try {
      const alerts = await scanPreference(admin, preference, cache, undefined, {
        persistHybrid: true,
        includeIntraday: true,
        batchIndex,
        batchSize: 5,
      });
      alertsFound += alerts.length;
      await seedIntradayStates(admin, preference.user_id, alerts);
      const intradayEvents = batchIndex === 9 && preference.schedule_frequency === "hourly"
        ? [...await monitorIntradayRisk(admin, preference), ...await monitorHybridRisk(admin, preference)]
        : [];
      if (intradayEvents.length && preference.email_enabled) {
        let destination = text(preference.notification_email);
        if (!destination) destination = text((await admin.auth.admin.getUserById(preference.user_id)).data.user?.email);
        try {
          const id = await sendIntradayEmail(destination, intradayEvents);
          for (const event of intradayEvents) await recordDelivery(admin, preference, "email", `intraday:${event.state.id}:${event.kind}`, "sent", emailHint(destination), id);
          sent += 1;
        } catch (sendError) {
          for (const event of intradayEvents) await recordDelivery(admin, preference, "email", `intraday:${event.state.id}:${event.kind}`, "failed", emailHint(destination), "", sendError instanceof Error ? sendError.message : String(sendError));
          failed += 1;
        }
      }
      if (alerts.length) {
        const identifiers = alerts.map(item => `${item.market}:${item.symbol}:${item.candleDate}:${item.isIntraday ? "intraday" : "closed"}:${item.signal.strategy}:${item.signal.direction}:${item.signal.status}`).sort();
        const fingerprint = await sha256(identifiers.join("|"));
        if (preference.email_enabled) {
          let destination = text(preference.notification_email);
          if (!destination) destination = text((await admin.auth.admin.getUserById(preference.user_id)).data.user?.email);
          const existing = await admin.from("signal_notification_deliveries").select("status").eq("user_id", preference.user_id).eq("channel", "email").eq("fingerprint", fingerprint).maybeSingle();
          if (existing.data?.status !== "sent") try { const id = await sendEmail(destination, alerts); await recordDelivery(admin, preference, "email", fingerprint, "sent", emailHint(destination), id); sent += 1; } catch (sendError) { await recordDelivery(admin, preference, "email", fingerprint, "failed", emailHint(destination), "", sendError instanceof Error ? sendError.message : String(sendError)); failed += 1; }
        }
        if (preference.line_enabled && preference.line_user_id) {
          const existing = await admin.from("signal_notification_deliveries").select("status").eq("user_id", preference.user_id).eq("channel", "line").eq("fingerprint", fingerprint).maybeSingle();
          if (existing.data?.status !== "sent") try { const id = await sendLine(preference.line_user_id, alerts, { markets: preference.markets }); await recordDelivery(admin, preference, "line", fingerprint, "sent", "LINE 已綁定", id); sent += 1; } catch (sendError) { await recordDelivery(admin, preference, "line", fingerprint, "failed", "LINE 已綁定", "", sendError instanceof Error ? sendError.message : String(sendError)); failed += 1; }
        }
      }
    } catch (userError) { console.error("notification-user", preference.user_id, userError); failed += 1; }
    if (batchIndex === 9) await admin.from("investment_signal_preferences").update({ last_notification_run_at: new Date().toISOString() }).eq("user_id", preference.user_id);
  }
  return { checkedUsers: due.length, batchIndex, alertsFound, sent, failed };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""; const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase server configuration missing" }, 500);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const rawBody = await request.text();
  try {
    if (request.headers.get("x-line-signature")) return await lineWebhook(request, rawBody, admin);
    const body = rawBody ? JSON.parse(rawBody) : {};
    if (body.action === "create_line_link") return await createLineLink(request, admin);
    if (body.action === "send_test_email") return await sendTestEmail(request, body, admin);
    if (body.action === "send_test_line") return await sendTestLine(request, body, admin);
    if (body.action === "refresh_intraday") return await refreshIntradayForUser(request, admin, body);
    if (body.action !== "run") return json({ error: "Unknown action" }, 400);
    const supplied = request.headers.get("x-signal-cron-secret") || ""; const expected = Deno.env.get("SIGNAL_CRON_SECRET") || "";
    if (!expected || supplied !== expected) return json({ error: "Unauthorized scheduler" }, 401);
    const requestedBatch = Number(body.batchIndex);
    const batchIndex = Number.isInteger(requestedBatch) && requestedBatch >= 0 && requestedBatch < 10
      ? requestedBatch : new Date().getUTCMinutes();
    const signals = await runScheduled(admin, batchIndex);
    let marketEvents: unknown = { skipped: true };
    if (batchIndex === 9) try {
      const response = await fetch(`${supabaseUrl}/functions/v1/market-event-notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-event-cron-secret": supplied },
        body: JSON.stringify({ action: "run" }),
      });
      marketEvents = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    } catch (eventError) {
      marketEvents = { error: eventError instanceof Error ? eventError.message : String(eventError) };
    }
    return json({ ...signals, marketEvents });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
