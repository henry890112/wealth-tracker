-- Per-user technical strategy presets shared by the analysis screen and
-- scheduled Email/LINE signal scans. Unknown keys are ignored by the engine.
alter table public.investment_signal_preferences
  add column if not exists strategy_settings jsonb not null default '{}'::jsonb;
