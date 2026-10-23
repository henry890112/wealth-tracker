-- Position risk is derived from actual holdings and the adopted stop.
-- The former fixed amount was only used to suggest a position size and is no
-- longer part of the trade-plan model.
alter table public.trade_plan_settings
  drop column if exists max_loss_amount;
