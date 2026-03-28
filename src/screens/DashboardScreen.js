import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wallet, TrendingUp, Home, DollarSign, CreditCard, Plus, RefreshCw } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { convertToBaseCurrency } from '../services/api';
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

  useFocusEffect(useCallback(() => { loadData(); }, []));

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
  const fmt = (v) => formatAmount(v);

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
            <Text style={[styles.heroLabel, { color: colors.textMuted }]}>淨資產總覽（{currency}）</Text>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => navigation.navigate('AddAsset')}
              activeOpacity={0.85}
            >
              <Plus size={20} color="white" />
            </TouchableOpacity>
          </View>
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
                  <Text style={[styles.cardAmount, { color: colors.text }]} numberOfLines={1}>{fmt(d.total)}</Text>
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
                <Text style={[styles.cardAmount, { color: d.total > 0 ? '#ef4444' : colors.textMuted }]}>{fmt(d.total)}</Text>
              </TouchableOpacity>
            );
          })()}
        </View>

        {/* Filter bar */}
        {selectedCategory && (
          <View style={[styles.filterBar, { backgroundColor: colors.card }]}>
            <Text style={[styles.filterText, { color: colors.textSub }]}>篩選中</Text>
            <TouchableOpacity onPress={() => setSelectedCategory(null)} style={styles.clearBtn}>
              <Text style={styles.clearText}>清除</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <RefreshCw size={12} color={colors.textMuted} />
            <Text style={[styles.filterCount, { color: colors.textMuted }]}> {filteredAssets.length} 項</Text>
          </View>
        )}

        {/* Price update time */}
        {lastUpdated && (
          <Text style={[styles.updateTime, { color: colors.textMuted }]}>
            報價更新：{lastUpdated.toLocaleTimeString('zh-TW')}
          </Text>
        )}

        {/* Asset list */}
        {filteredAssets.length > 0 ? (
          <View style={[styles.assetList, { backgroundColor: colors.card }]}>
            {filteredAssets.map((asset, idx) => (
              <TouchableOpacity
                key={asset.id}
                style={[
                  styles.assetRow,
                  { borderBottomColor: colors.borderLight },
                  idx === filteredAssets.length - 1 && { borderBottomWidth: 0 },
                ]}
                onPress={() => navigation.navigate('AssetDetail', { assetId: asset.id })}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.assetName, { color: colors.text }]}>{asset.name}</Text>
                  <Text style={[styles.assetMeta, { color: colors.textMuted }]}>
                    {CATEGORY_CONFIG[asset.category]?.label} · {asset.currency}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.assetAmount, { color: colors.text }]}>{fmt(asset.converted_amount)}</Text>
                  {asset.current_shares > 0 && (
                    <Text style={[styles.assetShares, { color: colors.textMuted }]}>
                      {asset.current_shares.toLocaleString()} 股
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </View>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  card: {
    width: '47.5%',
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

  updateTime: {
    fontSize: 11,
    marginHorizontal: 20, marginTop: 10, marginBottom: 4,
  },

  assetList: {
    marginHorizontal: 16, marginTop: 8,
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
