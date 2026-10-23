create table if not exists public.market_event_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  daily_hour smallint not null default 20 check (daily_hour between 0 and 23),
  timezone text not null default 'Asia/Taipei',
  include_holdings boolean not null default true,
  include_watchlist boolean not null default true,
  markets text[] not null default array['TW', 'US', 'CRYPTO']::text[],
  min_importance smallint not null default 70 check (min_importance between 50 and 100),
  last_run_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.market_event_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  report_date date not null,
  events jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now(),
  unique (user_id, report_date)
);

create table if not exists public.market_event_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('email', 'line')),
  fingerprint text not null,
  status text not null check (status in ('sent', 'failed')),
  destination_hint text,
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  unique (user_id, channel, fingerprint)
);

create index if not exists market_event_reports_user_date_idx
  on public.market_event_reports (user_id, report_date desc);
create index if not exists market_event_deliveries_user_idx
  on public.market_event_deliveries (user_id, created_at desc);

alter table public.market_event_preferences enable row level security;
alter table public.market_event_reports enable row level security;
alter table public.market_event_deliveries enable row level security;

grant select, insert, update, delete on public.market_event_preferences to authenticated;
grant select on public.market_event_reports to authenticated;
grant select on public.market_event_deliveries to authenticated;

create policy "Users manage own market event preferences" on public.market_event_preferences
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users read own market event reports" on public.market_event_reports
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users read own market event deliveries" on public.market_event_deliveries
  for select to authenticated
  using ((select auth.uid()) = user_id);
