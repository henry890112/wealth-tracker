alter table public.transactions
  add column if not exists ignored_from_performance boolean not null default false;

comment on column public.transactions.ignored_from_performance is
  'When true, keep the transaction for audit/history but exclude it from investment performance calculations.';
