-- Allow authenticated users to write to exchange_rates and price_cache
-- These are shared caches populated client-side; any auth'd user can upsert

CREATE POLICY "Authenticated users can upsert exchange rates."
  ON public.exchange_rates
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update exchange rates."
  ON public.exchange_rates
  FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upsert price cache."
  ON public.price_cache
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update price cache."
  ON public.price_cache
  FOR UPDATE
  USING (auth.role() = 'authenticated');
