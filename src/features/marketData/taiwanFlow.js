import { FINMIND_BASE_URL } from './shared';

/**
 * 三大法人買賣超（最近 20 個交易日）
 * Dataset: TaiwanStockInstitutionalInvestors
 * Returns { dates, foreign, trust, dealer, dealerSelf, dealerHedging } 各陣列長度 ≤ 20，按日期升序
 */
export const fetchTWStockInstitutional = async (symbol, startDate) => {
  try {
    const url = `${FINMIND_BASE_URL}/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${symbol}&start_date=${startDate}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status !== 200 || !json.data?.length) return null;

    const byDate = {};
    for (const row of json.data) {
      const d = row.date;
      if (!byDate[d]) byDate[d] = { foreign: 0, trust: 0, dealer: 0, dealerSelf: 0, dealerHedging: 0 };
      const name = row.name || '';
      const diff = (row.buy - row.sell) / 1000; // 張 = 千股
      if (name === 'Foreign_Investor' || name === 'Foreign_Dealer_Self') byDate[d].foreign += diff;
      else if (name === 'Investment_Trust') byDate[d].trust += diff;
      else if (name === 'Dealer_self') { byDate[d].dealerSelf += diff; byDate[d].dealer += diff; }
      else if (name === 'Dealer_Hedging') { byDate[d].dealerHedging += diff; byDate[d].dealer += diff; }
    }

    const sortedDates = Object.keys(byDate).sort().slice(-20);
    return {
      dates: sortedDates,
      foreign: sortedDates.map(d => byDate[d].foreign),
      trust: sortedDates.map(d => byDate[d].trust),
      dealer: sortedDates.map(d => byDate[d].dealer),
      dealerSelf: sortedDates.map(d => byDate[d].dealerSelf),
      dealerHedging: sortedDates.map(d => byDate[d].dealerHedging),
    };
  } catch (e) {
    return null;
  }
};

/**
 * 融資融券最新餘額
 * Dataset: TaiwanStockMarginPurchaseShortSale
 * Returns { date, marginBalance, shortBalance, offsetBalance } 單位：張
 */
export const fetchTWStockMargin = async (symbol, startDate) => {
  try {
    const url = `${FINMIND_BASE_URL}/data?dataset=TaiwanStockMarginPurchaseShortSale&data_id=${symbol}&start_date=${startDate}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status !== 200 || !json.data?.length) return null;

    const latest = json.data[json.data.length - 1];
    return {
      date: latest.date,
      marginBalance: latest.MarginPurchaseTodayBalance || 0,
      shortBalance: latest.ShortSaleTodayBalance || 0,
      offsetBalance: latest.OffsetLoanAndShort || 0,
    };
  } catch (e) {
    return null;
  }
};

/**
 * 大戶持股比例（持股 400 張以上各級距加總）
 * Dataset: TaiwanStockHoldingSharesPer（週頻）
 * Returns [{ date: 'YYYY-MM-DD', percent: number }, ...] 按日期升序
 *
 * FinMind level strings use comma-formatted numbers, e.g.:
 *   "400,001-600,000", "600,001-800,000", "800,001-1,000,000",
 *   "1,000,001 shares and over"
 * We identify 大戶 (≥400 張 = ≥400,001 shares) by parsing the start of
 * each range numerically, which is robust to any comma/format variation.
 */
export const fetchTWStockHoldingSharesPer = async (symbol, startDate) => {
  try {
    const token = process.env.EXPO_PUBLIC_FINMIND_API_KEY || '';
    const tokenParam = token && token !== 'your-finmind-api-key' ? `&token=${token}` : '';
    const url = `${FINMIND_BASE_URL}/data?dataset=TaiwanStockHoldingSharesPer&data_id=${symbol}&start_date=${startDate}${tokenParam}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status !== 200 || !json.data?.length) return null;

    const byDate = {};
    for (const row of json.data) {
      const level = row.HoldingSharesLevel || '';
      // Parse the start of the range, stripping commas and non-numeric chars.
      // "400,001-600,000"          → startNum = 400001
      // "1,000,001 shares and over" → startNum = 1000001 (no '-', take whole prefix)
      // "200,001-400,000"          → startNum = 200001  (excluded, < 400001)
      const startStr = level.split('-')[0].replace(/[^0-9]/g, '');
      const startNum = parseInt(startStr, 10);
      if (!startNum || startNum < 400001) continue;  // 大戶 = ≥ 400 張

      const d = row.date;
      if (!byDate[d]) byDate[d] = 0;
      byDate[d] += parseFloat(row.percent) || 0;
    }

    return Object.keys(byDate)
      .sort()
      .map(date => ({ date, percent: Math.round(byDate[date] * 100) / 100 }));
  } catch (e) {
    return null;
  }
};

/**
 * 融資使用率時間序列
 * Dataset: TaiwanStockMarginPurchaseShortSale（日頻）
 * Returns [{ date: 'YYYY-MM-DD', usageRate: number }, ...] 按日期升序
 */
export const fetchTWStockMarginUsage = async (symbol, startDate) => {
  try {
    const url = `${FINMIND_BASE_URL}/data?dataset=TaiwanStockMarginPurchaseShortSale&data_id=${symbol}&start_date=${startDate}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status !== 200 || !json.data?.length) return null;

    return json.data
      .filter(row => (row.MarginPurchaseLimit || 0) > 0)
      .map(row => ({
        date: row.date,
        usageRate: Math.round((row.MarginPurchaseTodayBalance / row.MarginPurchaseLimit) * 10000) / 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) {
    return null;
  }
};
