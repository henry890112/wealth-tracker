import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { LogOut, Globe, Palette, RefreshCw } from 'lucide-react-native';
import { supabase } from '../lib/supabase';

const CURRENCIES = [
  { code: 'TWD', name: '新台幣 (TWD)' },
  { code: 'USD', name: '美元 (USD)' },
  { code: 'EUR', name: '歐元 (EUR)' },
  { code: 'JPY', name: '日圓 (JPY)' },
  { code: 'CNY', name: '人民幣 (CNY)' },
];

const COLOR_CONVENTIONS = [
  { id: 'red_down_green_up', name: '紅跌綠漲 (亞洲)' },
  { id: 'green_down_red_up', name: '綠跌紅漲 (歐美)' },
];

export default function SettingsScreen() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

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
      '這將更新所有資產的最新價格',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '同步',
          onPress: async () => {
            // This would trigger a full data sync
            Alert.alert('提示', '資料同步功能將在後續版本實作');
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* User Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>帳號資訊</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>電子郵件</Text>
            <Text style={styles.infoValue}>
              {profile?.id ? '已登入' : '未登入'}
            </Text>
          </View>
        </View>
      </View>

      {/* Currency Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>基準貨幣</Text>
        <View style={styles.card}>
          {CURRENCIES.map((currency) => (
            <TouchableOpacity
              key={currency.code}
              style={styles.optionRow}
              onPress={() => updateProfile({ base_currency: currency.code })}
              disabled={saving}
            >
              <View style={styles.optionContent}>
                <Globe size={20} color="#64748b" />
                <Text style={styles.optionText}>{currency.name}</Text>
              </View>
              {profile?.base_currency === currency.code && (
                <View style={styles.selectedIndicator} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Color Convention */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>漲跌顏色習慣</Text>
        <View style={styles.card}>
          {COLOR_CONVENTIONS.map((convention) => (
            <TouchableOpacity
              key={convention.id}
              style={styles.optionRow}
              onPress={() => updateProfile({ color_convention: convention.id })}
              disabled={saving}
            >
              <View style={styles.optionContent}>
                <Palette size={20} color="#64748b" />
                <Text style={styles.optionText}>{convention.name}</Text>
              </View>
              {profile?.color_convention === convention.id && (
                <View style={styles.selectedIndicator} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>操作</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleSyncData}
          >
            <View style={styles.optionContent}>
              <RefreshCw size={20} color="#2563eb" />
              <Text style={[styles.optionText, styles.actionText]}>
                立即同步資料
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleSignOut}
          >
            <View style={styles.optionContent}>
              <LogOut size={20} color="#ef4444" />
              <Text style={[styles.optionText, styles.dangerText]}>
                登出
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* App Info */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>WealthTracker v1.0.0</Text>
        <Text style={styles.footerSubtext}>
          個人資產管理系統
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: 'white',
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
    color: '#64748b',
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1e293b',
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  optionText: {
    fontSize: 16,
    color: '#1e293b',
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
    borderBottomColor: '#f1f5f9',
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
    color: '#94a3b8',
    marginBottom: 4,
  },
  footerSubtext: {
    fontSize: 12,
    color: '#cbd5e1',
  },
});
