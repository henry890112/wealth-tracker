create table if not exists public.tw_margin_history_cache (
  date date primary key,
  twse jsonb,
  tpex jsonb,
  taiex_close numeric,
  maintenance_rate numeric,
  fetched_at timestamptz not null default now(),
  index_fetched_at timestamptz,
  maintenance_fetched_at timestamptz
);

alter table public.tw_margin_history_cache enable row level security;

-- Shared public market data is accessed only by the market-overview Edge Function.
revoke all on table public.tw_margin_history_cache from public, anon, authenticated;
grant all on table public.tw_margin_history_cache to service_role;
