const DAY_MS = 86400000;

export function daysUntilExpiration(expiration, market = 'US', now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expiration || ''))) return null;
  const expiry = Date.parse(`${expiration}T00:00:00Z`);
  if (!Number.isFinite(expiry) || new Date(expiry).toISOString().slice(0, 10) !== expiration) return null;
  const timeZone = market === 'TW' ? 'Asia/Taipei' : 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = type => Number(parts.find(part => part.type === type)?.value);
  const today = Date.UTC(value('year'), value('month') - 1, value('day'));
  return Number.isFinite(today) ? Math.round((expiry - today) / DAY_MS) : null;
}

export function expirationCountdownLabel(expiration, market = 'US', now = new Date()) {
  const days = daysUntilExpiration(expiration, market, now);
  if (days === null) return '日期無效';
  if (days < 0) return '已到期';
  if (days === 0) return '今天到期';
  return `${days} 天後`;
}
