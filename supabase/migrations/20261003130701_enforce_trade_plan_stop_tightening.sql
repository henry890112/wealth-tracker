-- Guard the monotonic-stop rule at the database boundary as well as in the app.
create or replace function public.prevent_trade_plan_stop_loosening()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active'
    and new.status = 'active'
    and new.last_effective_stop < old.last_effective_stop then
    new.last_effective_stop := old.last_effective_stop;
  end if;
  return new;
end;
$$;

revoke execute on function public.prevent_trade_plan_stop_loosening() from public, anon, authenticated;

drop trigger if exists trade_plan_stop_must_tighten on public.trade_plan_dynamic_stops;
create trigger trade_plan_stop_must_tighten
  before update on public.trade_plan_dynamic_stops
  for each row execute function public.prevent_trade_plan_stop_loosening();
