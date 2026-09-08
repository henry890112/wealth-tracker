-- Cloud-backed research signals for Taiwan equities.
-- These records are intentionally phrased as research signals, never orders or advice.

create table if not exists public.investment_signal_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  push_enabled boolean not null default true,
  strategy text not null default 'value_trend_v1',
  max_symbols integer not null default 50 check (max_symbols between 1 and 50),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investment_signal_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  symbol text not null,
  name text not null,
  signal_date date not null,
  strategy text not null default 'value_trend_v1',
  score numeric(5, 2) not null check (score >= 0 and score <= 100),
  reasons jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  source_as_of date not null,
  notification_sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, symbol, signal_date, strategy)
);

create index if not exists investment_signal_events_user_date_idx
  on public.investment_signal_events (user_id, signal_date desc, created_at desc);
create index if not exists push_devices_user_active_idx
  on public.push_devices (user_id) where is_active;

alter table public.investment_signal_preferences enable row level security;
alter table public.push_devices enable row level security;
alter table public.investment_signal_events enable row level security;

grant select, insert, update, delete on public.investment_signal_preferences to authenticated;
grant select, insert, update, delete on public.push_devices to authenticated;
grant select, insert, update, delete on public.investment_signal_events to authenticated;

create policy "Signal preferences are private" on public.investment_signal_preferences
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Push devices are private" on public.push_devices
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Signal events are private" on public.investment_signal_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Signal events can be marked read by owner" on public.investment_signal_events
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
