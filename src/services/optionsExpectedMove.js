const finitePositive = value => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value)) && Number(value) > 0;

// Cboe/Tradier may return annual IV either as a decimal or a percentage.
// Match the existing scenario-GEX convention and reject implausible values.
export function normalizeAnnualIv(value) {
  if (!finitePositive(value)) return null;
  const raw = Number(value);
  const iv = raw > 3 ? raw / 100 : raw;
  return iv > 0 && iv <= 3 ? iv : null;
}

export function selectAtmIv(contracts = [], spot, expiration) {
  if (!finitePositive(spot)) return null;
  const candidates = contracts.filter(row => row.expiration === expiration
    && ['call', 'put'].includes(row.type)
    && finitePositive(row.strike)
    && Math.abs(Number(row.strike) - Number(spot)) / Number(spot) <= 0.1
    && normalizeAnnualIv(row.impliedVolatility) !== null);
  const byType = type => candidates.filter(row => row.type === type)
    .sort((a, b) => Math.abs(Number(a.strike) - Number(spot)) - Math.abs(Number(b.strike) - Number(spot)))[0];
  const nearest = [byType('call'), byType('put')].filter(Boolean);
  if (!nearest.length) return null;
  return {
    annualIv: nearest.reduce((sum, row) => sum + normalizeAnnualIv(row.impliedVolatility), 0) / nearest.length,
    contractCount: nearest.length,
    strikes: nearest.map(row => Number(row.strike)),
  };
}

export function calculateExpectedMove({ spot, expiration, annualIv, now = new Date() } = {}) {
  if (!finitePositive(spot) || !finitePositive(annualIv) || Number(annualIv) > 3 || !/^\d{4}-\d{2}-\d{2}$/.test(String(expiration || ''))) return null;
  const expiryUtc = Date.parse(`${expiration}T00:00:00Z`);
  const clock = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(expiryUtc) || !Number.isFinite(clock)) return null;
  const days = Math.ceil((expiryUtc - clock) / 86400000);
  if (days <= 0 || days > 730) return null;
  const center = Number(spot);
  const move = center * Number(annualIv) * Math.sqrt(days / 365);
  if (!Number.isFinite(move) || move <= 0) return null;
  return {
    spot: center,
    days,
    annualIv: Number(annualIv),
    move,
    movePercent: move / center * 100,
    lower: Math.max(0, center - move),
    upper: center + move,
  };
}
