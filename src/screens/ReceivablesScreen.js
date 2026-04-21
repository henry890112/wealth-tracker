import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/ThemeContext';
import { fetchExchangeRate } from '../services/api';

const CATEGORIES = ['薪資', '租金', '借款', '投資回收', '其他'];
const CURRENCIES = ['TWD', 'USD', 'JPY', 'EUR', 'CNY'];

const FREQUENCIES = [
  { key: 'once',       label: '單次' },
  { key: 'monthly',    label: '每月' },
  { key: 'quarterly',  label: '每季' },
  { key: 'semi_annual', label: '每半年' },
  { key: 'yearly',    label: '每年' },
];
const FREQUENCY_MONTHS = { once: 0, monthly: 1, quarterly: 3, semi_annual: 6, yearly: 12 };

const CATEGORY_COLORS = {
  薪資: '#3b82f6',
  租金: '#f59e0b',
  借款: '#E07070',
  投資回收: '#10b981',
  其他: '#6b7280',
};

const EMPTY_FORM = {
  title: '',
  amount: '',
  currency: 'TWD',
  category: '其他',
  frequency: 'once',
  due_date: '',
  note: '',
};

export default function ReceivablesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalMonthly, setTotalMonthly] = useState(0);
  const [baseCurrency, setBaseCurrency] = useState('TWD');
  const [rates, setRates] = useState({});
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  const fetchRates = async (data, base) => {
    const uniqueCurrencies = [...new Set(data.map(e => e.currency).filter(c => c && c !== base))];
    const rateMap = { [base]: 1 };
    await Promise.all(
      uniqueCurrencies.map(async (cur) => {
        try {
          rateMap[cur] = await fetchExchangeRate(cur, base);
        } catch {
          rateMap[cur] = 1;
        }
      })
    );
    return rateMap;
  };

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles').select('base_currency').eq('id', user.id).single();
      const base = profileData?.base_currency || 'TWD';
      setBaseCurrency(base);

      const { data, error } = await supabase
        .from('receivables')
        .select('*')
        .eq('user_id', user.id)
        .order('due_date', { ascending: true });

      if (error) throw error;
      const receivables = data || [];
      setItems(receivables);

      const rateMap = await fetchRates(receivables, base);
      setRates(rateMap);

      // Monthly average: exclude once-off items
      const monthly = receivables.reduce((sum, e) => {
        const freq = e.frequency || 'once';
        const months = FREQUENCY_MONTHS[freq];
        if (months === 0) return sum; // single-time, skip
        const amt = Number(e.amount);
        const monthlyAmt = amt / months;
        if (e.currency === base) return sum + monthlyAmt;
        const rate = rateMap[e.currency];
        return sum + (rate ? monthlyAmt * rate : monthlyAmt);
      }, 0);
      setTotalMonthly(monthly);
    } catch (e) {
      console.error('Error loading receivables:', e);
    } finally {
      setLoading(false);
    }
  };

  const grouped = CATEGORIES.map(cat => ({
    category: cat,
    items: items.filter(e => (e.category || '其他') === cat),
  })).filter(g => g.items.length > 0);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalVisible(true);
  };

  const openEdit = (item) => {
    setEditing(item.id);
    setForm({
      title: item.title,
      amount: String(item.amount),
      currency: item.currency || 'TWD',
      category: item.category || '其他',
      frequency: item.frequency || 'once',
      due_date: item.due_date || '',
      note: item.note || '',
    });
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return Alert.alert('錯誤', '請輸入名稱');
    const amount = parseFloat(form.amount);
    if (!amount || isNaN(amount)) return Alert.alert('錯誤', '請輸入有效金額');

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const payload = {
        user_id: user.id,
        title: form.title.trim(),
        amount,
        currency: form.currency,
        category: form.category,
        frequency: form.frequency,
        due_date: form.due_date.trim() || null,
        note: form.note.trim() || null,
      };

      if (editing) {
        const { error } = await supabase
          .from('receivables')
          .update(payload)
          .eq('id', editing);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('receivables')
          .insert(payload);
        if (error) throw error;
      }

      setModalVisible(false);
      loadData();
    } catch (e) {
      Alert.alert('儲存失敗', e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (item) => {
    Alert.alert('刪除確認', `確定刪除「${item.title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('receivables')
            .delete()
            .eq('id', item.id);
          if (error) Alert.alert('刪除失敗', error.message);
          else loadData();
        },
      },
    ]);
  };

  const c = colors;

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      {/* Total card */}
      <View style={[styles.totalCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.totalLabel, { color: c.textSub }]}>預計月均應收（{baseCurrency}）</Text>
        <Text style={[styles.totalAmount, { color: c.text }]}>
          {Math.round(totalMonthly).toLocaleString('zh-TW', { minimumFractionDigits: 0 })}
          <Text style={[styles.totalCurrency, { color: c.textMuted }]}> {baseCurrency}</Text>
        </Text>
        <Text style={[styles.totalSub, { color: c.textMuted }]}>共 {items.length} 筆應收款項</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#16a34a" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        >
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: c.textMuted }]}>尚無應收款項</Text>
              <Text style={[styles.emptySub, { color: c.textMuted }]}>點擊右下角 + 新增</Text>
            </View>
          ) : (
            grouped.map(group => {
              const categoryColor = CATEGORY_COLORS[group.category] || '#6b7280';
              const categoryTotal = group.items.reduce((sum, e) => {
                const amt = Number(e.amount);
                if (e.currency === baseCurrency) return sum + amt;
                const rate = rates[e.currency];
                return sum + (rate ? amt * rate : amt);
              }, 0);
              return (
                <View key={group.category}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 20, marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: categoryColor, fontSize: 16 }}>●</Text>
                      <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{group.category}</Text>
                    </View>
                    <Text style={{ color: c.textSub, fontSize: 14, fontWeight: '600' }}>
                      {categoryTotal.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}
                    </Text>
                  </View>
                  {group.items.map(item => {
                    const convertedAmount = item.currency === baseCurrency
                      ? Number(item.amount)
                      : Number(item.amount) * (rates[item.currency] || 1);
                    const freqLabel = FREQUENCIES.find(f => f.key === item.frequency)?.label;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
                        onPress={() => openEdit(item)}
                        onLongPress={() => handleDelete(item)}
                        activeOpacity={0.75}
                      >
                        <View style={styles.cardLeft}>
                          <Text style={[styles.itemName, { color: c.text }]}>{item.title}</Text>
                          {item.note ? (
                            <Text style={[styles.itemNote, { color: c.textMuted }]} numberOfLines={1}>{item.note}</Text>
                          ) : null}
                        </View>
                        <View style={styles.cardRight}>
                          <Text style={{ color: '#10b981', fontSize: 18, fontWeight: '700' }}>
                            {convertedAmount.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}
                          </Text>
                          {item.due_date ? (
                            <Text style={[styles.itemDue, { color: c.textMuted }]}>{item.due_date}</Text>
                          ) : null}
                          {freqLabel && (
                            <Text style={{ color: '#f59e0b', fontSize: 11 }}>{freqLabel}</Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 90 }]}
        onPress={openNew}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Add/Edit Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalSheet, { backgroundColor: c.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: c.text }]}>
                {editing ? '編輯應收款項' : '新增應收款項'}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={[styles.modalClose, { color: c.textMuted }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <FormField label="名稱" colors={c}>
                <TextInput
                  style={[styles.input, { backgroundColor: c.input, borderColor: c.inputBorder, color: c.text }]}
                  value={form.title}
                  onChangeText={v => setForm(f => ({ ...f, title: v }))}
                  placeholder="例：薪資、房租收入"
                  placeholderTextColor={c.textMuted}
                />
              </FormField>

              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <FormField label="金額" colors={c}>
                    <TextInput
                      style={[styles.input, { backgroundColor: c.input, borderColor: c.inputBorder, color: c.text }]}
                      value={form.amount}
                      onChangeText={v => setForm(f => ({ ...f, amount: v }))}
                      placeholder="0"
                      placeholderTextColor={c.textMuted}
                      keyboardType="numeric"
                    />
                  </FormField>
                </View>
                <View style={{ flex: 1 }}>
                  <FormField label="幣別" colors={c}>
                    <View style={styles.chipRow}>
                      {CURRENCIES.map(cur => (
                        <TouchableOpacity
                          key={cur}
                          style={[styles.chip,
                            { borderColor: form.currency === cur ? '#16a34a' : c.border,
                              backgroundColor: form.currency === cur ? 'rgba(22,163,74,0.12)' : c.input }]}
                          onPress={() => setForm(f => ({ ...f, currency: cur }))}
                        >
                          <Text style={[styles.chipText, { color: form.currency === cur ? '#16a34a' : c.textSub }]}>
                            {cur}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </FormField>
                </View>
              </View>

              <FormField label="收款頻率" colors={c}>
                <View style={styles.chipRow}>
                  {FREQUENCIES.map(f => (
                    <TouchableOpacity
                      key={f.key}
                      style={[styles.chip,
                        { borderColor: form.frequency === f.key ? '#16a34a' : c.border,
                          backgroundColor: form.frequency === f.key ? 'rgba(22,163,74,0.12)' : c.input }]}
                      onPress={() => setForm(p => ({ ...p, frequency: f.key }))}
                    >
                      <Text style={[styles.chipText, { color: form.frequency === f.key ? '#16a34a' : c.textSub }]}>
                        {f.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </FormField>

              <FormField label="分類" colors={c}>
                <View style={styles.chipRow}>
                  {CATEGORIES.map(cat => (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.chip,
                        { borderColor: form.category === cat ? '#16a34a' : c.border,
                          backgroundColor: form.category === cat ? 'rgba(22,163,74,0.12)' : c.input }]}
                      onPress={() => setForm(f => ({ ...f, category: cat }))}
                    >
                      <Text style={[styles.chipText, { color: form.category === cat ? '#16a34a' : c.textSub }]}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </FormField>

              <FormField label="預計收款日（YYYY-MM-DD）" colors={c}>
                <TextInput
                  style={[styles.input, { backgroundColor: c.input, borderColor: c.inputBorder, color: c.text }]}
                  value={form.due_date}
                  onChangeText={v => setForm(f => ({ ...f, due_date: v }))}
                  placeholder="例：2026-05-10"
                  placeholderTextColor={c.textMuted}
                />
              </FormField>

              <FormField label="備註（選填）" colors={c}>
                <TextInput
                  style={[styles.input, { backgroundColor: c.input, borderColor: c.inputBorder, color: c.text }]}
                  value={form.note}
                  onChangeText={v => setForm(f => ({ ...f, note: v }))}
                  placeholder="備註..."
                  placeholderTextColor={c.textMuted}
                />
              </FormField>

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.saveBtnText}>{editing ? '儲存變更' : '新增'}</Text>
                }
              </TouchableOpacity>

              {editing && (
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => {
                    setModalVisible(false);
                    setTimeout(() => handleDelete({ id: editing, title: form.title }), 300);
                  }}
                >
                  <Text style={styles.deleteBtnText}>刪除此項目</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function FormField({ label, colors: c, children }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: c.textSub }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  totalCard: {
    margin: 16,
    marginBottom: 8,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  totalLabel: { fontSize: 13, marginBottom: 4 },
  totalAmount: { fontSize: 32, fontWeight: '700' },
  totalCurrency: { fontSize: 16, fontWeight: '400' },
  totalSub: { fontSize: 12, marginTop: 4 },

  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  emptySub: { fontSize: 13 },

  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  cardLeft: { flex: 1, marginRight: 12 },
  cardRight: { alignItems: 'flex-end' },
  itemName: { fontSize: 15, fontWeight: '600' },
  itemNote: { fontSize: 12, marginTop: 2 },
  itemDue: { fontSize: 11, marginTop: 3 },

  fab: {
    position: 'absolute',
    right: 20,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '300' },

  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  modalClose: { fontSize: 18, padding: 4 },

  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  row: { flexDirection: 'row' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  chipText: { fontSize: 13 },

  saveBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  deleteBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  deleteBtnText: { color: '#E07070', fontSize: 15 },
});
