import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { ATR_MULTIPLIER_MIN, ATR_MULTIPLIER_MAX, normalizeAtrMultiplier } from '../../../services/exitManagement';

const money = value => Number(value || 0).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const strategyStatusMeta = (item, colors) => {
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
  'price-sr-touch': '直接使用技術圖上的 S1／S2、R1／R2 區域（至少兩次轉折測試）。壓力可在距區間下緣 1% 或半個 ATR14 以內提前觀察，上限為現價 2%；支撐維持較窄的緩衝。接近壓力是賣出／減碼觀察，不等於反轉確認或自動交易。',
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

function CandlestickPatternReference({ colors, styles }) {
  const [expanded, setExpanded] = useState(false);
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
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.compactDisclosure}>
      <Text style={[styles.patternReferenceSectionTitle, { color: colors.accent }]}>12 種 K 線型態介紹</Text>
      {expanded ? <ChevronUp size={16} color={colors.accent} /> : <ChevronDown size={16} color={colors.accent} />}
    </TouchableOpacity>
    {expanded && <>
    <Text style={[styles.patternReferenceNote, { color: colors.textMuted }]}>以下配色依本 App：綠漲、紅跌；不同市場 App 可能採用相反配色。</Text>
    <Text style={[styles.patternReferenceGroup, { color: colors.positive }]}>多方型態（看漲／反轉向上）</Text>
    <View style={styles.patternReferenceGrid}>{CANDLESTICK_PATTERN_REFERENCE.filter(pattern => pattern.direction === 'bullish').map(renderPattern)}</View>
    <Text style={[styles.patternReferenceGroup, { color: colors.negative }]}>空方型態（看跌／反轉向下）</Text>
    <View style={styles.patternReferenceGrid}>{CANDLESTICK_PATTERN_REFERENCE.filter(pattern => pattern.direction === 'bearish').map(renderPattern)}</View>
    </>}
  </View>;
}

const SIGNAL_STATUS = {
  confirmed: '已確認',
  pending: '等待確認',
  invalidated: '已失效',
  expired: '已逾期',
  stale: '確認已過期',
};

function SignalChecklist({ signal, colors, styles }) {
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

function InstitutionalConfirmationNote({ item, colors, styles }) {
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

function AtrMultiplierSlider({ value, colors, onChange, styles }) {
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

export function ExitManagementCard({ exitManagement, atrMultiplier, onAtrMultiplierChange, colors, isReplay = false, styles }) {
  if (!exitManagement) return null;
  const statusColor = exitManagement.status === 'exit' ? colors.negative : exitManagement.status === 'reduce' ? colors.negative : exitManagement.status === 'tighten' ? colors.warning : exitManagement.status === 'hold' ? colors.positive : colors.textMuted;
  const statusLabel = exitManagement.statusLabel || '資料不足';
  const chipLabel = exitManagement.chipStatus === 'bullish' ? '偏多' : exitManagement.chipStatus === 'bearish' ? '偏空' : exitManagement.chipStatus === 'watch' ? '觀察' : '資料不足';
  const maLabel = exitManagement.maStatus === 'bullish' ? '偏多' : exitManagement.maStatus === 'bearish' ? '偏空' : '觀察';
  return <View style={[styles.strategyCard, styles.compactStrategyCard, { backgroundColor: colors.card, borderColor: colors.border }] }>
    <View style={styles.strategyHeader}><View style={styles.flex}><Text style={[styles.selectedEyebrow, { color: colors.accent }]}>獨立分析 · 出倉管理</Text><Text style={[styles.strategyTitle, { color: colors.text }]}>停損停利策略</Text><Text style={[styles.strategyIntro, { color: colors.textSub }]}>ATR 防線 → 均線趨勢 → 籌碼金流</Text></View><View style={[styles.strategyBadge, { backgroundColor: `${statusColor}18`, borderColor: statusColor }]}><Text style={[styles.strategyBadgeText, { color: statusColor }]}>{statusLabel}</Text></View></View>
    <Text style={[styles.strategyReason, { color: colors.textSub }]}>{exitManagement.reason}</Text>
    {isReplay && <View style={[styles.latestDataNotice, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.latestDataNoticeText, { color: colors.textMuted }]}>此獨立分析保留最新行情與持倉資料，未隨歷史回放日期重算。</Text></View>}
    <View style={[styles.atrControl, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
      <View style={styles.atrControlHeader}><Text style={[styles.atrControlTitle, { color: colors.text }]}>ATR · 初始防線與動態雜訊空間</Text><Text style={[styles.atrControlHint, { color: colors.textMuted }]}>預設 1.5×</Text></View>
      <AtrMultiplierSlider value={atrMultiplier} colors={colors} onChange={onAtrMultiplierChange} styles={styles} />
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

export function EntryScalingCard({ plan, atrMultiplier, onAtrMultiplierChange, colors, isReplay = false, styles }) {
  if (!plan) return null;
  const positive = ['initial', 'add1', 'add2'].includes(plan.status);
  const caution = ['hold', 'tighten', 'noAdd', 'waitEntry'].includes(plan.status);
  const statusColor = positive ? colors.positive : caution ? colors.warning : colors.textMuted;
  const check = value => value ? '已確認' : '未確認';
  return <View style={[styles.strategyCard, styles.compactStrategyCard, { backgroundColor: colors.card, borderColor: colors.border }] }>
    <View style={styles.strategyHeader}><View style={styles.flex}><Text style={[styles.selectedEyebrow, { color: colors.accent }]}>獨立分析 · 部位建立</Text><Text style={[styles.strategyTitle, { color: colors.text }]}>進場與加碼策略</Text><Text style={[styles.strategyIntro, { color: colors.textSub }]}>ATR 波動 → 均線趨勢 → 籌碼金流</Text></View><View style={[styles.strategyBadge, { backgroundColor: `${statusColor}18`, borderColor: statusColor }]}><Text style={[styles.strategyBadgeText, { color: statusColor }]}>{plan.statusLabel || '資料不足'}</Text></View></View>
    <Text style={[styles.strategyReason, { color: colors.textSub }]}>{plan.reason}</Text>
    {isReplay && <View style={[styles.latestDataNotice, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}><Text style={[styles.latestDataNoticeText, { color: colors.textMuted }]}>此獨立分析保留最新行情與持倉資料，未隨歷史回放日期重算。</Text></View>}
    <View style={[styles.atrControl, { backgroundColor: colors.cardAlt, borderColor: colors.border }] }>
      <View style={styles.atrControlHeader}><Text style={[styles.atrControlTitle, { color: colors.text }]}>ATR · 突破、回測與風控空間</Text><Text style={[styles.atrControlHint, { color: colors.textMuted }]}>預設 1.5×</Text></View>
      <AtrMultiplierSlider value={atrMultiplier} colors={colors} onChange={onAtrMultiplierChange} styles={styles} />
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

function HybridStrategyCard({ hybrid, atrPosition, colors, isReplay = false, asOfDate = null, styles }) {
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
  return <View style={[styles.strategyCard, styles.compactStrategyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
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

export function SelectedStrategyCard({ analysis, selectedStrategy, atrPosition, colors, isReplay = false, asOfDate = null, styles }) {
  const [expanded, setExpanded] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  if (selectedStrategy === 'ALL') return <HybridStrategyCard hybrid={analysis.hybrid} atrPosition={atrPosition} colors={colors} isReplay={isReplay} asOfDate={asOfDate} styles={styles} />;
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
  if (selectedStrategy === 'price-sr-touch' && item.zone) {
    levelRows.push(['觀察區', `${money(item.zone.lower)}–${money(item.zone.upper)}`], ['歷史測試', `${item.zone.touches} 次`]);
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
  return <View style={[styles.strategyCard, styles.compactStrategyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.strategyHeader}><View style={styles.flex}><Text style={[styles.selectedEyebrow, { color: colors.accent }]}>{isReplay ? `歷史回放 · 截至 ${asOfDate || '—'}` : '目前選擇'}</Text><Text style={[styles.strategyTitle, { color: colors.text }]}>{item.label}</Text></View><View style={styles.collapsibleStatus}><View style={[styles.strategyBadge, { backgroundColor: `${meta.color}18`, borderColor: meta.color }]}><Text style={[styles.strategyBadgeText, { color: meta.color }]}>{meta.label}</Text></View>{expanded ? <ChevronUp size={18} color={colors.textMuted} /> : <ChevronDown size={18} color={colors.textMuted} />}</View></TouchableOpacity>
    {expanded && <>
    <Text style={[styles.strategyReason, { color: colors.textSub }]}>{item.reason}</Text>
    <InstitutionalConfirmationNote item={item} colors={colors} styles={styles} />
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showGuide }} onPress={() => setShowGuide(value => !value)} style={styles.compactDisclosure}><Text style={[styles.guideTitle, { color: colors.accent }]}>{guideTitle}</Text>{showGuide ? <ChevronUp size={16} color={colors.accent} /> : <ChevronDown size={16} color={colors.accent} />}</TouchableOpacity>
    {showGuide && <View style={[styles.guideBlock, { backgroundColor: colors.cardAlt }]}><Text style={[styles.guideText, { color: colors.textSub }]}>{candlestickGuide}</Text></View>}
    {levelRows.length > 0 && <View style={[styles.metricList, { borderTopColor: colors.borderLight }]}>{levelRows.map(([label, value]) => <View key={`${label}-${value}`} style={styles.metricRow}><Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text><Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text></View>)}</View>}
    {selectedStrategy === 'candlestick' && <CandlestickPatternReference colors={colors} styles={styles} />}
    {['divergence', 'rsiDivergence', 'kdDivergence'].includes(selectedStrategy) && <SignalChecklist signal={signal} colors={colors} styles={styles} />}
    </>}
  </View>;
}
