-- Keep a complete per-symbol analysis, including stocks that do not qualify.
alter table public.investment_signal_events
  add column if not exists is_candidate boolean not null default true;

create index if not exists investment_signal_events_user_candidate_date_idx
  on public.investment_signal_events (user_id, is_candidate, signal_date desc);
