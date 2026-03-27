import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { Search as SearchIcon, Plus, X } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { searchAssets } from '../services/api';

const MARKET_TABS = [
  { id: 'all', label: '全部' },
  { id: 'TW', label: '台股' },
  { id: 'US', label: '美股' },
  { id: 'Crypto', label: '虛幣' },
];

const CATEGORIES = [
  { id: 'liquid', label: '流動資產' },
  { id: 'investment', label: '投資資產' },
  { id: 'fixed', label: '固定資產' },
  { id: 'receivable', label: '應收帳款' },
  { id: 'liability', label: '負債' },
];

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [category, setCategory] = useState('investment');
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [adding, setAdding] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    try {
      const searchResults = await searchAssets(query, activeTab);
      setResults(searchResults);
    } catch (error) {
      console.error('Search error:', error);
      Alert.alert('錯誤', '搜尋失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAsset = (asset) => {
    setSelectedAsset(asset);
    setModalVisible(true);
  };

  const handleAddAsset = async () => {
    if (!shares || !price) {
      Alert.alert('錯誤', '請輸入股數和價格');
      return;
    }

    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('未登入');

      const sharesNum = parseFloat(shares);
      const priceNum = parseFloat(price);
      const totalAmount = sharesNum * priceNum;

      // Determine currency based on market type
      let currency = 'TWD';
      if (selectedAsset.market_type === 'US') currency = 'USD';
      if (selectedAsset.market_type === 'Crypto') currency = 'USD';

      // Create asset
      const { data: asset, error: assetError } = await supabase
        .from('assets')
        .insert({
          user_id: user.id,
          name: selectedAsset.name,
          symbol: selectedAsset.symbol,
          category: category,
          currency: currency,
          current_amount: totalAmount,
          current_shares: sharesNum,
          average_cost: priceNum,
        })
        .select()
        .single();

      if (assetError) throw assetError;

      // Create initial transaction
      const { error: transError } = await supabase
        .from('transactions')
        .insert({
          asset_id: asset.id,
          type: 'BUY',
          shares: sharesNum,
          price: priceNum,
          total_amount: totalAmount,
          trans_date: new Date().toISOString(),
        });

      if (transError) throw transError;

      Alert.alert('成功', '資產已新增');
      setModalVisible(false);
      setSelectedAsset(null);
      setShares('');
      setPrice('');
      setQuery('');
      setResults([]);
    } catch (error) {
      console.error('Add asset error:', error);
      Alert.alert('錯誤', error.message || '新增失敗');
    } finally {
      setAdding(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <SearchIcon size={20} color="#64748b" />
          <TextInput
            style={styles.searchInput}
            placeholder="搜尋股票代碼或名稱"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <X size={20} color="#64748b" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={styles.searchButton}
          onPress={handleSearch}
          disabled={loading}
        >
          <Text style={styles.searchButtonText}>搜尋</Text>
        </TouchableOpacity>
      </View>

      {/* Market Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsContainer}
      >
        {MARKET_TABS.map(tab => (
          <TouchableOpacity
            key={tab.id}
            style={[
              styles.tab,
              activeTab === tab.id && styles.activeTab,
            ]}
            onPress={() => setActiveTab(tab.id)}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab.id && styles.activeTabText,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Results */}
      <ScrollView style={styles.resultsContainer}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#2563eb" />
          </View>
        ) : results.length > 0 ? (
          results.map((asset, index) => (
            <TouchableOpacity
              key={`${asset.symbol}-${index}`}
              style={styles.resultCard}
              onPress={() => handleSelectAsset(asset)}
            >
              <View style={styles.resultInfo}>
                <Text style={styles.resultSymbol}>{asset.symbol}</Text>
                <Text style={styles.resultName}>{asset.name}</Text>
              </View>
              <View style={styles.resultBadge}>
                <Text style={styles.resultBadgeText}>
                  {asset.market_type}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        ) : query.length > 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>無搜尋結果</Text>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <SearchIcon size={48} color="#cbd5e1" />
            <Text style={styles.emptyStateText}>輸入關鍵字開始搜尋</Text>
          </View>
        )}
      </ScrollView>

      {/* Add Asset Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>新增資產</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            {selectedAsset && (
              <>
                <View style={styles.assetInfo}>
                  <Text style={styles.assetInfoSymbol}>
                    {selectedAsset.symbol}
                  </Text>
                  <Text style={styles.assetInfoName}>
                    {selectedAsset.name}
                  </Text>
                </View>

                <Text style={styles.label}>分類</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.categoryScroll}
                >
                  {CATEGORIES.map(cat => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[
                        styles.categoryChip,
                        category === cat.id && styles.categoryChipActive,
                      ]}
                      onPress={() => setCategory(cat.id)}
                    >
                      <Text
                        style={[
                          styles.categoryChipText,
                          category === cat.id && styles.categoryChipTextActive,
                        ]}
                      >
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.label}>股數</Text>
                <TextInput
                  style={styles.input}
                  placeholder="輸入股數"
                  value={shares}
                  onChangeText={setShares}
                  keyboardType="decimal-pad"
                />

                <Text style={styles.label}>價格</Text>
                <TextInput
                  style={styles.input}
                  placeholder="輸入價格"
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                />

                {shares && price && (
                  <Text style={styles.totalText}>
                    總金額: {(parseFloat(shares) * parseFloat(price)).toFixed(2)}
                  </Text>
                )}

                <TouchableOpacity
                  style={[styles.addButton, adding && styles.addButtonDisabled]}
                  onPress={handleAddAsset}
                  disabled={adding}
                >
                  <Plus size={20} color="white" />
                  <Text style={styles.addButtonText}>
                    {adding ? '新增中...' : '新增資產'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  searchContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 8,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
  },
  searchButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: 'center',
  },
  searchButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  tabsContainer: {
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tab: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: '#2563eb',
  },
  tabText: {
    fontSize: 14,
    color: '#64748b',
  },
  activeTabText: {
    color: '#2563eb',
    fontWeight: '600',
  },
  resultsContainer: {
    flex: 1,
  },
  loadingContainer: {
    padding: 48,
    alignItems: 'center',
  },
  resultCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'white',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  resultInfo: {
    flex: 1,
  },
  resultSymbol: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
  },
  resultName: {
    fontSize: 14,
    color: '#64748b',
  },
  resultBadge: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  resultBadgeText: {
    fontSize: 12,
    color: '#2563eb',
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#94a3b8',
    marginTop: 16,
  },
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
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  assetInfo: {
    backgroundColor: '#f8fafc',
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
  },
  assetInfoSymbol: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 4,
  },
  assetInfoName: {
    fontSize: 14,
    color: '#64748b',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 8,
  },
  categoryScroll: {
    marginBottom: 16,
  },
  categoryChip: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    marginRight: 8,
  },
  categoryChipActive: {
    backgroundColor: '#2563eb',
  },
  categoryChipText: {
    fontSize: 14,
    color: '#64748b',
  },
  categoryChipTextActive: {
    color: 'white',
    fontWeight: '600',
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
  addButton: {
    flexDirection: 'row',
    backgroundColor: '#2563eb',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addButtonDisabled: {
    backgroundColor: '#94a3b8',
  },
  addButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
