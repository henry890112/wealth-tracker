-- Persistent virtual position state for the layered long-only hybrid strategy.
-- The service-role notification worker owns writes; signed-in users can only
-- read their own risk state in the App.
create table public.hybrid_strategy_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  symbol text not null,
  market text not null check (market in ('TW', 'US', 'CRYPTO')),
  name text not null,
  entry_date date not null,
  entry_price numeric not null check (entry_price > 0),
  entry_atr numeric not null check (entry_atr > 0),
  highest_price numeric not null check (highest_price > 0),
  initial_stop numeric not null,
  trailing_stop numeric not null,
  effective_stop numeric not null,
  status text not null default 'active' check (status in ('active', 'risk', 'recovered', 'exited', 'cancelled')),
  last_price numeric,
  last_event_at timestamptz,
  exit_date date,
  exit_price numeric,
  exit_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index hybrid_strategy_positions_one_active_idx
  on public.hybrid_strategy_positions (user_id, market, symbol)
  where status in ('active', 'risk', 'recovered');

create index hybrid_strategy_positions_user_status_idx
  on public.hybrid_strategy_positions (user_id, market, status, updated_at desc);

alter table public.hybrid_strategy_positions enable row level security;
revoke all on public.hybrid_strategy_positions from anon, authenticated;
grant select on public.hybrid_strategy_positions to authenticated;

create policy "Users read own hybrid positions"
  on public.hybrid_strategy_positions for select to authenticated
  using ((select auth.uid()) = user_id);

-- Migrate only untouched legacy defaults. Any user who customized the six
-- strategy selection keeps that exact selection.
update public.investment_signal_preferences
set strategies = array['hybrid']::text[], updated_at = now()
where cardinality(strategies) = 6
  and strategies @> array['divergence', 'pullback', 'breakout', 'rsi', 'boundary', 'smc']::text[]
  and strategies <@ array['divergence', 'pullback', 'breakout', 'rsi', 'boundary', 'smc']::text[];
