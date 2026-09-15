-- Tracks a daily strategy after it becomes actionable, so an intraday quote can
-- produce one risk/recovery alert without changing the end-of-day verdict.
create table public.signal_intraday_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  symbol text not null,
  market text not null check (market in ('TW', 'US', 'CRYPTO')),
  name text not null,
  strategy text not null,
  direction text not null check (direction in ('bullish', 'bearish')),
  candle_date date not null,
  invalidation_level numeric not null,
  status text not null default 'active' check (status in ('active', 'risk', 'recovered', 'invalidated')),
  last_price numeric,
  last_event_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, symbol, market, strategy, direction, candle_date)
);

create index signal_intraday_states_active_idx
  on public.signal_intraday_states (user_id, market, status, updated_at desc);

alter table public.signal_intraday_states enable row level security;
grant select on public.signal_intraday_states to authenticated;

create policy "Users read own intraday signal states"
  on public.signal_intraday_states for select to authenticated
  using ((select auth.uid()) = user_id);
