-- Pin function name resolution to trusted schemas.
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.update_asset_after_transaction() set search_path = public, pg_temp;
alter function public.create_daily_snapshot(uuid) set search_path = public, pg_temp;

-- Trigger functions are invoked by their triggers and must not be exposed as RPCs.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.update_asset_after_transaction() from public, anon, authenticated;
