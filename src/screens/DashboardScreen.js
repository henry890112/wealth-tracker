import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wallet, TrendingUp, Home, DollarSign, CreditCard, Plus, RefreshCw, Eye, EyeOff } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { convertToBaseCurrency, fetchTWStockPrice, fetchUSStockPrice, fetchCryptoPrice } from '../services/api';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../lib/ThemeContext';

const PRIMARY = '#16a34a';

const CATEGORY_CONFIG = {
  liquid:     { label: '流動資產', Icon: Wallet,      color: '#16a34a', bg: '#dcfce7', bgDark: '#14532d33' },
  investment: { label: '投資資產', Icon: TrendingUp,  color: '#f59e0b', bg: '#fef3c7', bgDark: '#78350f33' },
  fixed:      { label: '固定資產', Icon: Home,        color: '#94a3b8', bg: '#f1f5f9', bgDark: '#33415533' },
  receivable: { label: '應收款項', Icon: DollarSign,  color: '#0d9488', bg: '#ccfbf1', bgDark: '#13403c33' },
  liability:  { label: '負債',     Icon: CreditCard,  color: '#ef4444', bg: '#fee2e2', bgDark: '#7f1d1d33' },
};

const ASSET_CATEGORIES = ['liquid', 'investment', 'fixed', 'receivable'];

const MARKET_TYPE_CONFIG = {
  TW:     { label: '台股', color: '#e11d48' },
  US:     { label: '美股', color: '#2563eb' },
  Crypto: { label: '虛幣', color: '#f59e0b' },
  other:  { label: '其他', color: '#94a3b8' },
};

const formatAmount = (amount) => {
  return Math.round(amount).toLocaleString('zh-TW');
};

export default function DashboardScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const iconBg = (cfg) => isDark ? cfg.bgDark : cfg.bg;
  const [assets, setAssets] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [netWorth, setNetWorth] = useState(0);
  const [monthlyChange, setMonthlyChange] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [sortOrder, setSortOrder] = useState('default'); // 'default' | 'desc' | 'asc'

  const cycleSortOrder = () => {
    setSortOrder(prev => prev === 'default' ? 'desc' : prev === 'desc' ? 'asc' : 'default');
  };

  // Merge assets with the same symbol (investments) or name (others) within the same category
  const mergedAssets = useMemo(() => {
    const map = new Map();
    for (const asset of assets) {
      const key = asset.category === 'investment' && asset.symbol
        ? `inv:${asset.symbol}:${asset.market_type || ''}:${asset.currency || ''}:${asset.category}`
        : `${asset.category}:${asset.name}:${asset.currency || ''}`;

      if (!map.has(key)) {
        map.set(key, { ...asset, _allIds: [asset.id] });
      } else {
        const existing = map.get(key);
        existing._allIds.push(asset.id);
        existing.converted_amount += asset.converted_amount;
        existing.current_shares = (existing.current_shares || 0) + (asset.current_shares || 0);
        if (existing.pnl !== null && asset.pnl !== null) {
          existing.pnl += asset.pnl;
          existing.converted_cost = (existing.converted_cost || 0) + (asset.converted_cost || 0);
          existing.pnl_pct = existing.converted_cost > 0 ? (existing.pnl / existing.converted_cost) * 100 : null;
        } else if (asset.pnl !== null) {
          existing.pnl = asset.pnl;
          existing.converted_cost = asset.converted_cost;
          existing.pnl_pct = asset.pnl_pct;
        }
      }
    }
    return Array.from(map.values());
  }, [assets]);

  const categoryTotals = useMemo(() => {
    const totals = {};
    for (const cat of [...ASSET_CATEGORIES, 'liability']) {
      const catAssets = mergedAssets.filter(a => a.category === cat);
      totals[cat] = {
        total: catAssets.reduce((sum, a) => sum + a.converted_amount, 0),
        count: catAssets.length,
      };
    }
    return totals;
  }, [mergedAssets]);

  const filteredAssets = useMemo(() => {
    if (!selectedCategory) return mergedAssets;
    return mergedAssets.filter(a => a.category === selectedCategory);
  }, [mergedAssets, selectedCategory]);

  const sortedFilteredAssets = useMemo(() => {
    if (sortOrder === 'default') return filteredAssets;
    return [...filteredAssets].sort((a, b) =>
      sortOrder === 'desc'
        ? b.converted_amount - a.converted_amount
        : a.converted_amount - b.converted_amount
    );
  }, [filteredAssets, sortOrder]);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  const refreshLivePrices = async (assetsData, baseCurrency) => {
    const investmentAssets = (assetsData || []).filter(
      a => a.symbol && a.category === 'investment' && a.current_shares > 0
    );
    if (investmentAssets.length === 0) return;

    const updates = await Promise.allSettled(
      investmentAssets.map(async (asset) => {
        let priceData = null;
        if (asset.market_type === 'TW') priceData = await fetchTWStockPrice(asset.symbol);
        else if (asset.market_type === 'US') priceData = await fetchUSStockPrice(asset.symbol);
        else if (asset.market_type === 'Crypto') priceData = await fetchCryptoPrice(asset.symbol);
        if (!priceData?.price) return null;

        const lev = asset.leverage || 1;
        const borrowed = asset.current_shares * (asset.average_cost || 0) * (lev - 1) / lev;
        const newAmount = priceData.price * asset.current_shares - borrowed;

        await supabase.from('assets')
          .update({ current_amount: newAmount, updated_at: new Date().toISOString() })
          .eq('id', asset.id);

        const convertedAmount = await convertToBaseCurrency(newAmount, asset.currency, baseCurrency);
        const costBasis = asset.current_shares * (asset.average_cost || 0) / lev;
        const convertedCost = await convertToBaseCurrency(costBasis, asset.currency, baseCurrency);
        const pnl = convertedAmount - convertedCost;
        const pnl_pct = convertedCost > 0 ? (pnl / convertedCost) * 100 : 0;
        return { id: asset.id, current_amount: newAmount, converted_amount: convertedAmount, pnl, pnl_pct, converted_cost: convertedCost };
      })
    );

    const changed = updates
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    if (changed.length === 0) return;

    const map = Object.fromEntries(changed.map(c => [c.id, c]));
    setAssets(prev => {
      const next = prev.map(a => map[a.id] ? { ...a, ...map[a.id] } : a);
      const total = next.filter(a => a.category !== 'liability').reduce((s, a) => s + a.converted_amount, 0);
      const liab  = next.filter(a => a.category === 'liability').reduce((s, a) => s + a.converted_amount, 0);
      setNetWorth(total - liab);
      return next;
    });
  };

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();
      setProfile(profileData);

      const { data: assetsData, error } = await supabase
        .from('assets').select('*').eq('user_id', user.id)
        .order('category', { ascending: true });
      if (error) throw error;

      const baseCurrency = profileData?.base_currency || 'TWD';
      const converted = await Promise.all(
        assetsData.map(async (asset) => {
          const convertedAmount = await convertToBaseCurrency(
            parseFloat(asset.current_amount), asset.currency, baseCurrency
          );
          let pnl = null;
          let pnl_pct = null;
          let converted_cost = null;
          if (asset.category === 'investment' && asset.current_shares > 0 && asset.average_cost > 0) {
            const lev = asset.leverage || 1;
            const costBasis = asset.current_shares * asset.average_cost / lev;
            converted_cost = await convertToBaseCurrency(costBasis, asset.currency, baseCurrency);
            pnl = convertedAmount - converted_cost;
            pnl_pct = converted_cost > 0 ? (pnl / converted_cost) * 100 : 0;
          }
          return { ...asset, converted_amount: convertedAmount, pnl, pnl_pct, converted_cost };
        })
      );
      setAssets(converted);

      // Background: fetch live prices for investment assets with symbols
      refreshLivePrices(assetsData, profileData?.base_currency || 'TWD');

      const assetsTotal = converted
        .filter(a => a.category !== 'liability')
        .reduce((sum, a) => sum + a.converted_amount, 0);
      const liabTotal = converted
        .filter(a => a.category === 'liability')
        .reduce((sum, a) => sum + a.converted_amount, 0);
      const currentNetWorth = assetsTotal - liabTotal;
      setNetWorth(currentNetWorth);
      setLastUpdated(new Date());

      // Monthly change: compare to first snapshot of this month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      const { data: monthSnap } = await supabase
        .from('daily_snapshots').select('net_worth_base')
        .eq('user_id', user.id)
        .gte('snapshot_date', startOfMonth.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (monthSnap) {
        setMonthlyChange(currentNetWorth - parseFloat(monthSnap.net_worth_base));
      }

      await supabase.rpc('create_daily_snapshot', { p_user_id: user.id });

      // 同步存分類快照
      try {
        const today = new Date().toISOString().split('T')[0];
        const getCategoryKey = (a) => {
          const mt = a.market_type || '';
          const cat = a.category || '';
          if (mt === 'TW' || cat === '台股') return 'TW';
          if (mt === 'US' || cat === '美股') return 'US';
          if (mt === 'Crypto' || cat === '虛幣') return 'Crypto';
          if (cat === '外幣' || mt === 'liquid') return 'liquid';
          return 'other';
        };
        const totals = {};
        (converted || []).forEach(a => {
          const key = getCategoryKey(a);
          totals[key] = (totals[key] || 0) + Number(a.converted_amount || 0);
        });
        const rows = Object.entries(totals).map(([category, value]) => ({
          user_id: user.id,
          date: today,
          category,
          value,
        }));
        if (rows.length > 0) {
          await supabase.from('category_snapshots').upsert(rows, { onConflict: 'user_id,date,category' });
        }
      } catch (e) {
        console.log('category snapshot error:', e);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, []);

  const currency = profile?.base_currency || 'TWD';
  const fmt = (v) => formatAmount(v);
  const mask = (v) => hidden ? '****' : fmt(v);

  if (loading) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top, backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 160 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />
        }
      >
        {/* Hero */}
        <View style={[styles.hero, { backgroundColor: colors.card }]}>
          <View style={styles.heroHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.heroLabel, { color: colors.textMuted }]}>淨資產總覽（{currency}）</Text>
              <TouchableOpacity onPress={() => setHidden(h => !h)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                {hidden
                  ? <EyeOff size={16} color={colors.textMuted} />
                  : <Eye size={16} color={colors.textMuted} />
                }
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => navigation.navigate('AddAsset')}
              activeOpacity={0.85}
            >
              <Plus size={20} color="white" />
            </TouchableOpacity>
          </View>
          <Text style={[styles.heroAmount, netWorth < 0 && { color: '#ef4444' }]}>
            {mask(netWorth)}
          </Text>
          {monthlyChange !== null && (
            <Text style={[styles.heroChange, monthlyChange >= 0 ? styles.posText : styles.negText]}>
              {monthlyChange >= 0 ? '▲' : '▼'} {hidden ? '****' : fmt(Math.abs(monthlyChange))} 本月
            </Text>
          )}
        </View>

        {/* Category cards 2x2 */}
        <View style={styles.gridWrap}>
          <View style={styles.grid}>
            {ASSET_CATEGORIES.map(cat => {
              const cfg = CATEGORY_CONFIG[cat];
              const Icon = cfg.Icon;
              const d = categoryTotals[cat] || { total: 0, count: 0 };
              const sel = selectedCategory === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.card, { backgroundColor: colors.card }, sel && styles.cardSel]}
                  onPress={() => setSelectedCategory(sel ? null : cat)}
                  activeOpacity={0.75}
                >
                  {/* Icon + count on same row */}
                  <View style={styles.cardTopRow}>
                    <View style={[styles.iconCircle, { backgroundColor: iconBg(cfg) }]}>
                      <Icon size={20} color={cfg.color} />
                    </View>
                    <Text style={[styles.cardCount, { color: colors.textMuted }]}>{d.count} 項</Text>
                  </View>
                  <Text style={[styles.cardLabel, { color: colors.textMuted }]}>{cfg.label}</Text>
                  <Text style={[styles.cardAmount, { color: colors.text }]} numberOfLines={1}>{mask(d.total)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Liability full-width */}
          {(() => {
            const cat = 'liability';
            const cfg = CATEGORY_CONFIG[cat];
            const Icon = cfg.Icon;
            const d = categoryTotals[cat] || { total: 0, count: 0 };
            const sel = selectedCategory === cat;
            return (
              <TouchableOpacity
                style={[styles.liabCard, { backgroundColor: colors.card }, sel && styles.cardSel]}
                onPress={() => setSelectedCategory(sel ? null : cat)}
                activeOpacity={0.75}
              >
                <View style={[styles.iconCircle, { backgroundColor: iconBg(cfg), marginRight: 12 }]}>
                  <Icon size={22} color={cfg.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardLabel, { color: colors.textMuted }]}>{cfg.label}</Text>
                  <Text style={[styles.cardCount, { color: colors.textMuted }]}>{d.count} 項</Text>
                </View>
                <Text style={[styles.cardAmount, { color: d.total > 0 ? '#ef4444' : colors.textMuted }]}>{mask(d.total)}</Text>
              </TouchableOpacity>
            );
          })()}
        </View>

        {/* Filter bar */}
        <View style={[styles.filterBar, { backgroundColor: colors.card }]}>
          {selectedCategory ? (
            <>
              <Text style={[styles.filterText, { color: colors.textSub }]}>篩選中</Text>
              <TouchableOpacity onPress={() => setSelectedCategory(null)} style={styles.clearBtn}>
                <Text style={styles.clearText}>清除</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <View style={{ flex: 1 }} />
          <RefreshCw size={12} color={colors.textMuted} />
          <Text style={[styles.filterCount, { color: colors.textMuted }]}> {sortedFilteredAssets.length} 項</Text>
          <TouchableOpacity onPress={cycleSortOrder} style={styles.sortBtn} activeOpacity={0.7}>
            <Text style={[styles.sortText, { color: sortOrder !== 'default' ? PRIMARY : colors.textMuted }]}>
              {sortOrder === 'default' ? '排序' : sortOrder === 'desc' ? '金額↓' : '金額↑'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Price update time */}
        {lastUpdated && (
          <Text style={[styles.updateTime, { color: colors.textMuted }]}>
            報價更新：{lastUpdated.toLocaleTimeString('zh-TW')}
          </Text>
        )}

        {/* Asset list */}
        {sortedFilteredAssets.length > 0 ? (
          (() => {
            const renderAssetRows = (list) => list.map((asset, idx) => (
              <TouchableOpacity
                key={asset.id}
                style={[styles.assetRow, { borderBottomColor: colors.borderLight }, idx === list.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => navigation.navigate('AssetDetail', { assetId: asset.id, allIds: asset._allIds || [asset.id] })}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.assetName, { color: colors.text }]}>{asset.name}</Text>
                  <Text style={[styles.assetMeta, { color: colors.textMuted }]}>{asset.currency}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {asset.leverage > 1 && (
                      <Text style={{ fontSize: 11, color: '#f59e0b', fontWeight: '700', backgroundColor: '#fef3c7', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                        {asset.leverage}x
                      </Text>
                    )}
                    <Text style={[styles.assetAmount, { color: colors.text }]}>{mask(asset.converted_amount)}</Text>
                  </View>
                  {asset.pnl !== null && (
                    <Text style={{ fontSize: 11, fontWeight: '600', color: asset.pnl >= 0 ? '#16a34a' : '#ef4444' }}>
                      {hidden ? '****' : asset.pnl_pct !== null
                        ? `${asset.pnl >= 0 ? '+' : ''}${fmt(asset.pnl)}  (${asset.pnl >= 0 ? '+' : ''}${asset.pnl_pct.toFixed(1)}%)`
                        : `${asset.pnl >= 0 ? '+' : ''}${fmt(asset.pnl)}`}
                    </Text>
                  )}
                  {asset.current_shares > 0 && (
                    <Text style={[styles.assetShares, { color: colors.textMuted }]}>{asset.current_shares.toLocaleString()} 股</Text>
                  )}
                </View>
              </TouchableOpacity>
            ));

            const renderGroup = (key, label, color, list) => {
              const total = list.reduce((s, a) => s + a.converted_amount, 0);
              return (
                <View key={key} style={{ marginBottom: 8 }}>
                  <View style={[styles.groupHeader, { backgroundColor: colors.card }]}>
                    <View style={[styles.groupDot, { backgroundColor: color }]} />
                    <Text style={[styles.groupLabel, { color }]}>{label}</Text>
                    <Text style={[styles.groupTotal, { color: colors.textSub }]}>{mask(total)}</Text>
                  </View>
                  <View style={[styles.assetList, { backgroundColor: colors.card }]}>
                    {renderAssetRows(list)}
                  </View>
                </View>
              );
            };

            // No filter: group by category
            if (!selectedCategory) {
              const CAT_ORDER = ['liquid', 'investment', 'fixed', 'receivable', 'liability'];
              const groups = {};
              sortedFilteredAssets.forEach(a => {
                if (!groups[a.category]) groups[a.category] = [];
                groups[a.category].push(a);
              });
              return CAT_ORDER.filter(c => groups[c]).map(cat => {
                const cfg = CATEGORY_CONFIG[cat];
                return renderGroup(cat, cfg.label, cfg.color, groups[cat]);
              });
            }

            // Investment selected: group by market_type
            if (selectedCategory === 'investment') {
              const MT_ORDER = ['TW', 'US', 'Crypto', 'other'];
              const groups = {};
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

            // Other single category: flat list
            return (
              <View style={[styles.assetList, { backgroundColor: colors.card }]}>
                {renderAssetRows(sortedFilteredAssets)}
              </View>
            );
          })()
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: colors.textSub }]}>尚無資產</Text>
            <Text style={[styles.emptySub, { color: colors.textMuted }]}>點擊下方 + 新增您的資產</Text>
          </View>
        )}
      </ScrollView>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  hero: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 20,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  heroHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  heroLabel: { fontSize: 13 },
  addBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: PRIMARY,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 6, elevation: 4,
  },
  heroAmount: { fontSize: 34, fontWeight: 'bold', color: PRIMARY, marginBottom: 6 },
  heroChange: { fontSize: 14, fontWeight: '500' },
  posText: { color: PRIMARY },
  negText: { color: '#ef4444' },

  gridWrap: { marginHorizontal: 16, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginBottom: 10 },
  card: {
    width: '48.5%',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardSel: { borderColor: PRIMARY },
  liabCard: {
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardTopRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10,
  },
  iconCircle: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  cardLabel: { fontSize: 11, marginBottom: 4 },
  cardAmount: { fontSize: 18, fontWeight: '700' },
  cardCount: { fontSize: 11 },

  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  filterText: { fontSize: 13 },
  clearBtn: { paddingHorizontal: 4 },
  clearText: { fontSize: 13, color: PRIMARY, fontWeight: '600' },
  filterCount: { fontSize: 12 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginLeft: 4 },
  sortText: { fontSize: 12, fontWeight: '600' },

  updateTime: {
    fontSize: 11,
    marginHorizontal: 20, marginTop: 10, marginBottom: 4,
  },

  groupHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 8, marginBottom: 4,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10, gap: 6,
  },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupLabel: { fontSize: 13, fontWeight: '700', flex: 1 },
  groupTotal: { fontSize: 13, fontWeight: '500' },

  assetList: {
    marginHorizontal: 16, marginTop: 0,
    borderRadius: 12, overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  assetRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1,
  },
  assetName: { fontSize: 15, fontWeight: '500', marginBottom: 2 },
  assetMeta: { fontSize: 12 },
  assetAmount: { fontSize: 16, fontWeight: '600' },
  assetShares: { fontSize: 12, marginTop: 2 },

  empty: { alignItems: 'center', padding: 48 },
  emptyText: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptySub: { fontSize: 13 },

});
