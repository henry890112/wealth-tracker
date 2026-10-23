-- Keep a JSON snapshot whenever a FIFO average-cost change rebases an active stop plan.
-- The current table remains one row per user/symbol/market for compatibility;
-- its previous active version is archived before the row is rebased.
create table public.trade_plan_dynamic_stops_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  symbol text not null,
  market_type text not null check (market_type in ('TW', 'US', 'CRYPTO')),
  plan_snapshot jsonb not null,
  archived_at timestamptz not null default now()
);

alter table public.trade_plan_dynamic_stops_history enable row level security;
revoke all on public.trade_plan_dynamic_stops_history from anon, authenticated;
grant select, insert on public.trade_plan_dynamic_stops_history to authenticated;

create policy "Users read own archived dynamic trade plans"
  on public.trade_plan_dynamic_stops_history for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users archive own dynamic trade plans"
  on public.trade_plan_dynamic_stops_history for insert to authenticated
  with check ((select auth.uid()) = user_id);

create or replace function public.require_trade_plan_stop_below_cost()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'active' and new.last_effective_stop >= new.entry_price then
    raise exception '交易計畫停損必須低於 FIFO 均價';
  end if;
  return new;
end;
$$;

revoke execute on function public.require_trade_plan_stop_below_cost() from public, anon, authenticated;

drop trigger if exists trade_plan_stop_below_cost on public.trade_plan_dynamic_stops;
create trigger trade_plan_stop_below_cost
  before insert or update on public.trade_plan_dynamic_stops
  for each row execute function public.require_trade_plan_stop_below_cost();

-- Atomically archive the current version, close it, and adopt a newly
-- calculated plan whose entry basis is the latest FIFO average cost.
create or replace function public.rebase_trade_plan_dynamic_stop(
  p_symbol text,
  p_market_type text,
  p_entry_price numeric,
  p_initial_stop_price numeric,
  p_initial_risk_per_share numeric,
  p_highest_price_since_entry numeric,
  p_last_effective_stop numeric,
  p_last_stop_source text default null,
  p_last_evaluated_at timestamptz default now(),
  p_invalidated_at timestamptz default null,
  p_invalidation_price numeric default null,
  p_invalidation_session_date date default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_symbol text := upper(btrim(coalesce(p_symbol, '')));
  v_market_type text := upper(btrim(coalesce(p_market_type, '')));
  v_existing public.trade_plan_dynamic_stops%rowtype;
begin
  if v_user_id is null then
    raise exception '請先登入';
  end if;
  if v_symbol = '' then
    raise exception '缺少標的代碼';
  end if;
  if v_market_type not in ('TW', 'US', 'CRYPTO') then
    raise exception '市場類型無效';
  end if;
  if not (
    (p_invalidated_at is null and p_invalidation_price is null and p_invalidation_session_date is null)
    or
    (p_invalidated_at is not null and p_invalidation_price is not null
      and p_invalidation_price > 0 and p_invalidation_session_date is not null)
  ) then
    raise exception '停損失效紀錄不完整';
  end if;
  if p_entry_price is null or p_entry_price <= 0
    or p_initial_stop_price is null or p_initial_stop_price <= 0
    or p_initial_stop_price >= p_entry_price
    or p_initial_risk_per_share is null or p_initial_risk_per_share <= 0
    or p_highest_price_since_entry is null or p_highest_price_since_entry <= 0
    or p_last_effective_stop is null or p_last_effective_stop <= 0
    or p_last_effective_stop >= p_entry_price then
    raise exception '交易計畫無效：停損必須低於 FIFO 均價';
  end if;

  select * into v_existing
  from public.trade_plan_dynamic_stops
  where user_id = v_user_id
    and symbol = v_symbol
    and market_type = v_market_type
  for update;

  -- Avoid creating duplicate archived snapshots when multiple screens react to
  -- the same average-cost change at nearly the same time.
  if found
    and v_existing.status = 'active'
    and v_existing.entry_price = p_entry_price
    and v_existing.initial_stop_price < p_entry_price
    and v_existing.last_effective_stop < p_entry_price then
    return;
  end if;

  if found then
    insert into public.trade_plan_dynamic_stops_history (
      user_id, symbol, market_type, plan_snapshot
    ) values (
      v_user_id, v_symbol, v_market_type, to_jsonb(v_existing)
    );

    if v_existing.status = 'active' then
      update public.trade_plan_dynamic_stops
      set status = 'closed', updated_at = now()
      where user_id = v_user_id
        and symbol = v_symbol
        and market_type = v_market_type;
    end if;
  end if;

  insert into public.trade_plan_dynamic_stops (
    user_id,
    symbol,
    market_type,
    entry_price,
    initial_stop_price,
    initial_risk_per_share,
    highest_price_since_entry,
    last_effective_stop,
    last_stop_source,
    last_evaluated_at,
    invalidated_at,
    invalidation_price,
    invalidation_session_date,
    status,
    updated_at
  ) values (
    v_user_id,
    v_symbol,
    v_market_type,
    p_entry_price,
    p_initial_stop_price,
    p_initial_risk_per_share,
    p_highest_price_since_entry,
    p_last_effective_stop,
    p_last_stop_source,
    coalesce(p_last_evaluated_at, now()),
    p_invalidated_at,
    p_invalidation_price,
    p_invalidation_session_date,
    'active',
    now()
  )
  on conflict (user_id, symbol, market_type) do update set
    entry_price = excluded.entry_price,
    initial_stop_price = excluded.initial_stop_price,
    initial_risk_per_share = excluded.initial_risk_per_share,
    highest_price_since_entry = excluded.highest_price_since_entry,
    last_effective_stop = excluded.last_effective_stop,
    last_stop_source = excluded.last_stop_source,
    last_evaluated_at = excluded.last_evaluated_at,
    invalidated_at = excluded.invalidated_at,
    invalidation_price = excluded.invalidation_price,
    invalidation_session_date = excluded.invalidation_session_date,
    status = 'active',
    updated_at = now();
end;
$$;

revoke all on function public.rebase_trade_plan_dynamic_stop(
  text, text, numeric, numeric, numeric, numeric, numeric, text, timestamptz,
  timestamptz, numeric, date
) from public, anon;
grant execute on function public.rebase_trade_plan_dynamic_stop(
  text, text, numeric, numeric, numeric, numeric, numeric, text, timestamptz,
  timestamptz, numeric, date
) to authenticated;
