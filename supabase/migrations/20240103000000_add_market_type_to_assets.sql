-- Add market_type to assets table so investment assets can be sub-grouped
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS market_type market_type;
