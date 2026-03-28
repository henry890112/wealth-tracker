import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';

const TYPE_CONFIG = {
  BUY:    { label: '買入', color: '#16a34a', bg: '#dcfce7' },
  SELL:   { label: '賣出', color: '#ef4444', bg: '#fee2e2' },
  ADJUST: { label: '調整', color: '#2563eb', bg: '#dbeafe' },
};

export default function RecordsScreen() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

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
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  if (transactions.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>尚無交易紀錄</Text>
        <Text style={styles.emptySub}>買賣資產後紀錄將顯示在這裡</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.list}>
        {transactions.map((tx, idx) => {
          const cfg = TYPE_CONFIG[tx.type] || TYPE_CONFIG.ADJUST;
          const date = new Date(tx.trans_date);
          const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
          const assetCurrency = tx.assets?.currency || '';
          const amount = parseFloat(tx.total_amount);
          return (
            <View
              key={tx.id}
              style={[styles.row, idx === transactions.length - 1 && { borderBottomWidth: 0 }]}
            >
              <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
                <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.assetName}>{tx.assets?.name || '—'}</Text>
                <Text style={styles.meta}>
                  {tx.assets?.symbol ? `${tx.assets.symbol} · ` : ''}{dateStr}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.amount, { color: cfg.color }]}>
                  {tx.type === 'SELL' ? '-' : '+'}{assetCurrency} {amount.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}
                </Text>
                {parseFloat(tx.shares) !== 0 && (
                  <Text style={styles.shares}>
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
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9', padding: 60 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#64748b', marginBottom: 8 },
  emptySub: { fontSize: 13, color: '#94a3b8', textAlign: 'center' },
  list: {
    backgroundColor: 'white',
    margin: 16, borderRadius: 12, overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, gap: 10,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  badge: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, minWidth: 48, alignItems: 'center',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  rowContent: { flex: 1 },
  assetName: { fontSize: 14, fontWeight: '500', color: '#1e293b', marginBottom: 2 },
  meta: { fontSize: 12, color: '#94a3b8' },
  amount: { fontSize: 14, fontWeight: '600' },
  shares: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
});
