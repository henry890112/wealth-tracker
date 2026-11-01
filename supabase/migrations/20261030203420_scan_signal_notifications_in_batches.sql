-- Scan five symbols per invocation during the first ten minutes of each hour.
-- Keeping the existing job name replaces its former hourly schedule.
select cron.schedule(
  'hourly-signal-notifications',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://elmbytbagswxuqlcrclc.supabase.co/functions/v1/signal-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-signal-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'signal_cron_secret_schedule')
    ),
    body := '{"action":"run"}'::jsonb,
    timeout_milliseconds := 300000
  ) as request_id;
  $job$
);
