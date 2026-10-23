create table if not exists public.investment_performance_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  start_date date not null default current_date,
  base_currency text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investment_performance_baselines (
  user_id uuid not null references public.profiles(id) on delete cascade,
  market text not null,
  opening_value_base numeric not null check (opening_value_base >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, market)
);

create table if not exists public.investment_cash_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  market text not null,
  currency text not null,
  kind text not null check (kind in (
    'opening_cash', 'deposit', 'withdrawal', 'trade_buy', 'trade_sell',
    'dividend', 'fee', 'adjustment', 'transfer_in', 'transfer_out'
  )),
  amount_native numeric not null,
  amount_base_at_event numeric,
  occurred_at timestamptz not null default now(),
  transaction_id uuid unique references public.transactions(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists investment_cash_ledger_user_market_date_idx
  on public.investment_cash_ledger (user_id, market, occurred_at desc);

alter table public.investment_performance_settings enable row level security;
alter table public.investment_performance_baselines enable row level security;
alter table public.investment_cash_ledger enable row level security;

create policy "Users manage own investment performance settings"
  on public.investment_performance_settings for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage own investment performance baselines"
  on public.investment_performance_baselines for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage own investment cash ledger"
  on public.investment_cash_ledger for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.investment_performance_settings to authenticated;
grant select, insert, update, delete on public.investment_performance_baselines to authenticated;
grant select, insert, update, delete on public.investment_cash_ledger to authenticated;

create or replace function public.initialize_investment_performance(
  p_start_date date,
  p_base_currency text,
  p_baselines jsonb,
  p_opening_cash jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from public.investment_performance_settings where user_id = v_user_id) then
    raise exception 'Investment performance has already been initialized';
  end if;

  insert into public.investment_performance_settings (user_id, start_date, base_currency)
  values (v_user_id, coalesce(p_start_date, current_date), upper(p_base_currency));

  for v_item in select value from jsonb_array_elements(coalesce(p_baselines, '[]'::jsonb)) loop
    insert into public.investment_performance_baselines (user_id, market, opening_value_base)
    values (
      v_user_id,
      upper(v_item->>'market'),
      greatest(coalesce((v_item->>'opening_value_base')::numeric, 0), 0)
    );
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_opening_cash, '[]'::jsonb)) loop
    if coalesce((v_item->>'amount_native')::numeric, 0) <> 0 then
      insert into public.investment_cash_ledger (
        user_id, market, currency, kind, amount_native, amount_base_at_event, occurred_at, note
      ) values (
        v_user_id,
        upper(v_item->>'market'),
        upper(v_item->>'currency'),
        'opening_cash',
        (v_item->>'amount_native')::numeric,
        coalesce((v_item->>'amount_base_at_event')::numeric, 0),
        coalesce(p_start_date, current_date)::timestamptz,
        '績效起算日券商現金'
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.initialize_investment_performance(date, text, jsonb, jsonb) from public, anon;
grant execute on function public.initialize_investment_performance(date, text, jsonb, jsonb) to authenticated;

create or replace function public.sync_investment_trade_cash()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transaction public.transactions%rowtype;
  v_user_id uuid;
  v_asset public.assets%rowtype;
  v_start_date date;
  v_market text;
  v_currency text;
begin
  if tg_op = 'DELETE' then
    delete from public.investment_cash_ledger where transaction_id = old.id;
    return old;
  end if;

  v_transaction := new;
  delete from public.investment_cash_ledger where transaction_id = v_transaction.id;

  if v_transaction.type not in ('BUY', 'SELL') then
    return new;
  end if;

  select * into v_asset from public.assets where id = v_transaction.asset_id;
  if not found or v_asset.category <> 'investment' then
    return new;
  end if;

  v_user_id := v_asset.user_id;
  select start_date into v_start_date
  from public.investment_performance_settings
  where user_id = v_user_id;

  if v_start_date is null or v_transaction.trans_date::date < v_start_date then
    return new;
  end if;

  v_market := upper(coalesce(v_asset.market_type::text, 'OTHER'));
  v_currency := upper(coalesce(v_asset.currency,
    case when v_market = 'TW' then 'TWD' else 'USD' end));

  insert into public.investment_cash_ledger (
    user_id, market, currency, kind, amount_native, occurred_at,
    transaction_id, asset_id, note
  ) values (
    v_user_id,
    v_market,
    v_currency,
    case when v_transaction.type = 'BUY' then 'trade_buy' else 'trade_sell' end,
    case when v_transaction.type = 'BUY'
      then -abs(v_transaction.total_amount)
      else abs(v_transaction.total_amount)
    end,
    v_transaction.trans_date,
    v_transaction.id,
    v_transaction.asset_id,
    '交易自動同步'
  );

  return new;
end;
$$;

revoke all on function public.sync_investment_trade_cash() from public, anon, authenticated;

drop trigger if exists sync_investment_trade_cash on public.transactions;
create trigger sync_investment_trade_cash
after insert or update or delete on public.transactions
for each row execute function public.sync_investment_trade_cash();

-- The original trigger used NEW during DELETE. Use OLD safely so editing
-- transaction history does not leave an incorrect open position.
create or replace function public.update_asset_after_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset_id uuid := coalesce(new.asset_id, old.asset_id);
  v_total_shares numeric;
  v_total_cost numeric;
begin
  if tg_op <> 'DELETE' and new.type = 'ADJUST' then
    return new;
  end if;

  select
    sum(case when type = 'BUY' then shares else -shares end),
    sum(case when type = 'BUY' then shares * price else -shares * price end)
  into v_total_shares, v_total_cost
  from public.transactions
  where asset_id = v_asset_id and type <> 'ADJUST';

  update public.assets
  set current_shares = coalesce(v_total_shares, 0),
      average_cost = case when coalesce(v_total_shares, 0) > 0
        then coalesce(v_total_cost, 0) / v_total_shares else 0 end,
      current_amount = coalesce(v_total_cost, 0),
      updated_at = now()
  where id = v_asset_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.update_asset_after_transaction() from public, anon, authenticated;
