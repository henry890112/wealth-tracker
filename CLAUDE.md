# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm start          # Start Expo development server
npm run android    # Launch on Android emulator
npm run ios        # Launch on iOS simulator
npm run web        # Launch in web browser

# Supabase (local development requires Docker Desktop)
supabase start     # Start local Supabase containers
supabase stop      # Stop containers
supabase db reset  # Wipe DB and re-apply all migrations
supabase status    # Show local URLs and anon key

# Cloud deployment
supabase login
supabase link --project-ref <ref>
supabase db push   # Push migrations to cloud
```

No lint or test scripts are configured yet.

## Architecture

**Stack:** React Native (Expo 54) + Supabase (PostgreSQL + Auth)

**Entry point:** [App.js](App.js) manages auth state via Supabase real-time listener and conditionally renders either `AuthScreen` or the bottom tab navigator.

**Navigation:** Bottom tabs (Dashboard → Search → Trends → Settings) with a stack navigator inside Dashboard for `AssetDetailScreen`.

**State management:** No Redux or Context — each screen fetches data directly from Supabase with `useState`/`useEffect`. Sessions persist via `@react-native-async-storage`.

**External data:** [src/services/api.js](src/services/api.js) abstracts three APIs:
- **FinMind** — Taiwan & US stock prices and search
- **CoinGecko** — Crypto prices and search
- **ExchangeRate API** — Currency conversion

All API results are cached in Supabase (`price_cache`, `exchange_rates` tables) with a 5-minute TTL to avoid rate limits.

**Currency conversion:** Every screen fetches the user's `base_currency` from `profiles`, then calls `convertToBaseCurrency()` in `api.js` before displaying amounts.

## Database Schema

Migrations live in [supabase/migrations/](supabase/migrations/). Key tables:

| Table | Purpose |
|---|---|
| `profiles` | Per-user settings: `base_currency` (TWD default), `color_convention` |
| `assets` | Holdings with `category` ENUM: `liquid`, `investment`, `fixed`, `receivable`, `liability` |
| `transactions` | BUY/SELL/ADJUST history per asset |
| `daily_snapshots` | One row per (user, date) for net worth history — drives TrendsScreen |
| `price_cache` | Cached stock/crypto prices |
| `exchange_rates` | Cached FX rates |

**RLS:** Each user can only access their own rows. `price_cache` and `exchange_rates` are public read-only.

**Triggers:**
- `handle_new_user` — auto-creates a `profiles` row on signup
- `update_asset_after_transaction` — updates `current_shares` and `average_cost` on the asset after each transaction insert

**Net worth formula:**
```
Net Worth = (liquid + investment + fixed + receivable) − liability
```

## Environment Setup

Copy `.env.example` to `.env` and fill in the anon key printed by `supabase start`:

```
EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<from supabase start output>
```

For cloud, use the project URL and anon key from the Supabase dashboard.

## Local Supabase Ports

| Service | Port |
|---|---|
| API | 54321 |
| Database | 54322 |
| Studio | 54323 |
| Inbucket (email) | 54324 |
