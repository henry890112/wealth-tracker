create table if not exists public.dcf_fundamentals_cache (
  market_type text not null,
  symbol text not null,
  payload jsonb not null,
  source_as_of timestamptz,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (market_type, symbol)
);

alter table public.dcf_fundamentals_cache enable row level security;
revoke all on table public.dcf_fundamentals_cache from anon, authenticated;
create index if not exists dcf_fundamentals_cache_expires_at_idx on public.dcf_fundamentals_cache (expires_at);
