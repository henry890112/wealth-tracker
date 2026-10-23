create table if not exists public.corporate_actions_cache (
  market_type text not null,
  symbol text not null,
  payload jsonb not null,
  source_as_of timestamptz,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (market_type, symbol)
);

alter table public.corporate_actions_cache enable row level security;

-- Provider data is shared and is accessed only through the authenticated
-- corporate-actions Edge Function with the service role.
revoke all on table public.corporate_actions_cache from anon, authenticated;

create index if not exists corporate_actions_cache_expires_at_idx
  on public.corporate_actions_cache (expires_at);
