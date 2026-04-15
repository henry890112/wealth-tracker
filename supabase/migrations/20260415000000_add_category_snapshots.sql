-- category_snapshots: stores per-category value snapshots for each user per day
create table if not exists public.category_snapshots (
  id          bigserial primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  date        date        not null,
  category    text        not null,
  value       numeric     not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, date, category)
);

-- RLS
alter table public.category_snapshots enable row level security;

create policy "Users can read own category snapshots"
  on public.category_snapshots for select
  using (auth.uid() = user_id);

create policy "Users can insert own category snapshots"
  on public.category_snapshots for insert
  with check (auth.uid() = user_id);

create policy "Users can update own category snapshots"
  on public.category_snapshots for update
  using (auth.uid() = user_id);

-- Index for fast time-range queries per user+category
create index if not exists idx_category_snapshots_user_category_date
  on public.category_snapshots (user_id, category, date);
