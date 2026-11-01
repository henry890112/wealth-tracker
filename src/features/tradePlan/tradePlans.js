import { supabase } from '../../lib/supabase';
import { normalizeTradePlanAtrMultiplier, normalizeTradePlanMarket } from './tradePlanCalculator.js';

const currentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error('請先登入');
  return user;
};

export const loadTradePlanSettings = async () => {
  const user = await currentUser();
  const { data: settings, error: settingsError } = await supabase
    .from('trade_plan_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (settingsError) throw settingsError;
  return {
    atr_multiplier: normalizeTradePlanAtrMultiplier(settings?.atr_multiplier),
    saved: Boolean(settings),
  };
};

export const saveTradePlanSettings = async optionsOrAtrMultiplier => {
  const user = await currentUser();
  const options = optionsOrAtrMultiplier && typeof optionsOrAtrMultiplier === 'object'
    ? optionsOrAtrMultiplier
    : { atrMultiplier: optionsOrAtrMultiplier };
  const atrMultiplier = normalizeTradePlanAtrMultiplier(options.atrMultiplier);
  const { data, error } = await supabase
    .from('trade_plan_settings')
    .upsert({
      user_id: user.id,
      atr_multiplier: atrMultiplier,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
};

const normalizeSymbol = value => String(value || '').trim().toUpperCase();

export const loadTradePlanStop = async (symbol, marketType) => {
  const user = await currentUser();
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) return null;
  const { data, error } = await supabase
    .from('trade_plan_dynamic_stops')
    .select('*')
    .eq('user_id', user.id)
    .eq('symbol', normalizedSymbol)
    .eq('market_type', normalizeTradePlanMarket(marketType))
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

export const loadActiveTradePlanStops = async () => {
  const user = await currentUser();
  const { data, error } = await supabase
    .from('trade_plan_dynamic_stops')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'active');
  if (error) throw error;
  return data || [];
};

const buildTradePlanStopRow = (userId, {
  symbol,
  marketType,
  entryPrice,
  effectiveStop,
  initialStop,
  initialRiskPerShare,
  highestPriceSinceEntry,
  stopSource,
  evaluatedAt,
  invalidatedAt,
  invalidationPrice,
  invalidationSessionDate,
} = {}) => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const entry = Number(entryPrice);
  const stop = Number(effectiveStop);
  const firstStop = Number(initialStop);
  const initialRisk = Number(initialRiskPerShare);
  const highestPrice = Number(highestPriceSinceEntry);
  const confirmedInvalidationPrice = Number(invalidationPrice);
  const hasConfirmedInvalidation = Boolean(invalidatedAt && invalidationSessionDate)
    && Number.isFinite(confirmedInvalidationPrice)
    && confirmedInvalidationPrice > 0;
  if (!normalizedSymbol) throw new Error('缺少標的代碼');
  if (!Number.isFinite(entry) || entry <= 0) throw new Error('交易計畫計算基準價無效');
  if (!Number.isFinite(stop) || stop <= 0) throw new Error('交易計畫停損價無效');
  if (stop >= entry) throw new Error('交易計畫停損必須低於 FIFO 均價');
  if (!Number.isFinite(firstStop) || firstStop <= 0 || firstStop >= entry) throw new Error('交易計畫初始停損價無效');
  if (!Number.isFinite(initialRisk) || initialRisk <= 0) throw new Error('交易計畫初始風險無效');
  if (!Number.isFinite(highestPrice) || highestPrice <= 0) throw new Error('交易計畫最高價無效');
  return {
    user_id: userId,
    symbol: normalizedSymbol,
    market_type: normalizeTradePlanMarket(marketType),
    entry_price: entry,
    initial_stop_price: firstStop,
    initial_risk_per_share: initialRisk,
    highest_price_since_entry: highestPrice,
    last_effective_stop: stop,
    last_stop_source: stopSource || null,
    last_evaluated_at: evaluatedAt || new Date().toISOString(),
    invalidated_at: hasConfirmedInvalidation ? invalidatedAt : null,
    invalidation_price: hasConfirmedInvalidation ? confirmedInvalidationPrice : null,
    invalidation_session_date: hasConfirmedInvalidation ? invalidationSessionDate : null,
    status: 'active',
    updated_at: new Date().toISOString(),
  };
};

const persistRebasedTradePlanStop = async row => {
  const { error } = await supabase.rpc('rebase_trade_plan_dynamic_stop', {
    p_symbol: row.symbol,
    p_market_type: row.market_type,
    p_entry_price: row.entry_price,
    p_initial_stop_price: row.initial_stop_price,
    p_initial_risk_per_share: row.initial_risk_per_share,
    p_highest_price_since_entry: row.highest_price_since_entry,
    p_last_effective_stop: row.last_effective_stop,
    p_last_stop_source: row.last_stop_source,
    p_last_evaluated_at: row.last_evaluated_at,
    p_invalidated_at: row.invalidated_at,
    p_invalidation_price: row.invalidation_price,
    p_invalidation_session_date: row.invalidation_session_date,
  });
  if (error) throw error;

  const { data, error: loadError } = await supabase
    .from('trade_plan_dynamic_stops')
    .select('*')
    .eq('user_id', row.user_id)
    .eq('symbol', row.symbol)
    .eq('market_type', row.market_type)
    .eq('status', 'active')
    .single();
  if (loadError) throw loadError;
  return data;
};

export const saveTradePlanStop = async options => {
  const user = await currentUser();
  const row = buildTradePlanStopRow(user.id, options);
  if (options?.rebaseExisting) return persistRebasedTradePlanStop(row);
  const { data, error } = await supabase
    .from('trade_plan_dynamic_stops')
    .upsert(row, { onConflict: 'user_id,symbol,market_type' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
};

export const saveTradePlanStops = async plans => {
  if (!Array.isArray(plans) || !plans.length) return [];
  const user = await currentUser();
  const rows = plans.map(plan => buildTradePlanStopRow(user.id, plan));
  const rebasedRows = await Promise.all(rows
    .filter((row, index) => plans[index]?.rebaseExisting)
    .map(persistRebasedTradePlanStop));
  const regularRows = rows.filter((row, index) => !plans[index]?.rebaseExisting);
  if (!regularRows.length) return rebasedRows;
  const { data, error } = await supabase
    .from('trade_plan_dynamic_stops')
    .upsert(regularRows, { onConflict: 'user_id,symbol,market_type' })
    .select('*');
  if (error) throw error;
  return [...(data || []), ...rebasedRows];
};

export const closeTradePlanStop = async (symbol, marketType) => {
  const user = await currentUser();
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) return null;
  const { data, error } = await supabase
    .from('trade_plan_dynamic_stops')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('symbol', normalizedSymbol)
    .eq('market_type', normalizeTradePlanMarket(marketType))
    .eq('status', 'active')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data || null;
};
