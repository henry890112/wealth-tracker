alter table public.investment_signal_preferences
  add column if not exists signal_directions text[] not null
  default array['bullish', 'bearish']::text[];

alter table public.investment_signal_preferences
  add constraint investment_signal_preferences_signal_directions_check
  check (
    cardinality(signal_directions) > 0
    and signal_directions <@ array['bullish', 'bearish']::text[]
  );
