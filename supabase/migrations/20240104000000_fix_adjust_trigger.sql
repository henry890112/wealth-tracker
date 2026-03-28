-- Fix trigger to skip recalculation for ADJUST transactions.
-- ADJUST is used for manual balance entries (non-investment assets) and
-- should not overwrite current_amount via shares*price formula.

CREATE OR REPLACE FUNCTION public.update_asset_after_transaction()
RETURNS TRIGGER AS $$
DECLARE
    v_total_shares NUMERIC;
    v_total_cost NUMERIC;
BEGIN
    -- ADJUST transactions are manual entries; skip auto-recalculation
    IF NEW.type = 'ADJUST' THEN
        RETURN NEW;
    END IF;

    SELECT
        SUM(CASE WHEN type = 'BUY' THEN shares ELSE -shares END),
        SUM(CASE WHEN type = 'BUY' THEN shares * price ELSE -shares * price END)
    INTO
        v_total_shares,
        v_total_cost
    FROM public.transactions
    WHERE asset_id = NEW.asset_id AND type != 'ADJUST';

    UPDATE public.assets
    SET
        current_shares = COALESCE(v_total_shares, 0),
        average_cost = CASE
                            WHEN COALESCE(v_total_shares, 0) > 0 THEN COALESCE(v_total_cost, 0) / v_total_shares
                            ELSE 0
                       END,
        current_amount = COALESCE(v_total_cost, 0)
    WHERE id = NEW.asset_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
