-- Preserve the existing confirmation against accidental clearing or stale
-- writes, but allow a later completed-session breach to replace it.
create or replace function public.prevent_trade_plan_stop_loosening()
returns trigger
language plpgsql
security invoker
set search_path = ''
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

    if old.invalidated_at is not null and (
      new.invalidated_at is null
      or new.invalidation_price is null
      or new.invalidation_session_date is null
      or new.invalidation_session_date <= old.invalidation_session_date
    ) then
      new.invalidated_at := old.invalidated_at;
      new.invalidation_price := old.invalidation_price;
      new.invalidation_session_date := old.invalidation_session_date;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.prevent_trade_plan_stop_loosening() from public, anon, authenticated;
