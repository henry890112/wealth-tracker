-- Create ENUMs
CREATE TYPE asset_category AS ENUM ('liquid', 'investment', 'fixed', 'receivable', 'liability');
CREATE TYPE transaction_type AS ENUM ('BUY', 'SELL', 'ADJUST');
CREATE TYPE market_type AS ENUM ('TW', 'US', 'Crypto');

-- Create tables

-- profiles table
CREATE TABLE public.profiles (
    id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL PRIMARY KEY,
    base_currency text DEFAULT 'TWD' NOT NULL,
    color_convention text DEFAULT 'red_down_green_up' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- assets table
CREATE TABLE public.assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid REFERENCES public.profiles ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    symbol text,
    category asset_category NOT NULL,
    currency text NOT NULL,
    current_amount numeric DEFAULT 0 NOT NULL,
    current_shares numeric DEFAULT 0 NOT NULL,
    average_cost numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- transactions table
CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    asset_id uuid REFERENCES public.assets ON DELETE CASCADE NOT NULL,
    type transaction_type NOT NULL,
    shares numeric NOT NULL,
    price numeric NOT NULL,
    total_amount numeric NOT NULL,
    trans_date timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- watchlist table
CREATE TABLE public.watchlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid REFERENCES public.profiles ON DELETE CASCADE NOT NULL,
    symbol text NOT NULL,
    market_type market_type NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT unique_watchlist_item UNIQUE (user_id, symbol, market_type)
);

-- daily_snapshots table
CREATE TABLE public.daily_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid REFERENCES public.profiles ON DELETE CASCADE NOT NULL,
    snapshot_date date DEFAULT now() NOT NULL,
    net_worth_base numeric NOT NULL,
    total_assets numeric DEFAULT 0 NOT NULL,
    total_liabilities numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT unique_daily_snapshot UNIQUE (user_id, snapshot_date)
);

-- exchange_rates table
CREATE TABLE public.exchange_rates (
    from_currency text NOT NULL,
    to_currency text NOT NULL,
    rate numeric NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (from_currency, to_currency)
);

-- price_cache table
CREATE TABLE public.price_cache (
    symbol text NOT NULL,
    market_type market_type NOT NULL,
    price numeric NOT NULL,
    change_percent numeric DEFAULT 0 NOT NULL,
    volume numeric DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (symbol, market_type)
);

-- Set up Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;

-- RLS policies for profiles
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile." ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));
CREATE POLICY "Users can update own profile." ON public.profiles FOR UPDATE USING ((auth.uid() = id));
CREATE POLICY "Users can delete own profile." ON public.profiles FOR DELETE USING ((auth.uid() = id));

-- RLS policies for assets
CREATE POLICY "Assets are viewable by owner." ON public.assets FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own assets." ON public.assets FOR INSERT WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update own assets." ON public.assets FOR UPDATE USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete own assets." ON public.assets FOR DELETE USING ((auth.uid() = user_id));

-- RLS policies for transactions
CREATE POLICY "Transactions are viewable by owner." ON public.transactions FOR SELECT USING ((EXISTS (SELECT 1 FROM public.assets WHERE (transactions.asset_id = assets.id) AND (assets.user_id = auth.uid()))));
CREATE POLICY "Users can insert their own transactions." ON public.transactions FOR INSERT WITH CHECK ((EXISTS (SELECT 1 FROM public.assets WHERE (transactions.asset_id = assets.id) AND (assets.user_id = auth.uid()))));
CREATE POLICY "Users can update own transactions." ON public.transactions FOR UPDATE USING ((EXISTS (SELECT 1 FROM public.assets WHERE (transactions.asset_id = assets.id) AND (assets.user_id = auth.uid()))));
CREATE POLICY "Users can delete own transactions." ON public.transactions FOR DELETE USING ((EXISTS (SELECT 1 FROM public.assets WHERE (transactions.asset_id = assets.id) AND (assets.user_id = auth.uid()))));

-- RLS policies for watchlist
CREATE POLICY "Watchlist items are viewable by owner." ON public.watchlist FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own watchlist items." ON public.watchlist FOR INSERT WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update own watchlist items." ON public.watchlist FOR UPDATE USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete own watchlist items." ON public.watchlist FOR DELETE USING ((auth.uid() = user_id));

-- RLS policies for daily_snapshots
CREATE POLICY "Daily snapshots are viewable by owner." ON public.daily_snapshots FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert their own daily snapshots." ON public.daily_snapshots FOR INSERT WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update own daily snapshots." ON public.daily_snapshots FOR UPDATE USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete own daily snapshots." ON public.daily_snapshots FOR DELETE USING ((auth.uid() = user_id));

-- RLS policies for exchange_rates (public read)
CREATE POLICY "Exchange rates are public." ON public.exchange_rates FOR SELECT USING (true);

-- RLS policies for price_cache (public read)
CREATE POLICY "Price cache is public." ON public.price_cache FOR SELECT USING (true);


-- Create or Replace Function: update_asset_after_transaction
CREATE OR REPLACE FUNCTION public.update_asset_after_transaction()
RETURNS TRIGGER AS $$
DECLARE
    v_total_shares NUMERIC;
    v_total_cost NUMERIC;
BEGIN
    -- Calculate total shares and total cost for the asset
    SELECT
        SUM(CASE WHEN type = 'BUY' THEN shares ELSE -shares END),
        SUM(CASE WHEN type = 'BUY' THEN shares * price ELSE -shares * price END)
    INTO
        v_total_shares,
        v_total_cost
    FROM public.transactions
    WHERE asset_id = NEW.asset_id;

    -- Update the asset's current_shares, average_cost, and current_amount
    UPDATE public.assets
    SET
        current_shares = COALESCE(v_total_shares, 0),
        average_cost = CASE
                            WHEN COALESCE(v_total_shares, 0) > 0 THEN COALESCE(v_total_cost, 0) / v_total_shares
                            ELSE 0
                       END,
        current_amount = COALESCE(v_total_cost, 0) -- Assuming current_amount is tied to total cost for simplicity
    WHERE id = NEW.asset_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create Trigger: update_asset_after_transaction
CREATE TRIGGER update_asset_after_transaction
AFTER INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.update_asset_after_transaction();

-- Create or Replace Function: handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, base_currency, color_convention)
  VALUES (NEW.id, 'TWD', 'red_down_green_up');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create Trigger: on_auth_user_created
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create or Replace Function: create_daily_snapshot
CREATE OR REPLACE FUNCTION public.create_daily_snapshot(p_user_id uuid)
RETURNS VOID AS $$
DECLARE
    v_base_currency TEXT;
    v_total_assets NUMERIC := 0;
    v_total_liabilities NUMERIC := 0;
    v_net_worth NUMERIC := 0;
    asset_record RECORD;
    current_rate NUMERIC;
BEGIN
    -- Get user's base currency
    SELECT base_currency INTO v_base_currency FROM public.profiles WHERE id = p_user_id;

    -- Calculate total assets and liabilities in base currency
    FOR asset_record IN
        SELECT id, current_amount, currency, category
        FROM public.assets
        WHERE user_id = p_user_id
    LOOP
        -- Get exchange rate (or 1 if same currency)
        IF asset_record.currency = v_base_currency THEN
            current_rate := 1;
        ELSE
            SELECT rate INTO current_rate
            FROM public.exchange_rates
            WHERE from_currency = asset_record.currency AND to_currency = v_base_currency;

            -- If rate not found, log error and skip conversion
            IF current_rate IS NULL THEN
                RAISE WARNING 'Exchange rate not found for % to %.', asset_record.currency, v_base_currency;
                current_rate := 1; -- Fallback to 1, or handle as error
            END IF;
        END IF;

        IF asset_record.category = 'liability' THEN
            v_total_liabilities := v_total_liabilities + (asset_record.current_amount * current_rate);
        ELSE
            v_total_assets := v_total_assets + (asset_record.current_amount * current_rate);
        END IF;
    END LOOP;

    v_net_worth := v_total_assets - v_total_liabilities;

    -- Insert into daily_snapshots, handling potential conflicts on unique_daily_snapshot
    INSERT INTO public.daily_snapshots (user_id, snapshot_date, net_worth_base, total_assets, total_liabilities)
    VALUES (p_user_id, CURRENT_DATE, v_net_worth, v_total_assets, v_total_liabilities)
    ON CONFLICT (user_id, snapshot_date) DO UPDATE
    SET
        net_worth_base = EXCLUDED.net_worth_base,
        total_assets = EXCLUDED.total_assets,
        total_liabilities = EXCLUDED.total_liabilities,
        created_at = now();
END;
$$ LANGUAGE plpgsql;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create indexes
CREATE INDEX assets_user_id_idx ON public.assets (user_id);
CREATE INDEX transactions_asset_id_idx ON public.transactions (asset_id);
CREATE INDEX watchlist_user_id_idx ON public.watchlist (user_id);
CREATE INDEX daily_snapshots_user_id_snapshot_date_idx ON public.daily_snapshots (user_id, snapshot_date);
CREATE INDEX price_cache_symbol_market_type_idx ON public.price_cache (symbol, market_type);
