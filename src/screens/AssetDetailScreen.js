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
import { Trash2, Plus, Edit2, BarChart3, Maximize2, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { convertToBaseCurrency, fetchExchangeRatesBatch, fetchTWStockPrice, fetchUSStockPrice, fetchCryptoPrice, fetchTWStockHoldingSharesPer, fetchHistoricalPrices, fetchAssetNews, fetchLatestMarketQuote } from '../services/api';
import { buildTechnicalsText } from '../services/indicators';
import { analyzeAsset } from '../services/ai';
import { getAssetCurrency } from '../services/portfolio';
import { useTheme } from '../lib/ThemeContext';
import { describeQuote, formatQuoteTime, getQuoteStatusColor } from '../lib/quoteMetadata';
import { estimateHoldingPriceReturnPct, resolveAssetAIPrice } from '../utils/assetAIPrice';
import TechnicalAnalysisChart from '../components/TechnicalAnalysisChart';
import MarkdownText from '../components/MarkdownText';
import { analyzeTechnicalData, fetchMarketTechnicalContext } from '../services/technicalAnalysis';
import { calculateTradePlan, getTradePlanDisplayStatus } from '../services/tradePlanCalculator';
import { loadTradePlanSettings, loadTradePlanStop, saveTradePlanStop, closeTradePlanStop } from '../services/tradePlans';
import { getTransactionSourceLabel } from '../lib/transactionReconciliation';
import { calculateFifoPositionAccounting } from '../lib/positionAccounting';

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

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const ChipLineChart = ({ data, label, unit, color, colors, expanded = true, onToggle }) => {
  const cardBg = colors?.card || '#1e2235';
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
      <TouchableOpacity
        style={chipLineStyles.headerRow}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text style={[chipLineStyles.label, { color: textSecondary }]}>{label}</Text>
        <View style={chipLineStyles.headerRight}>
          <Text style={[chipLineStyles.latest, { color }]}>{latest.toFixed(2)}{unit}</Text>
          {expanded ? <ChevronUp size={17} color={textSecondary} /> : <ChevronDown size={17} color={textSecondary} />}
        </View>
      </TouchableOpacity>
      {expanded && <>
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
      </>}
    </View>
  );
};

const chipLineStyles = StyleSheet.create({
  container: { borderRadius: 14, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, marginHorizontal: 16, marginBottom: 14 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32, marginBottom: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  label: { fontSize: 13, fontWeight: '500' },
  latest: { fontSize: 15, fontWeight: '700' },
});

const todayString = () => new Date().toISOString().split('T')[0];

export default function AssetDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { assetId, allIds } = route.params;
  const { colors } = useTheme();
  const PRIMARY = colors.accent;
  const transactionColor = (type) => type === 'ADJUST' ? PRIMARY : TRANSACTION_TYPE_COLORS[type];

  const [asset, setAsset] = useState(null);
  const [entryReason, setEntryReason] = useState('');
  const [entryReasonSaved, setEntryReasonSaved] = useState('');
  const [entryReasonSaving, setEntryReasonSaving] = useState(false);
  const [entryReasonError, setEntryReasonError] = useState(null);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [technicalRows, setTechnicalRows] = useState([]);
  const [technicalContext, setTechnicalContext] = useState({ institutional: [], marketType: 'TW' });
  const [technicalLoading, setTechnicalLoading] = useState(false);
  const [technicalError, setTechnicalError] = useState(null);
  const [technicalPeriod, setTechnicalPeriod] = useState('6M');
  const [technicalStrategy, setTechnicalStrategy] = useState(null);
  const [technicalLayers, setTechnicalLayers] = useState({ ma: true, boll: true, levels: true, gap: true, volume: true, volumeProfile: false, macd: true, rsi: true, kd: true });
  const [priceTime, setPriceTime] = useState(null);
  const [quoteMetadata, setQuoteMetadata] = useState(null);
  const [holdingData, setHoldingData] = useState(null);
  const [tradePlan, setTradePlan] = useState(null);
  const [tradePlanLoading, setTradePlanLoading] = useState(false);
  // Ref to cancel in-flight live-price fetch when loadAssetDetails is called again
  const livePriceFetchIdRef = useRef(0);

  // Add transaction modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [txType, setTxType] = useState('BUY');
  const [txShares, setTxShares] = useState('');
  const [txPrice, setTxPrice] = useState('');
  const [txDate, setTxDate] = useState(todayString());
  const [adding, setAdding] = useState(false);
  const [applyTradePlan, setApplyTradePlan] = useState(false);

  // AI analysis state
  const [aiAnalysis,   setAiAnalysis]   = useState(null);
  const [aiLoading,    setAiLoading]    = useState(false);
  const [aiError,      setAiError]      = useState(null);
  const [aiPriceInfo, setAiPriceInfo] = useState(null);
  const aiRequestIdRef = useRef(0);

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
      const context = await fetchMarketTechnicalContext(asset.symbol, asset.market_type, 1095, forceRefresh, true);
      setTechnicalRows(context.rows);
      setTechnicalContext(context);
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

  const loadTradePlan = useCallback(async () => {
    if (!asset?.symbol || asset?.category !== 'investment') {
      setTradePlan(null);
      return;
    }
    setTradePlanLoading(true);
    try {
      const settings = await loadTradePlanSettings();
      let dynamicStop = null;
      let dynamicStopReady = true;
      try {
        dynamicStop = await loadTradePlanStop(asset.symbol, asset.market_type);
        if (!(Number(asset.current_shares) > 0) && dynamicStop) {
          await closeTradePlanStop(asset.symbol, asset.market_type);
          dynamicStop = null;
        }
      } catch (error) {
        dynamicStopReady = false;
        console.warn('Trade plan dynamic stop load error:', error.message);
      }
      setTradePlan({ ...settings, dynamic_stop: dynamicStop, dynamic_stop_ready: dynamicStopReady });
    } catch (error) {
      console.warn('Trade plan load error:', error.message);
      setTradePlan(null);
    } finally {
      setTradePlanLoading(false);
    }
  }, [asset?.id, asset?.symbol, asset?.market_type, asset?.category, asset?.currency, asset?.current_shares]);

  useEffect(() => {
    loadTradePlan();
    const unsubscribe = navigation.addListener('focus', loadTradePlan);
    return unsubscribe;
  }, [navigation, loadTradePlan]);

  const technicalAnalysis = useMemo(() => {
    const count = technicalPeriod === '3M' ? 65 : technicalPeriod === '1Y' ? 260 : 130;
    const rows = technicalRows.slice(-count);
    return rows.length >= 60 ? analyzeTechnicalData(technicalRows, rows.length, technicalContext) : null;
  }, [technicalRows, technicalPeriod, technicalContext]);

  const tradePlanEvaluation = useMemo(() => {
    if (!tradePlan) return null;
    const hasPosition = Number(asset?.current_shares || 0) > 0;
    return calculateTradePlan({
      entryPrice: hasPosition ? asset?.average_cost : (technicalContext.quote?.price || technicalAnalysis?.latest?.close),
      savedEntryPrice: tradePlan.dynamic_stop?.entry_price,
      atr: technicalAnalysis?.latest?.atr14 || technicalAnalysis?.atr,
      positionSize: hasPosition ? Number(asset?.current_shares) : null,
      currentPrice: hasPosition ? (technicalContext.quote?.price || technicalAnalysis?.latest?.close) : null,
      isIntraday: Boolean(technicalContext.isIntraday),
      analysis: technicalAnalysis,
      effectiveStop: tradePlan.dynamic_stop?.last_effective_stop,
      effectiveStopSource: tradePlan.dynamic_stop?.last_stop_source,
      initialStop: tradePlan.dynamic_stop?.initial_stop_price,
      initialRiskPerShare: tradePlan.dynamic_stop?.initial_risk_per_share,
      highestPriceSinceEntry: tradePlan.dynamic_stop?.highest_price_since_entry,
      effectiveStopEvaluatedAt: tradePlan.dynamic_stop?.last_evaluated_at,
      confirmedInvalidAt: tradePlan.dynamic_stop?.invalidated_at,
      confirmedInvalidPrice: tradePlan.dynamic_stop?.invalidation_price,
      confirmedInvalidSessionDate: tradePlan.dynamic_stop?.invalidation_session_date,
      marketType: asset?.market_type,
      atrMultiplier: tradePlan.atr_multiplier,
    });
  }, [tradePlan, asset?.current_shares, asset?.average_cost, asset?.market_type, technicalContext.quote?.price, technicalContext.isIntraday, technicalAnalysis?.latest?.close, technicalAnalysis?.latest?.atr14, technicalAnalysis?.atr, technicalAnalysis]);

  const tradePlanEntryEvaluation = useMemo(() => {
    if (!tradePlan) return null;
    return calculateTradePlan({
      entryPrice: technicalContext.quote?.price || technicalAnalysis?.latest?.close,
      atr: technicalAnalysis?.latest?.atr14 || technicalAnalysis?.atr,
      analysis: technicalAnalysis,
      atrMultiplier: tradePlan.atr_multiplier,
    });
  }, [tradePlan, technicalContext.quote?.price, technicalAnalysis?.latest?.close, technicalAnalysis?.latest?.atr14, technicalAnalysis?.atr, technicalAnalysis]);

  useEffect(() => {
    const hasPosition = Number(asset?.current_shares || 0) > 0;
    const previous = Number(tradePlan?.dynamic_stop?.last_effective_stop || 0);
    const next = Number(tradePlanEvaluation?.stopPrice || 0);
    const nextHigh = Number(tradePlanEvaluation?.highestPriceSinceEntry || 0);
    const needsSave = tradePlanEvaluation?.rebaseRequired
      || !tradePlan?.dynamic_stop
      || next > previous + 1e-8
      || tradePlan.dynamic_stop.last_stop_source !== tradePlanEvaluation?.stopSource
      || (tradePlanEvaluation?.newlyConfirmedInvalid
        && tradePlanEvaluation.invalidationSessionDate !== tradePlan?.dynamic_stop?.invalidation_session_date);
    if (!tradePlan?.saved || tradePlan.dynamic_stop_ready !== true || !hasPosition || !tradePlanEvaluation?.valid || !(next > 0) || !needsSave) return undefined;
    let active = true;
    saveTradePlanStop({
      symbol: asset.symbol,
      marketType: asset.market_type,
      entryPrice: tradePlanEvaluation.entryPrice,
      effectiveStop: next,
      initialStop: tradePlanEvaluation.initialStopPrice,
      initialRiskPerShare: tradePlanEvaluation.initialRiskPerShare,
      highestPriceSinceEntry: nextHigh,
      stopSource: tradePlanEvaluation.stopSource,
      rebaseExisting: Boolean(tradePlanEvaluation.rebaseRequired),
      invalidatedAt: tradePlanEvaluation.invalidatedAt,
      invalidationPrice: tradePlanEvaluation.invalidationPrice,
      invalidationSessionDate: tradePlanEvaluation.invalidationSessionDate,
    })
      .then(stop => active && setTradePlan(current => current ? { ...current, dynamic_stop: stop } : current))
      .catch(error => console.warn('Trade plan dynamic stop save error:', error.message));
    return () => { active = false; };
  }, [asset?.symbol, asset?.market_type, asset?.current_shares, tradePlan?.saved, tradePlan?.dynamic_stop_ready, tradePlan?.dynamic_stop, tradePlanEvaluation]);

  const runAssetAIAnalysis = async () => {
    if (!asset || asset.category !== 'investment' || !asset.symbol) return;
    const requestId = ++aiRequestIdRef.current;
    setAiAnalysis(null);
    setAiPriceInfo(null);
    setAiError(null);
    setAiLoading(true);
    try {
      const fallbackQuote = async () => {
        if (asset.market_type === 'TW') return fetchTWStockPrice(asset.symbol);
        if (asset.market_type === 'US') return fetchUSStockPrice(asset.symbol);
        if (String(asset.market_type).toUpperCase() === 'CRYPTO') return fetchCryptoPrice(asset.symbol);
        return null;
      };
      const [closes, news, quote] = await Promise.all([
        fetchHistoricalPrices(asset.symbol, asset.market_type, 90),
        fetchAssetNews(asset.symbol, asset.name, asset.market_type),
        fetchLatestMarketQuote(asset.symbol, asset.market_type, { forceRefresh: true }).catch(fallbackQuote).catch(() => null),
      ]);
      const historicalClose = closes?.[closes.length - 1] ?? null;
      const priceInfo = resolveAssetAIPrice(quote, historicalClose);
      const technicals = closes?.length && priceInfo.price !== null
        ? buildTechnicalsText(closes, priceInfo.price, priceInfo.label)
        : null;
      const pnlPct = estimateHoldingPriceReturnPct(priceInfo.price, asset.average_cost, asset.leverage, asset.current_shares);
      const result = await analyzeAsset({
        name: asset.name, symbol: asset.symbol, marketType: asset.market_type,
        currentPrice: priceInfo.price, priceLabel: priceInfo.label,
        priceTime: priceInfo.sourceTime, priceSource: priceInfo.source,
        pnlPct, currency: asset.currency, technicals, news,
      });
      if (requestId !== aiRequestIdRef.current) return;
      setAiPriceInfo(priceInfo);
      setAiAnalysis(result);
    } catch (e) {
      if (requestId === aiRequestIdRef.current) setAiError(e.message || 'AI 分析失敗');
    } finally {
      if (requestId === aiRequestIdRef.current) setAiLoading(false);
    }
  };

  // Trigger AI analysis once for a newly selected asset; manual refresh requests a fresh quote.
  useEffect(() => {
    if (asset?.category === 'investment' && asset?.symbol) runAssetAIAnalysis();
    return () => { aiRequestIdRef.current += 1; };
  }, [asset?.id]);

  useEffect(() => {
    if (!asset || !isTWStock(asset) || !asset.symbol) return;
    const startDate180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    fetchTWStockHoldingSharesPer(asset.symbol, startDate180)
      .then(setHoldingData)
      .catch(() => setHoldingData(null));
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
      const assetCurrencies = [...new Set(allAssetsData.map(a => getAssetCurrency(a, baseCurrency)).filter(Boolean))];
      const ratesMap = await fetchExchangeRatesBatch(assetCurrencies, baseCurrency);

      // Aggregate converted amount across all merged assets
      let totalConverted = 0;
      for (const a of allAssetsData) {
        try {
          const c = await convertToBaseCurrency(parseFloat(a.current_amount), getAssetCurrency(a, baseCurrency), baseCurrency, ratesMap);
          totalConverted += c;
        } catch {
          totalConverted += parseFloat(a.current_amount) || 0;
        }
      }

      const { data: transactionsData, error: transactionsError } = await supabase
        .from('transactions')
        .select('*')
        .in('asset_id', assetIds)
        .order('trans_date', { ascending: true });

      if (transactionsError) throw transactionsError;

      const totalShares = allAssetsData.reduce((sum, a) => sum + (parseFloat(a.current_shares) || 0), 0);
      const persistedCost = allAssetsData.reduce(
        (sum, a) => sum + (parseFloat(a.current_shares) || 0) * (parseFloat(a.average_cost) || 0),
        0,
      );
      const persistedAverageCost = totalShares > 0 && persistedCost > 0 ? persistedCost / totalShares : 0;
      const expectedSharesByAssetId = Object.fromEntries(
        allAssetsData.map(a => [a.id, parseFloat(a.current_shares) || 0]),
      );
      const positionAccounting = calculateFifoPositionAccounting(transactionsData || [], expectedSharesByAssetId);
      const avgCost = positionAccounting.isComplete && positionAccounting.openShares > 0
        ? positionAccounting.averageCost
        : persistedAverageCost;

      // Convert cost basis to base currency for accurate P&L calculation
      // P&L = converted_amount (current market value) − cost_basis_in_base
      const lev = primaryAsset.leverage || 1;
      const leverageByAssetId = new Map(allAssetsData.map(a => [a.id, Math.max(1, Number(a.leverage) || 1)]));
      const costBasisRaw = positionAccounting.isComplete
        ? positionAccounting.assets.reduce(
          (sum, row) => sum + row.openCost / (leverageByAssetId.get(row.assetId) || 1),
          0,
        )
        : (totalShares > 0 ? totalShares * avgCost / lev : 0);
      let costBasisInBase = costBasisRaw;
      if (costBasisRaw > 0) {
        try {
          costBasisInBase = await convertToBaseCurrency(costBasisRaw, getAssetCurrency(primaryAsset, baseCurrency), baseCurrency, ratesMap);
        } catch {
          costBasisInBase = costBasisRaw;
        }
      }

      let realizedPnlInBase = null;
      if (positionAccounting.isComplete && positionAccounting.realizedShares > 0) {
        realizedPnlInBase = 0;
        const assetsById = new Map(allAssetsData.map(a => [a.id, a]));
        for (const row of positionAccounting.assets) {
          if (!(row.realizedShares > 0)) continue;
          const transactionAsset = assetsById.get(row.assetId) || primaryAsset;
          try {
            realizedPnlInBase += await convertToBaseCurrency(
              row.realizedPnl,
              getAssetCurrency(transactionAsset, baseCurrency),
              baseCurrency,
              ratesMap,
            );
          } catch {
            realizedPnlInBase += row.realizedPnl;
          }
        }
      }

      setAsset({
        ...primaryAsset,
        converted_amount: totalConverted,
        current_shares: totalShares,
        average_cost: avgCost,
        cost_basis_in_base: costBasisInBase,
        realized_pnl_in_base: realizedPnlInBase,
        realized_pnl_available: positionAccounting.isComplete && positionAccounting.realizedShares > 0,
      });
      setEntryReason(primaryAsset.entry_reason || '');
      setEntryReasonSaved(primaryAsset.entry_reason || '');
      setEntryReasonError(null);
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
            if (priceData) {
              setQuoteMetadata({
                source: priceData.source,
                source_time: priceData.source_time || priceData.price_time,
                fetched_at: priceData.fetched_at,
                quote_status: priceData.quote_status,
                is_stale: priceData.is_stale,
              });
            }
            // Recalculate converted_amount from live price so P&L is accurate
            if (priceData?.price && totalShares > 0) {
              const lev2 = primaryAsset.leverage || 1;
              const borrowed = totalShares * (avgCost || 0) * (lev2 - 1) / lev2;
              const liveAmount = priceData.price * totalShares - borrowed;
              const liveConverted = await convertToBaseCurrency(liveAmount, getAssetCurrency(primaryAsset, baseCurrency), baseCurrency, ratesMap);
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
    const permanentlyDelete = () => Alert.alert(
      '永久刪除資產',
      `確定要永久刪除「${asset?.name}」與 ${transactions.length} 筆交易嗎？刪除後年化收益率也會失去這段歷史。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '永久刪除',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.from('assets').delete().eq('id', assetId);
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

    if (asset?.category === 'investment' && transactions.length > 0) {
      Alert.alert(
        Number(asset?.current_shares || 0) <= 0 ? '部位已自動隱藏' : '建議保留交易紀錄',
        Number(asset?.current_shares || 0) <= 0
          ? '這個部位已平倉，總覽不再顯示，但交易紀錄會保留供年化收益率計算。'
          : '投資部位賣到 0 股後會自動從總覽隱藏，不需要刪除。保留交易紀錄才能正確計算年化收益率。',
        [
          { text: '保留紀錄', style: 'cancel' },
          { text: '仍要永久刪除', style: 'destructive', onPress: permanentlyDelete },
        ]
      );
      return;
    }

    Alert.alert(
      '刪除資產',
      `確定要刪除「${asset?.name}」嗎？此操作無法復原，所有交易記錄也將一併刪除。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: permanentlyDelete,
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

  const handleSaveEntryReason = async () => {
    const normalizedReason = entryReason.trim();
    setEntryReasonSaving(true);
    setEntryReasonError(null);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('請先登入再儲存進場原因');

      const { data: updatedAsset, error } = await supabase
        .from('assets')
        .update({ entry_reason: normalizedReason || null })
        .eq('id', assetId)
        .eq('user_id', user.id)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!updatedAsset) throw new Error('找不到可更新的資產，進場原因尚未儲存');

      setEntryReason(normalizedReason);
      setEntryReasonSaved(normalizedReason);
      setAsset(current => current ? { ...current, entry_reason: normalizedReason || null } : current);
    } catch (error) {
      console.error('Save entry reason error:', error);
      const schemaNotReady = ['42703', 'PGRST204'].includes(error.code) || /entry_reason/i.test(error.message || '');
      setEntryReasonError(schemaNotReady
        ? '資料庫尚未套用進場原因欄位 migration'
        : error.message || '進場原因儲存失敗');
    } finally {
      setEntryReasonSaving(false);
    }
  };

  const toggleSection = (section) => {
    setCollapsedSections(current => ({ ...current, [section]: !current[section] }));
  };

  const isInvestmentAsset = asset?.category === 'investment';

  const resetAddModal = () => {
    setTxShares('');
    setTxPrice('');
    setTxType('BUY');
    setTxDate(todayString());
    setApplyTradePlan(false);
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
      Alert.alert('成功', applyTradePlan ? '交易記錄已新增；共用風控規則會繼續套用此持倉' : '交易記錄已新增');
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
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Asset Summary Card */}
        <View style={[styles.assetSummaryCard, { backgroundColor: colors.card }]}>
          <TouchableOpacity
            style={styles.assetSummaryHeader}
            onPress={() => toggleSection('summary')}
            accessibilityRole="button"
            accessibilityState={{ expanded: !collapsedSections.summary }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.assetName, { color: colors.text }]}>{asset.name}</Text>
              {asset.symbol && <Text style={[styles.assetSymbol, { color: colors.textSub, marginBottom: 0 }]}>{asset.symbol}</Text>}
            </View>
            {collapsedSections.summary ? <ChevronDown size={20} color={colors.textSub} /> : <ChevronUp size={20} color={colors.textSub} />}
          </TouchableOpacity>
          {!collapsedSections.summary && <>
            <View style={[styles.assetValueRow, { borderBottomColor: colors.borderLight }]}>
              <Text style={[styles.assetValueLabel, { color: colors.textSub }]}>當前價值</Text>
              <Text style={[styles.assetValue, { color: colors.text }]}>
                {formatCurrency(asset.converted_amount)}
              </Text>
            </View>
            {(quoteMetadata || priceTime) && (
              <Text style={{
                color: getQuoteStatusColor(
                  quoteMetadata?.quote_status,
                  quoteMetadata?.is_stale,
                  colors,
                ),
                fontSize: 11,
                textAlign: 'center',
                marginTop: 4,
              }}>
                {describeQuote({ ...quoteMetadata, price_time: priceTime })}
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
            const unrealizedPnl = asset.converted_amount - costBasis;
            const pnlPct = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;
            const unrealizedIsUp = unrealizedPnl >= 0;
            const realizedPnl = asset.realized_pnl_available ? Number(asset.realized_pnl_in_base || 0) : null;
            const cumulativePnl = realizedPnl == null ? null : unrealizedPnl + realizedPnl;
            const formatPnl = value => `${value >= 0 ? '+' : ''}${profile?.base_currency || 'TWD'} ${Math.round(value).toLocaleString('zh-TW')}`;
            return (
              <>
                <View style={styles.assetDetailRow}>
                  <Text style={styles.assetDetailLabel}>未實現損益</Text>
                  <Text style={[styles.assetDetailValue, { color: unrealizedIsUp ? '#0DBD8B' : '#F03030', fontWeight: '700' }]}>
                    {formatPnl(unrealizedPnl)}{'  '}({unrealizedIsUp ? '+' : ''}{pnlPct.toFixed(2)}%)
                  </Text>
                </View>
                {realizedPnl != null && <>
                  <View style={styles.assetDetailRow}>
                    <Text style={styles.assetDetailLabel}>已實現損益</Text>
                    <Text style={[styles.assetDetailValue, { color: realizedPnl >= 0 ? '#0DBD8B' : '#F03030', fontWeight: '700' }]}>
                      {formatPnl(realizedPnl)}
                    </Text>
                  </View>
                  <View style={styles.assetDetailRow}>
                    <Text style={styles.assetDetailLabel}>累積損益</Text>
                    <Text style={[styles.assetDetailValue, { color: cumulativePnl >= 0 ? '#0DBD8B' : '#F03030', fontWeight: '700' }]}>
                      {formatPnl(cumulativePnl)}
                    </Text>
                  </View>
                </>}
              </>
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
          </>}
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

        <View style={[styles.entryReasonCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.entryReasonHeader}
            onPress={() => toggleSection('entryReason')}
            accessibilityRole="button"
            accessibilityState={{ expanded: !collapsedSections.entryReason }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.entryReasonTitle, { color: colors.text }]}>進場原因</Text>
              <Text style={[styles.entryReasonSubtitle, { color: colors.textMuted }]}>記下當時的進場依據與預期</Text>
            </View>
            {collapsedSections.entryReason ? <ChevronDown size={19} color={colors.textSub} /> : <ChevronUp size={19} color={colors.textSub} />}
          </TouchableOpacity>
          {!collapsedSections.entryReason && <>
            <TextInput
              style={[styles.entryReasonInput, { backgroundColor: colors.cardAlt, borderColor: colors.border, color: colors.text }]}
              placeholder="例如：進場依據、預期催化因素、持有計畫與失效條件…"
              placeholderTextColor={colors.textMuted}
              value={entryReason}
              onChangeText={setEntryReason}
              multiline
              maxLength={2000}
              textAlignVertical="top"
              accessibilityLabel="進場原因"
            />
            <View style={styles.entryReasonFooter}>
              <Text style={[styles.entryReasonStatus, { color: entryReasonError ? colors.negative : entryReason.trim() !== entryReasonSaved ? colors.warning : colors.textMuted }]}>
                {entryReasonError || (entryReason.trim() !== entryReasonSaved ? '尚未儲存' : `${entryReasonSaved ? '已儲存' : '尚未填寫'} · ${entryReason.length}/2000`)}
              </Text>
              <TouchableOpacity
                style={[styles.entryReasonSave, { backgroundColor: colors.accent, opacity: entryReasonSaving || entryReason.trim() === entryReasonSaved ? 0.55 : 1 }]}
                onPress={handleSaveEntryReason}
                disabled={entryReasonSaving || entryReason.trim() === entryReasonSaved}
              >
                <Text style={[styles.entryReasonSaveText, { color: colors.accentContrast }]}>{entryReasonSaving ? '儲存中…' : '儲存原因'}</Text>
              </TouchableOpacity>
            </View>
          </>}
        </View>

        {isInvestmentAsset && asset.symbol && (() => {
          const hasSavedRule = Boolean(tradePlan?.saved);
          const displayStatus = getTradePlanDisplayStatus(tradePlanEvaluation);
          const state = displayStatus.state;
          const canCalculate = Boolean(tradePlanEvaluation?.valid);
          const hasConfirmedInvalidation = Boolean(tradePlanEvaluation?.confirmedInvalid);
          const stopDataUnavailable = tradePlan?.dynamic_stop_ready === false;
          const stateColor = state === 'invalid'
            ? colors.negative
            : state === 'warning' || state === 'recovered' || !hasSavedRule || !canCalculate || stopDataUnavailable
              ? colors.warning
              : state === 'normal' ? colors.positive : colors.accent;
          const issueLabel = !hasSavedRule ? '尚未設定'
              : stopDataUnavailable ? '停損資料未載入'
                : hasConfirmedInvalidation || state === 'invalid' ? displayStatus.label
                : tradePlanEvaluation?.issueCode === 'MISSING_ATR' ? 'ATR 資料不足'
                  : !canCalculate ? '計算條件不足' : displayStatus.label;
          const planIssueText = stopDataUnavailable
            ? '無法讀取已保存的停損計畫；為避免覆蓋原始 1R 與失效紀錄，目前暫停自動更新。'
            : !canCalculate ? tradePlanEvaluation?.errors?.join('；') : '';
          const visibleStop = hasConfirmedInvalidation && Number(tradePlanEvaluation?.invalidationStopPrice) > 0
            ? Number(tradePlanEvaluation.invalidationStopPrice)
            : canCalculate
              ? Number(tradePlanEvaluation?.stopPrice || 0)
              : Number(tradePlan?.dynamic_stop?.last_effective_stop || tradePlanEvaluation?.initialStopPrice || 0);
          const stopOutcomeAmount = Number(tradePlanEvaluation?.stopOutcomeAmount);
          const stopOutcomePercent = Number(tradePlanEvaluation?.stopOutcomePercent);
          const hasStopOutcome = Number(asset.current_shares || 0) > 0 && Number.isFinite(stopOutcomeAmount) && Number.isFinite(stopOutcomePercent);
          const stopOutcomeColor = stopOutcomeAmount > 0 ? colors.positive : stopOutcomeAmount < 0 ? colors.negative : colors.text;
          const stopOutcomeCurrency = asset.currency || (String(asset.market_type).toUpperCase() === 'TW' ? 'TWD' : 'USD');
          const formatOutcome = (amount, percent) => (
            Number.isFinite(amount) && Number.isFinite(percent)
              ? `${amount > 0 ? '+' : amount < 0 ? '-' : ''}${stopOutcomeCurrency} ${Math.abs(amount).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}（${percent > 0 ? '+' : ''}${percent.toFixed(2)}%）`
              : '—'
          );
          const stopOutcomeText = hasStopOutcome ? formatOutcome(stopOutcomeAmount, stopOutcomePercent) : '—';
          const invalidationOutcomeAmount = Number(tradePlanEvaluation?.invalidationOutcomeAmount);
          const invalidationOutcomePercent = Number(tradePlanEvaluation?.invalidationOutcomePercent);
          const hasInvalidationOutcome = hasConfirmedInvalidation
            && tradePlanEvaluation?.invalidationOutcomeAmount != null
            && Number.isFinite(invalidationOutcomeAmount)
            && Number.isFinite(invalidationOutcomePercent);
          const currentOutcomeAmount = Number(tradePlanEvaluation?.unrealizedPnlAmount);
          const currentOutcomePercent = Number(tradePlanEvaluation?.unrealizedPnlPercent);
          const hasCurrentOutcome = Number(asset.current_shares || 0) > 0
            && tradePlanEvaluation?.unrealizedPnlAmount != null
            && Number.isFinite(currentOutcomeAmount)
            && Number.isFinite(currentOutcomePercent);
          return <View style={[styles.tradePlanCard, { backgroundColor: colors.card, borderColor: tradePlan ? stateColor : colors.border }]}>
            <TouchableOpacity
              style={styles.tradePlanHeader}
              onPress={() => toggleSection('tradePlan')}
              accessibilityRole="button"
              accessibilityState={{ expanded: !collapsedSections.tradePlan }}
            >
              <View style={{ flex: 1 }}><Text style={[styles.tradePlanEyebrow, { color: colors.accent }]}>全標的共用風控</Text><Text style={[styles.tradePlanTitle, { color: colors.text }]}>交易計畫</Text></View>
              {tradePlanLoading ? <ActivityIndicator size="small" color={colors.accent} /> : <View style={[styles.tradePlanBadge, { borderColor: stateColor, backgroundColor: `${stateColor}18` }]}><Text style={[styles.tradePlanBadgeText, { color: stateColor }]}>{issueLabel}</Text></View>}
              {collapsedSections.tradePlan ? <ChevronDown size={18} color={colors.textSub} /> : <ChevronUp size={18} color={colors.textSub} />}
            </TouchableOpacity>
            {!collapsedSections.tradePlan && <>
            {hasSavedRule ? <>
              <Text style={[styles.tradePlanReason, { color: colors.textSub }]}>{tradePlanEvaluation?.stateReason} 初始停損與 1R 在建立計畫時固定；目前狀態依停損位置判斷。</Text>
              {planIssueText ? <Text style={[styles.tradePlanReason, { color: colors.warning }]}>{planIssueText}</Text> : null}
              <View style={styles.tradePlanMetrics}>
                <View style={styles.tradePlanMetric}><Text style={[styles.tradePlanMetricLabel, { color: colors.textMuted }]}>ATR 倍數</Text><Text style={[styles.tradePlanMetricValue, { color: colors.text }]}>{Number(tradePlan.atr_multiplier || 1.5).toFixed(1)}×</Text></View>
                <View style={styles.tradePlanMetric}><Text style={[styles.tradePlanMetricLabel, { color: colors.textMuted }]}>計算基準</Text><Text style={[styles.tradePlanMetricValue, { color: colors.text }]}>{tradePlanEvaluation?.entryPrice ? Number(tradePlanEvaluation.entryPrice).toLocaleString() : '—'}</Text></View>
                <View style={styles.tradePlanMetric}><Text style={[styles.tradePlanMetricLabel, { color: colors.textMuted }]}>初始停損</Text><Text style={[styles.tradePlanMetricValue, { color: colors.text }]}>{tradePlanEvaluation?.initialStopPrice > 0 ? Number(tradePlanEvaluation.initialStopPrice).toLocaleString() : '—'}</Text></View>
                <View style={styles.tradePlanMetric}><Text style={[styles.tradePlanMetricLabel, { color: colors.textMuted }]}>{hasConfirmedInvalidation ? '失效時停損價' : canCalculate ? '目前停損' : '已保存停損'}</Text><Text style={[styles.tradePlanMetricValue, { color: hasConfirmedInvalidation ? stateColor : colors.negative }]}>{visibleStop > 0 ? visibleStop.toLocaleString('zh-TW', { maximumFractionDigits: 3 }) : '—'}</Text></View>
                <View style={styles.tradePlanMetric}><Text style={[styles.tradePlanMetricLabel, { color: colors.textMuted }]}>目前報酬</Text><Text style={[styles.tradePlanMetricValue, { color: Number(tradePlanEvaluation?.rewardMultiple) >= 0 ? colors.positive : colors.negative }]}>{Number.isFinite(tradePlanEvaluation?.rewardMultiple) ? `${tradePlanEvaluation.rewardMultiple >= 0 ? '+' : ''}${tradePlanEvaluation.rewardMultiple.toFixed(2)}R` : '—'}</Text></View>
                <View style={styles.tradePlanMetric}><Text style={[styles.tradePlanMetricLabel, { color: colors.textMuted }]}>停損對應風險</Text><Text style={[styles.tradePlanMetricValue, { color: colors.negative }]}>{Number.isFinite(tradePlanEvaluation?.lockedRewardMultiple) ? `${tradePlanEvaluation.lockedRewardMultiple >= 0 ? '+' : ''}${tradePlanEvaluation.lockedRewardMultiple.toFixed(2)}R` : '—'}</Text></View>
                <View style={styles.tradePlanMetric}><Text style={[styles.tradePlanMetricLabel, { color: colors.textMuted }]}>每股初始風險（固定 1R）</Text><Text style={[styles.tradePlanMetricValue, { color: colors.text }]}>{Number(tradePlanEvaluation?.initialRiskPerShare) > 0 ? Number(tradePlanEvaluation.initialRiskPerShare).toLocaleString('zh-TW', { maximumFractionDigits: 3 }) : '—'}</Text></View>
                {Number(asset.current_shares || 0) > 0 && <View style={styles.tradePlanMetric}><Text style={[styles.tradePlanMetricLabel, { color: colors.textMuted }]}>實際持有數量</Text><Text style={[styles.tradePlanMetricValue, { color: colors.text }]}>{Number(asset.current_shares).toLocaleString()}</Text></View>}
                {hasConfirmedInvalidation && tradePlanEvaluation?.invalidationPrice > 0 && <View style={styles.tradePlanMetric}><Text style={[styles.tradePlanMetricLabel, { color: colors.textMuted }]}>失效確認價</Text><Text style={[styles.tradePlanMetricValue, { color: colors.negative }]}>{Number(tradePlanEvaluation.invalidationPrice).toLocaleString()}</Text></View>}
                {hasInvalidationOutcome && <View style={styles.tradePlanMetric}><Text style={[styles.tradePlanMetricLabel, { color: colors.textMuted }]}>失效確認時損益</Text><Text style={[styles.tradePlanMetricValue, { color: invalidationOutcomeAmount < 0 ? colors.negative : colors.positive }]}>{formatOutcome(invalidationOutcomeAmount, invalidationOutcomePercent)}</Text></View>}
                {hasConfirmedInvalidation && hasCurrentOutcome && <View style={styles.tradePlanMetric}><Text style={[styles.tradePlanMetricLabel, { color: colors.textMuted }]}>目前價格損益</Text><Text style={[styles.tradePlanMetricValue, { color: currentOutcomeAmount < 0 ? colors.negative : colors.positive }]}>{formatOutcome(currentOutcomeAmount, currentOutcomePercent)}</Text></View>}
                {!hasConfirmedInvalidation && hasStopOutcome && <View style={styles.tradePlanMetric}><Text style={[styles.tradePlanMetricLabel, { color: colors.textMuted }]}>停損價預估損益</Text><Text style={[styles.tradePlanMetricValue, { color: stopOutcomeColor }]}>{stopOutcomeText}</Text></View>}
              </View>
              <Text style={[styles.tradePlanReason, { color: colors.textMuted }]}>{hasConfirmedInvalidation
                ? `原停損來源：${tradePlanEvaluation?.stopSourceLabel || '—'}；${tradePlanEvaluation?.recoveredAfterInvalidation ? '最新價格已收復原停損；待後續正式收盤確認後恢復正常。' : '原停損價僅保留作為計畫基準。'}失效確認與目前損益分別依正式收盤價及最新價格計算，未含滑價、手續費與交易稅。`
                : `目前停損來源：${tradePlanEvaluation?.stopSourceLabel || '—'}；預估損益假設能在停損價附近出場，未含滑價、手續費與交易稅。`}</Text>
            </> : <Text style={[styles.tradePlanReason, { color: colors.textSub }]}>新建立計畫時會依 MA20／MA40／MA60 支撐或 ATR 設定停損，建立後固定不自動移動；失效後盤中收復先列「已收復」，後續正式收盤站上停損才恢復正常。</Text>}
            <TouchableOpacity style={[styles.tradePlanAction, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]} onPress={() => navigation.navigate('TechnicalAnalysis', { symbol: asset.symbol, name: asset.name, averageCost: asset.average_cost || 0, currentShares: asset.current_shares || 0, marketType: asset.market_type, currency: asset.currency, analysisKey: 'tradePlan' })}><Text style={[styles.tradePlanActionText, { color: colors.accent }]}>{hasSavedRule ? '查看共用規則' : '設定共用規則'}</Text></TouchableOpacity>
            </>}
          </View>;
        })()}

        {/* ── AI Analysis Card (investment assets only) ─────────────────── */}
        {isInvestmentAsset && asset.symbol && (
          <View style={[aiCardStyles.card, { backgroundColor: colors.card }]}>
            <View style={aiCardStyles.header}>
              <TouchableOpacity
                style={aiCardStyles.headerToggle}
                onPress={() => toggleSection('ai')}
                accessibilityRole="button"
                accessibilityState={{ expanded: !collapsedSections.ai }}
              >
                <View style={[aiCardStyles.iconWrap, { backgroundColor: colors.accentSoft }]}>
                  <Text style={aiCardStyles.iconText}>🤖</Text>
                </View>
                <Text style={[aiCardStyles.title, { color: colors.text }]}>AI 智能分析</Text>
                {collapsedSections.ai ? <ChevronDown size={18} color={colors.textSub} /> : <ChevronUp size={18} color={colors.textSub} />}
              </TouchableOpacity>
              {!aiLoading && (
                <TouchableOpacity
                  onPress={runAssetAIAnalysis}
                  style={aiCardStyles.refreshBtn}
                >
                  <Text style={[aiCardStyles.refreshText, { color: colors.textSub }]}>重新分析</Text>
                </TouchableOpacity>
              )}
            </View>

            {!collapsedSections.ai && <>
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
              <>
                {aiPriceInfo && <Text style={[aiCardStyles.loadingText, { color: aiPriceInfo.isLive ? colors.accent : colors.textMuted }]}>
                  分析價格：{aiPriceInfo.label}{aiPriceInfo.price !== null ? ` ${aiPriceInfo.price.toFixed(2)} ${asset.currency || ''}` : ''}{aiPriceInfo.sourceTime ? ` · ${formatQuoteTime(aiPriceInfo.sourceTime) || aiPriceInfo.sourceTime}` : ''}
                </Text>}
                <MarkdownText text={aiAnalysis} color={colors.text} colors={colors} />
              </>
            )}
            </>}
          </View>
        )}

        {/* Unified technical chart (investment assets only) */}
        {isInvestmentAsset && asset.symbol && asset.market_type && (
          <View style={[styles.chartSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.chartTitleRow, { borderBottomColor: colors.borderLight }]}>
              <TouchableOpacity
                style={styles.chartTitleGroup}
                onPress={() => toggleSection('chart')}
                accessibilityRole="button"
                accessibilityState={{ expanded: !collapsedSections.chart }}
              >
                <BarChart3 size={18} color={PRIMARY} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.chartTitle, { color: colors.text }]}>K 線技術圖</Text>
                  <Text style={[styles.chartSubtitle, { color: colors.textMuted }]}>日線 · {technicalAnalysis ? `資料截至 ${technicalAnalysis.latest.time}` : '平均成本 · 技術指標'}</Text>
                </View>
                {collapsedSections.chart ? <ChevronDown size={17} color={colors.textSub} /> : <ChevronUp size={17} color={colors.textSub} />}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.fullChartButton, { borderColor: colors.border }]} onPress={() => navigation.navigate('TechnicalAnalysis', { symbol: asset.symbol, name: asset.name, averageCost: asset.average_cost || 0, currentShares: asset.current_shares || 0, marketType: asset.market_type, currency: asset.currency, strategyKey: technicalStrategy })}><Maximize2 size={15} color={PRIMARY} /><Text style={[styles.fullChartText, { color: PRIMARY }]}>完整分析</Text></TouchableOpacity>
            </View>

            {!collapsedSections.chart && <>
            <View style={styles.chartControls}>
              <View style={styles.periodControls}>{[['3M', '3月'], ['6M', '6月'], ['1Y', '1年']].map(([key, label]) => <TouchableOpacity key={key} style={[styles.periodButton, { backgroundColor: technicalPeriod === key ? colors.accentSoft : colors.cardAlt, borderColor: technicalPeriod === key ? PRIMARY : colors.border }]} onPress={() => setTechnicalPeriod(key)}><Text style={[styles.periodButtonText, { color: technicalPeriod === key ? PRIMARY : colors.textSub }]}>{label}</Text></TouchableOpacity>)}</View>
              <TouchableOpacity accessibilityLabel="重新載入技術圖" style={[styles.chartRefresh, { borderColor: colors.border }]} onPress={() => loadTechnicalChart(true)}><RefreshCw size={15} color={colors.textSub} /></TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strategyControls}>
              <TouchableOpacity style={[styles.layerButton, { borderColor: technicalStrategy === null ? PRIMARY : colors.border, backgroundColor: technicalStrategy === null ? colors.accentSoft : colors.cardAlt }]} onPress={() => setTechnicalStrategy(null)}><Text style={[styles.layerButtonText, { color: technicalStrategy === null ? PRIMARY : colors.textSub }]}>不選策略</Text></TouchableOpacity>
              {[
                ['candlestick', 'K 線型態'], ['divergence', 'MACD 背離'], ['rsiDivergence', 'RSI 背離'], ['kdDivergence', 'KD 背離'], ['pullback', '趨勢回檔'], ['breakout', '放量突破'], ['rsi', 'RSI5／RSI10 交叉'], ['boundary', '雙軌邊界'], ['smc', 'SMC'],
              ].map(([key, label]) => <TouchableOpacity key={key} style={[styles.layerButton, { borderColor: technicalStrategy === key ? PRIMARY : colors.border, backgroundColor: technicalStrategy === key ? colors.accentSoft : colors.cardAlt }]} onPress={() => {
                if (technicalStrategy === key) {
                  setTechnicalStrategy(null);
                  return;
                }
                setTechnicalStrategy(key);
                setTechnicalLayers(current => ({
                  ...current,
                  ma: ['candlestick', 'divergence', 'rsiDivergence', 'kdDivergence', 'pullback', 'boundary'].includes(key),
                  volume: true,
                  macd: key === 'divergence' || key === 'boundary',
                  rsi: key === 'rsi' || key === 'rsiDivergence',
                  kd: key === 'boundary' || key === 'kdDivergence',
                  levels: ['divergence', 'rsi', 'rsiDivergence', 'kdDivergence'].includes(key),
                  volumeProfile: current.volumeProfile,
                  boll: current.boll,
                }));
              }}><Text style={[styles.layerButtonText, { color: technicalStrategy === key ? PRIMARY : colors.textSub }]}>{label}</Text></TouchableOpacity>)}
            </ScrollView>

            {technicalLoading ? <View style={styles.chartLoading}><ActivityIndicator size="small" color={PRIMARY} /><Text style={[styles.chartLoadingText, { color: colors.textSub }]}>正在計算 K 線與指標…</Text></View> : technicalError || !technicalAnalysis ? <View style={styles.chartLoading}><Text style={[styles.chartErrorTitle, { color: colors.text }]}>暫時無法顯示 K 線</Text><Text style={[styles.chartLoadingText, { color: colors.textSub }]}>{technicalError || '歷史資料不足'}</Text></View> : <TechnicalAnalysisChart analysis={technicalAnalysis} colors={colors} averageCost={Number(asset.average_cost || 0)} layers={technicalLayers} periodKey={technicalPeriod} viewportKey={`${asset.market_type}:${asset.symbol}:${technicalPeriod}`} selectedStrategy={technicalStrategy} liveQuote={technicalContext.quote} />}

            {technicalAnalysis && (() => {
              const strategy = technicalAnalysis.strategies?.find(item => item.key === technicalStrategy);
              if (!strategy) return null;
              const status = strategy.status === 'confirmed' ? '已確認' : strategy.status === 'watch' ? '等待確認' : '未成立';
              const signalColor = strategy.status === 'confirmed' ? (strategy.direction === 'bearish' ? colors.negative : colors.positive) : strategy.status === 'watch' ? colors.warning : colors.textMuted;
              return <TouchableOpacity style={[styles.compactSignal, { backgroundColor: colors.cardAlt, borderColor: colors.border }]} onPress={() => navigation.navigate('TechnicalAnalysis', { symbol: asset.symbol, name: asset.name, averageCost: asset.average_cost || 0, currentShares: asset.current_shares || 0, marketType: asset.market_type, currency: asset.currency, strategyKey: technicalStrategy })}><View style={[styles.compactSignalDot, { backgroundColor: signalColor }]} /><View style={{ flex: 1 }}><Text style={[styles.compactSignalTitle, { color: colors.text }]}>{strategy.label} · {status}</Text><Text style={[styles.compactSignalMeta, { color: colors.textMuted }]}>{strategy.reason}</Text></View><Text style={[styles.compactSignalLink, { color: PRIMARY }]}>查看規則</Text></TouchableOpacity>;
            })()}

            <View style={[styles.layerControls, { borderTopColor: colors.borderLight }]}>{[['ma', 'MA20/60'], ['boll', 'BOLL'], ['levels', '支撐壓力'], ['gap', '跳空區'], ['volume', '成交量'], ['volumeProfile', '量價分佈'], ['macd', 'MACD'], ['rsi', 'RSI5/10/14'], ['kd', 'KD']].map(([key, label]) => <TouchableOpacity key={key} style={[styles.layerButton, { borderColor: technicalLayers[key] ? PRIMARY : colors.border, backgroundColor: technicalLayers[key] ? colors.accentSoft : colors.cardAlt }]} onPress={() => setTechnicalLayers(current => ({ ...current, [key]: !current[key] }))}><View style={[styles.layerDot, { backgroundColor: technicalLayers[key] ? PRIMARY : colors.textMuted }]} /><Text style={[styles.layerButtonText, { color: technicalLayers[key] ? PRIMARY : colors.textSub }]}>{label}</Text></TouchableOpacity>)}</View>
            </>}
          </View>
        )}

        {isTWStock(asset) && (
          <ChipLineChart
            data={holdingData?.map(d => ({ date: d.date, value: d.percent }))}
            label="大戶持股比例（400張以上）"
            unit="%"
            color={PRIMARY}
            colors={colors}
            expanded={!collapsedSections.holders}
            onToggle={() => toggleSection('holders')}
          />
        )}

        {/* Transaction History */}
        <View style={[styles.transactionsSection, { backgroundColor: colors.card }]}>
          <TouchableOpacity
            style={[styles.transactionsTitle, styles.transactionsTitleRow, { borderBottomColor: colors.borderLight }]}
            onPress={() => toggleSection('transactions')}
            accessibilityRole="button"
            accessibilityState={{ expanded: !collapsedSections.transactions }}
          >
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold' }}>交易歷史</Text>
            {collapsedSections.transactions ? <ChevronDown size={18} color={colors.textSub} /> : <ChevronUp size={18} color={colors.textSub} />}
          </TouchableOpacity>
          {!collapsedSections.transactions && <>
          {transactions.length > 0 ? (
            transactions.map((transaction, index) => (
              <View key={`${transaction.id}-${transaction.trans_date}-${transaction.type}-${index}`} style={[styles.transactionCard, { borderBottomColor: colors.borderLight }]}>
                <View style={styles.transactionHeader}>
                  <Text
                    style={[
                      styles.transactionType,
                      { color: transactionColor(transaction.type) },
                    ]}
                  >
                    {transaction.type === 'BUY' ? '買入' : transaction.type === 'SELL' ? '賣出' : '調整'}
                  </Text>
                  <Text style={[styles.transactionSource, { color: colors.textMuted }]}>
                    {getTransactionSourceLabel(transaction)}{transaction.ignored_from_performance ? ' · 不計績效' : ''}
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
          </>}
        </View>
      </ScrollView>

      {/* Add Transaction Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={Platform.OS === 'web' ? undefined : Keyboard.dismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'web' ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>新增交易記錄</Text>

            {isInvestmentAsset && txType === 'BUY' && tradePlan?.saved && tradePlanEntryEvaluation?.valid && (
              <View style={[styles.modalTradePlan, { backgroundColor: colors.cardAlt, borderColor: colors.accent }]}>
                <Text style={[styles.modalTradePlanTitle, { color: colors.text }]}>交易計畫參考</Text>
                <Text style={[styles.modalTradePlanText, { color: colors.textSub }]}>目前價 {Number(tradePlanEntryEvaluation.entryPrice).toLocaleString()} · 參考停損 {Number(tradePlanEntryEvaluation.stopPrice).toLocaleString()}（{tradePlanEntryEvaluation.stopSourceLabel}）· 每股／單位風險 {Number(tradePlanEntryEvaluation.initialRiskPerShare || 0).toLocaleString()}</Text>
                <TouchableOpacity onPress={() => {
                  setTxPrice(String(Number(tradePlanEntryEvaluation.entryPrice)));
                  setApplyTradePlan(true);
                }} style={[styles.modalTradePlanButton, { backgroundColor: applyTradePlan ? colors.positive : colors.accent }]}><Text style={[styles.modalTradePlanButtonText, { color: colors.accentContrast }]}>{applyTradePlan ? '已帶入參考價格' : '帶入目前價格'}</Text></TouchableOpacity>
              </View>
            )}

            <Text style={[styles.label, { color: colors.text }]}>類型</Text>
            <View style={styles.typeRow}>
              {TRANSACTION_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={[
                    styles.typeChip,
                    { backgroundColor: colors.cardAlt, borderColor: colors.border },
                    txType === t.id && styles.typeChipActive,
                    txType === t.id && { backgroundColor: transactionColor(t.id) },
                  ]}
                  onPress={() => setTxType(t.id)}
                >
                  <Text
                    style={[
                      styles.typeChipText,
                      { color: txType === t.id ? colors.accentContrast : colors.textSub },
                      txType === t.id && styles.typeChipTextActive,
                    ]}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, { color: colors.text }]}>日期</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.cardAlt, borderColor: colors.border, color: colors.text }]}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted}
              value={txDate}
              onChangeText={setTxDate}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />

            {isInvestmentAsset && (
              <>
                <Text style={[styles.label, { color: colors.text }]}>股數</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.cardAlt, borderColor: colors.border, color: colors.text }]}
                  placeholder="輸入股數"
                  placeholderTextColor={colors.textMuted}
                  value={txShares}
                  onChangeText={setTxShares}
                  keyboardType="decimal-pad"
                />
              </>
            )}

            <Text style={[styles.label, { color: colors.text }]}>
              {isInvestmentAsset ? `價格 (${asset.currency})` : `金額 (${asset.currency})`}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.cardAlt, borderColor: colors.border, color: colors.text }]}
              placeholder={isInvestmentAsset ? '輸入價格' : '輸入金額'}
              placeholderTextColor={colors.textMuted}
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
                style={[styles.cancelButton, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}
                onPress={() => { setModalVisible(false); resetAddModal(); }}
              >
                <Text style={[styles.cancelButtonText, { color: colors.textSub }]}>取消</Text>
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
        <TouchableWithoutFeedback onPress={Platform.OS === 'web' ? undefined : Keyboard.dismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'web' ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>編輯資產</Text>

            <Text style={[styles.label, { color: colors.text }]}>名稱</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.cardAlt, borderColor: colors.border, color: colors.text }]}
              placeholder="資產名稱"
              placeholderTextColor={colors.textMuted}
              value={editName}
              onChangeText={setEditName}
            />

            <Text style={[styles.label, { color: colors.text }]}>分類</Text>
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
                <Text style={[styles.label, { color: colors.text }]}>槓桿倍數</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.cardAlt, borderColor: colors.border, color: colors.text }]}
                  placeholder="例如: 1, 2, 3"
                  placeholderTextColor={colors.textMuted}
                  value={editLeverage}
                  onChangeText={setEditLeverage}
                  keyboardType="decimal-pad"
                />
              </>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.cancelButton, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}
                onPress={() => setEditModalVisible(false)}
              >
                <Text style={[styles.cancelButtonText, { color: colors.textSub }]}>取消</Text>
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
  assetSummaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
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
  entryReasonCard: { marginHorizontal: 16, marginBottom: 16, borderWidth: 1, borderRadius: 16, padding: 15 },
  entryReasonHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 38, gap: 8 },
  entryReasonTitle: { fontSize: 17, fontWeight: '800' },
  entryReasonSubtitle: { fontSize: 11, marginTop: 3 },
  entryReasonInput: { minHeight: 112, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20, marginTop: 12 },
  entryReasonFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 9 },
  entryReasonStatus: { flex: 1, fontSize: 11, lineHeight: 16 },
  entryReasonSave: { minHeight: 38, borderRadius: 10, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' },
  entryReasonSaveText: { fontSize: 12, fontWeight: '800' },
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
  tradePlanCard: { marginHorizontal: 16, marginBottom: 16, borderWidth: 1, borderRadius: 16, padding: 15 },
  tradePlanHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tradePlanEyebrow: { fontSize: 10, fontWeight: '800' },
  tradePlanTitle: { fontSize: 18, fontWeight: '900', marginTop: 2 },
  tradePlanBadge: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6 },
  tradePlanBadgeText: { fontSize: 10, fontWeight: '900' },
  tradePlanReason: { fontSize: 11, lineHeight: 17, marginTop: 9 },
  tradePlanMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  tradePlanMetric: { width: '47%' },
  tradePlanMetricLabel: { fontSize: 9, marginBottom: 3 },
  tradePlanMetricValue: { fontSize: 13, fontWeight: '800' },
  tradePlanAction: { minHeight: 39, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 13 },
  tradePlanActionText: { fontSize: 12, fontWeight: '900' },
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
  strategyControls: { paddingHorizontal: 12, paddingBottom: 9, gap: 7 },
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
  transactionsTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  transactionCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  transactionSource: { fontSize: 11, fontWeight: '700', marginLeft: 8 },
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
  modalTradePlan: { borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 16 },
  modalTradePlanTitle: { fontSize: 13, fontWeight: '900' },
  modalTradePlanText: { fontSize: 10, lineHeight: 16, marginTop: 4 },
  modalTradePlanButton: { minHeight: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 9 },
  modalTradePlanButtonText: { fontSize: 11, fontWeight: '900' },
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
    borderWidth: 1,
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
  headerToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minHeight: 34 },
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
