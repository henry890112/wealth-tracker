// AI requests are executed by an authenticated Supabase Edge Function so
// provider credentials never ship in the Expo or web bundle.
import { supabase } from '../lib/supabase';

// ── Clean AI response — strip thinking blocks ─────────────────────────────
function cleanResponse(text) {
  if (!text) return '';
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  return text.trim();
}

function extractTaggedJson(content, tagName) {
  const match = content.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  if (!match) return { content, value: null };

  let value = null;
  try { value = JSON.parse(match[1].trim()); } catch {}
  return {
    content: content.replace(new RegExp(`<${tagName}>[\\s\\S]*?<\\/${tagName}>`, 'gi'), '').trim(),
    value,
  };
}

function normalizeChart(chart) {
  if (!chart || !Array.isArray(chart.labels) || !Array.isArray(chart.values)) return null;
  const pairs = chart.labels
    .map((label, index) => ({ label: String(label || '').slice(0, 12), value: Number(chart.values[index]) }))
    .filter(item => item.label && Number.isFinite(item.value) && item.value >= 0)
    .slice(0, 6);
  if (pairs.length < 2) return null;
  return {
    type: chart.type === 'pie' ? 'pie' : 'bar',
    title: String(chart.title || '資產視覺摘要').slice(0, 28),
    unit: String(chart.unit || '').slice(0, 10),
    labels: pairs.map(item => item.label),
    values: pairs.map(item => item.value),
  };
}

async function invokeAIBackend(body) {
  const { data, error } = await supabase.functions.invoke('ai-chat', { body });
  if (error) {
    const message = String(error.message || 'AI 後端暫時無法回應');
    if (/401|unauthorized|jwt/i.test(message)) throw new Error('登入已失效，請重新登入後再試。');
    throw new Error('AI 後端暫時無法回應，請稍後再試。');
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}

// ── Build system prompt from portfolio context ────────────────────────────
function buildSystemPrompt(ctx) {
  const cur = ctx.currency || 'TWD';
  const fmt = (v) => Math.round(v).toLocaleString('zh-TW');
  const lines = [
    '你是「WealthTracker AI」，一個專業的個人資產組合分析助理。',
    '請用繁體中文回答，語氣專業但親切。回答要簡潔有條理，適當使用分點說明。',
    '不要說「根據您提供的資料」等廢話，直接切入重點。',
    '【輸出格式】請使用手機友善 Markdown：以 ## 寫短標題、**粗體**標示關鍵結論，並使用 - 製作清單。',
    '只有在用戶明確要求「表格」或資料比較非常適合時，才使用 Markdown 表格；最多 3 欄、欄位名稱要短，避免程式碼區塊。段落之間留一行空白，最多使用 3 個 ## 標題。',
    '【重要資料規定】只能引用下方「用戶資產快照」中明確列出的數字，絕對不可自行捏造或推算任何金額、百分比或數字。',
    '',
    '════ 用戶資產快照 ════',
  ];

  if (ctx.netWorth != null) {
    lines.push(`淨資產：${fmt(ctx.netWorth)} ${cur}`);
  }
  if (ctx.monthlyChange != null) {
    const sign = ctx.monthlyChange >= 0 ? '+' : '';
    lines.push(`本月變動：${sign}${fmt(ctx.monthlyChange)} ${cur}`);
  }

  const nonLiab = (ctx.assets || []).filter(a => a.category !== 'liability');
  const liabs   = (ctx.assets || []).filter(a => a.category === 'liability');

  if (nonLiab.length > 0) {
    lines.push('');
    lines.push('【資產明細】');
    const CATEGORY_LABELS = {
      liquid: '流動資產', investment: '投資資產',
      fixed: '固定資產', receivable: '應收款項',
    };
    nonLiab.forEach(a => {
      let line = `• ${a.name}（${CATEGORY_LABELS[a.category] || a.category}）`;
      line += `  ${fmt(a.converted_amount || 0)} ${cur}`;
      if (a.category === 'investment' && a.current_shares > 0) {
        line += `  持有 ${Number(a.current_shares).toLocaleString('zh-TW', { maximumFractionDigits: 4 })} 股`;
        if (Number(a.average_cost) > 0) line += `  平均成本 ${Number(a.average_cost).toFixed(2)} ${a.currency || cur}`;
      }
      if (a.pnl_pct != null) {
        const sign = a.pnl_pct >= 0 ? '+' : '';
        line += `  損益 ${sign}${Number(a.pnl_pct).toFixed(1)}%`;
      }
      if (a.market_type) line += `  [${a.market_type}]`;
      lines.push(line);
    });
  }

  if (liabs.length > 0) {
    lines.push('');
    lines.push('【負債】');
    liabs.forEach(a => {
      lines.push(`• ${a.name}  ${fmt(a.converted_amount || 0)} ${cur}`);
    });
  }

  if (ctx.monthlyBreakdown?.length > 0) {
    lines.push('');
    lines.push('【近期月度績效】');
    ctx.monthlyBreakdown.slice(-6).forEach(m => {
      const sign = m.change >= 0 ? '+' : '';
      lines.push(`• ${m.label}：${sign}${m.pct.toFixed(1)}%  (${sign}${fmt(m.change)} ${cur})`);
    });
  }

  if (ctx.fixedExpensesMonthly != null) {
    lines.push('');
    lines.push(`每月固定支出：${fmt(ctx.fixedExpensesMonthly)} ${cur}`);
  }

  if (ctx.researchSignals?.length > 0) {
    lines.push('');
    lines.push('【最新台股研究訊號（僅目前持倉）】');
    lines.push(`資料日期：${ctx.researchSignalDate || '—'}；70 分以上僅代表值得進一步研究，不是買進建議。`);
    ctx.researchSignals.forEach(signal => {
      const metrics = signal.metrics || {};
      lines.push(`• ${signal.name}（${signal.symbol}）：${Number(signal.score || 0).toFixed(0)} 分，${signal.is_candidate ? '值得研究' : '尚未符合'}`);
      if (signal.reasons?.length) lines.push(`  已符合：${signal.reasons.join('；')}`);
      if (signal.risk_flags?.length) lines.push(`  未符合或風險：${signal.risk_flags.join('；')}`);
      const metricParts = [];
      if (metrics.per != null && Number.isFinite(Number(metrics.per))) metricParts.push(`本益比 ${Number(metrics.per).toFixed(2)}`);
      if (metrics.per_p25 != null && Number.isFinite(Number(metrics.per_p25))) metricParts.push(`近三年 PER 25% ${Number(metrics.per_p25).toFixed(2)}`);
      if (metrics.close != null && Number.isFinite(Number(metrics.close))) metricParts.push(`收盤 ${Number(metrics.close).toFixed(2)}`);
      if (metricParts.length) lines.push(`  指標：${metricParts.join('；')}`);
    });
  }
  if (ctx.researchMissingHoldings?.length > 0) {
    lines.push(`同日研究訊號尚未涵蓋：${ctx.researchMissingHoldings.map(item => `${item.name}（${item.symbol}）`).join('、')}。這代表資料缺口，不代表不符合條件。`);
  }

  lines.push('');
  lines.push('════════════════════');
  lines.push('請基於以上資料回答用戶問題。');
  lines.push('對持倉提出建議時，請區分「已知事實」、「值得觀察」與「下一步」，不要直接下買進或賣出指令，也不要以研究分數單獨決定進出場。');
  lines.push('若問題與財務或投資無直接關聯，仍可提供理財建議與知識。');
  lines.push('若問題涉及最新新聞、即時行情、近期事件或明確要求搜尋，請使用網路搜尋工具，並只根據搜尋結果回答。');
  lines.push('當用戶要求圖表、視覺化、配置比較或趨勢摘要，而且快照中有足夠數據時，在文字回答後加上一個 <chart> JSON 標籤。');
  lines.push('格式：<chart>{"type":"pie","title":"資產配置","unit":"TWD","labels":["投資","現金"],"values":[120000,80000]}</chart>');
  lines.push('圖表 labels 和 values 必須一一對應、最多 6 組，且所有數字都必須直接來自快照，不得估算或捏造。');
  lines.push('');
  lines.push('【自然語言操作】');
  lines.push('若用戶明確要求執行交易操作（買入/賣出/調整某資產），在回答文字的最後附上一個 <action> 標籤，格式如下：');
  lines.push('<action>{"type":"BUY","symbol":"QCOM","assetName":"Qualcomm","marketType":"US","shares":100,"price":160.5,"currency":"USD"}</action>');
  lines.push('支援的 type：BUY（買入）、SELL（賣出）、ADJUST（直接調整金額，此時 shares=0，price=新金額）。');
  lines.push('marketType 填入：US（美股）、TW（台股，symbol 為純數字）、Crypto（加密貨幣）、other（其他）。');
  lines.push('currency：美股填 USD，台股填 TWD，加密貨幣填 USD，其他依實際幣別。');
  lines.push('若資產在「資產明細」中已有，symbol 和 assetName 須與快照一致；若是全新資產，照用戶指定的填入。');
  lines.push('若用戶的資訊不完整（缺少價格、股數等），請先用文字詢問，不要輸出 <action>。');
  lines.push('若用戶只是詢問、分析或閒聊，絕對不要輸出 <action>。');

  return lines.join('\n');
}

// ── Main AI call ──────────────────────────────────────────────────────────
export async function askAI(messages, portfolioContext = {}) {
  const systemPrompt = buildSystemPrompt(portfolioContext);
  const result = await invokeAIBackend({
    mode: 'generate',
    systemPrompt,
    messages: messages.map(message => ({ role: message.role, content: message.content })),
    enableSearch: true,
    maxTokens: 4096,
    temperature: 0.65,
  });
  let content = cleanResponse(result.content);
  if (!content) throw new Error('AI 回應內容為空，請稍後再試。');
  const actionResult = extractTaggedJson(content, 'action');
  content = actionResult.content;
  const chartResult = extractTaggedJson(content, 'chart');
  return {
    content: chartResult.content,
    model: result.model || 'AI',
    action: actionResult.value,
    chart: normalizeChart(chartResult.value),
    sources: Array.isArray(result.sources) ? result.sources : [],
  };
}

// ── Single-asset AI analysis (news + technicals) ──────────────────────────
export async function analyzeAsset({ name, symbol, marketType, currentPrice, pnlPct, currency, technicals, news }) {
  const newsBlock = news?.length > 0
    ? news.map((n, i) =>
        `${i + 1}. [${n.publishedAt}] ${n.title}${n.summary ? ' — ' + n.summary.slice(0, 120) : ''}`
      ).join('\n')
    : '（無最新新聞）';

  const techBlock = technicals || '（無技術指標資料）';
  const pnlLine   = pnlPct != null
    ? `目前損益：${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`
    : '';

  const systemPrompt = [
    '你是一位專業的投資分析師，請用繁體中文回答，語氣簡潔直接。',
    '【格式規定】請使用手機友善 Markdown：用 ## 放短標題、**粗體**標示結論、以 - 製作清單。',
    '只有在用戶明確要求表格時才使用 Markdown 表格，最多 3 欄；禁止程式碼區塊與過長標題，段落之間留一行空白。',
    '回答長度控制在 200 字以內，聚焦最重要的觀察。',
    '只能引用以下提供的數字，不可自行編造任何數據。',
    '',
    `分析標的：${name}（${symbol}，${marketType} 市場）`,
    currentPrice ? `目前價格：${currentPrice.toFixed(2)} ${currency}` : '',
    pnlLine,
    '',
    '════ 技術指標 ════',
    techBlock,
    '',
    '════ 近期新聞 ════',
    newsBlock,
    '',
    '════════════════════',
    '請給出：① 技術面（多/空/中性）+ 關鍵依據，② 新聞情緒（正面/負面/中性）+ 一句摘要，③ 一句話結論。',
  ].filter(Boolean).join('\n');

  const result = await invokeAIBackend({
    mode: 'generate',
    systemPrompt,
    messages: [{ role: 'user', content: `請分析 ${name}（${symbol}）的近況。` }],
    enableSearch: false,
    maxTokens: 2048,
    temperature: 0.5,
  });
  const content = cleanResponse(result.content);
  if (!content) throw new Error('AI 回應內容為空，請稍後再試。');
  return content;
}

// ── Transcribe audio via Gemini multimodal ────────────────────────────────
export async function transcribeAudio(base64Audio, mimeType = 'audio/m4a') {
  const result = await invokeAIBackend({ mode: 'transcribe', base64Audio, mimeType });
  const text = cleanResponse(result.content);
  if (!text) throw new Error('語音辨識失敗，請重試');
  return text;
}
