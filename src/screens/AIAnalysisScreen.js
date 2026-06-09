import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, Keyboard, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bot, Send, RefreshCw, ChevronDown, CheckCircle, XCircle, Mic, MicOff } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';
import { convertToBaseCurrency, fetchExchangeRatesBatch, fetchTWStockPriceBatch, fetchUSStockPriceBatch, fetchCryptoPriceBatch } from '../services/api';
import { askAI, transcribeAudio } from '../services/ai';
import { useTheme } from '../lib/ThemeContext';

const PRIMARY  = '#F7A600';
const GREEN    = '#0DBD8B';
const RED      = '#F03030';

const QUICK_QUESTIONS = [
  { label: '📊 整體分析',    text: '請幫我分析目前的資產組合，包括優缺點和風險點。' },
  { label: '⚠️ 風險評估',    text: '我的投資組合有哪些主要風險？集中度和流動性如何？' },
  { label: '📈 績效分析',    text: '我的資產表現如何？哪些資產拖累了整體表現？' },
  { label: '💡 改善建議',    text: '根據我的資產配置，你有什麼具體的改善建議？' },
  { label: '🏦 配置分析',    text: '我的資產配置比例合理嗎？和一般建議相比如何？' },
  { label: '📅 月度回顧',    text: '根據近幾個月的數據，我的財務趨勢如何？有什麼需要注意的？' },
  { label: '💰 記錄買入',    text: '我想記錄一筆買入交易，請問我要買什麼股票/資產、幾股、成交價格？' },
  { label: '📉 記錄賣出',    text: '我想記錄一筆賣出交易，請問是哪個資產、幾股、成交價格？' },
  { label: '➕ 新增資產',    text: '我想新增一個資產到我的投資組合，請問是什麼資產？（請提供名稱、代號、類別）' },
  { label: '🔄 調整金額',    text: '我想調整某個資產的目前金額，請問是哪個資產？要調整成多少？' },
  { label: '🎯 壓力測試',    text: '如果市場大跌 20%，我的投資組合會受到多大影響？哪個資產風險最高？' },
  { label: '💸 現金流分析',  text: '根據我的固定支出和資產，每個月的現金流狀況如何？能撐多久？' },
  { label: '📰 新聞解讀',    text: '根據我目前持有的資產，最近有哪些重要產業動態或市場消息值得注意？分別對我的持倉有什麼潛在影響？' },
  { label: '📆 年度規劃',    text: '根據我目前的淨資產和近幾個月的月度變動趨勢，推算今年底的預估淨資產。同時給我 2-3 個具體建議，幫助我達成更好的年度財務目標。' },
];

// ── Typing dots animation ──────────────────────────────────────────────────
function TypingDots({ color }) {
  const dots = [useRef(new Animated.Value(0)).current,
                useRef(new Animated.Value(0)).current,
                useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 180),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay((dots.length - i) * 180),
        ])
      )
    );
    animations.forEach(a => a.start());
    return () => animations.forEach(a => a.stop());
  }, []);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 }}>
      {dots.map((dot, i) => (
        <Animated.View key={i} style={{
          width: 7, height: 7, borderRadius: 4,
          backgroundColor: color,
          opacity: dot,
          transform: [{ scale: dot.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        }} />
      ))}
    </View>
  );
}

// ── Inline bold parser ────────────────────────────────────────────────────
function renderInline(text, color) {
  const parts = text.split(/(\*\*.*?\*\*)/);
  if (parts.length === 1) return <Text style={{ color }}>{text}</Text>;
  return (
    <Text>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return <Text key={i} style={{ color, fontWeight: '700' }}>{p.slice(2, -2)}</Text>;
        }
        return <Text key={i} style={{ color }}>{p}</Text>;
      })}
    </Text>
  );
}

// ── Markdown → React Native renderer ─────────────────────────────────────
function MarkdownText({ text, color }) {
  const lines = text.split('\n');
  return (
    <View>
      {lines.map((line, i) => {
        // Header: # ## ###
        const hMatch = line.match(/^#{1,3}\s+(.+)/);
        if (hMatch) {
          return (
            <Text key={i} style={{ color, fontSize: 15, fontWeight: '700', marginTop: 10, marginBottom: 2, lineHeight: 22 }}>
              {hMatch[1].replace(/\*\*/g, '')}
            </Text>
          );
        }
        // Bullet: * - or ▸
        const bMatch = line.match(/^(?:[\*\-]|\▸)\s+(.+)/);
        if (bMatch) {
          return (
            <View key={i} style={{ flexDirection: 'row', marginVertical: 2, paddingLeft: 2 }}>
              <Text style={{ color, lineHeight: 22, marginRight: 7 }}>▸</Text>
              <View style={{ flex: 1 }}>
                {renderInline(bMatch[1], color)}
              </View>
            </View>
          );
        }
        // Numbered list: 1. 2. etc or ①②
        const nMatch = line.match(/^(\d+[\.\、]|[①②③④⑤⑥⑦⑧⑨⑩])\s*(.+)/);
        if (nMatch) {
          return (
            <View key={i} style={{ flexDirection: 'row', marginVertical: 2 }}>
              <Text style={{ color, lineHeight: 22, marginRight: 6, fontWeight: '600' }}>{nMatch[1]}</Text>
              <View style={{ flex: 1 }}>
                {renderInline(nMatch[2], color)}
              </View>
            </View>
          );
        }
        // Empty line
        if (!line.trim()) return <View key={i} style={{ height: 6 }} />;
        // Normal text
        return (
          <View key={i} style={{ marginVertical: 1 }}>
            {renderInline(line, color)}
          </View>
        );
      })}
    </View>
  );
}

// ── Action confirmation card ──────────────────────────────────────────────
const ACTION_LABELS = { BUY: '買入', SELL: '賣出', ADJUST: '調整金額' };

function ActionConfirmCard({ action, onConfirm, onCancel, confirmed, actionError, isDark, colors }) {
  const label  = ACTION_LABELS[action.type] || action.type;
  const cardBg = isDark ? '#1e2d3d' : '#f0f9ff';
  const border = isDark ? '#2d4a6b' : '#bae6fd';
  const accent = '#F7A600';

  return (
    <View style={[acStyles.card, { backgroundColor: cardBg, borderColor: border }]}>
      <Text style={[acStyles.title, { color: colors.text }]}>
        📋 確認{label}操作
      </Text>

      <View style={acStyles.row}>
        <Text style={[acStyles.label, { color: colors.textSub }]}>資產</Text>
        <Text style={[acStyles.value, { color: colors.text }]}>
          {action.assetName}{action.symbol ? ` (${action.symbol})` : ''}
        </Text>
      </View>

      {action.type !== 'ADJUST' && action.shares > 0 && (
        <View style={acStyles.row}>
          <Text style={[acStyles.label, { color: colors.textSub }]}>股數</Text>
          <Text style={[acStyles.value, { color: colors.text }]}>
            {action.shares.toLocaleString()} 股
          </Text>
        </View>
      )}

      <View style={acStyles.row}>
        <Text style={[acStyles.label, { color: colors.textSub }]}>
          {action.type === 'ADJUST' ? '調整為' : '價格'}
        </Text>
        <Text style={[acStyles.value, { color: colors.text }]}>
          {action.currency} {action.price?.toLocaleString()}
        </Text>
      </View>

      {action.type !== 'ADJUST' && action.shares > 0 && action.price > 0 && (
        <View style={acStyles.row}>
          <Text style={[acStyles.label, { color: colors.textSub }]}>總金額</Text>
          <Text style={[acStyles.value, { color: accent, fontWeight: '700' }]}>
            {action.currency} {(action.shares * action.price).toLocaleString()}
          </Text>
        </View>
      )}

      {confirmed === 'loading' && (
        <View style={[acStyles.doneRow, { backgroundColor: isDark ? '#1e293b' : '#f8fafc' }]}>
          <ActivityIndicator size="small" color={accent} />
          <Text style={{ color: colors.textSub, fontSize: 13 }}>記錄中…</Text>
        </View>
      )}
      {confirmed === true && (
        <View style={[acStyles.doneRow, { backgroundColor: isDark ? '#1a3a2a' : '#f0fdf4' }]}>
          <CheckCircle size={15} color="#0DBD8B" />
          <Text style={{ color: '#0DBD8B', fontSize: 13, fontWeight: '600' }}>已記錄成功，切換到總覽即可看到</Text>
        </View>
      )}
      {confirmed === false && (
        <View style={[acStyles.doneRow, { backgroundColor: isDark ? '#3a1a1a' : '#fef2f2' }]}>
          <XCircle size={15} color="#F03030" />
          <Text style={{ color: '#F03030', fontSize: 13 }}>
            {actionError ? `失敗：${actionError}` : '已取消'}
          </Text>
        </View>
      )}

      {(confirmed === null || confirmed === undefined) && (
        <View style={acStyles.btnRow}>
          <TouchableOpacity
            style={[acStyles.cancelBtn, { borderColor: isDark ? '#475569' : '#cbd5e1' }]}
            onPress={onCancel}
          >
            <Text style={[acStyles.cancelText, { color: colors.textSub }]}>取消</Text>
          </TouchableOpacity>
          <TouchableOpacity style={acStyles.confirmBtn} onPress={onConfirm}>
            <Text style={acStyles.confirmText}>確認記錄</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const acStyles = StyleSheet.create({
  card: {
    borderWidth: 1, borderRadius: 14,
    padding: 14, marginTop: 8,
  },
  title:  { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  row:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  label:  { fontSize: 13 },
  value:  { fontSize: 13, fontWeight: '500' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, padding: 8, borderRadius: 8 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1, alignItems: 'center',
  },
  cancelText:  { fontSize: 14, fontWeight: '600' },
  confirmBtn:  { flex: 2, paddingVertical: 9, borderRadius: 10, backgroundColor: '#F7A600', alignItems: 'center' },
  confirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});

// ── Single message bubble ─────────────────────────────────────────────────
function MessageBubble({ msg, msgIdx, colors, isDark, onConfirmAction, onCancelAction }) {
  const isUser = msg.role === 'user';
  const bubbleBg = isUser
    ? PRIMARY
    : (isDark ? '#1e293b' : '#f1f5f9');
  const textColor = isUser ? '#fff' : colors.text;

  return (
    <View style={[
      styles.bubbleRow,
      isUser ? styles.bubbleRowUser : styles.bubbleRowAI,
    ]}>
      {!isUser && (
        <View style={[styles.avatar, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]}>
          <Bot size={14} color={PRIMARY} />
        </View>
      )}
      <View style={[
        styles.bubble,
        { backgroundColor: bubbleBg, maxWidth: '82%' },
        isUser ? styles.bubbleUser : styles.bubbleAI,
      ]}>
        {isUser ? (
          <Text style={{ color: textColor, fontSize: 14, lineHeight: 22 }}>{msg.content}</Text>
        ) : (
          <MarkdownText text={msg.content} color={textColor} />
        )}
        {msg.action && (
          <ActionConfirmCard
            action={msg.action}
            confirmed={msg.actionConfirmed ?? null}
            actionError={msg.actionError}
            onConfirm={() => onConfirmAction(msgIdx)}
            onCancel={() => onCancelAction(msgIdx)}
            isDark={isDark}
            colors={colors}
          />
        )}
        {msg.model && (
          <Text style={{ color: isUser ? 'rgba(255,255,255,0.55)' : colors.textMuted, fontSize: 10, marginTop: 6 }}>
            {msg.model.split('/')[1]?.replace(':free', '') || msg.model}
          </Text>
        )}
      </View>
    </View>
  );
}

export default function AIAnalysisScreen() {
  const { colors, isDark }  = useTheme();
  const insets              = useSafeAreaInsets();
  // Tab bar pill height (67px) + safe area bottom + 8px buffer
  const tabBarHeight        = 75 + insets.bottom;
  const scrollRef           = useRef(null);

  const [messages,     setMessages]     = useState([]);
  const [inputText,    setInputText]    = useState('');
  const [isThinking,   setIsThinking]   = useState(false);
  const [portfolio,    setPortfolio]    = useState(null);
  const [loadingCtx,   setLoadingCtx]   = useState(true);
  const [ctxError,     setCtxError]     = useState(null);
  const [showScroll,   setShowScroll]   = useState(false);
  const [recording,    setRecording]    = useState(null);
  const [transcribing, setTranscribing] = useState(false);

  // ── Load saved messages + portfolio on first focus ──────────────────────
  const didLoadRef = useRef(false);

  useFocusEffect(useCallback(() => {
    loadPortfolioContext();
    if (!didLoadRef.current) {
      didLoadRef.current = true;
      loadSavedMessages();
    }
  }, []));

  const loadSavedMessages = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('ai_messages')
        .select('role, content, model')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(60);
      if (!error && data?.length > 0) {
        setMessages(data);
      }
    } catch (e) {
      console.warn('loadSavedMessages:', e.message);
    }
  };

  const saveMessages = async (msgs) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Upsert only the new messages (those without a DB id)
      // Strategy: delete all then re-insert the last 60 (cheap for small history)
      const trimmed = msgs.slice(-60);
      await supabase.from('ai_messages').delete().eq('user_id', user.id);
      if (trimmed.length > 0) {
        await supabase.from('ai_messages').insert(
          trimmed.map(m => ({
            user_id: user.id,
            role: m.role,
            content: m.content,
            model: m.model || null,
          }))
        );
      }
    } catch (e) {
      console.warn('saveMessages:', e.message);
    }
  };

  const loadPortfolioContext = async () => {
    setLoadingCtx(true);
    setCtxError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [profileRes, assetsRes, expensesRes] = await Promise.all([
        supabase.from('profiles').select('base_currency').eq('id', user.id).single(),
        supabase.from('assets').select('id, name, symbol, category, market_type, current_amount, currency, average_cost, current_shares, leverage').eq('user_id', user.id),
        supabase.from('fixed_expenses').select('amount, currency, frequency').eq('user_id', user.id),
      ]);

      const baseCurrency = profileRes.data?.base_currency || 'TWD';
      const assetsData   = assetsRes.data || [];
      const expenses     = expensesRes.data || [];

      // Fetch exchange rates
      const uniqueCurrencies = [...new Set(assetsData.map(a => a.currency).filter(Boolean))];
      const ratesMap = await fetchExchangeRatesBatch(uniqueCurrencies, baseCurrency);

      // Fetch live prices for investment assets
      const inv = assetsData.filter(a => a.symbol && a.category === 'investment' && a.current_shares > 0);
      let liveAmounts = {};
      if (inv.length > 0) {
        const [usPrices, crPrices, twPrices] = await Promise.all([
          fetchUSStockPriceBatch(inv.filter(a => a.market_type === 'US').map(a => a.symbol)),
          fetchCryptoPriceBatch(inv.filter(a => a.market_type === 'Crypto').map(a => a.symbol)),
          fetchTWStockPriceBatch(inv.filter(a => a.market_type === 'TW').map(a => a.symbol)),
        ]);
        const priceMap = { ...usPrices, ...crPrices, ...twPrices };
        inv.forEach(a => {
          const pd = priceMap[a.symbol];
          if (!pd?.price) return;
          const lev = a.leverage || 1;
          const borrowed = a.current_shares * (a.average_cost || 0) * (lev - 1) / lev;
          liveAmounts[a.id] = pd.price * a.current_shares - borrowed;
        });
      }

      // Convert assets + compute pnl_pct with live prices
      // Also store converted_cost (base currency) for correct P&L in consolidation
      const converted = await Promise.all(
        assetsData.map(async (a) => {
          const rawAmount = liveAmounts[a.id] ?? parseFloat(a.current_amount || 0);
          const converted_amount = await convertToBaseCurrency(rawAmount, a.currency, baseCurrency, ratesMap);
          let pnl_pct = null;
          let converted_cost = 0;
          if (a.category === 'investment' && a.current_shares > 0 && a.average_cost > 0) {
            const lev = a.leverage || 1;
            const costBasis = a.current_shares * a.average_cost / lev;
            converted_cost = await convertToBaseCurrency(costBasis, a.currency, baseCurrency, ratesMap);
            pnl_pct = converted_cost > 0 ? ((converted_amount - converted_cost) / converted_cost) * 100 : 0;
          }
          return { ...a, converted_amount, converted_cost, pnl_pct };
        })
      );

      // ── Consolidate same-symbol investment assets into one entry ────────────
      // (mirrors Dashboard grouping so AI sees the same totals)
      const consolidatedMap = {};
      for (const a of converted) {
        const key = (a.category === 'investment' && a.symbol) ? `inv:${a.symbol}` : `id:${a.id}`;
        if (!consolidatedMap[key]) {
          consolidatedMap[key] = { ...a };
        } else {
          const ex = consolidatedMap[key];
          const totalAmt  = (ex.converted_amount || 0) + (a.converted_amount || 0);
          // Use already-converted costs (base currency) so P&L comparison is apples-to-apples
          const totalCost = (ex.converted_cost || 0) + (a.converted_cost || 0);
          ex.converted_amount = totalAmt;
          ex.converted_cost   = totalCost;
          ex.current_shares   = (ex.current_shares || 0) + (a.current_shares || 0);
          ex.pnl_pct = totalCost > 0 ? ((totalAmt - totalCost) / totalCost) * 100 : null;
        }
      }
      const merged = Object.values(consolidatedMap);

      const nonLiab   = merged.filter(a => a.category !== 'liability');
      const liabTotal = merged.filter(a => a.category === 'liability').reduce((s, a) => s + (a.converted_amount || 0), 0);
      const netWorth  = nonLiab.reduce((s, a) => s + (a.converted_amount || 0), 0) - liabTotal;

      // Monthly change from daily_snapshots
      let monthlyChange = null;
      const startOfMonth = new Date(); startOfMonth.setDate(1);
      const { data: snap } = await supabase
        .from('daily_snapshots').select('net_worth_base')
        .eq('user_id', user.id)
        .gte('snapshot_date', startOfMonth.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: true }).limit(1).maybeSingle();
      if (snap) monthlyChange = netWorth - parseFloat(snap.net_worth_base);

      // Monthly breakdown
      let monthlyBreakdown = [];
      const since = new Date(); since.setMonth(since.getMonth() - 5); since.setDate(1);
      const { data: monthSnaps } = await supabase
        .from('daily_snapshots').select('snapshot_date, net_worth_base')
        .eq('user_id', user.id)
        .gte('snapshot_date', since.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: true });
      if (monthSnaps?.length > 1) {
        const byMonth = {};
        for (const s of monthSnaps) {
          const ym = s.snapshot_date.slice(0, 7);
          if (!byMonth[ym]) byMonth[ym] = { first: parseFloat(s.net_worth_base), last: parseFloat(s.net_worth_base) };
          else byMonth[ym].last = parseFloat(s.net_worth_base);
        }
        const months = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b));
        for (let i = 1; i < months.length; i++) {
          const [ym, { last }] = months[i];
          const prevLast = months[i - 1][1].last;
          const change = last - prevLast;
          const pct    = prevLast > 0 ? (change / prevLast) * 100 : 0;
          const [y, m] = ym.split('-');
          monthlyBreakdown.push({ label: `${y}/${parseInt(m)}月`, change, pct });
        }
      }

      // Fixed expenses monthly total
      const FREQ = { monthly: 1, quarterly: 3, semi_annual: 6, yearly: 12 };
      let fixedExpensesMonthly = 0;
      for (const e of expenses) {
        const monthly = parseFloat(e.amount) / (FREQ[e.frequency] || 1);
        const converted = await convertToBaseCurrency(monthly, e.currency, baseCurrency);
        fixedExpensesMonthly += converted;
      }

      setPortfolio({
        netWorth, monthlyChange, monthlyBreakdown,
        assets: merged, currency: baseCurrency,
        fixedExpensesMonthly: fixedExpensesMonthly > 0 ? fixedExpensesMonthly : null,
      });
    } catch (e) {
      console.warn('loadPortfolioContext error:', e);
      setCtxError('無法載入資產資料');
    } finally {
      setLoadingCtx(false);
    }
  };

  const sendMessage = async (text) => {
    const trimmed = (text || inputText).trim();
    if (!trimmed || isThinking) return;
    setInputText('');
    Keyboard.dismiss();

    const userMsg = { role: 'user', content: trimmed };
    const history = [...messages, userMsg];
    setMessages(history);
    setIsThinking(true);

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      // Send only role + content to API (no model field)
      const apiMessages = history.map(m => ({ role: m.role, content: m.content }));
      const { content, model, action } = await askAI(apiMessages, portfolio || {});
      const aiMsg = { role: 'assistant', content, model };
      if (action) { aiMsg.action = action; aiMsg.actionConfirmed = null; }
      const updated = [...history, aiMsg];
      setMessages(updated);
      saveMessages(updated);
    } catch (e) {
      const errMsg = { role: 'assistant', content: `❌ ${e.message || '發生錯誤，請重試'}` };
      const updated = [...history, errMsg];
      setMessages(updated);
    } finally {
      setIsThinking(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  // ── Execute a confirmed action ────────────────────────────────────────────
  const executeAction = async (action) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登入');

    // Find the target asset (match by symbol first, then by name)
    const { data: assets } = await supabase
      .from('assets')
      .select('id, name, symbol, category, currency, current_amount, leverage')
      .eq('user_id', user.id);

    let target = assets?.find(a =>
      (action.symbol && a.symbol?.toUpperCase() === action.symbol.toUpperCase()) ||
      a.name === action.assetName
    );

    // Auto-create asset for BUY when it doesn't exist yet
    if (!target) {
      if (action.type !== 'BUY') {
        throw new Error(`找不到資產「${action.assetName ?? action.symbol}」，請先在資產列表中新增`);
      }
      // Infer market_type if AI didn't provide it
      const marketType = action.marketType ||
        (/^\d+$/.test(action.symbol || '') ? 'TW' : 'US');
      const currency = action.currency ||
        (marketType === 'TW' ? 'TWD' : 'USD');
      const { data: created, error: createErr } = await supabase
        .from('assets')
        .insert({
          user_id:        user.id,
          name:           action.assetName || action.symbol,
          symbol:         action.symbol || null,
          category:       'investment',
          market_type:    marketType,
          currency,
          current_amount: 0,
          current_shares: 0,
          average_cost:   0,
          leverage:       1,
        })
        .select()
        .single();
      if (createErr) throw new Error(`新增資產失敗：${createErr.message}`);
      target = created;
    }

    const isInvestment = target.category === 'investment';
    const sharesNum    = parseFloat(action.shares) || 0;
    const priceNum     = parseFloat(action.price)  || 0;
    const leverageNum  = parseFloat(target.leverage) || 1;

    if (action.type === 'ADJUST') {
      // Direct amount adjustment
      await supabase.from('assets').update({ current_amount: priceNum }).eq('id', target.id);
      await supabase.from('transactions').insert({
        asset_id: target.id, type: 'ADJUST',
        shares: 0, price: 0, total_amount: priceNum,
        trans_date: new Date().toISOString(),
      });
    } else {
      // BUY or SELL
      const totalAmount = isInvestment ? sharesNum * priceNum / leverageNum : priceNum;
      await supabase.from('transactions').insert({
        asset_id: target.id,
        type: action.type,
        shares: sharesNum,
        price: isInvestment ? priceNum : 0,
        total_amount: totalAmount,
        trans_date: new Date().toISOString(),
      });

      // Non-investment: update current_amount manually (trigger handles investment)
      if (!isInvestment) {
        const cur = parseFloat(target.current_amount) || 0;
        const newAmt = action.type === 'BUY'
          ? cur + priceNum
          : Math.max(0, cur - priceNum);
        await supabase.from('assets').update({ current_amount: newAmt }).eq('id', target.id);
      }
    }

    await supabase.rpc('create_daily_snapshot', { p_user_id: user.id });
    await AsyncStorage.setItem('@wt_needs_refresh', '1');
  };

  const handleConfirmAction = async (idx) => {
    const action = messages[idx]?.action;
    if (!action) return;
    // Mark loading by index (stable reference)
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, actionConfirmed: 'loading' } : m));
    try {
      await executeAction(action);
      setMessages(prev => {
        const updated = prev.map((m, i) => i === idx ? { ...m, actionConfirmed: true } : m);
        saveMessages(updated);
        return updated;
      });
    } catch (e) {
      setMessages(prev => {
        const updated = prev.map((m, i) =>
          i === idx ? { ...m, actionConfirmed: false, actionError: e.message } : m
        );
        return updated;
      });
    }
  };

  const handleCancelAction = (idx) => {
    setMessages(prev => {
      const updated = prev.map((m, i) => i === idx ? { ...m, actionConfirmed: false } : m);
      saveMessages(updated);
      return updated;
    });
  };

  const clearChat = async () => {
    setMessages([]);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) await supabase.from('ai_messages').delete().eq('user_id', user.id);
    } catch (e) {
      console.warn('clearChat delete:', e.message);
    }
  };

  // ── Voice recording ────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        alert('需要麥克風權限才能使用語音輸入');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(rec);
    } catch (e) {
      console.warn('startRecording error:', e.message);
      alert('無法啟動錄音，請確認麥克風權限');
    }
  };

  const stopAndTranscribe = async () => {
    if (!recording) return;
    setTranscribing(true);
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      setRecording(null);

      // Read file as base64
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });

      // Detect mime type from URI extension (expo default is .m4a/caf on iOS, .3gp on Android)
      const ext = uri.split('.').pop()?.toLowerCase();
      const mimeMap = { m4a: 'audio/m4a', caf: 'audio/x-caf', '3gp': 'audio/3gpp', mp4: 'audio/mp4', wav: 'audio/wav' };
      const mimeType = mimeMap[ext] || 'audio/m4a';

      const transcribed = await transcribeAudio(base64, mimeType);
      if (transcribed) setInputText(transcribed);
    } catch (e) {
      console.warn('stopAndTranscribe error:', e.message);
      alert(`語音辨識失敗：${e.message}`);
    } finally {
      setTranscribing(false);
    }
  };

  const handleMicPress = () => {
    if (transcribing) return;
    if (recording) {
      stopAndTranscribe();
    } else {
      startRecording();
    }
  };

  const C = {
    bg:      isDark ? '#0F1117' : colors.bg,
    card:    isDark ? '#1E2436' : colors.card,
    border:  isDark ? '#2D3451' : '#e2e8f0',
    text:    isDark ? '#fff'    : colors.text,
    sub:     isDark ? '#94a3b8' : colors.textSub,
    muted:   isDark ? '#475569' : colors.textMuted,
    input:   isDark ? '#1e293b' : '#f8fafc',
  };

  const isEmpty = messages.length === 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg, marginBottom: tabBarHeight }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.border, paddingTop: insets.top + 8 }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.headerIcon, { backgroundColor: isDark ? '#1e3a2f' : '#f0fdf4' }]}>
            <Bot size={20} color={PRIMARY} />
          </View>
          <View>
            <Text style={[styles.headerTitle, { color: C.text }]}>AI 助理</Text>
            <Text style={[styles.headerSub, { color: C.sub }]}>
              {loadingCtx ? '載入資產中…' : ctxError ? '⚠️ 資產資料不完整' : '資產組合已載入'}
            </Text>
          </View>
        </View>
        {messages.length > 0 && (
          <TouchableOpacity onPress={clearChat} style={[styles.clearBtn, { backgroundColor: isDark ? '#334155' : '#f1f5f9' }]}>
            <RefreshCw size={15} color={C.sub} />
            <Text style={{ color: C.sub, fontSize: 12, fontWeight: '600' }}>清除</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Messages area ─────────────────────────────────────────────────── */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16 }}
        onContentSizeChange={() => {
          if (!isEmpty) scrollRef.current?.scrollToEnd({ animated: false });
        }}
        onScroll={({ nativeEvent }) => {
          const { contentOffset, layoutMeasurement, contentSize } = nativeEvent;
          setShowScroll(contentSize.height - contentOffset.y - layoutMeasurement.height > 80);
        }}
        scrollEventThrottle={100}
        keyboardShouldPersistTaps="handled"
      >
        {/* Welcome / empty state */}
        {isEmpty && (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: isDark ? '#1e3a2f' : '#f0fdf4' }]}>
              <Bot size={40} color={PRIMARY} />
            </View>
            <Text style={[styles.emptyTitle, { color: C.text }]}>WealthTracker AI</Text>
            <Text style={[styles.emptySub, { color: C.sub }]}>
              問我任何關於你資產組合的問題{'\n'}或選擇下方的快速分析
            </Text>

            {loadingCtx ? (
              <ActivityIndicator color={PRIMARY} style={{ marginTop: 20 }} />
            ) : (
              <View style={styles.quickGrid}>
                {QUICK_QUESTIONS.map((q, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.quickChip, { backgroundColor: C.card, borderColor: C.border }]}
                    onPress={() => sendMessage(q.text)}
                    activeOpacity={0.75}
                  >
                    <Text style={{ color: C.text, fontSize: 13, fontWeight: '500' }}>{q.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Message bubbles */}
        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            msg={msg}
            msgIdx={i}
            colors={colors}
            isDark={isDark}
            onConfirmAction={handleConfirmAction}
            onCancelAction={handleCancelAction}
          />
        ))}

        {/* Typing indicator */}
        {isThinking && (
          <View style={[styles.bubbleRow, styles.bubbleRowAI]}>
            <View style={[styles.avatar, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]}>
              <Bot size={14} color={PRIMARY} />
            </View>
            <View style={[styles.bubble, styles.bubbleAI, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9' }]}>
              <TypingDots color={PRIMARY} />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Scroll-to-bottom button */}
      {showScroll && !isEmpty && (
        <TouchableOpacity
          onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
          style={[styles.scrollDownBtn, { backgroundColor: C.card, borderColor: C.border }]}
        >
          <ChevronDown size={18} color={C.sub} />
        </TouchableOpacity>
      )}

      {/* ── Input bar ─────────────────────────────────────────────────────── */}
      <View style={[styles.inputBar, {
        backgroundColor: C.card,
        borderTopColor: C.border,
        paddingBottom: 12,
      }]}>
        {/* Quick chips after first message */}
        {!isEmpty && !isThinking && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 10 }}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}
          >
            {QUICK_QUESTIONS.map((q, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.miniChip, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', borderColor: C.border }]}
                onPress={() => sendMessage(q.text)}
                activeOpacity={0.75}
              >
                <Text style={{ color: C.sub, fontSize: 12 }}>{q.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Recording status banner */}
        {(recording || transcribing) && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: recording ? `${RED}22` : `${PRIMARY}22`,
            borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
            marginBottom: 8,
          }}>
            <ActivityIndicator size="small" color={recording ? RED : PRIMARY} />
            <Text style={{ color: recording ? RED : PRIMARY, fontSize: 13, fontWeight: '600' }}>
              {recording ? '錄音中⋯ 再次點擊麥克風停止' : '語音辨識中⋯'}
            </Text>
          </View>
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, {
              backgroundColor: C.input,
              color: C.text,
              borderColor: C.border,
            }]}
            placeholder="問我關於你的資產…"
            placeholderTextColor={C.muted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            onSubmitEditing={() => sendMessage()}
            editable={!isThinking && !recording && !transcribing}
          />

          {/* Mic button */}
          <TouchableOpacity
            style={[styles.sendBtn, {
              backgroundColor: recording
                ? RED
                : transcribing
                  ? (isDark ? '#334155' : '#e2e8f0')
                  : (isDark ? '#334155' : '#e2e8f0'),
            }]}
            onPress={handleMicPress}
            disabled={isThinking || transcribing}
            activeOpacity={0.8}
          >
            {transcribing
              ? <ActivityIndicator size="small" color={PRIMARY} />
              : recording
                ? <MicOff size={18} color="#fff" />
                : <Mic size={18} color={C.muted} />
            }
          </TouchableOpacity>

          {/* Send button */}
          <TouchableOpacity
            style={[styles.sendBtn, {
              backgroundColor: inputText.trim() && !isThinking && !recording ? PRIMARY : (isDark ? '#334155' : '#e2e8f0'),
            }]}
            onPress={() => sendMessage()}
            disabled={!inputText.trim() || isThinking || !!recording}
            activeOpacity={0.8}
          >
            {isThinking
              ? <ActivityIndicator size="small" color="#fff" />
              : <Send size={18} color={inputText.trim() && !recording ? '#fff' : C.muted} />
            }
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 3,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon:  { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerSub:   { fontSize: 11, marginTop: 1 },
  clearBtn:    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },

  emptyState:  { alignItems: 'center', paddingTop: 40, paddingBottom: 20 },
  emptyIcon:   { width: 72, height: 72, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle:  { fontSize: 22, fontWeight: '800', marginBottom: 8 },
  emptySub:    { fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 28 },

  quickGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', maxWidth: 360 },
  quickChip:   {
    borderWidth: 1, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 10,
    minWidth: '44%',
  },

  bubbleRow:     { flexDirection: 'row', marginBottom: 14, alignItems: 'flex-end', gap: 8 },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowAI:   { justifyContent: 'flex-start' },
  avatar:        { width: 28, height: 28, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  bubble:        { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser:    { borderBottomRightRadius: 4 },
  bubbleAI:      { borderBottomLeftRadius: 4 },

  scrollDownBtn: {
    position: 'absolute', bottom: 120, right: 20,
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 1, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 6, elevation: 4,
  },

  inputBar: {
    paddingTop: 12, paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  input: {
    flex: 1, borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 14, maxHeight: 100,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },

  miniChip: {
    borderWidth: 1, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6,
  },
});
