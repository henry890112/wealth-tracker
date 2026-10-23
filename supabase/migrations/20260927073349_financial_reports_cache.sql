create table if not exists public.financial_reports_cache (
  market_type text not null check (market_type in ('TW', 'US')),
  symbol text not null,
  payload jsonb not null,
  source_as_of date,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (market_type, symbol)
);

alter table public.financial_reports_cache enable row level security;
revoke all on table public.financial_reports_cache from anon, authenticated;
create index if not exists financial_reports_cache_expires_at_idx
  on public.financial_reports_cache (expires_at);
