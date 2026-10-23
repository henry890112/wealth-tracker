-- Some projects grant broad table privileges through default privileges.
-- Keep hybrid position mutations restricted to the backend service role.
revoke all on public.hybrid_strategy_positions from anon, authenticated;
grant select on public.hybrid_strategy_positions to authenticated;
