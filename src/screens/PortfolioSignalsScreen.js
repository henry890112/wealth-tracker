import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BarChart3, Check, ChevronRight, ChevronUp, CircleAlert, RefreshCw, ShieldCheck, SlidersHorizontal, X } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/ThemeContext';
import { analyzeTechnicalData, fetchMarketTechnicalContext } from '../services/technicalAnalysis';

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
const compactShares = value => {
  const amount = Number(value || 0);
  const absolute = Math.abs(amount);
  const formatted = absolute >= 1000000 ? `${(absolute / 1000000).toFixed(1)}M` : absolute >= 1000 ? `${(absolute / 1000).toFixed(1)}K` : absolute.toFixed(0);
  return `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${formatted}`;
};

function quoteClock(value, market) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: market === 'TW' ? 'Asia/Taipei' : market === 'US' ? 'America/New_York' : 'UTC',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(value));
  } catch {
    return '';
  }
}

const MARKET_LABELS = { TW: '台股', US: '美股', CRYPTO: '加密貨幣' };
const STRATEGY_FILTERS = [
  { key: 'ALL', label: '綜合策略' },
  { key: 'divergence', label: 'MACD 背離' },
  { key: 'rsiDivergence', label: 'RSI 背離' },
  { key: 'kdDivergence', label: 'KD 背離' },
  { key: 'pullback', label: '趨勢回檔' },
  { key: 'breakout', label: '放量突破' },
  { key: 'rsi', label: 'RSI5／RSI10 交叉' },
  { key: 'boundary', label: '雙軌邊界' },
  { key: 'smc', label: 'SMC' },
  { key: 'institutional', label: '籌碼／資金動能' },
];
const STRATEGY_LABELS = Object.fromEntries(STRATEGY_FILTERS.filter(item => item.key !== 'ALL').map(item => [item.key, item.label]));

const STRATEGY_RULES = {
  ALL: {
    title: '綜合策略怎麼判斷？',
    intro: '不是六項投票；必須依序通過趨勢、進場路線、量能與相對強弱。',
    lines: [
      '趨勢：Close > SMA200，且 EMA20 > EMA50；未通過就不做多。',
      '進場：放量突破（HH20、RVOL > 1.2、ADX14 > 18）或 5 日內回檔 EMA20 後與 RSI50 同步站回。',
      '量能：CMF20 > 0 或 OBV 近 5 日斜率向上。',
      '相對強弱：台股對加權、美股對 QQQ、加密貨幣對 BTC；BTC 看自身 SMA50。',
      'MACD 是風險警告，雙軌邊界與 SMC 是結構輔助，不再用成立項目數決定買進。',
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
  rsiDivergence: {
    title: 'RSI 背離怎麼判斷？',
    intro: '比較價格高低點與 RSI14 高低點；背離形成後，仍等待價格、RSI14 與 MA20 同向確認。',
    lines: [
      '偏多：價格創較低低點，但 RSI14 創較高低點；偏空條件反向判斷。',
      '確認：收盤突破／跌破價格確認線、RSI14 多方高於 50 或空方低於 50，且收盤通過 MA20。',
      '跌破／突破失效線、超過觀察期限或確認後重新跌回／站回確認線，訊號失效或降為觀察。',
    ],
  },
  kdDivergence: {
    title: 'KD 背離怎麼判斷？',
    intro: '比較價格高低點與 KD-K 高低點；背離形成後，仍等待價格、K／D 動能與 MA20 同向確認。',
    lines: [
      '偏多：價格創較低低點，但 KD-K 創較高低點；偏空條件反向判斷。',
      '確認：收盤突破／跌破價格確認線、偏多 K 高於 D 或偏空 K 低於 D，且收盤通過 MA20。',
      '跌破／突破失效線、超過觀察期限或確認後重新跌回／站回確認線，訊號失效或降為觀察。',
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
    title: 'RSI5／RSI10 交叉怎麼判斷？',
    intro: '以短期 RSI5 與長期 RSI10 的實際交叉判斷動能方向，支撐／壓力只作輔助。',
    lines: [
      '偏多：RSI5 上穿 RSI10，標記在交叉發生的 K 棒。',
      '偏空：RSI5 下穿 RSI10，標記在交叉發生的 K 棒。',
      '門檻：低檔黃金交叉需 RSI5 上穿 RSI10 且任一線 ≤40；高檔死亡交叉需 RSI5 下穿 RSI10 且任一線 ≥60；未達門檻只列觀察。',
    ],
  },
  boundary: {
    title: '雙軌邊界怎麼判斷？',
    intro: '只研究自動上下邊界附近的反轉或突破回踩，中軸附近不建立訊號。',
    lines: [
      '下邊界：日 K 刺破後收回並留下長下影，且 KD 低檔黃金交叉或 MACD 柱翻正。',
      '上邊界：收盤突破且量能至少 1.2 倍，買盤確認後等待十個交易日內完成回踩。',
      '台股以外資／投信確認；美股與加密貨幣以 CMF20 為正、OBV 五日走升替代。',
      '風險超過 3%、跌破停損或逾期時不列為確認；日 K 訊號只在收盤資料更新後成立。',
    ],
  },
  smc: {
    title: 'SMC 智慧資金怎麼判斷？',
    intro: '依序劃流動性池、分折溢價、辨識 Sweep／CHoCH，再等待 FVG／OB 回踩。',
    lines: [
      'BSL／SSL：以已確認的顯著高低點與密集測試區建立；兩者中點為 EQ 50%。',
      'Sweep：折價區刺破 SSL 收回，或溢價區刺破 BSL 收回，並出現長影線。',
      'CHoCH：大實體 K 棒收破最近內部結構，形成 FVG 或找到突破前最後一根反向 OB，等待回踩才確認。',
      '股票需有相對量與大盤同向；預估 R:R 未達 2.5，或位於 EQ 無人區，只列觀察或不成立。',
    ],
  },
  institutional: {
    title: '籌碼／資金動能怎麼判斷？',
    intro: '台股使用真實法人買賣資料；美股與加密貨幣使用量價資金動能代理指標。',
    lines: [
      '偏多確認：外資＋投信近 5 日合計買超，且至少 3 日為買超。',
      '偏空確認：外資＋投信近 5 日合計賣超，且至少 3 日為賣超。',
      '合計已有方向但同向未達 3 日時只列觀察；資料未公布或其他市場不建立訊號。',
      '自營商與避險部位會顯示在明細中，但不作為此策略的方向確認條件。',
      '美股／加密貨幣：CMF20 與 OBV 近 5 日斜率同向，且相對強弱同向時確認；RVOL ≥ 1.2 標記成交參與明顯。',
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

function buildMultiHorizon(rows, context) {
  const periods = {
    short: analyzeTechnicalData(rows, Math.min(65, rows.length), context),
    medium: analyzeTechnicalData(rows, Math.min(130, rows.length), context),
    long: analyzeTechnicalData(rows, Math.min(260, rows.length), context),
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

  const hybrid = item.analysis.hybrid;
  if (!hybrid || hybrid.status === 'none') return { key: 'neutral', label: '趨勢未通過', reason: hybrid?.reason || '混合策略資料不足。', meta: '分層策略未進入候選' };
  return {
    key: hybrid.status === 'confirmed' ? 'bullish_ready' : 'bullish_watch',
    label: hybrid.status === 'confirmed' ? '混合進場確認' : '混合策略觀察',
    reason: hybrid.reason,
    meta: hybrid.route === 'breakout' ? '放量突破路線' : hybrid.route === 'pullback' ? '趨勢回檔路線' : '等待進場路線',
  };
}

function selectedInstitutionalState(item, strategyFilter) {
  if (marketKey(item.holding) !== 'TW' || !item.analysis) return null;
  const strategies = item.analysis.strategies || [];
  const active = strategyFilter === 'ALL'
    ? strategies.filter(strategy => strategy.status !== 'none')
    : strategies.filter(strategy => strategy.key === strategyFilter);
  const matched = active.find(strategy => strategy.institutional?.passed);
  const pressure = matched?.institutional || active[0]?.institutional || null;
  return pressure ? { ...pressure, matched: Boolean(matched) } : null;
}

function intradayStatesForItem(item, states, strategyFilter) {
  const symbol = String(item.holding?.symbol || '').trim().toUpperCase();
  const market = marketKey(item.holding);
  return states
    .filter(state => String(state.symbol || '').trim().toUpperCase() === symbol
      && String(state.market || '').trim().toUpperCase() === market
      && (strategyFilter === 'ALL' || state.strategy === strategyFilter))
    .sort((a, b) => {
      const priority = { risk: 0, recovered: 1 };
      return (priority[a.status] ?? 2) - (priority[b.status] ?? 2)
        || new Date(b.last_event_at || b.updated_at || 0).getTime() - new Date(a.last_event_at || a.updated_at || 0).getTime();
    });
}

function intradayDescription(state) {
  const price = Number(state.last_price);
  const level = Number(state.invalidation_level);
  const hasPrice = Number.isFinite(price) && price > 0;
  const hasLevel = Number.isFinite(level) && level > 0;
  const direction = state.direction === 'bearish' ? '偏空' : '偏多';
  if (state.status === 'risk') {
    const action = state.direction === 'bearish' ? '站上' : '跌破';
    return `${direction}訊號盤中${action}失效價${hasPrice ? `（現價 ${format(price)}）` : ''}${hasLevel ? `；日線失效價 ${format(level)}` : ''}，等待收盤確認。`;
  }
  if (state.status === 'recovered') {
    return `${direction}訊號已回到失效價緩衝區${hasPrice ? `（現價 ${format(price)}）` : ''}${hasLevel ? `；日線失效價 ${format(level)}` : ''}。日線結論尚未變更。`;
  }
  return `${direction}日線訊號已啟動盤中監控${hasLevel ? `；失效價 ${format(level)}` : ''}。只有觸發風險或收回時才會寄信。`;
}

function intradayCandidates(items) {
  const candidates = [];
  for (const item of items) {
    const analysis = item.analysis;
    const holding = item.holding;
    if (!analysis?.latest?.time || !holding?.symbol) continue;
    for (const strategy of analysis.strategies || []) {
      if (strategy.status !== 'confirmed' || !['bullish', 'bearish'].includes(strategy.direction)) continue;
      const signal = strategy.signal || {};
      const invalidationLevel = Number(
        signal.neckline
        || signal.stop
        || strategy.level
        || signal.level
        || 0,
      );
      if (!(invalidationLevel > 0)) continue;
      candidates.push({
        symbol: holding.symbol,
        market: marketKey(holding),
        strategy: strategy.key,
        direction: strategy.direction,
        candleDate: analysis.latest.time,
        invalidationLevel,
      });
    }
    const hybrid = analysis.hybrid;
    if (hybrid?.status === 'confirmed' && Number(hybrid?.risk?.initialStop) > 0) {
      candidates.push({
        symbol: holding.symbol,
        market: marketKey(holding),
        strategy: 'hybrid',
        direction: 'bullish',
        candleDate: analysis.latest.time,
        invalidationLevel: Number(hybrid.risk.initialStop),
      });
    }
  }
  return candidates;
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
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [marketFilter, setMarketFilter] = useState('ALL');
  const [strategyFilter, setStrategyFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [institutionalOnly, setInstitutionalOnly] = useState(false);
  const [intradayStates, setIntradayStates] = useState([]);
  const [checkingIntraday, setCheckingIntraday] = useState(false);
  const [strategySheetVisible, setStrategySheetVisible] = useState(false);

  const load = useCallback(async (forceRefresh = false, includeIntraday = true) => {
    forceRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('請先登入');
      const [assetsResult, watchlistResult, localWatchlistRaw, intradayResult, hybridResult] = await Promise.all([
        supabase.from('assets')
          .select('id,name,symbol,market_type,currency,current_shares,average_cost,category')
          .eq('user_id', user.id)
          .eq('category', 'investment')
          .gt('current_shares', 0),
        supabase.from('watchlist').select('id,symbol,market_type').eq('user_id', user.id),
        AsyncStorage.getItem('watchlist').catch(() => null),
        supabase.from('signal_intraday_states')
          .select('symbol,market,strategy,direction,invalidation_level,status,last_price,last_event_at,updated_at')
          .eq('user_id', user.id)
          .in('status', ['active', 'risk', 'recovered']),
        supabase.from('hybrid_strategy_positions')
          .select('symbol,market,status,last_price,last_event_at,updated_at,effective_stop,entry_date')
          .eq('user_id', user.id)
          .in('status', ['active', 'risk', 'recovered']),
      ]);
      if (assetsResult.error) throw assetsResult.error;
      // Intraday monitoring must never prevent the daily-K signal list from loading.
      if (intradayResult.error) {
        console.warn('Unable to load intraday signal states:', intradayResult.error.message);
        setIntradayStates([]);
      } else {
        const hybridStates = hybridResult.error ? [] : (hybridResult.data || []).map(position => ({
          symbol: position.symbol,
          market: position.market,
          strategy: 'hybrid',
          direction: 'bullish',
          invalidation_level: position.effective_stop,
          status: position.status,
          last_price: position.last_price,
          last_event_at: position.last_event_at,
          updated_at: position.updated_at,
          candle_date: position.entry_date,
        }));
        if (hybridResult.error) console.warn('Unable to load hybrid position states:', hybridResult.error.message);
        setIntradayStates([...(intradayResult.data || []), ...hybridStates]);
      }
      let localWatchlist = null;
      if (localWatchlistRaw !== null) {
        try { localWatchlist = JSON.parse(localWatchlistRaw); } catch { localWatchlist = []; }
      }
      const cloudWatchlist = watchlistResult.error ? [] : (watchlistResult.data || []);
      const watchlist = cloudWatchlist.length > 0
        ? cloudWatchlist
        : (Array.isArray(localWatchlist) ? localWatchlist : []);
      const holdings = mergeHoldings((assetsResult.data || []).filter(asset => asset.symbol));
      const universe = mergeWatchlist(holdings, watchlist);
      setProgress({ done: 0, total: universe.length });
      let done = 0;
      const analyzed = await analyzeWithLimit(universe, async holding => {
        try {
          const context = await fetchMarketTechnicalContext(holding.symbol, holding.market_type, 1095, forceRefresh, includeIntraday);
          const horizon = buildMultiHorizon(context.rows, context);
          const resolvedHolding = context.name && context.name !== holding.symbol
            ? { ...holding, name: context.name }
            : holding;
          return { holding: resolvedHolding, analysis: horizon.periods.long, isIntraday: context.isIntraday, quoteTime: context.quoteTime, quoteSource: context.quoteSource || context.quote?.source || '', quoteStatus: context.quoteStatus, intradayUnavailable: context.intradayUnavailable, ...horizon };
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

  const refreshIntraday = useCallback(async () => {
    if (checkingIntraday) return;
    setCheckingIntraday(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('signal-notifications', {
        body: { action: 'refresh_intraday', candidates: intradayCandidates(items) },
      });
      if (invokeError) {
        let message = invokeError.message || '目前無法取得盤中報價';
        try {
          const detail = await invokeError.context?.json?.();
          if (detail?.error) message = detail.error;
        } catch {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      setIntradayStates(data?.states || []);
      await load(true, true);
      if (!data?.states?.length) {
        Alert.alert('盤中行情已更新', '已用目前盤中價量重算卡片；目前沒有已確認訊號需要監控失效價。');
      } else {
        Alert.alert('盤中行情已更新', `卡片已用盤中暫估日 K 重算，並監控 ${data.states.length} 個正式日 K 訊號的失效風險。`);
      }
    } catch (refreshError) {
      Alert.alert('無法檢查盤中訊號', refreshError.message || '請確認網路與登入狀態後重試。');
    } finally {
      setCheckingIntraday(false);
    }
  }, [checkingIntraday, items, load]);

  const sourceItems = useMemo(() => {
    if (sourceFilter === 'HOLDING') return items.filter(item => item.holding.isHolding);
    if (sourceFilter === 'WATCHLIST') return items.filter(item => item.holding.isWatchlist);
    return items;
  }, [items, sourceFilter]);

  const marketFilters = useMemo(() => {
    const available = [...new Set(sourceItems.map(item => marketKey(item.holding)))];
    const preferred = ['TW', 'US', 'CRYPTO'];
    available.sort((a, b) => {
      const aIndex = preferred.indexOf(a);
      const bIndex = preferred.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
    return ['ALL', ...preferred, ...available.filter(market => !preferred.includes(market))];
  }, [sourceItems]);

  useEffect(() => {
    if (!marketFilters.includes(marketFilter)) setMarketFilter('ALL');
  }, [marketFilter, marketFilters]);

  const marketItems = useMemo(
    () => marketFilter === 'ALL' ? sourceItems : sourceItems.filter(item => marketKey(item.holding) === marketFilter),
    [sourceItems, marketFilter],
  );

  const evaluatedItems = useMemo(() => marketItems
    .map(item => ({
      ...item,
      display: strategyDisplayState(item, strategyFilter),
      intraday: intradayStatesForItem(item, intradayStates, strategyFilter),
    }))
    .sort((a, b) => STATUS_ORDER[a.display.key] - STATUS_ORDER[b.display.key] || String(a.holding.symbol).localeCompare(String(b.holding.symbol))), [marketItems, strategyFilter, intradayStates]);

  const institutionFilteredItems = useMemo(
    () => institutionalOnly
      ? evaluatedItems.filter(item => selectedInstitutionalState(item, strategyFilter)?.matched)
      : evaluatedItems,
    [evaluatedItems, institutionalOnly, strategyFilter],
  );

  const counts = useMemo(() => ({
    bullish: institutionFilteredItems.filter(item => item.display.key === 'bullish_ready').length,
    bearish: institutionFilteredItems.filter(item => item.display.key === 'bearish_ready').length,
    pending: institutionFilteredItems.filter(item => item.display.key.endsWith('_watch') || item.display.key === 'mixed').length,
  }), [institutionFilteredItems]);

  const displayItems = useMemo(() => institutionFilteredItems.filter(item => {
    if (statusFilter === 'bullish') return item.display.key === 'bullish_ready';
    if (statusFilter === 'bearish') return item.display.key === 'bearish_ready';
    if (statusFilter === 'pending') return item.display.key.endsWith('_watch') || item.display.key === 'mixed';
    return true;
  }), [institutionFilteredItems, statusFilter]);

  const selectedRules = STRATEGY_RULES[strategyFilter] || STRATEGY_RULES.ALL;
  const selectedStrategyLabel = STRATEGY_FILTERS.find(strategy => strategy.key === strategyFilter)?.label || '綜合策略';
  const selectedUniverseTitle = sourceFilter === 'HOLDING' ? '持倉' : sourceFilter === 'WATCHLIST' ? '自選' : '全部';
  const selectedMarketTitle = marketFilter === 'ALL' ? '全部市場' : marketLabel(marketFilter);

  const statusColor = key => {
    if (key === 'bullish_ready') return colors.positive;
    if (key === 'bearish_ready') return colors.negative;
    if (key.endsWith('_watch') || key === 'mixed') return colors.warning;
    return colors.textMuted;
  };

  if (loading) return <View style={[styles.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.accent} /><Text style={[styles.loadingTitle, { color: colors.text }]}>正在分析持倉與自選</Text><Text style={[styles.loadingSub, { color: colors.textSub }]}>{progress.done}/{progress.total || '—'} 檔</Text></View>;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}>
      <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={[styles.heroIcon, { backgroundColor: colors.accentSoft }]}><ShieldCheck size={22} color={colors.accent} /></View><View style={styles.flex}><Text style={[styles.heroTitle, { color: colors.text }]}>持倉與自選進出場訊號</Text><Text style={[styles.heroSub, { color: colors.textSub }]}>多頭趨勢過濾後，等待突破或回檔，再確認量能與相對強弱。</Text></View><TouchableOpacity accessibilityRole="button" accessibilityLabel="立即檢查盤中" disabled={checkingIntraday} onPress={refreshIntraday} style={[styles.intradayRefresh, { backgroundColor: colors.accentSoft, borderColor: colors.accent, opacity: checkingIntraday ? 0.6 : 1 }]}>{checkingIntraday ? <ActivityIndicator size="small" color={colors.accent} /> : <RefreshCw size={15} color={colors.accent} />}<Text style={[styles.intradayRefreshText, { color: colors.accent }]}>{checkingIntraday ? '檢查中' : '盤中檢查'}</Text></TouchableOpacity></View>

      <View style={[styles.rules, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}> 
        <Text style={[styles.rulesTitle, { color: colors.text }]}>{selectedRules.title}</Text>
        <Text style={[styles.rulesIntro, { color: colors.textSub }]}>{selectedRules.intro}</Text>
        {selectedRules.lines.map((line, index) => <View key={`${strategyFilter}-${index}`} style={styles.ruleLine}><View style={[styles.ruleBullet, { backgroundColor: colors.accent }]} /><Text style={[styles.rulesText, { color: colors.textSub }]}>{line}</Text></View>)}
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ selected: institutionalOnly }}
        activeOpacity={0.8}
        onPress={() => setInstitutionalOnly(value => !value)}
        style={[styles.institutionalFilter, { backgroundColor: institutionalOnly ? colors.accentSoft : colors.card, borderColor: institutionalOnly ? colors.accent : colors.border }]}
      >
        <View style={[styles.strategyMiniDot, { backgroundColor: institutionalOnly ? colors.accent : colors.textMuted }]} />
        <View style={styles.flex}><Text style={[styles.institutionalFilterTitle, { color: institutionalOnly ? colors.accent : colors.text }]}>只看法人同向確認</Text><Text style={[styles.institutionalFilterSub, { color: colors.textMuted }]}>僅適用台股；外資＋投信近 5 日同向至少 3 日</Text></View>
        <Text style={[styles.institutionalFilterState, { color: institutionalOnly ? colors.accent : colors.textMuted }]}>{institutionalOnly ? '開啟' : '關閉'}</Text>
      </TouchableOpacity>

      <View style={styles.summaryRow}>{[
        ['bullish', '偏多確認', counts.bullish, colors.positive], ['bearish', '偏空確認', counts.bearish, colors.negative], ['pending', '等待確認', counts.pending, colors.warning],
      ].map(([key, label, value, color]) => {
        const selected = statusFilter === key;
        return <TouchableOpacity key={key} accessibilityRole="button" accessibilityState={{ selected }} activeOpacity={0.78} onPress={() => setStatusFilter(selected ? 'ALL' : key)} style={[styles.summary, { backgroundColor: selected ? `${color}18` : colors.card, borderColor: selected ? color : colors.border }]}><Text style={[styles.summaryValue, { color }]}>{value}</Text><Text style={[styles.summaryLabel, { color: selected ? color : colors.textSub }]}>{label}</Text><Text style={[styles.summaryHint, { color: selected ? color : colors.textMuted }]}>{selected ? '篩選中 · 再按取消' : '點擊篩選'}</Text></TouchableOpacity>;
      })}</View>

      <View><Text style={[styles.filterLabel, { color: colors.textMuted }]}>標的來源</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {[
          ['ALL', '全部', items.length],
          ['HOLDING', '持倉', items.filter(item => item.holding.isHolding).length],
          ['WATCHLIST', '自選', items.filter(item => item.holding.isWatchlist).length],
        ].map(([source, label, count]) => {
          const selected = sourceFilter === source;
          return <TouchableOpacity key={source} style={[styles.filterChip, { backgroundColor: selected ? colors.accent : colors.card, borderColor: selected ? colors.accent : colors.border }]} onPress={() => setSourceFilter(source)} activeOpacity={0.8}>
            <Text style={[styles.filterText, { color: selected ? colors.accentContrast : colors.textSub }]}>{label}</Text>
            <View style={[styles.filterCount, { backgroundColor: selected ? `${colors.accentContrast}25` : colors.cardAlt }]}><Text style={[styles.filterCountText, { color: selected ? colors.accentContrast : colors.textMuted }]}>{count}</Text></View>
          </TouchableOpacity>;
        })}
      </ScrollView></View>

      <View><Text style={[styles.filterLabel, { color: colors.textMuted }]}>市場</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {marketFilters.map(market => {
          const selected = marketFilter === market;
          const count = market === 'ALL' ? sourceItems.length : sourceItems.filter(item => marketKey(item.holding) === market).length;
          return <TouchableOpacity key={market} style={[styles.filterChip, { backgroundColor: selected ? colors.accent : colors.card, borderColor: selected ? colors.accent : colors.border }]} onPress={() => setMarketFilter(market)} activeOpacity={0.8}>
            <Text style={[styles.filterText, { color: selected ? colors.accentContrast : colors.textSub }]}>{market === 'ALL' ? '全部市場' : marketLabel(market)}</Text>
            <View style={[styles.filterCount, { backgroundColor: selected ? `${colors.accentContrast}25` : colors.cardAlt }]}><Text style={[styles.filterCountText, { color: selected ? colors.accentContrast : colors.textMuted }]}>{count}</Text></View>
          </TouchableOpacity>;
        })}
      </ScrollView></View>

      <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: colors.text }]}>{statusFilter === 'ALL' ? `${selectedUniverseTitle} · ${selectedMarketTitle}` : statusFilter === 'bullish' ? '偏多確認' : statusFilter === 'bearish' ? '偏空確認' : '等待確認'}</Text><Text style={[styles.sectionSub, { color: colors.textSub }]}>{displayItems.length} 檔 · {STRATEGY_FILTERS.find(strategy => strategy.key === strategyFilter)?.label}{institutionalOnly ? ' · 法人同向' : ''}</Text></View><TouchableOpacity style={[styles.refresh, { borderColor: colors.border }]} onPress={() => load(true)}><RefreshCw size={16} color={colors.textSub} /></TouchableOpacity></View>

      {error ? <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}><CircleAlert size={24} color={colors.negative} /><Text style={[styles.emptyTitle, { color: colors.text }]}>無法載入訊號</Text><Text style={[styles.emptyText, { color: colors.textSub }]}>{error}</Text></View> : items.length === 0 ? <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}><BarChart3 size={24} color={colors.textMuted} /><Text style={[styles.emptyTitle, { color: colors.text }]}>目前沒有持倉或自選</Text><Text style={[styles.emptyText, { color: colors.textSub }]}>新增具有代號的投資資產或自選標的後，就會出現在這裡。</Text></View> : displayItems.length === 0 ? <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}><BarChart3 size={24} color={colors.textMuted} /><Text style={[styles.emptyTitle, { color: colors.text }]}>{institutionalOnly ? '沒有法人同向的台股標的' : statusFilter !== 'ALL' ? '沒有符合此訊號的標的' : sourceFilter === 'HOLDING' && sourceItems.length === 0 ? '目前沒有持倉標的' : sourceFilter === 'WATCHLIST' && sourceItems.length === 0 ? '目前沒有自選標的' : '這個市場沒有標的'}</Text><Text style={[styles.emptyText, { color: colors.textSub }]}>{institutionalOnly ? '法人篩選只適用台股，並要求外資＋投信近 5 日至少 3 日與技術方向同向。' : statusFilter !== 'ALL' ? '再次點擊上方已選取的統計卡即可取消篩選。' : '請切換其他來源或市場查看目前的進出場訊號。'}</Text></View> : displayItems.map(item => {
        const { holding, analysis } = item;
        const { display } = item;
        const color = statusColor(display.key);
        const hasIntradayState = Boolean(item.intraday?.length);
        const market = marketKey(holding);
        const intradayTime = quoteClock(item.quoteTime, market);
        return <TouchableOpacity key={`${holding.symbol}:${holding.market_type}`} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} activeOpacity={0.82} onPress={() => navigation.navigate('TechnicalAnalysis', { symbol: holding.symbol, name: holding.name, averageCost: holding.average_cost, currentShares: holding.current_shares, marketType: holding.market_type, strategyKey: strategyFilter })}>
          <View style={styles.cardHeader}><View style={styles.flex}><View style={styles.symbolRow}><Text style={[styles.symbol, { color: colors.text }]}>{holding.symbol}</Text>{holding.isHolding && <View style={[styles.sourceBadge, { backgroundColor: colors.cardAlt, borderColor: colors.accent }]}><Text style={[styles.sourceBadgeText, { color: colors.accent }]}>持倉</Text></View>}{holding.isWatchlist && <View style={[styles.sourceBadge, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}><Text style={[styles.sourceBadgeText, { color: colors.accent }]}>自選</Text></View>}</View><Text style={[styles.name, { color: colors.textSub }]}>{holding.name}{holding.isHolding ? ` · ${holding.current_shares.toLocaleString()} 股` : ' · 尚未持有'}</Text></View><View style={[styles.badge, { backgroundColor: `${color}20`, borderColor: color }]}><Text style={[styles.badgeText, { color }]}>{display.label || STATUS_LABELS[display.key]}</Text></View><ChevronRight size={17} color={colors.textMuted} /></View>
          <View style={styles.dataModeRow}>
            <View style={[styles.dataModeBadge, { backgroundColor: item.isIntraday ? `${colors.warning}18` : colors.cardAlt, borderColor: item.isIntraday ? colors.warning : colors.border }]}><Text style={[styles.dataModeText, { color: item.isIntraday ? colors.warning : colors.textSub }]}>{item.isIntraday ? `盤中暫估日 K${intradayTime ? ` · ${intradayTime}` : ''}` : '正式收盤日 K'}{item.quoteSource ? ` · ${item.quoteSource}` : ''}</Text></View>
            {item.intradayUnavailable && <View style={[styles.dataModeBadge, { backgroundColor: `${colors.negative}14`, borderColor: colors.negative }]}><Text style={[styles.dataModeText, { color: colors.negative }]}>盤中行情取得失敗</Text></View>}
            {hasIntradayState && <View style={[styles.dataModeBadge, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}><Text style={[styles.dataModeText, { color: colors.accent }]}>含盤中監控狀態</Text></View>}
          </View>
          {analysis && <View style={[styles.quoteRow, { borderTopColor: colors.borderLight }]}><View><Text style={[styles.quoteLabel, { color: colors.textMuted }]}>{item.isIntraday ? '盤中現價' : '最新收盤'}</Text><Text style={[styles.quoteValue, { color: colors.text }]}>{format(analysis.latest.close)}</Text></View><View><Text style={[styles.quoteLabel, { color: colors.textMuted }]}>{item.isIntraday ? '盤中日期' : '資料日期'}</Text><Text style={[styles.quoteValue, { color: colors.text }]}>{analysis.latest.time}</Text></View><View><Text style={[styles.quoteLabel, { color: colors.textMuted }]}>平均成本</Text><Text style={[styles.quoteValue, { color: colors.text }]}>{holding.isHolding ? format(holding.average_cost) : '—'}</Text></View></View>}
          {item.intraday?.map(state => {
            const isRisk = state.status === 'risk';
            const isRecovered = state.status === 'recovered';
            const stateColor = isRisk ? colors.warning : isRecovered ? colors.positive : colors.accent;
            return <View key={`${state.strategy}:${state.direction}:${state.last_event_at || state.updated_at}`} style={[styles.intradayRow, { backgroundColor: `${stateColor}14`, borderColor: `${stateColor}70` }]}>
              <View style={[styles.intradayDot, { backgroundColor: stateColor }]} />
              <View style={styles.flex}>
                <Text style={[styles.intradayTitle, { color: stateColor }]}>盤中{isRisk ? '風險' : isRecovered ? '已收回' : '監控中'} · {STRATEGY_LABELS[state.strategy] || state.strategy}</Text>
                <Text style={[styles.intradayText, { color: colors.textSub }]}>{intradayDescription(state)}</Text>
              </View>
            </View>;
          })}
          {item.error ? <Text style={[styles.noSignal, { color: colors.textSub }]}>{item.error}</Text> : <>
            {strategyFilter === 'divergence' && <View style={styles.horizonRow}>
              {[
                ['1 年', `${horizonLabel('trend', item.trend)} ${item.trendReturn >= 0 ? '+' : ''}${item.trendReturn.toFixed(1)}%`, item.trend],
                ['6 個月', horizonLabel('signal', item.setup), signalDirection(item.setup)],
                ['3 個月', horizonLabel('signal', item.trigger), signalDirection(item.trigger)],
              ].map(([period, label, direction]) => {
                const horizonColor = direction === 'bullish' ? colors.positive : direction === 'bearish' ? colors.negative : colors.textMuted;
                return <View key={period} style={[styles.horizon, { backgroundColor: colors.cardAlt, borderColor: colors.borderLight }]}><Text style={[styles.horizonPeriod, { color: colors.textMuted }]}>{period}</Text><Text style={[styles.horizonValue, { color: horizonColor }]} numberOfLines={1}>{label}</Text></View>;
              })}
            </View>}
            {strategyFilter === 'ALL' ? <View style={styles.hybridGateList}>{[
              ['大趨勢', analysis?.hybrid?.gates?.trend],
              ['突破路線', analysis?.hybrid?.gates?.breakout],
              ['回檔路線', analysis?.hybrid?.gates?.pullback],
              ['量能確認', analysis?.hybrid?.gates?.volume],
              ['相對強弱', analysis?.hybrid?.gates?.relativeStrength],
            ].map(([label, gate]) => <View key={label} style={[styles.hybridGate, { backgroundColor: colors.cardAlt, borderColor: gate?.passed ? colors.positive : gate?.candidate ? colors.warning : colors.borderLight }]}><View style={[styles.strategyMiniDot, { backgroundColor: gate?.passed ? colors.positive : gate?.candidate ? colors.warning : colors.textMuted }]} /><View style={styles.flex}><Text style={[styles.hybridGateTitle, { color: colors.text }]}>{label} · {gate?.passed ? '通過' : gate?.candidate ? '接近' : '未通過'}</Text><Text style={[styles.hybridGateText, { color: colors.textMuted }]} numberOfLines={2}>{gate?.label || '資料不足'}</Text></View></View>)}</View> : <View style={styles.strategyMiniList}>{(analysis?.strategies || []).map(strategy => {
              const strategyColor = strategy.status === 'confirmed'
                ? (strategy.direction === 'bearish' ? colors.negative : colors.positive)
                : strategy.status === 'watch' ? colors.warning : colors.textMuted;
              const stateLabel = strategy.status === 'confirmed' ? '確認' : strategy.status === 'watch' ? '觀察' : '未成立';
              const selected = strategyFilter === 'ALL' || strategyFilter === strategy.key;
              return <View key={strategy.key} style={[styles.strategyMini, { backgroundColor: colors.cardAlt, borderColor: selected ? strategyColor : colors.borderLight, opacity: selected ? 1 : 0.62 }]}><View style={[styles.strategyMiniDot, { backgroundColor: strategyColor }]} /><Text style={[styles.strategyMiniText, { color: colors.textSub }]} numberOfLines={1}>{strategy.label} · {stateLabel}</Text></View>;
            })}</View>}
            {strategyFilter === 'ALL' && analysis?.hybrid?.status === 'confirmed' && <View style={[styles.riskRow, { backgroundColor: colors.positiveSoft, borderColor: colors.positive }]}><Text style={[styles.riskTitle, { color: colors.positive }]}>ATR 風控</Text><Text style={[styles.riskText, { color: colors.textSub }]}>Entry {format(analysis.hybrid.risk.entryPrice)} · ATR14 {format(analysis.hybrid.risk.atr14)} · 初始停損 {format(analysis.hybrid.risk.initialStop)}</Text></View>}
            {marketKey(holding) === 'TW' && analysis.institutional?.day5 && <><Text style={[styles.institutionalAsOf, { color: colors.textMuted }]}>法人資料截至 {analysis.institutional.day5.asOf || '待更新'}</Text><View style={styles.institutionalRow}>
              {[
                ['外資 5日', analysis.institutional.day5.foreign],
                ['投信 5日', analysis.institutional.day5.trust],
                ['自營 5日', analysis.institutional.day5.dealerSelf],
              ].map(([label, value]) => <View key={label} style={[styles.institutionalMetric, { backgroundColor: colors.cardAlt, borderColor: colors.borderLight }]}><Text style={[styles.institutionalMetricLabel, { color: colors.textMuted }]}>{label}</Text><Text style={[styles.institutionalMetricValue, { color: Number(value) > 0 ? colors.positive : Number(value) < 0 ? colors.negative : colors.textSub }]}>{compactShares(value)}</Text></View>)}
            </View></>}
            <View style={[styles.signalRow, { backgroundColor: `${color}12` }]}><View style={[styles.signalDot, { backgroundColor: color }]} /><View style={styles.flex}><Text style={[styles.signalText, { color: colors.text }]}>{display.reason}</Text><Text style={[styles.signalMeta, { color: colors.textMuted }]}>{display.meta}{display.meta ? ' · ' : ''}點入查看完整條件</Text></View></View>
          </>}
        </TouchableOpacity>;
      })}

      <View style={[styles.notice, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}><CircleAlert size={15} color={colors.accent} /><Text style={[styles.noticeText, { color: colors.textSub }]}>市場開盤時，卡片會以當日盤中 OHLCV 顯示暫估策略結果；正式進場與失效仍以收盤日 K 為準。法人資訊為額外標記，不參與混合策略必要條件。所有結果皆為研究訊號，不會自動下單。</Text></View>
      <View style={{ height: 88 }} />
    </ScrollView>

    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`切換判斷策略，目前為${selectedStrategyLabel}`}
      activeOpacity={0.88}
      onPress={() => setStrategySheetVisible(true)}
      style={[styles.floatingStrategyButton, { backgroundColor: colors.accent, borderColor: colors.border }]}
    >
      <SlidersHorizontal size={17} color={colors.accentContrast} />
      <Text numberOfLines={1} style={[styles.floatingStrategyText, { color: colors.accentContrast }]}>策略・{selectedStrategyLabel}</Text>
      <ChevronUp size={16} color={colors.accentContrast} />
    </TouchableOpacity>

    <Modal visible={strategySheetVisible} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setStrategySheetVisible(false)}>
      <View style={styles.strategySheetOverlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="關閉策略選單" style={StyleSheet.absoluteFill} onPress={() => setStrategySheetVisible(false)} />
        <View style={[styles.strategySheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.strategySheetHeader}>
            <View style={styles.flex}>
              <Text style={[styles.strategySheetTitle, { color: colors.text }]}>切換判斷策略</Text>
              <Text style={[styles.strategySheetHint, { color: colors.textMuted }]}>選擇後會立即更新統計與標的訊號</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="關閉" onPress={() => setStrategySheetVisible(false)} style={[styles.strategySheetClose, { backgroundColor: colors.cardAlt }]}>
              <X size={19} color={colors.textSub} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.strategySheetList} showsVerticalScrollIndicator={false}>
            <View style={styles.strategySheetGrid}>
              {STRATEGY_FILTERS.map(strategy => {
                const selected = strategyFilter === strategy.key;
                const rules = STRATEGY_RULES[strategy.key] || STRATEGY_RULES.ALL;
                return (
                  <TouchableOpacity
                    key={strategy.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    activeOpacity={0.78}
                    onPress={() => {
                      setStrategyFilter(strategy.key);
                      setStrategySheetVisible(false);
                    }}
                    style={[styles.strategySheetOption, { backgroundColor: selected ? colors.accentSoft : colors.cardAlt, borderColor: selected ? colors.accent : colors.border }]}
                  >
                    <View style={styles.strategySheetOptionTop}>
                      <Text numberOfLines={1} style={[styles.strategySheetOptionLabel, { color: selected ? colors.accent : colors.text }]}>{strategy.label}</Text>
                      {selected && <Check size={15} color={colors.accent} />}
                    </View>
                    <Text numberOfLines={2} style={[styles.strategySheetOptionHint, { color: colors.textMuted }]}>{rules.intro}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, scroll: { flex: 1 }, content: { padding: 16, gap: 13 }, flex: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }, loadingTitle: { fontSize: 16, fontWeight: '800', marginTop: 13 }, loadingSub: { fontSize: 12, marginTop: 5 },
  hero: { borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 }, heroIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, heroTitle: { fontSize: 17, fontWeight: '800' }, heroSub: { fontSize: 11, lineHeight: 17, marginTop: 3 }, intradayRefresh: { minWidth: 66, minHeight: 48, borderWidth: 1, borderRadius: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', gap: 3 }, intradayRefreshText: { fontSize: 8, fontWeight: '900' },
  rules: { borderWidth: 1, borderRadius: 15, padding: 12, gap: 7 }, rulesTitle: { fontSize: 13, fontWeight: '800' }, rulesIntro: { fontSize: 10, lineHeight: 16, marginBottom: 2 }, ruleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 }, ruleBullet: { width: 5, height: 5, borderRadius: 3, marginTop: 6 }, rulesText: { flex: 1, fontSize: 10, lineHeight: 16 },
  summaryRow: { flexDirection: 'row', gap: 8 }, summary: { flex: 1, minHeight: 82, borderWidth: 1, borderRadius: 14, paddingVertical: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' }, summaryValue: { fontSize: 20, fontWeight: '900' }, summaryLabel: { fontSize: 9, marginTop: 2 }, summaryHint: { fontSize: 7, fontWeight: '700', marginTop: 4 },
  filterRow: { gap: 8, paddingRight: 4 }, filterChip: { minHeight: 38, borderWidth: 1, borderRadius: 19, paddingLeft: 13, paddingRight: 7, flexDirection: 'row', alignItems: 'center', gap: 7 }, filterText: { fontSize: 11, fontWeight: '800' }, filterCount: { minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, filterCountText: { fontSize: 9, fontWeight: '900' },
  filterLabel: { fontSize: 9, fontWeight: '700', marginBottom: 7 },
  floatingStrategyButton: { position: 'absolute', right: 16, bottom: 18, maxWidth: '72%', minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#000000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 8 },
  floatingStrategyText: { flexShrink: 1, fontSize: 12, fontWeight: '900' },
  strategySheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' },
  strategySheet: { maxHeight: '82%', borderWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34 },
  strategySheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  strategySheetTitle: { fontSize: 20, fontWeight: '900' }, strategySheetHint: { fontSize: 11, marginTop: 4 },
  strategySheetClose: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  strategySheetList: { flexShrink: 1 }, strategySheetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  strategySheetOption: { width: '48.5%', minHeight: 92, borderWidth: 1, borderRadius: 15, paddingHorizontal: 12, paddingVertical: 11 },
  strategySheetOptionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  strategySheetOptionLabel: { flex: 1, fontSize: 12, fontWeight: '900' }, strategySheetOptionHint: { fontSize: 9, lineHeight: 14, marginTop: 8 },
  institutionalFilter: { minHeight: 54, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 }, institutionalFilterTitle: { fontSize: 11, fontWeight: '800' }, institutionalFilterSub: { fontSize: 8, marginTop: 3 }, institutionalFilterState: { fontSize: 9, fontWeight: '900' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }, sectionTitle: { fontSize: 19, fontWeight: '800' }, sectionSub: { fontSize: 10, marginTop: 3 }, refresh: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: 17, padding: 13, gap: 10 }, cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, symbolRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }, symbol: { fontSize: 18, fontWeight: '900' }, sourceBadge: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3 }, sourceBadgeText: { fontSize: 8, fontWeight: '900' }, name: { fontSize: 11, marginTop: 2 }, badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 }, badgeText: { fontSize: 9, fontWeight: '800' },
  dataModeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, dataModeBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }, dataModeText: { fontSize: 8, fontWeight: '800' },
  quoteRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, flexDirection: 'row', justifyContent: 'space-between' }, quoteLabel: { fontSize: 9, marginBottom: 3 }, quoteValue: { fontSize: 11, fontWeight: '700' },
  intradayRow: { borderWidth: 1, borderRadius: 10, padding: 9, flexDirection: 'row', alignItems: 'flex-start', gap: 7 }, intradayDot: { width: 7, height: 7, borderRadius: 4, marginTop: 4 }, intradayTitle: { fontSize: 9, fontWeight: '900' }, intradayText: { fontSize: 9, lineHeight: 14, marginTop: 2 },
  horizonRow: { flexDirection: 'row', gap: 6 }, horizon: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 8 }, horizonPeriod: { fontSize: 8, marginBottom: 3 }, horizonValue: { fontSize: 9, fontWeight: '800' },
  strategyMiniList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, strategyMini: { width: '48.8%', minWidth: 0, borderWidth: 1, borderRadius: 9, paddingHorizontal: 7, minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 5 }, strategyMiniDot: { width: 6, height: 6, borderRadius: 3 }, strategyMiniText: { flex: 1, fontSize: 8, fontWeight: '700' },
  hybridGateList: { gap: 6 }, hybridGate: { borderWidth: 1, borderRadius: 10, padding: 9, flexDirection: 'row', alignItems: 'flex-start', gap: 7 }, hybridGateTitle: { fontSize: 10, fontWeight: '900' }, hybridGateText: { fontSize: 8, lineHeight: 13, marginTop: 2 }, riskRow: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 3 }, riskTitle: { fontSize: 10, fontWeight: '900' }, riskText: { fontSize: 9, lineHeight: 14 },
  institutionalAsOf: { fontSize: 8, marginTop: 2 }, institutionalRow: { flexDirection: 'row', gap: 6 }, institutionalMetric: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 7 }, institutionalMetricLabel: { fontSize: 8 }, institutionalMetricValue: { fontSize: 10, fontWeight: '900', marginTop: 3 },
  signalRow: { borderRadius: 11, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 7 }, signalDot: { width: 8, height: 8, borderRadius: 4 }, signalText: { fontSize: 10, fontWeight: '700', lineHeight: 15 }, signalMeta: { fontSize: 9, marginTop: 3 }, noSignal: { fontSize: 10, lineHeight: 15 },
  empty: { borderWidth: 1, borderRadius: 17, padding: 24, alignItems: 'center', gap: 7 }, emptyTitle: { fontSize: 15, fontWeight: '800' }, emptyText: { fontSize: 11, lineHeight: 17, textAlign: 'center' },
  notice: { borderWidth: 1, borderRadius: 13, padding: 11, flexDirection: 'row', gap: 8, alignItems: 'flex-start' }, noticeText: { flex: 1, fontSize: 10, lineHeight: 16 },
});
