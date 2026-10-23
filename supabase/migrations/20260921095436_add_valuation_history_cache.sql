create table if not exists public.valuation_history_cache (
  market_type text not null,
  symbol text not null,
  payload jsonb not null,
  source_as_of timestamptz,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (market_type, symbol)
);

alter table public.valuation_history_cache enable row level security;

-- This shared provider cache is intentionally service-role only. The mobile
-- client reads it through the authenticated valuation-history Edge Function.
revoke all on table public.valuation_history_cache from anon, authenticated;

create index if not exists valuation_history_cache_expires_at_idx
  on public.valuation_history_cache (expires_at);
