-- Rebuild investment basis from open FIFO lots. Sale proceeds are realized
-- P&L; they must not be subtracted from the remaining shares' cost basis.
create or replace function public.recalculate_asset_position(p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transaction record;
  v_lot_shares numeric[] := array[]::numeric[];
  v_lot_unit_costs numeric[] := array[]::numeric[];
  v_lot_index integer := 1;
  v_lot_count integer := 0;
  v_index integer := 1;
  v_shares numeric;
  v_price numeric;
  v_charges numeric;
  v_remaining_to_sell numeric;
  v_matched numeric;
  v_open_shares numeric := 0;
  v_open_cost numeric := 0;
  v_signed_shares numeric := 0;
begin
  select coalesce(sum(case when type = 'BUY' then abs(shares) else -abs(shares) end), 0)
  into v_signed_shares
  from public.transactions
  where asset_id = p_asset_id
    and type in ('BUY', 'SELL')
    and affects_position;

  for v_transaction in
    select type::text as type, shares, price, fee, tax
    from public.transactions
    where asset_id = p_asset_id
      and type in ('BUY', 'SELL')
      and affects_position
    order by trans_date, created_at, id
  loop
    v_shares := abs(coalesce(v_transaction.shares, 0));
    v_price := coalesce(v_transaction.price, 0);
    v_charges := greatest(0, coalesce(v_transaction.fee, 0))
      + greatest(0, coalesce(v_transaction.tax, 0));
    if v_shares <= 0 or v_price < 0 then
      continue;
    end if;

    if v_transaction.type = 'BUY' then
      v_lot_shares := array_append(v_lot_shares, v_shares);
      v_lot_unit_costs := array_append(v_lot_unit_costs, v_price + v_charges / v_shares);
      v_lot_count := v_lot_count + 1;
      continue;
    end if;

    v_remaining_to_sell := v_shares;
    while v_remaining_to_sell > 0 and v_lot_index <= v_lot_count loop
      if v_lot_shares[v_lot_index] <= 0.00000001 then
        v_lot_index := v_lot_index + 1;
        continue;
      end if;
      v_matched := least(v_lot_shares[v_lot_index], v_remaining_to_sell);
      v_lot_shares[v_lot_index] := greatest(0, v_lot_shares[v_lot_index] - v_matched);
      v_remaining_to_sell := greatest(0, v_remaining_to_sell - v_matched);
      if v_lot_shares[v_lot_index] <= 0.00000001 then
        v_lot_index := v_lot_index + 1;
      end if;
    end loop;
  end loop;

  v_index := v_lot_index;
  while v_index <= v_lot_count loop
    if v_lot_shares[v_index] > 0.00000001 then
      v_open_shares := v_open_shares + v_lot_shares[v_index];
      v_open_cost := v_open_cost + v_lot_shares[v_index] * v_lot_unit_costs[v_index];
    end if;
    v_index := v_index + 1;
  end loop;

  update public.assets
  set current_shares = v_signed_shares,
      average_cost = case
        when v_open_shares > 0 and abs(v_open_shares - v_signed_shares) <= 0.000001
          then v_open_cost / v_open_shares
        else 0
      end,
      updated_at = now()
  where id = p_asset_id;
end;
$$;

revoke all on function public.recalculate_asset_position(uuid) from public, anon, authenticated;

create or replace function public.update_asset_after_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.type in ('BUY', 'SELL') and old.affects_position then
      perform public.recalculate_asset_position(old.asset_id);
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.type in ('BUY', 'SELL') and new.affects_position then
      perform public.recalculate_asset_position(new.asset_id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.asset_id is distinct from new.asset_id then
      if old.type in ('BUY', 'SELL') and old.affects_position then
        perform public.recalculate_asset_position(old.asset_id);
      end if;
      if new.type in ('BUY', 'SELL') and new.affects_position then
        perform public.recalculate_asset_position(new.asset_id);
      end if;
    elsif (old.type in ('BUY', 'SELL') and old.affects_position)
       or (new.type in ('BUY', 'SELL') and new.affects_position) then
      perform public.recalculate_asset_position(new.asset_id);
    end if;
    return new;
  end if;

  return null;
end;
$$;

revoke all on function public.update_asset_after_transaction() from public, anon, authenticated;

-- Repair only assets whose saved share count agrees with their complete
-- position-affecting ledger. Broker inventory remains authoritative otherwise.
do $$
declare
  v_asset_id uuid;
begin
  for v_asset_id in
    select asset.id
    from public.assets asset
    where asset.category = 'investment'
      and exists (
        select 1
        from public.transactions tx
        where tx.asset_id = asset.id
          and tx.type in ('BUY', 'SELL')
          and tx.affects_position
      )
      and abs(
        coalesce(asset.current_shares, 0)
        - coalesce((
          select sum(case when tx.type = 'BUY' then abs(tx.shares) else -abs(tx.shares) end)
          from public.transactions tx
          where tx.asset_id = asset.id
            and tx.type in ('BUY', 'SELL')
            and tx.affects_position
        ), 0)
      ) <= 0.000001
  loop
    perform public.recalculate_asset_position(v_asset_id);
  end loop;
end;
$$;
