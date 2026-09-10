-- Remote push requires a successfully registered physical device. Keep the
-- preference off until device registration completes in the app.
alter table public.investment_signal_preferences
  alter column push_enabled set default false;

-- Repair preferences that were enabled before registration and therefore can
-- never receive a notification. Existing users with an active device remain on.
update public.investment_signal_preferences as preferences
set push_enabled = false,
    updated_at = now()
where preferences.push_enabled = true
  and not exists (
    select 1
    from public.push_devices as device
    where device.user_id = preferences.user_id
      and device.is_active = true
  );
