-- Preserve the initial 1R separately from the stop that follows a position.
-- Existing rows use their currently adopted stop as the initial baseline.
alter table public.trade_plan_dynamic_stops
  add column if not exists initial_stop_price numeric,
  add column if not exists initial_risk_per_share numeric,
  add column if not exists highest_price_since_entry numeric,
  add column if not exists last_stop_source text,
  add column if not exists last_evaluated_at timestamptz;

update public.trade_plan_dynamic_stops
set
  initial_stop_price = coalesce(initial_stop_price, least(last_effective_stop, entry_price - 0.000001)),
  initial_risk_per_share = coalesce(
    initial_risk_per_share,
    greatest(entry_price - least(last_effective_stop, entry_price - 0.000001), 0.000001)
  ),
  highest_price_since_entry = coalesce(highest_price_since_entry, greatest(entry_price, last_effective_stop)),
  last_evaluated_at = coalesce(last_evaluated_at, updated_at);

alter table public.trade_plan_dynamic_stops
  alter column initial_stop_price set not null,
  alter column initial_risk_per_share set not null,
  alter column highest_price_since_entry set not null;

alter table public.trade_plan_dynamic_stops
  add constraint trade_plan_initial_stop_positive check (initial_stop_price > 0),
  add constraint trade_plan_initial_stop_below_entry check (initial_stop_price < entry_price),
  add constraint trade_plan_initial_risk_positive check (initial_risk_per_share > 0),
  add constraint trade_plan_highest_price_positive check (highest_price_since_entry > 0),
  add constraint trade_plan_stop_source_valid check (
    last_stop_source is null or last_stop_source in ('structure', 'atr', 'breakeven', 'trailing_atr', 'tightened')
  );

-- Enforce immutable initial risk and monotonic holding protection at the
-- database boundary. Trigger functions do not need elevated privileges.
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
  end if;
  return new;
end;
$$;

revoke execute on function public.prevent_trade_plan_stop_loosening() from public, anon, authenticated;
