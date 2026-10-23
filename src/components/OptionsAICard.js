import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MarkdownText from './MarkdownText';
import OptionsExpectedMoveChart from './OptionsExpectedMoveChart';
import { buildOptionStrategies, optionPayoffAtExpiration } from '../services/optionsAIStrategies';
import { askOptionsAI, buildOptionsAISnapshot } from '../services/optionsAI';

const DIRECTIONS = [
  { key: 'bull', label: '看漲' },
  { key: 'bear', label: '看跌' },
  { key: 'neutral', label: '波動' },
];
const STRATEGY_KEYS = {
  bull: ['long_call', 'bull_call_spread'],
  bear: ['long_put', 'bear_put_spread'],
  neutral: ['straddle'],
};
const money = value => value === null ? '向上理論無上限' : `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const signedMoney = value => `${value >= 0 ? '+' : '−'}$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export default function OptionsAICard({ symbol, expiration, spot, spotAsOf, spotSource, chain, colors }) {
  const [direction, setDirection] = useState('bull');
  const [budget, setBudget] = useState('500');
  const [selectedKey, setSelectedKey] = useState(null);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const allStrategies = useMemo(() => buildOptionStrategies({
    contracts: chain?.contracts, spot, expiration, budget: Number(budget),
  }), [chain?.contracts, spot, expiration, budget]);
  const choices = allStrategies.filter(item => STRATEGY_KEYS[direction].includes(item.key));
  const selected = choices.find(item => item.key === selectedKey) || choices[0] || null;
  const snapshotKey = `${symbol}|${expiration}|${chain?.fetchedAt || ''}|${spot}|${spotAsOf || ''}|${direction}|${selected?.key || ''}|${budget}`;

  useEffect(() => {
    requestId.current += 1;
    setMessages([]);
    setQuestion('');
    setBusy(false);
    setError('');
  }, [snapshotKey]);

  const ask = async prompt => {
    if (!prompt.trim() || !selected || busy) return;
    const id = ++requestId.current;
    const next = [...messages, { role: 'user', content: prompt.trim() }];
    setMessages(next);
    setQuestion('');
    setError('');
    setBusy(true);
    try {
      const snapshot = buildOptionsAISnapshot({ symbol, expiration, spot, spotAsOf, spotSource, chain, strategies: choices, selectedStrategy: selected.title });
      const answer = await askOptionsAI({ snapshot, messages: next });
      if (id === requestId.current) setMessages([...next, { role: 'assistant', content: answer }]);
    } catch (caught) {
      if (id === requestId.current) setError(caught.message || 'AI 暫時無法回應');
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  };

  const scenario = selected && [0.95, 1, 1.05].map(factor => ({
    label: factor === 1 ? '持平' : `${factor > 1 ? '+' : '−'}${Math.round(Math.abs(factor - 1) * 100)}%`,
    value: optionPayoffAtExpiration(selected, spot * factor),
  }));

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>美股選擇權 AI 分析</Text>
      <Text style={[styles.sub, { color: colors.textSub }]}>按合約報價比較有限風險策略；AI 僅解讀。</Text>
      <OptionsExpectedMoveChart symbol={symbol} expiration={expiration} spot={spot} chain={chain} colors={colors} />
      <View style={styles.row}>
        {DIRECTIONS.map(item => <TouchableOpacity key={item.key} onPress={() => setDirection(item.key)} style={[styles.chip, { backgroundColor: direction === item.key ? colors.accentSoft : colors.cardAlt, borderColor: direction === item.key ? colors.accent : colors.border }]}><Text style={[styles.chipText, { color: direction === item.key ? colors.accent : colors.textSub }]}>{item.label}</Text></TouchableOpacity>)}
      </View>
      <View style={styles.budgetRow}><Text style={[styles.label, { color: colors.textSub }]}>單筆預算 USD</Text><TextInput value={budget} onChangeText={value => setBudget(value.replace(/[^\d.]/g, '').slice(0, 9))} keyboardType="decimal-pad" accessibilityLabel="單筆選擇權預算（美元）" style={[styles.budgetInput, { backgroundColor: colors.cardAlt, color: colors.text, borderColor: colors.border }]} /></View>
      {choices.length ? choices.map(item => <TouchableOpacity key={item.key} onPress={() => setSelectedKey(item.key)} style={[styles.strategy, { backgroundColor: selected?.key === item.key ? colors.accentSoft : colors.cardAlt, borderColor: selected?.key === item.key ? colors.accent : colors.border }]}>
        <View style={styles.strategyHeader}><Text style={[styles.strategyName, { color: colors.text }]}>{item.title}</Text><Text style={[styles.strategyCost, { color: colors.accent }]}>{money(item.cost)}</Text></View>
        <Text style={[styles.small, { color: colors.textSub }]}>{item.legs.map(leg => `${leg.side === 1 ? '買' : '賣'} ${leg.type === 'call' ? 'Call' : 'Put'} ${leg.strike}`).join(' + ')} · {item.affordableContracts ? `預算可做 ${item.affordableContracts} 組` : '超出預算'}</Text>
        <View style={styles.strategyStats}><Text style={[styles.small, { color: colors.negative }]}>最大虧損 {money(item.maxLoss)}</Text><Text style={[styles.small, { color: colors.positive }]}>最大獲利 {money(item.maxGain)}</Text></View>
      </TouchableOpacity>) : <Text style={[styles.empty, { color: colors.warning }]}>這個方向沒有完整的有效買賣報價，無法計算策略；請換到期日或標的。</Text>}
      {selected && <View style={[styles.details, { backgroundColor: colors.cardAlt }]}>
        <View style={styles.detailRow}><Text style={[styles.label, { color: colors.textSub }]}>到期損益兩平</Text><Text style={[styles.label, { color: colors.text }]}>{selected.breakeven.map(value => money(value)).join('／')}</Text></View>
        <Text style={[styles.label, { color: colors.text }]}>到期損益 · 現價 {money(spot)} · 每組 100 股</Text>
        <View style={styles.scenarios}>{scenario.map(item => <View key={item.label} style={styles.scenario}><Text style={{ color: colors.textSub }}>{item.label}</Text><Text style={{ color: item.value >= 0 ? colors.positive : colors.negative, fontWeight: '800' }}>{signedMoney(item.value)}</Text></View>)}</View>
        <Text style={[styles.small, { color: colors.textMuted }]}>僅計到期內含價；未含費用、滑價與提前指派風險。</Text>
      </View>}
      {selected && <>
        {!messages.length && <TouchableOpacity onPress={() => ask('請解讀這組選擇權的成交量、未平倉量、IV、Greeks，以及所選策略的風險與到期情境。')} disabled={busy} style={[styles.button, { backgroundColor: colors.accent }]}><Text style={[styles.buttonText, { color: colors.accentContrast }]}>AI 解讀這組選擇權</Text></TouchableOpacity>}
        {messages.map((item, index) => <View key={index} style={[styles.message, { backgroundColor: item.role === 'user' ? colors.accentSoft : colors.cardAlt }]}><Text style={[styles.messageRole, { color: colors.accent }]}>{item.role === 'user' ? '你' : 'Option AI'}</Text><MarkdownText text={item.content} color={colors.text} colors={colors} compact /></View>)}
        {busy && <View style={styles.wait}><ActivityIndicator size="small" color={colors.accent} /><Text style={{ color: colors.textSub }}>分析中…</Text></View>}
        {!!error && <Text style={[styles.small, { color: colors.negative }]}>{error}</Text>}
        {!!messages.length && <View style={styles.askRow}><TextInput value={question} onChangeText={setQuestion} placeholder="例如：股價漲 5% 到期會怎樣？" placeholderTextColor={colors.textMuted} multiline style={[styles.askInput, { backgroundColor: colors.cardAlt, color: colors.text, borderColor: colors.border }]} /><TouchableOpacity onPress={() => ask(question)} disabled={!question.trim() || busy} style={[styles.send, { backgroundColor: colors.accent, opacity: !question.trim() || busy ? 0.5 : 1 }]}><Text style={{ color: colors.accentContrast, fontWeight: '800' }}>送出</Text></TouchableOpacity></View>}
      </>}
      <Text style={[styles.small, { color: colors.textMuted }]}>來源：{chain?.provider || '—'} · {chain?.priceDelay || '報價可能延遲'} · {chain?.providerAsOf || chain?.fetchedAt || '時間未知'}。僅供研究，非投資建議。</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 15, padding: 10, gap: 7 },
  title: { fontSize: 16, fontWeight: '900' }, sub: { fontSize: 11, lineHeight: 15 },
  row: { flexDirection: 'row', gap: 6 }, chip: { minHeight: 36, borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 7, justifyContent: 'center' }, chipText: { fontWeight: '800', fontSize: 12 },
  budgetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, label: { fontSize: 12, fontWeight: '800' },
  budgetInput: { minWidth: 105, height: 36, borderRadius: 9, borderWidth: 1, paddingHorizontal: 9, textAlign: 'right' },
  strategy: { borderWidth: 1, borderRadius: 10, padding: 8, gap: 2 }, strategyHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, strategyName: { fontSize: 13, fontWeight: '900' }, strategyCost: { fontSize: 13, fontWeight: '900' },
  strategyStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  small: { fontSize: 10, lineHeight: 14 }, empty: { fontSize: 11, lineHeight: 16 }, details: { borderRadius: 10, padding: 9, gap: 5 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 }, scenarios: { flexDirection: 'row', justifyContent: 'space-around', gap: 6 }, scenario: { alignItems: 'center', gap: 2 },
  button: { minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, buttonText: { fontWeight: '900' },
  message: { borderRadius: 10, padding: 9 }, messageRole: { fontSize: 10, fontWeight: '900', marginBottom: 2 },
  wait: { flexDirection: 'row', alignItems: 'center', gap: 8 }, askRow: { flexDirection: 'row', gap: 7, alignItems: 'flex-end' },
  askInput: { flex: 1, minHeight: 42, maxHeight: 100, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }, send: { minHeight: 42, paddingHorizontal: 13, borderRadius: 10, justifyContent: 'center' },
});
