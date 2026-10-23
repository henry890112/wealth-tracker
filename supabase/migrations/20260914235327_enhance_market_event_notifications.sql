alter table public.market_event_preferences
  add column if not exists email_enabled boolean not null default false,
  add column if not exists line_enabled boolean not null default false;

update public.market_event_preferences as events
set
  email_enabled = coalesce(signals.email_enabled, false),
  line_enabled = coalesce(signals.line_enabled, false) and signals.line_user_id is not null
from public.investment_signal_preferences as signals
where signals.user_id = events.user_id;
