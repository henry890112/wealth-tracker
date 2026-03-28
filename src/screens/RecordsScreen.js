import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/ThemeContext';

const TYPE_CONFIG = {
  BUY:    { label: '買入', color: '#16a34a', bg: '#dcfce7' },
  SELL:   { label: '賣出', color: '#ef4444', bg: '#fee2e2' },
  ADJUST: { label: '調整', color: '#2563eb', bg: '#dbeafe' },
};

export default function RecordsScreen() {
  const { colors } = useTheme();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('transactions')
        .select('*, assets(name, symbol, currency)')
        .order('trans_date', { ascending: false })
        .limit(100);

      setTransactions(data || []);
    } catch (e) {
      console.error('Error loading records:', e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  if (transactions.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.bg }]}>
        <Text style={[styles.emptyText, { color: colors.textSub }]}>尚無交易紀錄</Text>
        <Text style={[styles.emptySub, { color: colors.textMuted }]}>買賣資產後紀錄將顯示在這裡</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={[styles.list, { backgroundColor: colors.card }]}>
        {transactions.map((tx, idx) => {
          const cfg = TYPE_CONFIG[tx.type] || TYPE_CONFIG.ADJUST;
          const date = new Date(tx.trans_date);
          const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
          const assetCurrency = tx.assets?.currency || '';
          const amount = parseFloat(tx.total_amount);
          return (
            <View
              key={tx.id}
              style={[styles.row, { borderBottomColor: colors.borderLight }, idx === transactions.length - 1 && { borderBottomWidth: 0 }]}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 60 },
  emptyText: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptySub: { fontSize: 13, textAlign: 'center' },
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
