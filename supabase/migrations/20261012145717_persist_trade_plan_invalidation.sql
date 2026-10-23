-- Persist a confirmed close-based invalidation so later intraday quotes cannot
-- downgrade the position back to "touched". A new position lifecycle may
-- clear these fields only after the previous row has been marked closed.
alter table public.trade_plan_dynamic_stops
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidation_price numeric,
  add column if not exists invalidation_session_date date;

alter table public.trade_plan_dynamic_stops
  add constraint trade_plan_invalidation_price_positive check (
    invalidation_price is null or invalidation_price > 0
  ),
  add constraint trade_plan_invalidation_fields_consistent check (
    (invalidated_at is null and invalidation_price is null and invalidation_session_date is null)
    or
    (invalidated_at is not null and invalidation_price is not null and invalidation_session_date is not null)
  );

create or replace function public.prevent_trade_plan_stop_loosening()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.status = 'active' and new.status = 'active' then
    if new.last_effective_stop < old.last_effective_stop then
      new.last_effective_stop := old.last_effective_stop;
    end if;
    if new.highest_price_since_entry < old.highest_price_since_entry then
      new.highest_price_since_entry := old.highest_price_since_entry;
    end if;
    new.initial_stop_price := old.initial_stop_price;
    new.initial_risk_per_share := old.initial_risk_per_share;
    new.entry_price := old.entry_price;

    if old.invalidated_at is not null then
      new.invalidated_at := old.invalidated_at;
      new.invalidation_price := old.invalidation_price;
      new.invalidation_session_date := old.invalidation_session_date;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.prevent_trade_plan_stop_loosening() from public, anon, authenticated;
