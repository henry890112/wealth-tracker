import React, { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { LogOut, Globe, RefreshCw, Sun, Moon, Smartphone, Download, Upload, CloudUpload } from 'lucide-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '../lib/supabase';
import { fetchTWStockPrice, fetchUSStockPrice, fetchCryptoPrice } from '../services/api';
import { useTheme } from '../lib/ThemeContext';

const CURRENCIES = [
  { code: 'TWD', name: '新台幣 (TWD)' },
  { code: 'USD', name: '美元 (USD)' },
  { code: 'EUR', name: '歐元 (EUR)' },
  { code: 'JPY', name: '日圓 (JPY)' },
  { code: 'CNY', name: '人民幣 (CNY)' },
];

const THEME_OPTIONS = [
  { id: 'system', label: '跟隨系統', Icon: Smartphone },
  { id: 'light',  label: '淺色模式', Icon: Sun        },
  { id: 'dark',   label: '深色模式', Icon: Moon       },
];


export default function SettingsScreen() {
  const { preference, setPreference, colors } = useTheme();
  const [profile, setProfile] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => { loadProfile(); }, []));

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setUserEmail(user.email || '');

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (updates) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('profiles')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) throw error;

      setProfile({ ...profile, ...updates });
      Alert.alert('成功', '設定已更新');
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('錯誤', '更新失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleExportCSV = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: assets } = await supabase.from('assets').select('*').eq('user_id', user.id).order('created_at');
      const { data: transactions } = await supabase
        .from('transactions').select('*, assets(name, symbol, currency)')
        .in('asset_id', (assets || []).map(a => a.id))
        .order('trans_date', { ascending: false });

      const assetCsv = [
        '名稱,代碼,類別,市場,持有股數,均價,現值,幣別,建立日期',
        ...(assets || []).map(a =>
          [a.name, a.symbol || '', a.category, a.market_type || '', a.current_shares || 0,
           a.average_cost || 0, a.current_amount || 0, a.currency, a.created_at?.slice(0, 10)]
          .map(v => `"${v}"`).join(',')
        ),
      ].join('\n');

      const txCsv = [
        '日期,類型,資產名稱,代碼,股數,價格,總金額,幣別',
        ...(transactions || []).map(t =>
          [t.trans_date?.slice(0, 10), t.type, t.assets?.name || '', t.assets?.symbol || '',
           t.shares || 0, t.price || 0, t.total_amount || 0, t.currency || '']
          .map(v => `"${v}"`).join(',')
        ),
      ].join('\n');

      const content = `資產列表\n${assetCsv}\n\n交易紀錄\n${txCsv}`;
      const filename = `WealthTracker_${new Date().toISOString().slice(0, 10)}.csv`;
      const fileUri = FileSystem.documentDirectory + filename;
      await FileSystem.writeAsStringAsync(fileUri, content, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: '匯出 CSV' });
    } catch (e) {
      console.error('Export CSV error:', e);
      Alert.alert('錯誤', '匯出失敗');
    }
  };

  const handleBackupToCloud = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: assets }, { data: snapshots }] = await Promise.all([
        supabase.from('assets').select('*').eq('user_id', user.id),
        supabase.from('daily_snapshots').select('*').eq('user_id', user.id).order('snapshot_date', { ascending: false }).limit(180),
      ]);
      // transactions 沒有 user_id，透過 asset_id 間接查詢
      const assetIds = (assets || []).map(a => a.id);
      const { data: transactions } = assetIds.length
        ? await supabase.from('transactions').select('*').in('asset_id', assetIds)
        : { data: [] };

      const backup = { version: 1, exported_at: new Date().toISOString(), assets, transactions, snapshots };
      const filename = `WealthTracker_backup_${new Date().toISOString().slice(0, 10)}.json`;
      const fileUri = FileSystem.documentDirectory + filename;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(backup, null, 2));
      await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: '儲存備份到 iCloud' });
    } catch (e) {
      console.error('Backup error:', e);
      Alert.alert('錯誤', '備份失敗');
    }
  };

  const handleRestoreBackup = async () => {
    Alert.alert(
      '還原備份',
      '還原將會覆蓋現有資料，確定繼續嗎？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '選擇備份檔',
          onPress: async () => {
            try {
              const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
              if (result.canceled) return;

              const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
              const backup = JSON.parse(content);

              if (!backup.version || !backup.assets) {
                Alert.alert('錯誤', '備份檔格式不正確');
                return;
              }

              const { data: { user } } = await supabase.auth.getUser();
              if (!user) return;

              // Delete existing data (assets 刪除會 cascade 刪 transactions)
              await supabase.from('daily_snapshots').delete().eq('user_id', user.id);
              await supabase.from('assets').delete().eq('user_id', user.id);

              if (backup.assets?.length) {
                const toInsert = backup.assets.map(a => ({ ...a, user_id: user.id }));
                await supabase.from('assets').insert(toInsert);
              }
              if (backup.transactions?.length) {
                // transactions 沒有 user_id 欄位，只有 asset_id
                const toInsert = backup.transactions.map(({ user_id: _drop, ...t }) => t);
                await supabase.from('transactions').insert(toInsert);
              }
              if (backup.snapshots?.length) {
                const toInsert = backup.snapshots.map(s => ({ ...s, user_id: user.id }));
                await supabase.from('daily_snapshots').insert(toInsert);
              }

              Alert.alert('成功', `已還原 ${backup.assets?.length || 0} 項資產、${backup.transactions?.length || 0} 筆交易`);
            } catch (e) {
              console.error('Restore error:', e);
              Alert.alert('錯誤', '還原失敗，請確認備份檔是否正確');
            }
          },
        },
      ]
    );
  };

  const handleSignOut = async () => {
    Alert.alert(
      '登出',
      '確定要登出嗎？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '登出',
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut();
          },
        },
      ]
    );
  };

  const handleSyncData = async () => {
    Alert.alert(
      '同步資料',
      '這將從網路更新所有股票與加密貨幣的最新價格',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '同步',
          onPress: async () => {
            setSaving(true);
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) return;

              const { data: assets } = await supabase
                .from('assets')
                .select('id, symbol, market_type, current_shares, currency, leverage, average_cost')
                .eq('user_id', user.id)
                .not('symbol', 'is', null);

              let updated = 0;
              for (const asset of (assets || [])) {
                if (!asset.symbol || asset.current_shares <= 0) continue;
                try {
                  let priceData = null;
                  if (asset.market_type === 'TW') {
                    priceData = await fetchTWStockPrice(asset.symbol);
                  } else if (asset.market_type === 'US') {
                    priceData = await fetchUSStockPrice(asset.symbol);
                  } else if (asset.market_type === 'Crypto') {
                    priceData = await fetchCryptoPrice(asset.symbol);
                  }

                  if (priceData?.price) {
                    const lev = asset.leverage || 1;
                    const borrowed = asset.current_shares * (asset.average_cost || 0) * (lev - 1) / lev;
                    const newAmount = priceData.price * asset.current_shares - borrowed;
                    await supabase
                      .from('assets')
                      .update({ current_amount: newAmount, updated_at: new Date().toISOString() })
                      .eq('id', asset.id);
                    updated++;
                  }
                } catch {
                  // skip assets that fail to fetch
                }
              }

              await supabase.rpc('create_daily_snapshot', { p_user_id: user.id });
              Alert.alert('同步完成', `已更新 ${updated} 項資產的最新價格`);
            } catch (error) {
              console.error('Sync error:', error);
              Alert.alert('錯誤', '同步失敗，請稍後再試');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* User Info */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSub }]}>帳號資訊</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.textSub }]}>電子郵件</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>
              {userEmail}
            </Text>
          </View>
        </View>
      </View>

      {/* Theme */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSub }]}>外觀主題</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {THEME_OPTIONS.map(({ id, label, Icon }, idx) => (
            <TouchableOpacity
              key={id}
              style={[styles.optionRow, { borderBottomColor: colors.borderLight }, idx === THEME_OPTIONS.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => setPreference(id)}
            >
              <View style={styles.optionContent}>
                <Icon size={20} color={colors.textSub} />
                <Text style={[styles.optionText, { color: colors.text }]}>{label}</Text>
              </View>
              {preference === id && <View style={styles.selectedIndicator} />}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Currency Settings */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSub }]}>基準貨幣</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {CURRENCIES.map((currency) => (
            <TouchableOpacity
              key={currency.code}
              style={[styles.optionRow, { borderBottomColor: colors.borderLight }]}
              onPress={() => updateProfile({ base_currency: currency.code })}
              disabled={saving}
            >
              <View style={styles.optionContent}>
                <Globe size={20} color={colors.textSub} />
                <Text style={[styles.optionText, { color: colors.text }]}>{currency.name}</Text>
              </View>
              {profile?.base_currency === currency.code && (
                <View style={styles.selectedIndicator} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>

{/* Actions */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSub }]}>操作</Text>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <TouchableOpacity
            style={[styles.actionRow, { borderBottomColor: colors.borderLight }]}
            onPress={handleSyncData}
          >
            <View style={styles.optionContent}>
              <RefreshCw size={20} color="#2563eb" />
              <Text style={[styles.optionText, styles.actionText]}>立即同步資料</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionRow, { borderBottomColor: colors.borderLight }]}
            onPress={handleExportCSV}
          >
            <View style={styles.optionContent}>
              <Download size={20} color="#16a34a" />
              <Text style={[styles.optionText, { color: '#16a34a', fontWeight: '500' }]}>匯出 CSV</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionRow, { borderBottomColor: colors.borderLight }]}
            onPress={handleBackupToCloud}
          >
            <View style={styles.optionContent}>
              <CloudUpload size={20} color="#16a34a" />
              <Text style={[styles.optionText, { color: '#16a34a', fontWeight: '500' }]}>備份到 iCloud</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionRow, { borderBottomColor: colors.borderLight }]}
            onPress={handleRestoreBackup}
          >
            <View style={styles.optionContent}>
              <Upload size={20} color="#f59e0b" />
              <Text style={[styles.optionText, { color: '#f59e0b', fontWeight: '500' }]}>還原備份</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionRow, { borderBottomWidth: 0 }]}
            onPress={handleSignOut}
          >
            <View style={styles.optionContent}>
              <LogOut size={20} color="#ef4444" />
              <Text style={[styles.optionText, styles.dangerText]}>登出</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* App Info */}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textMuted }]}>WealthTracker v1.0.0</Text>
        <Text style={[styles.footerSubtext, { color: colors.textMuted }]}>
          個人資產管理系統
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  infoLabel: {
    fontSize: 16,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '500',
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  optionText: {
    fontSize: 16,
  },
  selectedIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563eb',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  actionText: {
    color: '#2563eb',
    fontWeight: '500',
  },
  dangerText: {
    color: '#ef4444',
    fontWeight: '500',
  },
  footer: {
    alignItems: 'center',
    padding: 32,
  },
  footerText: {
    fontSize: 14,
    marginBottom: 4,
  },
  footerSubtext: {
    fontSize: 12,
  },
});
