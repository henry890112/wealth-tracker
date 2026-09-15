-- Investment quotes are returned in their market-native currency.
-- Normalize existing rows so database snapshots and client valuation agree.
UPDATE public.assets
SET currency = CASE market_type
  WHEN 'US' THEN 'USD'
  WHEN 'Crypto' THEN 'USD'
  WHEN 'TW' THEN 'TWD'
  ELSE currency
END
WHERE category = 'investment'
  AND market_type IS NOT NULL;
