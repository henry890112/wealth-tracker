alter table public.assets
  add column if not exists exclude_from_performance boolean not null default false;

comment on column public.assets.exclude_from_performance is
  'When true, this asset and its linked transactions are excluded from investment performance calculations.';
