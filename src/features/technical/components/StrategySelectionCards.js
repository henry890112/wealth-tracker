import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react-native';
import TechnicalReplaySlider from '../../../components/TechnicalReplaySlider';

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

export function StrategySelectionControl({ strategies = [], selectedKeys = [], selectedNames = [], colors, onPress, styles }) {
  const [expanded, setExpanded] = useState(true);
  const stats = getSelectedStrategyStats(strategies, selectedKeys);
  const visibleNames = selectedNames.length > 6
    ? [...selectedNames.slice(0, 5), `+${selectedNames.length - 5} 項`]
    : selectedNames;
  return (
    <View style={[styles.strategySelectionControl, styles.compactStrategyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
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

export function SelectedStrategiesSummary({ strategies = [], selectedKeys = [], colors, replayDates = [], replayDate = null, onReplayDateChange, onLatest, isReplayActive = false, styles }) {
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
    <View style={[styles.strategyCard, styles.compactStrategyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
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
      <View style={[styles.summaryGrid, styles.compactSummaryGrid]}>
        {rows.map(([label, value, color]) => (
          <View key={label} style={[styles.selectedStrategyMetric, styles.compactStrategyMetric, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
            <Text numberOfLines={2} style={[styles.summaryLabel, styles.compactMetricLabel, { color: colors.textSub }]}>{label}</Text>
            <Text style={[styles.selectedStrategyMetricValue, styles.compactMetricValue, { color }]}>{value}／{stats.total}</Text>
          </View>
        ))}
      </View>
      <TechnicalReplaySlider dates={replayDates} value={replayDate} colors={colors} onChange={onReplayDateChange} onLatest={onLatest} />
      </>}
    </View>
  );
}
