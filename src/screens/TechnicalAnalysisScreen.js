import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BarChart3, Bot, Check, ChevronDown, ChevronUp, CircleAlert, Layers3, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import TechnicalAnalysisChart from '../components/TechnicalAnalysisChart';
import TechnicalReplaySlider from '../components/TechnicalReplaySlider';
import MaSwingBacktestCard from '../components/MaSwingBacktestCard';
import BenchmarkComparisonCard from '../components/BenchmarkComparisonCard';
import ValuationHistoryCard from '../components/ValuationHistoryCard';
import DcfValuationCard from '../components/DcfValuationCard';
import CorporateActionsCard from '../components/CorporateActionsCard';
import FinancialReportsCard from '../components/FinancialReportsCard';
import TradePlanCard from '../components/TradePlanCard';
import { OptionsAnalysisContent } from './OptionsAnalysisScreen';
import { analyzeTechnicalData, fetchInstitutionalDistribution, fetchMarginTradingHistory, fetchMarketTechnicalContext, technicalAnalysisPrompt } from '../services/technicalAnalysis';
import { calculateInstitutionalPressurePrices, calculateInstitutionalTotals, joinInstitutionalRowsWithClosingPrices } from '../utils/institutionalTotals';
import { STRATEGY_LIBRARY } from '../services/strategyLibrary';
import {
  ALL_SELECTABLE_STRATEGY_KEYS,
  CORE_STRATEGY_OPTIONS,
  MULTI_SELECT_STRATEGY_KEYS,
  STRATEGY_SELECTION_CATEGORIES,
  sortStrategyItems,
} from '../services/strategyOptions';
import { fetchValuationHistory } from '../services/valuation';
import { fetchDcfFundamentals } from '../services/dcf';
import { fetchCorporateActions } from '../services/corporateActions';
import { fetchFinancialReports } from '../services/financialReports';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/ThemeContext';
import { fetchLatestMarketQuote } from '../services/api';
import { ATR_MULTIPLIER_DEFAULT, ATR_MULTIPLIER_MAX, ATR_MULTIPLIER_MIN, ATR_MULTIPLIER_STEP, calculateExitManagement, normalizeAtrMultiplier } from '../services/exitManagement';
import { calculateEntryScaling } from '../services/entryScaling';
import { buildTechnicalReplayInput, getTechnicalReplayDates } from '../services/technicalReplay';
import { TTM_SQUEEZE_PRESET_OPTIONS, MA_SWING_PERIOD_OPTIONS, normalizeMaSwingSettings } from '../services/strategyEngines.js';
import { loadTtmSqueezePreset, saveTtmSqueezePreset } from '../services/strategySettings';

const LIVE_QUOTE_REFRESH_MS = 30 * 1000;
const MA_SWING_STORAGE_KEY = 'wealthtracker.technical-analysis.ma-swing.v1';
const STRATEGY_SELECTION_STORAGE_KEY = 'wealthtracker.technical-analysis.selected-strategies.v1';
const EXIT_MANAGEMENT_SETTINGS_STORAGE_KEY = 'wealthtracker.technical-analysis.exit-management.v1';
const maSwingPeriodLabel = period => period == null ? '無' : `MA${period}`;
const maSwingOptionLabel = period => period == null ? '無' : `${period} 日`;

const PERIODS = [
  { key: '3M', label: '3 個月', rows: 65 },
  { key: '6M', label: '6 個月', rows: 130 },
  { key: '1Y', label: '1 年', rows: 260 },
  { key: '3Y', label: '3 年', rows: 780 },
];

const STRATEGIES = [
  { key: 'ALL', label: '綜合', category: '整合策略' },
  ...CORE_STRATEGY_OPTIONS,
];

const SUPPLEMENTARY_ANALYSES = [
  { key: 'comparison', label: '標的比較', markets: ['TW', 'US', 'CRYPTO'] },
  { key: 'valuation', label: '公司估值', markets: ['TW', 'US'] },
  { key: 'dcf', label: 'DCF 估值', markets: ['TW', 'US'] },
  { key: 'financialReports', label: '財報分析', markets: ['TW', 'US'] },
  { key: 'corporateActions', label: '股利／除權息', markets: ['TW', 'US'] },
  { key: 'distribution', label: '籌碼分布', markets: ['TW'] },
  { key: 'margin', label: '資券動向', markets: ['TW'] },
  { key: 'entryScaling', label: '進場加碼', markets: ['TW', 'US', 'CRYPTO'] },
  { key: 'tradePlan', label: '交易計畫', markets: ['TW', 'US', 'CRYPTO'] },
  { key: 'riskManagement', label: '停損停利', markets: ['TW', 'US', 'CRYPTO'] },
  { key: 'options', label: '選擇權分析', markets: ['TW', 'US'] },
];

const LAYER_OPTIONS = [
  ['ma', 'MA5/10/20/40/60'], ['boll', 'BOLL'], ['levels', '支撐壓力'], ['gap', '跳空區'], ['contraction', '收斂區'], ['volume', '爆量'], ['volumeProfile', '量價分佈'],
  ['flow', '資金流'], ['atr', 'ATR 風控'], ['macd', 'MACD'], ['rsi', 'RSI5/10/14'], ['kd', 'KD'],
];

const DEFAULT_TECHNICAL_LAYERS = {
  ma: true,
  boll: true,
  levels: true,
  gap: true,
  contraction: true,
  volume: true,
  volumeProfile: false,
  flow: false,
  macd: true,
  rsi: true,
  kd: true,
  atr: false,
};

const money = value => Number(value || 0).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const switchAssetKey = asset => `${String(asset?.symbol || '').trim().toUpperCase()}:${String(asset?.market_type || 'US').trim().toUpperCase()}`;

const normalizeMarketType = value => {
  const market = String(value || '').trim().toUpperCase();
  return market === 'CRYPTOCURRENCY' ? 'CRYPTO' : market;
};

const normalizeComparisonTarget = (target, fallbackMarket = 'US') => {
  if (typeof target === 'string') return { symbol: target.trim().toUpperCase(), market_type: normalizeMarketType(fallbackMarket) };
  return {
    symbol: String(target?.symbol || '').trim().toUpperCase(),
    market_type: normalizeMarketType(target?.market_type || target?.marketType || target?.market || fallbackMarket),
  };
};

const comparisonTargetKey = target => switchAssetKey(normalizeComparisonTarget(target));

const buildSwitchAssets = (holdings = [], watchlist = [], current = null) => {
  const merged = new Map();
  const add = (asset, source) => {
    if (!asset?.symbol) return;
    const key = switchAssetKey(asset);
    const existing = merged.get(key);
    const shares = Number(asset.current_shares || 0);
    const cost = Number(asset.average_cost || 0);
    if (existing) {
      const previousShares = Number(existing.current_shares || 0);
      const totalShares = previousShares + shares;
      existing.average_cost = totalShares > 0
        ? ((previousShares * Number(existing.average_cost || 0)) + (shares * cost)) / totalShares
        : Number(existing.average_cost || cost || 0);
      existing.current_shares = totalShares;
      existing.isHolding = existing.isHolding || source === 'holding';
      existing.isWatchlist = existing.isWatchlist || source === 'watchlist';
      if ((!existing.name || existing.name === existing.symbol) && asset.name) existing.name = asset.name;
      return;
    }
    const symbol = String(asset.symbol).trim().toUpperCase();
    merged.set(key, {
      symbol,
      name: asset.name || symbol,
      market_type: asset.market_type || (/^\d+$/.test(symbol) ? 'TW' : 'US'),
      currency: asset.currency || (String(asset.market_type || '').toUpperCase() === 'TW' ? 'TWD' : 'USD'),
      current_shares: shares,
      average_cost: cost,
      isHolding: source === 'holding',
      isWatchlist: source === 'watchlist',
    });
  };
  holdings.forEach(asset => add(asset, 'holding'));
  watchlist.forEach(asset => add(asset, 'watchlist'));
  if (current?.symbol) add(current, 'current');
  return [...merged.values()].sort((a, b) => {
    if (a.isHolding !== b.isHolding) return a.isHolding ? -1 : 1;
    if (a.isWatchlist !== b.isWatchlist) return a.isWatchlist ? -1 : 1;
    return `${a.market_type}:${a.symbol}`.localeCompare(`${b.market_type}:${b.symbol}`);
  });
};

const quoteTime = (time, marketType) => {
  if (!time) return '';
  try {
    const timeZone = String(marketType).toUpperCase() === 'TW' ? 'Asia/Taipei' : undefined;
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(time));
  } catch {
    return String(time).replace('T', ' ').slice(0, 16);
  }
};

const compactShares = value => {
  const amount = Number(value || 0);
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  const absolute = Math.abs(amount);
  if (absolute >= 100000000) return `${sign}${(absolute / 100000000).toFixed(1)}億`;
  if (absolute >= 10000) return `${sign}${(absolute / 10000).toFixed(1)}萬`;
  return `${sign}${Math.round(absolute).toLocaleString('zh-TW')}`;
};

const exactShares = value => {
  const amount = Math.round(Number(value || 0));
  return `${amount < 0 ? '−' : ''}${Math.abs(amount).toLocaleString('zh-TW')}`;
};

const strategyStatusMeta = (item, colors) => {
  if (item?.status === 'unavailable') return { label: '資料不足', color: colors.textMuted };
  if (item?.status === 'confirmed') return { label: item.direction === 'bearish' ? '偏空已確認' : '偏多已確認', color: item.direction === 'bearish' ? colors.negative : colors.positive };
  if (item?.signal?.confirmationLost || item?.latestEvent?.confirmationLost) return { label: '確認後轉弱', color: colors.warning };
  if (item?.status === 'watch' || item?.status === 'pending') return {
    label: item.direction === 'bearish' ? '偏空觀察' : item.direction === 'bullish' ? '偏多觀察' : '訊號分歧',
    color: colors.warning,
  };
  if (['invalidated', 'expired', 'stale'].includes(item?.status)) return { label: SIGNAL_STATUS[item.status] || '已失效', color: colors.textMuted };
  return { label: '未成立', color: colors.textMuted };
};

const STRATEGY_GUIDES = {
  candlestick: '收盤後辨識低檔長綠、低檔槌子、長綠吞噬、孤島晨星、一星二陽、綠三兵，以及高檔長紅、高檔吊人、長紅吞噬、孤島夜星、一星二陰、紅三兵；高檔／低檔以已完成 K 棒的 MA5 與 MA40 排列及收盤位置判斷，仍需搭配量能與後續 K 棒確認。',
  divergence: '比較價格轉折與 MACD 動能；形成背離後，仍需突破／跌破確認線、MACD 動能同向及收盤通過 MA20 才確認。',
  rsiDivergence: '比較價格轉折與 RSI14 高低點；形成背離後，仍需突破／跌破確認線、RSI14 穿越 50 及收盤通過 MA20 才確認。',
  kdDivergence: '比較價格轉折與 KD-K 高低點；形成背離後，仍需突破／跌破確認線、K 線位於 D 線同向側及收盤通過 MA20 才確認。',
  pullback: '先確認 MA20／MA60 趨勢，再等待價格回測 MA20 約 1.5% 範圍並收回；接近均線但尚未轉強／轉弱時只列觀察。',
  breakout: '收盤突破前 20 日高點或跌破低點 0.1%，且成交量至少達 20 日均量 1.5 倍才確認。',
  rsi: '以 RSI5 與 RSI10 的短長期交叉判斷動能：RSI5 上穿 RSI10 且交叉時任一線 ≤ 40 才是低檔黃金交叉；RSI5 下穿 RSI10 且交叉時任一線 ≥ 60 才是高檔死亡交叉；支撐／壓力與價格結構只作為輔助確認。',
  boundary: '只在上下邊界行動，並完整鏡像判斷：下邊界可觀察 Sweep 收回反轉向上，也可觀察放量跌破後反抽確認向下；上邊界可觀察放量突破後回踩確認向上，也可觀察掃過收回反轉向下。中軸附近不建立訊號。',
  smc: '以 BSL、SSL、EQ 劃分折價／溢價區，等待流動性 Sweep 或 CHoCH 後回踩 FVG／OB，且預估 R:R 至少 1:2.5。',
  institutional: '台股使用外資＋投信近 5 個已公布交易日；美股與加密貨幣使用 CMF20、標準化 OBV 近 5 日斜率及相對強弱三項投票。CMF ≥ 0.05、OBV 斜率 ≥ 20 日均量的 0.1 倍、相對強弱高於 50 日均值各算偏多，反向各算偏空；三項同向才確認，分歧時只列觀察，RVOL 只標記參與強度。',
};

const CANDLESTICK_PATTERN_GUIDES = {
  'low-long-bullish': '前一根已完成 K 棒位於 MA40 附近或下方，且 MA5 位於 MA40 下方；本根收綠、實體達到當根波幅約一半以上，且收盤接近最高價。',
  'low-hammer': '先有明確下跌趨勢，且前一根 K 棒偏空；當日收漲、實體偏小，下影線至少約為實體 2.2 倍並占波幅 55% 以上，上影線不超過波幅 20%，且位於 MA40 附近或下方。',
  'bullish-engulfing': '低檔以 MA5／MA40 判斷：前一根已完成 K 棒收盤接近或低於 MA40，且 MA5 位於 MA40 下方；再由綠 K 實體完整包覆前一根紅 K。',
  'island-morning-star': '低檔背景以 MA5／MA40 判斷；第一根為長紅，小星線必須完整向下跳空，第三根長綠又必須完整向上跳空，並收回第一根實體中點以上；只有實體分離不算孤島。',
  'one-star-two-yang': '第一根收綠，第二根為小實體整理，第三根再收綠並突破第一根收盤，屬於上漲中繼確認。',
  'three-white-soldiers': '連續三根綠 K，收盤逐根墊高、開盤位於前一根實體內，低點沒有明顯破壞前低，且上影線受控。',
  'high-long-bearish': '前一根已完成 K 棒位於 MA40 附近或上方，且 MA5 位於 MA40 上方；本根收紅、實體達到當根波幅約一半以上，且收盤接近最低價。',
  'hanging-man': '先有明確上升趨勢，且前一根 K 棒偏多；當日收跌、實體偏小，下影線至少約為實體 2.2 倍並占波幅 55% 以上，上影線不超過波幅 20%，且位於 MA40 附近或上方；仍需後續 K 棒確認。',
  'bearish-engulfing': '高檔以 MA5／MA40 判斷：前一根已完成 K 棒收盤接近或高於 MA40，且 MA5 位於 MA40 上方；再由紅 K 實體完整包覆前一根綠 K。',
  'island-evening-star': '高檔背景以 MA5／MA40 判斷；第一根為長綠，小星線必須完整向上跳空，第三根長紅又必須完整向下跳空，並跌回第一根實體中點以下；只有實體分離不算孤島。',
  'one-star-two-yin': '第一根收紅，第二根為小實體整理，第三根再收紅並跌破第一根收盤，屬於下跌中繼確認。',
  'three-black-crows': '連續三根紅 K，收盤逐根走低、開盤位於前一根實體內，高點沒有明顯突破前高，且下影線受控。',
};

const CANDLESTICK_PATTERN_REFERENCE = [
  { key: 'low-long-bullish', label: '低檔長綠', direction: 'bullish', summary: 'MA5 位於 MA40 下方且股價在 MA40 附近或下方，出現長綠實體並收近最高價。', meaning: '低位買盤強勢承接，可能代表整理結束或反轉啟動。' },
  { key: 'low-hammer', label: '低檔槌子', direction: 'bullish', summary: '下跌趨勢後，前一根偏空、當日收漲，小實體帶真正長下影線。', meaning: '低檔遭遇賣壓後被買盤拉回，可能代表築底或反轉前的觀察訊號；不符合完整條件就不標記。' },
  { key: 'bullish-engulfing', label: '長綠吞噬', direction: 'bullish', summary: '低檔由 MA5／MA40 判斷，前一根紅 K 再被當日長綠實體完整包覆。', meaning: '多方力量扭轉前一日弱勢，常見於支撐或低檔反轉。' },
  { key: 'island-morning-star', label: '孤島晨星', direction: 'bullish', summary: '低檔 MA5／MA40 背景下，長紅、完整向下跳空小星、再完整向上跳空的長綠；兩側少一個缺口都不算孤島。', meaning: '空方力竭且多方表態，反轉力道較強。' },
  { key: 'one-star-two-yang', label: '一星二陽', direction: 'bullish', summary: '綠 K、量縮小星整理、再出現綠 K 延續上攻。', meaning: '上漲中繼換手完成，第三根綠 K 是攻勢重啟確認。' },
  { key: 'three-white-soldiers', label: '綠三兵', direction: 'bullish', summary: '連續三根綠 K，收盤逐根墊高且低點沒有明顯破壞。', meaning: '買盤穩定推進，常出現在底部脫離或上升初期。' },
  { key: 'high-long-bearish', label: '高檔長紅', direction: 'bearish', summary: 'MA5 位於 MA40 上方且股價在 MA40 附近或上方，出現長紅實體並收近最低價。', meaning: '獲利了結與賣壓增加，可能是上漲動能轉弱訊號。' },
  { key: 'hanging-man', label: '高檔吊人', direction: 'bearish', summary: '上升趨勢後，前一根偏多、當日收跌，小實體帶真正長下影線。', meaning: '盤中賣壓已能造成重挫，需等後續 K 棒確認見頂；不符合完整條件就不標記。' },
  { key: 'bearish-engulfing', label: '長紅吞噬', direction: 'bearish', summary: '高檔由 MA5／MA40 判斷，前一根綠 K 再被當日長紅實體完整包覆。', meaning: '空方全面壓制多方，常是高檔轉折或停利訊號。' },
  { key: 'island-evening-star', label: '孤島夜星', direction: 'bearish', summary: '高檔 MA5／MA40 背景下，長綠、完整向上跳空小星、再完整向下跳空的長紅；兩側少一個缺口都不算孤島。', meaning: '高檔島型反轉形成套牢壓力，後續修正風險升高。' },
  { key: 'one-star-two-yin', label: '一星二陰', direction: 'bearish', summary: '紅 K、小星停頓或弱反彈、再出現紅 K 破底。', meaning: '下跌中繼整理結束，第三根紅 K 確認跌勢延續。' },
  { key: 'three-black-crows', label: '紅三兵', direction: 'bearish', summary: '連續三根紅 K，收盤逐根降低且高點沒有明顯突破。', meaning: '空方賣壓持續，可能進入主跌段或加速下跌。' },
];

function CandlestickPatternIcon({ patternKey, colors }) {
  const positive = colors.positive;
  const negative = colors.negative;
  const neutral = colors.textMuted;
  const candle = (key, x, bodyY, bodyHeight, wickTop, wickBottom, color) => (
    <React.Fragment key={key}>
      <Line x1={x + 5} y1={wickTop} x2={x + 5} y2={wickBottom} stroke={color} strokeWidth="2" />
      <Rect x={x} y={bodyY} width="10" height={bodyHeight} rx="1.5" fill={color} />
    </React.Fragment>
  );
  const trend = (patternKey.includes('low') || patternKey.includes('morning')
    ? 'M2 7 L10 15 L18 24'
    : patternKey.includes('high') || patternKey.includes('hanging') || patternKey.includes('evening')
      ? 'M2 25 L10 17 L18 8'
      : null);
  let candles;
  switch (patternKey) {
    case 'low-long-bullish': candles = candle('long', 57, 6, 25, 3, 35, positive); break;
    case 'low-hammer': candles = candle('hammer', 57, 25, 7, 5, 35, positive); break;
    case 'bullish-engulfing': candles = <>{candle('previous', 24, 15, 12, 11, 31, negative)}{candle('current', 45, 7, 23, 3, 35, positive)}</>; break;
    case 'island-morning-star': candles = <>{candle('first', 6, 7, 23, 3, 35, negative)}{candle('star', 35, 16, 5, 14, 25, neutral)}{candle('last', 61, 7, 23, 3, 35, positive)}</>; break;
    case 'one-star-two-yang': candles = <>{candle('first', 6, 11, 18, 7, 33, positive)}{candle('star', 35, 16, 5, 14, 25, neutral)}{candle('last', 61, 7, 22, 3, 35, positive)}</>; break;
    case 'three-white-soldiers': candles = <>{candle('first', 6, 12, 17, 8, 33, positive)}{candle('second', 31, 8, 21, 4, 33, positive)}{candle('third', 56, 5, 24, 2, 33, positive)}</>; break;
    case 'high-long-bearish': candles = candle('long', 57, 6, 25, 3, 35, negative); break;
    case 'hanging-man': candles = candle('hanging', 57, 8, 7, 5, 35, negative); break;
    case 'bearish-engulfing': candles = <>{candle('previous', 24, 15, 12, 11, 31, positive)}{candle('current', 45, 7, 23, 3, 35, negative)}</>; break;
    case 'island-evening-star': candles = <>{candle('first', 6, 7, 23, 3, 35, positive)}{candle('star', 35, 16, 5, 14, 25, neutral)}{candle('last', 61, 7, 23, 3, 35, negative)}</>; break;
    case 'one-star-two-yin': candles = <>{candle('first', 6, 7, 22, 3, 35, negative)}{candle('star', 35, 16, 5, 14, 25, neutral)}{candle('last', 61, 11, 18, 7, 35, negative)}</>; break;
    case 'three-black-crows': candles = <>{candle('first', 6, 5, 24, 2, 33, negative)}{candle('second', 31, 8, 21, 4, 33, negative)}{candle('third', 56, 12, 17, 8, 35, negative)}</>; break;
    default: candles = null;
  }
  return <Svg width="82" height="40" viewBox="0 0 82 40"><Path d={trend || 'M2 20 L18 20'} stroke={neutral} strokeWidth="1.5" fill="none" opacity="0.75" />{candles}</Svg>;
}

function CandlestickPatternReference({ colors }) {
  const renderPattern = pattern => {
    const directionColor = pattern.direction === 'bullish' ? colors.positive : colors.negative;
    return <View key={pattern.key} style={[styles.patternReferenceCard, { backgroundColor: colors.cardAlt, borderColor: `${directionColor}66` }]}>
      <View style={styles.patternReferenceHeader}>
        <CandlestickPatternIcon patternKey={pattern.key} colors={colors} />
        <View style={styles.flex}>
          <Text style={[styles.patternReferenceTitle, { color: colors.text }]}>{pattern.label}</Text>
          <Text style={[styles.patternReferenceDirection, { color: directionColor }]}>{pattern.direction === 'bullish' ? '綠色＝上漲／多方' : '紅色＝下跌／空方'}</Text>
        </View>
      </View>
      <Text style={[styles.patternReferenceSummary, { color: colors.textSub }]}>{pattern.summary}</Text>
      <Text style={[styles.patternReferenceMeaning, { color: colors.textMuted }]}>{pattern.meaning}</Text>
    </View>;
  };
  return <View style={[styles.patternReference, { borderTopColor: colors.borderLight }]}>
    <View style={styles.patternReferenceTitleRow}>
      <View style={styles.flex}><Text style={[styles.patternReferenceSectionTitle, { color: colors.text }]}>12 種 K 線型態介紹</Text><Text style={[styles.patternReferenceNote, { color: colors.textMuted }]}>以下配色依本 App：綠漲、紅跌；不同市場 App 可能採用相反配色。</Text></View>
    </View>
    <Text style={[styles.patternReferenceGroup, { color: colors.positive }]}>多方型態（看漲／反轉向上）</Text>
    <View style={styles.patternReferenceGrid}>{CANDLESTICK_PATTERN_REFERENCE.filter(pattern => pattern.direction === 'bullish').map(renderPattern)}</View>
    <Text style={[styles.patternReferenceGroup, { color: colors.negative }]}>空方型態（看跌／反轉向下）</Text>
    <View style={styles.patternReferenceGrid}>{CANDLESTICK_PATTERN_REFERENCE.filter(pattern => pattern.direction === 'bearish').map(renderPattern)}</View>
  </View>;
}

function volumeProfileSummary(rows, binCount = 42) {
  if (!rows?.length) return null;
  const min = Math.min(...rows.map(row => Number(row.low)));
  const max = Math.max(...rows.map(row => Number(row.high)));
  const step = (max - min) / binCount;
  if (!(step > 0)) return null;
  const bins = Array.from({ length: binCount }, (_, index) => ({ lower: min + index * step, upper: min + (index + 1) * step, volume: 0 }));
  rows.forEach(row => {
    const from = Math.max(0, Math.min(binCount - 1, Math.floor((row.low - min) / step)));
    const to = Math.max(from, Math.min(binCount - 1, Math.floor((row.high - min) / step)));
    const typical = (Number(row.high) + Number(row.low) + Number(row.close)) / 3;
    const weights = [];
    let totalWeight = 0;
    for (let index = from; index <= to; index += 1) {
      const center = (bins[index].lower + bins[index].upper) / 2;
      const weight = 1 / (1 + Math.abs(center - typical) / step);
      weights.push([index, weight]);
      totalWeight += weight;
    }
    weights.forEach(([index, weight]) => { bins[index].volume += Number(row.volume || 0) * weight / totalWeight; });
  });
  const total = bins.reduce((sum, bin) => sum + bin.volume, 0);
  const pocIndex = bins.reduce((best, bin, index) => bin.volume > bins[best].volume ? index : best, 0);
  let lowIndex = pocIndex;
  let highIndex = pocIndex;
  let valueAreaVolume = bins[pocIndex].volume;
  while (valueAreaVolume < total * 0.7 && (lowIndex > 0 || highIndex < bins.length - 1)) {
    const below = lowIndex > 0 ? bins[lowIndex - 1].volume : -1;
    const above = highIndex < bins.length - 1 ? bins[highIndex + 1].volume : -1;
    if (above >= below) { highIndex += 1; valueAreaVolume += bins[highIndex].volume; }
    else { lowIndex -= 1; valueAreaVolume += bins[lowIndex].volume; }
  }
  return { poc: (bins[pocIndex].lower + bins[pocIndex].upper) / 2, vah: bins[highIndex].upper, val: bins[lowIndex].lower };
}

function LevelCard({ title, levels, color, colors }) {
  return (
    <View style={[styles.summaryCard, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
      <Text style={[styles.summaryLabel, { color: colors.textSub }]}>{title}</Text>
      {levels.length ? levels.map((level, index) => (
        <View key={`${title}-${index}`} style={styles.levelRow}>
          <Text style={[styles.levelValue, { color }]}>{money(level.lower)}–{money(level.upper)}</Text>
          <Text style={[styles.levelMeta, { color: colors.textMuted }]}>{level.touches} 次測試</Text>
        </View>
      )) : <Text style={[styles.emptyValue, { color: colors.textMuted }]}>尚未形成明確區域</Text>}
    </View>
  );
}

const SIGNAL_STATUS = {
  confirmed: '已確認',
  pending: '等待確認',
  invalidated: '已失效',
  expired: '已逾期',
  stale: '確認已過期',
};

function SignalChecklist({ signal, colors }) {
  if (!signal) return null;
  const bullish = signal.type === 'bullish';
  const statusColor = signal.status === 'confirmed'
    ? (bullish ? colors.positive : colors.negative)
    : signal.status === 'pending' ? colors.warning : colors.textMuted;
  const oscillatorKey = signal.oscillatorKey || signal.checks?.oscillatorKey || 'macd';
  const oscillatorLabel = signal.oscillatorLabel || (oscillatorKey === 'rsi' ? 'RSI14' : oscillatorKey === 'kd' ? 'KD-K' : 'MACD');
  const momentumLabel = oscillatorKey === 'rsi'
    ? `${oscillatorLabel} ${bullish ? '高於' : '低於'} 50`
    : oscillatorKey === 'kd'
      ? `K ${bullish ? '高於' : '低於'} D`
      : `MACD ${bullish ? '高於' : '低於'} Signal，柱狀體${bullish ? '為正' : '為負'}`;
  const checks = [
    { key: 'structure', label: `收盤${bullish ? '突破' : '跌破'}確認線 ${money(signal.neckline)}`, required: true },
    { key: 'momentum', label: momentumLabel, required: true },
    { key: 'trend', label: `收盤${bullish ? '站上' : '跌破'} MA20`, required: true },
    { key: 'volume', label: `成交量達 20 日均量 1.2 倍（目前 ${Number(signal.checks?.volumeRatio || 0).toFixed(1)} 倍）`, required: false },
  ];
  const timing = signal.status === 'confirmed'
    ? `確認日 ${signal.confirmationTime}`
    : signal.status === 'invalidated' ? `失效日 ${signal.invalidationTime}`
      : signal.status === 'expired' ? `已於 ${signal.expiresAt} 超過 40 個交易日`
        : signal.status === 'stale' ? `確認效力觀察至 ${signal.expiresAt}` : `最晚觀察至 ${signal.expiresAt}`;
  return (
    <View style={[styles.signalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.signalCardHeader}><View style={styles.flex}><Text style={[styles.signalEyebrow, { color: colors.textSub }]}>最新背離訊號</Text><Text style={[styles.signalTitle, { color: colors.text }]}>{bullish ? '偏多' : '偏空'}背離 · {SIGNAL_STATUS[signal.status]}</Text></View><View style={[styles.statusBadge, { backgroundColor: `${statusColor}22`, borderColor: statusColor }]}><Text style={[styles.statusBadgeText, { color: statusColor }]}>{signal.confirmationScore}/4</Text></View></View>
      <Text style={[styles.signalTiming, { color: colors.textMuted }]}>{signal.previousTime} → {signal.time} · 可辨識日 {signal.detectedAt} · {timing}</Text>
      <View style={[styles.checkList, { borderTopColor: colors.borderLight }]}>{checks.map(item => {
        const passed = Boolean(signal.checks?.[item.key]);
        return <View key={item.key} style={styles.checkRow}><View style={[styles.checkIcon, { backgroundColor: passed ? colors.positive : colors.cardAlt, borderColor: passed ? colors.positive : colors.border }]}><Text style={{ color: passed ? '#FFFFFF' : colors.textMuted, fontSize: 9, fontWeight: '900' }}>{passed ? '✓' : '–'}</Text></View><Text style={[styles.checkText, { color: passed ? colors.text : colors.textSub }]}>{item.label}</Text><Text style={[styles.checkTag, { color: item.required ? colors.warning : colors.textMuted }]}>{item.required ? '必要' : '加分'}</Text></View>;
      })}</View>
    </View>
  );
}

function InstitutionalConfirmationNote({ item, colors }) {
  const confirmation = item?.institutional;
  if (!confirmation) return null;
  const available = confirmation.available !== false;
  const passed = available && confirmation.passed;
  const bearish = item.direction === 'bearish';
  const directionLabel = bearish ? '偏空' : item.direction === 'bullish' ? '偏多' : '中性';
  const statusColor = !available ? colors.textMuted : passed ? (bearish ? colors.negative : colors.positive) : colors.warning;
  const title = !available
    ? '法人背書：資料待更新'
    : passed
      ? '法人背書：同向確認'
      : `法人背書：${directionLabel}觀察`;
  const detail = !available
    ? '法人資料尚未取得；不影響原本的技術判斷。'
    : passed
      ? `${confirmation.label || '法人與技術訊號同向'}；可納入綜合進場評估。`
      : `${confirmation.label || '法人尚未與技術訊號同向'}；技術訊號維持原判斷，綜合進場仍需等待。`;
  return <View style={[styles.institutionalNote, { backgroundColor: `${statusColor}12`, borderColor: statusColor }]}>
    <Text style={[styles.guideTitle, { color: statusColor }]}>{title}</Text>
    <Text style={[styles.institutionalNoteText, { color: colors.textSub }]}>{detail}</Text>
  </View>;
}

function AtrMultiplierSlider({ value, colors, onChange }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const ratio = Math.max(0, Math.min(1, (value - ATR_MULTIPLIER_MIN) / (ATR_MULTIPLIER_MAX - ATR_MULTIPLIER_MIN)));
  const update = event => {
    const x = Number(event.nativeEvent?.locationX || 0);
    const raw = ATR_MULTIPLIER_MIN + Math.max(0, Math.min(1, x / Math.max(1, trackWidth))) * (ATR_MULTIPLIER_MAX - ATR_MULTIPLIER_MIN);
    onChange(normalizeAtrMultiplier(raw));
  };
  return <View style={styles.atrSliderBlock}>
    <View style={styles.atrSliderHeader}><Text style={[styles.atrSliderLabel, { color: colors.textSub }]}>ATR 倍數</Text><Text style={[styles.atrSliderValue, { color: colors.accent }]}>{Number(value).toFixed(1)}×</Text></View>
    <View
      style={styles.atrSliderTouchArea}
      onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponderCapture={() => true}
      onMoveShouldSetResponderCapture={() => true}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={update}
      onResponderMove={update}
      onResponderRelease={update}
      onResponderTerminationRequest={() => false}
      onShouldBlockNativeResponder={() => true}
    >
      <View style={[styles.atrSliderTrack, { backgroundColor: colors.border }]}><View style={[styles.atrSliderFill, { width: `${ratio * 100}%`, backgroundColor: colors.accent }]} /><View style={[styles.atrSliderThumb, { left: `${ratio * 100}%`, backgroundColor: colors.accent, borderColor: colors.card }]} /></View>
    </View>
    <View style={styles.atrSliderScale}><Text style={[styles.atrSliderScaleText, { color: colors.textMuted }]}>0.5×</Text><Text style={[styles.atrSliderScaleText, { color: colors.textMuted }]}>較緊</Text><Text style={[styles.atrSliderScaleText, { color: colors.textMuted }]}>4.0×</Text></View>
  </View>;
}

function ExitManagementCard({ exitManagement, atrMultiplier, onAtrMultiplierChange, colors, isReplay = false }) {
  if (!exitManagement) return null;
  const statusColor = exitManagement.status === 'exit' ? colors.negative : exitManagement.status === 'reduce' ? colors.negative : exitManagement.status === 'tighten' ? colors.warning : exitManagement.status === 'hold' ? colors.positive : colors.textMuted;
  const statusLabel = exitManagement.statusLabel || '資料不足';
  const chipLabel = exitManagement.chipStatus === 'bullish' ? '偏多' : exitManagement.chipStatus === 'bearish' ? '偏空' : exitManagement.chipStatus === 'watch' ? '觀察' : '資料不足';
  const maLabel = exitManagement.maStatus === 'bullish' ? '偏多' : exitManagement.maStatus === 'bearish' ? '偏空' : '觀察';
  return <View style={[styles.strategyCard, { backgroundColor: colors.card, borderColor: colors.border }] }>
    <View style={styles.strategyHeader}><View style={styles.flex}><Text style={[styles.selectedEyebrow, { color: colors.accent }]}>獨立分析 · 出倉管理</Text><Text style={[styles.strategyTitle, { color: colors.text }]}>停損停利策略</Text><Text style={[styles.strategyIntro, { color: colors.textSub }]}>ATR 防線 → 均線趨勢 → 籌碼金流</Text></View><View style={[styles.strategyBadge, { backgroundColor: `${statusColor}18`, borderColor: statusColor }]}><Text style={[styles.strategyBadgeText, { color: statusColor }]}>{statusLabel}</Text></View></View>
    <Text style={[styles.strategyReason, { color: colors.textSub }]}>{exitManagement.reason}</Text>
    {isReplay && <View style={[styles.latestDataNotice, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.latestDataNoticeText, { color: colors.textMuted }]}>此獨立分析保留最新行情與持倉資料，未隨歷史回放日期重算。</Text></View>}
    <View style={[styles.atrControl, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
      <View style={styles.atrControlHeader}><Text style={[styles.atrControlTitle, { color: colors.text }]}>ATR · 初始防線與動態雜訊空間</Text><Text style={[styles.atrControlHint, { color: colors.textMuted }]}>預設 1.5×</Text></View>
      <AtrMultiplierSlider value={atrMultiplier} colors={colors} onChange={onAtrMultiplierChange} />
      <Text style={[styles.atrControlNote, { color: colors.textMuted }]}>倍數越小停損越近，越大越能容納波動；圖上結果為獨立策略試算。</Text>
    </View>
    <View style={[styles.hybridList, { borderTopColor: colors.borderLight }]}>
      {[
        ['ATR', `ATR14 ${money(exitManagement.atr14)} · 初始 ${money(exitManagement.initialStop)} · 有效 ${money(exitManagement.effectiveStop)}（${exitManagement.stopMode}）`, exitManagement.atrBroken ? colors.negative : colors.accent],
        ['均線', `MA20 ${money(exitManagement.ma20)} · MA40 ${money(exitManagement.ma40)} · ${maLabel}`, exitManagement.maStatus === 'bearish' ? colors.negative : exitManagement.maStatus === 'watch' ? colors.warning : colors.positive],
        ['籌碼金流', `${exitManagement.chipSource} · ${chipLabel} · ${exitManagement.chipReason}`, exitManagement.chipStatus === 'bearish' ? colors.negative : exitManagement.chipStatus === 'watch' ? colors.warning : exitManagement.chipStatus === 'bullish' ? colors.positive : colors.textMuted],
      ].map(([label, value, color]) => <View key={label} style={styles.hybridRow}><View style={[styles.checkIcon, { backgroundColor: `${color}22`, borderColor: color }]}><Text style={{ color, fontSize: 9, fontWeight: '900' }}>•</Text></View><View style={styles.flex}><Text style={[styles.hybridTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.hybridText, { color: colors.textMuted }]}>{value}</Text></View></View>)}
    </View>
    <View style={[styles.metricList, { borderTopColor: colors.borderLight }]}>{[
      ['計算基準', `${money(exitManagement.entry)} · ${exitManagement.basis}`],
      ['初始停損', money(exitManagement.initialStop)],
      ['有效停損', `${money(exitManagement.effectiveStop)} · ${exitManagement.stopMode}`],
      ['第一目標', money(exitManagement.target1)],
      ['第二目標', money(exitManagement.target2)],
      ['1R／2R', `${money(exitManagement.oneR)}／${money(exitManagement.twoR)}`],
    ].map(([label, value]) => <View key={label} style={styles.metricRow}><Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text><Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text></View>)}</View>
    <Text style={[styles.guideText, { color: colors.textMuted }]}>均線與籌碼金流同時轉弱會列為減碼觀察；跌破有效停損則直接列為出倉。這是研究試算，不會自動替你下單。</Text>
  </View>;
}

function EntryScalingCard({ plan, atrMultiplier, onAtrMultiplierChange, colors, isReplay = false }) {
  if (!plan) return null;
  const positive = ['initial', 'add1', 'add2'].includes(plan.status);
  const caution = ['hold', 'tighten', 'noAdd', 'waitEntry'].includes(plan.status);
  const statusColor = positive ? colors.positive : caution ? colors.warning : colors.textMuted;
  const check = value => value ? '已確認' : '未確認';
  return <View style={[styles.strategyCard, { backgroundColor: colors.card, borderColor: colors.border }] }>
    <View style={styles.strategyHeader}><View style={styles.flex}><Text style={[styles.selectedEyebrow, { color: colors.accent }]}>獨立分析 · 部位建立</Text><Text style={[styles.strategyTitle, { color: colors.text }]}>進場與加碼策略</Text><Text style={[styles.strategyIntro, { color: colors.textSub }]}>ATR 波動 → 均線趨勢 → 籌碼金流</Text></View><View style={[styles.strategyBadge, { backgroundColor: `${statusColor}18`, borderColor: statusColor }]}><Text style={[styles.strategyBadgeText, { color: statusColor }]}>{plan.statusLabel || '資料不足'}</Text></View></View>
    <Text style={[styles.strategyReason, { color: colors.textSub }]}>{plan.reason}</Text>
    {isReplay && <View style={[styles.latestDataNotice, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.latestDataNoticeText, { color: colors.textMuted }]}>此獨立分析保留最新行情與持倉資料，未隨歷史回放日期重算。</Text></View>}
    <View style={[styles.atrControl, { backgroundColor: colors.cardAlt, borderColor: colors.border }] }>
      <View style={styles.atrControlHeader}><Text style={[styles.atrControlTitle, { color: colors.text }]}>ATR · 突破、回測與風控空間</Text><Text style={[styles.atrControlHint, { color: colors.textMuted }]}>預設 1.5×</Text></View>
      <AtrMultiplierSlider value={atrMultiplier} colors={colors} onChange={onAtrMultiplierChange} />
      <Text style={[styles.atrControlNote, { color: colors.textMuted }]}>ATR 倍數會同步調整有效突破門檻、初始停損與每一個 R 的距離。</Text>
    </View>
    <View style={[styles.hybridList, { borderTopColor: colors.borderLight }] }>{[
      ['均線趨勢', `MA20 ${money(plan.ma20)} · MA40 ${money(plan.ma40)} · ${check(plan.trendPassed)}`, plan.trendPassed ? colors.positive : colors.warning],
      ['ATR 觸發', `${plan.breakoutPassed ? '有效突破' : plan.pullbackPassed ? '回測守穩' : '等待觸發'} · 門檻 ${money(plan.breakoutLevel)}`, plan.volatilityPassed ? colors.positive : colors.warning],
      ['籌碼金流', `${plan.capitalFlow?.source || 'CMF20／OBV／MFI'} · ${plan.capitalFlow?.summary || ''} CMF20 ${Number.isFinite(Number(plan.cmf)) ? Number(plan.cmf).toFixed(2) : '—'} · OBV ${plan.obvStrong ? '創高' : '未創高'} · MFI ${Number.isFinite(Number(plan.mfi)) ? Number(plan.mfi).toFixed(1) : '—'}`, plan.flowPassed ? colors.positive : plan.flowWeak ? colors.negative : colors.warning],
    ].map(([label, value, color]) => <View key={label} style={styles.hybridRow}><View style={[styles.checkIcon, { backgroundColor: `${color}22`, borderColor: color }]}><Text style={{ color, fontSize: 9, fontWeight: '900' }}>•</Text></View><View style={styles.flex}><Text style={[styles.hybridTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.hybridText, { color: colors.textMuted }]}>{value}</Text></View></View>)}</View>
    <View style={[styles.metricList, { borderTopColor: colors.borderLight }] }>{[
      ['目前判定', plan.allocation || '等待'],
      ['計算基準', `${money(plan.entry)} · ${plan.basis}`],
      [plan.hasPosition ? '初始停損' : '若進場・初始停損', money(plan.initialStop)],
      [plan.hasPosition ? '目前保護線' : '若進場・保護線', `${money(plan.activeStop)} · ${plan.stopLabel}`],
      [plan.hasPosition ? '1R／第一次加碼' : '若進場・1R', `${money(plan.oneR)} · +30%`],
      [plan.hasPosition ? '2R／第二次加碼' : '若進場・2R', `${money(plan.twoR)} · +20%`],
      [plan.hasPosition ? '3R／停止加碼' : '若進場・3R', money(plan.threeR)],
      ['相對量', `${Number(plan.volumeRatio || 0).toFixed(2)} 倍`],
    ].map(([label, value]) => <View key={label} style={styles.metricRow}><Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text><Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text></View>)}</View>
    <Text style={[styles.guideText, { color: colors.textMuted }]}>{plan.hasPosition ? '只有在價格高於成本且條件確認時才依序加碼 30%、20%；低於成本時不攤平。' : '目前沒有持倉時，只有均線趨勢、ATR 觸發與籌碼金流三項同時確認才顯示「可試單進場」，首單建議為預計配置的 30%～40%。'}訊號僅供研究且不會自動下單。</Text>
  </View>;
}

function HybridStrategyCard({ hybrid, atrPosition, colors, isReplay = false, asOfDate = null }) {
  const [expanded, setExpanded] = useState(true);
  if (!hybrid) return null;
  const confirmed = hybrid.status === 'confirmed';
  const statusColor = confirmed ? colors.positive : hybrid.status === 'watch' ? colors.warning : colors.textMuted;
  const gates = [
    ['大趨勢', hybrid.gates?.trend],
    ['放量突破', hybrid.gates?.breakout],
    ['趨勢回檔', hybrid.gates?.pullback],
    ['量能確認', hybrid.gates?.volume],
    ['相對強弱', hybrid.gates?.relativeStrength],
    ['法人背書', hybrid.gates?.institutional],
  ];
  return <View style={[styles.strategyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.strategyHeader}><View style={styles.flex}><Text style={[styles.selectedEyebrow, { color: colors.accent }]}>{isReplay ? `歷史回放 · 截至 ${asOfDate || '—'}` : '目前選擇'}</Text><Text style={[styles.strategyTitle, { color: colors.text }]}>分層混合策略</Text><Text style={[styles.strategyIntro, { color: colors.textSub }]}>趨勢 → 突破或回檔 → 量能 → 相對強弱 → 法人背書</Text></View><View style={styles.collapsibleStatus}><View style={[styles.strategyBadge, { backgroundColor: `${statusColor}18`, borderColor: statusColor }]}><Text style={[styles.strategyBadgeText, { color: statusColor }]}>{confirmed ? '進場確認' : hybrid.status === 'watch' ? '等待確認' : '不進場'}</Text></View>{expanded ? <ChevronUp size={18} color={colors.textMuted} /> : <ChevronDown size={18} color={colors.textMuted} />}</View></TouchableOpacity>
    {expanded && <>
    <Text style={[styles.strategyReason, { color: colors.textSub }]}>{hybrid.reason}</Text>
    <View style={[styles.hybridList, { borderTopColor: colors.borderLight }]}>{gates.map(([label, gate]) => {
      const gateColor = gate?.passed ? colors.positive : gate?.candidate ? colors.warning : colors.textMuted;
      return <View key={label} style={styles.hybridRow}><View style={[styles.checkIcon, { backgroundColor: gate?.passed ? gateColor : colors.cardAlt, borderColor: gateColor }]}><Text style={{ color: gate?.passed ? '#FFFFFF' : gateColor, fontSize: 9, fontWeight: '900' }}>{gate?.passed ? '✓' : gate?.candidate ? '!' : '–'}</Text></View><View style={styles.flex}><Text style={[styles.hybridTitle, { color: colors.text }]}>{label}</Text><Text style={[styles.hybridText, { color: colors.textMuted }]}>{gate?.label || '資料不足'}</Text></View></View>;
    })}</View>
    {atrPosition ? <View style={[styles.hybridRisk, { backgroundColor: colors.accentSoft }]}>
      <Text style={[styles.hybridRiskTitle, { color: colors.accent }]}>ATR 持倉風控 · {atrPosition.status === 'risk' ? '盤中風險' : atrPosition.status === 'recovered' ? '盤中已收回' : '監控中'}</Text>
      <Text style={[styles.hybridRiskText, { color: colors.textSub }]}>進場 {money(atrPosition.entry_price)} · ATR14 {money(atrPosition.entry_atr)}</Text>
      <Text style={[styles.hybridRiskText, { color: colors.textSub }]}>初始停損 {money(atrPosition.initial_stop)} · 移動停損 {money(atrPosition.trailing_stop)} · 目前有效 {money(atrPosition.effective_stop)}</Text>
    </View> : confirmed ? <View style={[styles.hybridRisk, { backgroundColor: colors.positiveSoft }]}><Text style={[styles.hybridRiskTitle, { color: colors.positive }]}>ATR 風控起點</Text><Text style={[styles.hybridRiskText, { color: colors.textSub }]}>進場 {money(hybrid.risk?.entryPrice)} · ATR14 {money(hybrid.risk?.atr14)} · 初始停損 {money(hybrid.risk?.initialStop)}</Text></View> : Number(hybrid.risk?.atr14) > 0 && <View style={[styles.hybridRisk, { backgroundColor: colors.cardAlt }]}><Text style={[styles.hybridRiskTitle, { color: colors.textMuted }]}>預估 ATR 風險（尚未進場）</Text><Text style={[styles.hybridRiskText, { color: colors.textSub }]}>若以收盤 {money(hybrid.risk?.entryPrice)} 為基準，ATR14 {money(hybrid.risk?.atr14)}，2 ATR 風險線約 {money(hybrid.risk?.initialStop)}。</Text></View>}
    {hybrid.warnings?.macd && <Text style={[styles.hybridWarning, { color: colors.warning }]}>MACD 風險：{hybrid.warnings.macd}</Text>}
    </>}
  </View>;
}

function SelectedStrategyCard({ analysis, selectedStrategy, atrPosition, colors, isReplay = false, asOfDate = null }) {
  const [expanded, setExpanded] = useState(true);
  if (selectedStrategy === 'ALL') return <HybridStrategyCard hybrid={analysis.hybrid} atrPosition={atrPosition} colors={colors} isReplay={isReplay} asOfDate={asOfDate} />;
  const item = analysis.strategies.find(strategy => strategy.key === selectedStrategy);
  if (!item) return null;
  const meta = strategyStatusMeta(item, colors);
  const signal = item.signal || item.latestEvent || item.events?.at(-1);
  const levelRows = [];
  if (['divergence', 'rsiDivergence', 'kdDivergence'].includes(selectedStrategy) && signal?.neckline) {
    levelRows.push(['確認線', money(signal.neckline)], ['背離區間', `${signal.previousTime || '—'} → ${signal.time || '—'}`]);
    if (Number.isFinite(Number(signal.previousOscillator)) && Number.isFinite(Number(signal.oscillator))) levelRows.push([signal.oscillatorLabel || '指標值', `${Number(signal.previousOscillator).toFixed(2)} → ${Number(signal.oscillator).toFixed(2)}`]);
  }
  if (selectedStrategy === 'pullback' && item.level) levelRows.push(['MA20 回檔線', money(item.level)]);
  if (selectedStrategy === 'breakout') levelRows.push(['20 日界線', item.level ? money(item.level) : '仍在區間內'], ['相對量', `${Number(item.volumeRatio || 0).toFixed(2)} 倍`]);
  if (selectedStrategy === 'rsi') {
    levelRows.push(['RSI5／RSI10', `${Number.isFinite(analysis.latest.rsi5) ? analysis.latest.rsi5.toFixed(1) : '—'}／${Number.isFinite(analysis.latest.rsi10) ? analysis.latest.rsi10.toFixed(1) : '—'}`]);
    levelRows.push(['交叉門檻', '黃金：任一線 ≤ 40；死亡：任一線 ≥ 60']);
  }
  if (selectedStrategy === 'boundary' && item.levels) levelRows.push(['下邊界', money(item.levels.lower)], ['中軸', money(item.levels.midpoint)], ['上邊界', money(item.levels.upper)]);
  if (selectedStrategy === 'smc' && item.levels) levelRows.push(['SSL', money(item.levels.ssl)], ['EQ 50%', money(item.levels.eq)], ['BSL', money(item.levels.bsl)]);
  if (selectedStrategy === 'candlestick') {
    if (signal?.patternLabel) levelRows.push(['最近型態', signal.patternLabel]);
    if (signal?.time) levelRows.push(['形成日期', signal.time]);
    if (item.patternNames?.length) levelRows.push(['近期偵測', item.patternNames.join('、')]);
  }
  if (signal?.entryLower && signal?.entryUpper) levelRows.push(['進場區', `${money(signal.entryLower)}–${money(signal.entryUpper)}`]);
  if (signal?.stop) levelRows.push(['失效／停損', money(signal.stop)]);
  if (signal?.target || signal?.target1) levelRows.push(['第一目標', money(signal.target || signal.target1)]);
  if (signal?.rr) levelRows.push(['預估 R:R', `1:${Number(signal.rr).toFixed(1)}`]);
  const candlestickGuide = selectedStrategy === 'candlestick'
    ? CANDLESTICK_PATTERN_GUIDES[signal?.patternKey] || STRATEGY_GUIDES.candlestick
    : STRATEGY_GUIDES[selectedStrategy];
  const guideTitle = selectedStrategy === 'candlestick' && signal?.patternLabel
    ? `怎麼判斷：${signal.patternLabel}`
    : '怎麼判斷？';
  return <View style={[styles.strategyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.strategyHeader}><View style={styles.flex}><Text style={[styles.selectedEyebrow, { color: colors.accent }]}>{isReplay ? `歷史回放 · 截至 ${asOfDate || '—'}` : '目前選擇'}</Text><Text style={[styles.strategyTitle, { color: colors.text }]}>{item.label}</Text></View><View style={styles.collapsibleStatus}><View style={[styles.strategyBadge, { backgroundColor: `${meta.color}18`, borderColor: meta.color }]}><Text style={[styles.strategyBadgeText, { color: meta.color }]}>{meta.label}</Text></View>{expanded ? <ChevronUp size={18} color={colors.textMuted} /> : <ChevronDown size={18} color={colors.textMuted} />}</View></TouchableOpacity>
    {expanded && <>
    <Text style={[styles.strategyReason, { color: colors.textSub }]}>{item.reason}</Text>
    <InstitutionalConfirmationNote item={item} colors={colors} />
    <View style={[styles.guideBlock, { backgroundColor: colors.cardAlt }]}><Text style={[styles.guideTitle, { color: colors.text }]}>{guideTitle}</Text><Text style={[styles.guideText, { color: colors.textSub }]}>{candlestickGuide}</Text></View>
    {levelRows.length > 0 && <View style={[styles.metricList, { borderTopColor: colors.borderLight }]}>{levelRows.map(([label, value]) => <View key={`${label}-${value}`} style={styles.metricRow}><Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text><Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text></View>)}</View>}
    {selectedStrategy === 'candlestick' && <CandlestickPatternReference colors={colors} />}
    {['divergence', 'rsiDivergence', 'kdDivergence'].includes(selectedStrategy) && <SignalChecklist signal={signal} colors={colors} />}
    </>}
  </View>;
}

function StrategyLibraryCard({ strategy, result, colors, isReplay = false, asOfDate = null, squeezePreset = 'standard', onSqueezePresetChange = null, maSwingSettings, onMaSwingChange }) {
  const [expanded, setExpanded] = useState(true);
  if (!strategy) return null;
  const live = result?.computed;
  const meta = live ? strategyStatusMeta(result, colors) : { label: '研究框架', color: colors.accent };
  const signal = result?.signal || result?.latestEvent || result?.events?.at(-1);
  const obvText = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 0 }) : '—';
  const isTtmSqueeze = strategy.key === 'indicator-bollinger-squeeze';
  const isMoneyFlowDivergence = ['volume-mfi-divergence', 'volume-cmf-divergence'].includes(result?.key);
  const isMarketStructure = result?.key === 'trend-market-structure';
  const ttmRows = isTtmSqueeze && live ? [
    ['Squeeze 狀態', signal?.squeezeOn ? `ON · 已壓縮 ${signal.squeezeBars || 0} 根` : signal?.releaseTime ? `已釋放 · ${signal.releaseTime}` : 'OFF／未形成完整擠壓'],
    ['KC 參數', `EMA20 ± ATR20 × ${Number(signal?.kcMultiplier || 0).toFixed(2)}`],
    ['突破條件', `${signal?.rangeHigh != null ? money(signal.rangeHigh) : '—'} ／ ${signal?.rangeLow != null ? money(signal.rangeLow) : '—'} · ${signal?.breakoutPassed ? '已通過' : '未通過'}`],
    ['量能條件', `RVOL ${Number(signal?.volumeRatio || 0).toFixed(2)} 倍／門檻 ${Number(signal?.volumeThreshold || 0).toFixed(2)} · ${signal?.volumePassed ? '已通過' : '未通過'}`],
    ['TTM 動能', `${Number.isFinite(Number(signal?.momentum)) ? Number(signal.momentum).toFixed(2) : '—'} · ${signal?.momentumPassed && signal?.momentumStrengthened ? '同向已通過' : '尚未確認'}`],
    ['確認規則', `釋放後 ${signal?.confirmationWindow || 3} 根內，突破＋量能＋動能同向才確認`],
  ] : [];
  const liveRows = live ? [
    [isReplay ? '歷史狀態' : '即時狀態', meta.label],
    [isReplay ? '截至當日判定' : '即時判定', result.reason],
    ...ttmRows,
    result?.key === 'indicator-kd-cross' ? ['判斷門檻', '黃金：K 上穿 D 且 K 或 D ≤ 35；死亡：K 下穿 D 且 K 或 D ≥ 65'] : null,
    isMarketStructure && signal?.structureLabel ? ['目前結構', signal.structureBroken ? `${signal.structureLabel} 已受破壞，等待反向結構確認` : signal.structureLabel] : null,
    isMarketStructure && signal?.previousHigh != null && signal?.latestHigh != null ? ['波段高點', `${signal.previousHighTime} ${money(signal.previousHigh)} → ${signal.latestHighTime} ${money(signal.latestHigh)}（${signal.highState === 'EH' ? '持平，待確認' : signal.highState}）`] : null,
    isMarketStructure && signal?.previousLow != null && signal?.latestLow != null ? ['波段低點', `${signal.previousLowTime} ${money(signal.previousLow)} → ${signal.latestLowTime} ${money(signal.latestLow)}（${signal.lowState === 'EL' ? '持平，待確認' : signal.lowState}）`] : null,
    isMarketStructure && signal?.candidatePivotTime ? ['候選轉折', `${signal.candidatePivotTime} ${money(signal.candidatePivotValue)} 候選${signal.candidatePivotKind === 'high' ? '高點' : '低點'}；尚待右側 ${signal.candidateBarsRemaining || 0} 根 K 線`] : null,
    isMarketStructure ? ['轉折確認', `高低點必須依時間交錯，且左右各 ${signal?.pivotStrength || 3} 根 K 線；最新未完成轉折只以灰色虛線顯示`] : null,
    result?.key === 'volume-obv-divergence' && signal?.firstTime && signal?.secondTime ? ['背離區間', `${signal.firstTime} → ${signal.secondTime}`] : null,
    result?.key === 'volume-obv-divergence' && signal?.firstPrice != null && signal?.secondPrice != null ? ['價格轉折', `${money(signal.firstPrice)} → ${money(signal.secondPrice)}`] : null,
    result?.key === 'volume-obv-divergence' && signal?.firstObv != null && signal?.secondObv != null ? ['OBV 轉折', `${obvText(signal.firstObv)} → ${obvText(signal.secondObv)}`] : null,
    isMoneyFlowDivergence && signal?.firstTime && signal?.secondTime ? ['背離區間', `${signal.firstTime} → ${signal.secondTime}`] : null,
    isMoneyFlowDivergence && signal?.firstPrice != null && signal?.secondPrice != null ? ['價格轉折', `${money(signal.firstPrice)} → ${money(signal.secondPrice)}`] : null,
    isMoneyFlowDivergence && signal?.firstIndicator != null && signal?.secondIndicator != null ? [`${signal.indicatorName} 轉折`, `${Number(signal.firstIndicator).toFixed(signal.indicatorName === 'MFI' ? 1 : 2)} → ${Number(signal.secondIndicator).toFixed(signal.indicatorName === 'MFI' ? 1 : 2)}`] : null,
    isMoneyFlowDivergence && signal?.confirmationLevel != null ? ['價格確認線', money(signal.confirmationLevel)] : null,
    isMoneyFlowDivergence ? ['背離共振', signal?.resonance ? `是 · 同時出現 ${signal.resonanceWith} 同方向背離` : '否 · 僅本指標成立'] : null,
    signal?.entryLower != null && signal?.entryUpper != null ? ['計算進場區', `${money(signal.entryLower)}–${money(signal.entryUpper)}`] : null,
    signal?.stop != null ? ['計算停損／失效', money(signal.stop)] : null,
    signal?.target != null || signal?.target1 != null ? ['計算目標', money(signal.target ?? signal.target1)] : null,
  ].filter(Boolean) : [];
  const rows = [
    ['適用環境', strategy.market],
    ['進場觸發', strategy.trigger],
    ['失效／停損', strategy.invalidation],
    ['退場邏輯', strategy.exit],
    ['主要優點', strategy.pros],
    ['主要風險', strategy.risks],
  ];
  return (
    <View style={[styles.strategyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.strategyHeader}>
        <View style={styles.flex}>
          <Text style={[styles.selectedEyebrow, { color: colors.accent }]}>{live ? (isReplay ? `策略庫 · 歷史回放截至 ${asOfDate || '—'}` : '策略庫 · 即時計算') : '策略庫 · 研究框架'}</Text>
          <Text style={[styles.strategyTitle, { color: colors.text }]}>{strategy.label}</Text>
          <Text style={[styles.strategyIntro, { color: colors.textSub }]}>{strategy.category}</Text>
        </View>
        <View style={styles.collapsibleStatus}>
          <View style={[styles.strategyBadge, { backgroundColor: `${meta.color}18`, borderColor: meta.color }]}>
            <Text style={[styles.strategyBadgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
          {expanded ? <ChevronUp size={18} color={colors.textMuted} /> : <ChevronDown size={18} color={colors.textMuted} />}
        </View>
      </TouchableOpacity>
      {expanded && <>
      {strategy.key === 'trend-ma-swing' && <View style={[styles.squeezePresetPanel, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
        <Text style={[styles.squeezePresetTitle, { color: colors.text }]}>進出場均線（日 K・簡單移動平均）</Text>
        {[['entry', '進場線'], ['shortExit', '第一段出場（賣 50%）'], ['longExit', '全部出場']].map(([key, label]) => <View key={key} style={{ gap: 6 }}>
          <Text style={[styles.squeezePresetValue, { color: colors.text }]}>{label} · {maSwingPeriodLabel(maSwingSettings?.[key])}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {MA_SWING_PERIOD_OPTIONS.map(period => <TouchableOpacity key={period == null ? 'none' : period} disabled={!onMaSwingChange}
              accessibilityRole="button" accessibilityLabel={`${label} ${period == null ? '不使用' : `${period} 日均線`}`} accessibilityState={{ selected: maSwingSettings?.[key] === period, disabled: !onMaSwingChange }}
              onPress={() => onMaSwingChange(key, period)}
              style={[styles.squeezePresetButton, { flex: 0, minWidth: 54, minHeight: 44, backgroundColor: maSwingSettings?.[key] === period ? colors.accentSoft : colors.card, borderColor: maSwingSettings?.[key] === period ? colors.accent : colors.border }]}>
              <Text style={[styles.squeezePresetButtonText, { color: maSwingSettings?.[key] === period ? colors.accent : colors.textSub }]}>{maSwingOptionLabel(period)}</Text>
            </TouchableOpacity>)}
          </ScrollView>
        </View>)}
        {[['abovePeriod', '收盤站在'], ['risingPeriod', '近 5 日呈上揚']].map(([key, label]) => {
          const period = maSwingSettings?.[key];
          const currentLabel = key === 'abovePeriod'
            ? period == null ? '收盤站在均線上方 · 不限制' : `收盤站在 ${maSwingPeriodLabel(period)} 上方`
            : period == null ? '均線近 5 日呈上揚 · 不限制' : `${maSwingPeriodLabel(period)} ${label}`;
          return <View key={key} style={{ gap: 6 }}>
            <Text style={[styles.squeezePresetValue, { color: colors.text }]}>{currentLabel}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {MA_SWING_PERIOD_OPTIONS.map(option => <TouchableOpacity key={option == null ? 'none' : option} disabled={!onMaSwingChange}
                accessibilityRole="button" accessibilityLabel={`${currentLabel} ${option == null ? '不限制' : `使用 ${option} 日均線`}`} accessibilityState={{ selected: period === option, disabled: !onMaSwingChange }}
                onPress={() => onMaSwingChange(key, option)}
                style={[styles.squeezePresetButton, { flex: 0, minWidth: 54, minHeight: 44, backgroundColor: period === option ? colors.accentSoft : colors.card, borderColor: period === option ? colors.accent : colors.border }]}>
                <Text style={[styles.squeezePresetButtonText, { color: period === option ? colors.accent : colors.textSub }]}>{maSwingOptionLabel(option)}</Text>
              </TouchableOpacity>)}
            </ScrollView>
          </View>;
        })}
        <Text style={[styles.squeezePresetHint, { color: colors.textMuted }]}>點選即重算訊號與圖上標記。第一段出場均線不得長於全部出場均線；若選擇衝突值，另一條會自動調整。兩個趨勢濾網可分別指定均線，選「無」代表不限制。設定記於本機，不同步推播規則、不修改交易計畫停損、不會下單。</Text>
      </View>}
      {isTtmSqueeze && <View style={[styles.squeezePresetPanel, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
        <View style={styles.squeezePresetHeader}><Text style={[styles.squeezePresetTitle, { color: colors.text }]}>TTM Squeeze 敏感度</Text><Text style={[styles.squeezePresetValue, { color: colors.accent }]}>{TTM_SQUEEZE_PRESET_OPTIONS.find(option => option.key === squeezePreset)?.label || '標準'}</Text></View>
        <View style={styles.squeezePresetButtons}>{TTM_SQUEEZE_PRESET_OPTIONS.map(option => <TouchableOpacity key={option.key} disabled={!onSqueezePresetChange} onPress={() => onSqueezePresetChange?.(option.key)} style={[styles.squeezePresetButton, { backgroundColor: squeezePreset === option.key ? colors.accentSoft : colors.card, borderColor: squeezePreset === option.key ? colors.accent : colors.border }]}><Text style={[styles.squeezePresetButtonText, { color: squeezePreset === option.key ? colors.accent : colors.textSub }]}>{option.label}</Text></TouchableOpacity>)}</View>
        <Text style={[styles.squeezePresetHint, { color: colors.textMuted }]}>積極較早出訊號；保守需要更長擠壓、較高量能與更明確動能。預設為標準。</Text>
      </View>}
      {liveRows.length > 0 && <View style={[styles.metricList, { borderTopColor: colors.borderLight }]}>
        {liveRows.map(([label, value]) => (
          <View key={label} style={[styles.strategyLibraryRow, { borderBottomColor: colors.borderLight }]}>
            <Text style={[styles.strategyLibraryLabel, { color: colors.accent }]}>{label}</Text>
            <Text style={[styles.strategyLibraryValue, { color: colors.text }]}>{value}</Text>
          </View>
        ))}
      </View>}
      <View style={[styles.metricList, { borderTopColor: colors.borderLight }]}>
        {rows.map(([label, value]) => (
          <View key={label} style={[styles.strategyLibraryRow, { borderBottomColor: colors.borderLight }]}>
            <Text style={[styles.strategyLibraryLabel, { color: colors.textMuted }]}>{label}</Text>
            <Text style={[styles.strategyLibraryValue, { color: colors.textSub }]}>{value}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.guideBlock, { backgroundColor: colors.cardAlt }]}>
        <Text style={[styles.guideTitle, { color: colors.text }]}>使用提醒</Text>
        <Text style={[styles.guideText, { color: colors.textSub }]}>{live ? `${isReplay ? '圖上線條、標記與本卡片數值只使用截至回放日期的 K 線計算；' : '圖上線條、標記與本卡片數值會隨目前 K 線重新計算；'}訊號只代表研究條件成立，不構成自動下單或買賣建議。` : '此策略已加入多市場策略庫，目前提供一致的研究欄位與風險說明。'}</Text>
      </View>
      </>}
    </View>
  );
}

function LayerExplanationCard({ layerKey, expanded, onPress, analysis, profile, volumeRatio, atrPosition, marketType, colors }) {
  const latest = analysis.latest;
  const isTaiwan = String(marketType || '').toUpperCase() === 'TW';
  const institutionalFiveDay = analysis.institutional?.day5;
  const flowSummary = isTaiwan
    ? institutionalFiveDay
      ? `外資＋投信近 5 日 ${compactShares(institutionalFiveDay.directional)} 股`
      : '法人資料不足'
    : `CMF20 ${Number.isFinite(latest.cmf) ? latest.cmf.toFixed(2) : '—'} · OBV ${Number(latest.obv || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 })}`;
  const data = {
    ma: ['短中期均線', `MA5 ${money(latest.ma5)} · MA10 ${money(latest.ma10)} · MA20 ${money(latest.ma20)} · MA40 ${money(latest.ma40)} · MA60 ${money(latest.ma60)}`, 'MA5／MA10 反應較快，可觀察短線轉強與回檔；MA20／MA40／MA60 用來判斷較穩定的中期趨勢。K 線型態的高檔／低檔背景以 MA5／MA40 為主。'],
    levels: ['支撐壓力', `支撐 ${analysis.supports[0] ? money(analysis.supports[0].price) : '—'} · 壓力 ${analysis.resistances[0] ? money(analysis.resistances[0].price) : '—'}`, '由歷史轉折與重複測試找出可能有買賣反應的價格區。'],
    gap: ['跳空區', '依目前顯示的 K 棒標記', '只標記目前畫面內相鄰兩根 K 棒的最高、最低價完全不重疊，且價差至少 0.35% 的區間。灰色區塊延伸到圖表右側；後續 K 棒完整回補後不顯示。縮放或拖曳圖表會依可見 K 棒更新。'],
    volume: ['成交量', `目前相對量 ${volumeRatio.toFixed(2)} 倍`, '比較最新成交量與前 20 日均量，用來確認突破或反轉是否有資金參與。'],
    volumeProfile: ['量價分佈', profile ? `POC ${money(profile.poc)} · VAH ${money(profile.vah)} · VAL ${money(profile.val)}` : '資料不足', 'POC 是目前選定期間內推估成交量最大的價格；VAH／VAL 是約 70% 成交量區間。切換 3 個月、6 個月、1 年或 3 年後會完整重算。'],
    boll: ['BOLL（20,2）', Number.isFinite(Number(latest.bollMiddle)) ? `上軌 ${money(latest.bollUpper)} · 中軌 ${money(latest.bollMiddle)} · 下軌 ${money(latest.bollLower)}` : '資料不足', '中軌是 20 日均線；上軌與下軌為中軌加減 2 倍標準差，用來觀察波動擴張、收斂與價格相對位置。'],
    flow: [isTaiwan ? '法人籌碼' : '量價資金流', flowSummary, isTaiwan ? '柱狀圖顯示外資＋投信每日淨買賣，折線顯示收盤價；個別外資、投信與自營商數字可在下方法人籌碼卡查看。' : '美股與加密貨幣沒有台股三大法人式的免費集中逐股資料，因此以 CMF20 與 OBV 顯示量價資金方向；這是技術代理指標，不代表真實機構持倉。'],
    contraction: ['收斂區', '白色粗線：收斂上緣／下緣', '以最近 30 根已完成 K 線找局部波段高點與低點：至少兩個下降高點、兩個上升低點，轉折點至少相隔 4 根 K 線，且型態至少形成 12 根 K 線；多數 K 線高低點也必須落在兩條邊界內。突破需收盤超過邊界 0.5%、K 棒方向一致，且成交量高於 20 日均量。關閉「收斂區」只隱藏白色邊界與色帶，不會移除進場、目標、停損價格線或突破標記。'],
    atr: ['ATR 風控', atrPosition ? `有效停損 ${money(atrPosition.effective_stop)} · 進場 ATR ${money(atrPosition.entry_atr)}` : `ATR14 ${money(analysis.hybrid?.risk?.atr14)} · 預估 2ATR ${money(analysis.hybrid?.risk?.initialStop)}`, atrPosition ? '目前顯示正式混合策略部位的初始、移動與有效停損。' : '尚未進場，灰線只是以最新收盤減去 2 倍 ATR 的風險試算。'],
    macd: ['MACD', `DIF ${money(latest.macd)} · Signal ${money(latest.macdSignal)} · 柱狀體 ${money(latest.macdHistogram)}`, 'DIF 與 Signal 判斷動能方向；柱狀體擴大或縮小可觀察動能變化。'],
    rsi: ['RSI5／RSI10', `RSI5 ${Number.isFinite(latest.rsi5) ? latest.rsi5.toFixed(1) : '—'} · RSI10 ${Number.isFinite(latest.rsi10) ? latest.rsi10.toFixed(1) : '—'}`, '低檔黃金交叉：RSI5 上穿 RSI10 且任一線 ≤ 40；高檔死亡交叉：RSI5 下穿 RSI10 且任一線 ≥ 60。未達門檻的穿越不標記為確認訊號。'],
    kd: ['KD（9,3,3）', `K ${Number.isFinite(latest.k) ? latest.k.toFixed(1) : '—'} · D ${Number.isFinite(latest.d) ? latest.d.toFixed(1) : '—'}`, 'K 上穿 D 為黃金交叉、下穿為死亡交叉；80 以上偏高、20 以下偏低，目前只作輔助。'],
  }[layerKey];
  if (!data) return null;
  return <TouchableOpacity onPress={onPress} style={[styles.layerInfoCard, { backgroundColor: colors.cardAlt, borderColor: expanded ? colors.accent : colors.border }]}>
    <View style={styles.layerInfoHeader}><View style={styles.flex}><Text style={[styles.layerInfoTitle, { color: colors.text }]}>{data[0]}</Text><Text style={[styles.layerInfoValue, { color: colors.accent }]}>{data[1]}</Text></View><View style={styles.layerInfoAction}><Text style={[styles.layerState, { color: colors.positive }]}>已開啟</Text>{expanded ? <ChevronUp size={15} color={colors.accent} /> : <ChevronDown size={15} color={colors.textMuted} />}</View></View>
    {expanded && <Text style={[styles.layerInfoText, { color: colors.textSub }]}>{data[2]}</Text>}
  </TouchableOpacity>;
}

function InstitutionalDailyTable({ rows = [], priceRows = [], colors }) {
  const [expanded, setExpanded] = useState(false);
  const tableRows = useMemo(() => joinInstitutionalRowsWithClosingPrices(rows, priceRows).slice(0, expanded ? 30 : 5), [rows, priceRows, expanded]);
  const totals = useMemo(() => calculateInstitutionalTotals(rows), [rows]);
  const pressurePrices = useMemo(() => new Map(calculateInstitutionalPressurePrices(rows, priceRows).map(item => [item.days, item])), [rows, priceRows]);
  if (!tableRows.length) return null;
  const columns = [
    ['foreign', '外資（股）'], ['trust', '投信（股）'], ['dealer', '自營商（股）'], ['all', '三大法人（股）'], ['close', '股價／力道參考價'],
  ];
  const entries = [
    ...totals.map(total => ({ id: `total-${total.days}`, total, label: `${total.days}日合計` })),
    ...tableRows.map(row => ({ id: row.time, row, label: row.time.slice(5).replace('-', '/') })),
  ];
  const cellValue = (entry, key) => {
    if (entry.total) {
      const total = entry.total;
      const value = total[key];
      const pressure = pressurePrices.get(total.days);
      return {
        text: key === 'close' ? pressure?.price != null ? `${pressure.direction === 'buy' ? '買超' : '賣超'} ${pressure.price.toFixed(2)}` : '—' : total.complete ? exactShares(value) : '—',
        color: key === 'close' ? pressure?.price != null ? colors.text : colors.textMuted : !total.complete ? colors.textMuted : value > 0 ? colors.positive : value < 0 ? colors.negative : colors.textSub,
      };
    }
    const value = entry.row[key];
    return {
      text: value === null ? '—' : key === 'close' ? value.toFixed(2) : exactShares(value),
      color: value === null ? colors.textMuted : key === 'close' ? colors.text : value > 0 ? colors.positive : value < 0 ? colors.negative : colors.textMuted,
    };
  };
  return <View style={[styles.institutionTableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.institutionTableTitleRow}><View><Text style={[styles.institutionTableTitle, { color: colors.text }]}>法人每日買賣超明細</Text><Text style={[styles.institutionTableSubtitle, { color: colors.textMuted }]}>單位：股 · 依已公布交易日由新到舊</Text></View><TouchableOpacity onPress={() => setExpanded(value => !value)} style={[styles.institutionTableToggle, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.institutionTableToggleText, { color: colors.accent }]}>{expanded ? '收合' : '近 30 日'}</Text>{expanded ? <ChevronUp size={13} color={colors.accent} /> : <ChevronDown size={13} color={colors.accent} />}</TouchableOpacity></View>
    <View style={styles.institutionTableColumns}>
      <View style={styles.institutionTableFixedColumn}>
        <View style={[styles.institutionTableRow, styles.institutionTableHead, { backgroundColor: colors.cardAlt, borderBottomColor: colors.border }]}><Text numberOfLines={1} style={[styles.institutionTableCell, styles.institutionDateCell, styles.institutionTableHeadText, { color: colors.textSub }]}>日期／期間</Text></View>
        {entries.map(entry => <View key={entry.id} style={[styles.institutionTableRow, { backgroundColor: entry.total ? colors.cardAlt : colors.card, borderBottomColor: colors.borderLight }]}><Text numberOfLines={1} style={[styles.institutionTableCell, styles.institutionDateCell, entry.total && styles.institutionTotalCell, { color: entry.total ? colors.accent : colors.textSub }]}>{entry.label}</Text></View>)}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.institutionTableNumbersScroll}>
        <View style={styles.institutionTable}>
          <View style={[styles.institutionTableRow, styles.institutionTableHead, { backgroundColor: colors.cardAlt, borderBottomColor: colors.border }]}>{columns.map(([key, label]) => <Text key={key} numberOfLines={1} style={[styles.institutionTableCell, styles.institutionNumberCell, styles.institutionTableHeadText, { color: colors.textSub }]}>{label}</Text>)}</View>
          {entries.map(entry => <View key={entry.id} style={[styles.institutionTableRow, { backgroundColor: entry.total ? colors.cardAlt : colors.card, borderBottomColor: colors.borderLight }]}>{columns.map(([key]) => {
            const value = cellValue(entry, key);
            return <Text key={key} numberOfLines={1} style={[styles.institutionTableCell, styles.institutionNumberCell, entry.total && styles.institutionTotalCell, { color: value.color }]}>{value.text}</Text>;
          })}</View>)}
        </View>
      </ScrollView>
    </View>
    <Text style={[styles.institutionTableNote, { color: colors.textMuted }]}>5／10／20／30 日合計採最近 N 個已公布交易日；不足 N 日或欄位缺值顯示「—」。最右欄每日為同日收盤價；合計列依期間三大法人淨買賣超方向，以同方向每日買賣超股數加權收盤價估算。這是買賣力道參考價，並非法人實際成交均價或持股成本；淨額為零時不顯示。自營商包含自行買賣與避險；三大法人＝外資＋投信＋自營商。</Text>
  </View>;
}

function StrategyOverview({ strategies = [], selectedStrategy, expanded, onToggle, colors }) {
  const visibleStrategies = selectedStrategy === 'ALL' ? strategies : strategies.filter(item => item.key !== selectedStrategy);
  const confirmed = visibleStrategies.filter(item => item.status === 'confirmed').length;
  const watch = visibleStrategies.filter(item => item.status === 'watch' || item.status === 'pending').length;
  return (
    <View style={[styles.strategyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity style={styles.overviewToggle} onPress={onToggle}><View><Text style={[styles.strategyTitle, { color: colors.text }]}>其他策略摘要</Text><Text style={[styles.strategyIntro, { color: colors.textSub }]}>{confirmed} 項已確認 · {watch} 項觀察 · 共 {visibleStrategies.length} 項</Text></View>{expanded ? <ChevronUp size={18} color={colors.textSub} /> : <ChevronDown size={18} color={colors.textSub} />}</TouchableOpacity>
      {expanded && <View style={[styles.strategyList, { borderTopColor: colors.borderLight }]}>{visibleStrategies.map(item => {
        const meta = strategyStatusMeta(item, colors);
        return <View key={item.key} style={[styles.strategyRow, { borderBottomColor: colors.borderLight }]}><View style={styles.flex}><View style={styles.strategyNameRow}><Text style={[styles.strategyName, { color: colors.text }]}>{item.label}</Text><View style={[styles.strategyBadge, { backgroundColor: `${meta.color}18`, borderColor: meta.color }]}><Text style={[styles.strategyBadgeText, { color: meta.color }]}>{meta.label}</Text></View></View><Text style={[styles.strategyReason, { color: colors.textSub }]}>{item.reason}</Text></View></View>;
      })}</View>}
    </View>
  );
}

const getSelectedStrategyStats = (strategies = [], selectedKeys = []) => {
  const results = selectedKeys.map(key => strategies.find(item => item.key === key) || {
    key,
    status: 'unavailable',
    direction: null,
  });
  const total = results.length;
  const count = predicate => results.filter(predicate).length;
  const isBullish = item => item.direction === 'bullish';
  const isBearish = item => item.direction === 'bearish';
  const isConfirmed = item => item.status === 'confirmed';
  const isWatch = item => item.status === 'watch' || item.status === 'pending';
  const bullishConfirmed = count(item => isBullish(item) && isConfirmed(item));
  const bearishConfirmed = count(item => isBearish(item) && isConfirmed(item));
  const bullishWatch = count(item => isBullish(item) && isWatch(item));
  const bearishWatch = count(item => isBearish(item) && isWatch(item));
  const neutralWatch = count(item => !isBullish(item) && !isBearish(item) && isWatch(item));
  return {
    total,
    bullishConfirmed,
    bearishConfirmed,
    bullishWatch,
    bearishWatch,
    neutralWatch,
    notEstablished: count(item => !isConfirmed(item) && !isWatch(item)),
    confirmedTotal: bullishConfirmed + bearishConfirmed,
    watchTotal: bullishWatch + bearishWatch + neutralWatch,
  };
};

function StrategySelectionControl({ strategies = [], selectedKeys = [], selectedNames = [], colors, onPress }) {
  const [expanded, setExpanded] = useState(true);
  const stats = getSelectedStrategyStats(strategies, selectedKeys);
  const visibleNames = selectedNames.length > 6
    ? [...selectedNames.slice(0, 5), `+${selectedNames.length - 5} 項`]
    : selectedNames;
  return (
    <View style={[styles.strategySelectionControl, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.strategySelectionHeader}>
        <View style={styles.flex}>
          <Text style={[styles.strategySelectionTitle, { color: colors.text }]}>目前查看策略</Text>
          {stats.total ? <><Text style={[styles.strategySelectionSummary, { color: colors.textSub }]}>共 {stats.total} 項 · 已確認 {stats.confirmedTotal} · 觀察 {stats.watchTotal}</Text><Text style={[styles.strategySelectionSummary, { color: colors.accent }]}>統整：偏多 {stats.bullishConfirmed + stats.bullishWatch} · 偏空 {stats.bearishConfirmed + stats.bearishWatch} · 分歧 {stats.neutralWatch} · 未成立 {stats.notEstablished}</Text></> : <Text style={[styles.strategySelectionSummary, { color: colors.textSub }]}>尚未選擇策略</Text>}
        </View>
        <View style={styles.collapsibleStatus}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="調整目前查看策略" onPress={onPress} style={[styles.strategySelectionAction, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
            <SlidersHorizontal size={14} color={colors.accent} />
            <Text style={[styles.strategySelectionActionText, { color: colors.accent }]}>調整策略</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={expanded ? '收合目前查看策略' : '展開目前查看策略'} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.collapseIconButton}>
            {expanded ? <ChevronUp size={18} color={colors.textMuted} /> : <ChevronDown size={18} color={colors.textMuted} />}
          </TouchableOpacity>
        </View>
      </View>
      {expanded && (visibleNames.length ? <View style={styles.strategySelectionChips}>{visibleNames.map(name => <View key={name} style={[styles.strategySelectionChip, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text numberOfLines={1} style={[styles.strategySelectionChipText, { color: colors.textSub }]}>{name}</Text></View>)}</View> : <Text style={[styles.strategySelectionHint, { color: colors.textMuted }]}>按「調整策略」選擇要查看的策略；可同時勾選多個。</Text>)}
    </View>
  );
}

function SelectedStrategiesSummary({ strategies = [], selectedKeys = [], colors, replayDates = [], replayDate = null, onReplayDateChange, onLatest, isReplayActive = false }) {
  const [expanded, setExpanded] = useState(true);
  if (!selectedKeys.length && !replayDates.length) return null;

  const stats = getSelectedStrategyStats(strategies, selectedKeys);
  const rows = selectedKeys.length ? [
    ['偏多已確認', stats.bullishConfirmed, colors.positive],
    ['偏空已確認', stats.bearishConfirmed, colors.negative],
    ['偏多觀察', stats.bullishWatch, colors.warning],
    ['偏空觀察', stats.bearishWatch, colors.warning],
    ['訊號分歧', stats.neutralWatch, colors.warning],
    ['未成立／資料不足', stats.notEstablished, colors.textMuted],
  ] : [];

  return (
    <View style={[styles.strategyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.overviewToggle}>
        <View style={styles.flex}>
          <Text style={[styles.strategyTitle, { color: colors.text }]}>已選策略統計</Text>
          <Text style={[styles.strategyIntro, { color: colors.textSub }]}>{stats.total ? `總選擇 ${stats.total} 項 · 已確認 ${stats.confirmedTotal} 項 · 觀察 ${stats.watchTotal} 項${isReplayActive ? ' · 歷史回放' : ''}` : '尚未選擇策略，可先拖曳日期查看歷史技術判斷'}</Text>
        </View>
        <View style={styles.collapsibleStatus}>
          <View style={[styles.selectedStrategyCount, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
            <Text style={[styles.selectedStrategyCountText, { color: colors.accent }]}>{stats.total}</Text>
          </View>
          {expanded ? <ChevronUp size={18} color={colors.textMuted} /> : <ChevronDown size={18} color={colors.textMuted} />}
        </View>
      </TouchableOpacity>
      {expanded && <>
      <View style={[styles.summaryGrid, { marginTop: 10 }]}>
        {rows.map(([label, value, color]) => (
          <View key={label} style={[styles.selectedStrategyMetric, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
            <Text style={[styles.summaryLabel, { color: colors.textSub }]}>{label}</Text>
            <Text style={[styles.selectedStrategyMetricValue, { color }]}>{value}／{stats.total}</Text>
          </View>
        ))}
      </View>
      <TechnicalReplaySlider dates={replayDates} value={replayDate} colors={colors} onChange={onReplayDateChange} onLatest={onLatest} />
      </>}
    </View>
  );
}

function InstitutionalAnalysisCard({ analysis, selectedStrategy, colors }) {
  const institutional = analysis?.institutional;
  if (!institutional) return null;

  const periods = [
    { key: 'day1', label: '1 日' },
    { key: 'day3', label: '3 日' },
    { key: 'day5', label: '5 日' },
    { key: 'day20', label: '20 日' },
  ];
  const strategies = analysis?.strategies || [];
  const selectedResult = selectedStrategy === 'ALL'
    ? strategies.find(item => item.status === 'confirmed' && item.institutional)
      || strategies.find(item => item.status === 'watch' && item.institutional)
    : strategies.find(item => item.key === selectedStrategy);
  const confirmation = selectedResult?.institutional;
  const fiveDay = institutional.day5;
  const institutionalAsOf = fiveDay?.asOf || institutional.day1?.asOf || null;
  const candleAsOf = analysis?.latest?.time || null;
  const isInstitutionalLagging = Boolean(institutionalAsOf && candleAsOf && institutionalAsOf < candleAsOf);
  const direction = confirmation?.direction || (Number(fiveDay?.directional || 0) >= 0 ? 'bullish' : 'bearish');
  const statusColor = confirmation?.available
    ? (confirmation.passed ? (direction === 'bearish' ? colors.negative : colors.positive) : colors.warning)
    : colors.textMuted;
  const statusLabel = confirmation?.available
    ? (confirmation.passed ? '法人同向' : '法人未同向')
    : fiveDay ? (fiveDay.directional > 0 ? '近 5 日偏多' : fiveDay.directional < 0 ? '近 5 日偏空' : '近 5 日中性') : '資料待更新';
  const breakdown = [
    { label: '外資', value: fiveDay?.foreign },
    { label: '投信', value: fiveDay?.trust },
    { label: '自營商自行買賣', value: fiveDay?.dealerSelf },
  ];

  return (
    <View style={[styles.institutionalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.institutionalHeader}>
        <View style={styles.chartTitleRow}><BarChart3 size={17} color={colors.accent} /><View><Text style={[styles.institutionalTitle, { color: colors.text }]}>法人籌碼確認</Text><Text style={[styles.institutionalSubtitle, { color: colors.textMuted }]}>外資＋投信淨額 · 單位：股</Text><Text style={[styles.institutionalSubtitle, { color: isInstitutionalLagging ? colors.warning : colors.textMuted }]}>{institutionalAsOf ? `法人資料截至 ${institutionalAsOf}${isInstitutionalLagging ? `（日 K 截至 ${candleAsOf}）` : ''}` : '法人資料日期待更新'}</Text></View></View>
        <View style={[styles.institutionalBadge, { backgroundColor: `${statusColor}18`, borderColor: statusColor }]}><Text style={[styles.institutionalBadgeText, { color: statusColor }]}>{statusLabel}</Text></View>
      </View>

      <View style={styles.institutionalPeriods}>{periods.map(item => {
        const summary = institutional[item.key];
        const value = Number(summary?.directional || 0);
        const color = !summary ? colors.textMuted : value > 0 ? colors.positive : value < 0 ? colors.negative : colors.textSub;
        return <View key={item.key} style={[styles.institutionalPeriod, { backgroundColor: colors.cardAlt, borderColor: colors.borderLight }]}><Text style={[styles.institutionalPeriodLabel, { color: colors.textMuted }]}>{item.label}</Text><Text style={[styles.institutionalPeriodValue, { color }]}>{summary ? compactShares(value) : '—'}</Text></View>;
      })}</View>

      <View style={[styles.institutionalBreakdown, { borderTopColor: colors.borderLight }]}>{breakdown.map(item => {
        const value = Number(item.value || 0);
        const color = value > 0 ? colors.positive : value < 0 ? colors.negative : colors.textSub;
        return <View key={item.label} style={styles.institutionalBreakdownRow}><Text style={[styles.institutionalBreakdownLabel, { color: colors.textSub }]}>{item.label}近 5 日</Text><Text style={[styles.institutionalBreakdownValue, { color }]}>{fiveDay ? `${compactShares(value)} 股` : '—'}</Text></View>;
      })}</View>

      <View style={[styles.institutionalNote, { backgroundColor: colors.cardAlt }]}><Text style={[styles.institutionalNoteText, { color: colors.textSub }]}>「近 N 日」採用截至上方日期最近 N 個已公布的法人交易日。盤後資料尚未發布時，可能仍停在前一交易日；技術訊號為偏多時，外資＋投信近 5 日合計需買超且至少 3 日買超，偏空則反向。自營商避險部位不納入方向確認。</Text></View>
    </View>
  );
}

const DISTRIBUTION_LABELS = {
  directors: '董監',
  foreign: '外資',
  trust: '投信',
  dealer: '自營商',
  other: '其他',
};

function InstitutionalDistributionCard({ data, loading, error, onRefresh, colors }) {
  const categories = data?.categories || [];
  const palette = [colors.warning, colors.accent, colors.negative, '#A78BFA', '#A8C63A'];
  const categorizedTotal = categories.reduce((sum, item) => sum + Number(item.sharesLots || 0), 0);
  const total = Number(data?.issuedLots || 0) || categorizedTotal;
  const chartTotal = data?.overlaps ? categorizedTotal : total;
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  let progress = 0;

  return <View style={[styles.distributionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.distributionHeader}>
      <View style={styles.flex}>
        <Text style={[styles.distributionTitle, { color: colors.text }]}>籌碼分布</Text>
        <Text style={[styles.distributionSubtitle, { color: colors.textMuted }]}>{data?.asOf ? `資料截至 ${data.asOf}` : '法人與董監持股存量'}</Text>
      </View>
      <TouchableOpacity style={[styles.distributionRefresh, { backgroundColor: colors.cardAlt, borderColor: colors.border }]} onPress={onRefresh} disabled={loading}>
        {loading ? <ActivityIndicator size="small" color={colors.accent} /> : <RefreshCw size={14} color={colors.accent} />}
      </TouchableOpacity>
    </View>

    {error && !data ? <View style={[styles.distributionEmpty, { backgroundColor: colors.cardAlt }]}><Text style={[styles.distributionEmptyTitle, { color: colors.textSub }]}>籌碼分布暫時無法取得</Text><Text style={[styles.distributionEmptyText, { color: colors.textMuted }]}>{error}</Text></View> : null}

    {data ? <>
      <View style={styles.distributionOverview}>
        <View style={styles.donutWrap}>
          <Svg width={112} height={112} viewBox="0 0 112 112">
            <Circle cx="56" cy="56" r={radius} fill="none" stroke={colors.cardAlt} strokeWidth="20" />
            {categories.map((item, index) => {
              const fraction = chartTotal > 0 ? Math.max(0, Number(item.sharesLots || 0)) / chartTotal : 0;
              const length = Math.min(circumference, fraction * circumference);
              const offset = progress * circumference;
              progress += fraction;
              return <Circle key={item.key} cx="56" cy="56" r={radius} fill="none" stroke={palette[index % palette.length]} strokeWidth="20" strokeDasharray={`${length} ${Math.max(0, circumference - length)}`} strokeDashoffset={-offset} strokeLinecap="butt" transform="rotate(-90 56 56)" />;
            })}
          </Svg>
          <View style={styles.donutCenter}><Text style={[styles.donutCenterValue, { color: colors.text }]}>{data?.overlaps ? '重疊' : total ? compactShares(total) : '—'}</Text><Text style={[styles.donutCenterLabel, { color: colors.textMuted }]}>{data?.overlaps ? '分類持股' : '總發行張數'}</Text></View>
        </View>
        <View style={styles.distributionLegend}>{categories.map((item, index) => <View key={item.key} style={styles.legendRow}><View style={[styles.legendDot, { backgroundColor: palette[index % palette.length] }]} /><Text style={[styles.legendLabel, { color: colors.textSub }]}>{DISTRIBUTION_LABELS[item.key] || item.key}</Text><Text style={[styles.legendRatio, { color: colors.text }]}>{Number(item.ratio || 0).toFixed(2)}%</Text></View>)}</View>
      </View>

      <View style={[styles.distributionTableHead, { backgroundColor: colors.cardAlt }]}><Text style={[styles.distributionNameCell, styles.distributionHeadText, { color: colors.textMuted }]}>項目</Text><Text style={[styles.distributionNumberCell, styles.distributionHeadText, { color: colors.textMuted }]}>持股張數</Text><Text style={[styles.distributionRatioCell, styles.distributionHeadText, { color: colors.textMuted }]}>持股比</Text></View>
      {categories.map((item, index) => <View key={item.key} style={[styles.distributionTableRow, { borderBottomColor: colors.borderLight }]}><View style={styles.distributionNameCell}><View style={[styles.legendDot, { backgroundColor: palette[index % palette.length] }]} /><Text style={[styles.distributionRowText, { color: colors.textSub }]}>{DISTRIBUTION_LABELS[item.key] || item.key}</Text></View><Text style={[styles.distributionNumberCell, styles.distributionRowValue, { color: colors.text }]}>{Math.round(Number(item.sharesLots || 0)).toLocaleString('zh-TW')}</Text><Text style={[styles.distributionRatioCell, styles.distributionRowValue, { color: colors.text }]}>{Number(item.ratio || 0).toFixed(2)}%</Text></View>)}

      <Text style={[styles.distributionNote, { color: data.overlaps ? colors.warning : colors.textMuted }]}>{data.overlaps ? '董監身分可能同時屬於外資，分類發生重疊，因此不以「其他」硬湊為 100%。' : '其他＝官方發行股數扣除董監、外資、投信與自營商；這是持股存量，不是當日買賣超。'}</Text>
      <TouchableOpacity onPress={() => data.sourceUrl && Linking.openURL(data.sourceUrl)} disabled={!data.sourceUrl}><Text style={[styles.distributionSource, { color: colors.accent }]}>{data.source || '查看資料來源'} ↗</Text></TouchableOpacity>
    </> : null}
  </View>;
}

const signedLots = value => `${Number(value || 0) > 0 ? '+' : ''}${Math.round(Number(value || 0)).toLocaleString('zh-TW')}`;

function chartPath(points) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
}

function MarginTradingCard({ data, priceRows, loading, error, onRefresh, colors }) {
  const [mode, setMode] = useState('margin');
  const rows = (data?.rows || []).slice(-60);
  const latest = rows.at(-1);
  const priceByDate = new Map((priceRows || []).map(row => [String(row.time), Number(row.close || 0)]));
  const chartRows = rows.map(row => ({ ...row, price: priceByDate.get(String(row.time)) || 0 }));
  const balanceKey = mode === 'margin' ? 'marginBalance' : 'shortBalance';
  const changeKey = mode === 'margin' ? 'marginChange' : 'shortChange';
  const balances = chartRows.map(row => Number(row[balanceKey] || 0));
  const prices = chartRows.map(row => Number(row.price || 0)).filter(value => value > 0);
  const balanceMin = balances.length ? Math.min(...balances) : 0;
  const balanceMax = balances.length ? Math.max(...balances) : 1;
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 1;
  const changeMax = Math.max(1, ...chartRows.map(row => Math.abs(Number(row[changeKey] || 0))));
  const xAt = index => 16 + index / Math.max(1, chartRows.length - 1) * 288;
  const yAt = (value, min, max) => 12 + (1 - (value - min) / Math.max(1, max - min)) * 92;
  const balancePath = chartPath(chartRows.map((row, index) => ({ x: xAt(index), y: yAt(Number(row[balanceKey] || 0), balanceMin, balanceMax) })));
  const pricePath = chartPath(chartRows.filter(row => row.price > 0).map(row => {
    const index = chartRows.indexOf(row);
    return { x: xAt(index), y: yAt(row.price, priceMin, priceMax) };
  }));
  const recent = rows.slice(-5);
  const fiveDayChange = recent.reduce((sum, row) => sum + Number(row[changeKey] || 0), 0);
  const firstPrice = priceByDate.get(String(recent[0]?.time)) || 0;
  const lastPrice = priceByDate.get(String(recent.at(-1)?.time)) || 0;
  const priceChange = firstPrice > 0 && lastPrice > 0 ? (lastPrice - firstPrice) / firstPrice * 100 : 0;
  const interpretation = mode === 'margin'
    ? fiveDayChange > 0 && priceChange < 0
      ? '近 5 日融資增加、股價走弱，短線浮額與賣壓風險升高。'
      : fiveDayChange < 0 && priceChange > 0
        ? '近 5 日融資下降、股價走強，籌碼沉澱相對健康。'
        : fiveDayChange > 0
          ? '近 5 日融資增加，動能可能放大，但槓桿風險也同步升高。'
          : '近 5 日融資下降，代表槓桿部位減少，仍需搭配股價趨勢判讀。'
    : fiveDayChange > 0
      ? '近 5 日融券增加，空方部位上升；可能形成壓力，也可能成為未來回補力道。'
      : fiveDayChange < 0
        ? '近 5 日融券下降，可能是空方回補或退場，不能單獨視為買進訊號。'
        : '近 5 日融券變化有限，暫無明顯空方籌碼方向。';

  return <View style={[styles.marginCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.distributionHeader}>
      <View style={styles.flex}><Text style={[styles.distributionTitle, { color: colors.text }]}>資券動向</Text><Text style={[styles.distributionSubtitle, { color: colors.textMuted }]}>{data?.asOf ? `資料截至 ${data.asOf} · 單位：張` : '融資融券每日餘額'}</Text></View>
      <TouchableOpacity style={[styles.distributionRefresh, { backgroundColor: colors.cardAlt, borderColor: colors.border }]} onPress={onRefresh} disabled={loading}>{loading ? <ActivityIndicator size="small" color={colors.accent} /> : <RefreshCw size={14} color={colors.accent} />}</TouchableOpacity>
    </View>
    <View style={styles.marginTabs}>{[['margin', '融資'], ['short', '融券']].map(([key, label]) => <TouchableOpacity key={key} onPress={() => setMode(key)} style={[styles.marginTab, { borderColor: mode === key ? colors.accent : colors.border, backgroundColor: mode === key ? colors.accentSoft : colors.cardAlt }]}><Text style={[styles.marginTabText, { color: mode === key ? colors.accent : colors.textSub }]}>{label}</Text></TouchableOpacity>)}</View>

    {error && !data ? <View style={[styles.distributionEmpty, { backgroundColor: colors.cardAlt }]}><Text style={[styles.distributionEmptyTitle, { color: colors.textSub }]}>資券資料暫時無法取得</Text><Text style={[styles.distributionEmptyText, { color: colors.textMuted }]}>{error}</Text></View> : null}

    {latest ? <>
      <View style={styles.marginMetrics}>
        <View style={styles.marginMetric}><Text style={[styles.marginMetricLabel, { color: colors.textMuted }]}>{mode === 'margin' ? '融資餘額' : '融券餘額'}</Text><Text style={[styles.marginMetricValue, { color: colors.text }]}>{Math.round(Number(latest[balanceKey] || 0)).toLocaleString('zh-TW')} 張</Text></View>
        <View style={styles.marginMetric}><Text style={[styles.marginMetricLabel, { color: colors.textMuted }]}>今日增減</Text><Text style={[styles.marginMetricValue, { color: Number(latest[changeKey] || 0) > 0 ? colors.warning : Number(latest[changeKey] || 0) < 0 ? colors.accent : colors.textSub }]}>{signedLots(latest[changeKey])} 張</Text></View>
        <View style={styles.marginMetric}><Text style={[styles.marginMetricLabel, { color: colors.textMuted }]}>{mode === 'margin' ? '資使用率' : '券資比'}</Text><Text style={[styles.marginMetricValue, { color: colors.text }]}>{Number(mode === 'margin' ? latest.marginUtilization : latest.shortToMargin).toFixed(2)}%</Text></View>
      </View>

      <View style={[styles.marginChart, { backgroundColor: colors.cardAlt }]}>
        <Svg width="100%" height={180} viewBox="0 0 320 180">
          <Line x1="16" y1="142" x2="304" y2="142" stroke={colors.border} strokeWidth="1" />
          {chartRows.map((row, index) => {
            const change = Number(row[changeKey] || 0);
            const height = Math.abs(change) / changeMax * 32;
            return <Rect key={row.time} x={xAt(index) - 1.5} y={change >= 0 ? 142 - height : 142} width="3" height={height} rx="1" fill={change >= 0 ? colors.warning : colors.accent} opacity="0.72" />;
          })}
          {balancePath ? <Path d={balancePath} fill="none" stroke={colors.accent} strokeWidth="2.2" /> : null}
          {pricePath ? <Path d={pricePath} fill="none" stroke={colors.warning} strokeWidth="1.7" opacity="0.9" /> : null}
        </Svg>
        <View style={styles.marginLegend}><View style={styles.marginLegendItem}><View style={[styles.marginLegendLine, { backgroundColor: colors.accent }]} /><Text style={[styles.marginLegendText, { color: colors.textSub }]}>{mode === 'margin' ? '融資餘額' : '融券餘額'}</Text></View><View style={styles.marginLegendItem}><View style={[styles.marginLegendLine, { backgroundColor: colors.warning }]} /><Text style={[styles.marginLegendText, { color: colors.textSub }]}>股價／每日增減</Text></View></View>
      </View>

      <View style={[styles.marginInterpretation, { backgroundColor: colors.cardAlt }]}><Text style={[styles.marginInterpretationTitle, { color: colors.text }]}>近 5 日增減 {signedLots(fiveDayChange)} 張</Text><Text style={[styles.marginInterpretationText, { color: colors.textSub }]}>{interpretation}</Text></View>

      <View style={[styles.distributionTableHead, { backgroundColor: colors.cardAlt }]}><Text style={[styles.marginDateCell, styles.distributionHeadText, { color: colors.textMuted }]}>日期</Text><Text style={[styles.marginTableCell, styles.distributionHeadText, { color: colors.textMuted }]}>餘額</Text><Text style={[styles.marginTableCell, styles.distributionHeadText, { color: colors.textMuted }]}>增減</Text><Text style={[styles.marginTableCell, styles.distributionHeadText, { color: colors.textMuted }]}>{mode === 'margin' ? '使用率' : '券資比'}</Text></View>
      {rows.slice(-5).reverse().map(row => <View key={row.time} style={[styles.distributionTableRow, { borderBottomColor: colors.borderLight }]}><Text style={[styles.marginDateCell, styles.distributionRowText, { color: colors.textSub }]}>{String(row.time).slice(5).replace('-', '/')}</Text><Text style={[styles.marginTableCell, styles.distributionRowValue, { color: colors.text }]}>{Math.round(Number(row[balanceKey] || 0)).toLocaleString('zh-TW')}</Text><Text style={[styles.marginTableCell, styles.distributionRowValue, { color: Number(row[changeKey] || 0) > 0 ? colors.warning : Number(row[changeKey] || 0) < 0 ? colors.accent : colors.textSub }]}>{signedLots(row[changeKey])}</Text><Text style={[styles.marginTableCell, styles.distributionRowValue, { color: colors.text }]}>{Number(mode === 'margin' ? row.marginUtilization : row.shortToMargin).toFixed(2)}%</Text></View>)}
      <Text style={[styles.distributionNote, { color: colors.textMuted }]}>融資增加不一定是利多；融券增加也不一定是利空。應同時觀察股價方向、餘額趨勢與券資比。</Text>
      <TouchableOpacity onPress={() => data.sourceUrl && Linking.openURL(data.sourceUrl)} disabled={!data.sourceUrl}><Text style={[styles.distributionSource, { color: colors.accent }]}>{data.source || '查看資料來源'} ↗</Text></TouchableOpacity>
    </> : null}
  </View>;
}

function ConfirmationLineGuide({ signal, colors }) {
  if (!signal) {
    return <View style={[styles.lineGuide, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><View style={[styles.lineGuideIcon, { backgroundColor: colors.accentSoft }]}><Text style={[styles.lineGuideIconText, { color: colors.accent }]}>?</Text></View><View style={styles.flex}><Text style={[styles.lineGuideTitle, { color: colors.text }]}>目前沒有有效確認線</Text><Text style={[styles.lineGuideText, { color: colors.textSub }]}>必須先形成一組仍有效的 MACD 多／空背離候選。圖上的灰色失效標記只保留歷史紀錄，不會再畫成目前確認線。</Text></View></View>;
  }
  const bullish = signal.type === 'bullish';
  const status = signal.status === 'confirmed' ? '已確認' : '等待確認';
  return <View style={[styles.lineGuide, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><View style={[styles.lineGuideIcon, { backgroundColor: colors.accentSoft }]}><Text style={[styles.lineGuideIconText, { color: colors.accent }]}>?</Text></View><View style={styles.flex}><Text style={[styles.lineGuideTitle, { color: colors.text }]}>{bullish ? '多方' : '空方'}確認線 {money(signal.neckline)} · {status}</Text><Text style={[styles.lineGuideText, { color: colors.textSub }]}>{bullish ? '取兩個背離低點之間的最高價；收盤向上突破後，才確認多方結構。' : '取兩個背離高點之間的最低價；收盤向下跌破後，才確認空方結構。'}</Text></View></View>;
}

function AssetSwitcherModal({ visible, onClose, assets, query, setQuery, market, setMarket, source = 'ALL', setSource, loading, error, currentKey, onSelect, onRefresh, colors, multiSelect = false, selectedKeys = [], onToggle, maxSelected = 3, title = '切換個股', hint = '持倉與自選標的，不必返回上一頁', manualSymbol = '', setManualSymbol, onAddManual, manualError = '' }) {
  const marketName = market => ({ TW: '台股', US: '美股', CRYPTO: '虛擬貨幣' }[String(market || '').toUpperCase()] || market);
  return <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.strategySheetOverlay}>
      <Pressable accessibilityRole="button" accessibilityLabel="關閉個股切換器" style={StyleSheet.absoluteFill} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'web' ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.assetKeyboardAvoiding}>
      <View style={[styles.assetSwitcherSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.strategySheetHeader}>
          <View style={styles.flex}><Text style={[styles.strategySheetTitle, { color: colors.text }]}>{title}</Text><Text style={[styles.strategySheetHint, { color: colors.textSub }]}>{multiSelect ? `${hint} · 最多 ${maxSelected} 檔` : hint}</Text></View>
          <TouchableOpacity onPress={onClose} style={[styles.strategySheetClose, { backgroundColor: colors.cardAlt }]}><X size={20} color={colors.textSub} /></TouchableOpacity>
        </View>
        <View style={[styles.assetSwitcherSearch, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
          <Search size={17} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="搜尋代碼或名稱"
            placeholderTextColor={colors.textMuted}
            style={[styles.assetSwitcherInput, { color: colors.text }]}
          />
          {!!query && <TouchableOpacity accessibilityLabel="清除搜尋" onPress={() => setQuery('')}><X size={16} color={colors.textMuted} /></TouchableOpacity>}
        </View>
        {multiSelect && <View style={styles.manualCompareRow}>
          <TextInput
            value={manualSymbol}
            onChangeText={setManualSymbol}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={String(market).toUpperCase() === 'TW' ? '直接輸入台股代碼' : String(market).toUpperCase() === 'CRYPTO' ? '直接輸入幣種代碼' : String(market).toUpperCase() === 'ALL' ? '代碼或市場:代碼，例如 US:AAPL' : '直接輸入美股代碼'}
            placeholderTextColor={colors.textMuted}
            style={[styles.manualCompareInput, { color: colors.text, backgroundColor: colors.cardAlt, borderColor: colors.border }]}
          />
          <TouchableOpacity onPress={onAddManual} style={[styles.manualCompareButton, { backgroundColor: colors.accent }]}><Text style={[styles.manualCompareButtonText, { color: colors.accentContrast }]}>加入</Text></TouchableOpacity>
        </View>}
        {!!manualError && <Text style={[styles.assetSwitcherError, { color: colors.warning, marginBottom: 8 }]}>{manualError}</Text>}
        {!!setSource && <View style={styles.assetSwitcherFilterGroup}>
          <Text style={[styles.assetSwitcherFilterLabel, { color: colors.textMuted }]}>來源</Text>
          <ScrollView horizontal style={styles.assetSwitcherMarketScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assetSwitcherMarkets}>
            {[['ALL', '全部'], ['HOLDING', '持倉'], ['WATCHLIST', '自選']].map(([key, label]) => (
              <TouchableOpacity key={key} onPress={() => setSource(key)} style={[styles.assetSwitcherMarketChip, { backgroundColor: source === key ? colors.accentSoft : colors.cardAlt, borderColor: source === key ? colors.accent : colors.border }]}>
                <Text style={[styles.assetSwitcherMarketText, { color: source === key ? colors.accent : colors.textSub }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>}
        <View style={styles.assetSwitcherFilterGroup}>
          <Text style={[styles.assetSwitcherFilterLabel, { color: colors.textMuted }]}>市場</Text>
          <ScrollView horizontal style={styles.assetSwitcherMarketScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assetSwitcherMarkets}>
          {[['ALL', '全部'], ['TW', '台股'], ['US', '美股'], ['CRYPTO', '虛擬貨幣']].map(([key, label]) => (
            <TouchableOpacity key={key} onPress={() => setMarket(key)} style={[styles.assetSwitcherMarketChip, { backgroundColor: market === key ? colors.accentSoft : colors.cardAlt, borderColor: market === key ? colors.accent : colors.border }]}>
              <Text style={[styles.assetSwitcherMarketText, { color: market === key ? colors.accent : colors.textSub }]}>{label}</Text>
            </TouchableOpacity>
          ))}
          </ScrollView>
        </View>
        {loading ? <View style={styles.assetSwitcherState}><ActivityIndicator color={colors.accent} /><Text style={[styles.strategySheetHint, { color: colors.textSub }]}>載入持倉與自選…</Text></View>
          : error ? <View style={styles.assetSwitcherState}><CircleAlert size={22} color={colors.warning} /><Text style={[styles.assetSwitcherError, { color: colors.textSub }]}>{error}</Text><TouchableOpacity onPress={onRefresh}><Text style={{ color: colors.accent, fontWeight: '800' }}>重新載入</Text></TouchableOpacity></View>
            : <ScrollView style={styles.assetSwitcherList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {assets.length ? assets.map(asset => {
                const key = switchAssetKey(asset);
                const selected = multiSelect ? selectedKeys.includes(key) : key === currentKey;
                return <TouchableOpacity
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => multiSelect ? onToggle?.(asset) : onSelect(asset)}
                  style={[styles.assetSwitcherRow, { borderBottomColor: colors.borderLight, backgroundColor: selected ? colors.accentSoft : 'transparent' }]}
                >
                  <View style={styles.flex}><Text style={[styles.assetSwitcherSymbol, { color: selected ? colors.accent : colors.text }]}>{asset.symbol}</Text><Text numberOfLines={1} style={[styles.assetSwitcherName, { color: colors.textSub }]}>{asset.name || asset.symbol} · {marketName(asset.market_type)}</Text></View>
                  <View style={styles.assetSwitcherBadges}>{asset.isHolding && <View style={[styles.assetSwitcherBadge, { borderColor: colors.accent }]}><Text style={[styles.assetSwitcherBadgeText, { color: colors.accent }]}>持倉</Text></View>}{asset.isWatchlist && <View style={[styles.assetSwitcherBadge, { borderColor: colors.border }]}><Text style={[styles.assetSwitcherBadgeText, { color: colors.textSub }]}>自選</Text></View>}{selected && <Check size={18} color={colors.accent} />}</View>
                </TouchableOpacity>;
              }) : <View style={styles.assetSwitcherState}><Text style={[styles.assetSwitcherError, { color: colors.textSub }]}>{query ? '找不到符合的持倉或自選標的' : '目前沒有持倉或自選標的'}</Text></View>}
            </ScrollView>}
        {multiSelect && <TouchableOpacity onPress={onClose} style={[styles.assetSwitcherDone, { backgroundColor: colors.accent }]}><Text style={[styles.assetSwitcherDoneText, { color: colors.accentContrast }]}>完成</Text></TouchableOpacity>}
      </View>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}

export default function TechnicalAnalysisScreen({ navigation, route }) {
  const { colors } = useTheme();
  const { symbol, name, averageCost = 0, currentShares = 0, marketType = 'TW', currency = null, strategyKey = null, analysisKey = null, earningsCalendarEvent = null } = route.params || {};
  const calendarEventForSymbol = earningsCalendarEvent
    && String(earningsCalendarEvent.symbol || '').toUpperCase() === String(symbol || '').toUpperCase()
    && String(earningsCalendarEvent.marketType || 'US').toUpperCase() === String(marketType || 'US').toUpperCase()
    ? earningsCalendarEvent
    : null;
  const initialStrategy = [...STRATEGIES, ...STRATEGY_LIBRARY].some(item => item.key === strategyKey) ? strategyKey : null;
  const initialAnalysis = [...STRATEGIES, ...STRATEGY_LIBRARY, ...SUPPLEMENTARY_ANALYSES].some(item => item.key === analysisKey) ? analysisKey : null;
  const initialSelectedStrategyKeys = initialStrategy && initialStrategy !== 'ALL'
    ? [initialStrategy]
    : [];
  const initialDetailStrategy = initialAnalysis || (initialStrategy === 'ALL'
    ? 'ALL'
    : initialStrategy || null);
  const scrollRef = useRef(null);
  const strategyResultYRef = useRef(0);
  const pendingStrategyScrollRef = useRef(false);
  const strategySelectionHydratedRef = useRef(Boolean(initialStrategy));
  const [rawRows, setRawRows] = useState([]);
  const [marketContext, setMarketContext] = useState({ marketType, institutional: [] });
  const [comparisonSymbols, setComparisonSymbols] = useState([]);
  const [comparisonRows, setComparisonRows] = useState([]);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState(null);
  const [period, setPeriod] = useState('1Y');
  const [replayDate, setReplayDate] = useState(null);
  const [selectedStrategy, setSelectedStrategy] = useState(initialStrategy);
  const [selectedStrategyKeys, setSelectedStrategyKeys] = useState(initialSelectedStrategyKeys);
  const [selectedAnalysis, setSelectedAnalysis] = useState(initialDetailStrategy);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [atrPosition, setAtrPosition] = useState(null);
  const [atrMultiplier, setAtrMultiplier] = useState(ATR_MULTIPLIER_DEFAULT);
  const atrMultiplierHydratedRef = useRef(false);
  const [valuationData, setValuationData] = useState(null);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [valuationError, setValuationError] = useState(null);
  const [dcfData, setDcfData] = useState(null);
  const [dcfLoading, setDcfLoading] = useState(false);
  const [dcfError, setDcfError] = useState(null);
  const [financialReports, setFinancialReports] = useState(null);
  const [financialReportsLoading, setFinancialReportsLoading] = useState(false);
  const [financialReportsError, setFinancialReportsError] = useState(null);
  const staleFinancialRefreshRef = useRef('');
  const [corporateActions, setCorporateActions] = useState(null);
  const [corporateActionsLoading, setCorporateActionsLoading] = useState(false);
  const [corporateActionsError, setCorporateActionsError] = useState(null);
  const [institutionalDistribution, setInstitutionalDistribution] = useState(null);
  const [distributionLoading, setDistributionLoading] = useState(false);
  const [distributionError, setDistributionError] = useState(null);
  const [marginTrading, setMarginTrading] = useState(null);
  const [marginTradingLoading, setMarginTradingLoading] = useState(false);
  const [marginTradingError, setMarginTradingError] = useState(null);
  const [focusedLayer, setFocusedLayer] = useState('atr');
  const [strategySheetVisible, setStrategySheetVisible] = useState(false);
  const [detailSheetVisible, setDetailSheetVisible] = useState(false);
  const [detailSelectedOnly, setDetailSelectedOnly] = useState(true);
  const [comparisonPickerVisible, setComparisonPickerVisible] = useState(false);
  const [comparisonManualSymbol, setComparisonManualSymbol] = useState('');
  const [comparisonManualError, setComparisonManualError] = useState('');
  const [assetSwitcherVisible, setAssetSwitcherVisible] = useState(false);
  const [switchAssets, setSwitchAssets] = useState([]);
  const [switchAssetQuery, setSwitchAssetQuery] = useState('');
  const [switchAssetMarket, setSwitchAssetMarket] = useState('ALL');
  const [switchAssetSource, setSwitchAssetSource] = useState('ALL');
  const [switchAssetsLoading, setSwitchAssetsLoading] = useState(false);
  const [switchAssetsError, setSwitchAssetsError] = useState('');
  const [layers, setLayers] = useState(DEFAULT_TECHNICAL_LAYERS);
  const [squeezePreset, setSqueezePreset] = useState('standard');
  const [maSwingSettings, setMaSwingSettings] = useState(() => normalizeMaSwingSettings());
  const [maSwingReady, setMaSwingReady] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(true);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(MA_SWING_STORAGE_KEY).then(raw => {
      if (!cancelled && raw) setMaSwingSettings(normalizeMaSwingSettings(JSON.parse(raw)));
    }).catch(() => {}).finally(() => { if (!cancelled) setMaSwingReady(true); });
    return () => { cancelled = true; };
  }, []);
  const maSwingSaveQueue = useRef(Promise.resolve());
  useEffect(() => {
    if (!maSwingReady) return;
    maSwingSaveQueue.current = maSwingSaveQueue.current.catch(() => {}).then(() =>
      AsyncStorage.setItem(MA_SWING_STORAGE_KEY, JSON.stringify(maSwingSettings)),
    ).catch(() => { Alert.alert('設定未儲存', '目前設定仍有效，但重新開啟後可能還原。'); });
  }, [maSwingSettings, maSwingReady]);
  const changeMaSwingSettings = useCallback((key, period) => {
    setMaSwingSettings(previous => {
      const next = { ...previous, [key]: period };
      if (key === 'shortExit' && period != null && next.longExit != null && period > next.longExit) next.longExit = period;
      if (key === 'longExit' && period != null && next.shortExit != null && period < next.shortExit) next.shortExit = period;
      return normalizeMaSwingSettings(next);
    });
  }, []);
  const squeezePresetHydratedRef = useRef(false);

  const loadSwitchAssets = useCallback(async () => {
    setSwitchAssetsLoading(true);
    setSwitchAssetsError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('請先登入');
      const [holdingsResult, watchlistResult, localWatchlistRaw] = await Promise.all([
        supabase.from('assets')
          .select('id,name,symbol,market_type,currency,current_shares,average_cost,category')
          .eq('user_id', user.id)
          .eq('category', 'investment')
          .gt('current_shares', 0),
        supabase.from('watchlist').select('id,symbol,market_type').eq('user_id', user.id),
        AsyncStorage.getItem('watchlist').catch(() => null),
      ]);
      if (holdingsResult.error) throw holdingsResult.error;
      let localWatchlist = [];
      try { localWatchlist = JSON.parse(localWatchlistRaw || '[]'); } catch { localWatchlist = []; }
      const cloudWatchlist = watchlistResult.error ? [] : (watchlistResult.data || []);
      const watchlist = cloudWatchlist.length
        ? cloudWatchlist.map(entry => ({
          ...entry,
          name: localWatchlist.find(local => switchAssetKey(local) === switchAssetKey(entry))?.name || entry.symbol,
        }))
        : localWatchlist;
      const supported = asset => ['TW', 'US', 'CRYPTO'].includes(String(asset?.market_type || '').toUpperCase());
      setSwitchAssets(buildSwitchAssets(
        (holdingsResult.data || []).filter(asset => asset.symbol && supported(asset)),
        (watchlist || []).filter(asset => asset.symbol && supported(asset)),
        { symbol, name, market_type: marketType, currency, average_cost: averageCost, current_shares: currentShares },
      ));
    } catch (switchError) {
      setSwitchAssetsError(switchError?.message || '無法載入持倉與自選');
    } finally {
      setSwitchAssetsLoading(false);
    }
  }, [symbol, name, marketType, currency, averageCost, currentShares]);

  const openAssetSwitcher = useCallback(() => {
    setSwitchAssetQuery('');
    setSwitchAssetMarket('ALL');
    setSwitchAssetSource('ALL');
    setAssetSwitcherVisible(true);
    loadSwitchAssets();
  }, [loadSwitchAssets]);

  useEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`切換個股，目前為 ${symbol}`}
          hitSlop={14}
          onPress={openAssetSwitcher}
          style={styles.headerAssetSwitcher}
        >
          <Text numberOfLines={1} style={[styles.headerAssetSwitcherText, { color: colors.text }]}>{symbol} 技術分析</Text>
          <ChevronDown size={16} color={colors.textSub} />
        </Pressable>
      ),
      headerTitleAlign: 'center',
    });
  }, [navigation, symbol, colors.text, colors.textSub, openAssetSwitcher]);

  const selectSwitchAsset = asset => {
    if (switchAssetKey(asset) === switchAssetKey({ symbol, market_type: marketType })) {
      setAssetSwitcherVisible(false);
      return;
    }
    setAssetSwitcherVisible(false);
    setLoading(true);
    setError(null);
    setRawRows([]);
    setReplayDate(null);
    setMarketContext({ marketType: asset.market_type, institutional: [] });
    setComparisonSymbols([]);
    setComparisonRows([]);
    setComparisonError(null);
    setAtrPosition(null);
    setValuationData(null);
    setValuationError(null);
    setDcfData(null);
    setDcfError(null);
    setFinancialReports(null);
    setFinancialReportsError(null);
    setCorporateActions(null);
    setCorporateActionsError(null);
    setInstitutionalDistribution(null);
    setDistributionError(null);
    setMarginTrading(null);
    setMarginTradingError(null);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    navigation.setParams({
      symbol: asset.symbol,
      name: asset.name || asset.symbol,
      averageCost: Number(asset.average_cost || 0),
      currentShares: Number(asset.current_shares || 0),
      marketType: asset.market_type,
      currency: asset.currency,
    });
  };

  const filteredSwitchAssets = useMemo(() => {
    const keyword = switchAssetQuery.trim().toUpperCase();
    return switchAssets.filter(asset => {
      const matchesMarket = switchAssetMarket === 'ALL' || String(asset.market_type || '').toUpperCase() === switchAssetMarket;
      const matchesSource = switchAssetSource === 'ALL' || (switchAssetSource === 'HOLDING' && asset.isHolding) || (switchAssetSource === 'WATCHLIST' && asset.isWatchlist);
      const matchesQuery = !keyword || [asset.symbol, asset.name || ''].join(' ').toUpperCase().includes(keyword);
      return matchesMarket && matchesSource && matchesQuery;
    });
  }, [switchAssets, switchAssetQuery, switchAssetMarket, switchAssetSource]);

  const manualComparisonAssets = useMemo(() => comparisonSymbols.map(value => {
    const target = normalizeComparisonTarget(value, marketType);
    return { ...target, name: target.symbol, isComparisonManual: true };
  }), [comparisonSymbols, marketType]);
  const comparisonAssets = useMemo(() => {
    const merged = new Map();
    const keyword = switchAssetQuery.trim().toUpperCase();
    const visibleManualAssets = manualComparisonAssets.filter(asset => {
      const matchesMarket = switchAssetMarket === 'ALL' || normalizeMarketType(asset.market_type) === normalizeMarketType(switchAssetMarket);
      const matchesSource = switchAssetSource === 'ALL';
      const matchesQuery = !keyword || [asset.symbol, asset.name || ''].join(' ').toUpperCase().includes(keyword);
      return matchesMarket && matchesSource && matchesQuery;
    });
    [...filteredSwitchAssets, ...visibleManualAssets].forEach(asset => {
      if (switchAssetKey(asset) !== switchAssetKey({ symbol, market_type: marketType })) merged.set(switchAssetKey(asset), asset);
    });
    return [...merged.values()];
  }, [filteredSwitchAssets, manualComparisonAssets, marketType, symbol, switchAssetMarket, switchAssetQuery, switchAssetSource]);
  const comparisonAvailableAssets = useMemo(() => {
    const merged = new Map();
    [...switchAssets, ...manualComparisonAssets].forEach(asset => {
      if (switchAssetKey(asset) !== switchAssetKey({ symbol, market_type: marketType })) merged.set(switchAssetKey(asset), asset);
    });
    return [...merged.values()];
  }, [manualComparisonAssets, marketType, symbol, switchAssets]);

  const openComparisonPicker = useCallback(() => {
    setSwitchAssetQuery('');
    setSwitchAssetMarket('ALL');
    setSwitchAssetSource('ALL');
    setComparisonManualSymbol('');
    setComparisonManualError('');
    setComparisonPickerVisible(true);
    loadSwitchAssets();
  }, [loadSwitchAssets, marketType]);

  const toggleComparisonAsset = asset => {
    const selectedKey = switchAssetKey(asset);
    setComparisonSymbols(current => {
      const selected = current.some(value => comparisonTargetKey(value) === selectedKey);
      if (selected) return current.filter(value => comparisonTargetKey(value) !== selectedKey);
      if (current.length >= 3) return current;
      return [...current, normalizeComparisonTarget(asset, marketType)];
    });
  };

  const addManualComparison = () => {
    const raw = String(comparisonManualSymbol || '').trim().toUpperCase();
    const prefixMatch = raw.match(/^(TW|US|CRYPTO)\s*[:/]\s*(.+)$/);
    const selectedMarket = normalizeMarketType(switchAssetMarket);
    const fallbackMarket = selectedMarket === 'ALL'
      ? (/^\d+$/.test(raw) ? 'TW' : normalizeMarketType(marketType) === 'CRYPTO' ? 'CRYPTO' : 'US')
      : selectedMarket;
    const market = normalizeMarketType(prefixMatch?.[1] || fallbackMarket);
    const normalized = String(prefixMatch?.[2] || raw).replace(/\s+/g, '').toUpperCase();
    const valid = market === 'TW'
      ? /^\d{4,6}$/.test(normalized)
      : market === 'CRYPTO'
        ? /^[A-Z0-9-]{2,15}$/.test(normalized)
        : /^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized);
    if (!valid) {
      setComparisonManualError(market === 'TW' ? '請輸入 4–6 碼台股代碼。' : market === 'CRYPTO' ? '請輸入有效的幣種代碼。' : '請輸入有效的美股代碼。');
      return;
    }
    const target = { symbol: normalized, market_type: market };
    if (comparisonTargetKey(target) === comparisonTargetKey({ symbol, market_type: marketType })) {
      setComparisonManualError('不能加入目前正在查看的標的。');
      return;
    }
    if (comparisonSymbols.some(value => comparisonTargetKey(value) === comparisonTargetKey(target))) {
      setComparisonManualError('這個標的已經加入比較。');
      return;
    }
    if (comparisonSymbols.length >= 3) {
      setComparisonManualError('最多只能加入 3 檔比較標的。');
      return;
    }
    setComparisonSymbols(current => [...current, target]);
    setComparisonManualSymbol('');
    setComparisonManualError('');
  };

  const load = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const context = await fetchMarketTechnicalContext(symbol, marketType, 1825, forceRefresh, true);
      setRawRows(context.rows);
      setMarketContext(context);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: position, error: positionError } = await supabase.from('hybrid_strategy_positions')
          .select('entry_date,entry_price,entry_atr,highest_price,initial_stop,trailing_stop,effective_stop,status,last_price,last_event_at')
          .eq('user_id', user.id)
          .eq('symbol', String(symbol || '').trim().toUpperCase())
          .eq('market', String(marketType || 'TW').trim().toUpperCase())
          .in('status', ['active', 'risk', 'recovered'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (positionError) console.warn('Unable to load ATR position:', positionError.message);
        setAtrPosition(positionError ? null : position);
      } else {
        setAtrPosition(null);
      }
    } catch (e) {
      const message = e?.message || '無法載入技術資料';
      setError(/non-2xx status code|FunctionsHttpError/i.test(message)
        ? '歷史行情服務暫時無法取得資料，請稍後重試。'
        : message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setReplayDate(null); }, [symbol, marketType]);
  useEffect(() => { load(); }, [symbol, marketType]);
  const comparisonKey = comparisonSymbols.map(value => comparisonTargetKey(value)).join(',');
  const loadComparison = useCallback(async (forceRefresh = false) => {
    if (!comparisonSymbols.length) {
      setComparisonRows([]);
      setComparisonError(null);
      return;
    }
    setComparisonLoading(true);
    setComparisonError(null);
    try {
      const context = await fetchMarketTechnicalContext(symbol, marketType, 1825, forceRefresh, true, comparisonSymbols);
      const requestedTargets = comparisonSymbols.map(value => normalizeComparisonTarget(value, marketType));
      const responseRows = context.comparisonRows || [];
      const responseByKey = new Map(responseRows.map(item => [comparisonTargetKey(item), item]));
      const fallbackTargets = requestedTargets.filter(target => {
        const row = responseByKey.get(comparisonTargetKey(target));
        return !row?.rows?.length;
      });
      if (fallbackTargets.length) {
        const fallbackRows = await Promise.all(fallbackTargets.map(async target => {
          try {
            const targetContext = await fetchMarketTechnicalContext(target.symbol, target.market_type, 1095, forceRefresh, true);
            return { symbol: target.symbol, marketType: target.market_type, market: target.market_type, rows: targetContext.rows || [], error: targetContext.contextError };
          } catch (fallbackError) {
            return { symbol: target.symbol, marketType: target.market_type, market: target.market_type, rows: [], error: fallbackError?.message || '比較資料取得失敗' };
          }
        }));
        fallbackRows.forEach(row => responseByKey.set(comparisonTargetKey(row), row));
      }
      const mergedRows = requestedTargets.map(target => responseByKey.get(comparisonTargetKey(target))).filter(Boolean);
      setComparisonRows(mergedRows);
      const failed = mergedRows.filter(item => item.error || !item.rows?.length);
      if (failed.length === comparisonSymbols.length) setComparisonError('目前無法取得所選比較標的資料。');
    } catch (comparisonFailure) {
      setComparisonRows([]);
      setComparisonError(comparisonFailure?.message || '無法取得比較資料');
    } finally {
      setComparisonLoading(false);
    }
  }, [comparisonKey, marketType, symbol]);
  useEffect(() => {
    if (selectedAnalysis === 'comparison') loadComparison();
  }, [selectedAnalysis, loadComparison]);
  const loadValuation = useCallback(async (forceRefresh = false) => {
    const market = String(marketType || '').toUpperCase();
    if (!['TW', 'US'].includes(market)) {
      setValuationData(null);
      setValuationError(null);
      return;
    }
    setValuationLoading(true);
    setValuationError(null);
    try {
      setValuationData(await fetchValuationHistory(symbol, market, forceRefresh));
    } catch (valuationFailure) {
      setValuationError(valuationFailure?.message || '無法取得估值資料');
    } finally {
      setValuationLoading(false);
    }
  }, [symbol, marketType]);
  useEffect(() => { loadValuation(); }, [loadValuation]);
  const loadDcf = useCallback(async (forceRefresh = false) => {
    const market = String(marketType || '').toUpperCase();
    if (!['TW', 'US'].includes(market)) {
      setDcfData(null);
      setDcfError(null);
      return;
    }
    setDcfLoading(true);
    setDcfError(null);
    try {
      setDcfData(await fetchDcfFundamentals(symbol, market, forceRefresh));
    } catch (dcfFailure) {
      setDcfError(dcfFailure?.message || '無法取得 DCF 財報資料');
    } finally {
      setDcfLoading(false);
    }
  }, [symbol, marketType]);
  useEffect(() => { loadDcf(); }, [loadDcf]);
  const loadFinancialReports = useCallback(async (forceRefresh = false) => {
    const market = String(marketType || '').toUpperCase();
    if (!['TW', 'US'].includes(market)) {
      setFinancialReports(null);
      setFinancialReportsError(null);
      return;
    }
    setFinancialReportsLoading(true);
    setFinancialReportsError(null);
    try {
      setFinancialReports(await fetchFinancialReports(symbol, market, forceRefresh));
    } catch (financialReportsFailure) {
      setFinancialReportsError(financialReportsFailure?.message || '無法取得財報資料');
    } finally {
      setFinancialReportsLoading(false);
    }
  }, [symbol, marketType]);
  useEffect(() => { loadFinancialReports(); }, [loadFinancialReports]);
  useEffect(() => {
    if (selectedAnalysis !== 'financialReports' || !financialReports
      || Number(financialReports.calculationVersion) >= 10) return;
    const refreshKey = `${String(marketType || '').toUpperCase()}:${symbol}:${financialReports.calculationVersion ?? 'missing'}`;
    if (staleFinancialRefreshRef.current === refreshKey) return;
    staleFinancialRefreshRef.current = refreshKey;
    loadFinancialReports(true);
  }, [selectedAnalysis, financialReports?.calculationVersion, symbol, marketType, loadFinancialReports]);
  const loadCorporateActions = useCallback(async (forceRefresh = false) => {
    const market = String(marketType || '').toUpperCase();
    if (!['TW', 'US'].includes(market)) {
      setCorporateActions(null);
      setCorporateActionsError(null);
      return;
    }
    setCorporateActionsLoading(true);
    setCorporateActionsError(null);
    try {
      setCorporateActions(await fetchCorporateActions(symbol, market, forceRefresh));
    } catch (corporateActionsFailure) {
      setCorporateActionsError(corporateActionsFailure?.message || '無法取得股利／除權息資料');
    } finally {
      setCorporateActionsLoading(false);
    }
  }, [symbol, marketType]);
  useEffect(() => { loadCorporateActions(); }, [loadCorporateActions]);
  const loadDistribution = useCallback(async (forceRefresh = false) => {
    if (String(marketType || '').toUpperCase() !== 'TW') {
      setInstitutionalDistribution(null);
      setDistributionError(null);
      return;
    }
    setDistributionLoading(true);
    setDistributionError(null);
    try {
      setInstitutionalDistribution(await fetchInstitutionalDistribution(symbol, forceRefresh));
    } catch (distributionFailure) {
      setDistributionError(distributionFailure?.message || '無法取得籌碼分布資料');
    } finally {
      setDistributionLoading(false);
    }
  }, [symbol, marketType]);
  useEffect(() => { loadDistribution(); }, [loadDistribution]);
  const loadMarginTrading = useCallback(async (forceRefresh = false) => {
    if (String(marketType || '').toUpperCase() !== 'TW') {
      setMarginTrading(null);
      setMarginTradingError(null);
      return;
    }
    setMarginTradingLoading(true);
    setMarginTradingError(null);
    try {
      setMarginTrading(await fetchMarginTradingHistory(symbol, forceRefresh));
    } catch (marginFailure) {
      setMarginTradingError(marginFailure?.message || '無法取得融資融券資料');
    } finally {
      setMarginTradingLoading(false);
    }
  }, [symbol, marketType]);
  useEffect(() => { loadMarginTrading(); }, [loadMarginTrading]);
  const refreshVisibleQuote = useCallback(async () => {
    try {
      const quote = await fetchLatestMarketQuote(symbol, marketType);
      const isLive = quote.quote_status === 'intraday' && !quote.is_stale;
      const nextQuote = {
        price: Number(quote.price),
        time: quote.source_time,
        candleDate: quote.candle_date || String(quote.source_time || '').slice(0, 10),
        open: Number(quote.open || 0),
        high: Number(quote.high || 0),
        low: Number(quote.low || 0),
        volume: Number(quote.volume || 0),
        source: quote.source,
        isLive,
        quoteStatus: quote.quote_status,
        isStale: quote.is_stale,
        delaySeconds: quote.delay_seconds,
      };
      setMarketContext(current => ({
        ...current,
        quote: nextQuote,
        quoteSource: quote.source,
        quoteStatus: quote.quote_status,
        quoteTime: quote.source_time,
        isIntraday: isLive,
        intradayUnavailable: Boolean(quote.is_stale) || (!isLive && quote.quote_status === 'intraday'),
      }));
      if (isLive && nextQuote.candleDate && nextQuote.open > 0 && nextQuote.high > 0 && nextQuote.low > 0) {
        setRawRows(current => [
          ...current.filter(row => row.time !== nextQuote.candleDate),
          {
            time: nextQuote.candleDate,
            open: nextQuote.open,
            high: nextQuote.high,
            low: nextQuote.low,
            close: nextQuote.price,
            volume: nextQuote.volume,
          },
        ].sort((a, b) => a.time.localeCompare(b.time)));
      }
    } catch (quoteError) {
      console.warn('Unable to refresh visible quote:', quoteError?.message || quoteError);
    }
  }, [symbol, marketType]);

  useFocusEffect(useCallback(() => {
    const timer = setInterval(refreshVisibleQuote, LIVE_QUOTE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshVisibleQuote]));
  useEffect(() => {
    if (initialStrategy) {
      setSelectedStrategyKeys(initialStrategy === 'ALL' ? [] : [initialStrategy]);
      selectStrategy(initialStrategy);
      setSelectedAnalysis(initialAnalysis || initialStrategy);
      return;
    }
    if (initialAnalysis) {
      setSelectedAnalysis(initialAnalysis);
      return;
    }
    if (!strategyKey && !analysisKey) {
      setSelectedStrategyKeys([]);
      setSelectedStrategy(null);
      setSelectedAnalysis(null);
    }
  }, [initialStrategy, initialAnalysis, strategyKey, analysisKey]);
  useEffect(() => {
    let cancelled = false;
    loadTtmSqueezePreset().then(preset => {
      if (cancelled) return;
      setSqueezePreset(preset);
      squeezePresetHydratedRef.current = true;
    }).catch(() => {
      if (!cancelled) squeezePresetHydratedRef.current = true;
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(EXIT_MANAGEMENT_SETTINGS_STORAGE_KEY).then(raw => {
      if (cancelled) return;
      try {
        const parsed = JSON.parse(raw || '{}');
        setAtrMultiplier(normalizeAtrMultiplier(parsed?.atrMultiplier));
      } catch {
        setAtrMultiplier(ATR_MULTIPLIER_DEFAULT);
      } finally {
        atrMultiplierHydratedRef.current = true;
      }
    }).catch(() => {
      if (!cancelled) atrMultiplierHydratedRef.current = true;
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!atrMultiplierHydratedRef.current) return;
    AsyncStorage.setItem(EXIT_MANAGEMENT_SETTINGS_STORAGE_KEY, JSON.stringify({ atrMultiplier: normalizeAtrMultiplier(atrMultiplier) })).catch(() => {});
  }, [atrMultiplier]);
  useEffect(() => {
    if (initialStrategy) return undefined;
    let cancelled = false;
    const restoreStrategySelection = async () => {
      let restoredKeys = [];
      try {
        const raw = await AsyncStorage.getItem(STRATEGY_SELECTION_STORAGE_KEY);
        const parsed = JSON.parse(raw || '{}');
        const storedKeys = Array.isArray(parsed?.selectedStrategyKeys) ? parsed.selectedStrategyKeys : [];
        restoredKeys = [...new Set(storedKeys.filter(key => ALL_SELECTABLE_STRATEGY_KEYS.includes(key)))];
      } catch {
        restoredKeys = [];
      }
      if (cancelled) return;
      strategySelectionHydratedRef.current = true;
      const restoredPrimary = restoredKeys[0] || null;
      setSelectedStrategyKeys(restoredKeys);
      setSelectedStrategy(restoredPrimary);
      setSelectedAnalysis(initialAnalysis || restoredPrimary);
      if (restoredPrimary) selectStrategy(restoredPrimary);
      else selectStrategy(null);
    };
    restoreStrategySelection();
    return () => { cancelled = true; };
  }, [initialStrategy, initialAnalysis, strategyKey]);
  useEffect(() => {
    if (!strategySelectionHydratedRef.current) return;
    const persistedKeys = [...new Set(selectedStrategyKeys.filter(key => ALL_SELECTABLE_STRATEGY_KEYS.includes(key)))];
    AsyncStorage.setItem(STRATEGY_SELECTION_STORAGE_KEY, JSON.stringify({ selectedStrategyKeys: persistedKeys })).catch(() => {});
  }, [selectedStrategyKeys]);
  useEffect(() => {
    const market = String(marketType || '').toUpperCase();
    const supported = STRATEGIES.some(item => item.key === selectedAnalysis)
      || STRATEGY_LIBRARY.some(item => item.key === selectedAnalysis)
      || SUPPLEMENTARY_ANALYSES.some(item => item.key === selectedAnalysis && item.markets.includes(market));
    // null is an intentional state when the user chooses「不顯示詳細資訊」.
    // Only recover an invalid non-empty selection after a market/route change.
    if (selectedAnalysis && !supported) setSelectedAnalysis(selectedStrategy);
  }, [marketType, selectedAnalysis, selectedStrategy]);

  const changeSqueezePreset = useCallback(next => {
    setSqueezePreset(next);
    if (squeezePresetHydratedRef.current) saveTtmSqueezePreset(next).catch(() => {});
  }, []);
  const liveQuote = marketContext.quote?.price > 0 ? marketContext.quote : null;
  const periodRows = PERIODS.find(item => item.key === period)?.rows || 260;
  const technicalContext = useMemo(() => ({
    ...marketContext,
    strategySettings: {
      ...(marketContext.strategySettings || {}),
      'indicator-bollinger-squeeze': { preset: squeezePreset },
      'trend-ma-swing': maSwingSettings,
    },
  }), [marketContext, squeezePreset, maSwingSettings]);
  const replayDates = useMemo(() => getTechnicalReplayDates(rawRows, periodRows, 60), [rawRows, periodRows]);
  const deferredReplayDate = useDeferredValue(replayDate);
  const replayInput = useMemo(() => buildTechnicalReplayInput(rawRows, technicalContext, deferredReplayDate, periodRows), [rawRows, technicalContext, deferredReplayDate, periodRows]);
  const latestDisplayCount = Math.min(periodRows, rawRows.length);
  const latestAnalysis = useMemo(() => rawRows.length >= 60
    ? analyzeTechnicalData(rawRows, latestDisplayCount, technicalContext)
    : null, [rawRows, latestDisplayCount, technicalContext]);
  const historicalAnalysis = useMemo(() => deferredReplayDate && replayInput.rows.length >= 60
    ? analyzeTechnicalData(replayInput.rows, replayInput.displayCount, replayInput.context)
    : null, [deferredReplayDate, replayInput]);
  const isReplayActive = Boolean(replayDate && historicalAnalysis);
  const analysis = isReplayActive ? historicalAnalysis : latestAnalysis;
  const activeContext = isReplayActive ? replayInput.context : marketContext;
  const backtestRows = useMemo(() => {
    const rows = isReplayActive ? replayInput.rows : rawRows;
    return !isReplayActive && (marketContext.isIntraday || marketContext.quoteStatus === 'intraday') ? rows.slice(0, -1) : rows;
  }, [isReplayActive, replayInput.rows, rawRows, marketContext.isIntraday, marketContext.quoteStatus]);
  const visibleRows = analysis?.rows || [];
  useEffect(() => {
    if (replayDate && replayDates.length && !replayDates.includes(replayDate)) setReplayDate(null);
  }, [replayDate, replayDates]);
  const exitManagement = useMemo(() => calculateExitManagement({
    analysis: latestAnalysis,
    averageCost: Number(averageCost),
    atrMultiplier,
    atrPosition,
    marketType,
    excludeLatest: Boolean(liveQuote?.isLive && String(liveQuote?.candleDate || liveQuote?.time || '').slice(0, 10) === latestAnalysis?.latest?.time),
  }), [latestAnalysis, averageCost, atrMultiplier, atrPosition, marketType, liveQuote]);
  const entryScaling = useMemo(() => calculateEntryScaling({
    analysis: latestAnalysis,
    averageCost: Number(averageCost),
    atrMultiplier,
    marketType,
    excludeLatest: Boolean(liveQuote?.isLive && String(liveQuote?.candleDate || liveQuote?.time || '').slice(0, 10) === latestAnalysis?.latest?.time),
  }), [latestAnalysis, averageCost, atrMultiplier, marketType, liveQuote]);

  const assetSwitcher = <AssetSwitcherModal
    visible={assetSwitcherVisible}
    onClose={() => setAssetSwitcherVisible(false)}
    assets={filteredSwitchAssets}
    query={switchAssetQuery}
    setQuery={setSwitchAssetQuery}
    market={switchAssetMarket}
    setMarket={setSwitchAssetMarket}
    source={switchAssetSource}
    setSource={setSwitchAssetSource}
    loading={switchAssetsLoading}
    error={switchAssetsError}
    currentKey={switchAssetKey({ symbol, market_type: marketType })}
    onSelect={selectSwitchAsset}
    onRefresh={loadSwitchAssets}
    colors={colors}
  />;

  const askAI = () => {
    if (!analysis) return;
    const aiAnalysis = isStandaloneAnalysis ? latestAnalysis : analysis;
    const displayName = marketContext.name || name || symbol;
    const valuationSummary = valuationData ? `\n\n估值補充：資料來源 ${valuationData.source || '未提供'}，截止 ${valuationData.asOf || '未知'}。${Object.entries(valuationData.metrics || {}).map(([key, rows]) => {
      const latest = Array.isArray(rows) ? rows.at(-1)?.value : null;
      return Number.isFinite(Number(latest)) ? `${key} ${Number(latest).toFixed(2)}` : null;
    }).filter(Boolean).join('、')}。請清楚區分估值與技術訊號。` : '';
    const financialReportsSummary = financialReports ? `\n\n財報補充：資料來源 ${financialReports.source || '未提供'}，財報期間截至 ${financialReports.asOf || '未知'}；最新季度 ${financialReports.quarters?.at(-1)?.label || '—'}，營收 ${Number.isFinite(Number(financialReports.quarters?.at(-1)?.revenue)) ? Number(financialReports.quarters.at(-1).revenue).toFixed(2) : '—'}，GAAP 稀釋 EPS ${Number.isFinite(Number(financialReports.quarters?.at(-1)?.eps)) ? Number(financialReports.quarters.at(-1).eps).toFixed(2) : '—'}，淨利率 ${Number.isFinite(Number(financialReports.quarters?.at(-1)?.netMargin)) ? Number(financialReports.quarters.at(-1).netMargin).toFixed(2) : '—'}%，自由現金流 ${Number.isFinite(Number(financialReports.quarters?.at(-1)?.freeCashFlow)) ? Number(financialReports.quarters.at(-1).freeCashFlow).toFixed(2) : '—'}；最近公布 ${financialReports.earningsCalendar?.previousDate || '尚未提供'}，最近 SEC 申報 ${financialReports.quarters?.at(-1)?.filedAt || '尚未提供'}，下次財報 ${financialReports.earningsCalendar?.nextDate || '尚未提供'}。正式財報、申報日與第三方預估請分開解讀。` : '';
    const corporateActionsSummary = corporateActions ? `\n\n股利／除權息補充：資料來源 ${corporateActions.source || '未提供'}，截止 ${corporateActions.asOf || '未知'}；近 12 月現金股利 ${Number.isFinite(Number(corporateActions.summary?.trailingCashDividend)) ? Number(corporateActions.summary.trailingCashDividend).toFixed(2) : '—'}，近 12 月殖利率 ${Number.isFinite(Number(corporateActions.summary?.trailingYield)) ? Number(corporateActions.summary.trailingYield).toFixed(2) : '—'}%。最近事件 ${corporateActions.summary?.latestEvent?.exDate || '—'}，下一次已公告 ${corporateActions.summary?.nextEvent?.exDate || '尚未公告'}。請勿把公司行動資料直接解讀成買賣訊號。` : '';
    const replaySummary = isReplayActive
      ? (isStandaloneAnalysis
        ? '\n\n目前選取的是獨立分析；請以最新資料解讀該獨立分析，不要把歷史回放日期當成此卡片的計算基準。'
        : `\n\n這是歷史回放，截至 ${analysis.latest.time}；請只根據該日期以前的技術資料判斷，不要使用目前最新行情、估值、財報或公司行動資料補充。`)
      : '';
    navigation.navigate('AI', {
      aiRequestId: `${Date.now()}-${symbol}`,
      initialPrompt: `${technicalAnalysisPrompt(displayName, symbol, aiAnalysis, selectedStrategy)}${isReplayActive ? replaySummary : `${valuationSummary}${financialReportsSummary}${corporateActionsSummary}`}`,
    });
  };

  const toggleLayer = key => {
    setLayers(current => {
      const next = { ...current, [key]: !current[key] };
      if (next[key]) setFocusedLayer(key);
      else if (focusedLayer === key) setFocusedLayer(LAYER_OPTIONS.find(([candidate]) => next[candidate])?.[0] || null);
      return next;
    });
  };
  const selectStrategy = key => {
    if (!key) {
      setSelectedStrategy(null);
      setLayers({ ...DEFAULT_TECHNICAL_LAYERS });
      setFocusedLayer('atr');
      return;
    }
    const libraryStrategy = STRATEGY_LIBRARY.find(item => item.key === key);
    const libraryCategory = libraryStrategy?.category;
    const libraryUsesMacd = key === 'indicator-macd-cross' || key === 'price-bos-choch';
    const libraryUsesRsi = key === 'indicator-rsi-regime' || key === 'indicator-bollinger-reversion' || key === 'stats-zscore';
    const libraryUsesKd = key === 'indicator-kd-cross';
    const libraryUsesBoll = key === 'indicator-bollinger-squeeze' || key === 'indicator-bollinger-reversion';
    setSelectedStrategy(key);
    setLayers(current => ({
      ...current,
      volumeProfile: current.volumeProfile,
      boll: libraryUsesBoll || current.boll,
      flow: ['institutional', 'volume-mfi-cmf', 'volume-obv-divergence', 'volume-mfi-divergence', 'volume-cmf-divergence'].includes(key) ? true : current.flow,
      atr: current.atr,
      ma: key === 'ALL' || key === 'candlestick' || ['divergence', 'rsiDivergence', 'kdDivergence'].includes(key) || key === 'pullback' || key === 'boundary' || libraryCategory === '趨勢策略' || key === 'volume-vwap' || key === 'stats-momentum-ranking',
      volume: true,
      macd: key === 'ALL' || key === 'divergence' || key === 'boundary' || libraryUsesMacd,
      rsi: key === 'ALL' || key === 'rsi' || key === 'rsiDivergence' || libraryUsesRsi,
      kd: key === 'ALL' || key === 'boundary' || key === 'kdDivergence' || libraryUsesKd,
      levels: key === 'ALL' || ['divergence', 'rsi', 'rsiDivergence', 'kdDivergence'].includes(key) || libraryCategory === '形態策略' || libraryCategory === '價格行為／SMC' || libraryCategory === '量價與資金流',
    }));
  };
  const latestSpike = analysis?.volumeSpikes.at(-1);
  const activeDivergence = analysis?.divergences.filter(item => item.status === 'confirmed' || item.status === 'pending').at(-1);
  const latestDivergence = activeDivergence || analysis?.divergences.at(-1);

  if (loading) return <View style={[styles.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.accent} /><Text style={[styles.loadingText, { color: colors.textSub }]}>正在計算 K 線與技術指標…</Text>{assetSwitcher}</View>;
  if (error || !analysis) return <View style={[styles.center, { backgroundColor: colors.bg }]}><CircleAlert size={30} color={colors.warning} /><Text style={[styles.errorTitle, { color: colors.text }]}>無法產生技術圖</Text><Text style={[styles.errorText, { color: colors.textSub }]}>{error || '歷史資料不足'}</Text><TouchableOpacity style={[styles.retry, { backgroundColor: colors.accent }]} onPress={() => load(true)}><RefreshCw size={16} color={colors.accentContrast} /><Text style={[styles.retryText, { color: colors.accentContrast }]}>重新載入</Text></TouchableOpacity>{assetSwitcher}</View>;

  const effectiveLiveQuote = isReplayActive ? null : liveQuote;
  const displayName = marketContext.name || name || symbol;
  const displayedPrice = effectiveLiveQuote?.price || analysis.latest.close;
  const latestDisplayedPrice = liveQuote?.price || latestAnalysis?.latest?.close || displayedPrice;
  const intradayCandleDate = String(effectiveLiveQuote?.candleDate || effectiveLiveQuote?.time || '').slice(0, 10);
  const previousRow = visibleRows.at(-2);
  const quoteMatchesLatestRow = Boolean(effectiveLiveQuote && intradayCandleDate && intradayCandleDate === analysis.latest.time);
  const hasProvisionalCandle = Boolean(effectiveLiveQuote?.isLive && intradayCandleDate && intradayCandleDate >= analysis.latest.time);
  const latestCompletedDate = hasProvisionalCandle && quoteMatchesLatestRow
    ? (previousRow?.time || analysis.latest.time)
    : analysis.latest.time;
  // Yahoo may already place the current session inside the last daily candle.
  // When that happens, compare the quote with the preceding trading day's close,
  // rather than subtracting the current price from the same provisional candle.
  const comparisonClose = effectiveLiveQuote
    ? (quoteMatchesLatestRow ? previousRow?.close : analysis.latest.close)
    : previousRow?.close;
  const change = displayedPrice - comparisonClose;
  const changePct = comparisonClose ? change / comparisonClose * 100 : 0;
  const changeColor = change >= 0 ? colors.positive : colors.negative;
  const priorVolumeRows = visibleRows.slice(-21, -1);
  const averageVolume20 = priorVolumeRows.length ? priorVolumeRows.reduce((sum, row) => sum + Number(row.volume || 0), 0) / priorVolumeRows.length : 0;
  const currentVolumeRatio = averageVolume20 > 0 ? Number(analysis.latest.volume || 0) / averageVolume20 : 0;
  const profile = volumeProfileSummary(visibleRows);
  const isTaiwanMarket = String(marketType).toUpperCase() === 'TW';
  const availableSupplementaryAnalyses = SUPPLEMENTARY_ANALYSES.filter(item => item.markets.includes(String(marketType).toUpperCase()));
  const analysisOptions = [...STRATEGIES, ...STRATEGY_LIBRARY, ...availableSupplementaryAnalyses];
  const isStandaloneAnalysis = availableSupplementaryAnalyses.some(item => item.key === selectedAnalysis);
  const chartSelectedStrategy = selectedAnalysis === 'riskManagement' ? 'riskManagement' : selectedAnalysis === 'entryScaling' ? 'entryScaling' : isStandaloneAnalysis ? null : selectedStrategy;
  // 「目前查看策略」與「目前查看哪一張詳細卡」是兩個獨立狀態。
  // 選擇詳細資訊中的「不選策略」只應隱藏策略標記／詳細卡，不能讓已
  // 在「調整策略」勾選的策略被當成取消；因此沒有詳細策略時不傳入圖表
  // 的作用中策略，但保留 selectedStrategyKeys 給統計與下次選擇使用。
  const chartSelectedStrategies = isStandaloneAnalysis || !selectedAnalysis ? [] : selectedStrategyKeys;
  const selectedLibraryStrategy = STRATEGY_LIBRARY.find(item => item.key === selectedAnalysis);
  const selectedLibraryResult = analysis?.strategies?.find(item => item.key === selectedAnalysis);
  const analysisLabel = item => item.key === 'institutional'
    ? (isTaiwanMarket ? '法人籌碼' : '資金動能')
    : item.label;
  const selectedAnalysisLabel = selectedAnalysis
    ? analysisLabel(analysisOptions.find(item => item.key === selectedAnalysis) || STRATEGIES[0])
    : '未選擇詳細資訊';
  const selectedStrategyLabel = chartSelectedStrategy
    ? analysisLabel(analysisOptions.find(item => item.key === chartSelectedStrategy) || STRATEGIES[0])
    : null;
  const selectedStrategyNames = selectedStrategyKeys
    .map(key => analysisOptions.find(item => item.key === key))
    .filter(Boolean)
    .map(item => analysisLabel(item));
  const noChartStrategySelected = selectedStrategyKeys.length === 0 && selectedStrategy !== 'ALL';
  const valuationStatus = () => {
    if (valuationLoading && !valuationData) return { label: '更新中', color: colors.accent };
    if (valuationError && !valuationData) return { label: '取得失敗', color: colors.negative };
    const rows = (valuationData?.metrics?.per || []).filter(row => Number.isFinite(Number(row.value)));
    const latest = Number(rows.at(-1)?.value);
    if (!rows.length || !Number.isFinite(latest)) return { label: '資料不足', color: colors.textMuted };
    const percentile = Math.round(rows.filter(row => Number(row.value) <= latest).length / rows.length * 100);
    if (percentile <= 20) return { label: 'PER 便宜', color: colors.positive };
    if (percentile <= 40) return { label: 'PER 偏低', color: colors.positive };
    if (percentile <= 60) return { label: 'PER 合理', color: colors.warning };
    if (percentile <= 80) return { label: 'PER 偏高', color: colors.warning };
    return { label: 'PER 昂貴', color: colors.negative };
  };
  const dcfStatus = () => {
    if (dcfLoading && !dcfData) return { label: '更新中', color: colors.accent };
    if (dcfError && !dcfData) return { label: '取得失敗', color: colors.negative };
    if (dcfData?.unsupported) return { label: '不適用', color: colors.textMuted };
    return { label: dcfData?.fundamentals ? '可計算' : '資料不足', color: dcfData?.fundamentals ? colors.positive : colors.textMuted };
  };
  const financialReportsStatus = () => {
    if (financialReportsLoading && !financialReports) return { label: '更新中', color: colors.accent };
    if (financialReportsError && !financialReports) return { label: '取得失敗', color: colors.negative };
    const quarters = financialReports?.quarters || [];
    if (quarters.length >= 4) return { label: `近 ${quarters.length} 季`, color: colors.positive };
    if (quarters.length) return { label: `${quarters.length} 季`, color: colors.warning };
    return { label: '資料不足', color: colors.textMuted };
  };
  const corporateActionsStatus = () => {
    if (corporateActionsLoading && !corporateActions) return { label: '更新中', color: colors.accent };
    if (corporateActionsError && !corporateActions) return { label: '取得失敗', color: colors.negative };
    const nextDate = corporateActions?.summary?.nextEvent?.exDate;
    if (nextDate) return { label: `下次 ${nextDate.slice(5)}`, color: colors.positive };
    if (corporateActions?.events?.length) return { label: '有歷史資料', color: colors.positive };
    return { label: '資料不足', color: colors.textMuted };
  };
  const analysisStatus = item => {
    if (item.library) return strategyStatusMeta(analysis?.strategies?.find(strategy => strategy.key === item.key), colors);
    if (item.key === 'valuation') return valuationStatus();
    if (item.key === 'dcf') return dcfStatus();
    if (item.key === 'financialReports') return financialReportsStatus();
    if (item.key === 'corporateActions') return corporateActionsStatus();
    if (item.key === 'distribution') {
      if (distributionLoading && !institutionalDistribution) return { label: '更新中', color: colors.accent };
      if (distributionError && !institutionalDistribution) return { label: '取得失敗', color: colors.negative };
      return { label: institutionalDistribution?.asOf ? `截至 ${institutionalDistribution.asOf.slice(5)}` : '資料不足', color: institutionalDistribution ? colors.positive : colors.textMuted };
    }
    if (item.key === 'margin') {
      if (marginTradingLoading && !marginTrading) return { label: '更新中', color: colors.accent };
      if (marginTradingError && !marginTrading) return { label: '取得失敗', color: colors.negative };
      return { label: marginTrading?.asOf ? `截至 ${marginTrading.asOf.slice(5)}` : '資料不足', color: marginTrading ? colors.positive : colors.textMuted };
    }
    if (item.key === 'riskManagement') {
      const result = exitManagement;
      const color = result?.status === 'exit' || result?.status === 'reduce' ? colors.negative : result?.status === 'tighten' ? colors.warning : result?.status === 'hold' ? colors.positive : colors.textMuted;
      return { label: result?.statusLabel || '資料不足', color };
    }
    if (item.key === 'entryScaling') {
      const color = ['initial', 'add1', 'add2'].includes(entryScaling?.status) ? colors.positive : ['hold', 'tighten', 'noAdd', 'waitEntry'].includes(entryScaling?.status) ? colors.warning : colors.textMuted;
      return { label: entryScaling?.statusLabel || '資料不足', color };
    }
    if (item.key === 'tradePlan') return { label: '全標的共用', color: colors.accent };
    if (item.key === 'options') return { label: String(marketType).toUpperCase() === 'TW' ? '期交所盤後' : '延遲行情', color: colors.accent };
    if (item.key === 'ALL') {
      const status = analysis.hybrid?.status;
      const direction = analysis.hybrid?.direction === 'bearish' ? '偏空' : analysis.hybrid?.direction === 'bullish' ? '偏多' : '';
      if (status === 'confirmed') return { label: direction ? `${direction}已確認` : '已確認', color: colors.positive };
      if (status === 'watch') return { label: direction ? `${direction}觀察` : '觀察', color: colors.warning };
      return { label: '未成立', color: colors.textMuted };
    }
    const result = analysis.strategies?.find(strategy => strategy.key === item.key);
    const meta = strategyStatusMeta(result, colors);
    return {
      // Keep the directional interpretation visible in the picker. The card
      // already distinguishes bullish/bearish candidates; hiding it here made
      // every watch state look identical.
      label: meta.label,
      color: meta.color,
    };
  };
  const clearAnalysisSelection = () => {
    pendingStrategyScrollRef.current = false;
    setSelectedStrategyKeys([]);
    setSelectedAnalysis(null);
    selectStrategy(null);
    setStrategySheetVisible(false);
    setDetailSheetVisible(false);
  };
  const toggleStrategySelection = key => {
    const wasSelected = selectedStrategyKeys.includes(key);
    const nextKeys = wasSelected
      ? selectedStrategyKeys.filter(candidate => candidate !== key)
      : [...selectedStrategyKeys, key];
    const nextPrimary = nextKeys.length === 0
      ? null
      : wasSelected
        ? (nextKeys.includes(selectedStrategy) ? selectedStrategy : nextKeys.at(-1))
        : key;
    const nextDetail = nextKeys.length === 0
      ? null
      : selectedAnalysis && nextKeys.includes(selectedAnalysis)
        ? selectedAnalysis
        : nextPrimary;
    setSelectedStrategyKeys(nextKeys);
    setSelectedAnalysis(nextDetail);
    if (nextDetail) selectStrategy(nextDetail);
    else selectStrategy(null);
  };
  const allStrategiesSelected = selectedStrategyKeys.length === ALL_SELECTABLE_STRATEGY_KEYS.length
    && ALL_SELECTABLE_STRATEGY_KEYS.every(key => selectedStrategyKeys.includes(key));
  const toggleAllStrategies = () => {
    const nextKeys = allStrategiesSelected ? [] : ALL_SELECTABLE_STRATEGY_KEYS;
    const nextDetail = nextKeys.includes(selectedAnalysis) ? selectedAnalysis : nextKeys[0] || null;
    setSelectedStrategyKeys(nextKeys);
    setSelectedAnalysis(nextDetail);
    if (nextDetail) selectStrategy(nextDetail);
    else selectStrategy(null);
  };
  const selectAnalysisFromSheet = key => {
    if (MULTI_SELECT_STRATEGY_KEYS.has(key)) {
      toggleStrategySelection(key);
      return;
    }
    pendingStrategyScrollRef.current = true;
    setSelectedStrategyKeys([]);
    setSelectedAnalysis(key);
    if (key === 'ALL') selectStrategy(key);
    else selectStrategy(null);
    setStrategySheetVisible(false);
    setTimeout(() => {
      if (!pendingStrategyScrollRef.current) return;
      pendingStrategyScrollRef.current = false;
      scrollRef.current?.scrollTo({ y: Math.max(0, strategyResultYRef.current - 12), animated: true });
    }, 180);
  };
  const enableExitManagementLayers = () => {
    setLayers(current => ({ ...current, atr: true, ma: true, flow: true }));
  };
  const clearDetailSelection = () => {
    pendingStrategyScrollRef.current = false;
    // 詳細資訊的「不選策略」不等於取消「目前查看策略」的勾選。
    // 只清除目前詳細卡與圖表上的單一策略標記，保留 selectedStrategyKeys。
    setSelectedAnalysis(null);
    setSelectedStrategy(null);
    setDetailSheetVisible(false);
  };
  const selectDetailFromSheet = key => {
    pendingStrategyScrollRef.current = true;
    setSelectedAnalysis(key);
    if (key === 'riskManagement') enableExitManagementLayers();
    if (MULTI_SELECT_STRATEGY_KEYS.has(key)) selectStrategy(key);
    setDetailSheetVisible(false);
    setTimeout(() => {
      if (!pendingStrategyScrollRef.current) return;
      pendingStrategyScrollRef.current = false;
      scrollRef.current?.scrollTo({ y: Math.max(0, strategyResultYRef.current - 12), animated: true });
    }, 180);
  };
  const measureStrategyResult = event => {
    strategyResultYRef.current = event.nativeEvent.layout.y;
    if (!pendingStrategyScrollRef.current) return;
    pendingStrategyScrollRef.current = false;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, strategyResultYRef.current - 12), animated: true });
    });
  };
  const renderAnalysisOption = (item, { fullWidth = false } = {}) => {
    const selected = item.key === 'ALL'
      ? selectedStrategy === 'ALL'
      : selectedStrategyKeys.includes(item.key);
    const status = analysisStatus(item);
    return <TouchableOpacity
      key={item.key}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => selectAnalysisFromSheet(item.key)}
      style={[styles.strategySheetOption, fullWidth && styles.strategySheetOptionFullWidth, { backgroundColor: selected ? colors.accentSoft : colors.cardAlt, borderColor: selected ? colors.accent : colors.border }]}
    >
      <View style={styles.strategySheetOptionTop}>
        <Text numberOfLines={2} style={[styles.strategySheetOptionLabel, { color: selected ? colors.accent : colors.text }]}>{analysisLabel(item)}</Text>
        {selected && <Check size={15} color={colors.accent} />}
      </View>
      <View style={styles.strategySheetStatusRow}><View style={[styles.strategySheetStatusDot, { backgroundColor: status.color }]} /><Text style={[styles.strategySheetStatusText, { color: status.color }]}>{status.label}</Text></View>
    </TouchableOpacity>;
  };
  const detailStrategyOptions = analysisOptions.filter(item => MULTI_SELECT_STRATEGY_KEYS.has(item.key));
  const detailStrategyGroups = STRATEGY_SELECTION_CATEGORIES
    .map(category => ({
      category,
      items: sortStrategyItems(detailStrategyOptions.filter(item => item.category === category)),
    }))
    .filter(group => group.items.length);
  const visibleDetailStrategyGroups = detailSelectedOnly
    ? detailStrategyGroups
      .map(group => ({ ...group, items: group.items.filter(item => selectedStrategyKeys.includes(item.key)) }))
      .filter(group => group.items.length)
    : detailStrategyGroups;
  const renderDetailOption = (item, { available = true } = {}) => {
    const selected = selectedAnalysis === item.key;
    const status = analysisStatus(item);
    return <TouchableOpacity
      key={item.key}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => selectDetailFromSheet(item.key)}
      style={[styles.strategySheetOption, { backgroundColor: selected ? colors.accentSoft : colors.cardAlt, borderColor: selected ? colors.accent : colors.border, opacity: selected || available ? 1 : 0.52 }]}
    >
      <View style={styles.strategySheetOptionTop}>
        <Text numberOfLines={2} style={[styles.strategySheetOptionLabel, { color: selected ? colors.accent : colors.text }]}>{analysisLabel(item)}</Text>
        {selected && <Check size={15} color={colors.accent} />}
      </View>
      <View style={styles.strategySheetStatusRow}><View style={[styles.strategySheetStatusDot, { backgroundColor: status.color }]} /><Text style={[styles.strategySheetStatusText, { color: status.color }]}>{status.label}</Text></View>
    </TouchableOpacity>;
  };
  const analysisDisclaimer = selectedLibraryStrategy
    ? (isReplayActive
      ? `目前顯示的是截至 ${analysis.latest.time} 的歷史回放訊號；只使用當日以前 K 線，型態辨識、量價資料與假突破仍可能造成誤判，不構成買賣建議。`
      : '目前顯示的是依最新 K 線即時計算的研究訊號；型態辨識、量價資料與假突破仍可能造成誤判，不構成買賣建議。')
    : selectedAnalysis === 'valuation'
      ? '估值位階是與公司自身歷史相比，不代表絕對便宜，也不構成買賣建議。'
    : selectedAnalysis === 'dcf'
      ? 'DCF 是依財報與成長假設推算的內在價值模型，對 WACC、永續成長率與資料品質高度敏感，不構成買賣建議。'
    : selectedAnalysis === 'financialReports'
      ? '財報數字以來源公布的期間資料為主；財報日期與市場預估可能延遲或缺少，請以公司及交易所正式公告為準。'
    : selectedAnalysis === 'corporateActions'
      ? '股利、除權息與拆併股是公司行動資料；殖利率及填權息狀態會隨價格與資料來源更新，不構成買賣建議。'
    : selectedAnalysis === 'distribution'
      ? '籌碼分布是持股存量快照，分類可能重疊，不等同當日法人買賣超。'
    : selectedAnalysis === 'margin'
        ? '融資融券反映槓桿部位變化，必須配合價格趨勢判讀，不能單獨作為買賣依據。'
        : selectedAnalysis === 'riskManagement'
          ? '停損停利策略是依 ATR、均線與籌碼資料計算的研究試算；有效停損跌破時才列為出倉，不代表自動下單。'
        : selectedAnalysis === 'entryScaling'
          ? '進場加碼策略只允許在獲利且趨勢、波動與資金流確認時遞減加碼；不建議向下攤平，也不代表自動下單。'
        : selectedAnalysis === 'tradePlan'
          ? '交易計畫在建立時依 MA20／MA40／MA60 支撐或 ATR 設定固定停損，不會隨後續價格、ATR 或均線變動自動移動；狀態分為正常、警戒、失效，不會自動下單。'
        : selectedAnalysis === 'comparison'
          ? '比較圖以同一期間的累積報酬率呈現，不代表個別標的的絕對風險或未來報酬。'
        : selectedAnalysis === 'options'
          ? '選擇權 GEX 與 Wall 是依公開行情及模型推估，不代表造市商真實持倉；台股資料為期交所盤後資料。'
        : '支撐、壓力、背離與策略結果為程式化研究訊號，可能失效或延後確認，不等於買賣建議。';

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
    <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.quoteRow}>
        <View style={styles.quoteIdentity}><Text numberOfLines={1} style={[styles.symbol, { color: colors.text }]}>{symbol}</Text><Text style={[styles.name, { color: colors.textSub }]}>{displayName} · 日 K 完成至 {latestCompletedDate}{hasProvisionalCandle ? ` · ${intradayCandleDate} 盤中暫估` : ''}</Text></View>
        <View style={styles.quoteRight}><Text style={[styles.close, { color: colors.text }]}>{money(displayedPrice)}</Text><Text style={[styles.change, { color: changeColor }]}>{change >= 0 ? '+' : ''}{money(change)}（{changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%）</Text>{effectiveLiveQuote && <Text style={[styles.quoteMeta, { color: colors.textMuted }]}>{marketContext.quoteSource || effectiveLiveQuote.source || '行情來源'} · {effectiveLiveQuote.isLive ? '盤中' : effectiveLiveQuote.isStale ? '延遲報價' : '最近報價'} · {quoteTime(effectiveLiveQuote.time, marketType)} · 自動 30 秒</Text>}<TouchableOpacity onPress={() => load(true)} style={[styles.quoteRefresh, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}><RefreshCw size={11} color={colors.textSub} /><Text style={[styles.quoteRefreshText, { color: colors.textSub }]}>{isReplayActive ? '更新最新' : '更新'}</Text></TouchableOpacity></View>
      </View>

      <View style={styles.periodRow}>{PERIODS.map(item => <TouchableOpacity key={item.key} style={[styles.chip, { borderColor: period === item.key ? colors.accent : colors.border, backgroundColor: period === item.key ? colors.accentSoft : colors.card }]} onPress={() => setPeriod(item.key)}><Text style={[styles.chipText, { color: period === item.key ? colors.accent : colors.textSub }]}>{item.label}</Text></TouchableOpacity>)}</View>

      {isReplayActive && <View style={[styles.replayBanner, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}><Text style={[styles.replayBannerTitle, { color: colors.accent }]}>歷史回放截至 {analysis.latest.time}</Text><Text style={[styles.replayBannerText, { color: colors.textSub }]}>技術圖、策略統計與技術詳細卡只使用 {analysis.latest.time} 以前的資料。</Text></View>}

      <StrategySelectionControl strategies={analysis.strategies} selectedKeys={selectedStrategyKeys} selectedNames={selectedStrategyNames} colors={colors} onPress={() => setStrategySheetVisible(true)} />

      <View>
        <View style={styles.layerHeader}><Layers3 size={13} color={colors.textMuted} /><Text style={[styles.strategyPickerLabel, styles.layerPickerLabel, { color: colors.textMuted }]}>圖層顯示</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.layerRow}>{LAYER_OPTIONS.map(([key, label]) => {
          const displayLabel = key === 'flow' ? (String(marketType).toUpperCase() === 'TW' ? '法人籌碼' : '資金流') : label;
          return <TouchableOpacity key={key} style={[styles.layerChip, { backgroundColor: layers[key] ? colors.accentSoft : colors.card, borderColor: layers[key] ? colors.accent : colors.border }]} onPress={() => toggleLayer(key)}><View style={[styles.layerDot, { backgroundColor: layers[key] ? colors.accent : colors.textMuted }]} /><Text style={[styles.layerText, { color: layers[key] ? colors.accent : colors.textSub }]}>{displayLabel}</Text></TouchableOpacity>;
        })}</ScrollView>
      </View>

      <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: chartExpanded }} onPress={() => setChartExpanded(value => !value)} style={styles.chartHeader}><View style={styles.chartTitleRow}><BarChart3 size={17} color={colors.accent} /><Text style={[styles.chartTitle, { color: colors.text }]}>技術 K 線</Text></View><View style={styles.collapsibleStatus}><Text numberOfLines={1} style={[styles.chartHint, { color: colors.textMuted }]}>{isStandaloneAnalysis ? `獨立分析：${selectedAnalysisLabel}` : selectedStrategyLabel ? `僅顯示：${selectedStrategyLabel}` : '未選擇策略'}</Text>{chartExpanded ? <ChevronUp size={18} color={colors.textMuted} /> : <ChevronDown size={18} color={colors.textMuted} />}</View></TouchableOpacity>
        {chartExpanded && <TechnicalAnalysisChart analysis={analysis} colors={colors} averageCost={isReplayActive ? 0 : Number(averageCost)} layers={layers} periodKey={period} viewportKey={`${marketType}:${symbol}:${period}`} selectedStrategy={chartSelectedStrategy} selectedStrategies={chartSelectedStrategies} showCorporateActions={selectedAnalysis === 'corporateActions' && !isReplayActive} corporateActions={isReplayActive ? null : corporateActions} showFinancialReports={selectedAnalysis === 'financialReports' && !isReplayActive} financialReports={isReplayActive ? null : financialReports} liveQuote={effectiveLiveQuote} atrPosition={isReplayActive ? null : atrPosition} exitManagement={isReplayActive ? null : exitManagement} entryScaling={isReplayActive ? null : entryScaling} marketType={marketType} institutionalRows={activeContext.institutional || []} />}
      </View>

      <SelectedStrategiesSummary strategies={analysis.strategies} selectedKeys={selectedStrategyKeys} colors={colors} replayDates={replayDates} replayDate={replayDate} onReplayDateChange={setReplayDate} onLatest={() => setReplayDate(null)} isReplayActive={isReplayActive} />

      <View style={styles.analysisResult} onLayout={measureStrategyResult}>
        {isReplayActive && isStandaloneAnalysis && !['riskManagement', 'entryScaling', 'tradePlan'].includes(selectedAnalysis) && <View style={[styles.latestDataNotice, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.latestDataNoticeText, { color: colors.textMuted }]}>目前選取的是獨立分析；本卡片保留最新資料，未隨歷史回放日期重算。</Text></View>}
        {selectedAnalysis === 'comparison' && <BenchmarkComparisonCard
          symbol={symbol}
          rows={rawRows}
          benchmarkRows={marketContext.benchmarkRows || []}
          benchmarkLabel={String(marketType).toUpperCase() === 'TW' ? '加權指數' : String(marketType).toUpperCase() === 'US' ? 'S&P 500' : 'BTC'}
          comparisonRows={comparisonRows}
          comparisonAssets={comparisonAvailableAssets}
          comparisonSymbols={comparisonSymbols}
          initialRangeKey={period === '3M' ? '90d' : period === '6M' ? '180d' : period === '3Y' ? 'ALL' : '1Y'}
          loading={comparisonLoading}
          error={comparisonError}
          colors={colors}
          onManage={openComparisonPicker}
        />}
        {STRATEGIES.some(item => item.key === selectedAnalysis) && <>
          {selectedAnalysis === 'institutional' && layers.flow && isTaiwanMarket && <InstitutionalDailyTable rows={activeContext.institutional || []} priceRows={backtestRows} colors={colors} />}
          <SelectedStrategyCard analysis={analysis} selectedStrategy={selectedAnalysis} atrPosition={isReplayActive ? null : atrPosition} colors={colors} isReplay={isReplayActive} asOfDate={analysis.latest.time} />
          {selectedAnalysis === 'institutional' && <InstitutionalAnalysisCard analysis={analysis} selectedStrategy={selectedAnalysis} colors={colors} />}
        </>}
        {selectedAnalysis === 'riskManagement' && <ExitManagementCard exitManagement={exitManagement} atrMultiplier={atrMultiplier} onAtrMultiplierChange={setAtrMultiplier} colors={colors} isReplay={isReplayActive} />}
        {selectedAnalysis === 'entryScaling' && <EntryScalingCard plan={entryScaling} atrMultiplier={atrMultiplier} onAtrMultiplierChange={setAtrMultiplier} colors={colors} isReplay={isReplayActive} />}
        {selectedAnalysis === 'tradePlan' && <TradePlanCard symbol={symbol} marketType={marketType} currency={currency} averageCost={averageCost} positionSize={currentShares} analysis={latestAnalysis} currentPrice={latestDisplayedPrice} isIntraday={Boolean(activeContext?.isIntraday)} colors={colors} />}
        {selectedAnalysis === 'options' && <OptionsAnalysisContent initialMarket={marketType} initialSymbol={symbol} embedded />}
        {selectedLibraryStrategy && <StrategyLibraryCard strategy={selectedLibraryStrategy} result={selectedLibraryResult} colors={colors} isReplay={isReplayActive} asOfDate={analysis.latest.time} squeezePreset={squeezePreset} onSqueezePresetChange={changeSqueezePreset} maSwingSettings={maSwingSettings} onMaSwingChange={maSwingReady ? changeMaSwingSettings : null} />}
        {selectedLibraryStrategy?.key === 'trend-ma-swing' && <MaSwingBacktestCard rows={backtestRows} settings={maSwingSettings} colors={colors} onApply={maSwingReady ? settings => setMaSwingSettings(normalizeMaSwingSettings(settings)) : null} />}
        {selectedAnalysis === 'valuation' && <ValuationHistoryCard
          data={valuationData}
          loading={valuationLoading}
          error={valuationError}
          colors={colors}
          livePrice={liveQuote?.isLive ? latestDisplayedPrice : 0}
          officialClose={latestAnalysis?.latest?.close || latestDisplayedPrice}
          onRefresh={() => loadValuation(true)}
        />}
        {selectedAnalysis === 'dcf' && <DcfValuationCard
          data={dcfData}
          loading={dcfLoading}
          error={dcfError}
          colors={colors}
          currentPrice={latestDisplayedPrice}
          onRefresh={() => loadDcf(true)}
        />}
        {selectedAnalysis === 'financialReports' && <FinancialReportsCard
          data={financialReports}
          calendarEvent={calendarEventForSymbol}
          loading={financialReportsLoading}
          error={financialReportsError}
          colors={colors}
          onRefresh={() => loadFinancialReports(true)}
        />}
        {selectedAnalysis === 'corporateActions' && <CorporateActionsCard
          data={corporateActions}
          loading={corporateActionsLoading}
          error={corporateActionsError}
          colors={colors}
          onRefresh={() => loadCorporateActions(true)}
        />}
        {selectedAnalysis === 'distribution' && <InstitutionalDistributionCard data={institutionalDistribution} loading={distributionLoading} error={distributionError} onRefresh={() => loadDistribution(true)} colors={colors} />}
        {selectedAnalysis === 'margin' && <MarginTradingCard data={marginTrading} priceRows={rawRows} loading={marginTradingLoading} error={marginTradingError} onRefresh={() => loadMarginTrading(true)} colors={colors} />}
      </View>

      {(STRATEGIES.some(item => item.key === selectedAnalysis) || selectedAnalysis === 'riskManagement') && LAYER_OPTIONS.some(([key]) => layers[key]) && <View style={styles.layerInfoList}>
        <Text style={[styles.layerInfoListTitle, { color: colors.textMuted }]}>已開啟圖層說明 · 點選可展開</Text>
        {LAYER_OPTIONS.filter(([key]) => layers[key]).map(([key]) => <LayerExplanationCard key={key} layerKey={key} expanded={focusedLayer === key} onPress={() => setFocusedLayer(key)} analysis={analysis} profile={profile} volumeRatio={currentVolumeRatio} atrPosition={isReplayActive ? null : atrPosition} marketType={marketType} colors={colors} />)}
      </View>}

      <View style={[styles.disclaimer, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}><CircleAlert size={16} color={colors.accent} /><Text style={[styles.disclaimerText, { color: colors.textSub }]}>{analysisDisclaimer}</Text></View>

      <TouchableOpacity style={[styles.aiButton, { backgroundColor: colors.accent }]} onPress={askAI}><Bot size={18} color={colors.accentContrast} /><View style={styles.flex}><Text style={[styles.aiTitle, { color: colors.accentContrast }]}>問 AI 解讀目前分析</Text><Text style={[styles.aiSub, { color: colors.accentContrast }]}>帶入技術訊號與可用估值資料繼續對話</Text></View></TouchableOpacity>
      <View style={{ height: 82 }} />
    </ScrollView>

    {assetSwitcher}

    <AssetSwitcherModal
      visible={comparisonPickerVisible}
      onClose={() => setComparisonPickerVisible(false)}
      assets={comparisonAssets}
      query={switchAssetQuery}
      setQuery={setSwitchAssetQuery}
      market={switchAssetMarket}
      setMarket={setSwitchAssetMarket}
      source={switchAssetSource}
      setSource={setSwitchAssetSource}
      loading={switchAssetsLoading}
      error={switchAssetsError}
      currentKey={switchAssetKey({ symbol, market_type: marketType })}
      onSelect={() => {}}
      onToggle={toggleComparisonAsset}
          selectedKeys={comparisonSymbols.map(value => comparisonTargetKey(value))}
      multiSelect
      manualSymbol={comparisonManualSymbol}
      setManualSymbol={setComparisonManualSymbol}
      onAddManual={addManualComparison}
      manualError={comparisonManualError}
      title="選擇比較標的"
      hint="可跨市場加入持倉、自選或直接輸入的標的"
      onRefresh={loadSwitchAssets}
      colors={colors}
    />

    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`選擇詳細資訊，目前為${selectedAnalysisLabel}`}
      activeOpacity={0.88}
      onPress={() => setDetailSheetVisible(true)}
      style={[styles.floatingStrategyButton, { backgroundColor: colors.accent, borderColor: colors.border }]}
    >
      <SlidersHorizontal size={17} color={colors.accentContrast} />
      <Text numberOfLines={1} style={[styles.floatingStrategyText, { color: colors.accentContrast }]}>詳細・{selectedAnalysisLabel}</Text>
      <ChevronUp size={16} color={colors.accentContrast} />
    </TouchableOpacity>

    <Modal visible={strategySheetVisible} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setStrategySheetVisible(false)}>
      <View style={styles.strategySheetOverlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="關閉策略選單" style={StyleSheet.absoluteFill} onPress={() => setStrategySheetVisible(false)} />
        <View style={[styles.strategySheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.strategySheetHeader}>
            <View style={styles.flex}>
              <Text style={[styles.strategySheetTitle, { color: colors.text }]}>調整目前查看策略</Text>
              <Text style={[styles.strategySheetHint, { color: colors.textMuted }]}>{selectedStrategyKeys.length ? `已選 ${selectedStrategyKeys.length} 項 · 可複選；右下角再選要查看的單一策略` : '可複選要納入統計的策略'}</Text>
            </View>
            <View style={styles.strategySheetHeaderActions}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={allStrategiesSelected ? '取消全選策略' : '全選策略'} onPress={toggleAllStrategies} style={[styles.strategySheetBulkAction, { backgroundColor: allStrategiesSelected ? colors.accentSoft : colors.cardAlt, borderColor: allStrategiesSelected ? colors.accent : colors.border }]}>
                <Text style={[styles.strategySheetBulkActionText, { color: allStrategiesSelected ? colors.accent : colors.textSub }]}>{allStrategiesSelected ? '取消全選' : '全選'}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="關閉" onPress={() => setStrategySheetVisible(false)} style={[styles.strategySheetClose, { backgroundColor: colors.cardAlt }]}>
                <X size={19} color={colors.textSub} />
              </TouchableOpacity>
            </View>
          </View>
          <ScrollView style={styles.strategySheetList} showsVerticalScrollIndicator={false}>
          <Text style={[styles.strategySheetSectionTitle, { color: colors.textMuted }]}>策略分類</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: noChartStrategySelected }}
            onPress={clearAnalysisSelection}
            style={[styles.strategySheetOption, styles.strategySheetNoStrategy, { width: '100%', minHeight: 62, backgroundColor: noChartStrategySelected ? colors.accentSoft : colors.cardAlt, borderColor: noChartStrategySelected ? colors.accent : colors.border }]}
          >
            <View style={styles.strategySheetOptionTop}><Text style={[styles.strategySheetOptionLabel, { color: noChartStrategySelected ? colors.accent : colors.text }]}>不選策略</Text>{noChartStrategySelected && <Check size={15} color={colors.accent} />}</View>
            <View style={styles.strategySheetStatusRow}><View style={[styles.strategySheetStatusDot, { backgroundColor: colors.textMuted }]} /><Text style={[styles.strategySheetStatusText, { color: colors.textMuted }]}>只顯示技術圖，不畫策略標記</Text></View>
          </TouchableOpacity>
          {STRATEGY_SELECTION_CATEGORIES.map(category => {
            const categoryItems = sortStrategyItems([
              ...STRATEGIES.filter(item => item.category === category),
              ...STRATEGY_LIBRARY.filter(item => item.category === category),
            ]);
            if (!categoryItems.length) return null;
            return <React.Fragment key={category}>
              <Text style={[styles.strategySheetSectionTitle, styles.strategySheetSecondaryTitle, { color: colors.textMuted }]}>{category}</Text>
              <View style={styles.strategySheetGrid}>{categoryItems.map(item => renderAnalysisOption(item, { fullWidth: categoryItems.length === 1 }))}</View>
            </React.Fragment>;
          })}
          </ScrollView>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="完成查看策略設定" onPress={() => setStrategySheetVisible(false)} style={[styles.strategySheetDone, { backgroundColor: colors.accent }]}>
            <Text style={[styles.strategySheetDoneText, { color: colors.accentContrast }]}>完成</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

    <Modal visible={detailSheetVisible} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setDetailSheetVisible(false)}>
      <View style={styles.strategySheetOverlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="關閉詳細資訊選單" style={StyleSheet.absoluteFill} onPress={() => setDetailSheetVisible(false)} />
        <View style={[styles.strategySheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.strategySheetHeader}>
            <View style={styles.flex}>
              <Text style={[styles.strategySheetTitle, { color: colors.text }]}>選擇詳細資訊</Text>
              <Text style={[styles.strategySheetHint, { color: colors.textMuted }]}>{detailSelectedOnly ? `顯示已選策略 ${selectedStrategyKeys.length} 項；獨立分析固定顯示` : '顯示全部策略與獨立分析'}</Text>
            </View>
            <View style={styles.strategySheetHeaderActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={detailSelectedOnly ? '顯示全部策略' : '只顯示已選策略，獨立分析不受影響'}
                accessibilityState={{ selected: detailSelectedOnly }}
                onPress={() => setDetailSelectedOnly(current => !current)}
                style={[styles.strategySheetBulkAction, { backgroundColor: detailSelectedOnly ? colors.accentSoft : colors.cardAlt, borderColor: detailSelectedOnly ? colors.accent : colors.border }]}
              >
                <Text style={[styles.strategySheetBulkActionText, { color: detailSelectedOnly ? colors.accent : colors.textSub }]}>{detailSelectedOnly ? '顯示全部策略' : '只看已選策略'}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="關閉" onPress={() => setDetailSheetVisible(false)} style={[styles.strategySheetClose, { backgroundColor: colors.cardAlt }]}>
                <X size={19} color={colors.textSub} />
              </TouchableOpacity>
            </View>
          </View>
          <ScrollView style={styles.strategySheetList} showsVerticalScrollIndicator={false}>
            <Text style={[styles.strategySheetSectionTitle, { color: colors.textMuted }]}>策略詳細資訊</Text>
            <Text style={[styles.strategySheetHint, { color: colors.textMuted }]}>{detailSelectedOnly ? '策略只列出已加入「目前查看策略」的項目；獨立分析不受此篩選影響。' : '灰色代表尚未加入「目前查看策略」，但仍會顯示該策略目前的判斷；點擊即可查看詳細資訊，若要加入統計請到「調整策略」。'}</Text>
            {!detailSelectedOnly && <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ selected: selectedAnalysis === null }}
              onPress={clearDetailSelection}
              style={[styles.strategySheetOption, styles.strategySheetNoStrategy, { width: '100%', minHeight: 62, marginTop: 12, backgroundColor: selectedAnalysis === null ? colors.accentSoft : colors.cardAlt, borderColor: selectedAnalysis === null ? colors.accent : colors.border }]}
            >
              <View style={styles.strategySheetOptionTop}><Text style={[styles.strategySheetOptionLabel, { color: selectedAnalysis === null ? colors.accent : colors.text }]}>不選策略</Text>{selectedAnalysis === null && <Check size={15} color={colors.accent} />}</View>
              <View style={styles.strategySheetStatusRow}><View style={[styles.strategySheetStatusDot, { backgroundColor: colors.textMuted }]} /><Text style={[styles.strategySheetStatusText, { color: colors.textMuted }]}>只顯示技術圖，不顯示詳細資訊</Text></View>
            </TouchableOpacity>}
            {detailSelectedOnly && !visibleDetailStrategyGroups.length && <View style={styles.strategyDetailEmpty}>
              <Text style={[styles.strategyDetailEmptyText, { color: colors.textMuted }]}>目前尚未選擇任何策略；仍可直接使用下方的獨立分析。</Text>
            </View>}
            {visibleDetailStrategyGroups.map(group => <React.Fragment key={group.category}>
              <Text style={[styles.strategySheetSectionTitle, styles.strategySheetSecondaryTitle, { color: colors.textMuted }]}>{group.category}</Text>
              <View style={[styles.strategySheetGrid, { marginTop: 10 }]}>{group.items.map(item => renderDetailOption(item, { available: selectedStrategyKeys.includes(item.key) }))}</View>
            </React.Fragment>)}
            {!!availableSupplementaryAnalyses.length && <>
              <Text style={[styles.strategySheetSectionTitle, styles.strategySheetSecondaryTitle, { color: colors.textMuted }]}>獨立分析</Text>
              <Text style={[styles.strategySheetHint, { color: colors.textMuted }]}>這些分析不會加入圖表策略統計，只切換下方的分析卡。</Text>
              <View style={[styles.strategySheetGrid, { marginTop: 10 }]}>{availableSupplementaryAnalyses.map(renderDetailOption)}</View>
            </>}
          </ScrollView>
        </View>
      </View>
    </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, scroll: { flex: 1 }, content: { padding: 16, gap: 14 }, flex: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }, loadingText: { marginTop: 12, fontSize: 13 }, errorTitle: { fontSize: 18, fontWeight: '800', marginTop: 12 }, errorText: { fontSize: 13, textAlign: 'center', marginTop: 6 }, retry: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 16, minHeight: 42, borderRadius: 13, marginTop: 16 }, retryText: { fontSize: 13, fontWeight: '800' },
  headerAssetSwitcher: { maxWidth: 220, minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 8 }, headerAssetSwitcherText: { fontSize: 16, fontWeight: '800' },
  quoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, quoteIdentity: { flex: 1, minWidth: 0 }, symbol: { fontSize: 25, fontWeight: '900' }, name: { fontSize: 12, lineHeight: 18, marginTop: 3 }, quoteRight: { width: '52%', minWidth: 0, alignItems: 'flex-end' }, close: { fontSize: 22, fontWeight: '800' }, change: { fontSize: 11, fontWeight: '700', marginTop: 3 }, quoteMeta: { fontSize: 9, lineHeight: 13, marginTop: 4, textAlign: 'right' }, quoteRefresh: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 9, minHeight: 25, paddingHorizontal: 7, marginTop: 6 }, quoteRefreshText: { fontSize: 9, fontWeight: '800' },
  periodRow: { flexDirection: 'row', gap: 7 }, chip: { flex: 1, minHeight: 36, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, chipText: { fontSize: 11, fontWeight: '700' }, replayBanner: { borderWidth: 1, borderRadius: 13, padding: 10, gap: 3 }, replayBannerTitle: { fontSize: 11, fontWeight: '900' }, replayBannerText: { fontSize: 9, lineHeight: 14 }, latestDataNotice: { borderWidth: 1, borderRadius: 11, padding: 9 }, latestDataNoticeText: { fontSize: 9, lineHeight: 14 },
  strategyPickerLabel: { fontSize: 10, fontWeight: '700', marginBottom: 7 }, strategyPickerRow: { gap: 7, paddingRight: 4 }, strategyPicker: { minHeight: 34, borderWidth: 1, borderRadius: 17, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }, strategyPickerText: { fontSize: 10, fontWeight: '800' },
  strategySelectionControl: { borderWidth: 1, borderRadius: 16, padding: 13 }, strategySelectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, strategySelectionTitle: { fontSize: 14, fontWeight: '900' }, strategySelectionSummary: { fontSize: 10, marginTop: 4 }, strategySelectionAction: { minHeight: 34, borderWidth: 1, borderRadius: 17, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 }, strategySelectionActionText: { fontSize: 10, fontWeight: '900' }, strategySelectionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }, strategySelectionChip: { maxWidth: '100%', borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5 }, strategySelectionChipText: { maxWidth: 170, fontSize: 9, fontWeight: '800' }, strategySelectionHint: { fontSize: 10, lineHeight: 15, marginTop: 10 }, collapsibleStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7, flexShrink: 1 }, collapseIconButton: { width: 30, height: 34, alignItems: 'center', justifyContent: 'center' },
  floatingStrategyButton: { position: 'absolute', right: 16, bottom: 18, maxWidth: '72%', minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#000000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 8 },
  floatingStrategyText: { flexShrink: 1, fontSize: 12, fontWeight: '900' },
  strategySheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' },
  strategySheet: { maxHeight: '88%', borderWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34 },
  assetKeyboardAvoiding: { width: '100%', justifyContent: 'flex-end' },
  assetSwitcherSheet: { height: '82%', maxHeight: '82%', borderWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30, overflow: 'hidden' },
  manualCompareRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }, manualCompareInput: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, fontSize: 13 }, manualCompareButton: { minHeight: 42, borderRadius: 11, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' }, manualCompareButtonText: { fontSize: 13, fontWeight: '900' },
  assetSwitcherDone: { minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 12 }, assetSwitcherDoneText: { fontSize: 14, fontWeight: '900' },
  assetSwitcherSearch: { minHeight: 44, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexShrink: 0 }, assetSwitcherInput: { flex: 1, minHeight: 42, fontSize: 13 }, assetSwitcherFilterGroup: { flexShrink: 0, marginBottom: 2 }, assetSwitcherFilterLabel: { fontSize: 9, fontWeight: '800', marginBottom: 3 }, assetSwitcherMarketScroll: { height: 38, flexGrow: 0, flexShrink: 0, marginBottom: 2 }, assetSwitcherMarkets: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingBottom: 4 }, assetSwitcherMarketChip: { height: 32, minHeight: 32, alignSelf: 'flex-start', borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }, assetSwitcherMarketText: { fontSize: 10, fontWeight: '800' }, assetSwitcherList: { flex: 1, flexGrow: 1, flexShrink: 1, minHeight: 0 }, assetSwitcherRow: { minHeight: 62, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10 }, assetSwitcherSymbol: { fontSize: 14, fontWeight: '900' }, assetSwitcherName: { fontSize: 10, marginTop: 3 }, assetSwitcherBadges: { flexDirection: 'row', alignItems: 'center', gap: 5 }, assetSwitcherBadge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 }, assetSwitcherBadgeText: { fontSize: 8, fontWeight: '800' }, assetSwitcherState: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20 }, assetSwitcherError: { fontSize: 11, lineHeight: 17, textAlign: 'center' },
  strategySheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 }, strategySheetHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 }, strategySheetBulkAction: { minHeight: 38, paddingHorizontal: 10, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, strategySheetBulkActionText: { fontSize: 11, fontWeight: '900' },
  strategySheetTitle: { fontSize: 20, fontWeight: '900' }, strategySheetHint: { fontSize: 11, marginTop: 4 },
  strategySheetClose: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  strategySheetList: { flexShrink: 1 },
  strategySheetSectionTitle: { fontSize: 10, fontWeight: '900', marginBottom: 8 }, strategySheetSecondaryTitle: { marginTop: 18 },
  strategySheetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  strategySheetNoStrategy: { marginBottom: 16 },
  strategyDetailEmpty: { minHeight: 120, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  strategyDetailEmptyText: { fontSize: 11, lineHeight: 17, textAlign: 'center' },
  strategySheetDone: { minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 12 }, strategySheetDoneText: { fontSize: 13, fontWeight: '900' },
  strategySheetOption: { width: '48.5%', minHeight: 76, borderWidth: 1, borderRadius: 15, paddingHorizontal: 12, paddingVertical: 11, justifyContent: 'space-between' },
  strategySheetOptionFullWidth: { width: '100%' },
  strategySheetOptionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  strategySheetOptionLabel: { flex: 1, fontSize: 12, fontWeight: '900' },
  strategySheetStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9 }, strategySheetStatusDot: { width: 7, height: 7, borderRadius: 4 }, strategySheetStatusText: { fontSize: 10, fontWeight: '800' },
  analysisResult: { gap: 14 },
  chartCard: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' }, chartHeader: { paddingHorizontal: 13, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, chartTitleRow: { flexDirection: 'row', gap: 7, alignItems: 'center' }, chartTitle: { fontSize: 14, fontWeight: '800' }, chartHint: { fontSize: 10, flexShrink: 1 },
  lineGuide: { borderWidth: 1, borderRadius: 14, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 9 }, lineGuideIcon: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, lineGuideIconText: { fontSize: 13, fontWeight: '900' }, lineGuideTitle: { fontSize: 11, fontWeight: '800' }, lineGuideText: { fontSize: 10, lineHeight: 16, marginTop: 3 },
  layerHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 }, layerPickerLabel: { marginBottom: 7 }, layerRow: { flexDirection: 'row', gap: 7, paddingRight: 4 }, layerChip: { borderWidth: 1, minHeight: 34, borderRadius: 17, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 }, layerDot: { width: 6, height: 6, borderRadius: 3 }, layerText: { fontSize: 11, fontWeight: '700' },
  layerInfoList: { gap: 7 }, layerInfoListTitle: { fontSize: 9, fontWeight: '800', marginBottom: 1 }, layerInfoCard: { borderWidth: 1, borderRadius: 14, padding: 11 }, layerInfoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, layerInfoAction: { flexDirection: 'row', alignItems: 'center', gap: 5 }, layerInfoTitle: { fontSize: 12, fontWeight: '800' }, layerInfoValue: { fontSize: 10, fontWeight: '800', marginTop: 4 }, layerInfoText: { fontSize: 10, lineHeight: 16, marginTop: 8 }, layerState: { fontSize: 9, fontWeight: '900' },
  institutionTableCard: { borderWidth: 1, borderRadius: 16, paddingVertical: 12, overflow: 'hidden' }, institutionTableTitleRow: { paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }, institutionTableTitle: { fontSize: 13, fontWeight: '900' }, institutionTableSubtitle: { fontSize: 9, marginTop: 3 }, institutionTableToggle: { minHeight: 30, borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 3 }, institutionTableToggleText: { fontSize: 9, fontWeight: '900' }, institutionTableColumns: { flexDirection: 'row', paddingHorizontal: 12 }, institutionTableFixedColumn: { width: 70, flexShrink: 0 }, institutionTableNumbersScroll: { flex: 1 }, institutionTable: { width: 575 }, institutionTableRow: { height: 38, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth }, institutionTableHead: { borderTopLeftRadius: 9, borderTopRightRadius: 9 }, institutionTableCell: { fontSize: 10, fontWeight: '700', paddingHorizontal: 7 }, institutionTotalCell: { fontWeight: '900' }, institutionDateCell: { width: 70, textAlign: 'left' }, institutionNumberCell: { width: 115, textAlign: 'right' }, institutionTableHeadText: { fontSize: 9, fontWeight: '900' }, institutionTableNote: { fontSize: 9, lineHeight: 14, paddingHorizontal: 12, marginTop: 9 },
  institutionalCard: { borderWidth: 1, borderRadius: 16, padding: 13 }, institutionalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, institutionalTitle: { fontSize: 14, fontWeight: '800' }, institutionalSubtitle: { fontSize: 9, marginTop: 2 }, institutionalBadge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5 }, institutionalBadgeText: { fontSize: 9, fontWeight: '900' }, institutionalPeriods: { flexDirection: 'row', gap: 6, marginTop: 12 }, institutionalPeriod: { flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, paddingHorizontal: 5, paddingVertical: 9, alignItems: 'center' }, institutionalPeriodLabel: { fontSize: 9, marginBottom: 4 }, institutionalPeriodValue: { fontSize: 11, fontWeight: '900' }, institutionalBreakdown: { marginTop: 11, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 7 }, institutionalBreakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, institutionalBreakdownLabel: { fontSize: 10 }, institutionalBreakdownValue: { fontSize: 11, fontWeight: '800' }, institutionalNote: { marginTop: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, padding: 9 }, institutionalNoteText: { fontSize: 9, lineHeight: 15 },
  distributionCard: { borderWidth: 1, borderRadius: 16, padding: 13 }, distributionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, distributionTitle: { fontSize: 15, fontWeight: '900' }, distributionSubtitle: { fontSize: 9, marginTop: 3 }, distributionRefresh: { width: 34, height: 34, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, distributionEmpty: { marginTop: 12, borderRadius: 11, padding: 12 }, distributionEmptyTitle: { fontSize: 12, fontWeight: '800' }, distributionEmptyText: { fontSize: 9, lineHeight: 14, marginTop: 4 }, distributionOverview: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12, marginBottom: 12 }, donutWrap: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' }, donutCenter: { position: 'absolute', alignItems: 'center' }, donutCenterValue: { fontSize: 13, fontWeight: '900' }, donutCenterLabel: { fontSize: 7, marginTop: 2 }, distributionLegend: { flex: 1, gap: 6 }, legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, legendDot: { width: 7, height: 7, borderRadius: 4 }, legendLabel: { flex: 1, fontSize: 10 }, legendRatio: { fontSize: 10, fontWeight: '800' }, distributionTableHead: { minHeight: 30, borderRadius: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }, distributionTableRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth }, distributionNameCell: { width: '36%', flexDirection: 'row', alignItems: 'center', gap: 6 }, distributionNumberCell: { width: '40%', textAlign: 'right' }, distributionRatioCell: { width: '24%', textAlign: 'right' }, distributionHeadText: { fontSize: 8, fontWeight: '800' }, distributionRowText: { fontSize: 10 }, distributionRowValue: { fontSize: 10, fontWeight: '800' }, distributionNote: { fontSize: 8, lineHeight: 13, marginTop: 10 }, distributionSource: { fontSize: 8, fontWeight: '700', marginTop: 7 },
  marginCard: { borderWidth: 1, borderRadius: 16, padding: 13 }, marginTabs: { flexDirection: 'row', gap: 7, marginTop: 12 }, marginTab: { minWidth: 78, minHeight: 34, borderWidth: 1, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, marginTabText: { fontSize: 10, fontWeight: '900' }, marginMetrics: { flexDirection: 'row', gap: 7, marginTop: 12 }, marginMetric: { flex: 1, minWidth: 0 }, marginMetricLabel: { fontSize: 8, marginBottom: 4 }, marginMetricValue: { fontSize: 11, fontWeight: '900' }, marginChart: { height: 205, borderRadius: 12, overflow: 'hidden', marginTop: 12, paddingTop: 5 }, marginLegend: { position: 'absolute', left: 11, right: 11, bottom: 8, flexDirection: 'row', gap: 14 }, marginLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, marginLegendLine: { width: 13, height: 2, borderRadius: 1 }, marginLegendText: { fontSize: 8 }, marginInterpretation: { borderRadius: 11, padding: 10, marginVertical: 11 }, marginInterpretationTitle: { fontSize: 10, fontWeight: '900' }, marginInterpretationText: { fontSize: 9, lineHeight: 14, marginTop: 4 }, marginDateCell: { width: '22%', textAlign: 'left' }, marginTableCell: { width: '26%', textAlign: 'right' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, summaryCard: { width: '48.5%', minHeight: 104, borderWidth: 1, borderRadius: 14, padding: 11 }, summaryLabel: { fontSize: 11, marginBottom: 7 }, levelRow: { marginBottom: 6 }, levelValue: { fontSize: 12, fontWeight: '800' }, levelMeta: { fontSize: 9, marginTop: 2 }, emptyValue: { fontSize: 11, lineHeight: 16 }, summaryMain: { fontSize: 16, fontWeight: '800' }, selectedStrategyCount: { minWidth: 30, height: 30, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }, selectedStrategyCountText: { fontSize: 13, fontWeight: '900' }, selectedStrategyMetric: { width: '48.5%', minHeight: 64, borderWidth: 1, borderRadius: 12, padding: 9 }, selectedStrategyMetricValue: { fontSize: 16, fontWeight: '900' },
  signalCard: { borderWidth: 1, borderRadius: 16, padding: 13 }, signalCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, signalEyebrow: { fontSize: 10, marginBottom: 3 }, signalTitle: { fontSize: 16, fontWeight: '800' }, statusBadge: { minWidth: 48, minHeight: 38, paddingHorizontal: 8, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, statusBadgeText: { fontSize: 14, fontWeight: '900' }, signalTiming: { fontSize: 10, marginTop: 5 }, checkList: { marginTop: 11, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 }, checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, checkIcon: { width: 18, height: 18, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, checkText: { flex: 1, fontSize: 11, lineHeight: 16 }, checkTag: { fontSize: 9, fontWeight: '800' },
  strategyCard: { borderWidth: 1, borderRadius: 16, padding: 13 }, strategyHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }, strategyTitle: { fontSize: 15, fontWeight: '800' }, strategyIntro: { fontSize: 10, marginTop: 3 }, selectedEyebrow: { fontSize: 9, fontWeight: '900', marginBottom: 3 }, rsiValue: { fontSize: 10, fontWeight: '700' }, strategyList: { marginTop: 11, borderTopWidth: StyleSheet.hairlineWidth }, strategyRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth }, strategyNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, strategyName: { fontSize: 12, fontWeight: '800' }, strategyBadge: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 4 }, strategyBadgeText: { fontSize: 8, fontWeight: '900' }, strategyReason: { fontSize: 10, lineHeight: 16, marginTop: 5 }, overviewToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 42 }, guideBlock: { padding: 10, borderRadius: 11, marginTop: 11 }, guideTitle: { fontSize: 10, fontWeight: '900' }, guideText: { fontSize: 10, lineHeight: 16, marginTop: 4 }, metricList: { marginTop: 10, paddingTop: 7, borderTopWidth: StyleSheet.hairlineWidth }, metricRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, metricLabel: { fontSize: 10 }, metricValue: { fontSize: 10, fontWeight: '800', textAlign: 'right', flexShrink: 1 }, strategyLibraryRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3 }, strategyLibraryLabel: { fontSize: 9, fontWeight: '900' }, strategyLibraryValue: { fontSize: 10, lineHeight: 16 }, squeezePresetPanel: { borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 10, gap: 8 }, squeezePresetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, squeezePresetTitle: { fontSize: 10, fontWeight: '900' }, squeezePresetValue: { fontSize: 11, fontWeight: '900' }, squeezePresetButtons: { flexDirection: 'row', gap: 6 }, squeezePresetButton: { flex: 1, minHeight: 32, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, squeezePresetButtonText: { fontSize: 10, fontWeight: '900' }, squeezePresetHint: { fontSize: 9, lineHeight: 14 },
  patternReference: { marginTop: 13, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth }, patternReferenceTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, patternReferenceSectionTitle: { fontSize: 13, fontWeight: '900' }, patternReferenceNote: { fontSize: 9, lineHeight: 14, marginTop: 3 }, patternReferenceGroup: { fontSize: 10, fontWeight: '900', marginTop: 13, marginBottom: 7 }, patternReferenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, patternReferenceCard: { width: '48.5%', borderWidth: 1, borderRadius: 12, padding: 9 }, patternReferenceHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 }, patternReferenceTitle: { fontSize: 11, fontWeight: '900' }, patternReferenceDirection: { fontSize: 8, fontWeight: '800', marginTop: 3 }, patternReferenceSummary: { fontSize: 9, lineHeight: 14, marginTop: 6 }, patternReferenceMeaning: { fontSize: 8, lineHeight: 13, marginTop: 5 },
  hybridList: { marginTop: 11, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, gap: 9 }, hybridRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, hybridTitle: { fontSize: 11, fontWeight: '800' }, hybridText: { fontSize: 9, lineHeight: 14, marginTop: 2 }, hybridRisk: { marginTop: 11, padding: 10, borderRadius: 11 }, hybridRiskTitle: { fontSize: 10, fontWeight: '900' }, hybridRiskText: { fontSize: 9, lineHeight: 14, marginTop: 3 }, hybridWarning: { fontSize: 9, lineHeight: 14, marginTop: 9 },
  atrControl: { marginTop: 11, padding: 10, borderRadius: 11, borderWidth: 1, gap: 5 }, atrControlHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, atrControlTitle: { flex: 1, fontSize: 10, fontWeight: '900' }, atrControlHint: { fontSize: 9, fontWeight: '800' }, atrControlNote: { fontSize: 9, lineHeight: 14 }, atrSliderBlock: { gap: 3 }, atrSliderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, atrSliderLabel: { fontSize: 10, fontWeight: '800' }, atrSliderValue: { fontSize: 12, fontWeight: '900' }, atrSliderTouchArea: { height: 28, justifyContent: 'center' }, atrSliderTrack: { height: 7, borderRadius: 4, position: 'relative', overflow: 'visible' }, atrSliderFill: { height: 7, borderRadius: 4 }, atrSliderThumb: { position: 'absolute', top: -4, width: 15, height: 15, marginLeft: -7, borderRadius: 8, borderWidth: 2 }, atrSliderScale: { flexDirection: 'row', justifyContent: 'space-between' }, atrSliderScaleText: { fontSize: 8 },
  rulesCard: { borderWidth: 1, borderRadius: 16, padding: 13, gap: 9 }, rulesTitle: { fontSize: 15, fontWeight: '800' }, rulesIntro: { fontSize: 11, lineHeight: 17 }, ruleBlock: { borderRadius: 12, padding: 10 }, ruleHeading: { fontSize: 11, fontWeight: '800', marginBottom: 3 }, ruleBody: { fontSize: 10, lineHeight: 16 }, ruleFootnote: { fontSize: 9, lineHeight: 15 },
  disclaimer: { borderWidth: 1, borderRadius: 13, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, disclaimerText: { flex: 1, fontSize: 11, lineHeight: 17 }, aiButton: { minHeight: 58, borderRadius: 16, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 11 }, aiTitle: { fontSize: 14, fontWeight: '800' }, aiSub: { fontSize: 10, opacity: 0.8, marginTop: 2 },
});
