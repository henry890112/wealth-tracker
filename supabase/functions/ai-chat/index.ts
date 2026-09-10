import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.1";

type ChatMessage = { role: "user" | "assistant"; content: string };
type GeminiPart = { text?: string; inline_data?: { mime_type: string; data: string } };

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
const OPENROUTER_MODELS = ["google/gemini-2.5-flash", "openai/gpt-4o-mini"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const clean = (value: unknown) => String(value || "")
  .replace(/<think>[\s\S]*?<\/think>/gi, "")
  .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
  .trim();

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-60).map(message => {
    const item = message && typeof message === "object" ? message as Record<string, unknown> : {};
    return {
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || "").slice(0, 50_000),
    } as ChatMessage;
  }).filter(message => message.content.trim());
}

function geminiText(data: Record<string, unknown>) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const candidate = (candidates[0] || {}) as Record<string, unknown>;
  const content = (candidate.content || {}) as Record<string, unknown>;
  const parts = Array.isArray(content.parts) ? content.parts as GeminiPart[] : [];
  return clean(parts.map(part => part.text || "").join(""));
}

function extractSources(data: Record<string, unknown>) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const candidate = (candidates[0] || {}) as Record<string, unknown>;
  const metadata = (candidate.groundingMetadata || candidate.grounding_metadata || {}) as Record<string, unknown>;
  const chunks = (metadata.groundingChunks || metadata.grounding_chunks || []) as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  return chunks.flatMap(chunk => {
    const web = (chunk.web || chunk.webSearchResult) as Record<string, unknown> | undefined;
    const uri = String(web?.uri || "");
    if (!uri || seen.has(uri)) return [];
    seen.add(uri);
    let fallbackTitle = uri;
    try { fallbackTitle = new URL(uri).hostname; } catch { /* keep URI */ }
    return [{ title: String(web?.title || fallbackTitle), uri }];
  }).slice(0, 4);
}

async function callGemini(options: {
  apiKey: string;
  systemPrompt?: string;
  contents: Array<{ role: string; parts: GeminiPart[] }>;
  enableSearch: boolean;
  maxTokens: number;
  temperature: number;
}) {
  const errors: string[] = [];
  for (const model of GEMINI_MODELS) {
    try {
      const body: Record<string, unknown> = {
        contents: options.contents,
        generationConfig: { maxOutputTokens: options.maxTokens, temperature: options.temperature },
      };
      if (options.systemPrompt) body.system_instruction = { parts: [{ text: options.systemPrompt }] };
      if (options.enableSearch) body.tools = [{ google_search: {} }];
      const response = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(options.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        errors.push(`${model}: ${response.status}`);
        console.warn("ai-chat Gemini", model, response.status);
        if (response.status === 429) await sleep(750);
        continue;
      }
      const content = geminiText(data);
      if (content) return { content, model, sources: extractSources(data), errors };
      errors.push(`${model}: empty`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      errors.push(`${model}: ${message}`);
      console.warn("ai-chat Gemini", model, message);
    }
  }
  return { content: "", model: "", sources: [], errors };
}

async function callOpenRouter(apiKey: string, systemPrompt: string, messages: ChatMessage[], maxTokens: number, temperature: number) {
  if (!apiKey) return null;
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      models: OPENROUTER_MODELS,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: maxTokens,
      temperature,
    }),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const choice = (choices[0] || {}) as Record<string, unknown>;
  const message = (choice.message || {}) as Record<string, unknown>;
  const content = clean(message.content);
  if (!content) throw new Error("OpenRouter empty response");
  return { content, model: String(data.model || "OpenRouter"), sources: [] };
}

async function authenticate(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !anonKey) throw new Error("Supabase environment unavailable");
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  return error ? null : user;
}

function publicError(errors: string[]) {
  if (errors.some(error => error.includes(": 429"))) return "AI 服務目前繁忙，請稍後再試。";
  if (errors.some(error => /: (401|403)/.test(error))) return "AI 服務金鑰設定有誤，請聯絡管理者。";
  return "AI 服務暫時無法回應，請稍後再試。";
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!await authenticate(req)) return json({ error: "Unauthorized" }, 401);
    const payload = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload) return json({ error: "請求格式錯誤。" }, 400);
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";
    if (!geminiKey) return json({ error: "AI 後端尚未設定 Gemini 金鑰。" });

    if (payload.mode === "transcribe") {
      const base64Audio = String(payload.base64Audio || "");
      const mimeType = String(payload.mimeType || "audio/m4a").slice(0, 80);
      if (!base64Audio || base64Audio.length > 12_000_000) return json({ error: "音訊內容為空或檔案過大。" }, 400);
      const result = await callGemini({
        apiKey: geminiKey,
        contents: [{ role: "user", parts: [
          { text: "請將以下音訊轉錄成繁體中文文字。只輸出轉錄的文字內容，不要任何說明、前綴或解釋。" },
          { inline_data: { mime_type: mimeType, data: base64Audio } },
        ] }],
        enableSearch: false,
        maxTokens: 500,
        temperature: 0,
      });
      return result.content ? json({ content: result.content, model: result.model, sources: [] }) : json({ error: "語音辨識失敗，請重試。" });
    }

    if (payload.mode !== "generate") return json({ error: "不支援的 AI 操作。" }, 400);
    const systemPrompt = String(payload.systemPrompt || "").slice(0, 100_000);
    const messages = normalizeMessages(payload.messages);
    if (!systemPrompt || !messages.length) return json({ error: "AI 請求缺少必要內容。" }, 400);
    const maxTokens = Math.min(Math.max(Number(payload.maxTokens) || 2048, 128), 4096);
    const temperature = Math.min(Math.max(Number(payload.temperature) || 0, 0), 1);
    const result = await callGemini({
      apiKey: geminiKey,
      systemPrompt,
      contents: messages.map(message => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
      enableSearch: payload.enableSearch === true,
      maxTokens,
      temperature,
    });
    if (result.content) return json({ content: result.content, model: result.model, sources: result.sources });

    const errors = [...result.errors];
    try {
      const fallback = await callOpenRouter(Deno.env.get("OPENROUTER_API_KEY") || "", systemPrompt, messages, maxTokens, temperature);
      if (fallback) return json(fallback);
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      errors.push(message);
      console.warn("ai-chat OpenRouter", message);
    }
    return json({ error: publicError(errors) });
  } catch (error) {
    console.error("ai-chat", error);
    return json({ error: "AI 後端暫時無法回應，請稍後再試。" });
  }
});
