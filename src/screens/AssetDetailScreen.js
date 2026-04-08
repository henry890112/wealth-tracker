import React, { useState, useEffect, useCallback } from 'react';
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
  Keyboard,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { Trash2, Plus, Edit2 } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { convertToBaseCurrency } from '../services/api';

const CATEGORY_LABELS = {
  liquid: '流動資產',
  investment: '投資資產',
  fixed: '固定資產',
  receivable: '應收帳款',
  liability: '負債',
};

const CATEGORIES = [
  { id: 'liquid', label: '流動資產' },
  { id: 'investment', label: '投資資產' },
  { id: 'fixed', label: '固定資產' },
  { id: 'receivable', label: '應收帳款' },
  { id: 'liability', label: '負債' },
];

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

const isTWStock = (asset) =>
  asset.market_type === 'TW' ||
  /taiwan/i.test(asset.market_type || '') ||
  /^\d+$/.test(asset.symbol || '');

const getTVSymbol = (asset) => {
  if (asset.market_type === 'Crypto') {
    const map = { BTC: 'BINANCE:BTCUSDT', ETH: 'BINANCE:ETHUSDT', SOL: 'BINANCE:SOLUSDT', BNB: 'BINANCE:BNBUSDT' };
    return map[asset.symbol] || `BINANCE:${asset.symbol}USDT`;
  }
  if (isTWStock(asset)) {
    return `TWSE:${asset.symbol}`;
  }
  return asset.symbol;
};

const getTradingViewHtml = (symbol) => `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#1a1a2e;">
<div class="tradingview-widget-container" style="height:400px;width:100%">
  <div id="tradingview_chart"></div>
  <script type="text/javascript" src="https://s3.tradingview.com/tv.js"></script>
  <script type="text/javascript">
  new TradingView.widget({
    "width": "100%",
    "height": 400,
    "symbol": "${symbol}",
    "interval": "D",
    "timezone": "Asia/Taipei",
    "theme": "dark",
    "style": "1",
    "locale": "zh_TW",
    "toolbar_bg": "#1a1a2e",
    "enable_publishing": false,
    "hide_top_toolbar": false,
    "save_image": false,
    "container_id": "tradingview_chart"
  });
  </script>
</div>
</body>
</html>`;

const fetchTWStockData = async (symbol) => {
  try {
    const startDate = new Date(Date.now() - 1095 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${startDate}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.data || json.data.length === 0) return null;
    return json.data
      .map(d => ({
        time: d.date,
        open: d.open,
        high: d.max,
        low: d.min,
        close: d.close,
      }))
      .filter(d => d.open && d.close);
  } catch (e) {
    return null;
  }
};

const getTWStockHtml = (symbol, data) => {
  const dataJson = JSON.stringify(data || []);
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1a1a2e; font-family: sans-serif; }
  #tooltip {
    position: absolute; top: 8px; left: 10px; z-index: 10;
    background: rgba(30,30,50,0.92); border: 1px solid #3a3a5e;
    border-radius: 6px; padding: 6px 10px; font-size: 11px; color: #d1d4dc;
    display: none; pointer-events: none; line-height: 1.6;
  }
  #tooltip .date { color: #aaa; font-size: 10px; margin-bottom: 2px; }
  #tooltip .up { color: #26a69a; }
  #tooltip .down { color: #ef5350; }
  #chartWrap { position: relative; }
  #chart { width: 100%; height: 320px; }
  #msg { color: #888; text-align: center; padding: 40px 20px; font-size: 14px; }
</style>
</head>
<body>
<div id="chartWrap">
  <div id="tooltip"></div>
  <div id="chart"></div>
</div>
<div id="msg" style="display:none">無資料</div>
<script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
<script>
const allData = ${dataJson};

if (allData.length > 0) {
  const chart = LightweightCharts.createChart(document.getElementById('chart'), {
    width: window.innerWidth,
    height: 320,
    layout: { background: { color: '#1a1a2e' }, textColor: '#d1d4dc' },
    grid: { vertLines: { color: '#2a2a3e' }, horzLines: { color: '#2a2a3e' } },
    timeScale: { borderColor: '#485c7b' },
    rightPriceScale: { borderColor: '#485c7b' },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });

  const series = chart.addCandlestickSeries({
    upColor: '#26a69a', downColor: '#ef5350',
    borderVisible: false,
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  });

  series.setData(allData);
  chart.timeScale().fitContent();

  const tooltip = document.getElementById('tooltip');
  chart.subscribeCrosshairMove(param => {
    if (!param.time || !param.seriesData || !param.seriesData.get(series)) {
      tooltip.style.display = 'none';
      return;
    }
    const d = param.seriesData.get(series);
    const isUp = d.close >= d.open;
    const color = isUp ? 'up' : 'down';
    tooltip.innerHTML =
      '<div class="date">' + param.time + '</div>' +
      '<span class="' + color + '">' +
      '開 ' + d.open.toFixed(2) + '　' +
      '高 ' + d.high.toFixed(2) + '　' +
      '低 ' + d.low.toFixed(2) + '　' +
      '收 ' + d.close.toFixed(2) +
      '</span>';
    tooltip.style.display = 'block';
  });

  window.addEventListener('resize', () => chart.applyOptions({ width: window.innerWidth }));
} else {
  document.getElementById('msg').style.display = 'block';
}
</script>
</body>
</html>`;
};

const todayString = () => new Date().toISOString().split('T')[0];

export default function AssetDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { assetId, allIds } = route.params;

  const [asset, setAsset] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [twChartData, setTwChartData] = useState(null);

  // Add transaction modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [txType, setTxType] = useState('BUY');
  const [txShares, setTxShares] = useState('');
  const [txPrice, setTxPrice] = useState('');
  const [txDate, setTxDate] = useState(todayString());
  const [adding, setAdding] = useState(false);

  // Edit asset modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editLeverage, setEditLeverage] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    loadAssetDetails();
  }, [assetId, allIds]);

  useEffect(() => {
    if (asset && isTWStock(asset) && asset.symbol) {
      fetchTWStockData(asset.symbol).then(data => setTwChartData(data));
    }
  }, [asset?.id]);

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

      const assetIds = allIds && allIds.length > 1 ? allIds : [assetId];

      // Fetch all merged assets to get accurate aggregated shares/cost
      const { data: allAssetsData, error: assetError } = await supabase
        .from('assets')
        .select('*')
        .in('id', assetIds)
        .eq('user_id', user.id);

      if (assetError) throw assetError;
      if (!allAssetsData || allAssetsData.length === 0) throw new Error('找不到資產');

      const primaryAsset = allAssetsData.find(a => a.id === assetId) || allAssetsData[0];
      const baseCurrency = profileData?.base_currency || 'TWD';

      // Aggregate converted amount across all merged assets
      let totalConverted = 0;
      for (const a of allAssetsData) {
        try {
          const c = await convertToBaseCurrency(parseFloat(a.current_amount), a.currency, baseCurrency);
          totalConverted += c;
        } catch {
          totalConverted += parseFloat(a.current_amount) || 0;
        }
      }

      // Aggregate shares and weighted average cost from DB values (maintained by trigger)
      const totalShares = allAssetsData.reduce((sum, a) => sum + (parseFloat(a.current_shares) || 0), 0);
      const weightedCost = allAssetsData.reduce((sum, a) => {
        const s = parseFloat(a.current_shares) || 0;
        const c = parseFloat(a.average_cost) || 0;
        return sum + s * c;
      }, 0);
      const avgCost = totalShares > 0 ? weightedCost / totalShares : 0;

      setAsset({
        ...primaryAsset,
        converted_amount: totalConverted,
        current_shares: totalShares,
        average_cost: avgCost,
      });

      const { data: transactionsData, error: transactionsError } = await supabase
        .from('transactions')
        .select('*')
        .in('asset_id', assetIds)
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

  const handleDeleteTransaction = (tx) => {
    Alert.alert(
      '刪除交易',
      `確定要刪除這筆${tx.type === 'BUY' ? '買入' : tx.type === 'SELL' ? '賣出' : '調整'}記錄嗎？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('transactions')
                .delete()
                .eq('id', tx.id);
              if (error) throw error;
              await loadAssetDetails();
            } catch (error) {
              console.error('Delete transaction error:', error);
              Alert.alert('錯誤', '刪除失敗');
            }
          },
        },
      ]
    );
  };

  const openEditModal = () => {
    setEditName(asset.name);
    setEditCategory(asset.category);
    setEditLeverage(String(asset.leverage || 1));
    setEditModalVisible(true);
  };

  const handleEditAsset = async () => {
    if (!editName.trim()) {
      Alert.alert('錯誤', '請輸入資產名稱');
      return;
    }
    setEditSaving(true);
    try {
      const { error } = await supabase
        .from('assets')
        .update({
          name: editName.trim(),
          category: editCategory,
          leverage: parseFloat(editLeverage) || 1,
        })
        .eq('id', assetId);
      if (error) throw error;
      setEditModalVisible(false);
      await loadAssetDetails();
    } catch (error) {
      console.error('Edit asset error:', error);
      Alert.alert('錯誤', error.message || '更新失敗');
    } finally {
      setEditSaving(false);
    }
  };

  const isInvestmentAsset = asset?.category === 'investment';

  const resetAddModal = () => {
    setTxShares('');
    setTxPrice('');
    setTxType('BUY');
    setTxDate(todayString());
  };

  const handleAddTransaction = async () => {
    if ((isInvestmentAsset && !txShares) || !txPrice) {
      Alert.alert('錯誤', isInvestmentAsset ? '請輸入股數和價格' : '請輸入價格');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(txDate) || isNaN(new Date(txDate).getTime())) {
      Alert.alert('錯誤', '請輸入正確日期格式 YYYY-MM-DD');
      return;
    }

    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('未登入');

      const leverageNum = parseFloat(asset.leverage) || 1;
      const sharesNum = isInvestmentAsset ? parseFloat(txShares) : 0;
      const priceNum = parseFloat(txPrice);
      // total_amount = 實際投入本金（與 AddAssetScreen / SearchScreen 一致）
      const totalAmount = isInvestmentAsset
        ? sharesNum * priceNum / leverageNum
        : priceNum;

      const { error } = await supabase
        .from('transactions')
        .insert({
          asset_id: assetId,
          type: txType,
          shares: sharesNum,
          price: isInvestmentAsset ? priceNum : 0,
          total_amount: totalAmount,
          trans_date: new Date(txDate).toISOString(),
        });

      if (error) throw error;

      // 非投資資產：trigger 不處理，手動更新 current_amount
      if (!isInvestmentAsset) {
        const currentAmount = parseFloat(asset.current_amount) || 0;
        let newAmount;
        if (txType === 'BUY')        newAmount = currentAmount + priceNum;
        else if (txType === 'SELL')  newAmount = Math.max(0, currentAmount - priceNum);
        else                         newAmount = priceNum; // ADJUST：直接設定
        await supabase
          .from('assets')
          .update({ current_amount: newAmount })
          .eq('id', assetId);
      }

      await supabase.rpc('create_daily_snapshot', { p_user_id: user.id });

      setModalVisible(false);
      resetAddModal();
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
        contentContainerStyle={{ paddingBottom: 80 }}
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
          {asset.category === 'investment' && asset.current_shares > 0 && asset.average_cost > 0 && (() => {
            const lev = asset.leverage || 1;
            const costBasis = asset.current_shares * asset.average_cost / lev;
            const pnl = asset.converted_amount - costBasis;
            const pnl_pct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
            const isUp = pnl >= 0;
            return (
              <View style={styles.assetDetailRow}>
                <Text style={styles.assetDetailLabel}>當前損益</Text>
                <Text style={[styles.assetDetailValue, { color: isUp ? '#16a34a' : '#ef4444', fontWeight: '700' }]}>
                  {isUp ? '+' : ''}{profile?.base_currency || 'TWD'} {Math.round(pnl).toLocaleString('zh-TW')}
                  {'  '}({isUp ? '+' : ''}{pnl_pct.toFixed(2)}%)
                </Text>
              </View>
            );
          })()}
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
          {asset.leverage > 1 && (
            <View style={styles.assetDetailRow}>
              <Text style={styles.assetDetailLabel}>槓桿</Text>
              <Text style={styles.assetDetailValue}>{asset.leverage}x</Text>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.addTxButton}
            onPress={() => { resetAddModal(); setModalVisible(true); }}
          >
            <Plus size={18} color="white" />
            <Text style={styles.addTxButtonText}>新增交易</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.editButton} onPress={openEditModal}>
            <Edit2 size={18} color="#2563eb" />
            <Text style={styles.editButtonText}>編輯</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
            <Trash2 size={18} color="#ef4444" />
            <Text style={styles.deleteButtonText}>刪除</Text>
          </TouchableOpacity>
        </View>

        {/* Technical Chart (investment assets only) */}
        {isInvestmentAsset && asset.symbol && asset.market_type && (
          <View style={styles.chartSection}>
            <Text style={styles.chartTitle}>技術圖表</Text>
            <WebView
              style={[styles.chartWebView, isTWStock(asset) && { height: 300 }]}
              source={{ html: isTWStock(asset) ? getTWStockHtml(asset.symbol, twChartData) : getTradingViewHtml(getTVSymbol(asset)) }}
              javaScriptEnabled={true}
              domStorageEnabled
              startInLoadingState
              originWhitelist={['*']}
              renderLoading={() => (
                <View style={styles.chartLoading}>
                  <ActivityIndicator size="small" color="#2563eb" />
                  <Text style={styles.chartLoadingText}>載入圖表中...</Text>
                </View>
              )}
            />
          </View>
        )}

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
                  <View style={styles.transactionHeaderRight}>
                    <Text style={styles.transactionDate}>
                      {new Date(transaction.trans_date).toLocaleDateString('zh-TW')}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleDeleteTransaction(transaction)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Trash2 size={14} color="#94a3b8" />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.transactionDetails}>
                  {isInvestmentAsset && (
                    <Text style={styles.transactionText}>
                      股數: {transaction.shares.toLocaleString()}
                    </Text>
                  )}
                  {isInvestmentAsset && (
                  <Text style={styles.transactionText}>
                    價格: {formatCurrency(transaction.price, asset.currency)}
                  </Text>
                  )}
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
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>新增交易記錄</Text>

            <Text style={styles.label}>類型</Text>
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

            <Text style={styles.label}>日期</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              value={txDate}
              onChangeText={setTxDate}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />

            {isInvestmentAsset && (
              <>
                <Text style={styles.label}>股數</Text>
                <TextInput
                  style={styles.input}
                  placeholder="輸入股數"
                  value={txShares}
                  onChangeText={setTxShares}
                  keyboardType="decimal-pad"
                />
              </>
            )}

            <Text style={styles.label}>
              {isInvestmentAsset ? `價格 (${asset.currency})` : `金額 (${asset.currency})`}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={isInvestmentAsset ? '輸入價格' : '輸入金額'}
              value={txPrice}
              onChangeText={setTxPrice}
              keyboardType="decimal-pad"
            />

            {isInvestmentAsset && txShares && txPrice && (
              <Text style={styles.totalText}>
                總金額: {asset.currency} {(parseFloat(txShares) * parseFloat(txPrice) / (parseFloat(asset.leverage) || 1)).toFixed(2)}
              </Text>
            )}

            {!isInvestmentAsset && txPrice && (
              <Text style={styles.totalText}>
                {txType === 'BUY' ? '買入後' : txType === 'SELL' ? '賣出後' : '調整為'}：
                {asset.currency} {
                  txType === 'BUY'
                    ? (parseFloat(asset.current_amount) + parseFloat(txPrice)).toLocaleString('zh-TW', { maximumFractionDigits: 0 })
                    : txType === 'SELL'
                    ? Math.max(0, parseFloat(asset.current_amount) - parseFloat(txPrice)).toLocaleString('zh-TW', { maximumFractionDigits: 0 })
                    : parseFloat(txPrice).toLocaleString('zh-TW', { maximumFractionDigits: 0 })
                }
              </Text>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => { setModalVisible(false); resetAddModal(); }}
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
        </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Edit Asset Modal */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setEditModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>編輯資產</Text>

            <Text style={styles.label}>名稱</Text>
            <TextInput
              style={styles.input}
              placeholder="資產名稱"
              value={editName}
              onChangeText={setEditName}
            />

            <Text style={styles.label}>分類</Text>
            <View style={styles.categoryRow}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[
                    styles.categoryChip,
                    editCategory === c.id && styles.categoryChipActive,
                  ]}
                  onPress={() => setEditCategory(c.id)}
                >
                  <Text style={[
                    styles.categoryChipText,
                    editCategory === c.id && styles.categoryChipTextActive,
                  ]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {editCategory === 'investment' && (
              <>
                <Text style={styles.label}>槓桿倍數</Text>
                <TextInput
                  style={styles.input}
                  placeholder="例如: 1, 2, 3"
                  value={editLeverage}
                  onChangeText={setEditLeverage}
                  keyboardType="decimal-pad"
                />
              </>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setEditModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, editSaving && styles.confirmButtonDisabled]}
                onPress={handleEditAsset}
                disabled={editSaving}
              >
                <Text style={styles.confirmButtonText}>
                  {editSaving ? '儲存中...' : '確認儲存'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
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
    gap: 8,
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
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 5,
  },
  editButtonText: {
    color: '#2563eb',
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
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 5,
  },
  deleteButtonText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
  },
  chartSection: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e293b',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  chartWebView: {
    height: 400,
  },
  chartLoading: {
    height: 400,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartLoadingText: {
    marginTop: 8,
    fontSize: 14,
    color: '#64748b',
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
    alignItems: 'center',
    marginBottom: 4,
  },
  transactionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  categoryChipActive: {
    backgroundColor: '#2563eb',
  },
  categoryChipText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  categoryChipTextActive: {
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
