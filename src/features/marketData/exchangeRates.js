import { supabase } from '../../lib/supabase';

const BOT_CSV_URL = 'https://rate.bot.com.tw/xrt/flcsv/0/day';

/**
 * Fetch BOT (Bank of Taiwan) daily rates CSV.
 * Returns { USD: 31.995, JPY: 0.2018, EUR: 36.97, ... }
 * Values = TWD per 1 unit of foreign currency (即期賣出, col 13).
 */
const fetchBOTRates = async () => {
  const response = await fetch(BOT_CSV_URL);
  if (!response.ok) throw new Error(`BOT CSV HTTP ${response.status}`);
  const text = await response.text();
  const rates = {};
  const lines = text.split('\n');
  // Line 0 is header; data starts at line 1
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].trim().split(',');
    if (cols.length < 14) continue;
    const currency = cols[0].trim();
    const buySpot  = parseFloat(cols[12]);
    const sellSpot = parseFloat(cols[13]);
    if (currency && !isNaN(buySpot) && !isNaN(sellSpot) && buySpot > 0 && sellSpot > 0) {
      rates[currency] = { buySpot, sellSpot };
    }
  }
  return rates; // { USD: { buySpot: 31.795, sellSpot: 31.995 }, ... }
};

/**
 * Fetch BOT daily rates with both spot buying and selling.
 * Returns { USD: { buy: 31.795, sell: 32.150 }, JPY: { buy: 0.2032, sell: 0.2065 }, ... }
 * buy  = 即期買入 (col 12), sell = 即期賣出 (col 13)
 * TWD per 1 unit of foreign currency.
 */
export const fetchBOTRatesDetailed = async () => {
  const response = await fetch(BOT_CSV_URL);
  if (!response.ok) throw new Error(`BOT CSV HTTP ${response.status}`);
  const text = await response.text();
  const rates = {};
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].trim().split(',');
    if (cols.length < 14) continue;
    const currency = cols[0].trim();
    const spotBuying  = parseFloat(cols[12]);
    const spotSelling = parseFloat(cols[13]);
    if (currency && !isNaN(spotBuying) && !isNaN(spotSelling) && spotBuying > 0 && spotSelling > 0) {
      rates[currency] = { buy: spotBuying, sell: spotSelling };
    }
  }
  return rates;
};

/**
 * Fetch BOT rates enhanced with yesterday's rates and weekly sparkline data.
 * Returns { USD: { buy, sell, sparkPoints: [buy1, buy2, ...] }, ... }
 * buy/sell = today's 即期買入/賣出 (TWD per 1 foreign unit); KRW uses 現金 rates (no 即期)
 * sparkPoints = last 14 trading days buy rates from Yahoo Finance (oldest → newest)
 */
export const fetchBOTRatesForFX = async () => {
  const parseRows = (text) => {
    // BOT CSV columns:
    //   [0]=幣別 [1]=本行買入 [2]=現金買入 [3]=即期買入 [4-10]=遠期買入
    //   [11]=本行賣出 [12]=現金賣出 [13]=即期賣出 [14-20]=遠期賣出
    // KRW and some currencies have no 即期 (cols[3]/[13] = 0), fall back to 現金
    const rows = {};
    const lines = text.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].trim().split(',');
      if (cols.length < 14) continue;
      const currency = cols[0].trim();
      const buy  = parseFloat(cols[3])  || parseFloat(cols[2]);   // 即期買入 → 現金買入
      const sell = parseFloat(cols[13]) || parseFloat(cols[12]);  // 即期賣出 → 現金賣出
      if (currency && !isNaN(buy) && !isNaN(sell) && buy > 0 && sell > 0) {
        rows[currency] = { buy, sell };
      }
    }
    return rows;
  };

  // /week and /ltm endpoints are currently blocked (302); only /day is reliable
  const dayResult = await fetch(BOT_CSV_URL).catch(() => null);
  const dayRows = (dayResult?.ok) ? parseRows(await dayResult.text()) : {};

  // Fetch 14-day buy-rate history from Yahoo Finance for sparklines
  const FX_YAHOO_MAP = {
    USD: 'USDTWD=X', JPY: 'JPYTWD=X', EUR: 'EURTWD=X', GBP: 'GBPTWD=X',
    CNY: 'CNYTWD=X', HKD: 'HKDTWD=X', AUD: 'AUDTWD=X', SGD: 'SGDTWD=X', KRW: 'KRWTWD=X',
  };
  const sparkResults = await Promise.allSettled(
    Object.entries(FX_YAHOO_MAP).map(async ([code, ticker]) => {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1mo&interval=1d`
      );
      const data = await r.json();
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
      const pts = closes.filter(v => v != null).slice(-14);
      return { code, pts };
    })
  );
  const sparkMap = {};
  for (const res of sparkResults) {
    if (res.status === 'fulfilled' && res.value.pts.length > 1) {
      sparkMap[res.value.code] = res.value.pts;
    }
  }

  const result = {};
  for (const [currency, { buy, sell }] of Object.entries(dayRows)) {
    result[currency] = {
      buy,
      sell,
      prevBuy:  null,
      prevSell: null,
      sparkPoints: sparkMap[currency] ?? null,
    };
  }
  // Merge in currencies only in sparkMap but missing from BOT (shouldn't happen, but safe)
  for (const code of Object.keys(FX_YAHOO_MAP)) {
    if (!result[code] && sparkMap[code]) {
      const pts = sparkMap[code];
      result[code] = { buy: pts[pts.length-1], sell: pts[pts.length-1], prevBuy: null, prevSell: null, sparkPoints: pts };
    }
  }

  return result;
};

/**
 * Fallback: fetch exchange rate from exchangerate-api.com.
 */
const fetchExchangeRateFallback = async (fromCurrency, toCurrency) => {
  const providers = [
    `https://api.exchangerate-api.com/v4/latest/${fromCurrency}`,
    `https://open.er-api.com/v6/latest/${fromCurrency}`,
  ];
  for (const url of providers) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      if (data.rates && data.rates[toCurrency]) return data.rates[toCurrency];
    } catch { /* try the next provider */ }
  }
  throw new Error(`exchange rate not found for ${fromCurrency}→${toCurrency}`);
};

/**
 * Fetch exchange rate using Bank of Taiwan 即期賣出 (spot selling) rates.
 * Falls back to exchangerate-api.com for currencies not in BOT (e.g. KRW).
 */
export const fetchExchangeRate = async (fromCurrency, toCurrency) => {
  let cachedRate = null;
  try {
    const { data: cached } = await supabase
      .from('exchange_rates')
      .select('*')
      .eq('from_currency', fromCurrency)
      .eq('to_currency', toCurrency)
      .single();

    const parsedCachedRate = parseFloat(cached?.rate);
    if (Number.isFinite(parsedCachedRate) && parsedCachedRate > 0) cachedRate = parsedCachedRate;

    let rate;
    if (fromCurrency === toCurrency) {
      rate = 1;
    } else {
      const botRates = await fetchBOTRates(); // TWD per 1 foreign unit

      const rFrom = fromCurrency === 'TWD' ? null : botRates[fromCurrency]?.sellSpot;
      const rTo   = toCurrency   === 'TWD' ? null : botRates[toCurrency]?.sellSpot;

      // Check if any required currency is missing from BOT
      const fromMissing = fromCurrency !== 'TWD' && !rFrom;
      const toMissing   = toCurrency   !== 'TWD' && !rTo;

      if (fromMissing || toMissing) {
        console.warn(`BOT missing ${fromMissing ? fromCurrency : toCurrency}, trying Yahoo Finance`);
        try {
          const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${fromCurrency}${toCurrency}=X?interval=1m&range=1d`;
          const yRes = await fetch(yUrl);
          const yJson = await yRes.json();
          const yRate = yJson?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (yRate && yRate > 0) {
            rate = yRate;
          } else {
            rate = await fetchExchangeRateFallback(fromCurrency, toCurrency);
          }
        } catch (_) {
          rate = await fetchExchangeRateFallback(fromCurrency, toCurrency);
        }
      } else if (toCurrency === 'TWD') {
        rate = rFrom; // foreign → TWD (即期賣出)
      } else if (fromCurrency === 'TWD') {
        rate = 1 / rTo; // TWD → foreign
      } else {
        rate = rFrom / rTo; // cross rate via TWD
      }
    }

    await supabase
      .from('exchange_rates')
      .upsert({
        from_currency: fromCurrency,
        to_currency: toCurrency,
        rate: rate,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'from_currency,to_currency' });

    return rate;
  } catch (error) {
    if (cachedRate != null) {
      console.warn(`Using cached exchange rate for ${fromCurrency}→${toCurrency}`);
      return cachedRate;
    }
    console.error('Error fetching exchange rate:', error);
    throw error;
  }
};

/**
 * Batch-fetch exchange rates for multiple currencies → baseCurrency in one shot.
 * Fix 1: replaces the N individual fetchExchangeRate calls that each query
 * Supabase + BOT CSV.  Strategy:
 *  1. One Supabase query for all pairs at once.
 *  2. One BOT CSV fetch for any still-missing pairs.
 *  3. Individual fallback only for exotic currencies absent from BOT.
 *
 * Returns { USD: 32.5, JPY: 0.22, … } (rate × amount = baseCurrency amount)
 */
export const fetchExchangeRatesBatch = async (currencies, baseCurrency) => {
  const unique = [...new Set(currencies || [])].filter(c => c && c !== baseCurrency);
  if (unique.length === 0) return {};

  const ratesMap = {};

  // 1. Single Supabase query for all pairs
  try {
    const { data: cached } = await supabase
      .from('exchange_rates')
      .select('*')
      .in('from_currency', unique)
      .eq('to_currency', baseCurrency);

    for (const row of cached || []) {
      const rate = parseFloat(row.rate);
      if (Number.isFinite(rate) && rate > 0) ratesMap[row.from_currency] = rate;
    }
  } catch { /* proceed to fetch */ }

  const missing = unique.filter(c => ratesMap[c] == null);
  if (missing.length === 0) return ratesMap;

  // 2. Fetch BOT CSV once for all missing currencies
  try {
    const botRates = await fetchBOTRates(); // single HTTP request
    const upserts = [];

    for (const currency of missing) {
      let rate = null;
      if (baseCurrency === 'TWD') {
        rate = botRates[currency]?.sellSpot ?? null;
      } else if (currency === 'TWD') {
        const rTo = botRates[baseCurrency]?.sellSpot;
        rate = rTo ? 1 / rTo : null;
      } else {
        const rFrom = botRates[currency]?.sellSpot;
        const rTo   = botRates[baseCurrency]?.sellSpot;
        rate = (rFrom && rTo) ? rFrom / rTo : null;
      }

      if (rate != null) {
        ratesMap[currency] = rate;
        upserts.push({
          from_currency: currency,
          to_currency: baseCurrency,
          rate,
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (upserts.length > 0) {
      await supabase.from('exchange_rates').upsert(upserts, { onConflict: 'from_currency,to_currency' });
    }
  } catch { /* fall through to individual fallbacks */ }

  // 3. Individual fallback for any exotic currencies still missing
  const stillMissing = missing.filter(c => ratesMap[c] == null);
  if (stillMissing.length > 0) {
    await Promise.allSettled(
      stillMissing.map(async (currency) => {
        try { ratesMap[currency] = await fetchExchangeRate(currency, baseCurrency); } catch {}
      })
    );
  }

  return ratesMap;
};

/**
 * Convert amount to base currency.
 * Fix 1: accepts an optional pre-fetched ratesMap to skip the Supabase lookup.
 */
export const convertToBaseCurrency = async (amount, fromCurrency, baseCurrency, ratesMap = null) => {
  if (fromCurrency === baseCurrency) return amount;

  try {
    const rate = (ratesMap && ratesMap[fromCurrency] != null)
      ? ratesMap[fromCurrency]
      : await fetchExchangeRate(fromCurrency, baseCurrency);
    if (rate == null || rate <= 0 || !isFinite(rate)) {
      console.warn(`convertToBaseCurrency: invalid rate ${rate} for ${fromCurrency}→${baseCurrency}, using 1:1`);
      return amount;
    }
    return amount * rate;
  } catch (error) {
    console.warn(`convertToBaseCurrency failed (${fromCurrency}→${baseCurrency}):`, error?.message);
    return amount;
  }
};
