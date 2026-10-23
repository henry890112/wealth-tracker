import { STRATEGY_LIBRARY, STRATEGY_LIBRARY_GROUPS } from './strategyLibrary.js';

// Keep the selectable strategy definitions in one place so the chart picker
// and the signal-notification picker cannot drift apart.
export const CORE_STRATEGY_OPTIONS = [
  { key: 'candlestick', label: 'K 線型態', category: '形態策略' },
  { key: 'divergence', label: 'MACD 背離', category: '技術指標與動能' },
  { key: 'rsiDivergence', label: 'RSI 背離', category: '技術指標與動能' },
  { key: 'kdDivergence', label: 'KD 背離', category: '技術指標與動能' },
  { key: 'pullback', label: '趨勢回檔', category: '趨勢策略' },
  { key: 'breakout', label: '放量突破', category: '趨勢策略' },
  { key: 'rsi', label: 'RSI5／RSI10 交叉', category: '技術指標與動能' },
  { key: 'boundary', label: '雙軌邊界', category: '價格行為／SMC' },
  { key: 'smc', label: 'SMC', category: '價格行為／SMC' },
  { key: 'institutional', label: '籌碼／資金動能', category: '量價與資金流' },
];

export const STRATEGY_SELECTION_CATEGORIES = ['整合策略', ...STRATEGY_LIBRARY_GROUPS];

export const ALL_SELECTABLE_STRATEGY_KEYS = [
  ...CORE_STRATEGY_OPTIONS.map(item => item.key),
  ...STRATEGY_LIBRARY.map(item => item.key),
];

export const MULTI_SELECT_STRATEGY_KEYS = new Set(ALL_SELECTABLE_STRATEGY_KEYS);

export const NOTIFICATION_STRATEGY_OPTIONS = [
  { key: 'hybrid', label: '混合策略（建議）', category: '整合策略' },
  ...CORE_STRATEGY_OPTIONS,
  // MA swing settings currently belong to the local chart, not cloud alerts.
  ...STRATEGY_LIBRARY.filter(item => item.key !== 'trend-ma-swing'),
];

export const NOTIFICATION_STRATEGY_KEYS = new Set(NOTIFICATION_STRATEGY_OPTIONS.map(item => item.key));

const strategyLeadingLetters = item => String(item?.label || '').trim().match(/^[A-Za-z]+/)?.[0].toUpperCase() || '';

export const compareStrategyItems = (left, right) => {
  const leftLabel = String(left?.label || '').trim();
  const rightLabel = String(right?.label || '').trim();
  const leftLetters = strategyLeadingLetters(left);
  const rightLetters = strategyLeadingLetters(right);
  if (leftLetters && rightLetters && leftLetters !== rightLetters) return leftLetters.localeCompare(rightLetters, 'en', { sensitivity: 'base' });
  if (leftLetters !== rightLetters) return leftLetters ? -1 : 1;
  return leftLabel.localeCompare(rightLabel, 'zh-Hant-TW', { numeric: true, sensitivity: 'base' })
    || String(left?.key || '').localeCompare(String(right?.key || ''), 'en', { sensitivity: 'base' });
};

export const sortStrategyItems = items => [...items].sort(compareStrategyItems);
