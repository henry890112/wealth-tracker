import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search as SearchIcon, Plus, X, Flame, LineChart } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import {
  searchAssets,
  HOT_ASSETS,
  fetchTWStockPrice,
  fetchUSStockPrice,
} from '../services/api';
import { useTheme } from '../lib/ThemeContext';

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

const MARKET_TYPE_LABELS = { TW: '台股', US: '美股', Crypto: '虛幣' };

const CRYPTO_ID_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
};

const getTVSymbol = (asset) => {
  if (asset.market_type === 'TW') return `TWSE:${asset.symbol}`;
  if (asset.market_type === 'Crypto') {
    const map = { BTC: 'BINANCE:BTCUSDT', ETH: 'BINANCE:ETHUSDT', SOL: 'BINANCE:SOLUSDT', BNB: 'BINANCE:BNBUSDT' };
    return map[asset.symbol] || `BINANCE:${asset.symbol}USDT`;
  }
  return asset.symbol;
};

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
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
  const [hotPrices, setHotPrices] = useState({});
  const [hotUpdatedAt, setHotUpdatedAt] = useState(null);
  const [sortBy, setSortBy] = useState('change');
  const [chartVisible, setChartVisible] = useState(false);
  const [chartAsset, setChartAsset] = useState(null);
  const debounceRef = useRef(null);
  const priceInputRef = useRef(null);

  useEffect(() => {
    loadHotPrices();
  }, []);

  const loadHotPrices = async () => {
    const prices = {};

    // TW stocks via FinMind
    const twAssets = HOT_ASSETS.filter(a => a.market_type === 'TW');
    const twResults = await Promise.allSettled(
      twAssets.map(async (asset) => {
        const data = await fetchTWStockPrice(asset.symbol);
        return { symbol: asset.symbol, data };
      })
    );
    twResults.forEach(r => {
      if (r.status === 'fulfilled' && r.value.data) prices[r.value.symbol] = r.value.data;
    });

    // US stocks via Yahoo Finance
    const usAssets = HOT_ASSETS.filter(a => a.market_type === 'US');
    const usResults = await Promise.allSettled(
      usAssets.map(async (asset) => {
        const data = await fetchUSStockPrice(asset.symbol);
        return { symbol: asset.symbol, data };
      })
    );
    usResults.forEach(r => {
      if (r.status === 'fulfilled' && r.value.data) prices[r.value.symbol] = r.value.data;
    });

    // Crypto via CoinGecko batch
    try {
      const cryptoAssets = HOT_ASSETS.filter(a => a.market_type === 'Crypto');
      const coinIds = cryptoAssets.map(a => CRYPTO_ID_MAP[a.symbol] || a.symbol.toLowerCase()).join(',');
      const resp = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`
      );
      const cryptoData = await resp.json();
      cryptoAssets.forEach(asset => {
        const coinId = CRYPTO_ID_MAP[asset.symbol] || asset.symbol.toLowerCase();
        if (cryptoData[coinId]) {
          prices[asset.symbol] = {
            price: cryptoData[coinId].usd,
            change_percent: cryptoData[coinId].usd_24h_change || 0,
            volume: cryptoData[coinId].usd_24h_vol || 0,
            market_type: 'Crypto',
          };
        }
      });
    } catch (e) {
      console.warn('Crypto batch fetch failed:', e.message);
    }

    setHotPrices(prices);
    setHotUpdatedAt(new Date());
  };

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, activeTab]);

  const handleSearch = async (q = query) => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      setResults(await searchAssets(q, activeTab));
    } catch {
      Alert.alert('錯誤', '搜尋失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  const hotAssets = useMemo(() => {
    const base = activeTab === 'all'
      ? HOT_ASSETS
      : HOT_ASSETS.filter(a => a.market_type === activeTab);
    if (Object.keys(hotPrices).length === 0) return base;
    return [...base].sort((a, b) => {
      const pa = hotPrices[a.symbol];
      const pb = hotPrices[b.symbol];
      if (!pa && !pb) return 0;
      if (!pa) return 1;
      if (!pb) return -1;
      if (sortBy === 'volume') return (pb.volume || 0) - (pa.volume || 0);
      return (pb.change_percent || 0) - (pa.change_percent || 0);
    });
  }, [activeTab, hotPrices, sortBy]);

  const handleSelectAsset = (asset) => {
    setSelectedAsset(asset);
    setModalVisible(true);
  };

  const handleShowChart = (asset) => {
    setChartAsset(asset);
    setChartVisible(true);
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

      let currency = 'TWD';
      if (selectedAsset.market_type === 'US') currency = 'USD';
      if (selectedAsset.market_type === 'Crypto') currency = 'USD';

      const { data: asset, error: assetError } = await supabase
        .from('assets')
        .insert({
          user_id: user.id,
          name: selectedAsset.name,
          symbol: selectedAsset.symbol,
          category,
          currency,
          current_amount: totalAmount,
          current_shares: sharesNum,
          average_cost: priceNum,
          market_type: selectedAsset.market_type || null,
        })
        .select()
        .single();
      if (assetError) throw assetError;

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
      Alert.alert('錯誤', error.message || '新增失敗');
    } finally {
      setAdding(false);
    }
  };

  const formatChange = (pct) => {
    if (pct == null) return null;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  };

  const formatPrice = (asset, priceData) => {
    if (!priceData?.price) return null;
    const p = priceData.price;
    if (asset.market_type === 'TW') return p.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const renderAssetCard = (asset, keyPrefix, index) => {
    const priceData = hotPrices[asset.symbol];
    const changePct = priceData?.change_percent;
    const isUp = changePct != null && changePct >= 0;
    const priceStr = formatPrice(asset, priceData);

    return (
      <TouchableOpacity
        key={`${keyPrefix}-${asset.symbol}-${index}`}
        style={[styles.resultCard, { backgroundColor: colors.card, borderBottomColor: colors.borderLight }]}
        onPress={() => handleSelectAsset(asset)}
      >
        <View style={styles.resultInfo}>
          <Text style={[styles.resultName, { color: colors.text }]}>{asset.name}</Text>
          <Text style={[styles.resultSymbol, { color: colors.textMuted }]}>
            {asset.symbol} · {MARKET_TYPE_LABELS[asset.market_type] ?? asset.market_type}
          </Text>
        </View>
        <View style={styles.resultRight}>
          <View style={styles.priceBlock}>
            {priceStr != null && <Text style={[styles.priceText, { color: colors.text }]}>{priceStr}</Text>}
            {changePct != null && (
              <Text style={[styles.changeText, isUp ? styles.changeUp : styles.changeDown]}>
                {formatChange(changePct)}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={styles.chartBtn}
            onPress={() => handleShowChart(asset)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <LineChart size={18} color={colors.textSub} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Search Bar */}
      <View style={[styles.searchContainer, { backgroundColor: colors.cardAlt }]}>
        <SearchIcon size={20} color={colors.textSub} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="搜尋股票代碼或名稱，例如：台積電、NVDA"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => handleSearch()}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { setQuery(''); setResults([]); }}>
            <X size={20} color={colors.textSub} />
          </TouchableOpacity>
        )}
      </View>

      {/* Market Tabs */}
      <View style={[styles.tabsContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {MARKET_TABS.map(tab => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, activeTab === tab.id && styles.activeTab]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Text style={[styles.tabText, { color: colors.textSub }, activeTab === tab.id && styles.activeTabText]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Results / Hot Assets */}
      <ScrollView
        style={styles.resultsContainer}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#2563eb" />
          </View>
        ) : query.length > 0 ? (
          results.length > 0
            ? results.map((asset, i) => renderAssetCard(asset, 'search', i))
            : <View style={styles.emptyState}><Text style={[styles.emptyStateText, { color: colors.textMuted }]}>無搜尋結果</Text></View>
        ) : (
          <>
            <View style={[styles.hotHeader, { backgroundColor: colors.hotBg, borderBottomColor: colors.hotBorder }]}>
              <Flame size={16} color="#f59e0b" />
              <View>
                <Text style={styles.hotHeaderText}>熱門標的</Text>
                {hotUpdatedAt && (
                  <Text style={styles.hotUpdatedText}>
                    更新 {hotUpdatedAt.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </Text>
                )}
              </View>
              <View style={styles.sortBtns}>
                <TouchableOpacity
                  style={[styles.sortBtn, sortBy === 'change' && styles.sortBtnActive]}
                  onPress={() => setSortBy('change')}
                >
                  <Text style={[styles.sortBtnText, sortBy === 'change' && styles.sortBtnTextActive]}>漲跌幅</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sortBtn, sortBy === 'volume' && styles.sortBtnActive]}
                  onPress={() => setSortBy('volume')}
                >
                  <Text style={[styles.sortBtnText, sortBy === 'volume' && styles.sortBtnTextActive]}>交易量</Text>
                </TouchableOpacity>
              </View>
            </View>
            {hotAssets.map((asset, i) => renderAssetCard(asset, 'hot', i))}
          </>
        )}
      </ScrollView>

      {/* Add Asset Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>新增資產</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <X size={24} color={colors.textSub} />
              </TouchableOpacity>
            </View>
            {selectedAsset && (
              <>
                <View style={[styles.assetInfo, { backgroundColor: colors.input }]}>
                  <Text style={[styles.assetInfoSymbol, { color: colors.text }]}>{selectedAsset.symbol}</Text>
                  <Text style={[styles.assetInfoName, { color: colors.textSub }]}>{selectedAsset.name}</Text>
                </View>
                <Text style={[styles.label, { color: colors.text }]}>分類</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
                  {CATEGORIES.map(cat => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.categoryChip, { backgroundColor: colors.cardAlt }, category === cat.id && styles.categoryChipActive]}
                      onPress={() => setCategory(cat.id)}
                    >
                      <Text style={[styles.categoryChipText, { color: colors.textSub }, category === cat.id && styles.categoryChipTextActive]}>
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={[styles.label, { color: colors.text }]}>股數</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.input, borderColor: colors.inputBorder, color: colors.text }]}
                  placeholder="輸入股數"
                  placeholderTextColor={colors.textMuted}
                  value={shares}
                  onChangeText={setShares}
                  keyboardType="decimal-pad"
                  returnKeyType="next"
                  onSubmitEditing={() => priceInputRef.current?.focus()}
                  blurOnSubmit={false}
                />
                <Text style={[styles.label, { color: colors.text }]}>價格</Text>
                <TextInput
                  ref={priceInputRef}
                  style={[styles.input, { backgroundColor: colors.input, borderColor: colors.inputBorder, color: colors.text }]}
                  placeholder="輸入價格"
                  placeholderTextColor={colors.textMuted}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
                {shares && price && (
                  <Text style={styles.totalText}>
                    總金額: {(parseFloat(shares) * parseFloat(price)).toFixed(2)}
                  </Text>
                )}
                <TouchableOpacity style={[styles.addButton, adding && styles.addButtonDisabled]} onPress={handleAddAsset} disabled={adding}>
                  <Plus size={20} color="white" />
                  <Text style={styles.addButtonText}>{adding ? '新增中...' : '新增資產'}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Chart Modal */}
      <Modal visible={chartVisible} animationType="slide" onRequestClose={() => setChartVisible(false)}>
        <View style={[styles.chartModalContainer, { backgroundColor: colors.card }]}>
          <View style={[styles.chartModalHeader, { paddingTop: insets.top + 12, borderBottomColor: colors.border }]}>
            <Text style={[styles.chartModalTitle, { color: colors.text }]}>
              {chartAsset?.name} ({chartAsset?.symbol})
            </Text>
            <TouchableOpacity onPress={() => setChartVisible(false)}>
              <X size={24} color={colors.textSub} />
            </TouchableOpacity>
          </View>
          {chartAsset && (
            <WebView
              style={{ flex: 1 }}
              source={{
                uri: `https://www.tradingview.com/widgetembed/?symbol=${encodeURIComponent(getTVSymbol(chartAsset))}&interval=D&theme=light&style=1&locale=zh_TW&autosize=1`,
              }}
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
              renderLoading={() => (
                <View style={[styles.chartLoading, { backgroundColor: colors.card }]}>
                  <ActivityIndicator size="large" color="#2563eb" />
                  <Text style={[styles.chartLoadingText, { color: colors.textSub }]}>載入圖表中...</Text>
                </View>
              )}
            />
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center',
    margin: 12, paddingHorizontal: 12,
    borderRadius: 10, gap: 8,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15 },
  tabsContainer: { borderBottomWidth: 1 },
  tab: { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#2563eb' },
  tabText: { fontSize: 14 },
  activeTabText: { color: '#2563eb', fontWeight: '600' },
  hotHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1,
  },
  hotHeaderText: { fontSize: 14, fontWeight: '600', color: '#b45309' },
  hotUpdatedText: { fontSize: 10, color: '#b45309', opacity: 0.7, marginTop: 1 },
  sortBtns: { flexDirection: 'row', marginLeft: 'auto', gap: 4 },
  sortBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: '#fef3c7' },
  sortBtnActive: { backgroundColor: '#f59e0b' },
  sortBtnText: { fontSize: 11, color: '#92400e', fontWeight: '500' },
  sortBtnTextActive: { color: 'white', fontWeight: '700' },
  resultsContainer: { flex: 1 },
  loadingContainer: { padding: 48, alignItems: 'center' },
  resultCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  resultSymbol: { fontSize: 12 },
  resultRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  priceBlock: { alignItems: 'flex-end' },
  priceText: { fontSize: 14, fontWeight: '600', marginBottom: 1 },
  changeText: { fontSize: 12, fontWeight: '600' },
  changeUp: { color: '#16a34a' },
  changeDown: { color: '#dc2626' },
  chartBtn: { padding: 4 },
  emptyState: { alignItems: 'center', justifyContent: 'center', padding: 48 },
  emptyStateText: { fontSize: 16 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 20, fontWeight: 'bold' },
  assetInfo: { padding: 16, borderRadius: 8, marginBottom: 24 },
  assetInfoSymbol: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  assetInfoName: { fontSize: 14 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  categoryScroll: { marginBottom: 16 },
  categoryChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, marginRight: 8 },
  categoryChipActive: { backgroundColor: '#2563eb' },
  categoryChipText: { fontSize: 14 },
  categoryChipTextActive: { color: 'white', fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 16 },
  totalText: { fontSize: 16, fontWeight: '600', color: '#2563eb', marginBottom: 16, textAlign: 'right' },
  addButton: { flexDirection: 'row', backgroundColor: '#2563eb', padding: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', gap: 8 },
  addButtonDisabled: { backgroundColor: '#94a3b8' },
  addButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  chartModalContainer: { flex: 1 },
  chartModalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1,
  },
  chartModalTitle: { fontSize: 16, fontWeight: '600' },
  chartLoading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  chartLoadingText: { marginTop: 12, fontSize: 14 },
});
