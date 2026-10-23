# Options analysis Edge Function

This function returns normalized U.S. and Taiwan option expirations and
one-expiration option chains to the signed-in app. U.S. data uses the official
Cboe delayed quote snapshot by default. Taiwan data uses the official TAIFEX
daily market report, daily Delta values, and listed equity-option products.
Neither source requires a secret.

Taiwan Gamma is an estimate derived from the official Delta curve; the
underlying reference is inferred from call-put settlement parity. It is daily
post-close analysis, not a real-time dealer-position feed.

Deploy:

```sh
supabase functions deploy options-analysis
```

Optionally set `TRADIER_ACCESS_TOKEN` before deployment to use Tradier instead.
The production token is required because sandbox chains do not include Greeks.
Do not place this token in an `EXPO_PUBLIC_` environment variable.
