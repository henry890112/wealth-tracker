-- One user-level risk budget shared by every symbol. Per-symbol entry, ATR stop
-- and position size are calculated live by the app and are not persisted.
create table public.trade_plan_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  max_loss_amount numeric not null default 5000 check (max_loss_amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trade_plan_settings enable row level security;
revoke all on public.trade_plan_settings from anon, authenticated;
grant select, insert, update on public.trade_plan_settings to authenticated;

create policy "Users read own trade plan settings"
  on public.trade_plan_settings for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create own trade plan settings"
  on public.trade_plan_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update own trade plan settings"
  on public.trade_plan_settings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
