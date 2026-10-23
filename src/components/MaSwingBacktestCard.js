import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Check, ChevronDown, ChevronUp, Info, Sparkles } from 'lucide-react-native';
import {
  BACKTEST_MONTHS,
  BACKTEST_COMBINATION_COUNT,
  BACKTEST_WARMUP_BARS,
  areMaBacktestRowsEqual,
  prepareMaBacktest,
  backtestMaSwing,
  searchMaSwing,
} from '../services/maSwingBacktest.js';

const label = (months) => months === 12 ? '一年' : months === 36 ? '三年' : `${months} 個月`;
const shortLabel = (months) => months === 12 ? '1年' : months === 36 ? '3年' : `${months}月`;
const ma = (period) => period == null ? '無' : `MA${period}`;
const percent = (value) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

function MetricGrid({ values, colors }) {
  const positive = colors.positive || '#2dd4bf';
  const negative = colors.negative || '#fb7185';

  return (
    <View style={[styles.metricGrid, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
      {BACKTEST_MONTHS.map((months, index) => {
        const result = values[index];
        const noEntry = result && result.entries === 0;
        const returnColor = !result
          ? colors.textMuted
          : noEntry ? colors.textMuted : result.returnPct >= 0 ? positive : negative;

        return (
          <View
            key={months}
            style={[
              styles.metricCell,
              index > 0 && { borderLeftColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth },
            ]}
          >
            <Text style={[styles.metricPeriod, { color: colors.textSub }]}>{label(months)}</Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.65}
              maxFontSizeMultiplier={1.15}
              style={[styles.metricReturn, { color: returnColor }]}
            >
              {result ? noEntry ? '無進場' : percent(result.returnPct) : '—'}
            </Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              maxFontSizeMultiplier={1.1}
              style={[styles.metricMeta, { color: colors.textMuted }]}
            >
              {result ? noEntry ? '報酬 0.00%' : `回 ${result.drawdownPct.toFixed(1)} · ${result.entries}次` : '資料不足'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function SettingChip({ title, value, colors }) {
  return (
    <View style={[styles.settingChip, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
      <Text style={[styles.settingChipTitle, { color: colors.textMuted }]}>{title}</Text>
      <Text style={[styles.settingChipValue, { color: colors.text }]}>{ma(value)}</Text>
    </View>
  );
}

export default function MaSwingBacktestCard({ rows, settings, onApply, colors }) {
  const stableRowsRef = useRef(rows);
  const stableRows = useMemo(() => {
    if (!areMaBacktestRowsEqual(stableRowsRef.current, rows)) stableRowsRef.current = rows;
    return stableRowsRef.current;
  }, [rows]);
  const data = useMemo(() => prepareMaBacktest(stableRows), [stableRows]);
  const results = useMemo(
    () => BACKTEST_MONTHS.map((months) => backtestMaSwing(data, settings, months)),
    [data, settings],
  );
  const [months, setMonths] = useState(12);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [best, setBest] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [showMethod, setShowMethod] = useState(false);
  const run = useRef(0);
  const accentText = colors.onAccent || colors.background || '#07111f';
  const positive = colors.positive || '#2dd4bf';
  const negative = colors.negative || '#fb7185';
  const bestResults = useMemo(
    () => best ? BACKTEST_MONTHS.map((item) => backtestMaSwing(data, best.settings, item)) : [],
    [best, data],
  );
  const canOptimize = useMemo(
    () => Boolean(backtestMaSwing(data, settings, months)),
    [data, settings, months],
  );

  useEffect(() => {
    run.current += 1;
    setBusy(false);
    setBest(null);
    setError('');
    return () => { run.current += 1; };
  }, [data, months]);

  const calculate = async () => {
    const id = ++run.current;
    setBusy(true);
    setProgress(0);
    setBest(null);
    setError('');
    try {
      const winner = await searchMaSwing(
        data,
        months,
        (value) => { if (run.current === id) setProgress(value); },
        () => run.current !== id,
      );
      if (run.current === id) {
        setBest(winner);
        if (!winner) setError('此期間沒有可成交的進場訊號。');
      }
    } catch (nextError) {
      if (run.current === id) setError(nextError.message);
    } finally {
      if (run.current === id) setBusy(false);
    }
  };

  const cancel = () => {
    run.current += 1;
    setBusy(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.header}
      >
        <View style={styles.headerCopy}>
          <View style={[styles.eyebrow, { backgroundColor: colors.accentSoft }]}>
            <Text style={[styles.eyebrowText, { color: colors.accent }]}>策略回測</Text>
          </View>
          <Text style={[styles.title, { color: colors.text }]}>目前設定績效</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>截至 {stableRows.at(-1)?.time || '—'} · 盤中報價不重算</Text>
        </View>
        {expanded
          ? <ChevronUp size={18} color={colors.textMuted} />
          : <ChevronDown size={18} color={colors.textMuted} />}
      </TouchableOpacity>

      {expanded && <>
      <MetricGrid values={results} colors={colors} />

      <View style={[styles.optimizer, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
        <View style={styles.optimizerHeader}>
          <View style={[styles.optimizerIcon, { backgroundColor: colors.accentSoft }]}>
            <Sparkles size={17} color={colors.accent} />
          </View>
          <View style={styles.optimizerCopy}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>尋找最佳設定</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>比較 {BACKTEST_COMBINATION_COUNT.toLocaleString()} 組，以期間報酬率排名</Text>
          </View>
        </View>

        <View style={[styles.segmented, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {BACKTEST_MONTHS.map((item) => {
            const selected = months === item;
            return (
              <TouchableOpacity
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setMonths(item)}
                style={[
                  styles.segment,
                  selected && { backgroundColor: colors.accentSoft },
                ]}
              >
                <Text style={[
                  styles.segmentText,
                  { color: selected ? colors.accent : colors.textSub },
                  selected && styles.segmentTextSelected,
                ]}>
                  {shortLabel(item)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {busy ? (
          <View style={styles.progressArea}>
            <View style={styles.progressHeader}>
              <View style={styles.progressLabel}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={[styles.progressText, { color: colors.text }]}>正在比較設定</Text>
              </View>
              <Text style={[styles.progressPercent, { color: colors.accent }]}>{Math.round(progress * 100)}%</Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: colors.card }]}>
              <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: colors.accent }]} />
            </View>
            <TouchableOpacity accessibilityRole="button" onPress={cancel} style={styles.cancelButton}>
              <Text style={[styles.cancelText, { color: colors.textSub }]}>取消計算</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: !canOptimize }}
            disabled={!canOptimize}
            onPress={calculate}
            style={[
              styles.primaryButton,
              { backgroundColor: colors.accent },
              !canOptimize && styles.disabled,
            ]}
          >
            <Sparkles size={18} color={accentText} />
            <Text style={[styles.primaryButtonText, { color: accentText }]}>計算 {label(months)}最佳設定</Text>
          </TouchableOpacity>
        )}

        {!!error && (
          <Text style={[styles.error, { color: negative, backgroundColor: `${negative}18` }]}>{error}</Text>
        )}
      </View>

      {best && (
        <View style={[styles.bestCard, { backgroundColor: colors.cardAlt, borderColor: colors.accent }]}>
          <View style={styles.bestHeader}>
            <View>
              <Text style={[styles.bestEyebrow, { color: colors.accent }]}>{label(months)}最佳結果</Text>
              <Text style={[styles.bestReturn, { color: best.result.returnPct >= 0 ? positive : negative }]}>
                {percent(best.result.returnPct)}
              </Text>
            </View>
            <View style={[styles.bestBadge, { backgroundColor: colors.accentSoft }]}>
              <Check size={15} color={colors.accent} />
              <Text style={[styles.bestBadgeText, { color: colors.accent }]}>已完成</Text>
            </View>
          </View>
          <Text style={[styles.bestMeta, { color: colors.textSub }]}>最大回撤 {best.result.drawdownPct.toFixed(2)}% · 進場 {best.result.entries} 次</Text>

          <View style={styles.settingGrid}>
            <SettingChip title="進場" value={best.settings.entry} colors={colors} />
            <SettingChip title="第一段出場 · 50%" value={best.settings.shortExit} colors={colors} />
            <SettingChip title="全部出場" value={best.settings.longExit} colors={colors} />
            <SettingChip title="收盤站上" value={best.settings.abovePeriod} colors={colors} />
            <SettingChip title="近五日上揚" value={best.settings.risingPeriod} colors={colors} />
          </View>

          <Text style={[styles.otherPeriodsTitle, { color: colors.textSub }]}>其他期間表現</Text>
          <MetricGrid values={bestResults} colors={colors} />

          <TouchableOpacity
            accessibilityRole="button"
            disabled={!onApply}
            onPress={() => onApply(best.settings)}
            style={[styles.applyButton, { borderColor: colors.accent }, !onApply && styles.disabled]}
          >
            <Check size={18} color={colors.accent} />
            <Text style={[styles.applyButtonText, { color: colors.accent }]}>套用設定並更新圖表</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: showMethod }}
        onPress={() => setShowMethod((value) => !value)}
        style={styles.methodToggle}
      >
        <View style={styles.methodTitle}>
          <Info size={15} color={colors.textMuted} />
          <Text style={[styles.methodToggleText, { color: colors.textSub }]}>計算方式與限制</Text>
        </View>
        {showMethod
          ? <ChevronUp size={17} color={colors.textMuted} />
          : <ChevronDown size={17} color={colors.textMuted} />}
      </TouchableOpacity>
      {showMethod && (
        <Text style={[styles.methodText, { color: colors.textMuted }]}>每個期間從現金開始，進場時資金分成兩份；跌破第一段均線賣出 50%，跌破全部出場均線則賣出剩餘部位，同日跌破兩線時以全部出場優先。收盤訊號於次日開盤成交，閒置資金不計息。每次買賣估計成本 0.1%，未含額外交易稅、滑價及另計股息；未出場部位以期末收盤估值。需額外 {BACKTEST_WARMUP_BARS} 根暖機日 K。進場「無」不參與最佳化，第一段均線不得長於全部出場均線。歷史最佳不代表未來績效。</Text>
      )}
      </>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: { paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  headerCopy: { gap: 3 },
  eyebrow: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  eyebrowText: { fontSize: 9.5, fontWeight: '700' },
  title: { fontSize: 17, fontWeight: '800', letterSpacing: 0.1 },
  subtitle: { fontSize: 9.5, lineHeight: 14 },
  metricGrid: { marginHorizontal: 12, marginVertical: 10, minHeight: 69, flexDirection: 'row', borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  metricCell: { flex: 1, minWidth: 0, paddingHorizontal: 5, paddingVertical: 7, alignItems: 'center', justifyContent: 'center', gap: 4 },
  metricPeriod: { fontSize: 9.5, fontWeight: '700' },
  metricReturn: { width: '100%', fontSize: 14, fontWeight: '800', letterSpacing: -0.25, textAlign: 'center' },
  metricMeta: { width: '100%', fontSize: 7.5, textAlign: 'center' },
  optimizer: { marginHorizontal: 12, padding: 11, borderRadius: 14, borderWidth: 1, gap: 10 },
  optimizerHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  optimizerIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  optimizerCopy: { flex: 1, gap: 2 },
  sectionTitle: { fontSize: 14, fontWeight: '800' },
  sectionSubtitle: { fontSize: 9.5 },
  segmented: { flexDirection: 'row', padding: 3, borderRadius: 12, borderWidth: 1 },
  segment: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 9 },
  segmentText: { fontSize: 10, fontWeight: '600' },
  segmentTextSelected: { fontWeight: '800' },
  primaryButton: { minHeight: 42, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryButtonText: { fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  progressArea: { gap: 9 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  progressText: { fontSize: 12, fontWeight: '700' },
  progressPercent: { fontSize: 12, fontWeight: '800' },
  progressTrack: { height: 6, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  cancelButton: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 4 },
  cancelText: { fontSize: 11, fontWeight: '600' },
  error: { padding: 10, borderRadius: 10, fontSize: 11, lineHeight: 16 },
  bestCard: { marginHorizontal: 12, marginTop: 10, paddingVertical: 12, borderRadius: 14, borderWidth: 1 },
  bestHeader: { paddingHorizontal: 14, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  bestEyebrow: { fontSize: 11, fontWeight: '800' },
  bestReturn: { marginTop: 2, fontSize: 25, fontWeight: '900', letterSpacing: -0.5 },
  bestBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 999 },
  bestBadgeText: { fontSize: 10, fontWeight: '700' },
  bestMeta: { paddingHorizontal: 14, marginTop: 3, fontSize: 11 },
  settingGrid: { paddingHorizontal: 12, marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  settingChip: { minWidth: 76, flexGrow: 1, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, borderWidth: 1, gap: 1 },
  settingChipTitle: { fontSize: 9.5 },
  settingChipValue: { fontSize: 12, fontWeight: '800' },
  otherPeriodsTitle: { paddingHorizontal: 12, marginTop: 11, fontSize: 10, fontWeight: '700' },
  applyButton: { minHeight: 42, marginHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 11, borderWidth: 1.5 },
  applyButtonText: { fontSize: 13, fontWeight: '800' },
  methodToggle: { marginHorizontal: 12, marginTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  methodTitle: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  methodToggleText: { fontSize: 11, fontWeight: '700' },
  methodText: { marginHorizontal: 12, marginTop: 5, fontSize: 9.5, lineHeight: 14 },
});
