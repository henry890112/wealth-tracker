import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BarChart3, ChevronRight, CircleAlert, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/ThemeContext';
import { analyzeTechnicalData, fetchMarketTechnicalData } from '../services/technicalAnalysis';

const STATUS_LABELS = {
  bullish_ready: '偏多已確認',
  bearish_ready: '偏空已確認',
  bullish_watch: '偏多觀察',
  bearish_watch: '偏空觀察',
  mixed: '方向分歧',
  neutral: '目前無訊號',
  unavailable: '資料不可用',
};

const STATUS_ORDER = {
  bearish_ready: 0,
  bullish_ready: 1,
  bearish_watch: 2,
  bullish_watch: 3,
  mixed: 4,
  neutral: 5,
  unavailable: 6,
};

const format = value => Number(value || 0).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MARKET_LABELS = { WATCHLIST: '自選', TW: '台股', US: '美股', CRYPTO: '加密貨幣' };
const STRATEGY_FILTERS = [
  { key: 'ALL', label: '綜合策略' },
  { key: 'divergence', label: 'MACD 背離' },
  { key: 'pullback', label: '趨勢回檔' },
  { key: 'breakout', label: '放量突破' },
  { key: 'rsi', label: 'RSI 反轉' },
];

const STRATEGY_RULES = {
  ALL: {
    title: '綜合策略怎麼判斷？',
    intro: '四項策略各自判斷，再以已確認訊號優先形成目前方向。',
    lines: [
      'MACD 背離：使用 1 年趨勢、6 個月型態與 3 個月觸發。',
      '趨勢回檔、放量突破及 RSI 反轉：依最新日 K 獨立判斷。',
      '多空策略同時確認會標示「方向分歧」；全部未成立則顯示原因，不強制給訊號。',
    ],
  },
  divergence: {
    title: 'MACD 背離怎麼判斷？',
    intro: '先找價格與 MACD 方向不一致，再等待價格結構確認。',
    lines: [
      '1 年：區間漲跌超過 ±3%，且收盤位於 MA60 同方向，才判定大趨勢。',
      '6 個月：尋找 MACD 背離與確認線，判斷型態是否形成。',
      '3 個月：確認突破／跌破、MACD 與 MA20；三者同向才是高共識。',
    ],
  },
  pullback: {
    title: '趨勢回檔怎麼判斷？',
    intro: '先確認均線趨勢，再等待價格回測 MA20 後轉強或轉弱。',
    lines: [
      '偏多：MA20 > MA60、收盤在 MA60 上方，最低價回到 MA20 上方約 1.5% 範圍。',
      '確認：收盤重新站上 MA20，且高於前一日收盤；偏空條件反向判斷。',
      '觀察：趨勢已成立且價格距 MA20 不超過 3%，但尚未出現確認 K 棒。',
    ],
  },
  breakout: {
    title: '放量突破怎麼判斷？',
    intro: '以最近 20 個交易日的高低點作為突破與跌破門檻。',
    lines: [
      '偏多：收盤超過前 20 日最高價 0.1%；偏空：收盤跌破前 20 日最低價 0.1%。',
      '確認：當日成交量必須達前 20 日平均成交量 1.5 倍。',
      '觀察：距高低點不到 2%，或價格已突破但成交量仍不足。',
    ],
  },
  rsi: {
    title: 'RSI 反轉怎麼判斷？',
    intro: 'RSI 必須與程式辨識出的支撐／壓力區同時成立，不單看超買超賣。',
    lines: [
      '偏多：RSI14 從 30 以下重新站回 30，且價格位於最近支撐區附近。',
      '偏空：RSI14 從 70 以上跌回 70，且價格位於最近壓力區附近。',
      '觀察：RSI 接近 35／65 且靠近關鍵區，但尚未完成穿越確認。',
    ],
  },
};

function marketKey(holding) {
  const market = String(holding?.market_type || '').trim().toUpperCase();
  if (market) return market;
  return /^\d+$/.test(String(holding?.symbol || '')) ? 'TW' : 'OTHER';
}

function marketLabel(market) {
  return MARKET_LABELS[market] || (market === 'OTHER' ? '其他' : market);
}

function mergeHoldings(rows) {
  const merged = new Map();
  rows.forEach(asset => {
    const key = `${String(asset.symbol).toUpperCase()}:${asset.market_type || ''}:${asset.currency || ''}`;
    const shares = Number(asset.current_shares || 0);
    const cost = Number(asset.average_cost || 0);
    if (!merged.has(key)) merged.set(key, { ...asset, current_shares: 0, _costTotal: 0 });
    const item = merged.get(key);
    item.current_shares += shares;
    item._costTotal += shares * cost;
  });
  return Array.from(merged.values()).map(item => ({
    ...item,
    average_cost: item.current_shares > 0 ? item._costTotal / item.current_shares : 0,
    isHolding: true,
    isWatchlist: false,
  }));
}

function mergeWatchlist(holdings, watchlist) {
  const universe = new Map(holdings.map(item => [`${String(item.symbol).toUpperCase()}:${marketKey(item)}`, item]));
  watchlist.forEach(entry => {
    if (!entry?.symbol) return;
    const market = String(entry.market_type || (/^\d+$/.test(String(entry.symbol)) ? 'TW' : 'US'));
    const key = `${String(entry.symbol).toUpperCase()}:${market.toUpperCase()}`;
    const existing = universe.get(key);
    if (existing) {
      existing.isWatchlist = true;
      if ((!existing.name || existing.name === existing.symbol) && entry.name) existing.name = entry.name;
      return;
    }
    universe.set(key, {
      id: `watchlist:${key}`,
      name: entry.name || String(entry.symbol).toUpperCase(),
      symbol: String(entry.symbol).toUpperCase(),
      market_type: market,
      currency: market.toUpperCase() === 'TW' ? 'TWD' : 'USD',
      current_shares: 0,
      average_cost: 0,
      category: 'watchlist',
      isHolding: false,
      isWatchlist: true,
    });
  });
  return [...universe.values()];
}

function latestSignalState(analysis) {
  const signals = analysis?.divergences || [];
  const signal = signals.filter(item => item.status === 'confirmed' || item.status === 'pending').at(-1) || signals.at(-1);
  if (!signal) return { key: 'none', signal: null };
  if (signal.status === 'confirmed') return { key: `${signal.type}_confirmed`, signal };
  if (signal.status === 'pending') return { key: `${signal.type}_pending`, signal };
  return { key: signal.status, signal };
}

function trendState(analysis) {
  const latest = analysis?.latest;
  const first = analysis?.rows?.[0];
  if (!latest || !first || !Number.isFinite(latest.ma60) || !Number.isFinite(first.close)) return 'neutral';
  const periodReturn = (latest.close - first.close) / first.close;
  if (periodReturn > 0.03 && latest.close > latest.ma60) return 'bullish';
  if (periodReturn < -0.03 && latest.close < latest.ma60) return 'bearish';
  return 'neutral';
}

function periodReturn(analysis) {
  const first = analysis?.rows?.[0]?.close;
  const latest = analysis?.latest?.close;
  return Number.isFinite(first) && first !== 0 && Number.isFinite(latest) ? ((latest - first) / first) * 100 : 0;
}

function signalDirection(state) {
  if (state?.key?.startsWith('bullish_')) return 'bullish';
  if (state?.key?.startsWith('bearish_')) return 'bearish';
  return 'neutral';
}

function isActionable(state) {
  return state?.key?.endsWith('_confirmed') || state?.key?.endsWith('_pending');
}

function buildMultiHorizon(rows) {
  const periods = {
    short: analyzeTechnicalData(rows, Math.min(65, rows.length)),
    medium: analyzeTechnicalData(rows, Math.min(130, rows.length)),
    long: analyzeTechnicalData(rows, Math.min(260, rows.length)),
  };
  const trend = trendState(periods.long);
  const setup = latestSignalState(periods.medium);
  const trigger = latestSignalState(periods.short);
  const setupDirection = isActionable(setup) ? signalDirection(setup) : 'neutral';
  const triggerDirection = isActionable(trigger) ? signalDirection(trigger) : 'neutral';
  const triggerConfirmed = trigger.key.endsWith('_confirmed');
  const directions = [trend, setupDirection, triggerDirection].filter(value => value !== 'neutral');
  const hasConflict = directions.includes('bullish') && directions.includes('bearish');
  let key = 'neutral';
  let reason = '3 個月尚未出現已確認觸發，6 個月也沒有有效背離型態。';
  let aligned = 0;

  if (triggerConfirmed && !hasConflict) {
    aligned = [trend, setupDirection, triggerDirection].filter(value => value === triggerDirection).length;
    key = `${triggerDirection}_ready`;
    reason = aligned === 3
      ? '1 年趨勢、6 個月型態與 3 個月觸發同向。'
      : `3 個月已確認，但只有 ${aligned}/3 個週期同向，仍需控制部位。`;
  } else if (hasConflict) {
    key = 'mixed';
    aligned = Math.max(
      [trend, setupDirection, triggerDirection].filter(value => value === 'bullish').length,
      [trend, setupDirection, triggerDirection].filter(value => value === 'bearish').length,
    );
    reason = '長中短週期方向不一致，暫不視為明確進出場確認。';
  } else {
    const watchDirection = triggerDirection !== 'neutral' ? triggerDirection : setupDirection !== 'neutral' ? setupDirection : trend;
    if (watchDirection !== 'neutral') {
      aligned = [trend, setupDirection, triggerDirection].filter(value => value === watchDirection).length;
      key = `${watchDirection}_watch`;
      reason = trigger.key.endsWith('_pending')
        ? '3 個月觸發仍在等待確認線、MACD 與 MA20 條件成立。'
        : '已有方向或中期型態，但 3 個月尚未出現有效確認。';
    }
  }

  return { periods, trend, trendReturn: periodReturn(periods.long), setup, trigger, key, aligned, reason };
}

const directionLabel = direction => ({ bullish: '偏多', bearish: '偏空', neutral: '中性' }[direction] || '中性');

function horizonLabel(kind, value) {
  if (kind === 'trend') return `${directionLabel(value)}趨勢`;
  if (!value?.signal || !isActionable(value)) return '無有效訊號';
  const direction = signalDirection(value);
  return `${directionLabel(direction)}${value.key.endsWith('_confirmed') ? '確認' : '待確認'}`;
}

function strategyDisplayState(item, strategyFilter) {
  if (item.error || !item.analysis) return { key: 'unavailable', reason: item.error || '技術資料不可用', meta: '' };
  if (strategyFilter === 'divergence') {
    const setupDirection = isActionable(item.setup) ? signalDirection(item.setup) : 'neutral';
    const triggerDirection = isActionable(item.trigger) ? signalDirection(item.trigger) : 'neutral';
    if (setupDirection !== 'neutral' && triggerDirection !== 'neutral' && setupDirection !== triggerDirection) {
      return { key: 'mixed', label: 'MACD 方向分歧', reason: '6 個月與 3 個月的有效 MACD 背離方向相反，暫不視為進出場確認。', meta: 'MACD 多週期方向不一致' };
    }
    const selectedState = isActionable(item.trigger) ? item.trigger : isActionable(item.setup) ? item.setup : null;
    if (!selectedState) {
      return {
        key: 'neutral',
        label: 'MACD 未成立',
        reason: `3 個月與 6 個月都沒有有效 MACD 背離；1 年${directionLabel(item.trend)}只代表趨勢，不會單獨產生 MACD 觀察訊號。`,
        meta: 'MACD 背離 0/2 週期',
      };
    }
    const direction = signalDirection(selectedState);
    const triggerConfirmed = selectedState === item.trigger && selectedState.key.endsWith('_confirmed');
    const key = `${direction}_${triggerConfirmed ? 'ready' : 'watch'}`;
    const aligned = [item.trend, setupDirection, triggerDirection].filter(value => value === direction).length;
    const period = selectedState === item.trigger ? '3 個月' : '6 個月';
    return {
      key,
      reason: triggerConfirmed
        ? `${period} MACD 背離已突破確認線；目前 ${aligned}/3 個週期同向。`
        : `${period}已出現${directionLabel(direction)}背離型態，等待 3 個月確認線、MACD 與 MA20 條件。`,
      meta: `MACD 多週期同向 ${aligned}/3`,
    };
  }

  const strategies = item.analysis.strategies || [];
  if (strategyFilter !== 'ALL') {
    const selected = strategies.find(strategy => strategy.key === strategyFilter);
    if (!selected || selected.status === 'none') return { key: 'neutral', reason: selected?.reason || '目前沒有此策略的有效資料。', meta: selected?.label || '' };
    return {
      key: `${selected.direction}_${selected.status === 'confirmed' ? 'ready' : 'watch'}`,
      reason: selected.reason,
      meta: selected.label,
    };
  }

  const confirmed = strategies.filter(strategy => strategy.status === 'confirmed');
  const watching = strategies.filter(strategy => strategy.status === 'watch');
  const active = confirmed.length ? confirmed : watching;
  if (!active.length) return { key: 'neutral', reason: '四項策略目前都未成立；卡片仍保留各策略結果供檢查。', meta: '0/4 策略啟動' };
  const directions = [...new Set(active.map(strategy => strategy.direction).filter(direction => direction !== 'neutral'))];
  if (directions.length > 1) return { key: 'mixed', reason: '目前策略同時出現偏多與偏空判斷，方向尚未形成共識。', meta: `${active.length}/4 策略啟動` };
  const direction = directions[0] || 'neutral';
  const labels = active.map(strategy => strategy.label).join('、');
  return {
    key: direction === 'neutral' ? 'neutral' : `${direction}_${confirmed.length ? 'ready' : 'watch'}`,
    reason: `${labels}${confirmed.length ? '已確認' : '接近成立'}。`,
    meta: `${active.length}/4 策略啟動`,
  };
}

async function analyzeWithLimit(holdings, mapper, limit = 3) {
  const results = new Array(holdings.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < holdings.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(holdings[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, holdings.length) }, worker));
  return results;
}

export default function PortfolioSignalsScreen({ navigation }) {
  const { colors } = useTheme();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState(null);
  const [marketFilter, setMarketFilter] = useState('ALL');
  const [strategyFilter, setStrategyFilter] = useState('divergence');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const load = useCallback(async (forceRefresh = false) => {
    forceRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('請先登入');
      const [assetsResult, watchlistResult, localWatchlistRaw] = await Promise.all([
        supabase.from('assets')
          .select('id,name,symbol,market_type,currency,current_shares,average_cost,category')
          .eq('user_id', user.id)
          .eq('category', 'investment')
          .gt('current_shares', 0),
        supabase.from('watchlist').select('id,symbol,market_type').eq('user_id', user.id),
        AsyncStorage.getItem('watchlist').catch(() => null),
      ]);
      if (assetsResult.error) throw assetsResult.error;
      let localWatchlist = null;
      if (localWatchlistRaw !== null) {
        try { localWatchlist = JSON.parse(localWatchlistRaw); } catch { localWatchlist = []; }
      }
      const watchlist = Array.isArray(localWatchlist) ? localWatchlist : (watchlistResult.data || []);
      const holdings = mergeHoldings((assetsResult.data || []).filter(asset => asset.symbol));
      const universe = mergeWatchlist(holdings, watchlist);
      setProgress({ done: 0, total: universe.length });
      let done = 0;
      const analyzed = await analyzeWithLimit(universe, async holding => {
        try {
          const rows = await fetchMarketTechnicalData(holding.symbol, holding.market_type, 1095, forceRefresh);
          const horizon = buildMultiHorizon(rows);
          return { holding, analysis: horizon.periods.long, ...horizon };
        } catch (itemError) {
          return { holding, analysis: null, key: 'unavailable', signal: null, error: itemError.message || '無法取得行情' };
        } finally {
          done += 1;
          setProgress({ done, total: universe.length });
        }
      });
      setItems(analyzed.sort((a, b) => STATUS_ORDER[a.key] - STATUS_ORDER[b.key] || String(a.holding.symbol).localeCompare(String(b.holding.symbol))));
    } catch (loadError) {
      setError(loadError.message || '無法載入持倉訊號');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const marketFilters = useMemo(() => {
    const available = [...new Set(items.map(item => marketKey(item.holding)))];
    const preferred = ['TW', 'US', 'CRYPTO'];
    available.sort((a, b) => {
      const aIndex = preferred.indexOf(a);
      const bIndex = preferred.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
    return ['ALL', 'WATCHLIST', ...available];
  }, [items]);

  useEffect(() => {
    if (!marketFilters.includes(marketFilter)) setMarketFilter('ALL');
  }, [marketFilter, marketFilters]);

  const marketItems = useMemo(
    () => marketFilter === 'ALL'
      ? items
      : marketFilter === 'WATCHLIST'
        ? items.filter(item => item.holding.isWatchlist)
        : items.filter(item => marketKey(item.holding) === marketFilter),
    [items, marketFilter],
  );

  const evaluatedItems = useMemo(() => marketItems
    .map(item => ({ ...item, display: strategyDisplayState(item, strategyFilter) }))
    .sort((a, b) => STATUS_ORDER[a.display.key] - STATUS_ORDER[b.display.key] || String(a.holding.symbol).localeCompare(String(b.holding.symbol))), [marketItems, strategyFilter]);

  const counts = useMemo(() => ({
    bullish: evaluatedItems.filter(item => item.display.key === 'bullish_ready').length,
    bearish: evaluatedItems.filter(item => item.display.key === 'bearish_ready').length,
    pending: evaluatedItems.filter(item => item.display.key.endsWith('_watch') || item.display.key === 'mixed').length,
  }), [evaluatedItems]);

  const displayItems = useMemo(() => evaluatedItems.filter(item => {
    if (statusFilter === 'bullish') return item.display.key === 'bullish_ready';
    if (statusFilter === 'bearish') return item.display.key === 'bearish_ready';
    if (statusFilter === 'pending') return item.display.key.endsWith('_watch') || item.display.key === 'mixed';
    return true;
  }), [evaluatedItems, statusFilter]);

  const selectedRules = STRATEGY_RULES[strategyFilter] || STRATEGY_RULES.ALL;

  const statusColor = key => {
    if (key === 'bullish_ready') return colors.positive;
    if (key === 'bearish_ready') return colors.negative;
    if (key.endsWith('_watch') || key === 'mixed') return colors.warning;
    return colors.textMuted;
  };

  if (loading) return <View style={[styles.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.accent} /><Text style={[styles.loadingTitle, { color: colors.text }]}>正在分析持倉與自選</Text><Text style={[styles.loadingSub, { color: colors.textSub }]}>{progress.done}/{progress.total || '—'} 檔</Text></View>;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}>
      <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={[styles.heroIcon, { backgroundColor: colors.accentSoft }]}><ShieldCheck size={22} color={colors.accent} /></View><View style={styles.flex}><Text style={[styles.heroTitle, { color: colors.text }]}>持倉與自選進出場訊號</Text><Text style={[styles.heroSub, { color: colors.textSub }]}>多週期共識：1 年看趨勢、6 個月找型態、3 個月確認觸發。</Text></View></View>

      <View><Text style={[styles.filterLabel, { color: colors.textMuted }]}>判斷策略</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {STRATEGY_FILTERS.map(strategy => {
          const selected = strategyFilter === strategy.key;
          return <TouchableOpacity key={strategy.key} style={[styles.strategyFilterChip, { backgroundColor: selected ? colors.accentSoft : colors.card, borderColor: selected ? colors.accent : colors.border }]} onPress={() => setStrategyFilter(strategy.key)} activeOpacity={0.8}><Text style={[styles.strategyFilterText, { color: selected ? colors.accent : colors.textSub }]}>{strategy.label}</Text></TouchableOpacity>;
        })}
      </ScrollView></View>

      <View style={[styles.rules, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}> 
        <Text style={[styles.rulesTitle, { color: colors.text }]}>{selectedRules.title}</Text>
        <Text style={[styles.rulesIntro, { color: colors.textSub }]}>{selectedRules.intro}</Text>
        {selectedRules.lines.map((line, index) => <View key={`${strategyFilter}-${index}`} style={styles.ruleLine}><View style={[styles.ruleBullet, { backgroundColor: colors.accent }]} /><Text style={[styles.rulesText, { color: colors.textSub }]}>{line}</Text></View>)}
      </View>

      <View style={styles.summaryRow}>{[
        ['bullish', '偏多確認', counts.bullish, colors.positive], ['bearish', '偏空確認', counts.bearish, colors.negative], ['pending', '等待確認', counts.pending, colors.warning],
      ].map(([key, label, value, color]) => {
        const selected = statusFilter === key;
        return <TouchableOpacity key={key} accessibilityRole="button" accessibilityState={{ selected }} activeOpacity={0.78} onPress={() => setStatusFilter(selected ? 'ALL' : key)} style={[styles.summary, { backgroundColor: selected ? `${color}18` : colors.card, borderColor: selected ? color : colors.border }]}><Text style={[styles.summaryValue, { color }]}>{value}</Text><Text style={[styles.summaryLabel, { color: selected ? color : colors.textSub }]}>{label}</Text><Text style={[styles.summaryHint, { color: selected ? color : colors.textMuted }]}>{selected ? '篩選中 · 再按取消' : '點擊篩選'}</Text></TouchableOpacity>;
      })}</View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {marketFilters.map(market => {
          const selected = marketFilter === market;
          const count = market === 'ALL' ? items.length : market === 'WATCHLIST' ? items.filter(item => item.holding.isWatchlist).length : items.filter(item => marketKey(item.holding) === market).length;
          return <TouchableOpacity key={market} style={[styles.filterChip, { backgroundColor: selected ? colors.accent : colors.card, borderColor: selected ? colors.accent : colors.border }]} onPress={() => setMarketFilter(market)} activeOpacity={0.8}>
            <Text style={[styles.filterText, { color: selected ? colors.accentContrast : colors.textSub }]}>{market === 'ALL' ? '全部' : marketLabel(market)}</Text>
            <View style={[styles.filterCount, { backgroundColor: selected ? `${colors.accentContrast}25` : colors.cardAlt }]}><Text style={[styles.filterCountText, { color: selected ? colors.accentContrast : colors.textMuted }]}>{count}</Text></View>
          </TouchableOpacity>;
        })}
      </ScrollView>

      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: colors.text }]}>{statusFilter === 'ALL' ? (marketFilter === 'ALL' ? '全部標的' : marketFilter === 'WATCHLIST' ? '自選清單' : `${marketLabel(marketFilter)}標的`) : statusFilter === 'bullish' ? '偏多確認' : statusFilter === 'bearish' ? '偏空確認' : '等待確認'}</Text><Text style={[styles.sectionSub, { color: colors.textSub }]}>{displayItems.length} 檔 · {STRATEGY_FILTERS.find(strategy => strategy.key === strategyFilter)?.label}</Text></View><TouchableOpacity style={[styles.refresh, { borderColor: colors.border }]} onPress={() => load(true)}><RefreshCw size={16} color={colors.textSub} /></TouchableOpacity></View>

      {error ? <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}><CircleAlert size={24} color={colors.negative} /><Text style={[styles.emptyTitle, { color: colors.text }]}>無法載入訊號</Text><Text style={[styles.emptyText, { color: colors.textSub }]}>{error}</Text></View> : items.length === 0 ? <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}><BarChart3 size={24} color={colors.textMuted} /><Text style={[styles.emptyTitle, { color: colors.text }]}>目前沒有持倉或自選</Text><Text style={[styles.emptyText, { color: colors.textSub }]}>新增具有代號的投資資產或自選標的後，就會出現在這裡。</Text></View> : displayItems.length === 0 ? <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}><BarChart3 size={24} color={colors.textMuted} /><Text style={[styles.emptyTitle, { color: colors.text }]}>{statusFilter !== 'ALL' ? '沒有符合此訊號的標的' : marketFilter === 'WATCHLIST' ? '目前沒有自選標的' : '這個市場沒有標的'}</Text><Text style={[styles.emptyText, { color: colors.textSub }]}>{statusFilter !== 'ALL' ? '再次點擊上方已選取的統計卡即可取消篩選。' : '請切換其他分類查看目前的進出場訊號。'}</Text></View> : displayItems.map(item => {
        const { holding, analysis } = item;
        const { display } = item;
        const color = statusColor(display.key);
        return <TouchableOpacity key={`${holding.symbol}:${holding.market_type}`} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} activeOpacity={0.82} onPress={() => navigation.navigate('TechnicalAnalysis', { symbol: holding.symbol, name: holding.name, averageCost: holding.average_cost, marketType: holding.market_type })}>
          <View style={styles.cardHeader}><View style={styles.flex}><View style={styles.symbolRow}><Text style={[styles.symbol, { color: colors.text }]}>{holding.symbol}</Text>{holding.isHolding && <View style={[styles.sourceBadge, { backgroundColor: colors.cardAlt, borderColor: colors.accent }]}><Text style={[styles.sourceBadgeText, { color: colors.accent }]}>持倉</Text></View>}{holding.isWatchlist && <View style={[styles.sourceBadge, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}><Text style={[styles.sourceBadgeText, { color: colors.accent }]}>自選</Text></View>}</View><Text style={[styles.name, { color: colors.textSub }]}>{holding.name}{holding.isHolding ? ` · ${holding.current_shares.toLocaleString()} 股` : ' · 尚未持有'}</Text></View><View style={[styles.badge, { backgroundColor: `${color}20`, borderColor: color }]}><Text style={[styles.badgeText, { color }]}>{display.label || STATUS_LABELS[display.key]}</Text></View><ChevronRight size={17} color={colors.textMuted} /></View>
          {analysis && <View style={[styles.quoteRow, { borderTopColor: colors.borderLight }]}><View><Text style={[styles.quoteLabel, { color: colors.textMuted }]}>最新收盤</Text><Text style={[styles.quoteValue, { color: colors.text }]}>{format(analysis.latest.close)}</Text></View><View><Text style={[styles.quoteLabel, { color: colors.textMuted }]}>資料日期</Text><Text style={[styles.quoteValue, { color: colors.text }]}>{analysis.latest.time}</Text></View><View><Text style={[styles.quoteLabel, { color: colors.textMuted }]}>平均成本</Text><Text style={[styles.quoteValue, { color: colors.text }]}>{holding.isHolding ? format(holding.average_cost) : '—'}</Text></View></View>}
          {item.error ? <Text style={[styles.noSignal, { color: colors.textSub }]}>{item.error}</Text> : <>
            {(strategyFilter === 'divergence' || strategyFilter === 'ALL') && <View style={styles.horizonRow}>
              {[
                ['1 年', `${horizonLabel('trend', item.trend)} ${item.trendReturn >= 0 ? '+' : ''}${item.trendReturn.toFixed(1)}%`, item.trend],
                ['6 個月', horizonLabel('signal', item.setup), signalDirection(item.setup)],
                ['3 個月', horizonLabel('signal', item.trigger), signalDirection(item.trigger)],
              ].map(([period, label, direction]) => {
                const horizonColor = direction === 'bullish' ? colors.positive : direction === 'bearish' ? colors.negative : colors.textMuted;
                return <View key={period} style={[styles.horizon, { backgroundColor: colors.cardAlt, borderColor: colors.borderLight }]}><Text style={[styles.horizonPeriod, { color: colors.textMuted }]}>{period}</Text><Text style={[styles.horizonValue, { color: horizonColor }]} numberOfLines={1}>{label}</Text></View>;
              })}
            </View>}
            <View style={styles.strategyMiniList}>{(analysis?.strategies || []).map(strategy => {
              const strategyColor = strategy.status === 'confirmed'
                ? (strategy.direction === 'bearish' ? colors.negative : colors.positive)
                : strategy.status === 'watch' ? colors.warning : colors.textMuted;
              const stateLabel = strategy.status === 'confirmed' ? '確認' : strategy.status === 'watch' ? '觀察' : '未成立';
              const selected = strategyFilter === 'ALL' || strategyFilter === strategy.key;
              return <View key={strategy.key} style={[styles.strategyMini, { backgroundColor: colors.cardAlt, borderColor: selected ? strategyColor : colors.borderLight, opacity: selected ? 1 : 0.62 }]}><View style={[styles.strategyMiniDot, { backgroundColor: strategyColor }]} /><Text style={[styles.strategyMiniText, { color: colors.textSub }]} numberOfLines={1}>{strategy.label} · {stateLabel}</Text></View>;
            })}</View>
            <View style={[styles.signalRow, { backgroundColor: `${color}12` }]}><View style={[styles.signalDot, { backgroundColor: color }]} /><View style={styles.flex}><Text style={[styles.signalText, { color: colors.text }]}>{display.reason}</Text><Text style={[styles.signalMeta, { color: colors.textMuted }]}>{display.meta}{display.meta ? ' · ' : ''}點入查看完整條件</Text></View></View>
          </>}
        </TouchableOpacity>;
      })}

      <View style={[styles.notice, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}><CircleAlert size={15} color={colors.accent} /><Text style={[styles.noticeText, { color: colors.textSub }]}>MACD 背離使用 1 年／6 個月／3 個月共識；其他策略依最近一年資料中的最新日 K 判斷。所有結果皆為研究訊號，不保證進出場結果。</Text></View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 13 }, flex: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }, loadingTitle: { fontSize: 16, fontWeight: '800', marginTop: 13 }, loadingSub: { fontSize: 12, marginTop: 5 },
  hero: { borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 }, heroIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, heroTitle: { fontSize: 17, fontWeight: '800' }, heroSub: { fontSize: 11, lineHeight: 17, marginTop: 3 },
  rules: { borderWidth: 1, borderRadius: 15, padding: 12, gap: 7 }, rulesTitle: { fontSize: 13, fontWeight: '800' }, rulesIntro: { fontSize: 10, lineHeight: 16, marginBottom: 2 }, ruleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 }, ruleBullet: { width: 5, height: 5, borderRadius: 3, marginTop: 6 }, rulesText: { flex: 1, fontSize: 10, lineHeight: 16 },
  summaryRow: { flexDirection: 'row', gap: 8 }, summary: { flex: 1, minHeight: 82, borderWidth: 1, borderRadius: 14, paddingVertical: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' }, summaryValue: { fontSize: 20, fontWeight: '900' }, summaryLabel: { fontSize: 9, marginTop: 2 }, summaryHint: { fontSize: 7, fontWeight: '700', marginTop: 4 },
  filterRow: { gap: 8, paddingRight: 4 }, filterChip: { minHeight: 38, borderWidth: 1, borderRadius: 19, paddingLeft: 13, paddingRight: 7, flexDirection: 'row', alignItems: 'center', gap: 7 }, filterText: { fontSize: 11, fontWeight: '800' }, filterCount: { minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, filterCountText: { fontSize: 9, fontWeight: '900' },
  filterLabel: { fontSize: 9, fontWeight: '700', marginBottom: 7 }, strategyFilterChip: { minHeight: 36, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }, strategyFilterText: { fontSize: 10, fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }, sectionTitle: { fontSize: 19, fontWeight: '800' }, sectionSub: { fontSize: 10, marginTop: 3 }, refresh: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: 17, padding: 13, gap: 10 }, cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, symbolRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }, symbol: { fontSize: 18, fontWeight: '900' }, sourceBadge: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3 }, sourceBadgeText: { fontSize: 8, fontWeight: '900' }, name: { fontSize: 11, marginTop: 2 }, badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 }, badgeText: { fontSize: 9, fontWeight: '800' },
  quoteRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, flexDirection: 'row', justifyContent: 'space-between' }, quoteLabel: { fontSize: 9, marginBottom: 3 }, quoteValue: { fontSize: 11, fontWeight: '700' },
  horizonRow: { flexDirection: 'row', gap: 6 }, horizon: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 8 }, horizonPeriod: { fontSize: 8, marginBottom: 3 }, horizonValue: { fontSize: 9, fontWeight: '800' },
  strategyMiniList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, strategyMini: { width: '48.8%', minWidth: 0, borderWidth: 1, borderRadius: 9, paddingHorizontal: 7, minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 5 }, strategyMiniDot: { width: 6, height: 6, borderRadius: 3 }, strategyMiniText: { flex: 1, fontSize: 8, fontWeight: '700' },
  signalRow: { borderRadius: 11, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 7 }, signalDot: { width: 8, height: 8, borderRadius: 4 }, signalText: { fontSize: 10, fontWeight: '700', lineHeight: 15 }, signalMeta: { fontSize: 9, marginTop: 3 }, noSignal: { fontSize: 10, lineHeight: 15 },
  empty: { borderWidth: 1, borderRadius: 17, padding: 24, alignItems: 'center', gap: 7 }, emptyTitle: { fontSize: 15, fontWeight: '800' }, emptyText: { fontSize: 11, lineHeight: 17, textAlign: 'center' },
  notice: { borderWidth: 1, borderRadius: 13, padding: 11, flexDirection: 'row', gap: 8, alignItems: 'flex-start' }, noticeText: { flex: 1, fontSize: 10, lineHeight: 16 },
});
