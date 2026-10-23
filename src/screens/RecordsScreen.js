import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Eye, EyeOff, SlidersHorizontal, Trash2, X } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/ThemeContext';
import { getTransactionSourceLabel } from '../lib/transactionReconciliation';

const TYPE_CONFIG = {
  BUY:    { label: '買入', color: '#0DBD8B', bg: 'rgba(13,189,139,0.12)' },
  SELL:   { label: '賣出', color: '#F03030', bg: 'rgba(240,48,48,0.12)' },
  ADJUST: { label: '調整' },
};

const TYPE_FILTERS = [
  { key: 'all',    label: '全部' },
  { key: 'BUY',   label: '買入' },
  { key: 'SELL',  label: '賣出' },
  { key: 'ADJUST',label: '調整' },
];

const MARKET_FILTERS = [
  { key: 'all',    label: '全市場' },
  { key: 'TW',    label: '台股' },
  { key: 'US',    label: '美股' },
  { key: 'Crypto',label: '虛幣' },
  { key: 'other', label: '其他' },
];

export default function RecordsScreen() {
  const { colors } = useTheme();
  const PRIMARY = colors.accent || '#8B8CF6';
  const insets = useSafeAreaInsets();
  const [transactions, setTransactions] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [marketFilter, setMarketFilter] = useState('all');
  const [assetFilter, setAssetFilter] = useState('all');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [updatingIgnoreId, setUpdatingIgnoreId] = useState(null);
  const lastLoadedRef = useRef(0);

  useFocusEffect(useCallback(() => {
    if (Date.now() - lastLoadedRef.current < 60000) return;
    lastLoadedRef.current = Date.now();
    loadData();
  }, []));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    lastLoadedRef.current = 0;
    await loadData();
    setRefreshing(false);
  }, []);

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data }, { count }] = await Promise.all([
        supabase
          .from('transactions')
          .select('*, assets(name, symbol, currency, market_type, category)')
          .order('trans_date', { ascending: false })
          .limit(200),
        supabase
          .from('transactions')
          .select('id, assets!inner(user_id)', { count: 'exact', head: true })
          .eq('assets.user_id', user.id),
      ]);

      setTransactions(data || []);
      setTotalCount(count || 0);
    } catch (e) {
      console.error('Error loading records:', e);
    } finally {
      setLoading(false);
    }
  };

  // Build unique asset list for filter chips
  const assetFilters = useMemo(() => {
    const seen = new Map();
    for (const tx of transactions) {
      const name = tx.assets?.name;
      if (name && !seen.has(name)) {
        seen.set(name, { key: name, label: name });
      }
    }
    return [{ key: 'all', label: '全部資產' }, ...Array.from(seen.values())];
  }, [transactions]);

  const filtered = useMemo(() => {
    return transactions.filter(tx => {
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (marketFilter !== 'all') {
        const mt = tx.assets?.market_type || 'other';
        if (mt !== marketFilter) return false;
      }
      if (assetFilter !== 'all' && tx.assets?.name !== assetFilter) return false;
      return true;
    });
  }, [transactions, typeFilter, marketFilter, assetFilter]);

  const advancedFilterCount = (marketFilter !== 'all' ? 1 : 0) + (assetFilter !== 'all' ? 1 : 0);
  const resetAdvancedFilters = () => {
    setMarketFilter('all');
    setAssetFilter('all');
  };

  const deleteTransaction = async tx => {
    if (!tx?.id || deletingId) return;
    setDeletingId(tx.id);
    try {
      const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('id', tx.id);
      if (error) throw error;

      // The database trigger rebuilds the linked asset position. Reload the
      // list so the displayed records, count, holdings and performance all
      // reflect the deletion instead of only removing the local row.
      setTransactions(current => current.filter(item => item.id !== tx.id));
      setTotalCount(current => Math.max(0, current - 1));
      lastLoadedRef.current = 0;
      await loadData();
    } catch (e) {
      Alert.alert('刪除失敗', e.message || '無法刪除這筆交易紀錄，請稍後再試。');
    } finally {
      setDeletingId(null);
    }
  };

  const confirmDelete = tx => {
    const typeLabel = TYPE_CONFIG[tx?.type]?.label || '調整';
    const assetLabel = tx?.assets?.name || tx?.assets?.symbol || '這筆資產';
    Alert.alert(
      '刪除交易紀錄？',
      `${assetLabel} · ${typeLabel}\n刪除後會重新計算持倉與投資報酬，且無法復原。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '刪除', style: 'destructive', onPress: () => { void deleteTransaction(tx); } },
      ],
    );
  };

  const togglePerformanceIgnore = async tx => {
    if (!tx?.id || !['BUY', 'SELL'].includes(tx.type) || updatingIgnoreId) return;
    const nextIgnored = !Boolean(tx.ignored_from_performance);
    setUpdatingIgnoreId(tx.id);
    try {
      const { error } = await supabase
        .from('transactions')
        .update({ ignored_from_performance: nextIgnored })
        .eq('id', tx.id);
      if (error) throw error;
      setTransactions(current => current.map(item => (
        item.id === tx.id ? { ...item, ignored_from_performance: nextIgnored } : item
      )));
    } catch (e) {
      const message = String(e?.message || '');
      const migrationMissing = /ignored_from_performance|column .* does not exist/i.test(message)
        || ['42703', 'PGRST204', 'PGRST205'].includes(String(e?.code || ''));
      Alert.alert(
        migrationMissing ? '功能尚未啟用' : '更新失敗',
        migrationMissing
          ? '請先套用交易忽略功能的 Supabase migration，之後才能忽略賣出報酬。'
          : (message || '無法更新這筆賣出的報酬計算狀態。'),
      );
    } finally {
      setUpdatingIgnoreId(null);
    }
  };

  const confirmTogglePerformanceIgnore = tx => {
    if (!['BUY', 'SELL'].includes(tx?.type)) return;
    const nextIgnored = !Boolean(tx.ignored_from_performance);
    const assetLabel = tx.assets?.name || tx.assets?.symbol || '這筆賣出';
    Alert.alert(
      nextIgnored ? '不計算這筆交易？' : '恢復計算這筆交易？',
      nextIgnored
        ? `${assetLabel} 會保留在交易紀錄，但不納入 FIFO 與淨值現金流。`
        : `${assetLabel} 將重新納入 FIFO 報酬與淨值曲線計算。`,
      [
        { text: '取消', style: 'cancel' },
        { text: nextIgnored ? '不計算' : '恢復計算', style: nextIgnored ? 'destructive' : 'default', onPress: () => { void togglePerformanceIgnore(tx); } },
      ],
    );
  };

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  const renderChip = (items, active, onSelect, activeColor) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {items.map(item => {
        const isActive = active === item.key;
        return (
          <TouchableOpacity
            key={item.key}
            style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.borderLight },
              isActive && { backgroundColor: activeColor, borderColor: activeColor }]}
            onPress={() => onSelect(item.key)}
            activeOpacity={0.75}
          >
            <Text style={[styles.chipText, { color: colors.textSub }, isActive && { color: colors.accentContrast, fontWeight: '700' }]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  return (
    <View style={[{ flex: 1 }, { backgroundColor: colors.bg }]}>
      {/* Filter bar */}
      <View
        style={[styles.filterBar, { backgroundColor: colors.card, borderBottomColor: colors.borderLight }]}
      >
        <View style={styles.filterHeader}>
          <View>
            <Text style={[styles.filterTitle, { color: colors.text }]}>篩選交易</Text>
            <Text style={[styles.filterCount, { color: colors.textMuted }]}>顯示 {filtered.length} 筆紀錄</Text>
          </View>
          <TouchableOpacity
            style={[styles.filterToggle, { backgroundColor: advancedFilterCount ? colors.hotBg : colors.cardAlt, borderColor: advancedFilterCount ? PRIMARY : colors.border }]}
            onPress={() => setFiltersExpanded(v => !v)}
          >
            <SlidersHorizontal size={16} color={advancedFilterCount ? PRIMARY : colors.textSub} />
            <Text style={[styles.filterToggleText, { color: advancedFilterCount ? PRIMARY : colors.textSub }]}>進階{advancedFilterCount ? ` · ${advancedFilterCount}` : ''}</Text>
          </TouchableOpacity>
        </View>
        {renderChip(TYPE_FILTERS,   typeFilter,   setTypeFilter,   PRIMARY)}
        {filtersExpanded && (
          <View style={styles.advancedFilters}>
            <View style={styles.advancedHeader}>
              <Text style={[styles.advancedLabel, { color: colors.textMuted }]}>市場與資產</Text>
              {advancedFilterCount > 0 && (
                <TouchableOpacity style={styles.resetButton} onPress={resetAdvancedFilters}>
                  <X size={13} color={PRIMARY} />
                  <Text style={[styles.resetText, { color: PRIMARY }]}>清除</Text>
                </TouchableOpacity>
              )}
            </View>
            {renderChip(MARKET_FILTERS, marketFilter, setMarketFilter, PRIMARY)}
            {assetFilters.length > 2 && renderChip(assetFilters, assetFilter, setAssetFilter, PRIMARY)}
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />}
      >
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: colors.textSub }]}>無符合紀錄</Text>
          </View>
        ) : (
          <View style={[styles.list, { backgroundColor: colors.card }]}>
            {filtered.map((tx, idx) => {
              const baseCfg = TYPE_CONFIG[tx.type] || TYPE_CONFIG.ADJUST;
              const cfg = !['BUY', 'SELL'].includes(tx.type)
                ? { ...baseCfg, color: PRIMARY, bg: colors.hotBg }
                : baseCfg;
              const date = new Date(tx.trans_date);
              const nowYear = new Date().getFullYear();
              const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
              const dateStr = date.getFullYear() !== nowYear
                ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${timeStr}`
                : `${date.getMonth() + 1}/${date.getDate()} ${timeStr}`;
              const assetCurrency = tx.assets?.currency || '';
              const amount = parseFloat(tx.total_amount);
              return (
                <View
                  key={`${tx.id}-${tx.asset_id || tx.assets?.id || ''}-${tx.trans_date}-${idx}`}
                  style={[styles.row, { borderBottomColor: colors.borderLight }, idx === filtered.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
                    <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                  <View style={styles.rowContent}>
                    <Text style={[styles.assetName, { color: colors.text }]}>{tx.assets?.name || '—'}</Text>
                    <Text style={[styles.meta, { color: colors.textMuted }]}>
                      {tx.assets?.symbol ? `${tx.assets.symbol} · ` : ''}{dateStr}
                    </Text>
                    <Text style={[styles.sourceLabel, { color: colors.textSub }]}>{getTransactionSourceLabel(tx)}</Text>
                  </View>
                  <View style={styles.rowEnd}>
                    <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
                      <Text style={[styles.amount, { color: cfg.color }]} numberOfLines={1} adjustsFontSizeToFit>
                        {tx.type === 'SELL' ? '-' : '+'}{assetCurrency} {amount.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}
                      </Text>
                      {parseFloat(tx.shares) !== 0 && (
                        <Text style={[styles.shares, { color: colors.textMuted }]} numberOfLines={1}>
                          {tx.shares} 股 @ {parseFloat(tx.price).toFixed(2)}
                        </Text>
                      )}
                      {tx.ignored_from_performance && (
                        <Text style={[styles.ignoredLabel, { color: colors.warning || '#F5A623' }]}>不計績效</Text>
                      )}
                    </View>
                    {['BUY', 'SELL'].includes(tx.type) && (
                      <TouchableOpacity
                        style={[styles.ignoreButton, { borderColor: tx.ignored_from_performance ? colors.warning || '#F5A623' : colors.borderLight, backgroundColor: tx.ignored_from_performance ? 'rgba(245,166,35,0.12)' : colors.cardAlt }]}
                        onPress={() => confirmTogglePerformanceIgnore(tx)}
                        disabled={updatingIgnoreId === tx.id}
                        accessibilityRole="button"
                        accessibilityLabel={tx.ignored_from_performance ? '恢復這筆交易績效計算' : '不計算這筆交易績效'}
                      >
                        {updatingIgnoreId === tx.id
                          ? <ActivityIndicator size="small" color={colors.warning || '#F5A623'} />
                          : (tx.ignored_from_performance
                            ? <Eye size={15} color={colors.warning || '#F5A623'} />
                            : <EyeOff size={15} color={colors.textSub} />)}
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[styles.deleteButton, { borderColor: colors.borderLight, backgroundColor: colors.cardAlt }]}
                      onPress={() => confirmDelete(tx)}
                      disabled={deletingId === tx.id}
                      accessibilityRole="button"
                      accessibilityLabel={`刪除${tx.assets?.name || tx.assets?.symbol || '這筆'}交易紀錄`}
                    >
                      {deletingId === tx.id
                        ? <ActivityIndicator size="small" color={colors.danger || '#F03030'} />
                        : <Trash2 size={15} color={colors.danger || '#F03030'} />}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
        {totalCount > 200 && (
          <View style={{ paddingVertical: 16, alignItems: 'center' }}>
            <Text style={{ fontSize: 12, color: colors.textSub }}>
              顯示最近 200 筆，共 {totalCount} 筆交易記錄
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 60 },
  emptyText: { fontSize: 16, fontWeight: '600' },

  filterBar: {
    borderBottomWidth: 1,
    paddingVertical: 12,
    gap: 8,
  },
  filterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  filterTitle: { fontSize: 16, fontWeight: '700' },
  filterCount: { fontSize: 12, marginTop: 2 },
  filterToggle: { height: 34, paddingHorizontal: 11, borderRadius: 17, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterToggleText: { fontSize: 12, fontWeight: '700' },
  advancedFilters: { gap: 7, paddingTop: 3 },
  advancedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  advancedLabel: { fontSize: 12, fontWeight: '600' },
  resetButton: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  resetText: { fontSize: 12, fontWeight: '600' },
  chipRow: { flexDirection: 'row', paddingHorizontal: 12, gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: '500' },

  list: {
    margin: 16, borderRadius: 12, overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, gap: 10,
    borderBottomWidth: 1,
  },
  badge: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, minWidth: 48, alignItems: 'center',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  rowContent: { flex: 1 },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '58%' },
  assetName: { fontSize: 14, fontWeight: '500', marginBottom: 2 },
  meta: { fontSize: 12 },
  amount: { fontSize: 14, fontWeight: '600' },
  shares: { fontSize: 11, marginTop: 2 },
  ignoredLabel: { fontSize: 10, fontWeight: '700', marginTop: 2 },
  sourceLabel: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  ignoreButton: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  deleteButton: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
});
