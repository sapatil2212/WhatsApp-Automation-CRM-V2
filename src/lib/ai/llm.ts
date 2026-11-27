/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared LLM caller with a provider fallback cascade.
 *
 * Provider priority (each provider tries its own model ladder first):
 *   1. Anthropic Claude (ANTHROPIC_API_KEY)
 *   2. Google Gemini    (GEMINI_API_KEY / GEMINI_API_KEY_SECONDARY)
 *   3. OpenRouter       (OPENROUTER_API_KEY) — only when both above fail
 *   4. OPENAI_API_KEY   (legacy; an sk-or-v1- key is routed to OpenRouter)
 *
 * Model tiering keeps token spend down without slowing replies: `basic`
 * work (acknowledgements, one-word answers, extraction, translation) goes to
 * the small fast model; `standard`/`critical` work goes to the capable model,
 * stepping down to the small one if the capable one is unavailable.
 *
 * Every attempt has its own timeout and the whole call has an overall
 * deadline, so a slow provider is abandoned quickly in favour of the next.
 * In JSON mode an answer that does not parse counts as a failure and the
 * cascade moves on — callers never receive half-JSON as "success".
 */

export interface LLMResult {
  text: string;
  success: boolean;
  debugLogs: string[];
  tokensUsed: number;
  /** Which provider/model produced `text` (empty when nothing succeeded). */
  provider?: ProviderName;
  model?: string;
}

export type ProviderName = 'anthropic' | 'gemini' | 'openrouter' | 'openai';

/** One prior turn of a conversation, oldest first. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  /**
   * Routes requests by consequence and complexity. `basic` for short
   * greetings, acknowledgements, extraction and translation; `standard` for
   * normal assistance; `critical` where a wrong answer could cause a
   * compliance, clinical, financial, or approval problem.
   */
  taskCriticality?: 'basic' | 'standard' | 'critical';
  /** Do not send a task to another provider if Gemini is unavailable. */
  geminiOnly?: boolean;
  /** Provider to try first. The cascade still continues after it unless `geminiOnly`. */
  provider?: ProviderName;
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
  /**
   * Prior conversation turns (oldest first). Sent as real chat turns so the
   * model keeps memory of the conversation; `prompt` becomes the final user
   * turn (or is skipped when empty and the history already ends on the user).
   */
  history?: ChatTurn[];
  /** Ask for a strict JSON object response (no prose, no fences). */
  jsonMode?: boolean;
  /** Per-attempt request timeout. Defaults to 45s. */
  timeoutMs?: number;
  /** Overall budget across every provider/model attempt. Defaults to timeoutMs × 3. */
  deadlineMs?: number;
  /**
   * Files sent to Gemini alongside the prompt (images, PDFs, audio). Gemini-only:
   * other providers do not receive them, so attachments imply `geminiOnly`.
   */
  attachments?: Array<{ mimeType: string; data?: string /* base64, inline (up to ~18 MB) */; fileUri?: string /* from uploadGeminiFile, for larger files */ }>;
}

const GEMINI_API = 'https://generativelanguage.googleapis.com';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
/** Gemini rejects requests over ~20 MB, so bigger files go through the File API. */
export const GEMINI_INLINE_MAX_BYTES = 18 * 1024 * 1024;

/** Claude models by tier. Overridable without a deploy via env. */
const CLAUDE_FAST = () => clean(process.env.ANTHROPIC_MODEL_FAST) || 'claude-haiku-5-5';
const CLAUDE_SMART = () => clean(process.env.ANTHROPIC_MODEL_SMART) || 'claude-sonnet-5-5';

function clean(v: string | undefined): string {
  return (v || '').trim().replace(/^["']|["']$/g, '');
}

function geminiKey(): string {
  return clean(process.env.GEMINI_API_KEY) || clean(process.env.GEMINI_API_KEY_SECONDARY);
}

function anthropicKey(): string {
  return clean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Upload a file (up to 2 GB) to the Gemini File API and wait until it is
 * ready. Pass the returned `uri` as an attachment `fileUri`. Files expire on
 * Google's side after 48 h; call `deleteGeminiFile` when done anyway.
 */
export async function uploadGeminiFile(bytes: Buffer, mimeType: string, displayName: string): Promise<{ uri: string; name: string }> {
  const key = geminiKey();
  if (!key) throw new Error('GEMINI_API_KEY is not configured.');
  const start = await fetch(`${GEMINI_API}/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
    signal: AbortSignal.timeout(30_000),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!start.ok || !uploadUrl) throw new Error(`Gemini file upload could not start (${start.status}).`);

  const done = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Length': String(bytes.length), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(180_000),
  });
  if (!done.ok) throw new Error(`Gemini file upload failed (${done.status}).`);
  let file = ((await done.json()) as { file?: { name: string; uri: string; state?: string } }).file;
  if (!file?.uri) throw new Error('Gemini file upload returned no file.');

  // Large PDFs are processed asynchronously; wait until ACTIVE (max ~2 min).
  for (let i = 0; file.state === 'PROCESSING' && i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${GEMINI_API}/v1beta/${file.name}?key=${key}`, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) file = (await res.json()) as typeof file;
  }
  if (file.state === 'FAILED') throw new Error('Gemini could not process this file.');
  if (file.state === 'PROCESSING') throw new Error('Gemini is still processing this file. Please try again in a minute.');
  return { uri: file.uri, name: file.name };
}

/** Best-effort removal of an uploaded file (it would expire after 48 h anyway). */
export async function deleteGeminiFile(name: string): Promise<void> {
  const key = geminiKey();
  if (!key || !name) return;
  await fetch(`${GEMINI_API}/v1beta/${name}?key=${key}`, { method: 'DELETE', signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
}

/**
 * Current Gemini models "think" before answering, and those thinking tokens
 * are billed against `maxOutputTokens`. The headroom below is added on top
 * of the caller's answer budget for Gemini only, so answers are not truncated.
 */
const GEMINI_THINKING_HEADROOM = 6144;

function geminiText(data: any): string {
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => typeof part?.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('')
    .trim();
}

export function hasAnyLLMKey(): boolean {
  return Boolean(
    anthropicKey() ||
      geminiKey() ||
      clean(process.env.OPENROUTER_API_KEY) ||
      clean(process.env.OPENAI_API_KEY),
  );
}

/** Gemini is required by the file/attachment features (Gemini-only tasks). */
export function hasGeminiKey(): boolean {
  return Boolean(geminiKey());
}

export function hasAnthropicKey(): boolean {
  return Boolean(anthropicKey());
}

export type TaskCriticality = NonNullable<CallOptions['taskCriticality']>;

const SIMPLE_REPLY =
  /^(hi+|hello+|hey+|hii|helo|namaste|namaskar|namaskaar|ram ram|jai shree krishna|good (morning|afternoon|evening|night)|thanks?|thank you|thx|ty|ok+|okay|okk|okie|k|got it|fine|done|sure|yes|yeah|yep|ya|haan|ha|han|ho|hoy|nahi|nahin|no|nope|nako|bye|goodbye|see you|theek hai|thik hai|thik ahe|bara|accha|acha|achha|cool|great|nice|perfect|alright|\d{1,3}|[\d\s:./-]{1,12}|[\p{Emoji}\s]+)[!.?\s]*$/iu;
const HIGH_STAKES =
  /(compliance|policy|approval|legal|lawyer|medical|medicine|tablet|dose|dosage|symptom|pain|bleed|fever|pregnan|allerg|emergency|chest|breath|faint|accident|injur|suicid|payment|refund|charged|money back|fraud|scam|complain|complaint|angry|worst|cheat|security|whatsapp template|consumer court)/i;

/**
 * Classifies end-user text so the cheapest adequate model answers it.
 * Short acknowledgements, numbers, yes/no and greetings in any common Indian
 * language use the fast tier; clinical, money and complaint topics use the
 * strongest tier; everything else the capable default.
 */
export function inferTaskCriticality(input: string): TaskCriticality {
  const text = (input || '').trim();
  if (!text) return 'basic';
  if (HIGH_STAKES.test(text)) return 'critical';
  if (text.length <= 40 && SIMPLE_REPLY.test(text)) return 'basic';
  // A short non-question (a name, "tomorrow 5pm", "dental") is routine.
  const words = text.split(/\s+/).length;
  if (words <= 4 && !/[?？]/.test(text) && text.length <= 40) return 'basic';
  return 'standard';
}

function claudeModelsFor(opts?: CallOptions): string[] {
  if (opts?.model && opts.provider === 'anthropic') return [opts.model];
  switch (opts?.taskCriticality ?? 'standard') {
    case 'basic':
      return [CLAUDE_FAST(), CLAUDE_SMART()];
    default:
      return [CLAUDE_SMART(), CLAUDE_FAST()];
  }
}

function geminiModelsFor(opts?: CallOptions): string[] {
  if (opts?.model && (!opts.provider || opts.provider === 'gemini')) return [opts.model];
  switch (opts?.taskCriticality ?? 'standard') {
    case 'basic':
      // The pinned 2.5 models are no longer served to new API keys (404),
      // so only the -latest aliases are used here.
      return ['gemini-flash-lite-latest', 'gemini-flash-latest'];
    case 'critical':
      return ['gemini-pro-latest', 'gemini-flash-latest'];
    default:
      return ['gemini-flash-latest', 'gemini-flash-lite-latest'];
  }
}

function openRouterModelsFor(opts?: CallOptions): string[] {
  if (opts?.model && opts.provider === 'openrouter') return [opts.model];
  const fromEnv = clean(process.env.OPENROUTER_MODELS);
  if (fromEnv) return fromEnv.split(',').map((m) => m.trim()).filter(Boolean);
  // OpenRouter only runs when Anthropic and Gemini both failed, so a
  // different upstream vendor leads; all of these are inexpensive.
  return ['openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'anthropic/claude-haiku-4.5', 'meta-llama/llama-3.3-70b-instruct'];
}

/**
 * Normalises history + prompt into a strictly alternating user/assistant
 * list that starts and ends with a user turn (Anthropic requires this).
 */
export function buildTurns(history: ChatTurn[] | undefined, prompt: string): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const push = (role: ChatTurn['role'], content: string) => {
    const text = (content || '').trim();
    if (!text) return;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n${text}`;
    else turns.push({ role, content: text });
  };
  for (const t of history ?? []) push(t.role, t.content);
  push('user', prompt);
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length) turns.push({ role: 'user', content: prompt || '(no message)' });
  if (turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', content: '(continue)' });
  return turns;
}

const JSON_SUFFIX = '\n\nRespond with ONLY one valid JSON object. No markdown fences, no text before or after it.';

interface Attempt {
  text: string;
  tokens: number;
  truncated: boolean;
}

type AttemptFn = (model: string, timeoutMs: number) => Promise<Attempt>;

class HttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`${status}: ${body.slice(0, 300)}`);
  }
}

/**
 * Current Claude models think briefly before answering (~130 tokens on a
 * short chat reply) and those tokens count against `max_tokens`; Indic
 * scripts also use several tokens per word. Headroom on top of the caller's
 * answer budget prevents truncated replies; only used tokens are billed.
 */
const ANTHROPIC_HEADROOM = 1536;

async function anthropicAttempt(system: string, turns: ChatTurn[], o: { maxTokens: number; key: string }, model: string, timeoutMs: number): Promise<Attempt> {
  // No `temperature`: it is deprecated for current Claude models (400).
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': o.key,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      max_tokens: o.maxTokens + ANTHROPIC_HEADROOM,
      // Cache the (large, slowly changing) system prompt across messages of a chat.
      ...(system ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}),
      messages: turns.map((t) => ({ role: t.role, content: t.content })),
    }),
  });
  if (!res.ok) throw new HttpError(res.status, await res.text());
  const data: any = await res.json();
  const text = (Array.isArray(data?.content) ? data.content : [])
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('')
    .trim();
  const u = data?.usage ?? {};
  const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  return { text, tokens, truncated: data?.stop_reason === 'max_tokens' };
}

async function geminiAttempt(
  system: string,
  turns: ChatTurn[],
  o: { maxTokens: number; temperature: number; key: string; jsonMode?: boolean; attachments?: CallOptions['attachments'] },
  model: string,
  timeoutMs: number,
): Promise<Attempt> {
  const contents = turns.map((t, i) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [
      // Attachments ride on the final user turn.
      ...(i === turns.length - 1
        ? (o.attachments ?? []).map((a) => (a.fileUri ? { fileData: { mimeType: a.mimeType, fileUri: a.fileUri } } : { inlineData: { mimeType: a.mimeType, data: a.data } }))
        : []),
      { text: t.content },
    ],
  }));
  const res = await fetch(`${GEMINI_API}/v1beta/models/${model}:generateContent?key=${o.key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: {
        temperature: o.temperature,
        maxOutputTokens: o.maxTokens + GEMINI_THINKING_HEADROOM,
        ...(o.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  if (!res.ok) throw new HttpError(res.status, await res.text());
  const data: any = await res.json();
  const finish = data?.candidates?.[0]?.finishReason;
  const text = geminiText(data);
  if (!text) throw new Error(`empty response (${finish ?? data?.promptFeedback?.blockReason ?? 'unknown'})`);
  return { text, tokens: data?.usageMetadata?.totalTokenCount ?? 0, truncated: finish === 'MAX_TOKENS' };
}

async function chatCompletionsAttempt(
  endpoint: string,
  key: string,
  system: string,
  turns: ChatTurn[],
  o: { maxTokens: number; temperature: number; jsonMode?: boolean },
  model: string,
  timeoutMs: number,
): Promise<Attempt> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  if (endpoint === OPENROUTER_API) {
    headers['HTTP-Referer'] = clean(process.env.NEXT_PUBLIC_APP_URL) || 'http://localhost:3000';
    headers['X-Title'] = 'WhatsApp CRM';
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...turns],
      temperature: o.temperature,
      max_tokens: o.maxTokens,
    }),
  });
  if (!res.ok) throw new HttpError(res.status, await res.text());
  const data: any = await res.json();
  const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new Error('empty response');
  return { text, tokens: data?.usage?.total_tokens ?? 0, truncated: data?.choices?.[0]?.finish_reason === 'length' };
}

export async function callLLM(prompt: string, opts?: CallOptions): Promise<LLMResult> {
  const maxTokens = opts?.maxTokens ?? 2048;
  const temperature = opts?.temperature ?? 0.15;
  const perAttempt = opts?.timeoutMs ?? 45_000;
  const deadline = Date.now() + (opts?.deadlineMs ?? perAttempt * 3);
  const geminiOnly = Boolean(opts?.geminiOnly || opts?.attachments?.length);
  const debugLogs: string[] = [];

  const system = `${opts?.systemPrompt ?? ''}${opts?.jsonMode ? JSON_SUFFIX : ''}`.trim();
  const turns = buildTurns(opts?.history, prompt);

  const anthKey = clean(opts?.provider === 'anthropic' && opts?.apiKey ? opts.apiKey : '') || anthropicKey();
  const gemKey = clean(opts?.provider === 'gemini' && opts?.apiKey ? opts.apiKey : '') || geminiKey();
  const orKey = clean(opts?.provider === 'openrouter' && opts?.apiKey ? opts.apiKey : '') || clean(process.env.OPENROUTER_API_KEY);
  const oaKey = clean(opts?.provider === 'openai' && opts?.apiKey ? opts.apiKey : '') || clean(process.env.OPENAI_API_KEY);

  const stages: Array<{ name: ProviderName; models: string[]; run: AttemptFn }> = [];
  if (anthKey && !geminiOnly) {
    stages.push({ name: 'anthropic', models: claudeModelsFor(opts), run: (m, t) => anthropicAttempt(system, turns, { maxTokens, key: anthKey }, m, t) });
  }
  if (gemKey) {
    stages.push({
      name: 'gemini',
      models: geminiModelsFor(opts),
      run: (m, t) => geminiAttempt(system, turns, { maxTokens, temperature, key: gemKey, jsonMode: opts?.jsonMode, attachments: opts?.attachments }, m, t),
    });
  }
  if (orKey && !geminiOnly) {
    stages.push({ name: 'openrouter', models: openRouterModelsFor(opts), run: (m, t) => chatCompletionsAttempt(OPENROUTER_API, orKey, system, turns, { maxTokens, temperature, jsonMode: opts?.jsonMode }, m, t) });
  }
  if (oaKey && !geminiOnly) {
    const isOr = oaKey.startsWith('sk-or-v1-');
    const model = (opts?.provider === 'openai' && opts?.model) || (isOr ? 'google/gemini-2.5-flash' : 'gpt-4o-mini');
    stages.push({ name: 'openai', models: [model], run: (m, t) => chatCompletionsAttempt(isOr ? OPENROUTER_API : 'https://api.openai.com/v1/chat/completions', oaKey, system, turns, { maxTokens, temperature, jsonMode: opts?.jsonMode }, m, t) });
  }

  // An explicitly preferred provider goes first; the rest keep their priority.
  if (opts?.provider) {
    const i = stages.findIndex((s) => s.name === opts.provider);
    if (i > 0) stages.unshift(...stages.splice(i, 1));
  }

  if (!stages.length) debugLogs.push('No AI provider key is configured (ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY).');

  for (const stage of stages) {
    for (const model of stage.models) {
      const remaining = deadline - Date.now();
      if (remaining < 1500) {
        debugLogs.push(`${stage.name} ${model} skipped: overall deadline reached`);
        continue;
      }
      try {
        const r = await stage.run(model, Math.min(perAttempt, remaining));
        if (!r.text) {
          debugLogs.push(`${stage.name} ${model} -> empty response`);
          continue;
        }
        if (opts?.jsonMode) {
          if (r.truncated) {
            // A truncated JSON answer is worse than none: it parses as garbage.
            debugLogs.push(`${stage.name} ${model} -> truncated JSON`);
            continue;
          }
          if (parseJSONFromLLM(r.text) === null) {
            debugLogs.push(`${stage.name} ${model} -> invalid JSON`);
            continue;
          }
        }
        return {
          text: r.text,
          success: true,
          debugLogs,
          tokensUsed: r.tokens || Math.ceil((system.length + prompt.length + r.text.length) / 4),
          provider: stage.name,
          model,
        };
      } catch (e: any) {
        debugLogs.push(`${stage.name} ${model} failed: ${e?.message || e}`);
        // A bad/expired key fails every model of that provider the same way.
        if (e instanceof HttpError && (e.status === 401 || e.status === 403)) break;
      }
    }
  }

  return { text: '', success: false, debugLogs, tokensUsed: 0 };
}

/** Strips ```json fences and parses. Returns null on failure. */
export function parseJSONFromLLM<T>(raw: string): T | null {
  const jsonText = (raw || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    // Attempt to salvage the first {...} block.
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
