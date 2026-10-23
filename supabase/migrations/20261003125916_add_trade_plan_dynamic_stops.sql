-- Keep the latest adopted stop for each open long position. The app only moves
-- this value upward; a flat position is marked closed instead of deleting history.
create table public.trade_plan_dynamic_stops (
  user_id uuid not null references public.profiles(id) on delete cascade,
  symbol text not null check (length(trim(symbol)) > 0),
  market_type text not null check (market_type in ('TW', 'US', 'CRYPTO')),
  entry_price numeric not null check (entry_price > 0),
  last_effective_stop numeric not null check (last_effective_stop > 0),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, symbol, market_type)
);

alter table public.trade_plan_dynamic_stops enable row level security;
revoke all on public.trade_plan_dynamic_stops from anon, authenticated;
grant select, insert, update on public.trade_plan_dynamic_stops to authenticated;

create policy "Users read own dynamic trade plan stops"
  on public.trade_plan_dynamic_stops for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create own dynamic trade plan stops"
  on public.trade_plan_dynamic_stops for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update own dynamic trade plan stops"
  on public.trade_plan_dynamic_stops for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
