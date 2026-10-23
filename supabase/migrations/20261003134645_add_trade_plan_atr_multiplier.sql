-- Persist the user's global ATR risk-space preference for every trade plan.
alter table public.trade_plan_settings
  add column atr_multiplier numeric not null default 1.5
  check (atr_multiplier >= 0.5 and atr_multiplier <= 4.0);
