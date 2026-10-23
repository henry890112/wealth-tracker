alter table public.assets
  add column if not exists exclude_from_allocation boolean not null default false;

comment on column public.assets.exclude_from_allocation is
  'Whether this asset is excluded from asset-allocation charts. It does not affect net worth or trading performance.';
