-- Preserve the market observation time separately from the cache write time.
alter table public.price_cache
  add column if not exists source text not null default 'unknown',
  add column if not exists source_time timestamptz,
  add column if not exists fetched_at timestamptz not null default now(),
  add column if not exists quote_status text not null default 'unknown',
  add column if not exists is_stale boolean not null default false,
  add column if not exists candle_date date,
  add column if not exists session text not null default 'unknown';

update public.price_cache
set source_time = coalesce(source_time, updated_at),
    fetched_at = updated_at
where source = 'unknown';

create index if not exists price_cache_fetched_at_idx
  on public.price_cache (fetched_at desc);

alter table public.price_cache
  drop constraint if exists price_cache_quote_status_check,
  add constraint price_cache_quote_status_check
    check (quote_status in ('intraday', 'official_close', 'reference', 'stale', 'unavailable', 'unknown'));

-- A profile contains user preferences and must not be readable by every user.
drop policy if exists "Public profiles are viewable by everyone." on public.profiles;
drop policy if exists "Users can view own profile." on public.profiles;

create policy "Users can view own profile."
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);
