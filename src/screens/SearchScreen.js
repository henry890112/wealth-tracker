import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
  RefreshControl,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search as SearchIcon, Plus, X, Flame, LineChart, Clock } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import {
  searchAssets,
  fetchTrendingAssets,
  fetchExchangeRate,
} from '../services/api';
import { useTheme } from '../lib/ThemeContext';

const MARKET_TABS = [
  { id: 'all', label: '全部' },
  { id: 'TW', label: '台股' },
  { id: 'US', label: '美股' },
  { id: 'Crypto', label: '虛幣' },
  { id: 'FX', label: '外幣' },
];

const CATEGORIES = [
  { id: 'liquid', label: '流動資產' },
  { id: 'investment', label: '投資資產' },
  { id: 'fixed', label: '固定資產' },
  { id: 'receivable', label: '應收帳款' },
  { id: 'liability', label: '負債' },
];

const MARKET_TYPE_LABELS = { TW: '台股', US: '美股', Crypto: '虛幣' };

const INDEX_TV_MAP = {
  '^TWII':  'TVC:TWII',
  '^TWOII': 'TVC:TPEX',
  '^GSPC':  'SP:SPX',
  '^IXIC':  'NASDAQ:IXIC',
  '^DJI':   'TVC:DJI',
  '^RUT':   'TVC:RUT',
};

const getTVSymbol = (asset) => {
  if (INDEX_TV_MAP[asset.symbol]) return INDEX_TV_MAP[asset.symbol];
  if (asset.market_type === 'TW') return `TWSE:${asset.symbol}`;
  if (asset.market_type === 'Crypto') {
    const map = { BTC: 'BINANCE:BTCUSDT', ETH: 'BINANCE:ETHUSDT', SOL: 'BINANCE:SOLUSDT', BNB: 'BINANCE:BNBUSDT' };
    return map[asset.symbol] || `BINANCE:${asset.symbol}USDT`;
  }
  return asset.symbol;
};

const PRIMARY = '#16a34a';

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
  const [leverage, setLeverage] = useState('');
  const [adding, setAdding] = useState(false);
  const [hotAssetList, setHotAssetList] = useState([]);
  const [hotPrices, setHotPrices] = useState({});
  const [hotUpdatedAt, setHotUpdatedAt] = useState(null);
  const [hotLoading, setHotLoading] = useState(true);
  const [fxRates, setFxRates] = useState([]);
  const [baseCurrency, setBaseCurrency] = useState('TWD');
  const [fxModal, setFxModal] = useState(false);
  const [selectedFx, setSelectedFx] = useState(null);
  const [fxBaseAmount, setFxBaseAmount] = useState('');
  const [fxAdding, setFxAdding] = useState(false);
  const [sortBy, setSortBy] = useState('change_desc');
  const [chartVisible, setChartVisible] = useState(false);
  const [chartAsset, setChartAsset] = useState(null);
  const [recentSearches, setRecentSearches] = useState([]);
  const debounceRef = useRef(null);
  const priceInputRef = useRef(null);
  const leverageInputRef = useRef(null);

  useFocusEffect(useCallback(() => { loadHotPrices(); loadFxRates(); }, []));

  const FX_CURRENCIES = [
    { code: 'USD', name: '美元', flag: '🇺🇸' },
    { code: 'JPY', name: '日圓', flag: '🇯🇵' },
    { code: 'EUR', name: '歐元', flag: '🇪🇺' },
    { code: 'GBP', name: '英鎊', flag: '🇬🇧' },
    { code: 'CNY', name: '人民幣', flag: '🇨🇳' },
    { code: 'HKD', name: '港幣', flag: '🇭🇰' },
    { code: 'AUD', name: '澳幣', flag: '🇦🇺' },
    { code: 'SGD', name: '新幣', flag: '🇸🇬' },
    { code: 'KRW', name: '韓元', flag: '🇰🇷' },
  ];

  const loadFxRates = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = user
        ? await supabase.from('profiles').select('base_currency').eq('id', user.id).single()
        : { data: null };
      const base = profile?.base_currency || 'TWD';
      setBaseCurrency(base);

      const targets = FX_CURRENCIES.filter(c => c.code !== base);
      const rates = await Promise.all(
        targets.map(async (c) => {
          try {
            const rate = await fetchExchangeRate(base, c.code);
            return { ...c, rate };
          } catch {
            return { ...c, rate: null };
          }
        })
      );
      setFxRates(rates);
    } catch (e) {
      console.warn('loadFxRates error:', e.message);
    }
  };

  const openFxModal = (fx) => {
    setSelectedFx(fx);
    setFxBaseAmount('');
    setFxModal(true);
  };

  const handleFxRecord = async () => {
    const baseAmt = parseFloat(fxBaseAmount);
    if (!baseAmt || baseAmt <= 0) { Alert.alert('請輸入金額'); return; }
    if (!selectedFx?.rate) { Alert.alert('匯率資料不足'); return; }
    setFxAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('未登入');
      const foreignAmt = baseAmt * selectedFx.rate;
      const { data: asset, error } = await supabase.from('assets').insert({
        user_id: user.id,
        name: `${selectedFx.name}現金`,
        category: 'liquid',
        currency: selectedFx.code,
        current_amount: foreignAmt,
        current_shares: 0,
        average_cost: 0,
        leverage: 1,
      }).select().single();
      if (error) throw error;
      await supabase.from('transactions').insert({
        asset_id: asset.id,
        type: 'ADJUST',
        shares: 0,
        price: 0,
        total_amount: foreignAmt,
        trans_date: new Date().toISOString(),
      });
      await supabase.rpc('create_daily_snapshot', { p_user_id: user.id });
      setFxModal(false);
      Alert.alert('新增成功', `已記錄 ${Math.round(foreignAmt).toLocaleString()} ${selectedFx.code}（${baseCurrency} ${baseAmt.toLocaleString()}）`);
    } catch (e) {
      Alert.alert('錯誤', e.message);
    } finally {
      setFxAdding(false);
    }
  };

  const loadHotPrices = async () => {
    setHotLoading(true);
    try {
      const { assets, prices } = await fetchTrendingAssets();
      setHotAssetList(assets);
      setHotPrices(prices);
      setHotUpdatedAt(new Date());
    } catch (e) {
      console.warn('loadHotPrices error:', e.message);
    } finally {
      setHotLoading(false);
    }
  };

  useEffect(() => {
    AsyncStorage.getItem('recent_searches').then(val => {
      if (val) {
        try { setRecentSearches(JSON.parse(val)); } catch {}
      }
    });
  }, []);

  const saveRecentSearch = async (q) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    try {
      const existing = await AsyncStorage.getItem('recent_searches');
      const prev = existing ? JSON.parse(existing) : [];
      const updated = [trimmed, ...prev.filter(s => s !== trimmed)].slice(0, 8);
      setRecentSearches(updated);
      await AsyncStorage.setItem('recent_searches', JSON.stringify(updated));
    } catch (e) {
      console.warn('saveRecentSearch error:', e);
    }
  };

  const clearRecentSearches = async () => {
    try {
      setRecentSearches([]);
      await AsyncStorage.removeItem('recent_searches');
    } catch (e) {
      console.warn('clearRecentSearches error:', e);
    }
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

  const indexAssets = useMemo(() => {
    if (activeTab === 'Crypto' || activeTab === 'FX') return [];
    return activeTab === 'all'
      ? hotAssetList.filter(a => a.isIndex)
      : hotAssetList.filter(a => a.isIndex && a.market_type === activeTab);
  }, [activeTab, hotAssetList]);

  const hotAssets = useMemo(() => {
    const base = activeTab === 'all'
      ? hotAssetList.filter(a => !a.isIndex)
      : hotAssetList.filter(a => !a.isIndex && a.market_type === activeTab);
    if (Object.keys(hotPrices).length === 0) return base;
    return [...base].sort((a, b) => {
      const pa = hotPrices[a.symbol];
      const pb = hotPrices[b.symbol];
      if (!pa && !pb) return 0;
      if (!pa) return 1;
      if (!pb) return -1;
      if (sortBy === 'volume')      return (pb.volume || 0) - (pa.volume || 0);
      if (sortBy === 'market_cap')  return (pb.market_cap || 0) - (pa.market_cap || 0);
      if (sortBy === 'change_asc')  return (pa.change_percent || 0) - (pb.change_percent || 0);
      return (pb.change_percent || 0) - (pa.change_percent || 0); // change_desc
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
      const leverageNum = parseFloat(leverage) || 1;
      const totalAmount = sharesNum * priceNum / leverageNum;

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
          leverage: leverageNum,
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
      setLeverage('');
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

  const formatMarketCap = (cap) => {
    if (!cap) return null;
    if (cap >= 1e12) return `${(cap / 1e12).toFixed(2)}T`;
    if (cap >= 1e9)  return `${(cap / 1e9).toFixed(2)}B`;
    if (cap >= 1e6)  return `${(cap / 1e6).toFixed(2)}M`;
    return cap.toLocaleString();
  };

  const renderAssetCard = (asset, keyPrefix, index) => {
    const priceData = hotPrices[asset.symbol];
    const changePct = priceData?.change_percent;
    const isUp = changePct != null && changePct >= 0;
    const priceStr = formatPrice(asset, priceData);
    const mcap = priceData?.market_cap ? formatMarketCap(priceData.market_cap) : null;
    const high24 = priceData?.high_24h;
    const low24  = priceData?.low_24h;
    const amplitude = (high24 && low24 && low24 > 0)
      ? `${(((high24 - low24) / low24) * 100).toFixed(1)}%`
      : null;

    return (
      <TouchableOpacity
        key={`${keyPrefix}-${asset.symbol}-${index}`}
        style={[styles.resultCard, { backgroundColor: colors.card, borderBottomColor: colors.borderLight }]}
        onPress={() => asset.isIndex ? handleShowChart(asset) : handleSelectAsset(asset)}
      >
        <View style={styles.resultInfo}>
          <Text style={[styles.resultName, { color: colors.text }]}>{asset.name}</Text>
          <View style={styles.metaRow}>
            <Text style={[styles.resultSymbol, { color: colors.textMuted }]}>
              {asset.symbol} · {MARKET_TYPE_LABELS[asset.market_type] ?? asset.market_type}
            </Text>
            {mcap && <Text style={[styles.mcapText, { color: colors.textMuted }]}>市值 {mcap}</Text>}
            {amplitude && <Text style={[styles.amplitudeText, { color: colors.textMuted }]}>振幅 {amplitude}</Text>}
          </View>
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
          {!asset.isIndex && (
            <TouchableOpacity
              style={styles.chartBtn}
              onPress={() => handleShowChart(asset)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <LineChart size={18} color={colors.textSub} />
            </TouchableOpacity>
          )}
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
          onSubmitEditing={() => { saveRecentSearch(query); handleSearch(); }}
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
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          query.length === 0 ? (
            <RefreshControl
              refreshing={hotLoading}
              onRefresh={loadHotPrices}
              tintColor="#f59e0b"
            />
          ) : undefined
        }
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#2563eb" />
          </View>
        ) : query.length > 0 ? (
          results.length > 0
            ? results.map((asset, i) => renderAssetCard(asset, 'search', i))
            : <View style={styles.emptyState}><Text style={[styles.emptyStateText, { color: colors.textMuted }]}>無搜尋結果</Text></View>
        ) : activeTab === 'FX' ? (
          <View style={[styles.fxGrid, { backgroundColor: colors.card }]}>
            {fxRates.length === 0
              ? <ActivityIndicator style={{ padding: 32 }} color={PRIMARY} />
              : fxRates.map((fx, i) => (
                <View
                  key={fx.code}
                  style={[styles.fxItem, { borderBottomColor: colors.borderLight },
                    i === fxRates.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <Text style={styles.fxFlag}>{fx.flag}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fxCode, { color: colors.text }]}>{fx.name}（{fx.code}）</Text>
                    <Text style={[styles.fxName, { color: colors.textMuted }]}>
                      {fx.rate != null
                        ? `1 ${baseCurrency} = ${fx.rate >= 1 ? fx.rate.toFixed(2) : fx.rate.toFixed(4)} ${fx.code}`
                        : '匯率載入中...'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.fxBuyBtn, { backgroundColor: PRIMARY }]}
                    onPress={() => openFxModal(fx)}
                  >
                    <Text style={{ color: 'white', fontSize: 12, fontWeight: '700' }}>記錄</Text>
                  </TouchableOpacity>
                </View>
              ))
            }
          </View>
        ) : (
          <>
            {recentSearches.length > 0 && (
              <>
                <View style={[styles.recentHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                  <Clock size={15} color={colors.textSub} />
                  <Text style={[styles.recentHeaderText, { color: colors.textSub }]}>最近搜尋</Text>
                  <TouchableOpacity onPress={clearRecentSearches} style={styles.clearBtn}>
                    <Text style={[styles.clearBtnText, { color: colors.textMuted }]}>清除</Text>
                  </TouchableOpacity>
                </View>
                {recentSearches.map((item, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.recentItem, { backgroundColor: colors.card, borderBottomColor: colors.borderLight }]}
                    onPress={() => { setQuery(item); handleSearch(item); }}
                  >
                    <Clock size={14} color={colors.textMuted} />
                    <Text style={[styles.recentItemText, { color: colors.text }]}>{item}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
            {indexAssets.length > 0 && !hotLoading && (
              <>
                <View style={[styles.indexHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                  <LineChart size={16} color="#2563eb" />
                  <Text style={styles.indexHeaderText}>大盤指數</Text>
                </View>
                {indexAssets.map((asset, i) => renderAssetCard(asset, 'index', i))}
              </>
            )}
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
                  style={[styles.sortBtn, (sortBy === 'change_desc' || sortBy === 'change_asc') && styles.sortBtnActive]}
                  onPress={() => setSortBy(sortBy === 'change_desc' ? 'change_asc' : 'change_desc')}
                >
                  <Text style={[styles.sortBtnText, (sortBy === 'change_desc' || sortBy === 'change_asc') && styles.sortBtnTextActive]}>
                    {'漲跌幅 ' + (sortBy === 'change_asc' ? '↑' : '↓')}
                  </Text>
                </TouchableOpacity>
                {[
                  { key: 'volume',     label: '交易量' },
                  { key: 'market_cap', label: '市值' },
                ].map(opt => (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.sortBtn, sortBy === opt.key && styles.sortBtnActive]}
                    onPress={() => setSortBy(opt.key)}
                  >
                    <Text style={[styles.sortBtnText, sortBy === opt.key && styles.sortBtnTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {hotLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#f59e0b" />
              </View>
            ) : (
              hotAssets.map((asset, i) => renderAssetCard(asset, 'hot', i))
            )}
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
                <Text style={[styles.label, { color: colors.text }]}>持有股數／數量</Text>
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
                <Text style={[styles.label, { color: colors.text }]}>平均成本</Text>
                <TextInput
                  ref={priceInputRef}
                  style={[styles.input, { backgroundColor: colors.input, borderColor: colors.inputBorder, color: colors.text }]}
                  placeholder="輸入成本價格"
                  placeholderTextColor={colors.textMuted}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                  returnKeyType="next"
                  onSubmitEditing={() => leverageInputRef.current?.focus()}
                  blurOnSubmit={false}
                />
                <Text style={[styles.label, { color: colors.text }]}>槓桿倍數（預設 1x）</Text>
                <TextInput
                  ref={leverageInputRef}
                  style={[styles.input, { backgroundColor: colors.input, borderColor: colors.inputBorder, color: colors.text }]}
                  placeholder="1"
                  placeholderTextColor={colors.textMuted}
                  value={leverage}
                  onChangeText={setLeverage}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
                {shares && price && (
                  <Text style={styles.totalText}>
                    保證金：{(parseFloat(shares) * parseFloat(price) / (parseFloat(leverage) || 1)).toFixed(2)}
                    {parseFloat(leverage) > 1 ? `　合約價值：${(parseFloat(shares) * parseFloat(price)).toFixed(2)}` : ''}
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

      {/* FX Record Modal */}
      <Modal visible={fxModal} transparent animationType="slide" onRequestClose={() => setFxModal(false)}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {selectedFx?.flag} 記錄{selectedFx?.name}
                </Text>
                <TouchableOpacity onPress={() => setFxModal(false)}>
                  <X size={22} color={colors.textSub} />
                </TouchableOpacity>
              </View>
              {selectedFx?.rate && (
                <Text style={[styles.label, { color: colors.textMuted, marginBottom: 8 }]}>
                  匯率：1 {baseCurrency} = {selectedFx.rate >= 1 ? selectedFx.rate.toFixed(2) : selectedFx.rate.toFixed(4)} {selectedFx.code}
                </Text>
              )}
              <Text style={[styles.label, { color: colors.text }]}>支出金額（{baseCurrency}）</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, borderColor: colors.inputBorder, color: colors.text }]}
                placeholder={`輸入 ${baseCurrency} 金額`}
                placeholderTextColor={colors.textMuted}
                value={fxBaseAmount}
                onChangeText={setFxBaseAmount}
                keyboardType="decimal-pad"
                autoFocus
              />
              {fxBaseAmount && selectedFx?.rate && (
                <Text style={[styles.totalText, { color: PRIMARY }]}>
                  換得：{Math.round(parseFloat(fxBaseAmount) * selectedFx.rate).toLocaleString()} {selectedFx?.code}
                </Text>
              )}
              <TouchableOpacity
                style={[styles.addButton, fxAdding && styles.addButtonDisabled]}
                onPress={handleFxRecord}
                disabled={fxAdding}
              >
                <Text style={styles.addButtonText}>{fxAdding ? '記錄中...' : '新增到流動資產'}</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
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
  fxGrid: {
    marginHorizontal: 16, borderRadius: 12, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  fxItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 11, gap: 10,
    borderBottomWidth: 1,
  },
  fxFlag: { fontSize: 22 },
  fxCode: { fontSize: 14, fontWeight: '600' },
  fxName: { fontSize: 11, marginTop: 1 },
  fxRate: { fontSize: 15, fontWeight: '700', minWidth: 70, textAlign: 'right' },
  fxBuyBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },

  indexHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1,
  },
  indexHeaderText: { fontSize: 14, fontWeight: '600', color: '#2563eb' },
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
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  resultSymbol: { fontSize: 12 },
  mcapText: { fontSize: 11 },
  amplitudeText: { fontSize: 11 },
  resultRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  priceBlock: { alignItems: 'flex-end' },
  priceText: { fontSize: 14, fontWeight: '600', marginBottom: 1 },
  changeText: { fontSize: 12, fontWeight: '600' },
  changeUp: { color: '#16a34a' },
  changeDown: { color: '#dc2626' },
  chartBtn: { padding: 4 },
  recentHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1,
  },
  recentHeaderText: { fontSize: 13, fontWeight: '600' },
  clearBtn: { marginLeft: 'auto', paddingHorizontal: 4, paddingVertical: 2 },
  clearBtnText: { fontSize: 13 },
  recentItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1,
  },
  recentItemText: { fontSize: 15 },
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
