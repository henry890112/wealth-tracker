import { supabase } from '../lib/supabase';

const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map();

// Presets are explicit modelling scenarios, not a promise that the market
// will deliver those growth rates.  Keeping them here makes the assumptions
// reusable by the card and easy to audit in tests.
export const DCF_SCENARIOS = [
  {
    key: 'conservative',
    label: '保守',
    description: '成熟期、較高折現率',
    wacc: 10,
    terminalGrowth: 2.5,
    growthRates: [12, 10, 8, 6, 5],
  },
  {
    key: 'base',
    label: '成長型科技基準',
    description: '較高成長、合理折現率',
    wacc: 9,
    terminalGrowth: 3,
    growthRates: [20, 18, 15, 12, 10],
  },
  {
    key: 'optimistic',
    label: '樂觀',
    description: '需有明確成長催化劑',
    wacc: 8.5,
    terminalGrowth: 3,
    growthRates: [30, 25, 20, 15, 12],
  },
];

export async function fetchDcfFundamentals(symbol, marketType = 'TW', forceRefresh = false) {
  const market = String(marketType || '').toUpperCase();
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!['TW', 'US'].includes(market)) throw new Error('DCF 目前只支援台股與美股個股。');
  const key = `${market}:${normalized}`;
  const hit = cache.get(key);
  if (!forceRefresh && hit && Date.now() - hit.timestamp < CACHE_TTL) return hit.data;
  const { data, error } = await supabase.functions.invoke('dcf-fundamentals', {
    body: { symbol: normalized, marketType: market, forceRefresh },
  });
  if (error) throw new Error(error.message || 'DCF 財報資料服務無法連線');
  if (data?.error) throw new Error(data.error);
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}

const finite = value => Number.isFinite(Number(value));
const safe = (value, fallback = 0) => finite(value) ? Number(value) : fallback;

export function calculateDcf(input) {
  const baseFcf = safe(input?.baseFcf);
  const growth = (input?.growthRates || []).slice(0, 5).map(value => safe(value) / 100);
  while (growth.length < 5) growth.push(growth.at(-1) ?? 0.05);
  const wacc = safe(input?.wacc, 9.5) / 100;
  const terminalGrowth = safe(input?.terminalGrowth, 2.5) / 100;
  const cash = safe(input?.cash);
  const debt = safe(input?.debt);
  const shares = safe(input?.shares);
  const marginOfSafety = safe(input?.marginOfSafety, 20) / 100;
  // A negative current FCFF is a warning, not a mathematical convergence
  // failure. The model can still show the implied value as long as the
  // terminal denominator and per-share inputs are valid.
  const valid = finite(input?.baseFcf) && wacc > 0 && terminalGrowth >= 0 && wacc > terminalGrowth && shares > 0;
  let current = baseFcf;
  const forecast = growth.map((rate, index) => {
    current *= 1 + rate;
    const discountFactor = (1 + wacc) ** (index + 1);
    return { year: index + 1, growth: rate * 100, fcf: current, discountFactor, pv: current / discountFactor };
  });
  const forecastPv = forecast.reduce((sum, row) => sum + row.pv, 0);
  const terminalFcf = current * (1 + terminalGrowth);
  const terminalValue = valid ? terminalFcf / (wacc - terminalGrowth) : null;
  const terminalPv = valid ? terminalValue / ((1 + wacc) ** 5) : null;
  const enterpriseValue = valid ? forecastPv + terminalPv : null;
  const equityValue = valid ? enterpriseValue + cash - debt : null;
  const fairValue = valid ? equityValue / shares : null;
  return {
    valid,
    forecast,
    terminalFcf,
    terminalValue,
    terminalPv,
    forecastPv,
    enterpriseValue,
    equityValue,
    fairValue,
    safetyPrice: valid ? fairValue * (1 - marginOfSafety) : null,
    upside: valid && finite(input?.currentPrice) && Number(input.currentPrice) > 0 ? (fairValue / Number(input.currentPrice) - 1) * 100 : null,
    invalidReason: !finite(input?.baseFcf) ? '基準 FCFF 不足' : !shares ? '流通股數不足' : wacc <= terminalGrowth ? 'WACC 必須高於永續成長率' : null,
    warning: baseFcf < 0 ? '基準 FCFF 為負，DCF 結果可靠度低，請優先檢查成長率與財報資料。' : null,
  };
}

export function buildSensitivity(input, waccOffsets = [-1, -0.5, 0, 0.5, 1], growthOffsets = [-0.5, -0.25, 0, 0.25, 0.5]) {
  const wacc = safe(input?.wacc, 9.5);
  const terminalGrowth = safe(input?.terminalGrowth, 2.5);
  return waccOffsets.map(waccOffset => ({
    wacc: wacc + waccOffset,
    values: growthOffsets.map(growthOffset => {
      const result = calculateDcf({ ...input, wacc: wacc + waccOffset, terminalGrowth: terminalGrowth + growthOffset });
      return { terminalGrowth: terminalGrowth + growthOffset, fairValue: result.valid ? result.fairValue : null };
    }),
  }));
}

export function impliedGrowthRate(input, targetPrice = input?.currentPrice) {
  if (!finite(targetPrice) || Number(targetPrice) <= 0 || !finite(input?.shares) || Number(input.shares) <= 0) return null;
  let low = -0.5;
  let high = 1;
  const target = Number(targetPrice);
  const lowResult = calculateDcf({ ...input, growthRates: Array(5).fill(low * 100) });
  const highResult = calculateDcf({ ...input, growthRates: Array(5).fill(high * 100) });
  // Do not present the edge of the search interval as a real answer when the
  // current price is outside the model's -50%..100% constant-growth bracket.
  if (!lowResult.valid || !highResult.valid || lowResult.fairValue > target || highResult.fairValue < target) return null;
  for (let index = 0; index < 70; index += 1) {
    const mid = (low + high) / 2;
    const result = calculateDcf({ ...input, growthRates: Array(5).fill(mid * 100) });
    if (!result.valid) return null;
    if (result.fairValue < target) low = mid;
    else high = mid;
  }
  return ((low + high) / 2) * 100;
}
