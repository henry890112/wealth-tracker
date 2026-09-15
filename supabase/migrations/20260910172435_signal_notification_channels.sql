-- Per-user delivery rules for scheduled portfolio signal notifications.
-- Provider credentials remain in Edge Function secrets; this table stores only
-- each user's own destination and preferences.

alter table public.investment_signal_preferences
  add column if not exists schedule_frequency text not null default 'daily'
    check (schedule_frequency in ('hourly', 'daily')),
  add column if not exists daily_hour smallint not null default 20
    check (daily_hour between 0 and 23),
  add column if not exists timezone text not null default 'Asia/Taipei',
  add column if not exists email_enabled boolean not null default false,
  add column if not exists notification_email text,
  add column if not exists line_enabled boolean not null default false,
  add column if not exists line_user_id text,
  add column if not exists include_holdings boolean not null default true,
  add column if not exists include_watchlist boolean not null default true,
  add column if not exists markets text[] not null default array['TW', 'US', 'CRYPTO']::text[],
  add column if not exists strategies text[] not null default array['divergence', 'pullback', 'breakout', 'rsi', 'boundary', 'smc']::text[],
  add column if not exists signal_statuses text[] not null default array['confirmed']::text[],
  add column if not exists last_notification_run_at timestamptz;

create table if not exists public.line_link_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.signal_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('email', 'line')),
  fingerprint text not null,
  destination_hint text,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  unique (user_id, channel, fingerprint)
);

create index if not exists line_link_codes_user_idx
  on public.line_link_codes (user_id, expires_at desc);
create index if not exists signal_notification_deliveries_user_idx
  on public.signal_notification_deliveries (user_id, created_at desc);

alter table public.line_link_codes enable row level security;
alter table public.signal_notification_deliveries enable row level security;

grant select, insert, delete on public.line_link_codes to authenticated;
grant select on public.signal_notification_deliveries to authenticated;

create policy "LINE link codes are private" on public.line_link_codes
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create own LINE link codes" on public.line_link_codes
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can remove own LINE link codes" on public.line_link_codes
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Notification deliveries are private" on public.signal_notification_deliveries
  for select to authenticated
  using ((select auth.uid()) = user_id);
