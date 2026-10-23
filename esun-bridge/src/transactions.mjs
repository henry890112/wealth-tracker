const asNumber = (value) => {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeSide = (value) => {
  const side = String(value || '').trim().toUpperCase();
  if (['B', 'BUY', '買', '買進'].includes(side)) return 'BUY';
  if (['S', 'SELL', '賣', '賣出'].includes(side)) return 'SELL';
  return null;
};

const normalizeDate = (dateValue, timeValue = '') => {
  const digits = String(dateValue || '').replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const time = String(timeValue || '').replace(/\D/g, '').padEnd(6, '0').slice(0, 6);
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+08:00`;
  return Number.isFinite(new Date(iso).getTime()) ? iso : null;
};

const detailKey = (symbol, row, side, occurredAt) => [
  symbol,
  row.orderNo || '',
  String(occurredAt || '').slice(0, 19),
  side,
  row.qty || '',
  row.price || '',
].join(':');

export function normalizeEsunTransactions(trades = []) {
  const normalized = [];
  for (const trade of trades || []) {
    const details = Array.isArray(trade.matDats) && trade.matDats.length ? trade.matDats : [trade];
    for (const row of details) {
      const symbol = String(row.stkNo || trade.stkNo || '').trim().toUpperCase();
      const side = normalizeSide(row.buySell || trade.buySell);
      const occurredAt = normalizeDate(row.tDate || trade.tDate, row.tTime);
      const quantity = Math.abs(asNumber(row.qty || trade.qty));
      const price = Math.abs(asNumber(row.price || trade.priceAvg));
      const grossAmount = Math.abs(asNumber(row.priceQty || trade.priceQty)) || quantity * price;
      if (!symbol || !side || !occurredAt || !(quantity > 0) || !(price > 0) || !(grossAmount > 0)) continue;

      const fee = Math.abs(asNumber(row.fee));
      const tax = Math.abs(asNumber(row.tax)) + Math.abs(asNumber(row.taxG));
      normalized.push({
        externalId: detailKey(symbol, row, side, occurredAt),
        symbol,
        name: row.stkNa || trade.stkNa || symbol,
        side,
        quantity,
        price,
        grossAmount,
        fee,
        tax,
        netCash: side === 'BUY' ? -(grossAmount + fee + tax) : Math.max(grossAmount - fee - tax, 0),
        occurredAt,
        orderNo: String(row.orderNo || ''),
        settlementDate: String(row.cDate || trade.cDate || ''),
        tradeType: String(row.trade || trade.trade || ''),
        raw: { ...row, matDats: undefined },
      });
    }
  }
  return normalized;
}
