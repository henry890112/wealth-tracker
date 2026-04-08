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
  Dimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search as SearchIcon, Plus, X, Flame, LineChart as LineChartIcon, Clock, Calendar } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Svg, Polyline } from 'react-native-svg';
import { LineChart } from 'react-native-chart-kit';
import { supabase } from '../lib/supabase';
import {
  searchAssets,
  fetchTrendingAssets,
  fetchBOTRatesForFX,
  fetchTWStockPrice,
  fetchUSStockPrice,
  fetchCryptoPrice,
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

// NOTE: TVC:TWII, SP:SPX, NASDAQ:IXIC 在 widgetembed 免費版不支援。
// 台股加權使用 TWSE:IX0001，台股櫃買使用 TWSE:IX0023，
// 美股指數改用 FOREXCOM: CFD 免費資料來源。
const INDEX_TV_MAP = {
  '^TWII':  'TWSE:IX0001',
  '^TWOII': 'TWSE:IX0023',
  '^GSPC':  'FOREXCOM:SPXUSD',
  '^IXIC':  'FOREXCOM:NASUSD',
  '^DJI':   'FOREXCOM:DJUSD',
  '^RUT':   'TVC:RUT',
  '^VIX':   'CBOE:VIX',
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

const fetchTWStockData = async (symbol) => {
  try {
    const startDate = new Date(Date.now() - 1095 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${startDate}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.data || json.data.length === 0) return null;
    return json.data
      .map(d => ({ time: d.date, open: d.open, high: d.max, low: d.min, close: d.close, volume: d.Trading_Volume || 0 }))
      .filter(d => d.open && d.close);
  } catch (e) {
    return null;
  }
};

const fetchUSIndexData = async (symbol) => {
  try {
    const encoded = encodeURIComponent(symbol);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=5y&interval=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const timestamps = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const rows = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
      rows.push({ time: date, open: o, high: h, low: l, close: c });
    }
    return rows.length > 0 ? rows : null;
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
  #chart { width: 100%; height: 100vh; }
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
    width: window.innerWidth, height: window.innerHeight,
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
      tooltip.style.display = 'none'; return;
    }
    const d = param.seriesData.get(series);
    const color = d.close >= d.open ? 'up' : 'down';
    tooltip.innerHTML = '<div class="date">' + param.time + '</div>' +
      '<span class="' + color + '">開 ' + d.open.toFixed(2) + '　高 ' + d.high.toFixed(2) + '　低 ' + d.low.toFixed(2) + '　收 ' + d.close.toFixed(2) + '</span>';
    tooltip.style.display = 'block';
  });
  window.addEventListener('resize', () => chart.applyOptions({ width: window.innerWidth, height: window.innerHeight }));
} else {
  document.getElementById('msg').style.display = 'block';
}
</script>
</body>
</html>`;
};

const PRIMARY = '#16a34a';

const { width: screenWidth } = Dimensions.get('window');

const FX_PERIODS = [
  { label: '7d',   days: 7 },
  { label: '30d',  days: 30 },
  { label: '90d',  days: 90 },
  { label: '180d', days: 180 },
  { label: '自定義', days: null },
];

const FX_YAHOO_HIST_MAP = {
  USD: 'USDTWD=X', JPY: 'JPYTWD=X', EUR: 'EURTWD=X', GBP: 'GBPTWD=X',
  CNY: 'CNYTWD=X', HKD: 'HKDTWD=X', AUD: 'AUDTWD=X', SGD: 'SGDTWD=X', KRW: 'KRWTWD=X',
};

const isValidFxDate = (str) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  return !isNaN(new Date(str).getTime());
};


const FxSparkline = ({ sparkPoints, todayRate, prevRate }) => {
  const W = 50, H = 22;
  // Prefer multi-point sparkline; fall back to 2-point from today/prev
  const pts = (sparkPoints && sparkPoints.length >= 2)
    ? sparkPoints
    : (todayRate && prevRate && todayRate !== prevRate ? [prevRate, todayRate] : null);
  if (!pts) return (
    <Svg width={W} height={H}>
      <Polyline points={`3,${H/2} ${W-3},${H/2}`} stroke="#9ca3af" strokeWidth={1.5} fill="none" strokeLinecap="round" />
    </Svg>
  );
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 0.001;
  const pad = 3;
  const isUp = pts[pts.length - 1] >= pts[0];
  const color = isUp ? '#16a34a' : '#dc2626';
  const polyPts = pts.map((p, i) => {
    const x = pad + (i / (pts.length - 1)) * (W - pad * 2);
    const y = H - pad - ((p - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <Svg width={W} height={H}>
      <Polyline
        points={polyPts}
        stroke={color}
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
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
  const [fxDetailVisible, setFxDetailVisible] = useState(false);
  const [fxDetailFx, setFxDetailFx] = useState(null);
  const [fxDetailPeriod, setFxDetailPeriod] = useState({ label: '30d', days: 30 });
  const [fxDetailHistory, setFxDetailHistory] = useState([]);
  const [fxDetailLoading, setFxDetailLoading] = useState(false);
  const [fxDetailAmount, setFxDetailAmount] = useState('');
  const [fxDetailCustomRange, setFxDetailCustomRange] = useState(null);
  const [fxDetailCustomModalVisible, setFxDetailCustomModalVisible] = useState(false);
  const [fxDetailInputStart, setFxDetailInputStart] = useState('');
  const [fxDetailInputEnd, setFxDetailInputEnd] = useState('');
  const [sortBy, setSortBy] = useState('change_desc');
  const [chartVisible, setChartVisible] = useState(false);
  const [chartAsset, setChartAsset] = useState(null);
  const [twChartData, setTwChartData] = useState(null);
  const [twChartLoading, setTwChartLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState([]);
  const [searchPrices, setSearchPrices] = useState({});
  const [searchPriceLoading, setSearchPriceLoading] = useState(false);
  const debounceRef = useRef(null);
  const priceInputRef = useRef(null);
  const leverageInputRef = useRef(null);

  useFocusEffect(useCallback(() => { loadHotPrices(); loadFxRates(); }, []));

  useEffect(() => {
    if (chartAsset && chartAsset.market_type === 'TW' && !chartAsset.isIndex) {
      setTwChartData(null);
      setTwChartLoading(true);
      fetchTWStockData(chartAsset.symbol)
        .then(data => setTwChartData(data))
        .finally(() => setTwChartLoading(false));
    } else if (chartAsset?.isIndex) {
      // 所有大盤指數（台股 ^TWII/^TWOII、美股 ^GSPC 等）都走 Yahoo Finance
      setTwChartData(null);
      setTwChartLoading(true);
      fetchUSIndexData(chartAsset.symbol)
        .then(data => setTwChartData(data))
        .finally(() => setTwChartLoading(false));
    } else {
      setTwChartData(null);
    }
  }, [chartAsset]);

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
      // fetchBOTRatesForFX fetches today + yesterday + weekly sparkline data
      const botRates = await fetchBOTRatesForFX();

      const rates = FX_CURRENCIES.map(c => {
        const r = botRates[c.code];
        return {
          ...c,
          buyRate:     r?.buy     ?? null,
          sellRate:    r?.sell    ?? null,
          prevBuyRate: r?.prevBuy ?? null,
          sparkPoints: r?.sparkPoints ?? null,
        };
      });
      setFxRates(rates);
    } catch (e) {
      console.warn('loadFxRates error:', e.message);
    }
  };


  const fetchFxHistory = async (code, days, range) => {
    setFxDetailLoading(true);
    setFxDetailHistory([]);
    try {
      let history = null;

      // Try BOT historical CSV first (may be blocked; graceful fallback)
      if (!range && days != null) {
        const botUrl = days <= 31
          ? 'https://rate.bot.com.tw/xrt/flcsv/0/ltm'
          : 'https://rate.bot.com.tw/xrt/flcsv/0/l3m';
        try {
          const r = await fetch(botUrl, { redirect: 'error' });
          if (r.ok) {
            const lines = (await r.text()).split('\n');
            const rows = [];
            for (let i = 1; i < lines.length; i++) {
              const cols = lines[i].split(',');
              if (cols.length < 14) continue;
              if (!(cols[0] || '').includes(code)) continue;
              const dateStr = (cols[1] || '').trim().replace(/\//g, '-');
              if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
              const buy = parseFloat(cols[3]);
              const sell = parseFloat(cols[13]);
              if (!isNaN(buy) && buy > 0 && !isNaN(sell) && sell > 0)
                rows.push({ date: dateStr, buy, sell });
            }
            if (rows.length > 2) history = rows;
          }
        } catch {}
      }

      // Yahoo Finance fallback
      if (!history || history.length < 2) {
        const ticker = FX_YAHOO_HIST_MAP[code] || `${code}TWD=X`;
        let yRange = '1mo';
        if (range) {
          const d = Math.ceil((new Date(range.end) - new Date(range.start)) / 86400000);
          yRange = d <= 7 ? '5d' : d <= 30 ? '1mo' : d <= 90 ? '3mo' : d <= 180 ? '6mo' : '1y';
        } else {
          yRange = days <= 7 ? '5d' : days <= 30 ? '1mo' : days <= 90 ? '3mo' : '6mo';
        }
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${yRange}&interval=1d`
        );
        const data = await r.json();
        const res = data?.chart?.result?.[0];
        if (res) {
          const ts = res.timestamp ?? [];
          const cl = res.indicators?.quote?.[0]?.close ?? [];
          let rows = ts.map((t, i) => {
            const rate = cl[i];
            if (rate == null) return null;
            return { date: new Date(t * 1000).toISOString().split('T')[0], buy: rate, sell: rate };
          }).filter(Boolean);
          if (range) rows = rows.filter(h => h.date >= range.start && h.date <= range.end);
          history = rows;
        }
      }

      setFxDetailHistory(history || []);
    } catch (e) {
      console.warn('fetchFxHistory error:', e);
      setFxDetailHistory([]);
    } finally {
      setFxDetailLoading(false);
    }
  };

  const openFxDetailModal = (fx) => {
    setFxDetailFx(fx);
    setFxDetailAmount('');
    setFxDetailPeriod({ label: '30d', days: 30 });
    setFxDetailCustomRange(null);
    setFxDetailHistory([]);
    setFxDetailVisible(true);
    fetchFxHistory(fx.code, 30, null);
  };

  const handleFxPeriodSelect = (period) => {
    if (period.days === null) {
      const today = new Date().toISOString().split('T')[0];
      const prior = new Date();
      prior.setDate(prior.getDate() - 30);
      setFxDetailInputStart(fxDetailCustomRange?.start || prior.toISOString().split('T')[0]);
      setFxDetailInputEnd(fxDetailCustomRange?.end || today);
      setFxDetailCustomModalVisible(true);
      return;
    }
    setFxDetailPeriod(period);
    setFxDetailCustomRange(null);
    if (fxDetailFx) fetchFxHistory(fxDetailFx.code, period.days, null);
  };

  const applyFxCustomRange = () => {
    if (!isValidFxDate(fxDetailInputStart) || !isValidFxDate(fxDetailInputEnd)) {
      Alert.alert('格式錯誤', '請輸入正確的日期格式 YYYY-MM-DD');
      return;
    }
    if (fxDetailInputStart > fxDetailInputEnd) {
      Alert.alert('日期錯誤', '開始日期不能晚於結束日期');
      return;
    }
    const range = { start: fxDetailInputStart, end: fxDetailInputEnd };
    setFxDetailCustomRange(range);
    setFxDetailPeriod({ label: '自定義', days: null });
    setFxDetailCustomModalVisible(false);
    if (fxDetailFx) fetchFxHistory(fxDetailFx.code, null, range);
  };

  const openFxModal = (fx) => {
    setSelectedFx(fx);
    setFxBaseAmount('');
    setFxModal(true);
  };

  const handleFxRecord = async () => {
    const baseAmt = parseFloat(fxBaseAmount);
    if (!baseAmt || baseAmt <= 0) { Alert.alert('請輸入金額'); return; }
    if (!selectedFx?.sellRate) { Alert.alert('匯率資料不足'); return; }
    setFxAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('未登入');
      const foreignAmt = baseAmt / selectedFx.sellRate;
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
      Alert.alert('新增成功', `已記錄 ${foreignAmt.toFixed(2)} ${selectedFx.code}（${baseCurrency} ${baseAmt.toLocaleString()}）`);
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
    if (!query.trim()) { setResults([]); setSearchPrices({}); setSearchPriceLoading(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, activeTab]);

  const handleSearch = async (q = query) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearchPrices({});
    try {
      const found = await searchAssets(q, activeTab);
      setResults(found);
      // Fetch live prices for results in the background
      const fetchable = found.filter(a => a.symbol && !a.isIndex && ['TW','US','Crypto'].includes(a.market_type));
      if (fetchable.length > 0) {
        setSearchPriceLoading(true);
        let remaining = fetchable.length;
        fetchable.forEach(async (asset) => {
          try {
            let priceData = null;
            if (asset.market_type === 'TW') priceData = await fetchTWStockPrice(asset.symbol);
            else if (asset.market_type === 'US') priceData = await fetchUSStockPrice(asset.symbol);
            else if (asset.market_type === 'Crypto') priceData = await fetchCryptoPrice(asset.symbol);
            if (priceData) setSearchPrices(prev => ({ ...prev, [asset.symbol]: priceData }));
          } catch {}
          remaining--;
          if (remaining === 0) setSearchPriceLoading(false);
        });
      }
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

      await supabase.rpc('create_daily_snapshot', { p_user_id: user.id });

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
    const priceData = hotPrices[asset.symbol] || searchPrices[asset.symbol];
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
              <LineChartIcon size={18} color={colors.textSub} />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };


  const fxChartData = useMemo(() => {
    if (!fxDetailHistory || fxDetailHistory.length < 2) return null;
    const hasBuySell = fxDetailHistory.some(h => h.sell != null && h.sell !== h.buy);
    const allBuy  = fxDetailHistory.map(h => h.buy).filter(v => v != null && !isNaN(v));
    const allSell = fxDetailHistory.map(h => h.sell || h.buy).filter(v => v != null && !isNaN(v));
    const allRates = [...allBuy, ...allSell];
    if (!allRates.length) return null;
    const minRate = Math.min(...allRates);
    const maxRate = Math.max(...allRates);
    const rng = maxRate - minRate;
    const padding = rng > 0 ? rng * 0.15 : Math.abs(minRate) * 0.05 || 0.01;
    const baseline = Math.max(0, minRate - padding);
    const step = Math.max(1, Math.ceil(fxDetailHistory.length / 6));
    const labels = fxDetailHistory
      .filter((_, i) => i % step === 0 || i === fxDetailHistory.length - 1)
      .map(h => {
        const d = new Date(h.date + 'T00:00:00');
        return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`;
      });
    const mkDs = (getter, colorFn) => ({
      data: fxDetailHistory.map(h => Math.max(0, (getter(h) || 0) - baseline)),
      color: colorFn,
      strokeWidth: 2,
    });
    const datasets = hasBuySell
      ? [
          mkDs(h => h.buy,           o => `rgba(22,163,74,${o})`),
          mkDs(h => h.sell || h.buy, o => `rgba(220,38,38,${o})`),
        ]
      : [mkDs(h => h.buy, o => `rgba(22,163,74,${o})`)];
    return { labels, datasets, baseline, hasBuySell, minRate, maxRate };
  }, [fxDetailHistory]);

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
            ? <>
                {searchPriceLoading && (
                  <View style={styles.priceLoadingBar}>
                    <ActivityIndicator size="small" color="#f59e0b" />
                    <Text style={[styles.priceLoadingText, { color: colors.textMuted }]}>載入即時價格中...</Text>
                  </View>
                )}
                {results.map((asset, i) => renderAssetCard(asset, 'search', i))}
              </>
            : <View style={styles.emptyState}><Text style={[styles.emptyStateText, { color: colors.textMuted }]}>無搜尋結果</Text></View>
        ) : activeTab === 'FX' ? (
          <View style={[styles.fxTable, { backgroundColor: colors.card }]}>
            {/* Header row */}
            <View style={[styles.fxTableHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.fxHeaderCurrency, { color: colors.textMuted }]}>幣別</Text>
              <Text style={[styles.fxHeaderRate, { color: colors.textMuted }]}>買外幣</Text>
              <Text style={[styles.fxHeaderSell, { color: colors.textMuted }]}>賣外幣</Text>
            </View>
            {fxRates.length === 0
              ? <ActivityIndicator style={{ padding: 32 }} color={PRIMARY} />
              : fxRates.map((fx, i) => {
                  const fmtRate = (r) => r == null ? '—' : r >= 10 ? r.toFixed(3) : r.toFixed(4);
                  return (
                    <TouchableOpacity
                      key={fx.code}
                      style={[styles.fxRow, { borderBottomColor: colors.borderLight },
                        i === fxRates.length - 1 && { borderBottomWidth: 0 }]}
                      onPress={() => openFxDetailModal(fx)}
                      activeOpacity={0.7}
                    >
                      {/* Left: flag + name + sparkline */}
                      <View style={styles.fxColCurrency}>
                        <Text style={styles.fxFlag}>{fx.flag}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.fxCurrencyName, { color: colors.text }]}>{fx.name}</Text>
                          <Text style={[styles.fxCurrencyCode, { color: colors.textMuted }]}>{fx.code}</Text>
                        </View>
                        <FxSparkline sparkPoints={fx.sparkPoints} todayRate={fx.buyRate} prevRate={fx.prevBuyRate} />
                      </View>
                      {/* Middle: buy rate */}
                      <View style={styles.fxColRate}>
                        <Text style={[styles.fxRateMain, { color: colors.text }]}>{fmtRate(fx.buyRate)}</Text>
                      </View>
                      {/* Right: sell rate + chevron */}
                      <View style={styles.fxColSell}>
                        <Text style={[styles.fxRateMain, { color: colors.text }]}>{fmtRate(fx.sellRate)}</Text>
                        <Text style={[styles.fxChevron, { color: colors.textMuted }]}>›</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
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
                  <LineChartIcon size={16} color="#2563eb" />
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
              {selectedFx?.sellRate && (
                <Text style={[styles.label, { color: colors.textMuted, marginBottom: 8 }]}>
                  賣出匯率：1 {selectedFx.code} = {selectedFx.sellRate >= 10 ? selectedFx.sellRate.toFixed(3) : selectedFx.sellRate.toFixed(4)} {baseCurrency}
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
              {fxBaseAmount && selectedFx?.sellRate && (
                <Text style={[styles.totalText, { color: PRIMARY }]}>
                  換得：{(parseFloat(fxBaseAmount) / selectedFx.sellRate).toFixed(2)} {selectedFx?.code}
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


      {/* FX Detail Modal */}
      <Modal visible={fxDetailVisible} animationType="slide" onRequestClose={() => setFxDetailVisible(false)}>
        <View style={[styles.fxDetailContainer, { backgroundColor: colors.bg }]}>

          {/* Header */}
          <View style={[styles.fxDetailHeader, { paddingTop: insets.top + 12, borderBottomColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.fxDetailTitle, { color: colors.text }]}>
              {fxDetailFx?.flag} {fxDetailFx?.name}走勢
            </Text>
            <TouchableOpacity onPress={() => setFxDetailVisible(false)}>
              <X size={24} color={colors.textSub} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 60 }} keyboardShouldPersistTaps="handled">

            {/* Current rates */}
            <View style={[styles.fxDetailCard, { backgroundColor: colors.card }]}>
              <View style={styles.fxDetailRateRow}>
                <View style={styles.fxDetailRateItem}>
                  <Text style={[styles.fxDetailRateLabel, { color: colors.textMuted }]}>買入匯率</Text>
                  <Text style={[styles.fxDetailRateBig, { color: PRIMARY }]}>
                    {fxDetailFx?.buyRate != null
                      ? (fxDetailFx.buyRate >= 10 ? fxDetailFx.buyRate.toFixed(3) : fxDetailFx.buyRate.toFixed(4))
                      : '—'}
                  </Text>
                </View>
                <View style={[styles.fxDetailRateDivider, { backgroundColor: colors.border }]} />
                <View style={styles.fxDetailRateItem}>
                  <Text style={[styles.fxDetailRateLabel, { color: colors.textMuted }]}>賣出匯率</Text>
                  <Text style={[styles.fxDetailRateBig, { color: '#dc2626' }]}>
                    {fxDetailFx?.sellRate != null
                      ? (fxDetailFx.sellRate >= 10 ? fxDetailFx.sellRate.toFixed(3) : fxDetailFx.sellRate.toFixed(4))
                      : '—'}
                  </Text>
                </View>
              </View>
              <Text style={[styles.fxDetailRateSubtitle, { color: colors.textMuted }]}>
                TWD / 1 {fxDetailFx?.code}・台灣銀行即期
              </Text>
            </View>

            {/* Exchange calculator */}
            <View style={[styles.fxDetailCard, { backgroundColor: colors.card }]}>
              <Text style={[styles.fxDetailCardTitle, { color: colors.text }]}>換匯試算</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, borderColor: colors.inputBorder, color: colors.text, marginBottom: 0 }]}
                placeholder="輸入 TWD 金額"
                placeholderTextColor={colors.textMuted}
                value={fxDetailAmount}
                onChangeText={setFxDetailAmount}
                keyboardType="decimal-pad"
              />
              {fxDetailAmount !== '' && !isNaN(parseFloat(fxDetailAmount)) && fxDetailFx?.sellRate ? (
                <View style={styles.fxDetailCalcResult}>
                  <Text style={[styles.fxDetailCalcResultText, { color: PRIMARY }]}>
                    ≈ {(parseFloat(fxDetailAmount) / fxDetailFx.sellRate).toFixed(2)} {fxDetailFx?.code}
                  </Text>
                  <Text style={[styles.fxDetailCalcNote, { color: colors.textMuted }]}>依賣出匯率計算</Text>
                </View>
              ) : null}
            </View>

            {/* Historical chart */}
            <View style={[styles.fxDetailCard, { backgroundColor: colors.card }]}>
              <Text style={[styles.fxDetailCardTitle, { color: colors.text }]}>歷史走勢</Text>

              {/* Period selector */}
              <View style={styles.fxPeriodRow}>
                {FX_PERIODS.map(p => {
                  const isCustomActive = p.days === null && fxDetailPeriod.days === null;
                  const active = (p.days !== null && p.days === fxDetailPeriod.days) || isCustomActive;
                  return (
                    <TouchableOpacity
                      key={p.label}
                      style={[
                        styles.fxPeriodBtn,
                        { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', borderColor: colors.borderLight },
                        active && styles.fxPeriodBtnActive,
                      ]}
                      onPress={() => handleFxPeriodSelect(p)}
                      activeOpacity={0.75}
                    >
                      {p.days === null && <Calendar size={10} color={active ? 'white' : PRIMARY} style={{ marginRight: 3 }} />}
                      <Text style={[styles.fxPeriodLabel, { color: colors.textSub }, active && styles.fxPeriodLabelActive]}>
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {fxDetailLoading ? (
                <View style={{ padding: 32, alignItems: 'center' }}>
                  <ActivityIndicator color={PRIMARY} />
                </View>
              ) : fxChartData ? (
                <>
                  <LineChart
                    data={{ labels: fxChartData.labels, datasets: fxChartData.datasets }}
                    width={screenWidth - 64}
                    height={180}
                    yAxisWidth={68}
                    formatYLabel={(val) => {
                      const abs = parseFloat(val) + fxChartData.baseline;
                      return abs >= 10 ? abs.toFixed(2) : abs.toFixed(4);
                    }}
                    chartConfig={{
                      backgroundGradientFrom: colors.card,
                      backgroundGradientTo: colors.card,
                      decimalPlaces: 3,
                      color: (opacity = 1) => `rgba(22, 163, 74, ${opacity})`,
                      labelColor: (opacity = 1) => `rgba(148, 163, 184, ${opacity})`,
                      fillShadowGradient: '#16a34a',
                      fillShadowGradientOpacity: 0.08,
                      propsForDots: { r: '2.5', strokeWidth: '1.5', stroke: '#16a34a' },
                      propsForBackgroundLines: { stroke: colors.borderLight },
                    }}
                    withShadow
                    bezier
                    style={{ borderRadius: 8, marginLeft: -8, marginTop: 4 }}
                  />
                  {fxChartData.hasBuySell && (
                    <View style={styles.fxChartLegend}>
                      <View style={styles.fxLegendItem}>
                        <View style={[styles.fxLegendDot, { backgroundColor: PRIMARY }]} />
                        <Text style={[styles.fxLegendText, { color: colors.textMuted }]}>買入</Text>
                      </View>
                      <View style={styles.fxLegendItem}>
                        <View style={[styles.fxLegendDot, { backgroundColor: '#dc2626' }]} />
                        <Text style={[styles.fxLegendText, { color: colors.textMuted }]}>賣出</Text>
                      </View>
                    </View>
                  )}
                  <View style={styles.fxMinMaxRow}>
                    <View style={styles.fxMinMaxItem}>
                      <Text style={[styles.fxMinMaxLabel, { color: colors.textMuted }]}>期間最高</Text>
                      <Text style={[styles.fxMinMaxValue, { color: colors.text }]}>
                        {fxChartData.maxRate >= 10 ? fxChartData.maxRate.toFixed(3) : fxChartData.maxRate.toFixed(4)}
                      </Text>
                    </View>
                    <View style={styles.fxMinMaxItem}>
                      <Text style={[styles.fxMinMaxLabel, { color: colors.textMuted }]}>期間最低</Text>
                      <Text style={[styles.fxMinMaxValue, { color: colors.text }]}>
                        {fxChartData.minRate >= 10 ? fxChartData.minRate.toFixed(3) : fxChartData.minRate.toFixed(4)}
                      </Text>
                    </View>
                  </View>
                </>
              ) : (
                <Text style={[styles.fxDetailEmptyText, { color: colors.textMuted }]}>無歷史資料</Text>
              )}
            </View>

            {/* Record FX */}
            <TouchableOpacity
              style={styles.fxDetailRecordBtn}
              onPress={() => { setFxDetailVisible(false); setTimeout(() => openFxModal(fxDetailFx), 300); }}
            >
              <Text style={styles.fxDetailRecordBtnText}>記錄外幣</Text>
            </TouchableOpacity>

          </ScrollView>

          {/* Custom date range sub-modal */}
          <Modal
            visible={fxDetailCustomModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setFxDetailCustomModalVisible(false)}
          >
            <TouchableWithoutFeedback onPress={() => setFxDetailCustomModalVisible(false)}>
              <View style={styles.fxCustomDateOverlay}>
                <TouchableWithoutFeedback onPress={() => {}}>
                  <View style={[styles.fxCustomDateBox, { backgroundColor: colors.card }]}>
                    <Text style={[styles.fxDetailCardTitle, { color: colors.text, marginBottom: 16 }]}>自定義日期範圍</Text>
                    <Text style={[styles.label, { color: colors.textSub }]}>開始日期</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.input, borderColor: colors.inputBorder, color: colors.text }]}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textMuted}
                      value={fxDetailInputStart}
                      onChangeText={setFxDetailInputStart}
                    />
                    <Text style={[styles.label, { color: colors.textSub }]}>結束日期</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.input, borderColor: colors.inputBorder, color: colors.text }]}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textMuted}
                      value={fxDetailInputEnd}
                      onChangeText={setFxDetailInputEnd}
                    />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        style={[styles.fxCustomDateBtn, { backgroundColor: colors.cardAlt, flex: 1 }]}
                        onPress={() => setFxDetailCustomModalVisible(false)}
                      >
                        <Text style={[styles.fxCustomDateBtnText, { color: colors.textSub }]}>取消</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.fxCustomDateBtn, { backgroundColor: PRIMARY, flex: 1 }]}
                        onPress={applyFxCustomRange}
                      >
                        <Text style={[styles.fxCustomDateBtnText, { color: 'white' }]}>確認</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          </Modal>

        </View>
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
            (chartAsset.market_type === 'TW' && !chartAsset.isIndex) ||
            chartAsset.isIndex
          ) ? (
            twChartLoading ? (
              <View style={[styles.chartLoading, { backgroundColor: colors.card }]}>
                <ActivityIndicator size="large" color="#2563eb" />
                <Text style={[styles.chartLoadingText, { color: colors.textSub }]}>載入圖表中...</Text>
              </View>
            ) : (
              <WebView
                style={{ flex: 1 }}
                source={{ html: getTWStockHtml(chartAsset.symbol, twChartData) }}
                javaScriptEnabled
                domStorageEnabled
                originWhitelist={['*']}
              />
            )
          ) : chartAsset ? (
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
          ) : null}
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
  fxTable: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 12, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  fxTableHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 1,
  },
  fxHeaderCurrency: { flex: 4, fontSize: 11, fontWeight: '600' },
  fxHeaderRate: { flex: 3, fontSize: 11, fontWeight: '600', textAlign: 'right' },
  fxHeaderSell: { flex: 3, fontSize: 11, fontWeight: '600', textAlign: 'right' },
  fxRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1,
  },
  fxColCurrency: { flex: 4, flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 2 },
  fxColRate: { flex: 3, alignItems: 'flex-end' },
  fxColSell: { flex: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  fxRateSecondary: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  fxFlag: { fontSize: 20 },
  fxCurrencyName: { fontSize: 13, fontWeight: '600' },
  fxCurrencyCode: { fontSize: 10, marginTop: 1 },
  fxRateMain: { fontSize: 15, fontWeight: '700' },
  fxRatePrev: { fontSize: 10, textDecorationLine: 'line-through' },
  fxChevron: { fontSize: 18, fontWeight: '600' },

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
  priceLoadingBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  priceLoadingText: { fontSize: 12 },
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

  fxDetailContainer: { flex: 1 },
  fxDetailHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  fxDetailTitle: { fontSize: 18, fontWeight: '700' },
  fxDetailCard: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 12, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  fxDetailCardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  fxDetailRateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  fxDetailRateItem: { flex: 1, alignItems: 'center' },
  fxDetailRateDivider: { width: 1, height: 48, marginHorizontal: 8 },
  fxDetailRateLabel: { fontSize: 12, marginBottom: 4 },
  fxDetailRateBig: { fontSize: 30, fontWeight: '800' },
  fxDetailRateSubtitle: { fontSize: 11, textAlign: 'center', marginTop: 4 },
  fxDetailCalcResult: { marginTop: 12, alignItems: 'center' },
  fxDetailCalcResultText: { fontSize: 22, fontWeight: '700' },
  fxDetailCalcNote: { fontSize: 11, marginTop: 2 },
  fxDetailEmptyText: { textAlign: 'center', paddingVertical: 32, fontSize: 14 },
  fxDetailRecordBtn: {
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
    backgroundColor: '#16a34a', padding: 16, borderRadius: 12, alignItems: 'center',
  },
  fxDetailRecordBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
  fxPeriodRow: { flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  fxPeriodBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  fxPeriodBtnActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  fxPeriodLabel: { fontSize: 12, fontWeight: '500' },
  fxPeriodLabelActive: { color: 'white', fontWeight: '700' },
  fxChartLegend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 8 },
  fxLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fxLegendDot: { width: 8, height: 8, borderRadius: 4 },
  fxLegendText: { fontSize: 11 },
  fxMinMaxRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 12 },
  fxMinMaxItem: { alignItems: 'center' },
  fxMinMaxLabel: { fontSize: 11, marginBottom: 2 },
  fxMinMaxValue: { fontSize: 14, fontWeight: '700' },
  fxCustomDateOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  fxCustomDateBox: { width: '100%', borderRadius: 16, padding: 24 },
  fxCustomDateBtn: { padding: 14, borderRadius: 10, alignItems: 'center' },
  fxCustomDateBtnText: { fontSize: 15, fontWeight: '600' },

  chartLoadingText: { marginTop: 12, fontSize: 14 },
});
