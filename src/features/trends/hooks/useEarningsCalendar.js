import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../lib/supabase';
import { fetchFinancialReports } from '../../../services/financialReports';
import { loadCloudWatchlist } from '../../../services/investmentSignals';
import { allSettledWithConcurrency } from '../concurrency';

const quarterFromPeriodEnd = value => {
  const match = String(value || '').match(/^(\d{4})-(0[1-9]|1[0-2])-\d{2}$/);
  return match ? `${match[1]} Q${Math.ceil(Number(match[2]) / 3)}` : null;
};

const pad2 = n => String(n).padStart(2, '0');

export default function useEarningsCalendar(calendarMonth) {
  const [earningsEvents, setEarningsEvents] = useState([]);
  const [marketCalendarEvents, setMarketCalendarEvents] = useState([]);
  const [earningsUsSymbols, setEarningsUsSymbols] = useState('');
  const [earningsTwSymbols, setEarningsTwSymbols] = useState('');
  const [earningsTargetMeta, setEarningsTargetMeta] = useState({});
  const [marketCalendarError, setMarketCalendarError] = useState('');
  const [earningsCalendarLoading, setEarningsCalendarLoading] = useState(false);
  const [earningsCalendarError, setEarningsCalendarError] = useState('');

  const earningsCalendarRequestRef = useRef(0);

  const loadEarningsCalendar = useCallback(async (assetRows = []) => {
    const requestId = earningsCalendarRequestRef.current + 1;
    earningsCalendarRequestRef.current = requestId;
    setEarningsCalendarLoading(true);
    setEarningsCalendarError('');
    try {
      const [cloudWatchlist, localWatchlistRaw] = await Promise.all([
        loadCloudWatchlist().catch(() => []),
        AsyncStorage.getItem('watchlist').catch(() => null),
      ]);
      if (requestId !== earningsCalendarRequestRef.current) return;

      let localWatchlist = [];
      try { localWatchlist = JSON.parse(localWatchlistRaw || '[]'); } catch { localWatchlist = []; }
      const localItems = Array.isArray(localWatchlist) ? localWatchlist : [];
      const watchlist = [...localItems, ...cloudWatchlist.map(item => ({
        ...item,
        name: localItems.find(local => local.symbol === item.symbol && local.market_type === item.market_type)?.name || item.symbol,
      }))];

      const targets = new Map();
      const addTarget = (asset, source) => {
        const symbol = String(asset?.symbol || '').trim().toUpperCase();
        const marketType = String(asset?.market_type || '').trim().toUpperCase();
        if (!symbol || !['TW', 'US'].includes(marketType)) return;
        if (source === 'holding' && (asset?.category !== 'investment' || Number(asset?.current_shares) <= 0)) return;
        const key = `${marketType}:${symbol}`;
        const current = targets.get(key) || {
          key,
          symbol,
          marketType,
          name: asset?.name || symbol,
          isHolding: false,
          isWatchlist: false,
        };
        current.isHolding ||= source === 'holding';
        current.isWatchlist ||= source === 'watchlist';
        if (!current.name || current.name === symbol) current.name = asset?.name || current.name;
        targets.set(key, current);
      };
      assetRows.forEach(asset => addTarget(asset, 'holding'));
      watchlist.forEach(asset => addTarget(asset, 'watchlist'));

      const targetList = [...targets.values()];
      setEarningsUsSymbols(targetList.filter(target => target.marketType === 'US').map(target => target.symbol).sort().join(','));
      setEarningsTwSymbols(targetList
        .filter(target => target.marketType === 'TW' && !target.symbol.startsWith('00') && !target.symbol.startsWith('^'))
        .map(target => target.symbol).sort().join(','));
      setEarningsTargetMeta(Object.fromEntries(targetList.map(target => [target.key, target])));
      if (!targetList.length) {
        setEarningsEvents([]);
        return;
      }

      const results = await allSettledWithConcurrency(targetList, 3, async target => {
        const report = await fetchFinancialReports(target.symbol, target.marketType);
        const nextEstimate = (report?.estimates || []).find(item => item?.period === '0q' && item?.endDate);
        const upcomingQuarter = quarterFromPeriodEnd(nextEstimate?.endDate);
        const releaseDate = String(report?.latestEarningsRelease?.date || '');
        const previousDate = String(report?.earningsCalendar?.previousDate || '');
        const releaseMatchesPrevious = releaseDate && previousDate
          && Math.abs(Date.parse(`${releaseDate}T00:00:00Z`) - Date.parse(`${previousDate}T00:00:00Z`)) <= 86400000;
        const dateCandidates = [
          previousDate ? {
            date: previousDate,
            status: releaseMatchesPrevious ? 'released' : 'recent',
            quarter: report?.quarters?.find(row => row?.announcementDate === releaseDate)?.label
              || report?.releaseQuarter?.label || null,
            source: releaseMatchesPrevious
              ? report?.latestEarningsRelease?.source
              : report?.earningsCalendar?.previousSource,
          } : null,
          releaseDate && !releaseMatchesPrevious ? {
            date: releaseDate,
            status: 'released',
            quarter: report?.releaseQuarter?.label || report?.quarters?.find(row => row?.announcementDate === releaseDate)?.label || null,
            source: report?.latestEarningsRelease?.source,
          } : null,
          {
            date: report?.earningsCalendar?.nextDate,
            status: 'upcoming',
            quarter: upcomingQuarter,
            source: report?.earningsCalendar?.nextSource,
          },
        ].filter(Boolean);
        const uniqueDates = new Map();
        dateCandidates.forEach(candidate => {
          const date = String(candidate.date || '');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
          const existing = uniqueDates.get(date);
          if (!existing || candidate.status === 'released') uniqueDates.set(date, { ...candidate, date });
        });
        return [...uniqueDates.values()].map(event => ({
          ...target,
          ...event,
          key: `${target.key}:${event.date}`,
        }));
      });
      if (requestId !== earningsCalendarRequestRef.current) return;
      const failedCount = results.filter(result => result.status === 'rejected').length;
      setEarningsEvents(results
        .filter(result => result.status === 'fulfilled' && result.value)
        .flatMap(result => result.value)
        .sort((left, right) => left.date.localeCompare(right.date) || left.symbol.localeCompare(right.symbol)));
      setEarningsCalendarError(failedCount ? `${failedCount} 檔標的的財報日期暫時無法取得` : '');
    } catch (error) {
      if (requestId === earningsCalendarRequestRef.current) {
        setEarningsCalendarError(error?.message || '暫時無法取得財報日期');
      }
    } finally {
      if (requestId === earningsCalendarRequestRef.current) setEarningsCalendarLoading(false);
    }
  }, []);

  useEffect(() => {
    const usSymbols = earningsUsSymbols ? earningsUsSymbols.split(',') : [];
    const twSymbols = earningsTwSymbols ? earningsTwSymbols.split(',') : [];
    if (!usSymbols.length && !twSymbols.length) {
      setMarketCalendarEvents([]);
      setMarketCalendarError('');
      return;
    }
    let active = true;
    const month = `${calendarMonth.year}-${pad2(calendarMonth.month)}`;
    setMarketCalendarError('');
    const load = async () => {
      const requests = [
        usSymbols.length && { marketType: 'US', symbols: usSymbols },
        twSymbols.length && { marketType: 'TW', symbols: twSymbols },
      ].filter(Boolean);
      const outcomes = await Promise.all(requests.map(async request => {
        try {
          const { data, error } = await supabase.functions.invoke('financial-reports', {
            body: { calendarMonth: month, marketType: request.marketType, symbols: request.symbols },
          });
          if (error || data?.error) throw new Error(data?.error || error?.message || '財報日曆暫時無法取得');
          return { ...request, data };
        } catch (error) {
          return { ...request, error };
        }
      }));
      if (!active) return;

      const events = [];
      const errors = [];
      outcomes.forEach(outcome => {
        if (outcome.error) {
          errors.push(outcome.marketType === 'US' ? '美股財報日曆暫時無法取得' : '台股申報期限暫時無法取得');
          console.warn(`${outcome.marketType} earnings calendar:`, outcome.error?.message || outcome.error);
          return;
        }
        if (outcome.marketType === 'US' && outcome.data?.incompleteDays) {
          errors.push(`${outcome.data.incompleteDays} 天的 Nasdaq 財報資料暫時無法取得`);
        }
        (outcome.data?.events || []).forEach(event => {
          const key = `${outcome.marketType}:${event.symbol}`;
          events.push({
            ...earningsTargetMeta[key],
            ...event,
            marketType: outcome.marketType,
            key: `${key}:${event.date}`,
          });
        });
      });
      setMarketCalendarEvents(events);
      setMarketCalendarError(errors.join(' · '));
    };
    load();
    return () => { active = false; };
  }, [calendarMonth, earningsUsSymbols, earningsTwSymbols, earningsTargetMeta]);

  return { earningsEvents, marketCalendarEvents, marketCalendarError, earningsCalendarLoading, earningsCalendarError, loadEarningsCalendar };
}
