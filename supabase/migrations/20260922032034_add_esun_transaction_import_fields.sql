alter table public.transactions
  add column if not exists external_source text,
  add column if not exists external_id text,
  add column if not exists fee numeric not null default 0 check (fee >= 0),
  add column if not exists tax numeric not null default 0 check (tax >= 0),
  add column if not exists affects_position boolean not null default true,
  add column if not exists external_payload jsonb;

alter table public.assets
  add column if not exists external_source text;

alter table public.transactions
  drop constraint if exists transactions_external_source_id_key;

alter table public.transactions
  add constraint transactions_external_source_id_key
  unique (asset_id, external_source, external_id);

comment on column public.transactions.affects_position is
  'False for partial-history broker imports. Current position remains authoritative from broker inventory sync.';

-- Imported broker fills must contribute to performance cash flows without
-- rebuilding the current position from a limited transaction-history window.
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
  if tg_op <> 'DELETE' and (new.type = 'ADJUST' or not new.affects_position) then
    return new;
  end if;
  if tg_op = 'DELETE' and not old.affects_position then
    return old;
  end if;

  select
    sum(case when type = 'BUY' then shares else -shares end),
    sum(case when type = 'BUY' then shares * price else -shares * price end)
  into v_total_shares, v_total_cost
  from public.transactions
  where asset_id = v_asset_id
    and type <> 'ADJUST'
    and affects_position;

  update public.assets
  set current_shares = coalesce(v_total_shares, 0),
      average_cost = case when coalesce(v_total_shares, 0) > 0
        then coalesce(v_total_cost, 0) / v_total_shares else 0 end,
      current_amount = coalesce(v_total_cost, 0),
      updated_at = now()
  where id = v_asset_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.update_asset_after_transaction() from public, anon, authenticated;

-- The performance ledger stores the actual broker cash effect: consideration
-- plus fees/tax for buys, less fees/tax for sells.
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
  v_cash_amount numeric;
begin
  if tg_op = 'DELETE' then
    delete from public.investment_cash_ledger where transaction_id = old.id;
    return old;
  end if;

  v_transaction := new;
  delete from public.investment_cash_ledger where transaction_id = v_transaction.id;

  if v_transaction.type not in ('BUY', 'SELL') then return new; end if;

  select * into v_asset from public.assets where id = v_transaction.asset_id;
  if not found or v_asset.category <> 'investment' then return new; end if;

  v_user_id := v_asset.user_id;
  select start_date into v_start_date
  from public.investment_performance_settings
  where user_id = v_user_id;
  if v_start_date is null or v_transaction.trans_date::date < v_start_date then return new; end if;

  v_market := upper(coalesce(v_asset.market_type::text, 'OTHER'));
  v_currency := upper(coalesce(v_asset.currency,
    case when v_market = 'TW' then 'TWD' else 'USD' end));
  v_cash_amount := case when v_transaction.type = 'BUY'
    then -(abs(v_transaction.total_amount) + v_transaction.fee + v_transaction.tax)
    else greatest(abs(v_transaction.total_amount) - v_transaction.fee - v_transaction.tax, 0)
  end;

  insert into public.investment_cash_ledger (
    user_id, market, currency, kind, amount_native, occurred_at,
    transaction_id, asset_id, note
  ) values (
    v_user_id,
    v_market,
    v_currency,
    case when v_transaction.type = 'BUY' then 'trade_buy' else 'trade_sell' end,
    v_cash_amount,
    v_transaction.trans_date,
    v_transaction.id,
    v_transaction.asset_id,
    case when v_transaction.external_source = 'esun'
      then '玉山證券成交自動同步'
      else '交易自動同步'
    end
  );

  return new;
end;
$$;

revoke all on function public.sync_investment_trade_cash() from public, anon, authenticated;

-- UPDATE must also prevent moving a transaction onto another user's asset.
alter policy "Users can update own transactions." on public.transactions
  using (exists (
    select 1 from public.assets
    where transactions.asset_id = assets.id
      and assets.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.assets
    where transactions.asset_id = assets.id
      and assets.user_id = (select auth.uid())
  ));
