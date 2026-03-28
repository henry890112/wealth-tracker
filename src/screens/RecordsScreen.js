import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/ThemeContext';

const TYPE_CONFIG = {
  BUY:    { label: '買入', color: '#16a34a', bg: '#dcfce7' },
  SELL:   { label: '賣出', color: '#ef4444', bg: '#fee2e2' },
  ADJUST: { label: '調整', color: '#2563eb', bg: '#dbeafe' },
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
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [marketFilter, setMarketFilter] = useState('all');

  useFocusEffect(useCallback(() => { loadData(); }, []));

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('transactions')
        .select('*, assets(name, symbol, currency, market_type)')
        .order('trans_date', { ascending: false })
        .limit(200);

      setTransactions(data || []);
    } catch (e) {
      console.error('Error loading records:', e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    return transactions.filter(tx => {
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (marketFilter !== 'all') {
        const mt = tx.assets?.market_type || 'other';
        if (mt !== marketFilter) return false;
      }
      return true;
    });
  }, [transactions, typeFilter, marketFilter]);

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color="#16a34a" />
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
            <Text style={[styles.chipText, { color: colors.textSub }, isActive && styles.chipTextActive]}>
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
      <View style={[styles.filterBar, { backgroundColor: colors.card, borderBottomColor: colors.borderLight }]}>
        {renderChip(TYPE_FILTERS,   typeFilter,   setTypeFilter,   '#16a34a')}
        {renderChip(MARKET_FILTERS, marketFilter, setMarketFilter, '#2563eb')}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: colors.textSub }]}>無符合紀錄</Text>
          </View>
        ) : (
          <View style={[styles.list, { backgroundColor: colors.card }]}>
            {filtered.map((tx, idx) => {
              const cfg = TYPE_CONFIG[tx.type] || TYPE_CONFIG.ADJUST;
              const date = new Date(tx.trans_date);
              const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
              const assetCurrency = tx.assets?.currency || '';
              const amount = parseFloat(tx.total_amount);
              return (
                <View
                  key={tx.id}
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
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.amount, { color: cfg.color }]}>
                      {tx.type === 'SELL' ? '-' : '+'}{assetCurrency} {amount.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}
                    </Text>
                    {parseFloat(tx.shares) !== 0 && (
                      <Text style={[styles.shares, { color: colors.textMuted }]}>
                        {tx.shares} 股 @ {parseFloat(tx.price).toFixed(2)}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
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
    paddingVertical: 8,
    gap: 4,
  },
  chipRow: { flexDirection: 'row', paddingHorizontal: 12, gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: 'white', fontWeight: '700' },

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
  assetName: { fontSize: 14, fontWeight: '500', marginBottom: 2 },
  meta: { fontSize: 12 },
  amount: { fontSize: 14, fontWeight: '600' },
  shares: { fontSize: 11, marginTop: 2 },
});
