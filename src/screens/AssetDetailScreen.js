import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TouchableOpacity,
  Modal,
  TextInput,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Trash2, Plus } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { convertToBaseCurrency } from '../services/api';

const CATEGORY_LABELS = {
  liquid: '流動資產',
  investment: '投資資產',
  fixed: '固定資產',
  receivable: '應收帳款',
  liability: '負債',
};

const TRANSACTION_TYPE_COLORS = {
  BUY: '#10b981',
  SELL: '#ef4444',
  ADJUST: '#f59e0b',
};

const TRANSACTION_TYPES = [
  { id: 'BUY', label: '買入' },
  { id: 'SELL', label: '賣出' },
  { id: 'ADJUST', label: '調整' },
];

export default function AssetDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { assetId } = route.params;

  const [asset, setAsset] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Add transaction modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [txType, setTxType] = useState('BUY');
  const [txShares, setTxShares] = useState('');
  const [txPrice, setTxPrice] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    loadAssetDetails();
  }, [assetId]);

  const loadAssetDetails = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('base_currency')
        .eq('id', user.id)
        .single();
      setProfile(profileData);

      const { data: assetData, error: assetError } = await supabase
        .from('assets')
        .select('*')
        .eq('id', assetId)
        .eq('user_id', user.id)
        .single();

      if (assetError) throw assetError;

      const baseCurrency = profileData?.base_currency || 'TWD';
      const convertedAmount = await convertToBaseCurrency(
        parseFloat(assetData.current_amount),
        assetData.currency,
        baseCurrency
      );
      setAsset({ ...assetData, converted_amount: convertedAmount });

      const { data: transactionsData, error: transactionsError } = await supabase
        .from('transactions')
        .select('*')
        .eq('asset_id', assetId)
        .order('trans_date', { ascending: false });

      if (transactionsError) throw transactionsError;
      setTransactions(transactionsData);

    } catch (error) {
      console.error('Error loading asset details:', error);
      Alert.alert('錯誤', '載入資產詳情失敗');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadAssetDetails();
  };

  const handleDelete = () => {
    Alert.alert(
      '刪除資產',
      `確定要刪除「${asset?.name}」嗎？此操作無法復原，所有交易記錄也將一併刪除。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('assets')
                .delete()
                .eq('id', assetId);
              if (error) throw error;
              navigation.goBack();
            } catch (error) {
              console.error('Delete error:', error);
              Alert.alert('錯誤', '刪除失敗');
            }
          },
        },
      ]
    );
  };

  const handleAddTransaction = async () => {
    if (!txShares || !txPrice) {
      Alert.alert('錯誤', '請輸入股數和價格');
      return;
    }

    setAdding(true);
    try {
      const sharesNum = parseFloat(txShares);
      const priceNum = parseFloat(txPrice);
      const totalAmount = sharesNum * priceNum;

      const { error } = await supabase
        .from('transactions')
        .insert({
          asset_id: assetId,
          type: txType,
          shares: sharesNum,
          price: priceNum,
          total_amount: totalAmount,
          trans_date: new Date().toISOString(),
        });

      if (error) throw error;

      setModalVisible(false);
      setTxShares('');
      setTxPrice('');
      setTxType('BUY');
      await loadAssetDetails();
      Alert.alert('成功', '交易記錄已新增');
    } catch (error) {
      console.error('Add transaction error:', error);
      Alert.alert('錯誤', error.message || '新增失敗');
    } finally {
      setAdding(false);
    }
  };

  const formatCurrency = (amount, currencyCode = null) => {
    const displayCurrency = currencyCode || profile?.base_currency || 'TWD';
    return `${displayCurrency} ${amount.toLocaleString('zh-TW', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!asset) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyStateText}>資產不存在或無法載入</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Asset Summary Card */}
        <View style={styles.assetSummaryCard}>
          <Text style={styles.assetName}>{asset.name}</Text>
          {asset.symbol && <Text style={styles.assetSymbol}>{asset.symbol}</Text>}
          <View style={styles.assetValueRow}>
            <Text style={styles.assetValueLabel}>當前價值</Text>
            <Text style={styles.assetValue}>
              {formatCurrency(asset.converted_amount)}
            </Text>
          </View>
          {asset.current_shares > 0 && (
            <View style={styles.assetDetailRow}>
              <Text style={styles.assetDetailLabel}>持有股數</Text>
              <Text style={styles.assetDetailValue}>
                {asset.current_shares.toLocaleString()} 股
              </Text>
            </View>
          )}
          {asset.average_cost > 0 && (
            <View style={styles.assetDetailRow}>
              <Text style={styles.assetDetailLabel}>平均成本</Text>
              <Text style={styles.assetDetailValue}>
                {formatCurrency(asset.average_cost, asset.currency)}
              </Text>
            </View>
          )}
          <View style={styles.assetDetailRow}>
            <Text style={styles.assetDetailLabel}>分類</Text>
            <Text style={styles.assetDetailValue}>
              {CATEGORY_LABELS[asset.category]}
            </Text>
          </View>
          <View style={styles.assetDetailRow}>
            <Text style={styles.assetDetailLabel}>原始幣別</Text>
            <Text style={styles.assetDetailValue}>{asset.currency}</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.addTxButton}
            onPress={() => setModalVisible(true)}
          >
            <Plus size={18} color="white" />
            <Text style={styles.addTxButtonText}>新增交易</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
            <Trash2 size={18} color="#ef4444" />
            <Text style={styles.deleteButtonText}>刪除資產</Text>
          </TouchableOpacity>
        </View>

        {/* Transaction History */}
        <View style={styles.transactionsSection}>
          <Text style={styles.transactionsTitle}>交易歷史</Text>
          {transactions.length > 0 ? (
            transactions.map((transaction) => (
              <View key={transaction.id} style={styles.transactionCard}>
                <View style={styles.transactionHeader}>
                  <Text
                    style={[
                      styles.transactionType,
                      { color: TRANSACTION_TYPE_COLORS[transaction.type] },
                    ]}
                  >
                    {transaction.type === 'BUY' ? '買入' : transaction.type === 'SELL' ? '賣出' : '調整'}
                  </Text>
                  <Text style={styles.transactionDate}>
                    {new Date(transaction.trans_date).toLocaleDateString('zh-TW')}
                  </Text>
                </View>
                <View style={styles.transactionDetails}>
                  <Text style={styles.transactionText}>
                    股數: {transaction.shares.toLocaleString()}
                  </Text>
                  <Text style={styles.transactionText}>
                    價格: {formatCurrency(transaction.price, asset.currency)}
                  </Text>
                  <Text style={styles.transactionAmount}>
                    {formatCurrency(transaction.total_amount, asset.currency)}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyStateTransfers}>
              <Text style={styles.emptyStateText}>尚無交易記錄</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Add Transaction Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>新增交易記錄</Text>

            <Text style={styles.label}>交易類型</Text>
            <View style={styles.typeRow}>
              {TRANSACTION_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={[
                    styles.typeChip,
                    txType === t.id && styles.typeChipActive,
                    txType === t.id && { backgroundColor: TRANSACTION_TYPE_COLORS[t.id] },
                  ]}
                  onPress={() => setTxType(t.id)}
                >
                  <Text
                    style={[
                      styles.typeChipText,
                      txType === t.id && styles.typeChipTextActive,
                    ]}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>股數</Text>
            <TextInput
              style={styles.input}
              placeholder="輸入股數"
              value={txShares}
              onChangeText={setTxShares}
              keyboardType="decimal-pad"
            />

            <Text style={styles.label}>價格 ({asset.currency})</Text>
            <TextInput
              style={styles.input}
              placeholder="輸入價格"
              value={txPrice}
              onChangeText={setTxPrice}
              keyboardType="decimal-pad"
            />

            {txShares && txPrice && (
              <Text style={styles.totalText}>
                總金額: {asset.currency} {(parseFloat(txShares) * parseFloat(txPrice)).toFixed(2)}
              </Text>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setModalVisible(false);
                  setTxShares('');
                  setTxPrice('');
                  setTxType('BUY');
                }}
              >
                <Text style={styles.cancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, adding && styles.confirmButtonDisabled]}
                onPress={handleAddTransaction}
                disabled={adding}
              >
                <Text style={styles.confirmButtonText}>
                  {adding ? '新增中...' : '確認新增'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#64748b',
  },
  assetSummaryCard: {
    backgroundColor: 'white',
    margin: 16,
    padding: 24,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  assetName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 4,
  },
  assetSymbol: {
    fontSize: 16,
    color: '#64748b',
    marginBottom: 16,
  },
  assetValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 12,
  },
  assetValueLabel: {
    fontSize: 16,
    color: '#64748b',
  },
  assetValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  assetDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  assetDetailLabel: {
    fontSize: 14,
    color: '#64748b',
  },
  assetDetailValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1e293b',
  },
  actionRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 16,
    gap: 12,
  },
  addTxButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
    padding: 12,
    borderRadius: 8,
    gap: 6,
  },
  addTxButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  deleteButtonText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
  },
  transactionsSection: {
    marginHorizontal: 16,
    marginBottom: 32,
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    paddingVertical: 8,
  },
  transactionsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e293b',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  transactionCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  transactionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  transactionType: {
    fontSize: 14,
    fontWeight: '600',
  },
  transactionDate: {
    fontSize: 12,
    color: '#64748b',
  },
  transactionDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  transactionText: {
    fontSize: 12,
    color: '#64748b',
  },
  transactionAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
  },
  emptyStateTransfers: {
    padding: 24,
    alignItems: 'center',
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 8,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  typeChip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  typeChipActive: {},
  typeChipText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  typeChipTextActive: {
    color: 'white',
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  totalText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2563eb',
    marginBottom: 16,
    textAlign: 'right',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: '#94a3b8',
  },
  confirmButtonText: {
    fontSize: 16,
    color: 'white',
    fontWeight: '600',
  },
});
