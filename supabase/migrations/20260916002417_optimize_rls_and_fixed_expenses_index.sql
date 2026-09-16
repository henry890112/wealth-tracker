-- Avoid evaluating auth helpers once per row in owner-only policies.
alter policy "Users can delete own profile." on public.profiles
  using ((select auth.uid()) = id);
alter policy "Users can insert their own profile." on public.profiles
  with check ((select auth.uid()) = id);
alter policy "Users can update own profile." on public.profiles
  using ((select auth.uid()) = id);

alter policy "Assets are viewable by owner." on public.assets
  using ((select auth.uid()) = user_id);
alter policy "Users can delete own assets." on public.assets
  using ((select auth.uid()) = user_id);
alter policy "Users can insert their own assets." on public.assets
  with check ((select auth.uid()) = user_id);
alter policy "Users can update own assets." on public.assets
  using ((select auth.uid()) = user_id);

alter policy "Transactions are viewable by owner." on public.transactions
  using (exists (
    select 1 from public.assets
    where transactions.asset_id = assets.id
      and assets.user_id = (select auth.uid())
  ));
alter policy "Users can delete own transactions." on public.transactions
  using (exists (
    select 1 from public.assets
    where transactions.asset_id = assets.id
      and assets.user_id = (select auth.uid())
  ));
alter policy "Users can insert their own transactions." on public.transactions
  with check (exists (
    select 1 from public.assets
    where transactions.asset_id = assets.id
      and assets.user_id = (select auth.uid())
  ));
alter policy "Users can update own transactions." on public.transactions
  using (exists (
    select 1 from public.assets
    where transactions.asset_id = assets.id
      and assets.user_id = (select auth.uid())
  ));

alter policy "Users can delete own watchlist items." on public.watchlist
  using ((select auth.uid()) = user_id);
alter policy "Users can insert their own watchlist items." on public.watchlist
  with check ((select auth.uid()) = user_id);
alter policy "Users can update own watchlist items." on public.watchlist
  using ((select auth.uid()) = user_id);
alter policy "Watchlist items are viewable by owner." on public.watchlist
  using ((select auth.uid()) = user_id);

alter policy "Daily snapshots are viewable by owner." on public.daily_snapshots
  using ((select auth.uid()) = user_id);
alter policy "Users can delete own daily snapshots." on public.daily_snapshots
  using ((select auth.uid()) = user_id);
alter policy "Users can insert their own daily snapshots." on public.daily_snapshots
  with check ((select auth.uid()) = user_id);
alter policy "Users can update own daily snapshots." on public.daily_snapshots
  using ((select auth.uid()) = user_id);

alter policy "Authenticated users can update exchange rates." on public.exchange_rates
  using ((select auth.role()) = 'authenticated');
alter policy "Authenticated users can upsert exchange rates." on public.exchange_rates
  with check ((select auth.role()) = 'authenticated');
alter policy "Authenticated users can update price cache." on public.price_cache
  using ((select auth.role()) = 'authenticated');
alter policy "Authenticated users can upsert price cache." on public.price_cache
  with check ((select auth.role()) = 'authenticated');

alter policy "Users can manage their own fixed expenses" on public.fixed_expenses
  using ((select auth.uid()) = user_id);

alter policy "Users can insert own category snapshots" on public.category_snapshots
  with check ((select auth.uid()) = user_id);
alter policy "Users can read own category snapshots" on public.category_snapshots
  using ((select auth.uid()) = user_id);
alter policy "Users can update own category snapshots" on public.category_snapshots
  using ((select auth.uid()) = user_id);

create index if not exists fixed_expenses_user_id_idx
  on public.fixed_expenses (user_id);
