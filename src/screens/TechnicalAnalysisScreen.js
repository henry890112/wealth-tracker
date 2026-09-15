import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BarChart3, Bot, ChevronDown, ChevronUp, CircleAlert, Layers3, RefreshCw } from 'lucide-react-native';
import TechnicalAnalysisChart from '../components/TechnicalAnalysisChart';
import { analyzeTechnicalData, fetchMarketTechnicalContext, technicalAnalysisPrompt } from '../services/technicalAnalysis';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/ThemeContext';

const PERIODS = [
  { key: '3M', label: '3 個月', rows: 65 },
  { key: '6M', label: '6 個月', rows: 130 },
  { key: '1Y', label: '1 年', rows: 260 },
  { key: '3Y', label: '3 年', rows: 780 },
];

const STRATEGIES = [
  { key: 'ALL', label: '綜合' },
  { key: 'divergence', label: 'MACD 背離' },
  { key: 'pullback', label: '趨勢回檔' },
  { key: 'breakout', label: '放量突破' },
  { key: 'rsi', label: 'RSI 反轉' },
  { key: 'boundary', label: '雙軌邊界' },
  { key: 'smc', label: 'SMC' },
];

const LAYER_OPTIONS = [
  ['ma', 'MA5/10/20/60'], ['levels', '支撐壓力'], ['volume', '爆量'], ['volumeProfile', '量價分佈'],
  ['atr', 'ATR 風控'], ['macd', 'MACD'], ['rsi', 'RSI14'], ['kd', 'KD'],
];

const money = value => Number(value || 0).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

const strategyStatusMeta = (item, colors) => {
  if (item?.status === 'confirmed') return { label: item.direction === 'bearish' ? '偏空已確認' : '偏多已確認', color: item.direction === 'bearish' ? colors.negative : colors.positive };
  if (item?.status === 'watch' || item?.status === 'pending') return { label: item.direction === 'bearish' ? '偏空觀察' : '偏多觀察', color: colors.warning };
  if (['invalidated', 'expired', 'stale'].includes(item?.status)) return { label: SIGNAL_STATUS[item.status] || '已失效', color: colors.textMuted };
  return { label: '未成立', color: colors.textMuted };
};

const STRATEGY_GUIDES = {
  divergence: '比較價格轉折與 MACD 動能；形成背離後，仍需突破／跌破確認線、MACD 動能同向及收盤通過 MA20 才確認。',
  pullback: '先確認 MA20／MA60 趨勢，再等待價格回測 MA20 約 1.5% 範圍並收回；接近均線但尚未轉強／轉弱時只列觀察。',
  breakout: '收盤突破前 20 日高點或跌破低點 0.1%，且成交量至少達 20 日均量 1.5 倍才確認。',
  rsi: '價格位於支撐／壓力附近時，RSI14 從 30 以下站回視為偏多反轉，從 70 以上跌回視為偏空反轉。',
  boundary: '只在上下邊界行動：下邊界等待 Sweep 收回與 KD／MACD 動能，上邊界等待放量突破後回踩；中軸附近不建立訊號。',
  smc: '以 BSL、SSL、EQ 劃分折價／溢價區，等待流動性 Sweep 或 CHoCH 後回踩 FVG／OB，且預估 R:R 至少 1:2.5。',
};

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
  const checks = [
    { key: 'structure', label: `收盤${bullish ? '突破' : '跌破'}確認線 ${money(signal.neckline)}`, required: true },
    { key: 'momentum', label: `MACD ${bullish ? '高於' : '低於'} Signal，柱狀體${bullish ? '為正' : '為負'}`, required: true },
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

function HybridStrategyCard({ hybrid, atrPosition, colors }) {
  if (!hybrid) return null;
  const confirmed = hybrid.status === 'confirmed';
  const statusColor = confirmed ? colors.positive : hybrid.status === 'watch' ? colors.warning : colors.textMuted;
  const gates = [
    ['大趨勢', hybrid.gates?.trend],
    ['放量突破', hybrid.gates?.breakout],
    ['趨勢回檔', hybrid.gates?.pullback],
    ['量能確認', hybrid.gates?.volume],
    ['相對強弱', hybrid.gates?.relativeStrength],
  ];
  return <View style={[styles.strategyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.strategyHeader}><View style={styles.flex}><Text style={[styles.strategyTitle, { color: colors.text }]}>分層混合策略</Text><Text style={[styles.strategyIntro, { color: colors.textSub }]}>趨勢 → 突破或回檔 → 量能 → 相對強弱</Text></View><View style={[styles.strategyBadge, { backgroundColor: `${statusColor}18`, borderColor: statusColor }]}><Text style={[styles.strategyBadgeText, { color: statusColor }]}>{confirmed ? '進場確認' : hybrid.status === 'watch' ? '等待確認' : '不進場'}</Text></View></View>
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
  </View>;
}

function SelectedStrategyCard({ analysis, selectedStrategy, atrPosition, colors }) {
  if (selectedStrategy === 'ALL') return <HybridStrategyCard hybrid={analysis.hybrid} atrPosition={atrPosition} colors={colors} />;
  const item = analysis.strategies.find(strategy => strategy.key === selectedStrategy);
  if (!item) return null;
  const meta = strategyStatusMeta(item, colors);
  const signal = item.signal || item.latestEvent || item.events?.at(-1);
  const levelRows = [];
  if (selectedStrategy === 'divergence' && signal?.neckline) levelRows.push(['確認線', money(signal.neckline)], ['背離區間', `${signal.previousTime || '—'} → ${signal.time || '—'}`]);
  if (selectedStrategy === 'pullback' && item.level) levelRows.push(['MA20 回檔線', money(item.level)]);
  if (selectedStrategy === 'breakout') levelRows.push(['20 日界線', item.level ? money(item.level) : '仍在區間內'], ['相對量', `${Number(item.volumeRatio || 0).toFixed(2)} 倍`]);
  if (selectedStrategy === 'rsi') levelRows.push(['RSI14', Number.isFinite(analysis.latest.rsi) ? analysis.latest.rsi.toFixed(1) : '—']);
  if (selectedStrategy === 'boundary' && item.levels) levelRows.push(['下邊界', money(item.levels.lower)], ['中軸', money(item.levels.midpoint)], ['上邊界', money(item.levels.upper)]);
  if (selectedStrategy === 'smc' && item.levels) levelRows.push(['SSL', money(item.levels.ssl)], ['EQ 50%', money(item.levels.eq)], ['BSL', money(item.levels.bsl)]);
  if (signal?.entryLower && signal?.entryUpper) levelRows.push(['進場區', `${money(signal.entryLower)}–${money(signal.entryUpper)}`]);
  if (signal?.stop) levelRows.push(['失效／停損', money(signal.stop)]);
  if (signal?.target || signal?.target1) levelRows.push(['第一目標', money(signal.target || signal.target1)]);
  if (signal?.rr) levelRows.push(['預估 R:R', `1:${Number(signal.rr).toFixed(1)}`]);
  return <View style={[styles.strategyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <View style={styles.strategyHeader}><View style={styles.flex}><Text style={[styles.selectedEyebrow, { color: colors.accent }]}>目前選擇</Text><Text style={[styles.strategyTitle, { color: colors.text }]}>{item.label}</Text></View><View style={[styles.strategyBadge, { backgroundColor: `${meta.color}18`, borderColor: meta.color }]}><Text style={[styles.strategyBadgeText, { color: meta.color }]}>{meta.label}</Text></View></View>
    <Text style={[styles.strategyReason, { color: colors.textSub }]}>{item.reason}</Text>
    <View style={[styles.guideBlock, { backgroundColor: colors.cardAlt }]}><Text style={[styles.guideTitle, { color: colors.text }]}>怎麼判斷？</Text><Text style={[styles.guideText, { color: colors.textSub }]}>{STRATEGY_GUIDES[selectedStrategy]}</Text></View>
    {levelRows.length > 0 && <View style={[styles.metricList, { borderTopColor: colors.borderLight }]}>{levelRows.map(([label, value]) => <View key={`${label}-${value}`} style={styles.metricRow}><Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text><Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text></View>)}</View>}
    {selectedStrategy === 'divergence' && <SignalChecklist signal={signal} colors={colors} />}
  </View>;
}

function LayerExplanationCard({ layerKey, expanded, onPress, analysis, profile, volumeRatio, atrPosition, colors }) {
  const latest = analysis.latest;
  const data = {
    ma: ['短中期均線', `MA5 ${money(latest.ma5)} · MA10 ${money(latest.ma10)} · MA20 ${money(latest.ma20)} · MA60 ${money(latest.ma60)}`, 'MA5／MA10 反應較快，可觀察短線轉強與回檔；MA20／MA60 用來判斷較穩定的中期趨勢。新增短均線不會直接改變目前策略訊號。'],
    levels: ['支撐壓力', `支撐 ${analysis.supports[0] ? money(analysis.supports[0].price) : '—'} · 壓力 ${analysis.resistances[0] ? money(analysis.resistances[0].price) : '—'}`, '由歷史轉折與重複測試找出可能有買賣反應的價格區。'],
    volume: ['成交量', `目前相對量 ${volumeRatio.toFixed(2)} 倍`, '比較最新成交量與前 20 日均量，用來確認突破或反轉是否有資金參與。'],
    volumeProfile: ['量價分佈', profile ? `POC ${money(profile.poc)} · VAH ${money(profile.vah)} · VAL ${money(profile.val)}` : '資料不足', 'POC 是期間內推估成交量最大的價格；VAH／VAL 是約 70% 成交量區間。縮放圖表後，圖內分佈會依可見範圍更新。'],
    atr: ['ATR 風控', atrPosition ? `有效停損 ${money(atrPosition.effective_stop)} · 進場 ATR ${money(atrPosition.entry_atr)}` : `ATR14 ${money(analysis.hybrid?.risk?.atr14)} · 預估 2ATR ${money(analysis.hybrid?.risk?.initialStop)}`, atrPosition ? '目前顯示正式混合策略部位的初始、移動與有效停損。' : '尚未進場，灰線只是以最新收盤減去 2 倍 ATR 的風險試算。'],
    macd: ['MACD', `DIF ${money(latest.macd)} · Signal ${money(latest.macdSignal)} · 柱狀體 ${money(latest.macdHistogram)}`, 'DIF 與 Signal 判斷動能方向；柱狀體擴大或縮小可觀察動能變化。'],
    rsi: ['RSI14', `目前 ${Number.isFinite(latest.rsi) ? latest.rsi.toFixed(1) : '—'}`, '70 以上偏高檔、30 以下偏低檔；必須等待穿回門檻並配合支撐壓力，不能只因超買超賣就進場。'],
    kd: ['KD（9,3,3）', `K ${Number.isFinite(latest.k) ? latest.k.toFixed(1) : '—'} · D ${Number.isFinite(latest.d) ? latest.d.toFixed(1) : '—'}`, 'K 上穿 D 為黃金交叉、下穿為死亡交叉；80 以上偏高、20 以下偏低，目前只作輔助。'],
  }[layerKey];
  if (!data) return null;
  return <TouchableOpacity onPress={onPress} style={[styles.layerInfoCard, { backgroundColor: colors.cardAlt, borderColor: expanded ? colors.accent : colors.border }]}>
    <View style={styles.layerInfoHeader}><View style={styles.flex}><Text style={[styles.layerInfoTitle, { color: colors.text }]}>{data[0]}</Text><Text style={[styles.layerInfoValue, { color: colors.accent }]}>{data[1]}</Text></View><View style={styles.layerInfoAction}><Text style={[styles.layerState, { color: colors.positive }]}>已開啟</Text>{expanded ? <ChevronUp size={15} color={colors.accent} /> : <ChevronDown size={15} color={colors.textMuted} />}</View></View>
    {expanded && <Text style={[styles.layerInfoText, { color: colors.textSub }]}>{data[2]}</Text>}
  </TouchableOpacity>;
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

function ConfirmationLineGuide({ signal, colors }) {
  if (!signal) {
    return <View style={[styles.lineGuide, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><View style={[styles.lineGuideIcon, { backgroundColor: colors.accentSoft }]}><Text style={[styles.lineGuideIconText, { color: colors.accent }]}>?</Text></View><View style={styles.flex}><Text style={[styles.lineGuideTitle, { color: colors.text }]}>目前沒有有效確認線</Text><Text style={[styles.lineGuideText, { color: colors.textSub }]}>必須先形成一組仍有效的 MACD 多／空背離候選。圖上的灰色失效標記只保留歷史紀錄，不會再畫成目前確認線。</Text></View></View>;
  }
  const bullish = signal.type === 'bullish';
  const status = signal.status === 'confirmed' ? '已確認' : '等待確認';
  return <View style={[styles.lineGuide, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><View style={[styles.lineGuideIcon, { backgroundColor: colors.accentSoft }]}><Text style={[styles.lineGuideIconText, { color: colors.accent }]}>?</Text></View><View style={styles.flex}><Text style={[styles.lineGuideTitle, { color: colors.text }]}>{bullish ? '多方' : '空方'}確認線 {money(signal.neckline)} · {status}</Text><Text style={[styles.lineGuideText, { color: colors.textSub }]}>{bullish ? '取兩個背離低點之間的最高價；收盤向上突破後，才確認多方結構。' : '取兩個背離高點之間的最低價；收盤向下跌破後，才確認空方結構。'}</Text></View></View>;
}

export default function TechnicalAnalysisScreen({ navigation, route }) {
  const { colors } = useTheme();
  const { symbol, name, averageCost = 0, marketType = 'TW', strategyKey = 'divergence' } = route.params || {};
  const [rawRows, setRawRows] = useState([]);
  const [marketContext, setMarketContext] = useState({ marketType, institutional: [] });
  const [period, setPeriod] = useState('1Y');
  const [selectedStrategy, setSelectedStrategy] = useState(STRATEGIES.some(item => item.key === strategyKey) ? strategyKey : 'divergence');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [atrPosition, setAtrPosition] = useState(null);
  const [focusedLayer, setFocusedLayer] = useState('atr');
  const [otherStrategiesExpanded, setOtherStrategiesExpanded] = useState(false);
  const [layers, setLayers] = useState({ ma: true, levels: true, volume: true, volumeProfile: true, macd: true, rsi: true, kd: true, atr: true });

  const load = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const context = await fetchMarketTechnicalContext(symbol, marketType, 1095, forceRefresh);
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
      setError(e.message || '無法載入技術資料');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [symbol, marketType]);
  useEffect(() => {
    if (STRATEGIES.some(item => item.key === strategyKey)) selectStrategy(strategyKey);
  }, [strategyKey]);

  const visibleRows = useMemo(() => {
    const count = PERIODS.find(item => item.key === period)?.rows || 260;
    return rawRows.slice(-count);
  }, [rawRows, period]);
  const analysis = useMemo(() => visibleRows.length >= 60 ? analyzeTechnicalData(rawRows, visibleRows.length, marketContext) : null, [rawRows, visibleRows.length, marketContext]);

  const askAI = () => {
    if (!analysis) return;
    const displayName = marketContext.name || name || symbol;
    navigation.navigate('AI', {
      aiRequestId: `${Date.now()}-${symbol}`,
      initialPrompt: technicalAnalysisPrompt(displayName, symbol, analysis, selectedStrategy),
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
    setSelectedStrategy(key);
    setOtherStrategiesExpanded(false);
    setLayers(current => ({
      ...current,
      ma: key === 'ALL' || key === 'divergence' || key === 'pullback' || key === 'boundary',
      volume: key === 'ALL' || key === 'breakout' || key === 'boundary' || key === 'smc',
      macd: key === 'ALL' || key === 'divergence' || key === 'boundary',
      rsi: key === 'ALL' || key === 'rsi',
      kd: key === 'ALL' || key === 'boundary',
      levels: key === 'ALL' || key === 'divergence' || key === 'rsi',
      volumeProfile: current.volumeProfile,
      atr: current.atr,
    }));
  };
  const latestSpike = analysis?.volumeSpikes.at(-1);
  const activeDivergence = analysis?.divergences.filter(item => item.status === 'confirmed' || item.status === 'pending').at(-1);
  const latestDivergence = activeDivergence || analysis?.divergences.at(-1);

  if (loading) return <View style={[styles.center, { backgroundColor: colors.bg }]}><ActivityIndicator size="large" color={colors.accent} /><Text style={[styles.loadingText, { color: colors.textSub }]}>正在計算 K 線與技術指標…</Text></View>;
  if (error || !analysis) return <View style={[styles.center, { backgroundColor: colors.bg }]}><CircleAlert size={30} color={colors.warning} /><Text style={[styles.errorTitle, { color: colors.text }]}>無法產生技術圖</Text><Text style={[styles.errorText, { color: colors.textSub }]}>{error || '歷史資料不足'}</Text><TouchableOpacity style={[styles.retry, { backgroundColor: colors.accent }]} onPress={() => load(true)}><RefreshCw size={16} color={colors.accentContrast} /><Text style={[styles.retryText, { color: colors.accentContrast }]}>重新載入</Text></TouchableOpacity></View>;

  const liveQuote = marketContext.quote?.price > 0 ? marketContext.quote : null;
  const displayName = marketContext.name || name || symbol;
  const displayedPrice = liveQuote?.price || analysis.latest.close;
  const intradayCandleDate = String(liveQuote?.candleDate || liveQuote?.time || '').slice(0, 10);
  const previousRow = visibleRows.at(-2);
  const quoteMatchesLatestRow = Boolean(liveQuote && intradayCandleDate && intradayCandleDate === analysis.latest.time);
  const hasProvisionalCandle = Boolean(liveQuote?.isLive && intradayCandleDate && intradayCandleDate >= analysis.latest.time);
  const latestCompletedDate = hasProvisionalCandle && quoteMatchesLatestRow
    ? (previousRow?.time || analysis.latest.time)
    : analysis.latest.time;
  // Yahoo may already place the current session inside the last daily candle.
  // When that happens, compare the quote with the preceding trading day's close,
  // rather than subtracting the current price from the same provisional candle.
  const comparisonClose = liveQuote
    ? (quoteMatchesLatestRow ? previousRow?.close : analysis.latest.close)
    : previousRow?.close;
  const change = displayedPrice - comparisonClose;
  const changePct = comparisonClose ? change / comparisonClose * 100 : 0;
  const changeColor = change >= 0 ? colors.positive : colors.negative;
  const priorVolumeRows = visibleRows.slice(-21, -1);
  const averageVolume20 = priorVolumeRows.length ? priorVolumeRows.reduce((sum, row) => sum + Number(row.volume || 0), 0) / priorVolumeRows.length : 0;
  const currentVolumeRatio = averageVolume20 > 0 ? Number(analysis.latest.volume || 0) / averageVolume20 : 0;
  const profile = volumeProfileSummary(visibleRows);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <View style={styles.quoteRow}>
        <View style={styles.flex}><Text style={[styles.symbol, { color: colors.text }]}>{symbol}</Text><Text style={[styles.name, { color: colors.textSub }]}>{displayName} · 日 K 完成至 {latestCompletedDate}{hasProvisionalCandle ? ` · ${intradayCandleDate} 盤中暫估` : ''}</Text></View>
        <View style={styles.quoteRight}><Text style={[styles.close, { color: colors.text }]}>{money(displayedPrice)}</Text><Text style={[styles.change, { color: changeColor }]}>{change >= 0 ? '+' : ''}{money(change)}（{changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%）</Text>{liveQuote && <Text style={[styles.quoteMeta, { color: colors.textMuted }]}>{liveQuote.isLive ? '盤中報價' : '最近報價'} · {quoteTime(liveQuote.time, marketType)}</Text>}<TouchableOpacity onPress={() => load(true)} style={[styles.quoteRefresh, { borderColor: colors.border, backgroundColor: colors.cardAlt }]}><RefreshCw size={11} color={colors.textSub} /><Text style={[styles.quoteRefreshText, { color: colors.textSub }]}>更新</Text></TouchableOpacity></View>
      </View>

      <View style={styles.periodRow}>{PERIODS.map(item => <TouchableOpacity key={item.key} style={[styles.chip, { borderColor: period === item.key ? colors.accent : colors.border, backgroundColor: period === item.key ? colors.accentSoft : colors.card }]} onPress={() => setPeriod(item.key)}><Text style={[styles.chipText, { color: period === item.key ? colors.accent : colors.textSub }]}>{item.label}</Text></TouchableOpacity>)}</View>

      <View><Text style={[styles.strategyPickerLabel, { color: colors.textMuted }]}>圖表策略標記</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strategyPickerRow}>{STRATEGIES.map(item => {
        const selected = selectedStrategy === item.key;
        return <TouchableOpacity key={item.key} style={[styles.strategyPicker, { backgroundColor: selected ? colors.accentSoft : colors.card, borderColor: selected ? colors.accent : colors.border }]} onPress={() => selectStrategy(item.key)}><Text style={[styles.strategyPickerText, { color: selected ? colors.accent : colors.textSub }]}>{item.label}</Text></TouchableOpacity>;
      })}</ScrollView></View>

      <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
        <View style={styles.chartHeader}><View style={styles.chartTitleRow}><BarChart3 size={17} color={colors.accent} /><Text style={[styles.chartTitle, { color: colors.text }]}>技術 K 線</Text></View><Text style={[styles.chartHint, { color: colors.textMuted }]}>{STRATEGIES.find(item => item.key === selectedStrategy)?.label}標記</Text></View>
        <TechnicalAnalysisChart analysis={analysis} colors={colors} averageCost={Number(averageCost)} layers={layers} selectedStrategy={selectedStrategy} liveQuote={liveQuote} atrPosition={atrPosition} />
      </View>

      <SelectedStrategyCard analysis={analysis} selectedStrategy={selectedStrategy} atrPosition={atrPosition} colors={colors} />

      <View style={styles.layerHeader}><Layers3 size={16} color={colors.textSub} /><Text style={[styles.layerTitle, { color: colors.textSub }]}>圖層</Text></View>
      <View style={styles.layerRow}>{LAYER_OPTIONS.map(([key, label]) => <TouchableOpacity key={key} style={[styles.layerChip, { backgroundColor: layers[key] ? colors.accentSoft : colors.card, borderColor: layers[key] ? colors.accent : colors.border }]} onPress={() => toggleLayer(key)}><View style={[styles.layerDot, { backgroundColor: layers[key] ? colors.accent : colors.textMuted }]} /><Text style={[styles.layerText, { color: layers[key] ? colors.accent : colors.textSub }]}>{label}</Text></TouchableOpacity>)}</View>

      {LAYER_OPTIONS.some(([key]) => layers[key]) && <View style={styles.layerInfoList}>
        <Text style={[styles.layerInfoListTitle, { color: colors.textMuted }]}>已開啟圖層說明 · 點選可展開</Text>
        {LAYER_OPTIONS.filter(([key]) => layers[key]).map(([key]) => <LayerExplanationCard key={key} layerKey={key} expanded={focusedLayer === key} onPress={() => setFocusedLayer(key)} analysis={analysis} profile={profile} volumeRatio={currentVolumeRatio} atrPosition={atrPosition} colors={colors} />)}
      </View>}

      <InstitutionalAnalysisCard analysis={analysis} selectedStrategy={selectedStrategy} colors={colors} />
      <StrategyOverview strategies={analysis.strategies} selectedStrategy={selectedStrategy} expanded={otherStrategiesExpanded} onToggle={() => setOtherStrategiesExpanded(value => !value)} colors={colors} />

      <View style={[styles.disclaimer, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}><CircleAlert size={16} color={colors.accent} /><Text style={[styles.disclaimerText, { color: colors.textSub }]}>支撐、壓力、背離與策略結果為程式化研究訊號，可能失效或延後確認，不等於買賣建議。</Text></View>

      <TouchableOpacity style={[styles.aiButton, { backgroundColor: colors.accent }]} onPress={askAI}><Bot size={18} color={colors.accentContrast} /><View style={styles.flex}><Text style={[styles.aiTitle, { color: colors.accentContrast }]}>問 AI 解讀這張圖</Text><Text style={[styles.aiSub, { color: colors.accentContrast }]}>帶入價位、量價、MACD、RSI 與 KD 結果繼續對話</Text></View></TouchableOpacity>
      <View style={{ height: 36 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 }, flex: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }, loadingText: { marginTop: 12, fontSize: 13 }, errorTitle: { fontSize: 18, fontWeight: '800', marginTop: 12 }, errorText: { fontSize: 13, textAlign: 'center', marginTop: 6 }, retry: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 16, minHeight: 42, borderRadius: 13, marginTop: 16 }, retryText: { fontSize: 13, fontWeight: '800' },
  quoteRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 }, symbol: { fontSize: 25, fontWeight: '900' }, name: { fontSize: 12, marginTop: 3 }, quoteRight: { alignItems: 'flex-end' }, close: { fontSize: 22, fontWeight: '800' }, change: { fontSize: 11, fontWeight: '700', marginTop: 3 }, quoteMeta: { fontSize: 9, marginTop: 4 }, quoteRefresh: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 9, minHeight: 25, paddingHorizontal: 7, marginTop: 6 }, quoteRefreshText: { fontSize: 9, fontWeight: '800' },
  periodRow: { flexDirection: 'row', gap: 7 }, chip: { flex: 1, minHeight: 36, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, chipText: { fontSize: 11, fontWeight: '700' },
  strategyPickerLabel: { fontSize: 10, fontWeight: '700', marginBottom: 7 }, strategyPickerRow: { gap: 7, paddingRight: 4 }, strategyPicker: { minHeight: 34, borderWidth: 1, borderRadius: 17, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }, strategyPickerText: { fontSize: 10, fontWeight: '800' },
  chartCard: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' }, chartHeader: { paddingHorizontal: 13, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, chartTitleRow: { flexDirection: 'row', gap: 7, alignItems: 'center' }, chartTitle: { fontSize: 14, fontWeight: '800' }, chartHint: { fontSize: 10 },
  lineGuide: { borderWidth: 1, borderRadius: 14, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 9 }, lineGuideIcon: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, lineGuideIconText: { fontSize: 13, fontWeight: '900' }, lineGuideTitle: { fontSize: 11, fontWeight: '800' }, lineGuideText: { fontSize: 10, lineHeight: 16, marginTop: 3 },
  layerHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 }, layerTitle: { fontSize: 12, fontWeight: '700' }, layerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, layerChip: { borderWidth: 1, minHeight: 34, borderRadius: 17, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 }, layerDot: { width: 6, height: 6, borderRadius: 3 }, layerText: { fontSize: 11, fontWeight: '700' },
  layerInfoList: { gap: 7 }, layerInfoListTitle: { fontSize: 9, fontWeight: '800', marginBottom: 1 }, layerInfoCard: { borderWidth: 1, borderRadius: 14, padding: 11 }, layerInfoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, layerInfoAction: { flexDirection: 'row', alignItems: 'center', gap: 5 }, layerInfoTitle: { fontSize: 12, fontWeight: '800' }, layerInfoValue: { fontSize: 10, fontWeight: '800', marginTop: 4 }, layerInfoText: { fontSize: 10, lineHeight: 16, marginTop: 8 }, layerState: { fontSize: 9, fontWeight: '900' },
  institutionalCard: { borderWidth: 1, borderRadius: 16, padding: 13 }, institutionalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, institutionalTitle: { fontSize: 14, fontWeight: '800' }, institutionalSubtitle: { fontSize: 9, marginTop: 2 }, institutionalBadge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5 }, institutionalBadgeText: { fontSize: 9, fontWeight: '900' }, institutionalPeriods: { flexDirection: 'row', gap: 6, marginTop: 12 }, institutionalPeriod: { flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, paddingHorizontal: 5, paddingVertical: 9, alignItems: 'center' }, institutionalPeriodLabel: { fontSize: 9, marginBottom: 4 }, institutionalPeriodValue: { fontSize: 11, fontWeight: '900' }, institutionalBreakdown: { marginTop: 11, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 7 }, institutionalBreakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, institutionalBreakdownLabel: { fontSize: 10 }, institutionalBreakdownValue: { fontSize: 11, fontWeight: '800' }, institutionalNote: { marginTop: 11, borderRadius: 11, padding: 9 }, institutionalNoteText: { fontSize: 9, lineHeight: 15 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, summaryCard: { width: '48.5%', minHeight: 104, borderWidth: 1, borderRadius: 14, padding: 11 }, summaryLabel: { fontSize: 11, marginBottom: 7 }, levelRow: { marginBottom: 6 }, levelValue: { fontSize: 12, fontWeight: '800' }, levelMeta: { fontSize: 9, marginTop: 2 }, emptyValue: { fontSize: 11, lineHeight: 16 }, summaryMain: { fontSize: 16, fontWeight: '800' },
  signalCard: { borderWidth: 1, borderRadius: 16, padding: 13 }, signalCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, signalEyebrow: { fontSize: 10, marginBottom: 3 }, signalTitle: { fontSize: 16, fontWeight: '800' }, statusBadge: { minWidth: 48, minHeight: 38, paddingHorizontal: 8, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, statusBadgeText: { fontSize: 14, fontWeight: '900' }, signalTiming: { fontSize: 10, marginTop: 5 }, checkList: { marginTop: 11, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 }, checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, checkIcon: { width: 18, height: 18, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, checkText: { flex: 1, fontSize: 11, lineHeight: 16 }, checkTag: { fontSize: 9, fontWeight: '800' },
  strategyCard: { borderWidth: 1, borderRadius: 16, padding: 13 }, strategyHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }, strategyTitle: { fontSize: 15, fontWeight: '800' }, strategyIntro: { fontSize: 10, marginTop: 3 }, selectedEyebrow: { fontSize: 9, fontWeight: '900', marginBottom: 3 }, rsiValue: { fontSize: 10, fontWeight: '700' }, strategyList: { marginTop: 11, borderTopWidth: StyleSheet.hairlineWidth }, strategyRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth }, strategyNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, strategyName: { fontSize: 12, fontWeight: '800' }, strategyBadge: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 4 }, strategyBadgeText: { fontSize: 8, fontWeight: '900' }, strategyReason: { fontSize: 10, lineHeight: 16, marginTop: 5 }, overviewToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 42 }, guideBlock: { padding: 10, borderRadius: 11, marginTop: 11 }, guideTitle: { fontSize: 10, fontWeight: '900' }, guideText: { fontSize: 10, lineHeight: 16, marginTop: 4 }, metricList: { marginTop: 10, paddingTop: 7, borderTopWidth: StyleSheet.hairlineWidth }, metricRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, metricLabel: { fontSize: 10 }, metricValue: { fontSize: 10, fontWeight: '800', textAlign: 'right', flexShrink: 1 },
  hybridList: { marginTop: 11, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, gap: 9 }, hybridRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, hybridTitle: { fontSize: 11, fontWeight: '800' }, hybridText: { fontSize: 9, lineHeight: 14, marginTop: 2 }, hybridRisk: { marginTop: 11, padding: 10, borderRadius: 11 }, hybridRiskTitle: { fontSize: 10, fontWeight: '900' }, hybridRiskText: { fontSize: 9, lineHeight: 14, marginTop: 3 }, hybridWarning: { fontSize: 9, lineHeight: 14, marginTop: 9 },
  rulesCard: { borderWidth: 1, borderRadius: 16, padding: 13, gap: 9 }, rulesTitle: { fontSize: 15, fontWeight: '800' }, rulesIntro: { fontSize: 11, lineHeight: 17 }, ruleBlock: { borderRadius: 12, padding: 10 }, ruleHeading: { fontSize: 11, fontWeight: '800', marginBottom: 3 }, ruleBody: { fontSize: 10, lineHeight: 16 }, ruleFootnote: { fontSize: 9, lineHeight: 15 },
  disclaimer: { borderWidth: 1, borderRadius: 13, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, disclaimerText: { flex: 1, fontSize: 11, lineHeight: 17 }, aiButton: { minHeight: 58, borderRadius: 16, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 11 }, aiTitle: { fontSize: 14, fontWeight: '800' }, aiSub: { fontSize: 10, opacity: 0.8, marginTop: 2 },
});
