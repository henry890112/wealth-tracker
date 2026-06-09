// Google Gemini AI service for WealthTracker
const GEMINI_API_KEY =
  process.env.EXPO_PUBLIC_GEMINI_API_KEY ||
  'AIzaSyD4w0DX2juMpKoPBj-vUStsjmhfxnb1KX4';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// Models tried in order — first one that responds wins
const MODELS = [
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3-flash-preview',
  'gemini-2.0-flash',
];

// ── Clean AI response — strip thinking blocks ─────────────────────────────
function cleanResponse(text) {
  if (!text) return '';
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  return text.trim();
}

// ── Build system prompt from portfolio context ────────────────────────────
function buildSystemPrompt(ctx) {
  const cur = ctx.currency || 'TWD';
  const fmt = (v) => Math.round(v).toLocaleString('zh-TW');
  const lines = [
    '你是「WealthTracker AI」，一個專業的個人資產組合分析助理。',
    '請用繁體中文回答，語氣專業但親切。回答要簡潔有條理，適當使用分點說明。',
    '不要說「根據您提供的資料」等廢話，直接切入重點。',
    '【重要格式規定】禁止使用任何 Markdown 語法，包括 ###、##、**、*、- 等符號。',
    '禁止使用表格（table）格式，禁止用 | 或 — 畫表格或分隔線。',
    '用「一、二、三」或「①②③」或「▸」來做列表，用純文字段落分隔內容。',
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

  lines.push('');
  lines.push('════════════════════');
  lines.push('請基於以上資料回答用戶問題。');
  lines.push('若問題與財務或投資無直接關聯，仍可提供理財建議與知識。');
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

// ── Convert OpenAI-style messages to Gemini contents format ──────────────
function toGeminiContents(messages) {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
}

// ── Main AI call ──────────────────────────────────────────────────────────
export async function askAI(messages, portfolioContext = {}) {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key 未設定');

  const systemPrompt = buildSystemPrompt(portfolioContext);
  const contents     = toGeminiContents(messages);
  const lastErrors   = [];

  for (const model of MODELS) {
    try {
      const res = await fetch(
        `${BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              maxOutputTokens: 4096,
              temperature: 0.65,
            },
          }),
        }
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data.error?.message || `HTTP ${res.status}`;
        console.warn(`[AI] ${model} failed (${res.status}): ${msg}`);
        lastErrors.push(`${model}: ${res.status}`);
        if (res.status === 429) {
          await new Promise(r => setTimeout(r, 3000)); // wait 3s before next model
        }
        continue;
      }

      const raw     = data.candidates?.[0]?.content?.parts?.[0]?.text;
      let content   = cleanResponse(raw);
      if (!content) {
        console.warn('[AI] empty content from', model, JSON.stringify(data).slice(0, 200));
        lastErrors.push(`${model}: 回應內容為空`);
        continue;
      }

      // Extract <action> JSON block if present
      let action = null;
      const actionMatch = content.match(/<action>([\s\S]*?)<\/action>/i);
      if (actionMatch) {
        try { action = JSON.parse(actionMatch[1].trim()); } catch {}
        content = content.replace(/<action>[\s\S]*?<\/action>/gi, '').trim();
      }

      console.log(`[AI] responded via ${model}${action ? ' [action:' + action.type + ']' : ''}`);
      return { content, model, action };
    } catch (e) {
      if (e.message?.includes('fetch') || e.message?.includes('network')) {
        throw new Error('無法連線，請檢查網路');
      }
      console.warn(`[AI] ${model} error:`, e.message);
      lastErrors.push(`${model}: ${e.message}`);
    }
  }

  const detail = lastErrors.slice(-3).join(' | ');
  throw new Error(`所有模型均無回應\n${detail}`);
}

// ── Single-asset AI analysis (news + technicals) ──────────────────────────
export async function analyzeAsset({ name, symbol, marketType, currentPrice, pnlPct, currency, technicals, news }) {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key 未設定');

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
    '【格式規定】禁止使用 Markdown（###、**、- 等），禁止表格，禁止分隔線。',
    '用「一、二、三」或「▸」列點，純文字段落分隔。',
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

  const contents = [
    { role: 'user', parts: [{ text: `請分析 ${name}（${symbol}）的近況。` }] },
  ];

  const lastErrors = [];
  for (const model of MODELS) {
    try {
      const res = await fetch(
        `${BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: { maxOutputTokens: 2048, temperature: 0.5 },
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastErrors.push(`${model}: ${res.status}`);
        if (res.status === 429) await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      const raw     = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const content = cleanResponse(raw);
      if (!content) { lastErrors.push(`${model}: 空回應`); continue; }
      return content;
    } catch (e) {
      lastErrors.push(`${model}: ${e.message}`);
    }
  }
  throw new Error(`分析失敗：${lastErrors.slice(-2).join(' | ')}`);
}

// ── Transcribe audio via Gemini multimodal ────────────────────────────────
export async function transcribeAudio(base64Audio, mimeType = 'audio/m4a') {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key 未設定');

  // Multimodal audio works on 2.5-flash and 2.0-flash
  const audioModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];

  for (const model of audioModels) {
    try {
      const res = await fetch(
        `${BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { text: '請將以下音訊轉錄成繁體中文文字。只輸出轉錄的文字內容，不要任何說明、前綴或解釋。' },
                { inline_data: { mime_type: mimeType, data: base64Audio } },
              ],
            }],
            generationConfig: { maxOutputTokens: 500, temperature: 0 },
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn(`[Transcribe] ${model} failed (${res.status})`);
        continue;
      }
      const text = cleanResponse(data.candidates?.[0]?.content?.parts?.[0]?.text);
      if (text) return text;
    } catch (e) {
      console.warn(`[Transcribe] ${model} error:`, e.message);
    }
  }
  throw new Error('語音辨識失敗，請重試');
}
