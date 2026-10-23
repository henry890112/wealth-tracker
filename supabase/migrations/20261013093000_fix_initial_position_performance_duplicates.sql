-- Opening-position snapshots are audit records, not a second broker fill.
-- Keep them visible while excluding a confirmed overlap from FIFO and cash flow.
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

  if v_transaction.ignored_from_performance
    or v_transaction.type not in ('BUY', 'SELL') then
    return new;
  end if;

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
      when v_transaction.external_source = 'initial_position'
      then '期初持倉'
      else '交易自動同步'
    end
  );

  return new;
end;
$$;

revoke all on function public.sync_investment_trade_cash() from public, anon, authenticated;

-- Backfill only high-confidence overlaps: an unlabelled BUY created within ten
-- seconds of an E.Sun asset, followed by a same-quantity, nearby-price E.Sun
-- BUY within 36 hours. This catches opening snapshots without hiding unrelated
-- purchases.
with overlapping_opening_positions as (
  select distinct snapshot.id
  from public.transactions snapshot
  join public.assets asset on asset.id = snapshot.asset_id
  join public.transactions broker
    on broker.asset_id = snapshot.asset_id
   and broker.external_source = 'esun'
   and broker.type = 'BUY'
   and abs(broker.shares - snapshot.shares) < 0.00000001
   and broker.price > 0
   and abs(snapshot.price - broker.price) / broker.price <= 0.03
   and abs(extract(epoch from (snapshot.trans_date - broker.trans_date))) <= 36 * 60 * 60
  where asset.external_source = 'esun'
    and snapshot.type = 'BUY'
    and snapshot.external_source is null
    and snapshot.external_id is null
    and snapshot.affects_position
    and abs(extract(epoch from (snapshot.created_at - asset.created_at))) <= 10
)
update public.transactions transaction
set external_source = 'initial_position',
    ignored_from_performance = true,
    affects_position = false
from overlapping_opening_positions overlap
where transaction.id = overlap.id;

delete from public.investment_cash_ledger ledger
using public.transactions transaction
where ledger.transaction_id = transaction.id
  and transaction.ignored_from_performance;

comment on column public.transactions.ignored_from_performance is
  'When true, retain the transaction for history but exclude it from FIFO and investment cash-flow performance.';
