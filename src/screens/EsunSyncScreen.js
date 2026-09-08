import React, { useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Landmark, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { compareEsunHoldings, fetchEsunBalance, fetchEsunHoldings, saveEsunBridgeToken } from '../services/esunSync';
import { useTheme } from '../lib/ThemeContext';

export default function EsunSyncScreen({ navigation }) {
  const { colors } = useTheme();
  const PRIMARY = colors.accent;
  const insets = useSafeAreaInsets();
  const [syncing, setSyncing] = useState(false);
  const [holdings, setHoldings] = useState([]);
  const [balance, setBalance] = useState(null);
  const [loadError, setLoadError] = useState('');

  const formatMoney = (value) => new Intl.NumberFormat('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
  const totalCost = holdings.reduce((sum, item) => sum + (Math.abs(Number(item.costBasis)) || item.averageCost * item.quantity), 0);
  const totalValue = holdings.reduce((sum, item) => sum + item.marketValue, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost ? (totalPnl / totalCost) * 100 : 0;

  const applyHoldings = async (holdings, accountBalance) => {
    setSyncing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('未登入');
      const { data: assets, error: assetsError } = await supabase
        .from('assets')
        .select('id, name, symbol, category, currency, market_type, average_cost')
        .eq('user_id', user.id);
      if (assetsError) throw assetsError;

      const assetRows = assets || [];
      const changes = compareEsunHoldings(holdings, assetRows);
      let added = 0;
      let updated = 0;
      for (const item of changes) {
        const payload = {
          name: item.name,
          symbol: item.symbol,
          category: 'investment',
          currency: item.currency || 'TWD',
          market_type: 'TW',
          current_shares: item.quantity,
          // A missing broker cost must never overwrite a manually recorded
          // WealthTracker cost with zero. The bridge normally provides it.
          average_cost: Number(item.averageCost) > 0 ? item.averageCost : (item.existingAsset?.average_cost || 0),
          current_amount: item.marketValue,
          updated_at: new Date().toISOString(),
        };
        const result = item.existingAsset
          ? await supabase.from('assets').update(payload).eq('id', item.existingAsset.id).eq('user_id', user.id)
          : await supabase.from('assets').insert({ ...payload, user_id: user.id });
        if (result.error) throw result.error;
        item.existingAsset ? updated++ : added++;
      }
      let cashSynced = false;
      if (accountBalance) {
        const cashAsset = assetRows.find((asset) =>
          asset.symbol === 'ESUN-CASH-TWD' && asset.category === 'liquid' && asset.currency === 'TWD'
        );
        const cashPayload = {
          name: '玉山證券可用餘額',
          symbol: 'ESUN-CASH-TWD',
          category: 'liquid',
          currency: 'TWD',
          current_amount: Number(accountBalance.availableBalance) || 0,
          current_shares: 0,
          average_cost: 0,
          updated_at: new Date().toISOString(),
        };
        const cashResult = cashAsset
          ? await supabase.from('assets').update(cashPayload).eq('id', cashAsset.id).eq('user_id', user.id)
          : await supabase.from('assets').insert({ ...cashPayload, user_id: user.id });
        if (cashResult.error) throw cashResult.error;
        cashSynced = true;
      }
      await supabase.rpc('create_daily_snapshot', { p_user_id: user.id });
      await AsyncStorage.setItem('@wt_needs_refresh', '1');
      Alert.alert('同步完成', `已更新 ${updated} 筆，新增 ${added} 筆持倉。${cashSynced ? '玉山證券可用餘額已同步至流動資產。' : ''}`);
    } catch (error) {
      console.error('E.Sun sync error:', error);
      Alert.alert('玉山同步失敗', error.message || '請確認橋接服務已啟動');
    } finally {
      setSyncing(false);
    }
  };

  const previewSync = async () => {
    setSyncing(true);
    setLoadError('');
    try {
      const [holdings, balance] = await Promise.all([fetchEsunHoldings(), fetchEsunBalance()]);
      setHoldings(holdings);
      setBalance(balance);
      Alert.alert('玉山資料已更新', `已讀取 ${holdings.length} 筆玉山持倉與帳務餘額；可在下方查看目前損益。`);
    } catch (error) {
      console.error('E.Sun preview error:', error);
      const message = error.message || '請確認本機橋接服務已啟動';
      setLoadError(message);
      Alert.alert('無法讀取玉山持倉', message);
    } finally {
      setSyncing(false);
    }
  };

  const confirmSyncToApp = async () => {
    if (!holdings.length && !balance) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('未登入');
      const { data: assets, error } = await supabase.from('assets').select('id, name, symbol, category, currency, market_type, average_cost').eq('user_id', user.id);
      if (error) throw error;
      const assetRows = assets || [];
      const changes = compareEsunHoldings(holdings, assetRows);
      const added = changes.filter((item) => !item.existingAsset).length;
      const hasCashAsset = assetRows.some((asset) =>
        asset.symbol === 'ESUN-CASH-TWD' && asset.category === 'liquid' && asset.currency === 'TWD'
      );
      const cashMessage = balance
        ? `並${hasCashAsset ? '更新' : '新增'}「玉山證券可用餘額」${formatMoney(balance.availableBalance)} TWD 至流動資產。`
        : '';
      Alert.alert(
        '確認同步到 WealthTracker',
        `將更新 ${changes.length - added} 筆、新增 ${added} 筆投資資產；${cashMessage}玉山端不會被修改。`,
        [{ text: '取消', style: 'cancel' }, { text: '確認同步', onPress: () => applyHoldings(holdings, balance) }]
      );
    } catch (error) {
      Alert.alert('無法準備同步', error.message || '請稍後再試');
    }
  };

  const setBridgeToken = () => {
    if (Platform.OS !== 'ios') {
      Alert.alert('請在 iPhone 設定', '橋接安全碼會儲存在裝置安全儲存區，避免放入公開環境變數。');
      return;
    }
    Alert.prompt('設定橋接安全碼', '僅區網同步時需要；留空可移除。', [
      { text: '取消', style: 'cancel' },
      { text: '儲存', onPress: async (value) => {
        try {
          await saveEsunBridgeToken(value || '');
          Alert.alert('已儲存', value ? '安全碼已儲存在此裝置。' : '安全碼已移除。');
        } catch {
          Alert.alert('儲存失敗', '無法儲存橋接安全碼。');
        }
      } },
    ], 'secure-text');
  };

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.bg }]} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 48 }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.back, { backgroundColor: colors.card }]}><ArrowLeft size={21} color={colors.text} /></TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>玉山證券</Text>
      </View>

      <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.heroIcon, { backgroundColor: colors.accentSoft }]}><Landmark size={25} color={PRIMARY} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.heroTitle, { color: colors.text }]}>唯讀持倉同步</Text>
          <Text style={[styles.heroText, { color: colors.textSub }]}>讀取持倉、最新市值與未實現損益；不會送出或修改任何委託。</Text>
        </View>
      </View>

      <View style={[styles.notice, { backgroundColor: colors.cardAlt }]}>
        <ShieldCheck size={19} color={PRIMARY} />
        <Text style={[styles.noticeText, { color: colors.textSub }]}>同步前會先顯示新增與更新筆數；確認後才會寫入持倉與可用餘額。</Text>
      </View>

      <TouchableOpacity style={[styles.primaryButton, { backgroundColor: PRIMARY }, syncing && styles.disabled]} onPress={previewSync} disabled={syncing}>
        {syncing ? <ActivityIndicator color={colors.accentContrast} /> : <RefreshCw size={20} color={colors.accentContrast} />}
        <Text style={[styles.primaryText, { color: colors.accentContrast }]}>{syncing ? '讀取中…' : '更新庫存與餘額'}</Text>
      </TouchableOpacity>

      {!!loadError && <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>無法讀取玉山庫存</Text>
        <Text style={styles.errorText}>{loadError}</Text>
        <Text style={styles.errorHint}>請在 Mac 終端機執行：cd ~/WealthTracker/esun-bridge && npm start</Text>
      </View>}

      {!!balance && <View style={[styles.balanceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.balanceTitle, { color: colors.text }]}>玉山證券帳務</Text>
        <Text style={[styles.balanceSubtitle, { color: colors.textSub }]}>可用餘額可同步至流動資產；其餘欄位僅供參考</Text>
        <View style={styles.balanceGrid}>
          <View style={styles.balanceMetric}><Text style={[styles.metricLabel, { color: colors.textSub }]}>可用餘額</Text><Text style={[styles.balanceValue, { color: colors.text }]}>{formatMoney(balance.availableBalance)}</Text></View>
          <View style={styles.balanceMetric}><Text style={[styles.metricLabel, { color: colors.textSub }]}>交割餘額</Text><Text style={[styles.balanceValue, { color: colors.text }]}>{formatMoney(balance.exchangeBalance)}</Text></View>
          <View style={styles.balanceMetric}><Text style={[styles.metricLabel, { color: colors.textSub }]}>股票預收款</Text><Text style={[styles.balanceValue, { color: colors.text }]}>{formatMoney(balance.stockPreSaveAmount)}</Text></View>
        </View>
        <Text style={[styles.balanceCurrency, { color: colors.textMuted }]}>{balance.currency || 'TWD'}</Text>
      </View>}

      {holdings.length > 0 && <>
        <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.summaryLabel, { color: colors.textSub }]}>持倉未實現損益</Text>
          <Text style={[styles.summaryValue, { color: totalPnl >= 0 ? '#0DBD8B' : '#F03030' }]}>{totalPnl >= 0 ? '+' : ''}{formatMoney(totalPnl)} TWD</Text>
          <Text style={[styles.summaryRate, { color: totalPnl >= 0 ? '#0DBD8B' : '#F03030' }]}>{totalPnl >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%</Text>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryMeta}><Text style={[styles.metaText, { color: colors.textSub }]}>成本 {formatMoney(totalCost)}</Text><Text style={[styles.metaText, { color: colors.textSub }]}>市值 {formatMoney(totalValue)}</Text></View>
        </View>
        <Text style={[styles.listTitle, { color: colors.text }]}>目前庫存</Text>
        {holdings.map((item) => {
          const costBasis = Math.abs(Number(item.costBasis)) || item.averageCost * item.quantity;
          const pnl = item.marketValue - costBasis;
          const pnlPct = costBasis ? (pnl / costBasis) * 100 : 0;
          const positive = pnl >= 0;
          return <View key={item.symbol} style={[styles.holding, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.holdingTop}><View><Text style={[styles.holdingName, { color: colors.text }]}>{item.name}</Text><Text style={[styles.holdingSymbol, { color: colors.textMuted }]}>{item.symbol} · {formatMoney(item.quantity)} 股</Text></View><View style={styles.right}><Text style={[styles.holdingPnl, { color: positive ? '#0DBD8B' : '#F03030' }]}>{positive ? '+' : ''}{formatMoney(pnl)}</Text><Text style={[styles.holdingPct, { color: positive ? '#0DBD8B' : '#F03030' }]}>{positive ? '+' : ''}{pnlPct.toFixed(2)}%</Text></View></View>
            <View style={styles.holdingMetrics}>
              <View style={styles.holdingMetric}><Text style={[styles.metricLabel, { color: colors.textSub }]}>均價</Text><Text style={[styles.metricValue, { color: colors.text }]} numberOfLines={1}>{formatMoney(item.averageCost)}</Text></View>
              <View style={styles.holdingMetric}><Text style={[styles.metricLabel, { color: colors.textSub }]}>現價</Text><Text style={[styles.metricValue, { color: colors.text }]} numberOfLines={1}>{formatMoney(item.marketPrice)}</Text></View>
              <View style={styles.holdingMetric}><Text style={[styles.metricLabel, { color: colors.textSub }]}>成本</Text><Text style={[styles.metricValue, { color: colors.text }]} numberOfLines={1}>{formatMoney(costBasis)}</Text></View>
              <View style={styles.holdingMetric}><Text style={[styles.metricLabel, { color: colors.textSub }]}>市值</Text><Text style={[styles.metricValue, { color: colors.text }]} numberOfLines={1}>{formatMoney(item.marketValue)}</Text></View>
            </View>
          </View>;
        })}
      </>}

      {(holdings.length > 0 || balance) && <TouchableOpacity style={[styles.syncButton, { borderColor: PRIMARY }]} onPress={confirmSyncToApp} disabled={syncing}><Text style={[styles.syncButtonText, { color: PRIMARY }]}>確認同步至 WealthTracker</Text></TouchableOpacity>}

      <TouchableOpacity style={[styles.tokenRow, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={setBridgeToken}>
        <View style={[styles.tokenIcon, { backgroundColor: colors.cardAlt }]}><LockKeyhole size={19} color={colors.textMuted} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.tokenTitle, { color: colors.text }]}>設定橋接安全碼</Text>
          <Text style={[styles.tokenText, { color: colors.textSub }]}>僅在手機透過同 Wi‑Fi 連線時需要</Text>
        </View>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, marginBottom: 22 },
  back: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 23, fontWeight: '800' },
  hero: { marginHorizontal: 20, borderWidth: 1, borderRadius: 20, padding: 18, flexDirection: 'row', gap: 14, alignItems: 'center' },
  heroIcon: { width: 50, height: 50, borderRadius: 16, backgroundColor: '#0DBD8B18', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 17, fontWeight: '800', marginBottom: 4 },
  heroText: { fontSize: 13, lineHeight: 19 },
  notice: { marginHorizontal: 20, marginTop: 14, borderRadius: 14, padding: 14, flexDirection: 'row', gap: 10 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 19 },
  primaryButton: { marginHorizontal: 20, marginTop: 22, height: 52, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: '#0B1F3A', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.65 },
  balanceCard: { marginHorizontal: 20, marginTop: 18, borderRadius: 18, borderWidth: 1, padding: 16 },
  balanceTitle: { fontSize: 16, fontWeight: '800' },
  balanceSubtitle: { fontSize: 12, marginTop: 3 },
  balanceGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 15, rowGap: 14 },
  balanceMetric: { width: '50%', minWidth: 0 },
  balanceValue: { fontSize: 15, fontWeight: '800' },
  balanceCurrency: { fontSize: 11, marginTop: 12 },
  summary: { marginHorizontal: 20, marginTop: 18, borderRadius: 18, borderWidth: 1, padding: 16 },
  summaryLabel: { fontSize: 13, fontWeight: '600' },
  summaryValue: { fontSize: 27, fontWeight: '800', marginTop: 7 },
  summaryRate: { fontSize: 13, fontWeight: '700', marginTop: 3 },
  summaryDivider: { height: StyleSheet.hairlineWidth, marginVertical: 13 },
  summaryMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  metaText: { fontSize: 12 },
  listTitle: { fontSize: 17, fontWeight: '800', marginHorizontal: 20, marginTop: 24, marginBottom: 9 },
  holding: { marginHorizontal: 20, marginBottom: 10, borderWidth: 1, borderRadius: 16, padding: 14 },
  holdingTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  holdingName: { fontSize: 16, fontWeight: '800' },
  holdingSymbol: { fontSize: 12, marginTop: 3 },
  right: { alignItems: 'flex-end' },
  holdingPnl: { fontSize: 16, fontWeight: '800' },
  holdingPct: { fontSize: 12, fontWeight: '700', marginTop: 3 },
  holdingMetrics: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 13, rowGap: 10 },
  holdingMetric: { width: '50%', minWidth: 0 },
  metricLabel: { fontSize: 11, marginBottom: 2 },
  metricValue: { fontSize: 12, fontWeight: '700' },
  syncButton: { height: 48, marginHorizontal: 20, marginTop: 4, borderRadius: 14, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  syncButtonText: { color: '#0DBD8B', fontSize: 15, fontWeight: '800' },
  errorBox: { marginHorizontal: 20, marginTop: 12, backgroundColor: '#F0303018', borderWidth: 1, borderColor: '#F0303040', borderRadius: 14, padding: 13 },
  errorTitle: { color: '#F07070', fontSize: 14, fontWeight: '800', marginBottom: 4 },
  errorText: { color: '#F1B4B4', fontSize: 13, lineHeight: 18 },
  errorHint: { color: '#E6C7C7', fontSize: 12, lineHeight: 17, marginTop: 8 },
  tokenRow: { marginHorizontal: 20, marginTop: 14, borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  tokenIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#64748B18', alignItems: 'center', justifyContent: 'center' },
  tokenTitle: { fontSize: 15, fontWeight: '700', marginBottom: 3 },
  tokenText: { fontSize: 12 },
});
