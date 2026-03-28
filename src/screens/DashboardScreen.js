import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wallet, TrendingUp, Home, DollarSign, CreditCard, Plus, RefreshCw } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { convertToBaseCurrency } from '../services/api';
import { useNavigation } from '@react-navigation/native';

const PRIMARY = '#16a34a';

const CATEGORY_CONFIG = {
  liquid:     { label: '流動資產', Icon: Wallet,      color: '#16a34a', bg: '#dcfce7' },
  investment: { label: '投資資產', Icon: TrendingUp,  color: '#f59e0b', bg: '#fef3c7' },
  fixed:      { label: '固定資產', Icon: Home,        color: '#94a3b8', bg: '#f1f5f9' },
  receivable: { label: '應收款項', Icon: DollarSign,  color: '#0d9488', bg: '#ccfbf1' },
  liability:  { label: '負債',     Icon: CreditCard,  color: '#ef4444', bg: '#fee2e2' },
};

const ASSET_CATEGORIES = ['liquid', 'investment', 'fixed', 'receivable'];

const formatAmount = (amount, currency = 'TWD') => {
  const prefix = currency === 'TWD' ? 'NT$' : currency;
  const abs = Math.abs(amount);
  if (abs >= 10000) {
    return `${prefix} ${(amount / 10000).toFixed(1)}萬`;
  }
  return `${prefix} ${Math.round(amount).toLocaleString('zh-TW')}`;
};

export default function DashboardScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [assets, setAssets] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [netWorth, setNetWorth] = useState(0);
  const [monthlyChange, setMonthlyChange] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const categoryTotals = useMemo(() => {
    const totals = {};
    for (const cat of [...ASSET_CATEGORIES, 'liability']) {
      const catAssets = assets.filter(a => a.category === cat);
      totals[cat] = {
        total: catAssets.reduce((sum, a) => sum + a.converted_amount, 0),
        count: catAssets.length,
      };
    }
    return totals;
  }, [assets]);

  const filteredAssets = useMemo(() => {
    if (!selectedCategory) return assets;
    return assets.filter(a => a.category === selectedCategory);
  }, [assets, selectedCategory]);

  useEffect(() => {
    loadData();
  }, []);

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
          return { ...asset, converted_amount: convertedAmount };
        })
      );
      setAssets(converted);

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
  const fmt = (v) => formatAmount(v, currency);

  if (loading) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />
        }
      >
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>淨資產總覽</Text>
          <Text style={[styles.heroAmount, netWorth < 0 && { color: '#ef4444' }]}>
            {fmt(netWorth)}
          </Text>
          {monthlyChange !== null && (
            <Text style={[styles.heroChange, monthlyChange >= 0 ? styles.posText : styles.negText]}>
              {monthlyChange >= 0 ? '▲' : '▼'} {fmt(Math.abs(monthlyChange))} 本月
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
                  style={[styles.card, sel && styles.cardSel]}
                  onPress={() => setSelectedCategory(sel ? null : cat)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.iconCircle, { backgroundColor: cfg.bg }]}>
                    <Icon size={22} color={cfg.color} />
                  </View>
                  <Text style={styles.cardLabel}>{cfg.label}</Text>
                  <Text style={styles.cardAmount} numberOfLines={1}>{fmt(d.total)}</Text>
                  <Text style={styles.cardCount}>{d.count} 項</Text>
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
                style={[styles.liabCard, sel && styles.cardSel]}
                onPress={() => setSelectedCategory(sel ? null : cat)}
                activeOpacity={0.75}
              >
                <View style={[styles.iconCircle, { backgroundColor: cfg.bg, marginBottom: 0, marginRight: 12 }]}>
                  <Icon size={22} color={cfg.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardLabel}>{cfg.label}</Text>
                  <Text style={styles.cardCount}>{d.count} 項</Text>
                </View>
                <Text style={[styles.cardAmount, { color: '#ef4444' }]}>{fmt(d.total)}</Text>
              </TouchableOpacity>
            );
          })()}
        </View>

        {/* Filter bar */}
        {selectedCategory && (
          <View style={styles.filterBar}>
            <Text style={styles.filterText}>篩選中</Text>
            <TouchableOpacity onPress={() => setSelectedCategory(null)} style={styles.clearBtn}>
              <Text style={styles.clearText}>清除</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <RefreshCw size={12} color="#94a3b8" />
            <Text style={styles.filterCount}> {filteredAssets.length} 項</Text>
          </View>
        )}

        {/* Price update time */}
        {lastUpdated && (
          <Text style={styles.updateTime}>
            報價更新：{lastUpdated.toLocaleTimeString('zh-TW')}
          </Text>
        )}

        {/* Asset list */}
        {filteredAssets.length > 0 ? (
          <View style={styles.assetList}>
            {filteredAssets.map((asset, idx) => (
              <TouchableOpacity
                key={asset.id}
                style={[
                  styles.assetRow,
                  idx === filteredAssets.length - 1 && { borderBottomWidth: 0 },
                ]}
                onPress={() => navigation.navigate('AssetDetail', { assetId: asset.id })}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.assetName}>{asset.name}</Text>
                  <Text style={styles.assetMeta}>
                    {CATEGORY_CONFIG[asset.category]?.label} · {asset.currency}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.assetAmount}>{fmt(asset.converted_amount)}</Text>
                  {asset.current_shares > 0 && (
                    <Text style={styles.assetShares}>
                      {asset.current_shares.toLocaleString()} 股
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>尚無資產</Text>
            <Text style={styles.emptySub}>點擊下方 + 新增您的資產</Text>
          </View>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => navigation.navigate('AddAsset')}
        activeOpacity={0.85}
      >
        <Plus size={28} color="white" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9' },

  hero: {
    backgroundColor: 'white',
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
  heroLabel: { fontSize: 13, color: '#94a3b8', marginBottom: 8 },
  heroAmount: { fontSize: 34, fontWeight: 'bold', color: PRIMARY, marginBottom: 6 },
  heroChange: { fontSize: 14, fontWeight: '500' },
  posText: { color: PRIMARY },
  negText: { color: '#ef4444' },

  gridWrap: { paddingHorizontal: 16, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  card: {
    width: '47.5%',
    backgroundColor: 'white',
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
    backgroundColor: 'white',
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
  iconCircle: {
    width: 44, height: 44, borderRadius: 22,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 10,
  },
  cardLabel: { fontSize: 11, color: '#94a3b8', marginBottom: 3 },
  cardAmount: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  cardCount: { fontSize: 11, color: '#94a3b8', marginTop: 2 },

  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  filterText: { fontSize: 13, color: '#64748b' },
  clearBtn: { paddingHorizontal: 4 },
  clearText: { fontSize: 13, color: PRIMARY, fontWeight: '600' },
  filterCount: { fontSize: 12, color: '#94a3b8' },

  updateTime: {
    fontSize: 11, color: '#94a3b8',
    marginHorizontal: 20, marginTop: 10, marginBottom: 4,
  },

  assetList: {
    backgroundColor: 'white',
    marginHorizontal: 16, marginTop: 8,
    borderRadius: 12, overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  assetRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  assetName: { fontSize: 15, fontWeight: '500', color: '#1e293b', marginBottom: 2 },
  assetMeta: { fontSize: 12, color: '#94a3b8' },
  assetAmount: { fontSize: 16, fontWeight: '600', color: '#1e293b' },
  assetShares: { fontSize: 12, color: '#94a3b8', marginTop: 2 },

  empty: { alignItems: 'center', padding: 48 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#64748b', marginBottom: 8 },
  emptySub: { fontSize: 13, color: '#94a3b8' },

  fab: {
    position: 'absolute', right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: PRIMARY,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
});
