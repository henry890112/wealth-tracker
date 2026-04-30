import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wallet, TrendingUp, Home, DollarSign, CreditCard, Plus, RefreshCw, Eye, EyeOff } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { convertToBaseCurrency, fetchExchangeRatesBatch, fetchTWStockPrice, fetchTWStockPriceBatch, fetchUSStockPriceBatch, fetchCryptoPriceBatch } from '../services/api';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../lib/ThemeContext';

const DASHBOARD_CACHE_KEY = '@wt_dashboard_cache';

const PRIMARY = '#F7A600';
const GREEN   = '#0DBD8B';
const RED     = '#F03030';

const CATEGORY_CONFIG = {
  liquid:     { label: '流動資產', Icon: Wallet,      color: '#0DBD8B', bg: '#dcfce7', bgDark: 'rgba(13,189,139,0.12)' },
  investment: { label: '投資資產', Icon: TrendingUp,  color: '#F7A600', bg: '#fef3c7', bgDark: '#78350f33' },
  fixed:      { label: '固定資產', Icon: Home,        color: '#94a3b8', bg: '#f1f5f9', bgDark: '#33415533' },
  receivable: { label: '應收款項', Icon: DollarSign,  color: '#0d9488', bg: '#ccfbf1', bgDark: '#13403c33' },
  liability:  { label: '負債',     Icon: CreditCard,  color: '#F03030', bg: '#fee2e2', bgDark: 'rgba(240,48,48,0.12)' },
};

const ASSET_CATEGORIES = ['liquid', 'investment', 'fixed', 'receivable'];

const MARKET_TYPE_CONFIG = {
  TW:     { label: '台股', color: '#e11d48' },
  US:     { label: '美股', color: '#2563eb' },
  Crypto: { label: '虛幣', color: '#f59e0b' },
  other:  { label: '其他', color: '#94a3b8' },
};

const DONUT_COLORS = {
  investment: '#F7A600',
  liquid:     '#0DBD8B',
  fixed:      '#6B7280',
  receivable: '#94A3B8',
};

const formatAmount = (amount) => Math.round(amount).toLocaleString('zh-TW');

// ─── Sparkline ───────────────────────────────────────────────────────────────
const Sparkline = ({ data, width, height = 40, color = GREEN }) => {
  const w = width || 100;
  if (!data || data.length < 2) {
    return (
      <Svg width={w} height={height}>
        <Polyline
          points={`0,${height / 2} ${w},${height / 2}`}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeOpacity={0.35}
        />
      </Svg>
    );
  }
  const minVal = Math.min(...data);
  const maxVal = Math.max(...data);
  const range  = maxVal - minVal || 1;
  const pad    = 4;
  const pts    = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = pad + ((maxVal - v) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <Svg width={w} height={height}>
      <Polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

// ─── Donut Chart ─────────────────────────────────────────────────────────────
const DonutChart = ({ data, size = 110, strokeWidth = 18, bgColor = '#2D3451' }) => {
  const radius       = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx           = size / 2;
  const cy           = size / 2;
  const total        = data.reduce((s, d) => s + (d.value || 0), 0);

  let cumPct = 0;
  const segments = data
    .map((seg) => {
      const pct = total > 0 ? (seg.value / total) * 100 : 0;
      if (pct <= 0.3) return null;
      const dashVisible = (pct / 100) * circumference;
      const dashGap     = circumference - dashVisible;
      const rotation    = cumPct * 3.6 - 90;
      cumPct += pct;
      return { color: seg.color, dashVisible, dashGap, rotation };
    })
    .filter(Boolean);

  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={radius} stroke={bgColor} strokeWidth={strokeWidth} fill="none" />
      {segments.map((seg, i) => (
        <Circle
          key={i}
          cx={cx} cy={cy} r={radius}
          stroke={seg.color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${seg.dashVisible} ${seg.dashGap}`}
          strokeDashoffset={0}
          transform={`rotate(${seg.rotation} ${cx} ${cy})`}
        />
      ))}
    </Svg>
  );
};

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const navigation          = useNavigation();
  const insets              = useSafeAreaInsets();
  const { colors, isDark }  = useTheme();
  const { width: SW }       = useWindowDimensions();

  const [assets,             setAssets]             = useState([]);
  const [profile,            setProfile]            = useState(null);
  const [loading,            setLoading]            = useState(true);
  const [refreshing,         setRefreshing]         = useState(false);
  const [netWorth,           setNetWorth]           = useState(0);
  const [monthlyChange,      setMonthlyChange]      = useState(null);
  const [selectedCategory,   setSelectedCategory]   = useState(null);
  const [lastUpdated,        setLastUpdated]        = useState(null);
  const [hidden,             setHidden]             = useState(false);
  const [sortOrder,          setSortOrder]          = useState('default');
  const [isRefreshing,       setIsRefreshing]       = useState(false);
  const [categorySnapshots,  setCategorySnapshots]  = useState({});

  const lastLoadedRef = useRef(0);

  // ── theme tokens ─────────────────────────────────────────────────────────
  const C = {
    bg:       isDark ? '#0F1117'  : colors.bg,
    card:     isDark ? '#1E2436'  : colors.card,
    border:   isDark ? '#2D3451'  : '#E5E7EB',
    text:     isDark ? '#FFFFFF'  : colors.text,
    textSub:  isDark ? '#A0AEC0'  : colors.textSub  || '#6B7280',
    textMuted:isDark ? '#6B7280'  : colors.textMuted || '#9CA3AF',
    donutBg:  isDark ? '#2D3451'  : '#E5E7EB',
  };

  const cardWidth = (SW - 16 * 2 - 10) / 2;

  // ── cache load ───────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(DASHBOARD_CACHE_KEY);
        if (cached) {
          const { assets: ca, netWorth: cnw } = JSON.parse(cached);
          setAssets(ca);
          setNetWorth(cnw);
          setLoading(false);
          setIsRefreshing(true);
        }
      } catch (e) {
        console.log('dashboard cache read error:', e);
      }
    })();
  }, []);

  const cycleSortOrder = () =>
    setSortOrder(prev => prev === 'default' ? 'desc' : prev === 'desc' ? 'asc' : 'default');

  // ── derived data ─────────────────────────────────────────────────────────
  const mergedAssets = useMemo(() => {
    const map = new Map();
    for (const asset of assets) {
      const key = asset.category === 'investment' && asset.symbol
        ? `inv:${asset.symbol}:${asset.market_type || ''}:${asset.currency || ''}:${asset.category}`
        : `${asset.category}:${asset.name}:${asset.currency || ''}`;
      if (!map.has(key)) {
        map.set(key, { ...asset, _allIds: [asset.id] });
      } else {
        const ex = map.get(key);
        ex._allIds.push(asset.id);
        ex.converted_amount += asset.converted_amount;
        ex.current_shares = (ex.current_shares || 0) + (asset.current_shares || 0);
        if (ex.pnl !== null && asset.pnl !== null) {
          ex.pnl += asset.pnl;
          ex.converted_cost = (ex.converted_cost || 0) + (asset.converted_cost || 0);
          ex.pnl_pct = ex.converted_cost > 0 ? (ex.pnl / ex.converted_cost) * 100 : null;
        } else if (asset.pnl !== null) {
          ex.pnl = asset.pnl; ex.converted_cost = asset.converted_cost; ex.pnl_pct = asset.pnl_pct;
        }
      }
    }
    return Array.from(map.values());
  }, [assets]);

  const categoryTotals = useMemo(() => {
    const totals = {};
    for (const cat of [...ASSET_CATEGORIES, 'liability']) {
      const list = mergedAssets.filter(a => a.category === cat);
      totals[cat] = { total: list.reduce((s, a) => s + a.converted_amount, 0), count: list.length };
    }
    return totals;
  }, [mergedAssets]);

  const filteredAssets = useMemo(() =>
    selectedCategory ? mergedAssets.filter(a => a.category === selectedCategory) : mergedAssets,
  [mergedAssets, selectedCategory]);

  const sortedFilteredAssets = useMemo(() => {
    if (sortOrder === 'default') return filteredAssets;
    return [...filteredAssets].sort((a, b) =>
      sortOrder === 'desc' ? b.converted_amount - a.converted_amount : a.converted_amount - b.converted_amount
    );
  }, [filteredAssets, sortOrder]);

  const donutData = useMemo(() => [
    { label: '投資資產', value: categoryTotals.investment?.total || 0, color: DONUT_COLORS.investment },
    { label: '流動資產', value: categoryTotals.liquid?.total     || 0, color: DONUT_COLORS.liquid },
    { label: '固定資產', value: categoryTotals.fixed?.total      || 0, color: DONUT_COLORS.fixed },
    { label: '其他資產', value: categoryTotals.receivable?.total || 0, color: DONUT_COLORS.receivable },
  ], [categoryTotals]);

  const totalAssets = useMemo(() =>
    ASSET_CATEGORIES.reduce((s, cat) => s + (categoryTotals[cat]?.total || 0), 0),
  [categoryTotals]);

  const monthlyChangePct = useMemo(() => {
    if (monthlyChange === null || netWorth === 0) return null;
    const prev = netWorth - monthlyChange;
    return prev === 0 ? null : (monthlyChange / Math.abs(prev)) * 100;
  }, [monthlyChange, netWorth]);

  const unrealizedPnl = useMemo(() => {
    const invAssets = mergedAssets.filter(a => a.pnl !== null);
    const gain = invAssets.filter(a => a.pnl > 0).reduce((s, a) => s + a.pnl, 0);
    const loss = invAssets.filter(a => a.pnl < 0).reduce((s, a) => s + Math.abs(a.pnl), 0);
    return { gain, loss, net: gain - loss };
  }, [mergedAssets]);

  const liquidSparkline     = categorySnapshots['liquid'] || [];
  const investmentSparkline = useMemo(() => {
    const tw     = categorySnapshots['TW']     || [];
    const us     = categorySnapshots['US']     || [];
    const crypto = categorySnapshots['Crypto'] || [];
    const maxLen = Math.max(tw.length, us.length, crypto.length);
    if (maxLen === 0) return [];
    return Array.from({ length: maxLen }, (_, i) => (tw[i] || 0) + (us[i] || 0) + (crypto[i] || 0));
  }, [categorySnapshots]);

  // ── focus effect ─────────────────────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    if (Date.now() - lastLoadedRef.current < 60000) return;
    loadData();
  }, []));

  // ── live prices ──────────────────────────────────────────────────────────
  const refreshLivePrices = async (assetsData, baseCurrency, ratesMap = null) => {
    const inv = (assetsData || []).filter(a => a.symbol && a.category === 'investment' && a.current_shares > 0);
    if (inv.length === 0) return;
    const twA = inv.filter(a => a.market_type === 'TW');
    const usA = inv.filter(a => a.market_type === 'US');
    const crA = inv.filter(a => a.market_type === 'Crypto');
    const [usPrices, crPrices, twPrices] = await Promise.all([
      fetchUSStockPriceBatch(usA.map(a => a.symbol)),
      fetchCryptoPriceBatch(crA.map(a => a.symbol)),
      fetchTWStockPriceBatch(twA.map(a => a.symbol)),
    ]);
    const priceMap  = { ...usPrices, ...crPrices, ...twPrices };

    const updates = await Promise.allSettled(
      inv.map(async (asset) => {
        const pd = priceMap[asset.symbol];
        if (!pd?.price) return null;
        const lev = asset.leverage || 1;
        const borrowed   = asset.current_shares * (asset.average_cost || 0) * (lev - 1) / lev;
        const newAmount  = pd.price * asset.current_shares - borrowed;
        await supabase.from('assets').update({ current_amount: newAmount, updated_at: new Date().toISOString() }).eq('id', asset.id);
        const ca   = await convertToBaseCurrency(newAmount, asset.currency, baseCurrency, ratesMap);
        const cost = asset.current_shares * (asset.average_cost || 0) / lev;
        const cc   = await convertToBaseCurrency(cost, asset.currency, baseCurrency, ratesMap);
        const pnl  = ca - cc;
        return { id: asset.id, current_amount: newAmount, converted_amount: ca, pnl, pnl_pct: cc > 0 ? (pnl / cc) * 100 : 0, converted_cost: cc, price_time: pd.price_time || null };
      })
    );
    const changed = updates.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
    if (changed.length === 0) return;
    const map = Object.fromEntries(changed.map(c => [c.id, c]));
    setAssets(prev => {
      const next  = prev.map(a => map[a.id] ? { ...a, ...map[a.id] } : a);
      const total = next.filter(a => a.category !== 'liability').reduce((s, a) => s + a.converted_amount, 0);
      const liab  = next.filter(a => a.category === 'liability').reduce((s, a) => s + a.converted_amount, 0);
      setNetWorth(total - liab);
      return next;
    });
  };

  // ── load data ────────────────────────────────────────────────────────────
  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setProfile(profileData);

      const { data: assetsData, error } = await supabase
        .from('assets').select('*').eq('user_id', user.id).order('category', { ascending: true });
      if (error) throw error;

      const baseCurrency     = profileData?.base_currency || 'TWD';
      const uniqueCurrencies = [...new Set(assetsData.map(a => a.currency).filter(Boolean))];
      const ratesMap         = await fetchExchangeRatesBatch(uniqueCurrencies, baseCurrency);

      const converted = await Promise.all(
        assetsData.map(async (asset) => {
          const ca = await convertToBaseCurrency(parseFloat(asset.current_amount), asset.currency, baseCurrency, ratesMap);
          let pnl = null, pnl_pct = null, converted_cost = null;
          if (asset.category === 'investment' && asset.current_shares > 0 && asset.average_cost > 0) {
            const lev = asset.leverage || 1;
            const costBasis = asset.current_shares * asset.average_cost / lev;
            converted_cost  = await convertToBaseCurrency(costBasis, asset.currency, baseCurrency, ratesMap);
            pnl     = ca - converted_cost;
            pnl_pct = converted_cost > 0 ? (pnl / converted_cost) * 100 : 0;
          }
          return { ...asset, converted_amount: ca, pnl, pnl_pct, converted_cost };
        })
      );
      setAssets(converted);
      refreshLivePrices(assetsData, baseCurrency, ratesMap);

      const assetsTotal    = converted.filter(a => a.category !== 'liability').reduce((s, a) => s + a.converted_amount, 0);
      const liabTotal      = converted.filter(a => a.category === 'liability').reduce((s, a) => s + a.converted_amount, 0);
      const currentNetWorth = assetsTotal - liabTotal;
      setNetWorth(currentNetWorth);
      setLastUpdated(new Date());

      try {
        await AsyncStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({ assets: converted, netWorth: currentNetWorth, lastUpdated: Date.now() }));
      } catch (e) { console.log('dashboard cache write error:', e); }

      // Monthly change
      const startOfMonth = new Date(); startOfMonth.setDate(1);
      const { data: monthSnap } = await supabase
        .from('daily_snapshots').select('net_worth_base')
        .eq('user_id', user.id)
        .gte('snapshot_date', startOfMonth.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: true }).limit(1).maybeSingle();
      if (monthSnap) setMonthlyChange(currentNetWorth - parseFloat(monthSnap.net_worth_base));

      await supabase.rpc('create_daily_snapshot', { p_user_id: user.id });

      // Category snapshots write
      try {
        const today = new Date().toISOString().split('T')[0];
        const getCatKey = (a) => {
          if (a.market_type === 'TW')     return 'TW';
          if (a.market_type === 'US')     return 'US';
          if (a.market_type === 'Crypto') return 'Crypto';
          if (a.category === 'liquid')    return 'liquid';
          if (a.category === 'fixed')     return 'fixed';
          if (a.category === 'receivable') return 'receivable';
          return 'other';
        };
        const totals = {};
        converted.forEach(a => { const k = getCatKey(a); totals[k] = (totals[k] || 0) + Number(a.converted_amount || 0); });
        const rows = Object.entries(totals).map(([category, value]) => ({ user_id: user.id, date: today, category, value }));
        if (rows.length > 0) await supabase.from('category_snapshots').upsert(rows, { onConflict: 'user_id,date,category' });
      } catch (e) { console.log('category snapshot write error:', e); }

      // Category snapshots read (sparklines)
      try {
        const ago = new Date(); ago.setDate(ago.getDate() - 30);
        const { data: snapData } = await supabase
          .from('category_snapshots').select('date, category, value')
          .eq('user_id', user.id).gte('date', ago.toISOString().split('T')[0])
          .order('date', { ascending: true });
        if (snapData) {
          const grouped = {};
          snapData.forEach(r => { if (!grouped[r.category]) grouped[r.category] = []; grouped[r.category].push(Number(r.value)); });
          setCategorySnapshots(grouped);
        }
      } catch (e) { console.log('category snapshots read error:', e); }

      lastLoadedRef.current = Date.now();
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setIsRefreshing(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (lastLoadedRef?.current) lastLoadedRef.current = 0;
    await loadData();
    setRefreshing(false);
  }, []);

  const currency = profile?.base_currency || 'TWD';
  const fmt  = (v) => formatAmount(v);
  const mask = (v) => hidden ? '****' : fmt(v);

  if (loading) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top, backgroundColor: C.bg }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 160 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} colors={[GREEN]} />
        }
      >

        {/* ── HERO ──────────────────────────────────────────────────────── */}
        <View style={[styles.hero]}>
          <View style={styles.heroHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.heroLabel, { color: C.textSub }]}>淨資產總覽（{currency}）</Text>
              <TouchableOpacity onPress={() => setHidden(h => !h)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                {hidden
                  ? <EyeOff size={16} color={C.textSub} />
                  : <Eye    size={16} color={C.textSub} />
                }
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => navigation.navigate('AddAsset')}
              activeOpacity={0.85}
            >
              <Plus size={20} color={PRIMARY} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.heroAmount, { color: netWorth < 0 ? RED : C.text }]}>
            {mask(netWorth)}
          </Text>

          {monthlyChange !== null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <Text style={[styles.heroChange, { color: monthlyChange >= 0 ? GREEN : RED }]}>
                {monthlyChange >= 0 ? '▲' : '▼'}{' '}
                {hidden ? '****' : fmt(Math.abs(monthlyChange))}
                {monthlyChangePct !== null
                  ? ` (${monthlyChange >= 0 ? '' : '-'}${Math.abs(monthlyChangePct).toFixed(2)}%)`
                  : ''}
              </Text>
              <Text style={[styles.heroChangeSub, { color: C.textMuted }]}>本月</Text>
            </View>
          )}
        </View>

        {/* ── ALLOCATION CARD ───────────────────────────────────────────── */}
        <View style={[styles.sectionCard, { backgroundColor: C.card, marginHorizontal: 16, marginBottom: 12 }]}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>資產配置</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ marginRight: 20 }}>
              <DonutChart data={donutData} size={112} strokeWidth={20} bgColor={C.donutBg} />
            </View>
            <View style={{ flex: 1, gap: 10 }}>
              {donutData.map((item) => {
                const pct      = totalAssets > 0 ? (item.value / totalAssets * 100).toFixed(1) : '0.0';
                const catKey   = Object.keys(CATEGORY_CONFIG).find(k => CATEGORY_CONFIG[k].label === item.label);
                const isActive = catKey && selectedCategory === catKey;
                return (
                  <TouchableOpacity
                    key={item.label}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                    onPress={() => catKey && setSelectedCategory(isActive ? null : catKey)}
                    activeOpacity={0.65}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  >
                    <View style={{
                      width: 9, height: 9, borderRadius: 5, backgroundColor: item.color,
                      ...(isActive ? { width: 12, height: 12, borderRadius: 6 } : {}),
                    }} />
                    <Text style={[styles.legendLabel, { color: isActive ? item.color : C.textSub, flex: 1, fontWeight: isActive ? '700' : '400' }]}>
                      {item.label}
                    </Text>
                    <Text style={[styles.legendPct, { color: isActive ? item.color : C.text }]}>{pct}%</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* ── 2-COL: LIQUID + INVESTMENT ────────────────────────────────── */}
        <View style={[styles.twoColRow, { marginHorizontal: 16, marginBottom: 10 }]}>

          {/* Liquid */}
          <TouchableOpacity
            style={[
              styles.sparkCard,
              { backgroundColor: C.card, width: cardWidth },
              selectedCategory === 'liquid' && { borderWidth: 1.5, borderColor: GREEN },
            ]}
            onPress={() => setSelectedCategory(selectedCategory === 'liquid' ? null : 'liquid')}
            activeOpacity={0.7}
          >
            <Text style={[styles.sparkCardLabel, { color: GREEN }]}>流動資產</Text>
            <Text style={[styles.sparkCardAmount, { color: C.text }]} numberOfLines={1}>
              {mask(categoryTotals.liquid?.total || 0)}
            </Text>
            {monthlyChange !== null ? (
              <Text style={[styles.sparkCardChange, { color: monthlyChange >= 0 ? GREEN : RED }]}>
                {monthlyChange >= 0 ? '▲' : '▼'}{' '}
                {monthlyChangePct !== null ? `${Math.abs(monthlyChangePct).toFixed(2)}%` : '--'}
              </Text>
            ) : (
              <Text style={[styles.sparkCardChange, { color: C.textMuted }]}>— --</Text>
            )}
            <View style={{ marginTop: 10, overflow: 'hidden' }}>
              <Sparkline data={liquidSparkline} width={cardWidth - 28} height={40} color={GREEN} />
            </View>
          </TouchableOpacity>

          {/* Investment */}
          <TouchableOpacity
            style={[
              styles.sparkCard,
              { backgroundColor: C.card, width: cardWidth },
              selectedCategory === 'investment' && { borderWidth: 1.5, borderColor: PRIMARY },
            ]}
            onPress={() => setSelectedCategory(selectedCategory === 'investment' ? null : 'investment')}
            activeOpacity={0.7}
          >
            <Text style={[styles.sparkCardLabel, { color: PRIMARY }]}>投資資產</Text>
            <Text style={[styles.sparkCardAmount, { color: C.text }]} numberOfLines={1}>
              {mask(categoryTotals.investment?.total || 0)}
            </Text>
            {(() => {
              const invList = mergedAssets.filter(a => a.category === 'investment' && a.pnl !== null);
              const invPnl  = invList.reduce((s, a) => s + a.pnl, 0);
              const invCost = invList.filter(a => a.converted_cost != null).reduce((s, a) => s + a.converted_cost, 0);
              const invPct  = invCost > 0 ? (invPnl / invCost * 100) : null;
              const col     = invPnl >= 0 ? GREEN : RED;
              return (
                <Text style={[styles.sparkCardChange, { color: col }]}>
                  {invPnl !== 0 ? (invPnl >= 0 ? '▲' : '▼') : '—'}{' '}
                  {invPct !== null ? `${Math.abs(invPct).toFixed(2)}%` : '--'}
                </Text>
              );
            })()}
            <View style={{ marginTop: 10, overflow: 'hidden' }}>
              <Sparkline data={investmentSparkline} width={cardWidth - 28} height={40} color={PRIMARY} />
            </View>
          </TouchableOpacity>
        </View>

        {/* ── 2-COL: FIXED + RECEIVABLE ─────────────────────────────────── */}
        <View style={[styles.twoColRow, { marginHorizontal: 16, marginBottom: 10 }]}>

          <TouchableOpacity
            style={[
              styles.simpleCard,
              { backgroundColor: C.card, width: cardWidth },
              selectedCategory === 'fixed' && { borderWidth: 1.5, borderColor: '#94a3b8' },
            ]}
            onPress={() => setSelectedCategory(selectedCategory === 'fixed' ? null : 'fixed')}
            activeOpacity={0.7}
          >
            <Text style={[styles.simpleCardLabel, { color: C.textSub }]}>固定資產</Text>
            <Text style={[styles.simpleCardAmount, { color: C.text }]} numberOfLines={1}>
              {mask(categoryTotals.fixed?.total || 0)}
            </Text>
            <Text style={[styles.simpleCardChange, { color: C.textMuted }]}>— 0%</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.simpleCard,
              { backgroundColor: C.card, width: cardWidth },
              selectedCategory === 'receivable' && { borderWidth: 1.5, borderColor: '#0d9488' },
            ]}
            onPress={() => setSelectedCategory(selectedCategory === 'receivable' ? null : 'receivable')}
            activeOpacity={0.7}
          >
            <Text style={[styles.simpleCardLabel, { color: C.textSub }]}>應收款項</Text>
            <Text style={[styles.simpleCardAmount, { color: C.text }]} numberOfLines={1}>
              {mask(categoryTotals.receivable?.total || 0)}
            </Text>
            <Text style={[styles.simpleCardChange, { color: C.textMuted }]}>— 0%</Text>
          </TouchableOpacity>
        </View>

        {/* ── LIABILITY ─────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.liabilityCard, { backgroundColor: C.card, marginHorizontal: 16, marginBottom: 10 }]}
          onPress={() => setSelectedCategory(selectedCategory === 'liability' ? null : 'liability')}
          activeOpacity={0.75}
        >
          <View style={[styles.liabIconCircle, { backgroundColor: isDark ? 'rgba(240,48,48,0.15)' : '#fee2e2' }]}>
            <CreditCard size={20} color={RED} />
          </View>
          <Text style={[styles.liabLabel, { color: C.text }]}>負債總額</Text>
          <View style={{ flex: 1 }} />
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.liabAmount, { color: (categoryTotals.liability?.total || 0) > 0 ? RED : C.textSub }]}>
              {mask(categoryTotals.liability?.total || 0)}
            </Text>
            <Text style={[styles.liabChange, { color: RED }]}>▼ 0%</Text>
          </View>
        </TouchableOpacity>

        {/* ── UNREALIZED PNL ────────────────────────────────────────────── */}
        <View style={[styles.sectionCard, { backgroundColor: C.card, marginHorizontal: 16, marginBottom: 14 }]}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>未實現損益</Text>

          <View style={styles.perfRow}>
            <Text style={[styles.perfLabel, { color: C.textSub }]}>投資獲利</Text>
            <Text style={[styles.perfValue, { color: GREEN }]}>
              {hidden ? '****' : `+${fmt(unrealizedPnl.gain)}`}
            </Text>
          </View>
          <View style={[styles.perfDivider, { backgroundColor: C.border }]} />

          <View style={styles.perfRow}>
            <Text style={[styles.perfLabel, { color: C.textSub }]}>投資虧損</Text>
            <Text style={[styles.perfValue, { color: unrealizedPnl.loss > 0 ? RED : C.textSub }]}>
              {hidden ? '****' : `-${fmt(unrealizedPnl.loss)}`}
            </Text>
          </View>
          <View style={[styles.perfDivider, { backgroundColor: C.border }]} />

          <View style={styles.perfRow}>
            <Text style={[styles.perfLabel, { color: C.textSub }]}>淨損益</Text>
            <Text style={[styles.perfValue, { color: unrealizedPnl.net >= 0 ? GREEN : RED }]}>
              {hidden ? '****' : `${unrealizedPnl.net >= 0 ? '+' : ''}${fmt(unrealizedPnl.net)}`}
            </Text>
          </View>
        </View>

        {/* ── FILTER BAR ────────────────────────────────────────────────── */}
        <View style={[styles.filterBar, { backgroundColor: C.card }]}>
          {selectedCategory ? (
            <>
              <Text style={[styles.filterText, { color: C.textSub }]}>
                篩選：{CATEGORY_CONFIG[selectedCategory]?.label}
              </Text>
              <TouchableOpacity onPress={() => setSelectedCategory(null)} style={styles.clearBtn}>
                <Text style={[styles.clearText, { color: PRIMARY }]}>清除</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <View style={{ flex: 1 }} />
          <RefreshCw size={12} color={C.textMuted} />
          <Text style={[styles.filterCount, { color: C.textMuted }]}> {sortedFilteredAssets.length} 項</Text>
          <TouchableOpacity onPress={cycleSortOrder} style={styles.sortBtn} activeOpacity={0.7}>
            <Text style={[styles.sortText, { color: sortOrder !== 'default' ? PRIMARY : C.textMuted }]}>
              {sortOrder === 'default' ? '排序' : sortOrder === 'desc' ? '金額↓' : '金額↑'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* update time */}
        <View style={styles.updateRow}>
          {lastUpdated && (
            <Text style={[styles.updateTime, { color: C.textMuted }]}>
              報價更新：{lastUpdated.toLocaleTimeString('zh-TW')}
            </Text>
          )}
          {isRefreshing && (
            <>
              <ActivityIndicator size="small" color={PRIMARY} />
              <Text style={[styles.refreshingText, { color: C.textMuted }]}>更新中</Text>
            </>
          )}
        </View>

        {/* ── ASSET LIST ────────────────────────────────────────────────── */}
        {sortedFilteredAssets.length > 0 ? (
          (() => {
            const renderAssetRows = (list) => list.map((asset, idx) => (
              <TouchableOpacity
                key={asset.id}
                style={[
                  styles.assetRow,
                  { borderBottomColor: C.border },
                  idx === list.length - 1 && { borderBottomWidth: 0 },
                ]}
                onPress={() => navigation.navigate('AssetDetail', { assetId: asset.id, allIds: asset._allIds || [asset.id] })}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.assetName, { color: C.text }]}>{asset.name}</Text>
                  <Text style={[styles.assetMeta, { color: C.textMuted }]}>{asset.currency}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {asset.leverage > 1 && (
                      <Text style={{
                        fontSize: 11, color: '#f59e0b', fontWeight: '700',
                        backgroundColor: isDark ? '#78350f33' : '#fef3c7',
                        paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
                      }}>
                        {asset.leverage}x
                      </Text>
                    )}
                    <Text style={[styles.assetAmount, { color: C.text }]}>{mask(asset.converted_amount)}</Text>
                  </View>
                  {asset.pnl !== null && (
                    <Text style={{ fontSize: 11, fontWeight: '600', color: asset.pnl >= 0 ? GREEN : RED }}>
                      {hidden ? '****' : asset.pnl_pct !== null
                        ? `${asset.pnl >= 0 ? '+' : ''}${fmt(asset.pnl)}  (${asset.pnl >= 0 ? '+' : ''}${asset.pnl_pct.toFixed(1)}%)`
                        : `${asset.pnl >= 0 ? '+' : ''}${fmt(asset.pnl)}`}
                    </Text>
                  )}
                  {asset.current_shares > 0 && (
                    <Text style={[styles.assetShares, { color: C.textMuted }]}>
                      {asset.current_shares.toLocaleString()} 股
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            ));

            const renderGroup = (key, label, color, list) => {
              const total = list.reduce((s, a) => s + a.converted_amount, 0);
              return (
                <View key={key} style={{ marginBottom: 8 }}>
                  <View style={[styles.groupHeader, { backgroundColor: C.card }]}>
                    <View style={[styles.groupDot, { backgroundColor: color }]} />
                    <Text style={[styles.groupLabel, { color }]}>{label}</Text>
                    <Text style={[styles.groupTotal, { color: C.textSub }]}>{mask(total)}</Text>
                  </View>
                  <View style={[styles.assetList, { backgroundColor: C.card }]}>
                    {renderAssetRows(list)}
                  </View>
                </View>
              );
            };

            if (!selectedCategory) {
              const CAT_ORDER = ['liquid', 'investment', 'fixed', 'receivable', 'liability'];
              const groups    = {};
              sortedFilteredAssets.forEach(a => {
                if (!groups[a.category]) groups[a.category] = [];
                groups[a.category].push(a);
              });
              return CAT_ORDER.filter(c => groups[c]).map(cat => {
                const cfg = CATEGORY_CONFIG[cat];
                return renderGroup(cat, cfg.label, cfg.color, groups[cat]);
              });
            }

            if (selectedCategory === 'investment') {
              const MT_ORDER = ['TW', 'US', 'Crypto', 'other'];
              const groups   = {};
              sortedFilteredAssets.forEach(a => {
                const mt = a.market_type || 'other';
                if (!groups[mt]) groups[mt] = [];
                groups[mt].push(a);
              });
              return MT_ORDER.filter(mt => groups[mt]).map(mt => {
                const cfg = MARKET_TYPE_CONFIG[mt];
                return renderGroup(mt, cfg.label, cfg.color, groups[mt]);
              });
            }

            return (
              <View style={[styles.assetList, { backgroundColor: C.card }]}>
                {renderAssetRows(sortedFilteredAssets)}
              </View>
            );
          })()
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: C.textSub }]}>尚無資產</Text>
            <Text style={[styles.emptySub, { color: C.textMuted }]}>點擊右上角 + 新增您的資產</Text>
          </View>
        )}

      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  loading:   { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Hero
  hero: { paddingHorizontal: 20, paddingBottom: 24, marginBottom: 4 },
  heroHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  heroLabel:  { fontSize: 13, fontWeight: '500' },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 4,
  },
  heroAmount:    { fontSize: 44, fontWeight: 'bold', letterSpacing: -1 },
  heroChange:    { fontSize: 15, fontWeight: '600' },
  heroChangeSub: { fontSize: 13 },

  // Section card (allocation, monthly perf)
  sectionCard: {
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 14 },

  // Donut legend
  legendLabel: { fontSize: 13 },
  legendPct:   { fontSize: 13, fontWeight: '700' },

  // Two-column row
  twoColRow: { flexDirection: 'row', justifyContent: 'space-between' },

  // Sparkline card
  sparkCard: {
    borderRadius: 16, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  sparkCardLabel:  { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  sparkCardAmount: { fontSize: 17, fontWeight: '700', marginBottom: 3 },
  sparkCardChange: { fontSize: 12, fontWeight: '500' },

  // Simple card (fixed, receivable)
  simpleCard: {
    borderRadius: 16, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  simpleCardLabel:  { fontSize: 12, marginBottom: 4 },
  simpleCardAmount: { fontSize: 17, fontWeight: '700', marginBottom: 3 },
  simpleCardChange: { fontSize: 12 },

  // Liability row
  liabilityCard: {
    borderRadius: 16, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  liabIconCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  liabLabel:  { fontSize: 15, fontWeight: '600' },
  liabAmount: { fontSize: 17, fontWeight: '700' },
  liabChange: { fontSize: 12, fontWeight: '500' },

  // Monthly performance
  perfRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  perfLabel:   { fontSize: 14 },
  perfValue:   { fontSize: 15, fontWeight: '700' },
  perfDivider: { height: StyleSheet.hairlineWidth },

  // Filter bar
  filterBar: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 4, marginBottom: 4,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, gap: 6,
  },
  filterText:   { fontSize: 13 },
  clearBtn:     { paddingHorizontal: 4 },
  clearText:    { fontSize: 13, fontWeight: '600' },
  filterCount:  { fontSize: 12 },
  sortBtn:      { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginLeft: 4 },
  sortText:     { fontSize: 12, fontWeight: '600' },

  // Update time
  updateRow:       { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 6, marginBottom: 4, gap: 6 },
  updateTime:      { fontSize: 11 },
  refreshingText:  { fontSize: 11 },

  // Asset list
  groupHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 8, marginBottom: 4,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, gap: 6,
  },
  groupDot:   { width: 8, height: 8, borderRadius: 4 },
  groupLabel: { fontSize: 13, fontWeight: '700', flex: 1 },
  groupTotal: { fontSize: 13, fontWeight: '500' },

  assetList: {
    marginHorizontal: 16, borderRadius: 12, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  assetRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  assetName:   { fontSize: 15, fontWeight: '500', marginBottom: 2 },
  assetMeta:   { fontSize: 12 },
  assetAmount: { fontSize: 16, fontWeight: '600' },
  assetShares: { fontSize: 12, marginTop: 2 },

  empty:     { alignItems: 'center', padding: 48 },
  emptyText: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptySub:  { fontSize: 13 },
});
