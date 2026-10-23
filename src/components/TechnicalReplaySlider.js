import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const formatDate = value => value ? String(value).replace(/-/g, '/') : '最新';

export default function TechnicalReplaySlider({ dates = [], value = null, colors, onChange, onLatest }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragIndex, setDragIndex] = useState(null);

  const lastIndex = Math.max(0, dates.length - 1);
  const controlledIndex = useMemo(() => {
    if (!dates.length || !value) return lastIndex;
    const exactIndex = dates.indexOf(value);
    if (exactIndex >= 0) return exactIndex;
    const earlierIndex = dates.reduce((candidate, date, index) => date <= value ? index : candidate, 0);
    return Math.max(0, Math.min(lastIndex, earlierIndex));
  }, [dates, lastIndex, value]);
  const currentIndex = dragIndex == null ? controlledIndex : dragIndex;
  const currentDate = dates[currentIndex] || null;
  const currentDateLabel = dragIndex != null ? currentDate : value;
  const ratio = lastIndex > 0 ? currentIndex / lastIndex : 1;

  const indexFromEvent = event => {
    const x = Number(event.nativeEvent?.locationX || 0);
    const nextRatio = Math.max(0, Math.min(1, x / Math.max(1, trackWidth)));
    return Math.round(nextRatio * lastIndex);
  };

  const commitIndex = index => {
    const nextIndex = Math.max(0, Math.min(lastIndex, index));
    setDragIndex(null);
    if (nextIndex >= lastIndex) onLatest?.();
    else onChange?.(dates[nextIndex]);
  };

  const stepIndex = delta => {
    const baseIndex = dragIndex == null ? controlledIndex : dragIndex;
    commitIndex(baseIndex + delta);
  };

  if (!dates.length) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={[styles.title, { color: colors.text }]}>歷史回放</Text>
          <Text style={[styles.subtitle, { color: colors.textSub }]}>最近 30 個交易日；拖曳預覽日期，放開後查看當日判斷</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="回到最新資料"
          onPress={() => {
            commitIndex(lastIndex);
          }}
          style={[styles.latestButton, { borderColor: colors.accent, backgroundColor: !value ? colors.accentSoft : colors.cardAlt }]}
        >
          <Text style={[styles.latestButtonText, { color: colors.accent }]}>最新</Text>
        </Pressable>
      </View>
      <View style={styles.dateRow}>
        <Text style={[styles.dateLabel, { color: colors.textMuted }]}>{formatDate(dates[0])}</Text>
        <Text accessibilityLiveRegion="polite" style={[styles.currentDate, { color: colors.accent }]}>{formatDate(currentDateLabel)}</Text>
        <Text style={[styles.dateLabel, { color: colors.textMuted }]}>{formatDate(dates[lastIndex])}</Text>
      </View>
      <View style={styles.sliderRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="前一個交易日"
          accessibilityState={{ disabled: currentIndex <= 0 }}
          disabled={currentIndex <= 0}
          onPress={() => stepIndex(-1)}
          style={[styles.arrowButton, { backgroundColor: colors.cardAlt, borderColor: colors.border, opacity: currentIndex <= 0 ? 0.4 : 1 }]}
        >
          <ChevronLeft size={16} color={colors.accent} />
        </Pressable>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel="歷史回放日期"
          accessibilityValue={{ text: currentDateLabel ? formatDate(currentDateLabel) : '最新' }}
          style={styles.touchArea}
          onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponderCapture={() => true}
          onMoveShouldSetResponderCapture={() => true}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={event => {
            const index = indexFromEvent(event);
            setDragIndex(index);
          }}
          onResponderMove={event => {
            const index = indexFromEvent(event);
            setDragIndex(current => current === index ? current : index);
          }}
          onResponderRelease={event => {
            commitIndex(indexFromEvent(event));
          }}
          onResponderTerminate={() => {
            setDragIndex(null);
          }}
          onResponderTerminationRequest={() => false}
          onShouldBlockNativeResponder={() => true}
        >
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: colors.accent }]} />
            <View style={[styles.thumb, { left: `${ratio * 100}%`, backgroundColor: colors.accent, borderColor: colors.card }]} />
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={currentIndex >= lastIndex ? '已是最新資料' : '下一個交易日'}
          accessibilityState={{ disabled: currentIndex >= lastIndex }}
          disabled={currentIndex >= lastIndex}
          onPress={() => stepIndex(1)}
          style={[styles.arrowButton, { backgroundColor: colors.cardAlt, borderColor: colors.border, opacity: currentIndex >= lastIndex ? 0.4 : 1 }]}
        >
          <ChevronRight size={16} color={colors.accent} />
        </Pressable>
      </View>
      <Text style={[styles.note, { color: colors.textMuted }]}>拖曳時先預覽日期，放開後技術圖、策略統計與詳細技術卡才會重算；停損、估值、財報等獨立分析仍顯示最新資料。</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 7 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  title: { fontSize: 13, fontWeight: '900' },
  subtitle: { fontSize: 9, lineHeight: 14, marginTop: 3 },
  latestButton: { minHeight: 30, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  latestButtonText: { fontSize: 10, fontWeight: '900' },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  dateLabel: { fontSize: 8 },
  currentDate: { fontSize: 12, fontWeight: '900' },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  arrowButton: { width: 30, height: 30, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  touchArea: { flex: 1, height: 30, justifyContent: 'center' },
  track: { height: 7, borderRadius: 4, position: 'relative', overflow: 'visible' },
  fill: { height: 7, borderRadius: 4 },
  thumb: { position: 'absolute', top: -5, width: 17, height: 17, marginLeft: -8, borderRadius: 9, borderWidth: 2 },
  note: { fontSize: 9, lineHeight: 14 },
});
