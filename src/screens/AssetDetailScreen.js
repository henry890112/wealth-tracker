import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  Dimensions,
} from 'react-native';
import { Svg, Polyline, Text as SvgText } from 'react-native-svg';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Trash2, Plus, Edit2, BarChart3, Maximize2, RefreshCw } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { convertToBaseCurrency, fetchTWStockPrice, fetchUSStockPrice, fetchCryptoPrice, fetchTWStockInstitutional, fetchTWStockMargin, fetchTWStockHoldingSharesPer, fetchTWStockMarginUsage, fetchHistoricalPrices, fetchAssetNews } from '../services/api';
import { buildTechnicalsText } from '../services/indicators';
import { analyzeAsset } from '../services/ai';
import { useTheme } from '../lib/ThemeContext';
import TechnicalAnalysisChart from '../components/TechnicalAnalysisChart';
import MarkdownText from '../components/MarkdownText';
import { analyzeTechnicalData, fetchMarketTechnicalData } from '../services/technicalAnalysis';

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
  BUY: '#0DBD8B',
  SELL: '#F03030',
  ADJUST: '#8B8CF6',
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

// ── 籌碼分析元件 ──────────────────────────────────────────────────────────────
const BAR_GREEN = '#00C851';
const BAR_RED = '#F03030';

const InstitutionalSection = ({ chipData, marginData, loading, colors }) => {
  const cardBg = colors?.card || '#1e2235';
  const textPrimary = colors?.text || '#f1f5f9';
  const textSecondary = colors?.textSub || '#94a3b8';

  if (loading) {
    return (
      <View style={instStyles.section}>
        <Text style={[instStyles.sectionTitle, { color: textPrimary }]}>籌碼分析</Text>
        <ActivityIndicator size="small" color={colors?.accent || '#8B8CF6'} style={{ marginTop: 16 }} />
      </View>
    );
  }

  if (!chipData && !marginData) {
    return (
      <View style={[instStyles.section, { backgroundColor: cardBg }]}>
        <Text style={[instStyles.sectionTitle, { color: textPrimary }]}>籌碼分析</Text>
        <Text style={[instStyles.subTitle, { color: textSecondary, marginTop: 8 }]}>暫無資料</Text>
      </View>
    );
  }

  const rows = chipData ? [
    { label: '外資', values: chipData.foreign },
    { label: '投信', values: chipData.trust },
    { label: '自營', values: chipData.dealer },
  ] : [];

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const sums = rows.map(r => sum(r.values));
  const maxAbs = Math.max(...sums.map(Math.abs), 1);

  const latestDate = chipData?.dates?.[chipData.dates.length - 1] || marginData?.date || '';

  return (
    <View style={[instStyles.section, { backgroundColor: cardBg }]}>
      <View style={instStyles.headerRow}>
        <Text style={[instStyles.sectionTitle, { color: textPrimary }]}>籌碼分析</Text>
        {latestDate ? <Text style={[instStyles.dateText, { color: textSecondary }]}>{latestDate}</Text> : null}
      </View>

      {chipData && (
        <>
          <Text style={[instStyles.subTitle, { color: textSecondary }]}>三大法人買賣超（最近5日加總）</Text>
          {rows.map((row, i) => {
            const total = sums[i];
            const isPos = total >= 0;
            const barColor = isPos ? BAR_GREEN : BAR_RED;
            const barFrac = Math.abs(total) / maxAbs;
            const sign = isPos ? '+' : '';
            return (
              <View key={row.label} style={instStyles.barRow}>
                <Text style={[instStyles.barLabel, { color: textSecondary }]}>{row.label}</Text>
                <View style={instStyles.barTrack}>
                  <View style={[instStyles.barFill, { width: `${Math.round(barFrac * 60)}%`, backgroundColor: barColor }]} />
                </View>
                <Text style={[instStyles.barValue, { color: barColor }]}>
                  {sign}{Math.round(total).toLocaleString()} 張
                </Text>
              </View>
            );
          })}
        </>
      )}

      {marginData && (
        <View style={instStyles.marginRow}>
          <View style={instStyles.marginCell}>
            <Text style={[instStyles.marginLabel, { color: textSecondary }]}>融資餘額</Text>
            <Text style={[instStyles.marginValue, { color: textPrimary }]}>{marginData.marginBalance.toLocaleString()} 張</Text>
          </View>
          <View style={instStyles.marginCell}>
            <Text style={[instStyles.marginLabel, { color: textSecondary }]}>融券餘額</Text>
            <Text style={[instStyles.marginValue, { color: textPrimary }]}>{marginData.shortBalance.toLocaleString()} 張</Text>
          </View>
          <View style={instStyles.marginCell}>
            <Text style={[instStyles.marginLabel, { color: textSecondary }]}>資券相抵</Text>
            <Text style={[instStyles.marginValue, { color: textPrimary }]}>{marginData.offsetBalance.toLocaleString()} 張</Text>
          </View>
        </View>
      )}
    </View>
  );
};

const instStyles = StyleSheet.create({
  section: { borderRadius: 14, padding: 16, marginHorizontal: 16, marginBottom: 14 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  dateText: { fontSize: 12 },
  subTitle: { fontSize: 12, marginBottom: 10 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  barLabel: { width: 32, fontSize: 13 },
  barTrack: { flex: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 5, marginHorizontal: 8, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5 },
  barValue: { width: 90, textAlign: 'right', fontSize: 12, fontWeight: '500' },
  marginRow: { flexDirection: 'row', marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)' },
  marginCell: { flex: 1, alignItems: 'center' },
  marginLabel: { fontSize: 11, marginBottom: 4 },
  marginValue: { fontSize: 13, fontWeight: '600' },
});

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const ChipLineChart = ({ data, label, unit, color, colors }) => {
  const cardBg = colors?.card || '#1e2235';
  const textPrimary = colors?.text || '#f1f5f9';
  const textSecondary = colors?.textSub || '#94a3b8';

  if (!data || data.length < 2) return null;

  const PAD_L = 38, PAD_R = 8, PAD_T = 12, PAD_B = 22;
  const svgWidth = SCREEN_WIDTH - 64;
  const svgHeight = 120;
  const innerW = svgWidth - PAD_L - PAD_R;
  const innerH = svgHeight - PAD_T - PAD_B;

  const values = data.map(d => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const toX = (i) => PAD_L + (i / (data.length - 1)) * innerW;
  const toY = (v) => PAD_T + innerH - ((v - minVal) / range) * innerH;

  const points = data.map((d, i) => `${toX(i).toFixed(1)},${toY(d.value).toFixed(1)}`).join(' ');
  const latest = values[values.length - 1];

  return (
    <View style={[chipLineStyles.container, { backgroundColor: cardBg }]}>
      <View style={chipLineStyles.headerRow}>
        <Text style={[chipLineStyles.label, { color: textSecondary }]}>{label}</Text>
        <Text style={[chipLineStyles.latest, { color }]}>
          {latest.toFixed(2)}{unit}
        </Text>
      </View>
      <Svg width={svgWidth} height={svgHeight}>
        <Polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <SvgText x={2} y={PAD_T + 4} fill={textSecondary} fontSize={9}>{maxVal.toFixed(1)}</SvgText>
        <SvgText x={2} y={PAD_T + innerH + 4} fill={textSecondary} fontSize={9}>{minVal.toFixed(1)}</SvgText>
        <SvgText x={PAD_L} y={svgHeight - 4} fill={textSecondary} fontSize={9}>{data[0].date.slice(5)}</SvgText>
        <SvgText x={svgWidth - PAD_R} y={svgHeight - 4} fill={textSecondary} fontSize={9} textAnchor="end">{data[data.length - 1].date.slice(5)}</SvgText>
      </Svg>
    </View>
  );
};

const chipLineStyles = StyleSheet.create({
  container: { borderRadius: 14, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, marginHorizontal: 16, marginBottom: 14 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '500' },
  latest: { fontSize: 15, fontWeight: '700' },
});

const todayString = () => new Date().toISOString().split('T')[0];

const formatPriceTime = (isoStr) => {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  const hms = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  return sameDay ? hms : `${d.getMonth()+1}/${d.getDate()} ${hms}`;
};

export default function AssetDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { assetId, allIds } = route.params;
  const { colors } = useTheme();
  const PRIMARY = colors.accent;
  const transactionColor = (type) => type === 'ADJUST' ? PRIMARY : TRANSACTION_TYPE_COLORS[type];

  const [asset, setAsset] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [technicalRows, setTechnicalRows] = useState([]);
  const [technicalLoading, setTechnicalLoading] = useState(false);
  const [technicalError, setTechnicalError] = useState(null);
  const [technicalPeriod, setTechnicalPeriod] = useState('6M');
  const [technicalLayers, setTechnicalLayers] = useState({ ma: true, levels: true, volume: true, macd: false, rsi: false, kd: false });
  const [priceTime, setPriceTime] = useState(null);
  const [chipData, setChipData] = useState(null);
  const [marginData, setMarginData] = useState(null);
  const [holdingData, setHoldingData] = useState(null);
  const [marginUsageData, setMarginUsageData] = useState(null);
  const [chipLoading, setChipLoading] = useState(false);
  // Ref to cancel in-flight live-price fetch when loadAssetDetails is called again
  const livePriceFetchIdRef = useRef(0);

  // Add transaction modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [txType, setTxType] = useState('BUY');
  const [txShares, setTxShares] = useState('');
  const [txPrice, setTxPrice] = useState('');
  const [txDate, setTxDate] = useState(todayString());
  const [adding, setAdding] = useState(false);

  // AI analysis state
  const [aiAnalysis,   setAiAnalysis]   = useState(null);
  const [aiLoading,    setAiLoading]    = useState(false);
  const [aiError,      setAiError]      = useState(null);

  // Edit asset modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editLeverage, setEditLeverage] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    loadAssetDetails();
  }, [assetId, allIds]);

  const loadTechnicalChart = useCallback(async (forceRefresh = false) => {
    if (!asset || asset.category !== 'investment' || !asset.symbol || !asset.market_type) return;
    setTechnicalLoading(true);
    setTechnicalError(null);
    try {
      setTechnicalRows(await fetchMarketTechnicalData(asset.symbol, asset.market_type, 1095, forceRefresh));
    } catch (error) {
      setTechnicalRows([]);
      setTechnicalError(error.message || '暫時無法取得歷史行情');
    } finally {
      setTechnicalLoading(false);
    }
  }, [asset?.id, asset?.symbol, asset?.market_type]);

  useEffect(() => {
    loadTechnicalChart();
  }, [loadTechnicalChart]);

  const technicalAnalysis = useMemo(() => {
    const count = technicalPeriod === '3M' ? 65 : technicalPeriod === '1Y' ? 260 : 130;
    const rows = technicalRows.slice(-count);
    return rows.length >= 60 ? analyzeTechnicalData(technicalRows, rows.length) : null;
  }, [technicalRows, technicalPeriod]);

  // Trigger AI analysis for investment assets with a symbol
  useEffect(() => {
    if (!asset || asset.category !== 'investment' || !asset.symbol) return;
    setAiAnalysis(null);
    setAiError(null);
    setAiLoading(true);
    (async () => {
      try {
        const [closes, news] = await Promise.all([
          fetchHistoricalPrices(asset.symbol, asset.market_type, 90),
          fetchAssetNews(asset.symbol, asset.name, asset.market_type),
        ]);
        const lp      = closes ? closes[closes.length - 1] : null;
        const technicals = lp ? buildTechnicalsText(closes, lp) : null;
        const pnlPct  = asset.cost_basis_in_base > 0
          ? ((asset.converted_amount - asset.cost_basis_in_base) / asset.cost_basis_in_base) * 100
          : null;
        const result = await analyzeAsset({
          name:         asset.name,
          symbol:       asset.symbol,
          marketType:   asset.market_type,
          currentPrice: lp,
          pnlPct,
          currency:     asset.currency,
          technicals,
          news,
        });
        setAiAnalysis(result);
      } catch (e) {
        setAiError(e.message || 'AI 分析失敗');
      } finally {
        setAiLoading(false);
      }
    })();
  }, [asset?.id]);

  useEffect(() => {
    if (!asset || !isTWStock(asset) || !asset.symbol) return;
    setChipLoading(true);
    const startDate20 = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const startDate90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const startDate180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    Promise.all([
      fetchTWStockInstitutional(asset.symbol, startDate20),
      fetchTWStockMargin(asset.symbol, startDate20),
      fetchTWStockHoldingSharesPer(asset.symbol, startDate180),
      fetchTWStockMarginUsage(asset.symbol, startDate90),
    ]).then(([chip, margin, holding, marginUsage]) => {
      setChipData(chip);
      setMarginData(margin);
      setHoldingData(holding);
      setMarginUsageData(marginUsage);
    }).catch(() => {}).finally(() => setChipLoading(false));
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

      // Transactions remain available as a record list. The persisted asset
      // average_cost is the source of truth, including costs synchronized from
      // a broker; reconstructing it only from local transactions can be stale.
      const { data: transactionsData, error: transactionsError } = await supabase
        .from('transactions')
        .select('*')
        .in('asset_id', assetIds)
        .order('trans_date', { ascending: true });

      if (transactionsError) throw transactionsError;

      // When duplicate assets with the same symbol are consolidated, calculate
      // one weighted average from their saved costs so this detail view matches
      // the broker-synced value shown everywhere else.
      const totalShares = allAssetsData.reduce((sum, a) => sum + (parseFloat(a.current_shares) || 0), 0);
      const totalCost = allAssetsData.reduce(
        (sum, a) => sum + (parseFloat(a.current_shares) || 0) * (parseFloat(a.average_cost) || 0),
        0,
      );
      const avgCost = totalShares > 0 && totalCost > 0 ? totalCost / totalShares : 0;

      // Convert cost basis to base currency for accurate P&L calculation
      // P&L = converted_amount (current market value) − cost_basis_in_base
      const lev = primaryAsset.leverage || 1;
      const costBasisRaw = totalShares > 0 ? (totalShares * avgCost / lev) : 0;
      let costBasisInBase = costBasisRaw;
      if (costBasisRaw > 0) {
        try {
          costBasisInBase = await convertToBaseCurrency(costBasisRaw, primaryAsset.currency, baseCurrency);
        } catch {
          costBasisInBase = costBasisRaw;
        }
      }

      setAsset({
        ...primaryAsset,
        converted_amount: totalConverted,
        current_shares: totalShares,
        average_cost: avgCost,
        cost_basis_in_base: costBasisInBase,
      });
      // Fetch live price for investment assets and update converted_amount + P&L.
      // Uses a fetch-id ref so that if loadAssetDetails is called again before this
      // resolves, the stale result is discarded and won't overwrite fresher state.
      if (primaryAsset.category === 'investment' && primaryAsset.symbol) {
        const fetchId = ++livePriceFetchIdRef.current;
        (async () => {
          try {
            let priceData = null;
            if (primaryAsset.market_type === 'TW') priceData = await fetchTWStockPrice(primaryAsset.symbol);
            else if (primaryAsset.market_type === 'US') priceData = await fetchUSStockPrice(primaryAsset.symbol);
            else if (primaryAsset.market_type === 'Crypto') priceData = await fetchCryptoPrice(primaryAsset.symbol);
            // Discard if a newer fetch has started
            if (fetchId !== livePriceFetchIdRef.current) return;
            if (priceData?.price_time) setPriceTime(priceData.price_time);
            // Recalculate converted_amount from live price so P&L is accurate
            if (priceData?.price && totalShares > 0) {
              const lev2 = primaryAsset.leverage || 1;
              const borrowed = totalShares * (avgCost || 0) * (lev2 - 1) / lev2;
              const liveAmount = priceData.price * totalShares - borrowed;
              const liveConverted = await convertToBaseCurrency(liveAmount, primaryAsset.currency, baseCurrency);
              if (fetchId !== livePriceFetchIdRef.current) return;
              setAsset(prev => prev ? { ...prev, converted_amount: liveConverted } : prev);
            }
          } catch {}
        })();
      }

      // Display transactions newest-first
      setTransactions([...transactionsData].sort(
        (a, b) => new Date(b.trans_date) - new Date(a.trans_date)
      ));

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
              await AsyncStorage.setItem('@wt_needs_refresh', '1');
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
      // Signal Dashboard to bypass debounce on next focus so net worth updates immediately
      await AsyncStorage.setItem('@wt_needs_refresh', '1');
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
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  if (!asset) {
    return (
      <View style={[styles.emptyState, { backgroundColor: colors.bg }]}>
        <Text style={[styles.emptyStateText, { color: colors.textSub }]}>資產不存在或無法載入</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.bg }]}
        contentContainerStyle={{ paddingBottom: 80 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Asset Summary Card */}
        <View style={[styles.assetSummaryCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.assetName, { color: colors.text }]}>{asset.name}</Text>
          {asset.symbol && <Text style={[styles.assetSymbol, { color: colors.textSub }]}>{asset.symbol}</Text>}
          <View style={[styles.assetValueRow, { borderBottomColor: colors.borderLight }]}>
            <Text style={[styles.assetValueLabel, { color: colors.textSub }]}>當前價值</Text>
            <Text style={[styles.assetValue, { color: colors.text }]}>
              {formatCurrency(asset.converted_amount)}
            </Text>
          </View>
          {priceTime && (
            <Text style={{ color: colors.textSub, fontSize: 11, textAlign: 'center', marginTop: 2 }}>
              {`報價時間 ${formatPriceTime(priceTime)}`}
            </Text>
          )}
          {asset.market_type === 'US' && (
            <Text style={{ color: colors.textMuted, fontSize: 10, textAlign: 'center', marginTop: 1 }}>
              （延遲 15 分鐘）
            </Text>
          )}
          {asset.current_shares > 0 && (
            <View style={styles.assetDetailRow}>
              <Text style={[styles.assetDetailLabel, { color: colors.textSub }]}>持有股數</Text>
              <Text style={[styles.assetDetailValue, { color: colors.text }]}>
                {asset.current_shares.toLocaleString()} 股
              </Text>
            </View>
          )}
          {asset.average_cost > 0 && (
            <View style={styles.assetDetailRow}>
              <Text style={[styles.assetDetailLabel, { color: colors.textSub }]}>平均成本</Text>
              <Text style={[styles.assetDetailValue, { color: colors.text }]}>
                {formatCurrency(asset.average_cost, asset.currency)}
              </Text>
            </View>
          )}
          {asset.category === 'investment' && asset.current_shares > 0 && asset.average_cost > 0 && (() => {
            const costBasis = asset.cost_basis_in_base || 0;
            const pnl = asset.converted_amount - costBasis;
            const pnl_pct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
            const isUp = pnl >= 0;
            return (
              <View style={styles.assetDetailRow}>
                <Text style={styles.assetDetailLabel}>當前損益</Text>
                <Text style={[styles.assetDetailValue, { color: isUp ? '#0DBD8B' : '#F03030', fontWeight: '700' }]}>
                  {isUp ? '+' : ''}{profile?.base_currency || 'TWD'} {Math.round(pnl).toLocaleString('zh-TW')}
                  {'  '}({isUp ? '+' : ''}{pnl_pct.toFixed(2)}%)
                </Text>
              </View>
            );
          })()}
          <View style={styles.assetDetailRow}>
            <Text style={[styles.assetDetailLabel, { color: colors.textSub }]}>分類</Text>
            <Text style={[styles.assetDetailValue, { color: colors.text }]}>
              {CATEGORY_LABELS[asset.category]}
            </Text>
          </View>
          <View style={styles.assetDetailRow}>
            <Text style={[styles.assetDetailLabel, { color: colors.textSub }]}>原始幣別</Text>
            <Text style={[styles.assetDetailValue, { color: colors.text }]}>{asset.currency}</Text>
          </View>
          {asset.leverage > 1 && (
            <View style={styles.assetDetailRow}>
              <Text style={[styles.assetDetailLabel, { color: colors.textSub }]}>槓桿</Text>
              <Text style={[styles.assetDetailValue, { color: colors.text }]}>{asset.leverage}x</Text>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.addTxButton, { backgroundColor: PRIMARY }]}
            onPress={() => { resetAddModal(); setModalVisible(true); }}
          >
            <Plus size={18} color={colors.accentContrast} />
            <Text style={[styles.addTxButtonText, { color: colors.accentContrast }]}>新增交易</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.editButton, { backgroundColor: colors.card, borderColor: PRIMARY }]} onPress={openEditModal}>
            <Edit2 size={18} color={PRIMARY} />
            <Text style={[styles.editButtonText, { color: PRIMARY }]}>編輯</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.deleteButton, { backgroundColor: colors.card }]} onPress={handleDelete}>
            <Trash2 size={18} color="#F03030" />
            <Text style={styles.deleteButtonText}>刪除</Text>
          </TouchableOpacity>
        </View>

        {/* ── AI Analysis Card (investment assets only) ─────────────────── */}
        {isInvestmentAsset && asset.symbol && (
          <View style={[aiCardStyles.card, { backgroundColor: colors.card }]}>
            <View style={aiCardStyles.header}>
              <View style={[aiCardStyles.iconWrap, { backgroundColor: colors.accentSoft }]}>
                <Text style={aiCardStyles.iconText}>🤖</Text>
              </View>
              <Text style={[aiCardStyles.title, { color: colors.text }]}>AI 智能分析</Text>
              {!aiLoading && (
                <TouchableOpacity
                  onPress={() => {
                    setAiAnalysis(null);
                    setAiError(null);
                    setAiLoading(true);
                    (async () => {
                      try {
                        const [closes, news] = await Promise.all([
                          fetchHistoricalPrices(asset.symbol, asset.market_type, 90),
                          fetchAssetNews(asset.symbol, asset.name, asset.market_type),
                        ]);
                        const lp = closes ? closes[closes.length - 1] : null;
                        const technicals = lp ? buildTechnicalsText(closes, lp) : null;
                        const pnlPct = asset.cost_basis_in_base > 0
                          ? ((asset.converted_amount - asset.cost_basis_in_base) / asset.cost_basis_in_base) * 100
                          : null;
                        const result = await analyzeAsset({
                          name: asset.name, symbol: asset.symbol,
                          marketType: asset.market_type, currentPrice: lp,
                          pnlPct, currency: asset.currency, technicals, news,
                        });
                        setAiAnalysis(result);
                      } catch (e) {
                        setAiError(e.message || 'AI 分析失敗');
                      } finally {
                        setAiLoading(false);
                      }
                    })();
                  }}
                  style={aiCardStyles.refreshBtn}
                >
                  <Text style={[aiCardStyles.refreshText, { color: colors.textSub }]}>重新分析</Text>
                </TouchableOpacity>
              )}
            </View>

            {aiLoading && (
              <View style={aiCardStyles.loadingWrap}>
                <ActivityIndicator size="small" color={PRIMARY} />
                <Text style={[aiCardStyles.loadingText, { color: colors.textSub }]}>
                  正在取得新聞和技術指標…
                </Text>
              </View>
            )}

            {!aiLoading && aiError && (
              <Text style={[aiCardStyles.errorText, { color: '#F03030' }]}>{aiError}</Text>
            )}

            {!aiLoading && aiAnalysis && (
              <MarkdownText text={aiAnalysis} color={colors.text} colors={colors} />
            )}
          </View>
        )}

        {/* Unified technical chart (investment assets only) */}
        {isInvestmentAsset && asset.symbol && asset.market_type && (
          <View style={[styles.chartSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.chartTitleRow, { borderBottomColor: colors.borderLight }]}>
              <View style={styles.chartTitleGroup}><BarChart3 size={18} color={PRIMARY} /><View><Text style={[styles.chartTitle, { color: colors.text }]}>K 線技術圖</Text><Text style={[styles.chartSubtitle, { color: colors.textMuted }]}>日線 · {technicalAnalysis ? `資料截至 ${technicalAnalysis.latest.time}` : '平均成本 · 技術指標'}</Text></View></View>
              <TouchableOpacity style={[styles.fullChartButton, { borderColor: colors.border }]} onPress={() => navigation.navigate('TechnicalAnalysis', { symbol: asset.symbol, name: asset.name, averageCost: asset.average_cost || 0, marketType: asset.market_type })}><Maximize2 size={15} color={PRIMARY} /><Text style={[styles.fullChartText, { color: PRIMARY }]}>完整分析</Text></TouchableOpacity>
            </View>

            <View style={styles.chartControls}>
              <View style={styles.periodControls}>{[['3M', '3月'], ['6M', '6月'], ['1Y', '1年']].map(([key, label]) => <TouchableOpacity key={key} style={[styles.periodButton, { backgroundColor: technicalPeriod === key ? colors.accentSoft : colors.cardAlt, borderColor: technicalPeriod === key ? PRIMARY : colors.border }]} onPress={() => setTechnicalPeriod(key)}><Text style={[styles.periodButtonText, { color: technicalPeriod === key ? PRIMARY : colors.textSub }]}>{label}</Text></TouchableOpacity>)}</View>
              <TouchableOpacity accessibilityLabel="重新載入技術圖" style={[styles.chartRefresh, { borderColor: colors.border }]} onPress={() => loadTechnicalChart(true)}><RefreshCw size={15} color={colors.textSub} /></TouchableOpacity>
            </View>

            {technicalLoading ? <View style={styles.chartLoading}><ActivityIndicator size="small" color={PRIMARY} /><Text style={[styles.chartLoadingText, { color: colors.textSub }]}>正在計算 K 線與指標…</Text></View> : technicalError || !technicalAnalysis ? <View style={styles.chartLoading}><Text style={[styles.chartErrorTitle, { color: colors.text }]}>暫時無法顯示 K 線</Text><Text style={[styles.chartLoadingText, { color: colors.textSub }]}>{technicalError || '歷史資料不足'}</Text></View> : <TechnicalAnalysisChart analysis={technicalAnalysis} colors={colors} averageCost={Number(asset.average_cost || 0)} layers={technicalLayers} />}

            {technicalAnalysis?.divergences?.length > 0 && (() => {
              const signal = technicalAnalysis.divergences.filter(item => item.status === 'confirmed' || item.status === 'pending').at(-1) || technicalAnalysis.divergences.at(-1);
              const bullish = signal.type === 'bullish';
              const status = { confirmed: '已確認', pending: '等待確認', invalidated: '已失效', expired: '已逾期', stale: '確認已過期' }[signal.status];
              const signalColor = signal.status === 'confirmed' ? (bullish ? colors.positive : colors.negative) : signal.status === 'pending' ? colors.warning : colors.textMuted;
              return <TouchableOpacity style={[styles.compactSignal, { backgroundColor: colors.cardAlt, borderColor: colors.border }]} onPress={() => navigation.navigate('TechnicalAnalysis', { symbol: asset.symbol, name: asset.name, averageCost: asset.average_cost || 0, marketType: asset.market_type })}><View style={[styles.compactSignalDot, { backgroundColor: signalColor }]} /><View style={{ flex: 1 }}><Text style={[styles.compactSignalTitle, { color: colors.text }]}>{bullish ? '偏多' : '偏空'}背離 · {status}</Text><Text style={[styles.compactSignalMeta, { color: colors.textMuted }]}>確認線 {Number(signal.neckline).toFixed(2)} · 條件 {signal.confirmationScore}/4</Text></View><Text style={[styles.compactSignalLink, { color: PRIMARY }]}>查看規則</Text></TouchableOpacity>;
            })()}

            <View style={[styles.layerControls, { borderTopColor: colors.borderLight }]}>{[['ma', 'MA20/60'], ['levels', '支撐壓力'], ['volume', '成交量'], ['macd', 'MACD'], ['rsi', 'RSI14'], ['kd', 'KD']].map(([key, label]) => <TouchableOpacity key={key} style={[styles.layerButton, { borderColor: technicalLayers[key] ? PRIMARY : colors.border, backgroundColor: technicalLayers[key] ? colors.accentSoft : colors.cardAlt }]} onPress={() => setTechnicalLayers(current => ({ ...current, [key]: !current[key] }))}><View style={[styles.layerDot, { backgroundColor: technicalLayers[key] ? PRIMARY : colors.textMuted }]} /><Text style={[styles.layerButtonText, { color: technicalLayers[key] ? PRIMARY : colors.textSub }]}>{label}</Text></TouchableOpacity>)}</View>
          </View>
        )}

        {/* Chip Analysis (TW stocks only) */}
        {isTWStock(asset) && (
          <InstitutionalSection
            chipData={chipData}
            marginData={marginData}
            loading={chipLoading}
            colors={colors}
          />
        )}

        {isTWStock(asset) && (
          <ChipLineChart
            data={holdingData?.map(d => ({ date: d.date, value: d.percent }))}
            label="大戶持股比例（400張以上）"
            unit="%"
            color={PRIMARY}
            colors={colors}
          />
        )}

        {isTWStock(asset) && (
          <ChipLineChart
            data={marginUsageData?.map(d => ({ date: d.date, value: d.usageRate }))}
            label="融資使用率"
            unit="%"
            color="#4A90E2"
            colors={colors}
          />
        )}

        {/* Transaction History */}
        <View style={[styles.transactionsSection, { backgroundColor: colors.card }]}>
          <Text style={[styles.transactionsTitle, { color: colors.text, borderBottomColor: colors.borderLight }]}>交易歷史</Text>
          {transactions.length > 0 ? (
            transactions.map((transaction) => (
              <View key={transaction.id} style={[styles.transactionCard, { borderBottomColor: colors.borderLight }]}>
                <View style={styles.transactionHeader}>
                  <Text
                    style={[
                      styles.transactionType,
                      { color: transactionColor(transaction.type) },
                    ]}
                  >
                    {transaction.type === 'BUY' ? '買入' : transaction.type === 'SELL' ? '賣出' : '調整'}
                  </Text>
                  <View style={styles.transactionHeaderRight}>
                    <Text style={[styles.transactionDate, { color: colors.textSub }]}>
                      {new Date(transaction.trans_date).toLocaleDateString('zh-TW')}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleDeleteTransaction(transaction)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Trash2 size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.transactionDetails}>
                  {isInvestmentAsset && (
                    <Text style={[styles.transactionText, { color: colors.textSub }]}>
                      股數: {transaction.shares.toLocaleString()}
                    </Text>
                  )}
                  {isInvestmentAsset && (
                  <Text style={[styles.transactionText, { color: colors.textSub }]}>
                    價格: {formatCurrency(transaction.price, asset.currency)}
                  </Text>
                  )}
                  <Text style={[styles.transactionAmount, { color: colors.text }]}>
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
                    txType === t.id && { backgroundColor: transactionColor(t.id) },
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
              <Text style={[styles.totalText, { color: PRIMARY }]}>
                總金額: {asset.currency} {(parseFloat(txShares) * parseFloat(txPrice) / (parseFloat(asset.leverage) || 1)).toFixed(2)}
              </Text>
            )}

            {!isInvestmentAsset && txPrice && (
              <Text style={[styles.totalText, { color: PRIMARY }]}>
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
                style={[styles.confirmButton, { backgroundColor: PRIMARY }, adding && styles.confirmButtonDisabled]}
                onPress={handleAddTransaction}
                disabled={adding}
              >
                <Text style={[styles.confirmButtonText, { color: colors.accentContrast }]}>
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
                    { backgroundColor: colors.cardAlt },
                    editCategory === c.id && { backgroundColor: PRIMARY },
                  ]}
                  onPress={() => setEditCategory(c.id)}
                >
                  <Text style={[
                    styles.categoryChipText,
                    { color: editCategory === c.id ? colors.accentContrast : colors.textSub },
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
                style={[styles.confirmButton, { backgroundColor: PRIMARY }, editSaving && styles.confirmButtonDisabled]}
                onPress={handleEditAsset}
                disabled={editSaving}
              >
                <Text style={[styles.confirmButtonText, { color: colors.accentContrast }]}>
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
    color: '#18213C',
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
    color: '#18213C',
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
    color: '#18213C',
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
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 5,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#F03030',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 5,
  },
  deleteButtonText: {
    color: '#F03030',
    fontSize: 14,
    fontWeight: '600',
  },
  chartSection: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
  },
  chartTitleRow: { minHeight: 66, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  chartTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  chartTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  chartSubtitle: { fontSize: 10, marginTop: 3 },
  fullChartButton: { minHeight: 34, borderWidth: 1, borderRadius: 11, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5 },
  fullChartText: { fontSize: 10, fontWeight: '800' },
  chartControls: { paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  periodControls: { flexDirection: 'row', gap: 6 },
  periodButton: { minWidth: 47, minHeight: 31, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  periodButtonText: { fontSize: 10, fontWeight: '700' },
  chartRefresh: { width: 31, height: 31, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chartLoading: {
    height: 220,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  chartLoadingText: {
    marginTop: 8,
    fontSize: 12,
    textAlign: 'center',
  },
  chartErrorTitle: { fontSize: 14, fontWeight: '800' },
  compactSignal: { marginHorizontal: 11, marginTop: 10, padding: 10, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  compactSignalDot: { width: 8, height: 8, borderRadius: 4 },
  compactSignalTitle: { fontSize: 11, fontWeight: '800' }, compactSignalMeta: { fontSize: 9, marginTop: 2 }, compactSignalLink: { fontSize: 9, fontWeight: '800' },
  layerControls: { borderTopWidth: StyleSheet.hairlineWidth, padding: 11, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  layerButton: { minHeight: 31, borderWidth: 1, borderRadius: 15, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5 },
  layerDot: { width: 6, height: 6, borderRadius: 3 },
  layerButtonText: { fontSize: 10, fontWeight: '700' },
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
    color: '#18213C',
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
    color: '#18213C',
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
    color: '#18213C',
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#18213C',
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

const aiCardStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16, marginBottom: 14,
    borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 6, elevation: 3,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12,
  },
  iconWrap: {
    width: 30, height: 30, borderRadius: 9,
    justifyContent: 'center', alignItems: 'center',
  },
  iconText:    { fontSize: 16 },
  title:       { fontSize: 15, fontWeight: '700', flex: 1 },
  refreshBtn:  { paddingHorizontal: 8, paddingVertical: 4 },
  refreshText: { fontSize: 12 },
  loadingWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  loadingText: { fontSize: 13 },
  errorText:   { fontSize: 13, lineHeight: 20 },
  body:        { fontSize: 14, lineHeight: 22 },
});
