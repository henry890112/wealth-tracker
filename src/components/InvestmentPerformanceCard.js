import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Calendar, Calculator, Check, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../lib/ThemeContext';
import {
  PERFORMANCE_MARKETS,
  buildHistoricalPriceRequests,
  calculateHistoricalNavSeries,
  calculateNavSeries,
  calculateTradePerformance,
  combineBenchmarkSeries,
  initializeInvestmentPerformance,
  loadInvestmentPerformance,
  marketCurrency,
  normalizePerformanceMarket,
  setAssetPerformanceExclusion,
} from '../services/investmentPerformance';
import { fetchMarketTechnicalContext } from '../services/technicalAnalysis';
import { nextPerformanceSort, sortPerformanceRows } from '../features/trends/performanceSort';
import { summarizeVisiblePerformanceRows } from '../features/trends/performanceSummary';

const MARKET_ORDER = ['TW', 'US', 'CRYPTO', 'OTHER'];
const PERIOD_OPTIONS = [
  ['ALL', '全部'], [7, '7d'], [30, '30d'], [90, '90d'], [180, '180d'], ['CUSTOM', '自定義'],
];
const DETAIL_TABLE_HEADER_HEIGHT = 30;
const DETAIL_TABLE_ROW_HEIGHT = 54;
const DETAIL_COLUMNS = [
  ['totalPnl', '總損益', true],
  ['averageCostPrice', '成本價', false],
  ['totalReturn', '總報酬率', true],
  ['realizedReturn', '已實現率', true],
  ['unrealizedReturn', '未實現率', true],
  ['realizedPnl', '已實現', true],
  ['unrealizedPnl', '未實現', true],
  ['realizedCost', '已售成本', false],
  ['sellProceeds', '淨賣出', false],
  ['openCost', '未售成本', false],
  ['currentValue', '目前市值', false],
];
const ENTRY_TYPES = [];
const BENCHMARK_OPTIONS = {
  TW: [
    { symbol: '0050', label: '0050 · 元大台灣50' },
    { symbol: '006208', label: '006208 · 富邦台50' },
    { symbol: '00878', label: '00878 · 國泰永續高股息' },
  ],
  US: [
    { symbol: 'SPY', label: 'SPY · S&P 500 ETF' },
    { symbol: 'QQQ', label: 'QQQ · Nasdaq 100 ETF' },
    { symbol: 'DIA', label: 'DIA · 道瓊 ETF' },
    { symbol: 'SOXX', label: 'SOXX · 費城半導體 ETF' },
  ],
  CRYPTO: [
    { symbol: 'BTC', label: 'BTC · Bitcoin' },
    { symbol: 'ETH', label: 'ETH · Ethereum' },
    { symbol: 'SOL', label: 'SOL · Solana' },
    { symbol: 'BNB', label: 'BNB · BNB' },
    { symbol: 'XRP', label: 'XRP · XRP' },
    { symbol: 'DOGE', label: 'DOGE · Dogecoin' },
    { symbol: 'ADA', label: 'ADA · Cardano' },
    { symbol: 'AVAX', label: 'AVAX · Avalanche' },
    { symbol: 'LINK', label: 'LINK · Chainlink' },
  ],
};
const DEFAULT_BENCHMARKS = { TW: ['0050'], US: ['SPY'], CRYPTO: ['BTC'] };
const CURVE_MODES = [
  ['actual', '實際損益'],
  ['instrument', '標的績效'],
];
const BENCHMARK_COLORS = ['#F5A623', '#A78BFA', '#35C6B1', '#F97316', '#EC4899', '#7DD3FC'];
const COMMON_CRYPTO_SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT', 'MATIC', 'USDT', 'USDC']);
const inferBenchmarkMarket = (symbol, selectedMarket) => {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (/^\d{4,6}$/.test(normalized)) return 'TW';
  if (COMMON_CRYPTO_SYMBOLS.has(normalized)) return 'CRYPTO';
  if (selectedMarket === 'TW' || selectedMarket === 'CRYPTO') return 'US';
  return selectedMarket;
};
const today = () => new Date().toISOString().slice(0, 10);
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const amount = (value, currency) => `${currency} ${Math.round(number(value)).toLocaleString('zh-TW')}`;
const costPrice = row => {
  if (!(number(row.openShares) > 0) || !(Number(row.averageCostPrice) > 0) || !row.costCurrency) return '—';
  return `${row.costCurrency} ${Number(row.averageCostPrice).toLocaleString('zh-TW', { maximumFractionDigits: row.market === 'CRYPTO' ? 8 : 2, minimumFractionDigits: row.market === 'CRYPTO' ? 0 : 2 })}`;
};
const pct = value => {
  if (!Number.isFinite(value)) return '資料累積中';
  const percentage = value * 100;
  if (Math.abs(percentage) > 9999) return percentage > 0 ? '> +9,999%' : '< -99.99%';
  return `${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}%`;
};
const marketLabel = market => PERFORMANCE_MARKETS[market] || market;

const allSettledWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
};

const DATE_ITEM_HEIGHT = 44;
const DATE_VISIBLE_ITEMS = 5;
const DATE_PICKER_HEIGHT = DATE_ITEM_HEIGHT * DATE_VISIBLE_ITEMS;
const DATE_CURRENT_YEAR = new Date().getFullYear();
const DATE_YEARS = Array.from({ length: DATE_CURRENT_YEAR - 2020 + 2 }, (_, index) => 2020 + index);
const DATE_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const datePad = value => String(value).padStart(2, '0');
const dateParts = date => ({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
const datePartsFromOffset = days => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateParts(date);
};
const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
const datePartsToKey = value => `${value.year}-${datePad(value.month)}-${datePad(value.day)}`;

function PerformanceWheelColumn({ data, selectedValue, onValueChange, formatLabel, colors, scrollTrigger }) {
  const ref = useRef(null);
  useEffect(() => {
    const index = data.indexOf(selectedValue);
    if (!ref.current || index < 0) return undefined;
    const timer = setTimeout(() => ref.current?.scrollTo({ y: index * DATE_ITEM_HEIGHT, animated: false }), 50);
    return () => clearTimeout(timer);
  }, [data, selectedValue, scrollTrigger]);
  return <ScrollView
    ref={ref}
    style={{ height: DATE_PICKER_HEIGHT, flex: 1 }}
    showsVerticalScrollIndicator={false}
    snapToInterval={DATE_ITEM_HEIGHT}
    decelerationRate="fast"
    onMomentumScrollEnd={event => {
      const index = Math.round(event.nativeEvent.contentOffset.y / DATE_ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(index, data.length - 1));
      onValueChange(data[clamped]);
    }}
    contentContainerStyle={{ paddingVertical: DATE_ITEM_HEIGHT * 2 }}
  >
    {data.map((item, index) => {
      const selected = item === selectedValue;
      return <View key={`${item}-${index}`} style={{ height: DATE_ITEM_HEIGHT, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: selected ? 20 : 16, fontWeight: selected ? '700' : '400', color: selected ? '#10b981' : colors.textSub }}>
          {formatLabel ? formatLabel(item) : String(item)}
        </Text>
      </View>;
    })}
  </ScrollView>;
}

// Keep the rendered chart bounded to the selected period even when a cached
// service response still contains the full historical NAV series. This is a
// defensive UI boundary: the service also applies the same window, but the
// chart must never show an older date than the selected range.
const constrainNavSeriesToPeriod = (series, requestedDays) => {
  if (!series?.points?.length || requestedDays === 'ALL') return series;
  const customStartDate = requestedDays && typeof requestedDays === 'object' ? String(requestedDays.start || '').slice(0, 10) : '';
  const customEndDate = requestedDays && typeof requestedDays === 'object' ? String(requestedDays.end || '').slice(0, 10) : '';
  if (customStartDate && customEndDate && customStartDate <= customEndDate) {
    const openingPoint = series.points.filter(point => point.date < customStartDate).at(-1);
    const windowPoints = series.points.filter(point => point.date >= customStartDate && point.date <= customEndDate);
    const points = [openingPoint, ...windowPoints].filter((point, index, list) => point && list.findIndex(item => item.date === point.date) === index);
    if (points.length < 2) {
      return { ...series, points: [], periodStart: customStartDate, periodEnd: customEndDate, reason: '所選期間尚未累積足夠 NAV 快照' };
    }
    const baseNav = Number(points[0].nav);
    if (!(baseNav > 0)) return { ...series, points: [], periodStart: customStartDate, periodEnd: customEndDate, reason: '所選期間的 NAV 起點無效' };
    const normalizedPoints = points.map(point => {
      const nav = Number(point.nav) / baseNav;
      return { ...point, nav, return: nav - 1 };
    });
    return { ...series, points: normalizedPoints, firstDate: normalizedPoints[0].date, lastDate: normalizedPoints.at(-1).date, periodStart: normalizedPoints[0].date, periodEnd: normalizedPoints.at(-1).date };
  }
  const days = Math.max(1, Math.floor(Number(requestedDays)));
  if (!Number.isFinite(days)) return series;
  const endDate = series.points.at(-1)?.date;
  if (!endDate) return series;
  const cutoff = new Date(`${endDate}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  const windowPoints = series.points.filter(point => point.date >= cutoffKey && point.date <= endDate);
  // A stale/cached response can contain only an old opening snapshot plus the
  // latest point.  That is not enough to draw a trustworthy selected-period
  // curve; never fall back to the old snapshot and label it as 7/30/90 days.
  if (days !== 1 && windowPoints.length < 2) {
    return {
      ...series,
      points: [],
      periodStart: cutoffKey,
      periodEnd: endDate,
      reason: '所選期間尚未累積足夠 NAV 快照',
    };
  }
  // Keep the pre-window opening point out of the rendered series. It is useful
  // for the return calculation, but showing it would make a 7-day chart start
  // at an old date such as 05/26. The first in-window snapshot is the visual
  // baseline and is normalized to 1.0000 below.
  // A one-day view still needs the prior snapshot as its baseline so the
  // chart can show today's change instead of collapsing to a single point.
  const points = days === 1 ? series.points.slice(-2) : windowPoints;
  if (points.length < 2) {
    return {
      ...series,
      points: [],
      periodStart: cutoffKey,
      periodEnd: endDate,
      reason: '所選期間尚未累積足夠 NAV 快照',
    };
  }
  const baseNav = Number(points[0].nav);
  if (!(baseNav > 0)) return { ...series, points: [], periodStart: points[0].date, periodEnd: endDate, reason: '所選期間的 NAV 起點無效' };
  const normalizedPoints = points.map(point => {
    const nav = Number(point.nav) / baseNav;
    return { ...point, nav, return: nav - 1 };
  });
  return {
    ...series,
    points: normalizedPoints,
    firstDate: normalizedPoints[0].date,
    lastDate: normalizedPoints.at(-1).date,
    periodStart: normalizedPoints[0].date,
    periodEnd: normalizedPoints.at(-1).date,
  };
};

const reconcileSeriesEndpoint = (series, targetReturn) => {
  const target = Number(targetReturn);
  if (!series?.points?.length || !Number.isFinite(target)) return series;
  const last = series.points.at(-1);
  if (Math.abs(Number(last.return) - target) <= 1e-9) return series;
  const points = [...series.points];
  points[points.length - 1] = { ...last, nav: Math.max(0, 1 + target), return: target, reconciledToTradeReturn: true };
  return { ...series, points, reconciledToTradeReturn: true };
};

export default function InvestmentPerformanceCard({ valuedAssets, baseCurrency = 'TWD', selectedMarket = 'ALL', onExclusionChanged }) {
  const { colors } = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [setupVisible, setSetupVisible] = useState(false);
  const [exclusionVisible, setExclusionVisible] = useState(false);
  const [customPeriodVisible, setCustomPeriodVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const pendingDetailCustom = useRef(false);
  const returnToDetailAfterCustom = useRef(false);
  // Show a focused recent window by default. "全部" remains available for
  // users who explicitly want to inspect the full recorded history.
  const [periodDays, setPeriodDays] = useState(30);
  const [customRange, setCustomRange] = useState(null);
  const [customDateField, setCustomDateField] = useState('start');
  const [customPickerTrigger, setCustomPickerTrigger] = useState(0);
  const [customStart, setCustomStart] = useState(() => datePartsFromOffset(30));
  const [customEnd, setCustomEnd] = useState(() => dateParts(new Date()));
  const [savingAssetId, setSavingAssetId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [openingCash, setOpeningCash] = useState({});
  const [benchmarkRowsByKey, setBenchmarkRowsByKey] = useState({});
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState('');
  const [benchmarkSelection, setBenchmarkSelection] = useState(DEFAULT_BENCHMARKS);
  const [benchmarkVisible, setBenchmarkVisible] = useState(false);
  const [portfolioHistoryRows, setPortfolioHistoryRows] = useState({});
  const [portfolioHistoryLoading, setPortfolioHistoryLoading] = useState(false);
  const [portfolioHistoryError, setPortfolioHistoryError] = useState('');
  const [curveMode, setCurveMode] = useState('actual');

  const holdingsByMarket = useMemo(() => (valuedAssets || []).reduce((map, asset) => {
    if (asset.category !== 'investment' || number(asset.current_shares) <= 0) return map;
    const market = normalizePerformanceMarket(asset.market_type);
    map[market] = (map[market] || 0) + number(asset.converted_amount);
    return map;
  }, {}), [valuedAssets]);

  const setupMarkets = useMemo(() => {
    const present = Object.keys(holdingsByMarket);
    return [...new Set([...MARKET_ORDER.filter(market => present.includes(market)), ...present, 'TW', 'US', 'CRYPTO'])];
  }, [holdingsByMarket]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await loadInvestmentPerformance({ valuedAssets, baseCurrency });
      setData(result);
    } catch (loadError) {
      setError(loadError.message || '無法載入投資績效');
    } finally {
      setLoading(false);
    }
  }, [valuedAssets, baseCurrency]);

  useEffect(() => { reload(); }, [reload]);

  const summary = useMemo(
    () => data?.initialized ? calculateTradePerformance(data.periodContext, selectedMarket, customRange || periodDays) : null,
    [data, selectedMarket, periodDays, customRange],
  );
  const historicalPriceRequests = useMemo(
    () => data?.initialized ? buildHistoricalPriceRequests(data.periodContext, selectedMarket) : [],
    [data, selectedMarket],
  );
  const historicalPriceRequestKey = useMemo(
    () => historicalPriceRequests.map(request => `${request.identity}:${request.sourceMarket}:${request.sourceSymbol}`).join('|'),
    [historicalPriceRequests],
  );
  const fetchableHistoricalPriceRequests = useMemo(
    () => historicalPriceRequests.filter(request => request.sourceMarket && request.sourceSymbol && !request.unavailableReason),
    [historicalPriceRequests],
  );
  const requestedHistorySpan = useMemo(() => {
    const end = new Date();
    let start = null;
    if (customRange?.start) start = new Date(`${customRange.start}T00:00:00.000Z`);
    else if (periodDays === 'ALL') {
      const dates = (data?.periodContext?.transactionFlows || []).map(flow => new Date(flow.date)).filter(date => Number.isFinite(date.getTime()));
      start = dates.length ? new Date(Math.min(...dates.map(date => date.getTime()))) : new Date(end.getTime() - 365 * 86_400_000);
    } else start = new Date(end.getTime() - Math.max(1, number(periodDays)) * 86_400_000);
    // The history endpoint validates at least 60 completed rows. Equity
    // markets have weekends/holidays, so 60 calendar days is not enough.
    return Math.max(120, Math.min(2000, Math.ceil((end - start) / 86_400_000) + 30));
  }, [customRange, periodDays, data]);

  useEffect(() => {
    let cancelled = false;
    const loadPortfolioHistory = async () => {
      if (!data?.initialized || !fetchableHistoricalPriceRequests.length) {
        setPortfolioHistoryRows({});
        setPortfolioHistoryError('');
        setPortfolioHistoryLoading(false);
        return;
      }
      setPortfolioHistoryLoading(true);
      setPortfolioHistoryError('');
      const results = await allSettledWithConcurrency(fetchableHistoricalPriceRequests, 3, async request => {
        const context = await fetchMarketTechnicalContext(
          request.sourceSymbol,
          request.sourceMarket,
          requestedHistorySpan,
          false,
          false,
        );
        if (!context?.rows?.length) throw new Error('沒有日線收盤資料');
        return [request.identity, { rows: context.rows, request }];
      });
      if (cancelled) return;
      const pairs = [];
      const failures = [];
      results.forEach((result, index) => {
        const request = fetchableHistoricalPriceRequests[index];
        if (result.status === 'fulfilled') pairs.push(result.value);
        else failures.push(`${request.symbol}：${result.reason?.message || '歷史行情不可用'}`);
      });
      setPortfolioHistoryRows(Object.fromEntries(pairs));
      setPortfolioHistoryError(failures.length ? `部分標的無法取得歷史收盤價：${failures.join('、')}` : '');
      setPortfolioHistoryLoading(false);
    };
    loadPortfolioHistory();
    return () => { cancelled = true; };
  }, [data, historicalPriceRequestKey, fetchableHistoricalPriceRequests, requestedHistorySpan]);

  const reconstructedNavSeries = useMemo(
    () => data?.initialized
      ? calculateHistoricalNavSeries(data.periodContext, selectedMarket, customRange || periodDays, portfolioHistoryRows, {
        mode: curveMode,
        targetReturn: curveMode === 'actual' ? summary?.totalReturn : null,
      })
      : { points: [], markets: [] },
    [data, selectedMarket, periodDays, customRange, portfolioHistoryRows, curveMode, summary],
  );
  const navSeries = useMemo(
    () => {
      if (!data?.initialized) return { points: [], markets: [] };
      if (historicalPriceRequests.length) {
        if (portfolioHistoryLoading) {
          const markets = selectedMarket === 'ALL' ? data.periodContext.markets : [selectedMarket];
          return { points: [], markets, reason: '正在取得每日歷史收盤價…' };
        }
        return reconstructedNavSeries;
      }
      return reconcileSeriesEndpoint(
        constrainNavSeriesToPeriod(
          calculateNavSeries(data.periodContext, selectedMarket, customRange || periodDays),
          customRange || periodDays,
        ),
        curveMode === 'actual' ? summary?.totalReturn : null,
      );
    },
    [data, selectedMarket, periodDays, customRange, historicalPriceRequests.length, portfolioHistoryLoading, reconstructedNavSeries, curveMode, summary],
  );
  const benchmarkRequests = useMemo(() => (navSeries.markets || []).flatMap(market => {
    const selectedSymbols = Array.isArray(benchmarkSelection[market])
      ? benchmarkSelection[market]
      : (benchmarkSelection[market] ? [benchmarkSelection[market]] : []);
    return selectedSymbols.map(symbol => {
      const option = BENCHMARK_OPTIONS[market]?.find(item => item.symbol === symbol);
      const marketType = inferBenchmarkMarket(symbol, market);
      return {
        key: `${market}:${symbol}`,
        market,
        symbol,
        label: option?.label || `${symbol} · ${marketType === 'TW' ? '台股' : marketType === 'US' ? '美股' : '虛擬貨幣'}自訂`,
        marketType,
        custom: !option,
      };
    });
  }), [navSeries.markets, benchmarkSelection]);
  const benchmarkRequestKey = useMemo(
    () => benchmarkRequests.map(request => request.key).join('|'),
    [benchmarkRequests],
  );

  useEffect(() => {
    let cancelled = false;
    const loadBenchmarks = async () => {
      if ((navSeries.points || []).length < 2 || !(navSeries.markets || []).length) {
        setBenchmarkRowsByKey({});
        setBenchmarkError('');
        setBenchmarkLoading(false);
        return;
      }
      if (!benchmarkRequests.length) {
        setBenchmarkRowsByKey({});
        setBenchmarkError('此市場尚未設定基準指數');
        setBenchmarkLoading(false);
        return;
      }
      const span = Math.max(120, Math.min(2000, Math.ceil((new Date(navSeries.lastDate) - new Date(navSeries.firstDate)) / 86_400_000) + 30));
      setBenchmarkLoading(true);
      setBenchmarkError('');
      try {
        const results = await Promise.allSettled(benchmarkRequests.map(async request => {
          const marketCandidates = request.custom && ['US', 'CRYPTO'].includes(request.marketType)
            ? [...new Set([request.marketType, request.marketType === 'US' ? 'CRYPTO' : 'US'])]
            : [request.marketType];
          let lastError = null;
          for (const marketType of marketCandidates) {
            try {
              const context = await fetchMarketTechnicalContext(request.symbol, marketType, span, false, false);
              // The requested symbol itself is the selected benchmark. The
              // context's benchmarkRows is only the provider's default market
              // benchmark and would otherwise ignore the user's selection.
              const rows = context.rows?.length ? context.rows : context.benchmarkRows;
              if (rows?.length) return [request.key, { ...request, rows, marketType }];
              lastError = new Error(`找不到 ${request.symbol} 的${marketType === 'CRYPTO' ? '加密貨幣' : '股票'}資料`);
            } catch (error) {
              lastError = error;
            }
          }
          throw lastError || new Error(`找不到 ${request.symbol} 的對應資料`);
        }));
        if (!cancelled) {
          const pairs = [];
          const failures = [];
          results.forEach((result, index) => {
            if (result.status === 'fulfilled') pairs.push(result.value);
            else failures.push(`${benchmarkRequests[index].symbol}：${result.reason?.message || '資料不可用'}`);
          });
          setBenchmarkRowsByKey(Object.fromEntries(pairs));
          if (failures.length) setBenchmarkError(`部分基準資料無法取得：${failures.join('、')}`);
        }
      } catch (loadError) {
        if (!cancelled) {
          setBenchmarkRowsByKey({});
          setBenchmarkError(loadError.message || '無法取得基準指數');
        }
      } finally {
        if (!cancelled) setBenchmarkLoading(false);
      }
    };
    loadBenchmarks();
    return () => { cancelled = true; };
  }, [navSeries.firstDate, navSeries.lastDate, navSeries.markets, navSeries.points, benchmarkRequestKey, benchmarkRequests]);

  const curvePoints = useMemo(
    () => combineBenchmarkSeries(navSeries, benchmarkRowsByKey),
    [navSeries, benchmarkRowsByKey],
  );

  const start = async () => {
    setSaving(true);
    try {
      const cashRows = setupMarkets.map(market => ({
        market,
        currency: marketCurrency(market, baseCurrency),
        amountNative: number(openingCash[market]),
      })).filter(item => item.amountNative !== 0);
      await initializeInvestmentPerformance({ baseCurrency, marketValues: holdingsByMarket, openingCash: cashRows });
      setSetupVisible(false);
      await reload();
    } catch (saveError) {
      Alert.alert('無法開始記錄', saveError.message || '請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  const toggleAssetExclusion = async asset => {
    setSavingAssetId(asset.id);
    const nextExcluded = !asset.exclude_from_performance;
    try {
      await setAssetPerformanceExclusion(asset.ids || asset.id, nextExcluded);
      onExclusionChanged?.(asset.ids || asset.id, nextExcluded);
      await reload();
    } catch (saveError) {
      Alert.alert('無法更新計算範圍', saveError.message || '請稍後再試');
    } finally {
      setSavingAssetId(null);
    }
  };

  const selectPeriod = value => {
    if (value === 'CUSTOM') {
      if (customRange) {
        const [startYear, startMonth, startDay] = customRange.start.split('-').map(Number);
        const [endYear, endMonth, endDay] = customRange.end.split('-').map(Number);
        setCustomStart({ year: startYear, month: startMonth, day: startDay });
        setCustomEnd({ year: endYear, month: endMonth, day: endDay });
      } else {
        setCustomStart(datePartsFromOffset(30));
        setCustomEnd(dateParts(new Date()));
      }
      setCustomDateField('start');
      setCustomPickerTrigger(trigger => trigger + 1);
      setCustomPeriodVisible(true);
      return;
    }
    setPeriodDays(value);
    setCustomRange(null);
  };

  const openPendingDetailCustom = () => {
    if (!pendingDetailCustom.current) return;
    pendingDetailCustom.current = false;
    selectPeriod('CUSTOM');
  };
  const restoreDetailAfterCustom = () => {
    if (!returnToDetailAfterCustom.current) return;
    returnToDetailAfterCustom.current = false;
    setDetailVisible(true);
  };
  const closeCustomPeriod = () => {
    setCustomPeriodVisible(false);
    if (Platform.OS !== 'ios') setTimeout(restoreDetailAfterCustom, 350);
  };
  const selectDetailPeriod = value => {
    if (value !== 'CUSTOM') {
      selectPeriod(value);
      return;
    }
    pendingDetailCustom.current = true;
    returnToDetailAfterCustom.current = true;
    setDetailVisible(false);
    if (Platform.OS !== 'ios') setTimeout(openPendingDetailCustom, 350);
  };

  const applyCustomPeriod = () => {
    const start = datePartsToKey(customStart);
    const end = datePartsToKey(customEnd);
    if (start > end) {
      Alert.alert('日期錯誤', '開始日期不能晚於結束日期');
      return;
    }
    const startMs = Date.parse(`${start}T00:00:00.000Z`);
    const endMs = Date.parse(`${end}T00:00:00.000Z`);
    const days = Math.floor((endMs - startMs) / 86_400_000) + 1;
    setCustomRange({ start, end });
    setPeriodDays(days);
    closeCustomPeriod();
  };

  if (loading && !data) return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}><ActivityIndicator color={colors.accent} /></View>;
  if (data?.unavailable) return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.title, { color: colors.text }]}>投資報酬率</Text><Text style={[styles.hint, { color: colors.textMuted }]}>{data.error}</Text></View>;
  if (error) return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.title, { color: colors.text }]}>投資報酬率</Text><Text style={[styles.hint, { color: colors.danger || '#ef4444' }]}>{error}</Text><TouchableOpacity onPress={reload}><Text style={{ color: colors.accent }}>重新整理</Text></TouchableOpacity></View>;

  if (!data?.initialized) return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <Text style={[styles.title, { color: colors.text }]}>投資報酬率</Text>
    <Text style={[styles.hint, { color: colors.textSub }]}>啟用後會依買賣紀錄，以 FIFO 配對成本計算已實現、未實現與總報酬。</Text>
    <TouchableOpacity onPress={() => setSetupVisible(true)} style={[styles.primaryButton, { backgroundColor: colors.accent }]}><Text style={[styles.primaryText, { color: colors.accentContrast }]}>開始記錄</Text></TouchableOpacity>
    <SetupModal visible={setupVisible} onClose={() => setSetupVisible(false)} markets={setupMarkets} values={openingCash} setValues={setOpeningCash} holdings={holdingsByMarket} baseCurrency={baseCurrency} colors={colors} saving={saving} onSave={start} />
  </View>;

  const positive = Number.isFinite(summary.totalReturn) && summary.totalReturn >= 0;
  const selectedPeriodLabel = customRange
    ? `自訂 ${customRange.start.slice(5)}–${customRange.end.slice(5)}`
    : (periodDays === 'ALL' ? '全部期間' : `${periodDays}天`);
  const detailNoticeCount = summary.ignoredSellCount + (data.excludedAssets?.length || 0);
  const incompleteSymbolCount = summary?.ignoredIncompleteSymbols?.length || 0;
  const missingHistorySymbolCount = navSeries.excludedHistorySymbols?.length || 0;
  const excludedScopeCount = data.excludedAssets?.length || 0;
  const includedScopeCount = Math.max(0, (data.performanceAssets?.length || 0) - excludedScopeCount);
  const scopeNoticeItems = [
    incompleteSymbolCount > 0 ? `自動排除（缺少買入成本）：${summary.ignoredIncompleteSymbols.join('、')}` : null,
    missingHistorySymbolCount > 0 ? `歷史曲線未納入（無官方日線）：${navSeries.excludedHistorySymbols.join('、')}；目前交易總損益仍保留估值。` : null,
    portfolioHistoryError ? `歷史曲線資料未完整：${portfolioHistoryError}；這只影響曲線，不會自動刪除持倉。` : null,
  ].filter(Boolean);
  const latestCurvePoint = curvePoints.at(-1);
  const displayedInstrumentReturn = curveMode === 'instrument' && Number.isFinite(Number(latestCurvePoint?.return))
    ? Number(latestCurvePoint.return)
    : null;
  const benchmarkLabels = benchmarkRequests.map(request => request.label);
  const benchmarkButtonLabel = benchmarkLabels.length > 1 ? `已選 ${benchmarkLabels.length} 個` : (benchmarkLabels[0] || '選擇基準');
  const primaryBenchmarkSymbol = benchmarkRequests[0]?.symbol || '基準';
  const benchmarkSeries = benchmarkRequests.map((request, index) => ({ ...request, color: BENCHMARK_COLORS[index % BENCHMARK_COLORS.length] }));
  const toggleBenchmark = (market, symbol) => {
    setBenchmarkSelection(previous => {
      const current = Array.isArray(previous[market]) ? previous[market] : [];
      const next = current.includes(symbol) ? current.filter(item => item !== symbol) : [...current, symbol];
      return { ...previous, [market]: next };
    });
    setBenchmarkRowsByKey({});
  };
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.header}><View style={{ flex: 1 }}><Text style={[styles.title, { color: colors.text }]}>股票交易報酬</Text><Text style={[styles.hint, { color: colors.textMuted }]}>FIFO 成本法</Text></View><TouchableOpacity onPress={reload} style={[styles.iconButton, { borderColor: colors.border }]}><RefreshCw size={15} color={colors.textSub} /></TouchableOpacity></View>
    <View style={styles.scopeHeaderRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.scopeTitle, { color: colors.textSub }]}>損益計算標的</Text>
        <Text style={[styles.scopeSubtitle, { color: colors.textMuted }]}>已納入 {includedScopeCount} 檔 · 手動排除 {excludedScopeCount} 檔</Text>
      </View>
      <TouchableOpacity onPress={() => setExclusionVisible(true)} style={[styles.scopeSelectButton, { borderColor: colors.border, backgroundColor: colors.cardAlt }]} accessibilityRole="button" accessibilityLabel="選擇損益計算標的">
        <Text style={[styles.scopeSelectText, { color: colors.accent }]}>選擇標的</Text>
      </TouchableOpacity>
    </View>
    {scopeNoticeItems.length > 0 && <Text style={[styles.scopeHint, { color: colors.textMuted }]}>另有 {scopeNoticeItems.length} 項資料提示，點擊「選擇標的」查看原因</Text>}
    <View style={[styles.scopeGlassContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.scopePeriodRow}>
        {PERIOD_OPTIONS.map(([value, label]) => {
          const customActive = value === 'CUSTOM' && Boolean(customRange);
          const active = customRange ? customActive : periodDays === value;
          return <TouchableOpacity
            key={value}
            onPress={() => selectPeriod(value)}
            activeOpacity={0.75}
            style={[styles.scopePeriodButton, { backgroundColor: colors.cardAlt, borderColor: colors.border }, active && { backgroundColor: colors.accent, borderColor: colors.accent }]}
          >
            {value === 'CUSTOM' && <Calendar size={11} color={active ? colors.accentContrast : colors.accent} />}
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.scopePeriodLabel, { color: active ? colors.accentContrast : colors.textSub }, active && styles.scopePeriodLabelActive]}>{label}</Text>
          </TouchableOpacity>;
        })}
      </View>
    </View>
    <View style={styles.returnOverview}>
      <View style={[styles.returnHero, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
        <Text style={[styles.returnLabel, { color: colors.textMuted }]}>FIFO 實際總報酬率</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.xirr, { color: Number.isFinite(summary.totalReturn) ? (positive ? '#0DBD8B' : '#F03030') : colors.textMuted }]}>{pct(summary.totalReturn)}</Text>
        <Text style={[styles.returnCost, { color: colors.textMuted }]}>成本 {amount(summary.totalCost, baseCurrency)}</Text>
        {displayedInstrumentReturn != null && <Text style={[styles.returnComparison, { color: displayedInstrumentReturn >= 0 ? '#0DBD8B' : '#F03030' }]}>標的價格績效 {pct(displayedInstrumentReturn)}（非實際損益）</Text>}
      </View>
      <View style={[styles.returnStats, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
        <Text style={[styles.returnChartTitle, { color: colors.textMuted }]}>{curveMode === 'instrument' ? '標的績效 NAV' : '實際損益 NAV'}</Text>
        <Text style={[styles.navValue, { color: colors.text }]}>{navSeries.historyIncomplete ? '暫停' : (Number.isFinite(latestCurvePoint?.nav) ? latestCurvePoint.nav.toFixed(4) : '累積中')}</Text>
        <Text style={[styles.alphaValue, { color: navSeries.historyIncomplete ? colors.textMuted : (Number(latestCurvePoint?.alpha) >= 0 ? '#0DBD8B' : '#F03030') }]}>
          {navSeries.historyIncomplete ? '需補齊交易紀錄' : (Number.isFinite(latestCurvePoint?.alpha) ? `相對 ${primaryBenchmarkSymbol} ${latestCurvePoint.alpha >= 0 ? '+' : ''}${(latestCurvePoint.alpha * 100).toFixed(2)}%` : benchmarkLoading ? '載入基準…' : '等待比較資料')}
        </Text>
      </View>
    </View>
    <View style={[styles.navChartCard, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
      <View style={styles.navChartHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.navChartTitle, { color: colors.text }]}>累計報酬率走勢</Text>
          <Text style={[styles.navChartSubtitle, { color: colors.textMuted }]}>{curveMode === 'actual' ? '實際損益：第一筆買入以成交價起算' : '標的績效：期間起點以官方收盤價起算'} · 組合與基準均從 0% 起算 · {selectedPeriodLabel}{!customRange && navSeries.periodStart && navSeries.periodEnd ? ` · ${navSeries.periodStart.slice(5)}–${navSeries.periodEnd.slice(5)}` : ''}{navSeries.limitedByTrackingStart ? ' · 僅顯示可靠紀錄' : ''}</Text>
        </View>
        <TouchableOpacity onPress={() => setBenchmarkVisible(true)} style={[styles.benchmarkButton, { borderColor: colors.border, backgroundColor: colors.cardAlt }]} accessibilityRole="button" accessibilityLabel="選擇比較基準">
          <SlidersHorizontal size={11} color={colors.accent} />
          <Text numberOfLines={1} style={[styles.benchmarkButtonText, { color: colors.accent }]}>{benchmarkButtonLabel}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.modeRow} accessibilityRole="tablist">
        {CURVE_MODES.map(([value, label]) => <Chip key={value} label={label} active={curveMode === value} colors={colors} onPress={() => setCurveMode(value)} />)}
      </View>
      <View style={styles.legendRow}><View style={[styles.legendDot, { backgroundColor: colors.accent }]} /><Text style={[styles.legendText, { color: colors.textSub }]}>投資組合</Text>{benchmarkSeries.map(series => <React.Fragment key={series.key}><View style={[styles.legendDot, { backgroundColor: series.color }]} /><Text numberOfLines={1} style={[styles.legendText, { color: colors.textSub }]}>{series.label}</Text></React.Fragment>)}</View>
      <NavCurveChart points={curvePoints} benchmarkSeries={benchmarkSeries} reason={navSeries.reason || portfolioHistoryError || benchmarkError} benchmarkLoading={benchmarkLoading || portfolioHistoryLoading} historyIncomplete={navSeries.historyIncomplete} colors={colors} />
      <Text style={[styles.navChartFootnote, { color: colors.textMuted }]}>{navSeries.reconstructedFromPrices ? (curveMode === 'actual'
        ? '實際損益線依 FIFO 成本基準重建每日持股，按各交易日官方收盤價計算已實現與未實現損益；最後一點補上目前持倉估值，因此會與上方交易總報酬使用相同換算基準。'
        : '標的績效線依每檔買賣日期重建每日持股，第一個有效交易日以官方收盤價建立基準，再乘上各交易日官方收盤價；排除買賣資金流與匯率變動，適合和同市場基準比較。') : '組合線使用時間加權 NAV；每日快照以收盤值計算，交易日資金流納入該區間起始資本；每條線均以所選期間第一筆資料為 0%。'}{navSeries.excludedHistorySymbols?.length ? ` ${navSeries.excludedHistorySymbols.join('、')} 無官方交易所日線，歷史段落未納入；終點依交易總報酬校正。` : ''}{navSeries.limitedByTrackingStart ? ` 績效從 ${navSeries.trackingStartDate} 開始可靠記錄。` : ''}{navSeries.ignoredSnapshotCount ? ` 已略過 ${navSeries.ignoredSnapshotCount} 筆疑似報價異常快照。` : ''}</Text>
    </View>
    <View style={[styles.compactPnlRow, { borderTopColor: colors.border }]}>
      <CompactPnlMetric label="已實現" value={summary.realizedPnl} currency={baseCurrency} colors={colors} />
      <CompactPnlMetric label="未實現" value={summary.unrealizedPnl} currency={baseCurrency} colors={colors} />
      <CompactPnlMetric label="總損益" value={summary.totalPnl} currency={baseCurrency} colors={colors} />
    </View>
    {!!summary.assetRows?.length && <TouchableOpacity onPress={() => setDetailVisible(true)} style={[styles.detailButton, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}><Calculator size={16} color={colors.accent} /><View style={{ flex: 1 }}><Text style={[styles.detailButtonTitle, { color: colors.text }]}>查看計算明細</Text><Text style={[styles.detailButtonSub, { color: colors.textMuted }]}>逐檔損益{detailNoticeCount ? ` · ${detailNoticeCount} 項計算提醒` : ''}{summary.ignoredIncompleteSymbols?.length ? ` · 已忽略 ${summary.ignoredIncompleteSymbols.length} 檔缺少買入` : ''}</Text></View><Text style={{ color: colors.accent, fontWeight: '900' }}>›</Text></TouchableOpacity>}
    <ExclusionModal visible={exclusionVisible} onClose={() => setExclusionVisible(false)} assets={data.performanceAssets || []} notices={scopeNoticeItems} savingAssetId={savingAssetId} onToggle={toggleAssetExclusion} colors={colors} />
    <BenchmarkModal visible={benchmarkVisible} onClose={() => setBenchmarkVisible(false)} markets={navSeries.markets || []} selection={benchmarkSelection} onToggle={toggleBenchmark} colors={colors} />
    <CustomPeriodModal
      visible={customPeriodVisible}
      onClose={closeCustomPeriod}
      onDismiss={restoreDetailAfterCustom}
      start={customStart}
      end={customEnd}
      activeField={customDateField}
      setActiveField={field => { setCustomDateField(field); setCustomPickerTrigger(trigger => trigger + 1); }}
      setStart={setCustomStart}
      setEnd={setCustomEnd}
      scrollTrigger={customPickerTrigger}
      onReset={() => { setCustomStart(datePartsFromOffset(30)); setCustomEnd(dateParts(new Date())); setCustomPickerTrigger(trigger => trigger + 1); }}
      onApply={applyCustomPeriod}
      colors={colors}
    />
    <PerformanceDetailsModal visible={detailVisible} onClose={() => setDetailVisible(false)} onDismiss={openPendingDetailCustom} summary={summary} periodLabel={selectedPeriodLabel} periodDays={periodDays} customRange={customRange} onSelectPeriod={selectDetailPeriod} currency={baseCurrency} colors={colors} />
  </View>;
}

function NavCurveChart({ points, benchmarkSeries = [], reason, benchmarkLoading, historyIncomplete = false, colors }) {
  const [width, setWidth] = useState(300);
  const [selectedIndex, setSelectedIndex] = useState(null);
  useEffect(() => { setSelectedIndex(points?.length ? points.length - 1 : null); }, [points]);
  if (!points?.length || points.length < 2) return <View style={styles.navEmpty}><Text style={[styles.navEmptyTitle, { color: colors.textSub }]}>{historyIncomplete ? '暫停顯示報酬率曲線' : '報酬率資料累積中'}</Text><Text style={[styles.navEmptyText, { color: colors.textMuted }]}>{historyIncomplete ? (reason || '發現缺少買入成本的賣出紀錄；補齊交易後才會重新計算。') : (reason || '至少需要 2 個每日快照')}</Text></View>;

  const W = Math.max(240, width);
  const H = 126;
  const margin = { left: 32, right: 7, top: 8, bottom: 22 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  const benchmarkKeys = benchmarkSeries.map(series => series.key);
  const portfolioReturn = point => Number.isFinite(point?.nav) ? point.nav - 1 : null;
  const benchmarkReturn = (point, key) => Number.isFinite(point?.benchmarkValues?.[key]) ? point.benchmarkValues[key] - 1 : null;
  const values = points.flatMap(point => [portfolioReturn(point), ...benchmarkKeys.map(key => benchmarkReturn(point, key))]).filter(Number.isFinite);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.14, 0.01);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const x = index => margin.left + (index / Math.max(1, points.length - 1)) * plotW;
  const y = value => margin.top + ((max - value) / Math.max(0.0001, max - min)) * plotH;
  const formatChartPct = value => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
  const pathFor = (key, benchmark = false) => points.reduce((path, point, index) => {
    const value = benchmark ? benchmarkReturn(point, key) : portfolioReturn(point);
    if (!Number.isFinite(value)) return path;
    return `${path}${path ? ' L' : 'M'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`;
  }, '');
  const selected = points[selectedIndex ?? points.length - 1] || points.at(-1);
  const selectAt = event => {
    const locationX = event.nativeEvent.locationX;
    const index = Math.max(0, Math.min(points.length - 1, Math.round(((locationX - margin.left) / Math.max(1, plotW)) * (points.length - 1))));
    setSelectedIndex(index);
  };
  const selectedBenchmarks = benchmarkSeries
    .map(series => ({ ...series, value: benchmarkReturn(selected, series.key) }))
    .filter(series => Number.isFinite(series.value));
  return <View
    style={styles.navChart}
    onLayout={event => setWidth(event.nativeEvent.layout.width)}
    onStartShouldSetResponder={() => true}
    onMoveShouldSetResponder={() => true}
    onResponderGrant={selectAt}
    onResponderMove={selectAt}
    accessible
    accessibilityRole="image"
    accessibilityLabel={`投資組合累計報酬率 ${formatChartPct(portfolioReturn(selected) || 0)}，${selectedBenchmarks.length ? `已顯示 ${selectedBenchmarks.length} 個比較基準` : '基準載入中'}`}
  >
    <View style={styles.navTooltip}>
      <Text style={[styles.navTooltipDate, { color: colors.textMuted }]}>{selected.date}</Text>
      <Text style={[styles.navTooltipValue, { color: colors.accent }]}>組合 {formatChartPct(portfolioReturn(selected) || 0)}</Text>
      {selectedBenchmarks.map(series => <Text key={series.key} numberOfLines={1} style={[styles.navTooltipValue, { color: series.color }]}>{series.symbol} {formatChartPct(series.value)}</Text>)}
      {benchmarkLoading && !selectedBenchmarks.length && <ActivityIndicator size="small" color={colors.warning || '#F5A623'} />}
    </View>
    <Svg width={W} height={H}>
      {[max, (max + min) / 2, min].map(value => <Line key={value} x1={margin.left} x2={W - margin.right} y1={y(value)} y2={y(value)} stroke={colors.border} strokeWidth="1" strokeDasharray="3 5" />)}
      {min <= 0 && max >= 0 && <Line x1={margin.left} x2={W - margin.right} y1={y(0)} y2={y(0)} stroke={colors.textMuted} strokeWidth="1" strokeDasharray="4 3" />}
      <SvgText x={margin.left - 4} y={margin.top + 3} textAnchor="end" fill={colors.textMuted} fontSize="8">{formatChartPct(max)}</SvgText>
      <SvgText x={margin.left - 4} y={margin.top + plotH / 2 + 3} textAnchor="end" fill={colors.textMuted} fontSize="8">{formatChartPct((max + min) / 2)}</SvgText>
      <SvgText x={margin.left - 4} y={margin.top + plotH + 3} textAnchor="end" fill={colors.textMuted} fontSize="8">{formatChartPct(min)}</SvgText>
      <Path d={pathFor('nav')} fill="none" stroke={colors.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {benchmarkSeries.map(series => pathFor(series.key, true) ? <Path key={series.key} d={pathFor(series.key, true)} fill="none" stroke={series.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : null)}
      {selectedIndex != null && <>
        <Line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={margin.top} y2={margin.top + plotH} stroke={colors.textMuted} strokeWidth="1" strokeDasharray="3 4" />
        <Circle cx={x(selectedIndex)} cy={y(portfolioReturn(selected))} r="4" fill={colors.accent} />
        {selectedBenchmarks.map(series => <Circle key={series.key} cx={x(selectedIndex)} cy={y(series.value)} r="3.5" fill={series.color} />)}
      </>}
      <SvgText x={margin.left} y={H - 5} fill={colors.textMuted} fontSize="8">{points[0].date.slice(5)}</SvgText>
      <SvgText x={W - margin.right} y={H - 5} textAnchor="end" fill={colors.textMuted} fontSize="8">{points.at(-1).date.slice(5)}</SvgText>
    </Svg>
  </View>;
}

function CompactPnlMetric({ label, value, currency, colors }) { const positive = number(value) >= 0; return <View style={styles.compactMetric}><Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit style={[styles.compactMetricValue, { color: positive ? '#0DBD8B' : '#F03030' }]}>{number(value) >= 0 ? '+' : '−'}{amount(Math.abs(number(value)), currency)}</Text></View>; }
function Chip({ active, label, onPress, colors }) { return <TouchableOpacity onPress={onPress} style={[styles.chip, { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accentSoft : colors.cardAlt }]}><Text style={{ color: active ? colors.accent : colors.textSub, fontWeight: '700', fontSize: 12 }}>{label}</Text></TouchableOpacity>; }

function BenchmarkModal({ visible, onClose, markets, selection, onToggle, colors }) {
  const [customMarket, setCustomMarket] = useState(markets[0] || 'TW');
  const [customSymbol, setCustomSymbol] = useState('');
  useEffect(() => {
    if (markets.length && !markets.includes(customMarket)) setCustomMarket(markets[0]);
  }, [markets, customMarket]);
  const addCustomBenchmark = () => {
    const symbol = customSymbol.trim().toUpperCase();
    const inferredMarket = inferBenchmarkMarket(symbol, customMarket);
    const valid = inferredMarket === 'TW' ? /^\d{4,6}$/.test(symbol) : /^[A-Z0-9.-]{1,20}$/.test(symbol);
    if (!valid) {
      Alert.alert('代碼格式不正確', '台股請輸入 4 至 6 碼數字；美股或虛擬貨幣請輸入英文代碼。');
      return;
    }
    onToggle(customMarket, symbol);
    setCustomSymbol('');
  };
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === 'web' ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      <View style={styles.overlay}><View style={[styles.modal, { backgroundColor: colors.card }]}>
        <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>選擇比較基準</Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>可複選預設基準；輸入 4 至 6 碼數字或英文代碼會自動辨識市場。</Text>
        </View>
        <TouchableOpacity onPress={onClose} accessibilityLabel="關閉比較基準選擇"><X color={colors.textSub} /></TouchableOpacity>
      </View>
      <Text style={[styles.label, { color: colors.textSub }]}>自訂標的市場</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{markets.map(market => <Chip key={market} label={marketLabel(market)} active={customMarket === market} colors={colors} onPress={() => setCustomMarket(market)} />)}</ScrollView>
      <View style={styles.customBenchmarkRow}>
        <TextInput value={customSymbol} onChangeText={setCustomSymbol} autoCapitalize="characters" placeholder="輸入代碼，例如 AAPL / 2330 / ETH" placeholderTextColor={colors.textMuted} style={[styles.input, styles.customBenchmarkInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.cardAlt }]} onSubmitEditing={addCustomBenchmark} />
        <TouchableOpacity onPress={addCustomBenchmark} style={[styles.customBenchmarkAdd, { backgroundColor: colors.accent }]}><Text style={{ color: colors.accentContrast, fontWeight: '900' }}>加入</Text></TouchableOpacity>
      </View>
      <ScrollView style={styles.benchmarkList} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {markets.map(market => {
          const options = BENCHMARK_OPTIONS[market] || [];
          if (!options.length) return null;
          const selectedSymbols = Array.isArray(selection[market]) ? selection[market] : (selection[market] ? [selection[market]] : []);
          const customSymbols = selectedSymbols.filter(symbol => !options.some(option => option.symbol === symbol));
          return <View key={market} style={[styles.benchmarkGroup, { borderBottomColor: colors.borderLight }]}>
            <View style={styles.benchmarkGroupHeader}><Text style={[styles.entryTitle, { color: colors.text }]}>{marketLabel(market)}</Text><Text style={[styles.hint, { color: colors.textMuted }]}>{selectedSymbols.length ? `已選 ${selectedSymbols.length} 個` : '未選擇'}</Text></View>
            <View style={styles.wrap}>{options.map(option => <Chip key={option.symbol} label={option.label} active={selectedSymbols.includes(option.symbol)} colors={colors} onPress={() => onToggle(market, option.symbol)} />)}{customSymbols.map(symbol => <Chip key={symbol} label={`${symbol} · 自訂`} active colors={colors} onPress={() => onToggle(market, symbol)} />)}</View>
          </View>;
        })}
      </ScrollView>
      <TouchableOpacity onPress={onClose} style={[styles.primaryButton, { backgroundColor: colors.accent }]}><Text style={[styles.primaryText, { color: colors.accentContrast }]}>完成</Text></TouchableOpacity>
      </View></View>
    </KeyboardAvoidingView>
  </Modal>;
}

function PerformanceDetailsModal({ visible, onClose, onDismiss, summary, periodLabel, periodDays, customRange, onSelectPeriod, currency, colors }) {
  const rows = summary?.assetRows || [];
  const [searchQuery, setSearchQuery] = useState('');
  const [marketFilter, setMarketFilter] = useState('ALL');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [tableSort, setTableSort] = useState(null);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [highlightedAssetId, setHighlightedAssetId] = useState(null);
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [showFormula, setShowFormula] = useState(false);
  const detailScrollRef = useRef(null);
  const assetSectionY = useRef(0);
  const assetTableY = useRef(0);
  const highlightTimer = useRef(null);
  useEffect(() => {
    if (!visible) return;
    setSearchQuery('');
    setMarketFilter('ALL');
    setPositionFilter('ALL');
    setTableSort(null);
    setTimelineExpanded(false);
    setHighlightedAssetId(null);
    setSelectedAssetId(null);
    setHistoryExpanded(false);
    setShowFormula(false);
    return () => clearTimeout(highlightTimer.current);
  }, [visible]);
  const availableMarkets = MARKET_ORDER.filter(market => rows.some(row => normalizePerformanceMarket(row.market) === market));
  const marketFilters = [['ALL', '全部'], ...availableMarkets.map(market => [market, marketLabel(market)])];
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const marketRows = rows.filter(row => {
    const matchesSearch = !normalizedQuery || `${row.symbol || ''} ${row.name || ''}`.toLocaleLowerCase().includes(normalizedQuery);
    const matchesMarket = marketFilter === 'ALL' || normalizePerformanceMarket(row.market) === marketFilter;
    return matchesSearch && matchesMarket;
  });
  const positionFilters = [
    ['ALL', `全部 ${marketRows.length}`],
    ['OPEN', `持有中 ${marketRows.filter(row => number(row.openShares) > 0).length}`],
    ['CLOSED', `已平倉 ${marketRows.filter(row => number(row.openShares) <= 0).length}`],
  ];
  const filteredRows = sortPerformanceRows(marketRows.filter(row => {
    const hasOpenPosition = number(row.openShares) > 0;
    const matchesPosition = positionFilter === 'ALL' || (positionFilter === 'OPEN' ? hasOpenPosition : !hasOpenPosition);
    return matchesPosition;
  }), tableSort);
  const visibleSummary = summarizeVisiblePerformanceRows(filteredRows);
  const selectTableSort = key => {
    setTableSort(current => nextPerformanceSort(current, key));
    setSelectedAssetId(null);
  };
  const visibleAssetIds = new Set(filteredRows.map(row => row.assetId));
  const timeline = (summary?.timeline || []).filter(event => visibleAssetIds.has(event.assetId));
  const visibleTimeline = timelineExpanded ? timeline : timeline.slice(0, 6);
  const selectedRow = filteredRows.find(row => row.assetId === selectedAssetId);
  const selectedHistory = selectedRow ? (summary?.tradeHistory || []).filter(event => event.assetId === selectedAssetId) : [];
  const visibleHistory = historyExpanded ? selectedHistory : selectedHistory.slice(0, 8);
  const toggleAssetHistory = assetId => {
    setSelectedAssetId(current => current === assetId ? null : assetId);
    setHistoryExpanded(false);
  };
  const jumpToAsset = assetId => {
    const rowIndex = filteredRows.findIndex(row => row.assetId === assetId);
    if (rowIndex < 0) return;
    const targetY = assetSectionY.current + assetTableY.current + DETAIL_TABLE_HEADER_HEIGHT + rowIndex * DETAIL_TABLE_ROW_HEIGHT;
    detailScrollRef.current?.scrollTo({ y: Math.max(0, targetY - 10), animated: true });
    setHighlightedAssetId(assetId);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedAssetId(null), 1800);
  };
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} onDismiss={onDismiss}>
    <View style={styles.overlay}><View style={[styles.modal, styles.detailModal, { backgroundColor: colors.card }]}>
      <ScrollView ref={detailScrollRef} style={styles.detailContentScroll} contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={styles.header}><View style={{ flex: 1 }}><Text style={[styles.title, { color: colors.text }]}>交易報酬明細</Text><Text style={[styles.detailHeaderSubtitle, { color: colors.textMuted }]}>FIFO 配對 · {periodLabel}</Text></View><TouchableOpacity onPress={onClose}><X color={colors.textSub} /></TouchableOpacity></View>
      <ScrollView horizontal style={styles.detailPeriodScroll} contentContainerStyle={styles.detailPeriodRow} showsHorizontalScrollIndicator={false}>
        {PERIOD_OPTIONS.map(([value, label]) => {
          const active = value === 'CUSTOM' ? Boolean(customRange) : !customRange && periodDays === value;
          return <TouchableOpacity key={value} onPress={() => onSelectPeriod(value)} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.detailPeriodButton, { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accentSoft : colors.cardAlt }]}><Text style={[styles.detailPeriodText, { color: active ? colors.accent : colors.textSub }]}>{label}</Text></TouchableOpacity>;
        })}
      </ScrollView>
      <View style={[styles.detailSummary, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
        <View style={styles.detailSummaryPrimary}>
          <View style={{ flex: 1.2, minWidth: 0 }}><Text style={[styles.metricLabel, { color: colors.textMuted }]}>總損益</Text><Text numberOfLines={1} adjustsFontSizeToFit style={[styles.detailReturn, { color: number(visibleSummary.totalPnl) >= 0 ? '#0DBD8B' : '#F03030' }]}>{number(visibleSummary.totalPnl) >= 0 ? '+' : '−'}{amount(Math.abs(number(visibleSummary.totalPnl)), currency)}</Text></View>
          <View style={{ flex: 1, minWidth: 0 }}><Text style={[styles.metricLabel, { color: colors.textMuted }]}>總報酬率</Text><Text numberOfLines={1} style={[styles.detailAnnualized, { color: number(visibleSummary.totalReturn) >= 0 ? '#0DBD8B' : '#F03030' }]}>{pct(visibleSummary.totalReturn)}</Text><Text numberOfLines={1} style={[styles.detailCost, { color: colors.textMuted }]}>成本 {amount(visibleSummary.totalCost, currency)}</Text></View>
        </View>
        <View style={[styles.detailSummaryBreakdown, { borderTopColor: colors.border }]}>
          {[
            ['已實現', visibleSummary.realizedPnl, visibleSummary.realizedReturn],
            ['未實現', visibleSummary.unrealizedPnl, visibleSummary.unrealizedReturn],
          ].map(([label, pnl, rate]) => (
            <View key={label} style={styles.detailSummaryBreakdownItem}>
              <Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}損益</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.detailBreakdownValue, { color: number(pnl) >= 0 ? '#0DBD8B' : '#F03030' }]}>{number(pnl) >= 0 ? '+' : '−'}{amount(Math.abs(number(pnl)), currency)}</Text>
              <Text numberOfLines={1} style={[styles.detailBreakdownRate, { color: Number.isFinite(rate) ? (rate >= 0 ? '#0DBD8B' : '#F03030') : colors.textMuted }]}>{Number.isFinite(rate) ? pct(rate) : '—'}</Text>
            </View>
          ))}
        </View>
      </View>
      <TouchableOpacity onPress={() => setShowFormula(open => !open)} accessibilityRole="button" accessibilityState={{ expanded: showFormula }} style={styles.detailFormulaToggle}><Text style={[styles.detailFormulaToggleText, { color: colors.accent }]}>計算方式 {showFormula ? '⌃' : '⌄'}</Text></TouchableOpacity>
      {showFormula && <Text style={[styles.formula, { color: colors.textSub, backgroundColor: colors.cardAlt }]}>已實現＝淨賣出－已售成本；報酬率＝已實現損益 ÷ 已售成本{`\n`}未實現＝目前市值－未售成本；報酬率＝未實現損益 ÷ 未售成本{`\n`}總報酬率＝（已實現＋未實現）÷ 總配對成本；無對應成本時顯示「—」</Text>}
      <View style={[styles.detailSearch, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>
        <Search size={16} color={colors.textMuted} />
        <TextInput value={searchQuery} onChangeText={setSearchQuery} autoCapitalize="characters" autoCorrect={false} placeholder="搜尋代號或名稱" placeholderTextColor={colors.textMuted} style={[styles.detailSearchInput, { color: colors.text }]} returnKeyType="search" />
        {searchQuery.length > 0 && <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="清除搜尋"><X size={15} color={colors.textMuted} /></TouchableOpacity>}
      </View>
      <View style={styles.detailFilterRow}>
        {marketFilters.map(([value, label]) => <Chip key={value} label={label} active={marketFilter === value} colors={colors} onPress={() => setMarketFilter(value)} />)}
      </View>
      <View style={styles.detailFilterRow}>
        {positionFilters.map(([value, label]) => <Chip key={value} label={label} active={positionFilter === value} colors={colors} onPress={() => setPositionFilter(value)} />)}
      </View>
      <Text style={[styles.detailResultCount, { color: colors.textMuted }]}>顯示 {filteredRows.length} / {rows.length} 檔</Text>
      <View style={[styles.timelineSection, { borderTopColor: colors.borderLight }]}>
        <Text style={[styles.timelineTitle, { color: colors.text }]}>交易時間線</Text>
        <Text style={[styles.timelineHint, { color: colors.textMuted }]}>{periodLabel} · 左右滑動，點選可跳到逐檔損益；金額非單筆損益</Text>
        {visibleTimeline.length === 0
          ? <Text style={[styles.detailEmpty, { color: colors.textMuted }]}>此區間沒有符合條件的買賣紀錄</Text>
          : <ScrollView horizontal style={styles.timelineHorizontalScroll} contentContainerStyle={styles.timelineHorizontalContent} showsHorizontalScrollIndicator nestedScrollEnabled>
            {visibleTimeline.map((event, index) => {
            const isSell = event.type === 'SELL';
            const eventColor = isSell ? '#0DBD8B' : colors.accent;
            return <TouchableOpacity key={`${event.id || event.assetId}-${event.date}-${index}`} onPress={() => jumpToAsset(event.assetId)} accessibilityRole="button" accessibilityLabel={`查看 ${event.symbol} 逐檔損益`} activeOpacity={0.7} style={styles.timelineEntry}>
              <Text style={[styles.timelineDate, { color: colors.textMuted }]}>{event.date.replace(/-/g, '/')}</Text>
              <View style={styles.timelineTrack}><View style={[styles.timelineDot, { backgroundColor: eventColor }]} /><View style={[styles.timelineTrackLine, { backgroundColor: colors.border }]} /></View>
              <Text numberOfLines={1} style={[styles.timelineEvent, { color: colors.text }]}>{event.symbol} · {isSell ? '賣出' : '買入'} {number(event.shares).toLocaleString('zh-TW')} 股</Text>
              <Text numberOfLines={1} style={[styles.timelineAmount, { color: eventColor }]}>{isSell ? '淨收' : '支出'} {amount(event.amount, currency)}</Text>
            </TouchableOpacity>;
            })}
          </ScrollView>}
        {timeline.length > 6 && <TouchableOpacity accessibilityRole="button" onPress={() => setTimelineExpanded(expanded => !expanded)} style={styles.timelineToggle}><Text style={[styles.timelineToggleText, { color: colors.accent }]}>{timelineExpanded ? '收起時間線' : `顯示全部 ${timeline.length} 筆交易`}</Text></TouchableOpacity>}
      </View>
      <View onLayout={event => { assetSectionY.current = event.nativeEvent.layout.y; }} style={[styles.assetDetailsSection, { borderTopColor: colors.borderLight }]}>
        <Text style={[styles.timelineTitle, { color: colors.text }]}>逐檔損益</Text>
        <Text style={[styles.timelineHint, { color: colors.textMuted }]}>點欄名排序 · 點標的看交易歷史 · 左右滑動查看金額（{currency}）與報酬率；成本價為持有股 FIFO 平均含費用原幣價</Text>
        {filteredRows.length === 0
          ? <Text style={[styles.detailEmpty, { color: colors.textMuted }]}>沒有符合條件的標的</Text>
          : <View onLayout={event => { assetTableY.current = event.nativeEvent.layout.y; }} style={[styles.detailTable, { borderColor: colors.border }]}>
            <View style={[styles.detailSymbolColumn, { borderRightColor: colors.border }]}>
              <TouchableOpacity onPress={() => selectTableSort('symbol')} accessibilityRole="button" accessibilityLabel={`依標的代號排序${tableSort?.key === 'symbol' ? `，目前${tableSort.direction === 'asc' ? '升序' : '降序'}` : ''}`} activeOpacity={0.7} style={[styles.detailTableHeader, { backgroundColor: colors.cardAlt }]}><Text style={[styles.detailTableHeaderText, { color: tableSort?.key === 'symbol' ? colors.accent : colors.textMuted }]}>標的{tableSort?.key === 'symbol' ? (tableSort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</Text></TouchableOpacity>
              {filteredRows.map(row => <TouchableOpacity key={row.assetId} onPress={() => toggleAssetHistory(row.assetId)} accessibilityRole="button" accessibilityState={{ expanded: selectedAssetId === row.assetId }} accessibilityLabel={`${row.symbol}，${row.name || '名稱未提供'}，查看交易歷史`} activeOpacity={0.7} style={[styles.detailTableRow, styles.detailSymbolRow, { borderTopColor: colors.borderLight }, (highlightedAssetId === row.assetId || selectedAssetId === row.assetId) && styles.assetDetailHighlighted]}><Text numberOfLines={1} style={[styles.detailSymbol, { color: colors.text }]}>{row.symbol}</Text>{Boolean(row.name && row.name !== row.symbol) && <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.detailSymbolName, { color: colors.textSub }]}>{row.name}</Text>}<Text numberOfLines={1} style={[styles.detailSymbolSub, { color: selectedAssetId === row.assetId ? colors.accent : colors.textMuted }]}>{selectedAssetId === row.assetId ? '交易歷史 ↑' : number(row.openShares) > 0 ? `${number(row.openShares).toLocaleString('zh-TW')} 股 ›` : '已平倉 ›'}</Text></TouchableOpacity>)}
            </View>
            <ScrollView horizontal style={styles.detailTableHorizontalScroll} showsHorizontalScrollIndicator contentContainerStyle={styles.detailTableScrollContent} nestedScrollEnabled>
              <View>
                <View style={[styles.detailTableHeader, styles.detailTableDataRow, { backgroundColor: colors.cardAlt }]}>
                  {DETAIL_COLUMNS.map(([key, label]) => <TouchableOpacity key={key} onPress={() => selectTableSort(key)} accessibilityRole="button" accessibilityLabel={`依${label}排序${tableSort?.key === key ? `，目前${tableSort.direction === 'asc' ? '升序' : '降序'}` : ''}`} activeOpacity={0.7} style={[styles.detailSortableHeader, key === 'averageCostPrice' && styles.detailCostPriceCell]}><Text numberOfLines={1} style={[styles.detailTableHeaderText, { color: tableSort?.key === key ? colors.accent : colors.textMuted }]}>{label}{tableSort?.key === key ? (tableSort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</Text></TouchableOpacity>)}
                </View>
                {filteredRows.map(row => <TouchableOpacity key={row.assetId} onPress={() => toggleAssetHistory(row.assetId)} accessibilityRole="button" accessibilityState={{ expanded: selectedAssetId === row.assetId }} accessibilityLabel={`${row.symbol}，查看交易歷史`} activeOpacity={0.7} style={[styles.detailTableRow, styles.detailTableDataRow, { borderTopColor: colors.borderLight }, (highlightedAssetId === row.assetId || selectedAssetId === row.assetId) && styles.assetDetailHighlighted]}>
                  {DETAIL_COLUMNS.map(([key, , signed]) => {
                    const isReturn = key.endsWith('Return');
                    const validReturn = isReturn && Number.isFinite(row[key]);
                    const value = number(row[key]);
                    const displayValue = key === 'averageCostPrice' ? costPrice(row) : isReturn
                      ? (validReturn ? pct(value) : '—')
                      : `${signed ? (value >= 0 ? '+' : '−') : ''}${Math.round(Math.abs(value)).toLocaleString('zh-TW')}`;
                    const valueColor = signed && (!isReturn || validReturn) ? (value >= 0 ? '#0DBD8B' : '#F03030') : colors.text;
                    return <Text key={key} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.detailTableValue, styles.detailTableCell, key === 'averageCostPrice' && styles.detailCostPriceCell, { color: valueColor }]}>{displayValue}</Text>;
                  })}
                </TouchableOpacity>)}
              </View>
            </ScrollView>
          </View>}
        {selectedRow && <View key={selectedRow.assetId} onLayout={event => {
          const y = assetSectionY.current + event.nativeEvent.layout.y;
          requestAnimationFrame(() => detailScrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true }));
        }} style={[styles.tradeHistoryPanel, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}>
          <View style={styles.tradeHistoryHeader}><View style={{ flex: 1 }}><Text style={[styles.timelineTitle, { color: colors.text }]}>{selectedRow.symbol} 交易歷史</Text>{Boolean(selectedRow.name && selectedRow.name !== selectedRow.symbol) && <Text style={[styles.timelineHint, { color: colors.textSub, marginBottom: 2 }]}>{selectedRow.name}</Text>}<Text style={[styles.timelineHint, { color: colors.textMuted, marginBottom: 0 }]}>完整買賣紀錄 · 共 {selectedHistory.length} 筆（含所選期間之前）</Text></View><TouchableOpacity onPress={() => setSelectedAssetId(null)} accessibilityRole="button" accessibilityLabel="關閉交易歷史"><X size={18} color={colors.textMuted} /></TouchableOpacity></View>
          {visibleHistory.length === 0
            ? <Text style={[styles.detailEmpty, { color: colors.textMuted }]}>沒有可顯示的交易紀錄</Text>
            : visibleHistory.map((event, index) => {
              const isSell = event.type === 'SELL';
              const eventColor = isSell ? '#0DBD8B' : colors.accent;
              return <View key={`${event.id || event.assetId}-${event.date}-${index}`} style={[styles.tradeHistoryRow, { borderTopColor: colors.borderLight }]}>
                <Text style={[styles.tradeHistoryDate, { color: colors.textMuted }]}>{event.date.replace(/-/g, '/')}</Text>
                <Text style={[styles.tradeHistoryType, { color: eventColor }]}>{isSell ? '賣出' : '買入'}</Text>
                <Text numberOfLines={1} style={[styles.tradeHistoryShares, { color: colors.text }]}>{number(event.shares).toLocaleString('zh-TW')} 股</Text>
                <Text numberOfLines={1} style={[styles.tradeHistoryAmount, { color: eventColor }]}>{isSell ? '+' : '−'}{Math.round(number(event.amount)).toLocaleString('zh-TW')}</Text>
              </View>;
            })}
          {selectedHistory.length > 8 && <TouchableOpacity onPress={() => setHistoryExpanded(expanded => !expanded)} accessibilityRole="button" style={styles.timelineToggle}><Text style={[styles.timelineToggleText, { color: colors.accent }]}>{historyExpanded ? '收起交易' : `顯示全部 ${selectedHistory.length} 筆`}</Text></TouchableOpacity>}
          <Text style={[styles.tradeHistoryFootnote, { color: colors.textMuted }]}>金額為 {currency} 換算後的支出／淨收，並非單筆損益。</Text>
        </View>}
      </View>
      </ScrollView>
      <TouchableOpacity onPress={onClose} style={[styles.primaryButton, { backgroundColor: colors.accent }]}><Text style={[styles.primaryText, { color: colors.accentContrast }]}>完成</Text></TouchableOpacity>
    </View></View>
  </Modal>;
}

function CustomPeriodModal({
  visible,
  onClose,
  onDismiss,
  start,
  end,
  activeField,
  setActiveField,
  setStart,
  setEnd,
  scrollTrigger,
  onReset,
  onApply,
  colors,
}) {
  const selected = activeField === 'start' ? start : end;
  const setSelected = updater => {
    if (activeField === 'start') setStart(updater);
    else setEnd(updater);
  };
  const setYear = value => setSelected(previous => ({
    ...previous,
    year: value,
    day: Math.min(previous.day, daysInMonth(value, previous.month)),
  }));
  const setMonth = value => setSelected(previous => ({
    ...previous,
    month: value,
    day: Math.min(previous.day, daysInMonth(previous.year, value)),
  }));
  const dayValues = Array.from({ length: daysInMonth(selected.year, selected.month) }, (_, index) => index + 1);
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} onDismiss={onDismiss}>
    <View style={styles.overlay}>
      <View style={[styles.dateRangeModal, { backgroundColor: colors.card }]}>
        <View style={styles.dateRangeHeader}>
          <Text style={[styles.dateRangeTitle, { color: colors.text }]}>請選擇開始日期和結束日期</Text>
          <TouchableOpacity onPress={onClose}><X size={24} color={colors.textSub} /></TouchableOpacity>
        </View>
        <View style={styles.datePillsRow}>
          {[
            { field: 'start', label: '開始日期', value: start },
            { field: 'end', label: '結束日期', value: end },
          ].map(item => {
            const active = activeField === item.field;
            return <TouchableOpacity
              key={item.field}
              activeOpacity={0.8}
              onPress={() => setActiveField(item.field)}
              style={[styles.datePill, { backgroundColor: colors.bg, borderColor: active ? '#10b981' : colors.border }, active && { borderWidth: 2 }]}
            >
              <Text style={[styles.datePillLabel, { color: colors.textSub }]}>{item.label}</Text>
              <Text style={[styles.datePillValue, { color: active ? '#10b981' : colors.text }]}>{datePartsToKey(item.value)}</Text>
            </TouchableOpacity>;
          })}
        </View>
        <View style={styles.dateWheelContainer}>
          <View style={styles.dateWheelHeaders}>{['年', '月', '日'].map(label => <Text key={label} style={[styles.dateWheelHeader, { color: colors.textSub }]}>{label}</Text>)}</View>
          <View pointerEvents="none" style={styles.dateWheelOverlay}><View style={[styles.dateWheelSelection, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]} /></View>
          <View style={styles.dateWheelColumns}>
            <PerformanceWheelColumn data={DATE_YEARS} selectedValue={selected.year} onValueChange={setYear} colors={colors} scrollTrigger={scrollTrigger} />
            <PerformanceWheelColumn data={DATE_MONTHS} selectedValue={selected.month} onValueChange={setMonth} formatLabel={datePad} colors={colors} scrollTrigger={scrollTrigger} />
            <PerformanceWheelColumn data={dayValues} selectedValue={selected.day} onValueChange={value => setSelected(previous => ({ ...previous, day: value }))} formatLabel={datePad} colors={colors} scrollTrigger={scrollTrigger} />
          </View>
        </View>
        <View style={styles.dateRangeButtons}>
          <TouchableOpacity onPress={onReset} style={[styles.dateResetButton, { backgroundColor: colors.bg, borderColor: colors.borderLight }]}><Text style={{ color: colors.textSub, fontSize: 15, fontWeight: '700' }}>重置</Text></TouchableOpacity>
          <TouchableOpacity onPress={onApply} style={[styles.dateApplyButton, { backgroundColor: colors.accent, shadowColor: colors.accent }]}><Text style={[styles.dateApplyText, { color: colors.accentContrast }]}>確定</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>;
}

function ExclusionModal({ visible, onClose, assets, notices = [], savingAssetId, onToggle, colors }) {
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <View style={styles.overlay}>
      <View style={[styles.modal, { backgroundColor: colors.card }]}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>共用排除標的</Text>
            <Text style={[styles.hint, { color: colors.textMuted }]}>點擊資產列即可切換納入／排除；會同步影響交易報酬與圓餅圖，不影響持倉與總資產。</Text>
          </View>
          <TouchableOpacity onPress={onClose} accessibilityLabel="關閉共用排除標的"><X color={colors.textSub} /></TouchableOpacity>
        </View>
        {notices.length > 0 && <View style={[styles.scopeNoticePanel, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
          <Text style={[styles.scopeNoticeTitle, { color: colors.warning || '#f59e0b' }]}>資料提示</Text>
          {notices.map((notice, index) => <Text key={`${notice}-${index}`} style={[styles.scopeNoticeText, { color: colors.textMuted }]}>• {notice}</Text>)}
        </View>}
        <ScrollView style={styles.assetList} showsVerticalScrollIndicator={false}>
          {assets.map(asset => {
            const included = !asset.exclude_from_performance;
            const busy = savingAssetId === asset.id;
            return <TouchableOpacity key={asset.id} disabled={Boolean(savingAssetId)} onPress={() => onToggle(asset)} style={[styles.assetScopeRow, { borderBottomColor: colors.borderLight }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.entryTitle, { color: colors.text }]}>{asset.symbol || asset.name}</Text>
                <Text style={[styles.hint, { color: colors.textMuted }]}>{asset.name}{asset.symbol && asset.name !== asset.symbol ? ` · ${marketLabel(normalizePerformanceMarket(asset.market_type))}` : ''}</Text>
              </View>
              {busy ? <ActivityIndicator size="small" color={colors.accent} /> : <View style={[styles.scopeToggle, { borderColor: included ? colors.accent : colors.border, backgroundColor: included ? colors.accentSoft : colors.cardAlt }]}>
                {included && <Check size={13} color={colors.accent} />}
                <Text style={{ color: included ? colors.accent : colors.textMuted, fontSize: 11, fontWeight: '800' }}>{included ? '納入' : '已排除'}</Text>
              </View>}
            </TouchableOpacity>;
          })}
        </ScrollView>
        <TouchableOpacity onPress={onClose} style={[styles.primaryButton, { backgroundColor: colors.accent }]}><Text style={[styles.primaryText, { color: colors.accentContrast }]}>完成</Text></TouchableOpacity>
      </View>
    </View>
  </Modal>;
}

function SetupModal({ visible, onClose, markets, values, setValues, holdings, baseCurrency, colors, saving, onSave }) { return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}><View style={styles.overlay}><View style={[styles.modal, { backgroundColor: colors.card }]}><View style={styles.header}><View><Text style={[styles.title, { color: colors.text }]}>從今天開始計算</Text><Text style={[styles.hint, { color: colors.textMuted }]}>目前持股會自動帶入，只需填寫各市場尚未投入的券商現金。</Text></View><TouchableOpacity onPress={onClose}><X color={colors.textSub} /></TouchableOpacity></View><ScrollView>{markets.map(market => <View key={market} style={{ marginTop: 14 }}><Text style={[styles.entryTitle, { color: colors.text }]}>{marketLabel(market)} · 持股 {amount(holdings[market], baseCurrency)}</Text><TextInput value={values[market] || ''} onChangeText={value => setValues(prev => ({ ...prev, [market]: value }))} keyboardType="decimal-pad" placeholder={`券商現金（${marketCurrency(market, baseCurrency)}）`} placeholderTextColor={colors.textMuted} style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.cardAlt }]} /></View>)}</ScrollView><TouchableOpacity disabled={saving} onPress={onSave} style={[styles.primaryButton, { backgroundColor: colors.accent }]}>{saving ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={[styles.primaryText, { color: colors.accentContrast }]}>確認起算</Text>}</TouchableOpacity></View></View></Modal>; }

function EntryModal({ visible, onClose, entry, setEntry, markets, baseCurrency, colors, saving, onSave }) { return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}><View style={styles.overlay}><View style={[styles.modal, { backgroundColor: colors.card }]}><View style={styles.header}><Text style={[styles.title, { color: colors.text }]}>新增資金紀錄</Text><TouchableOpacity onPress={onClose}><X color={colors.textSub} /></TouchableOpacity></View><Text style={[styles.label, { color: colors.textSub }]}>市場</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{markets.map(market => <Chip key={market} label={marketLabel(market)} active={entry.market === market} colors={colors} onPress={() => setEntry(prev => ({ ...prev, market, currency: marketCurrency(market, baseCurrency) }))} />)}</ScrollView><Text style={[styles.label, { color: colors.textSub }]}>類型</Text><View style={styles.wrap}>{ENTRY_TYPES.map(([kind, label]) => <Chip key={kind} label={label} active={entry.kind === kind} colors={colors} onPress={() => setEntry(prev => ({ ...prev, kind }))} />)}</View>{['transfer_in', 'transfer_out'].includes(entry.kind) && <Text style={[styles.warning, { color: colors.warning || '#f59e0b' }]}>市場間轉帳請分別新增一筆轉出及一筆轉入；「全部」績效會排除兩筆。</Text>}<View style={styles.twoInputs}><TextInput value={entry.amount} onChangeText={value => setEntry(prev => ({ ...prev, amount: value }))} keyboardType="decimal-pad" placeholder="金額" placeholderTextColor={colors.textMuted} style={[styles.input, styles.flex, { color: colors.text, borderColor: colors.border, backgroundColor: colors.cardAlt }]} /><TextInput value={entry.currency} onChangeText={value => setEntry(prev => ({ ...prev, currency: value.toUpperCase() }))} autoCapitalize="characters" placeholder="幣別" placeholderTextColor={colors.textMuted} style={[styles.input, { width: 90, color: colors.text, borderColor: colors.border, backgroundColor: colors.cardAlt }]} /></View><TextInput value={entry.occurredAt} onChangeText={value => setEntry(prev => ({ ...prev, occurredAt: value }))} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.cardAlt }]} /><TextInput value={entry.note} onChangeText={value => setEntry(prev => ({ ...prev, note: value }))} placeholder="備註（選填）" placeholderTextColor={colors.textMuted} style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.cardAlt }]} /><TouchableOpacity disabled={saving} onPress={onSave} style={[styles.primaryButton, { backgroundColor: colors.accent }]}>{saving ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={[styles.primaryText, { color: colors.accentContrast }]}>儲存</Text>}</TouchableOpacity></View></View></Modal>; }

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 16, borderWidth: 1, borderRadius: 18, padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  title: { fontSize: 18, fontWeight: '900' }, hint: { fontSize: 11, lineHeight: 17, marginTop: 4 }, warning: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginVertical: 5 },
  iconButton: { width: 34, height: 34, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  periodTitle: { fontSize: 11, fontWeight: '800', marginTop: 2 }, periodTabs: { gap: 7, paddingTop: 8, paddingBottom: 12 },
  scopeHeaderRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 11, marginBottom: 2 },
  scopeTitle: { fontSize: 12, fontWeight: '800' }, scopeSubtitle: { fontSize: 10, marginTop: 2 }, scopeSelectButton: { minHeight: 34, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }, scopeSelectText: { fontSize: 12, fontWeight: '800' },
  scopeHint: { fontSize: 10, lineHeight: 15, marginTop: 5 },
  scopeGlassContainer: { borderRadius: 14, borderWidth: 1, padding: 5, marginTop: 9 }, scopePeriodRow: { flexDirection: 'row', gap: 4 }, scopePeriodButton: { flex: 1, minHeight: 36, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 3 }, scopePeriodLabel: { fontSize: 12, fontWeight: '600' }, scopePeriodLabelActive: { fontWeight: '700' },
  tabs: { gap: 7, paddingVertical: 12 }, tab: { paddingHorizontal: 13, paddingVertical: 7, borderWidth: 1, borderRadius: 15 }, tabText: { fontSize: 12, fontWeight: '800' },
  returnOverview: { flexDirection: 'row', gap: 9, marginTop: 11 },
  returnHero: { width: '54%', minHeight: 100, borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
  returnStats: { flex: 1, minWidth: 0, minHeight: 100, borderWidth: 1, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 10, justifyContent: 'center' },
  returnChartTitle: { fontSize: 9, fontWeight: '800' }, navValue: { fontSize: 18, fontWeight: '900', marginTop: 5 }, alphaValue: { fontSize: 8, lineHeight: 12, fontWeight: '800', marginTop: 4 },
  xirr: { width: '100%', fontSize: 29, fontWeight: '900', textAlign: 'center', marginVertical: 4 },
  returnLabel: { fontSize: 10, fontWeight: '800', textAlign: 'center' }, returnCost: { fontSize: 8, fontWeight: '700', textAlign: 'center' }, returnComparison: { fontSize: 7, lineHeight: 10, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  navChartCard: { borderWidth: 1, borderRadius: 14, marginTop: 9, paddingHorizontal: 9, paddingTop: 9, paddingBottom: 5 },
  navChartHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, navChartTitle: { fontSize: 10, fontWeight: '900' }, navChartSubtitle: { fontSize: 7, marginTop: 2 },
  legendRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, flexShrink: 1 }, legendDot: { width: 6, height: 6, borderRadius: 3 }, legendText: { fontSize: 7, fontWeight: '700' },
  navChart: { marginTop: 6, overflow: 'hidden' }, navTooltip: { minHeight: 22, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 3 },
  navTooltipDate: { fontSize: 8 }, navTooltipValue: { fontSize: 8, fontWeight: '900' },
  benchmarkButton: { maxWidth: 128, minHeight: 28, borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 4 }, benchmarkButtonText: { fontSize: 8, fontWeight: '900', flexShrink: 1 }, customBenchmarkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, customBenchmarkInput: { flex: 1, marginTop: 0 }, customBenchmarkAdd: { minHeight: 44, borderRadius: 11, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }, benchmarkList: { marginTop: 12 }, benchmarkGroup: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth }, benchmarkGroupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  navEmpty: { minHeight: 118, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }, navEmptyTitle: { fontSize: 11, fontWeight: '900' }, navEmptyText: { fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 5 },
  navChartFootnote: { fontSize: 7, lineHeight: 11, marginTop: 2, paddingHorizontal: 3 },
  compactPnlRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, marginTop: 11, paddingTop: 10 },
  compactMetric: { flex: 1, minWidth: 0, paddingHorizontal: 3 }, metricLabel: { fontSize: 9 }, compactMetricValue: { fontSize: 11, fontWeight: '900', marginTop: 4 },
  primaryButton: { minHeight: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 16 }, primaryText: { fontWeight: '900' },
  dateRangeModal: { maxHeight: '88%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34 },
  dateRangeHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }, dateRangeTitle: { flex: 1, fontSize: 18, fontWeight: '900' },
  datePillsRow: { flexDirection: 'row', gap: 12, marginBottom: 20 }, datePill: { flex: 1, borderRadius: 14, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' }, datePillLabel: { fontSize: 11, fontWeight: '600', marginBottom: 4 }, datePillValue: { fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  dateWheelContainer: { position: 'relative', marginBottom: 20 }, dateWheelHeaders: { flexDirection: 'row', marginBottom: 6 }, dateWheelHeader: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700' }, dateWheelColumns: { flexDirection: 'row' }, dateWheelOverlay: { position: 'absolute', top: 24, left: 0, right: 0, height: DATE_PICKER_HEIGHT, justifyContent: 'center', pointerEvents: 'none' }, dateWheelSelection: { height: DATE_ITEM_HEIGHT, borderTopWidth: 1, borderBottomWidth: 1 },
  dateRangeButtons: { flexDirection: 'row', gap: 12 }, dateResetButton: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1 }, dateApplyButton: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 5 }, dateApplyText: { fontSize: 16, fontWeight: '800' },
  secondaryButton: { minHeight: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, marginTop: 14 },
  detailButton: { minHeight: 48, borderRadius: 13, borderWidth: 1, paddingHorizontal: 13, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailButtonTitle: { fontSize: 12, fontWeight: '900' }, detailButtonSub: { fontSize: 9, marginTop: 2 },
  detailHeaderSubtitle: { fontSize: 10, marginTop: 2 },
  detailPeriodScroll: { flexGrow: 0, marginTop: 10 }, detailPeriodRow: { gap: 5, paddingRight: 2 },
  detailPeriodButton: { minWidth: 44, minHeight: 30, borderWidth: 1, borderRadius: 9, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  detailPeriodText: { fontSize: 10, fontWeight: '800' },
  detailSummary: { borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 10 },
  detailSummaryPrimary: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailSummaryBreakdown: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 9, marginTop: 7, gap: 10 },
  detailSummaryBreakdownItem: { flex: 1, minWidth: 0 },
  detailBreakdownValue: { fontSize: 13, fontWeight: '800', marginTop: 2 },
  detailBreakdownRate: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  detailReturn: { fontSize: 18, fontWeight: '900', marginTop: 2 },
  detailAnnualized: { fontSize: 15, fontWeight: '900', marginTop: 2 }, detailCost: { fontSize: 9, marginTop: 2 },
  detailFormulaToggle: { alignSelf: 'flex-start', minHeight: 28, justifyContent: 'center' }, detailFormulaToggleText: { fontSize: 10, fontWeight: '800' },
  formula: { fontSize: 10, lineHeight: 15, borderRadius: 9, padding: 9, marginBottom: 4 },
  detailSearch: { height: 40, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailSearchInput: { flex: 1, minWidth: 0, height: 38, paddingVertical: 0, fontSize: 12, textAlignVertical: 'center', includeFontPadding: false },
  detailModal: { height: '88%', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 20 },
  detailContentScroll: { flex: 1, minHeight: 0 }, detailContent: { paddingBottom: 14 },
  detailFilterRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 6 },
  detailResultCount: { fontSize: 9, marginTop: 7 }, detailEmpty: { fontSize: 12, textAlign: 'center', paddingVertical: 26 },
  timelineSection: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 15, paddingTop: 14 },
  timelineTitle: { fontSize: 13, fontWeight: '900' }, timelineHint: { fontSize: 10, lineHeight: 15, marginTop: 4, marginBottom: 12 },
  timelineHorizontalScroll: { flexGrow: 0 }, timelineHorizontalContent: { paddingRight: 2 },
  timelineEntry: { width: 145, minHeight: 74, paddingVertical: 3, justifyContent: 'space-between' },
  timelineTrack: { height: 12, flexDirection: 'row', alignItems: 'center' },
  timelineDot: { width: 8, height: 8, borderRadius: 4 }, timelineTrackLine: { flex: 1, height: 1, marginLeft: 5, marginRight: 8 },
  timelineDate: { fontSize: 9 }, timelineEvent: { fontSize: 10, fontWeight: '800' }, timelineAmount: { fontSize: 10, fontWeight: '800' },
  timelineToggle: { alignSelf: 'flex-start', paddingVertical: 8 }, timelineToggleText: { fontSize: 11, fontWeight: '800' },
  assetDetailsSection: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 14 },
  assetDetailHighlighted: { backgroundColor: 'rgba(83, 157, 255, 0.14)', borderRadius: 10 },
  detailTable: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: 'hidden' },
  detailSymbolColumn: { width: 86, borderRightWidth: StyleSheet.hairlineWidth },
  detailTableHorizontalScroll: { flex: 1, minWidth: 0 },
  detailTableScrollContent: { flexGrow: 1 },
  detailTableHeader: { height: DETAIL_TABLE_HEADER_HEIGHT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  detailTableHeaderText: { fontSize: 10, lineHeight: 14, fontWeight: '700', textAlign: 'center', includeFontPadding: false },
  detailTableRow: { height: DETAIL_TABLE_ROW_HEIGHT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth },
  detailSymbolRow: { paddingHorizontal: 3 },
  detailTableDataRow: { flexDirection: 'row', paddingHorizontal: 0 },
  detailTableCell: { width: 108, paddingHorizontal: 6, textAlign: 'center' },
  detailCostPriceCell: { width: 124 },
  detailSortableHeader: { width: 108, height: DETAIL_TABLE_HEADER_HEIGHT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  detailTableValue: { fontSize: 11, lineHeight: 16, fontWeight: '800', includeFontPadding: false },
  detailSymbol: { fontSize: 10, lineHeight: 14, fontWeight: '800', textAlign: 'center', includeFontPadding: false },
  detailSymbolName: { fontSize: 9, lineHeight: 13, marginTop: 1, textAlign: 'center', includeFontPadding: false },
  detailSymbolSub: { fontSize: 9, lineHeight: 13, marginTop: 1, textAlign: 'center', includeFontPadding: false },
  tradeHistoryPanel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, marginTop: 12, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  tradeHistoryHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  tradeHistoryRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, borderTopWidth: StyleSheet.hairlineWidth },
  tradeHistoryDate: { width: 76, fontSize: 9 }, tradeHistoryType: { width: 28, fontSize: 9, fontWeight: '800' },
  tradeHistoryShares: { flex: 1, fontSize: 9 }, tradeHistoryAmount: { minWidth: 72, fontSize: 10, fontWeight: '800', textAlign: 'right' },
  tradeHistoryFootnote: { fontSize: 9, lineHeight: 13, marginTop: 8 },
  flowLegend: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 9 },
  flowList: { flex: 1, minHeight: 0, marginTop: 8 },
  flowRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 9 },
  flowAmount: { fontSize: 12, fontWeight: '900' },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10 }, entryTitle: { fontSize: 12, fontWeight: '800' }, entryAmount: { fontSize: 11, fontWeight: '800' },
  keyboardAvoider: { flex: 1 }, overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }, modal: { maxHeight: '88%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34 },
  centerModal: { borderRadius: 20, padding: 20 },
  label: { fontSize: 11, fontWeight: '700', marginTop: 14, marginBottom: 7 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 14, borderWidth: 1 },
  scopeNoticePanel: { borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 12 }, scopeNoticeTitle: { fontSize: 11, fontWeight: '800', marginBottom: 4 }, scopeNoticeText: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  assetList: { marginTop: 12 }, assetScopeRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 9 }, scopeToggle: { minWidth: 72, height: 30, borderWidth: 1, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 9 },
  input: { height: 44, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, marginTop: 10 }, twoInputs: { flexDirection: 'row', gap: 8 }, flex: { flex: 1 },
});

export { ExclusionModal };
