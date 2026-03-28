import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { X, Check } from 'lucide-react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const PRIMARY = '#16a34a';

const CATEGORIES = [
  { key: 'liquid',     label: '流動資產', color: '#16a34a', bg: '#dcfce7', desc: '現金、銀行存款、活存' },
  { key: 'investment', label: '投資資產', color: '#f59e0b', bg: '#fef3c7', desc: '股票、基金、虛擬貨幣' },
  { key: 'fixed',      label: '固定資產', color: '#94a3b8', bg: '#f1f5f9', desc: '不動產、車輛、設備' },
  { key: 'receivable', label: '應收款項', color: '#0d9488', bg: '#ccfbf1', desc: '借給他人的款項' },
  { key: 'liability',  label: '負債',     color: '#ef4444', bg: '#fee2e2', desc: '貸款、信用卡、債務' },
];

const CURRENCIES = ['TWD', 'USD', 'EUR', 'JPY', 'CNY', 'HKD', 'GBP', 'AUD'];

export default function AddAssetScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();

  const defaultCategory = route.params?.defaultCategory || 'liquid';

  const [selectedCategory, setSelectedCategory] = useState(defaultCategory);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [currency, setCurrency] = useState('TWD');
  const [amount, setAmount] = useState('');
  const [shares, setShares] = useState('');
  const [avgCost, setAvgCost] = useState('');
  const [saving, setSaving] = useState(false);

  const isInvestment = selectedCategory === 'investment';

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('請填寫名稱');
      return;
    }
    const parsedAmount = parseFloat(amount.replace(/,/g, ''));
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      Alert.alert('請輸入正確的金額');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('未登入');

      const payload = {
        user_id: user.id,
        name: name.trim(),
        symbol: symbol.trim() || null,
        category: selectedCategory,
        currency,
        current_amount: parsedAmount,
        current_shares: isInvestment && shares ? parseFloat(shares) : 0,
        average_cost: isInvestment && avgCost ? parseFloat(avgCost) : 0,
      };

      const { data: asset, error } = await supabase.from('assets').insert(payload).select().single();
      if (error) throw error;

      // Insert transaction so it appears in RecordsScreen.
      // Investment assets use BUY (trigger recalculates shares/amount correctly).
      // Other categories use ADJUST (trigger skips recalculation, preserving manual amount).
      await supabase.from('transactions').insert({
        asset_id: asset.id,
        type: isInvestment ? 'BUY' : 'ADJUST',
        shares: isInvestment && shares ? parseFloat(shares) : 0,
        price: isInvestment && avgCost ? parseFloat(avgCost) : 0,
        total_amount: parsedAmount,
        trans_date: new Date().toISOString(),
      });

      // Snapshot update
      await supabase.rpc('create_daily_snapshot', { p_user_id: user.id });

      Alert.alert('新增成功', `「${name.trim()}」已加入${CATEGORIES.find(c => c.key === selectedCategory)?.label}`, [
        { text: '確定', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('新增失敗', e.message);
    } finally {
      setSaving(false);
    }
  };

  const cat = CATEGORIES.find(c => c.key === selectedCategory);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#f1f5f9' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
          <X size={20} color="#64748b" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>新增資產</Text>
        <TouchableOpacity
          onPress={handleSave}
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator size="small" color="white" />
            : <Check size={18} color="white" />
          }
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>

        {/* Category selector */}
        <Text style={styles.sectionLabel}>資產類別</Text>
        <View style={styles.catGrid}>
          {CATEGORIES.map(c => {
            const active = selectedCategory === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                style={[styles.catCard, active && { borderColor: c.color, borderWidth: 2 }]}
                onPress={() => setSelectedCategory(c.key)}
                activeOpacity={0.75}
              >
                <View style={[styles.catDot, { backgroundColor: active ? c.color : c.bg }]} />
                <Text style={[styles.catLabel, active && { color: c.color, fontWeight: '700' }]}>{c.label}</Text>
                <Text style={styles.catDesc} numberOfLines={1}>{c.desc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Form */}
        <View style={styles.formCard}>
          {/* Name */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>名稱 *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={`例：${selectedCategory === 'liquid' ? '台灣銀行活存' : selectedCategory === 'fixed' ? '自住房產' : selectedCategory === 'receivable' ? '借給朋友的錢' : selectedCategory === 'liability' ? '房屋貸款' : '台積電'}`}
              placeholderTextColor="#cbd5e1"
            />
          </View>

          {/* Symbol (optional, shown for investment) */}
          {isInvestment && (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>代碼（選填）</Text>
              <TextInput
                style={styles.input}
                value={symbol}
                onChangeText={t => setSymbol(t.toUpperCase())}
                placeholder="例：2330、AAPL、BTC"
                placeholderTextColor="#cbd5e1"
                autoCapitalize="characters"
              />
            </View>
          )}

          {/* Currency */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>幣別</Text>
            {/* Liquid glass currency selector */}
            <View style={styles.currencyGlass}>
              <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFill} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.currencyRow}>
                {CURRENCIES.map(cur => {
                  const active = currency === cur;
                  return (
                    <TouchableOpacity
                      key={cur}
                      style={[styles.currencyBtn, active && styles.currencyBtnActive]}
                      onPress={() => setCurrency(cur)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.currencyLabel, active && styles.currencyLabelActive]}>{cur}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>

          {/* Amount */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              {isInvestment ? '現值金額' : selectedCategory === 'liability' ? '負債金額' : '資產金額'} *
            </Text>
            <View style={styles.inputRow}>
              <Text style={styles.currencyPrefix}>{currency === 'TWD' ? 'NT$' : currency}</Text>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor="#cbd5e1"
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          {/* Investment-only fields */}
          {isInvestment && (
            <>
              <View style={styles.divider} />
              <Text style={styles.investHint}>投資詳細（選填，用於計算損益）</Text>
              <View style={styles.row2}>
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>持有股數/數量</Text>
                  <TextInput
                    style={styles.input}
                    value={shares}
                    onChangeText={setShares}
                    placeholder="0"
                    placeholderTextColor="#cbd5e1"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ width: 12 }} />
                <View style={[styles.field, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>平均成本</Text>
                  <TextInput
                    style={styles.input}
                    value={avgCost}
                    onChangeText={setAvgCost}
                    placeholder="0"
                    placeholderTextColor="#cbd5e1"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </>
          )}
        </View>

        {/* Save button */}
        <TouchableOpacity
          style={[styles.saveFullBtn, { backgroundColor: cat?.color || PRIMARY }, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="white" />
            : <Text style={styles.saveFullBtnText}>儲存{cat?.label}</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#f1f5f9',
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'white', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#1e293b' },
  saveBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: PRIMARY, justifyContent: 'center', alignItems: 'center',
    shadowColor: PRIMARY, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 4,
  },

  sectionLabel: { fontSize: 13, color: '#94a3b8', fontWeight: '600', marginHorizontal: 16, marginTop: 16, marginBottom: 8 },

  catGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 8, marginBottom: 4 },
  catCard: {
    width: '46%', backgroundColor: 'white', borderRadius: 12, padding: 12,
    borderWidth: 2, borderColor: 'transparent',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  catDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 6 },
  catLabel: { fontSize: 14, fontWeight: '600', color: '#1e293b', marginBottom: 2 },
  catDesc: { fontSize: 11, color: '#94a3b8' },

  formCard: {
    backgroundColor: 'white', marginHorizontal: 16, marginTop: 12, marginBottom: 12,
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  field: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, color: '#64748b', fontWeight: '500', marginBottom: 6 },
  input: {
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 15, color: '#1e293b', marginBottom: 0,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  currencyPrefix: { fontSize: 15, color: '#64748b', fontWeight: '500', minWidth: 36 },

  // Liquid glass currency selector
  currencyGlass: {
    borderRadius: 12, overflow: 'hidden',
    backgroundColor: 'rgba(22,163,74,0.06)',
    borderWidth: 1, borderColor: 'rgba(22,163,74,0.12)',
  },
  currencyRow: { flexDirection: 'row', padding: 4, gap: 4 },
  currencyBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)',
  },
  currencyBtnActive: {
    backgroundColor: PRIMARY,
    borderColor: 'rgba(255,255,255,0.3)',
    shadowColor: PRIMARY, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
  },
  currencyLabel: { fontSize: 13, color: PRIMARY, fontWeight: '600' },
  currencyLabelActive: { color: 'white' },

  divider: { height: 1, backgroundColor: '#f1f5f9', marginBottom: 12 },
  investHint: { fontSize: 12, color: '#94a3b8', marginBottom: 12 },
  row2: { flexDirection: 'row' },

  saveFullBtn: {
    marginHorizontal: 16, borderRadius: 14, paddingVertical: 15, alignItems: 'center',
    shadowColor: PRIMARY, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  saveFullBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
});
