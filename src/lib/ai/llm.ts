/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared LLM caller with a provider fallback cascade.
 *
 * Mirrors the battle-tested cascade used by /api/ai/template-review:
 *   1. Direct Gemini (GEMINI_API_KEY / GEMINI_API_KEY_SECONDARY)
 *   2. OpenRouter (OPENROUTER_API_KEY)
 *   3. OpenAI or OpenRouter via OPENAI_API_KEY (sk-or-v1- prefix routes to OpenRouter)
 *
 * Returns the raw model text plus debug logs. Callers are responsible
 * for prompting the model to return JSON and for parsing it.
 */

export interface LLMResult {
  text: string;
  success: boolean;
  debugLogs: string[];
  tokensUsed: number;
}

export interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  /**
   * Routes Gemini requests by consequence and complexity.  Use `basic` for
   * short greetings and acknowledgements, `standard` for normal assistance,
   * and `critical` where an incorrect answer could cause a compliance,
   * clinical, financial, or approval problem.
   */
  taskCriticality?: 'basic' | 'standard' | 'critical';
  /** Do not send a task to another provider if Gemini is unavailable. */
  geminiOnly?: boolean;
  provider?: 'gemini' | 'openai' | 'openrouter';
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
  /** Ask Gemini for a strict `application/json` response (no prose, no fences). */
  jsonMode?: boolean;
  /** Per-model request timeout. Defaults to 45s. */
  timeoutMs?: number;
  /**
   * Files sent to Gemini alongside the prompt (images, PDFs). Gemini-only:
   * other providers cannot read them, so attachments imply `geminiOnly`.
   */
  attachments?: Array<{ mimeType: string; data?: string /* base64, inline (up to ~18 MB) */; fileUri?: string /* from uploadGeminiFile, for larger files */ }>;
}

const GEMINI_API = 'https://generativelanguage.googleapis.com';
/** Gemini rejects requests over ~20 MB, so bigger files go through the File API. */
export const GEMINI_INLINE_MAX_BYTES = 18 * 1024 * 1024;

function geminiKey(): string {
  return clean(process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_SECONDARY);
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
 * are billed against `maxOutputTokens`. A 1.6k budget was routinely consumed
 * by ~1.3k thinking tokens, leaving the JSON answer truncated. The headroom
 * below is added on top of the caller's answer budget for Gemini only.
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

function clean(v: string | undefined): string {
  return (v || "").replace(/^["']|["']$/g, "");
}

export function hasAnyLLMKey(): boolean {
  return Boolean(
    clean(process.env.GEMINI_API_KEY) ||
      clean(process.env.GEMINI_API_KEY_SECONDARY) ||
      clean(process.env.OPENROUTER_API_KEY) ||
      clean(process.env.OPENAI_API_KEY),
  );
}

/** The platform-default provider is Gemini, configured only on the server. */
export function hasGeminiKey(): boolean {
  return Boolean(clean(process.env.GEMINI_API_KEY));
}

export type TaskCriticality = NonNullable<CallOptions['taskCriticality']>;

/**
 * A deliberately conservative classifier for end-user text.  Only a very
 * short greeting/acknowledgement uses the economical tier. Everything else
 * remains on the capable default unless it is clearly high-stakes.
 */
export function inferTaskCriticality(input: string): TaskCriticality {
  const text = input.trim().toLowerCase();
  if (
    text.length <= 80 &&
    /^(hi|hello|hey|good (morning|afternoon|evening)|thanks|thank you|ok|okay|got it|bye|goodbye)[!.?\s]*$/.test(text)
  ) {
    return 'basic';
  }

  if (/(compliance|policy|approval|legal|medical|health|payment|refund|security|emergency|meta|whatsapp template)/.test(text)) {
    return 'critical';
  }

  return 'standard';
}

function geminiModelsFor(opts?: CallOptions): string[] {
  if (opts?.model) return [opts.model];

  switch (opts?.taskCriticality ?? 'standard') {
    case 'basic':
      // Fastest/lowest-cost response tier. The pinned 2.5 models are no
      // longer served to new API keys (404), so only the -latest aliases
      // are used here.
      return ['gemini-flash-lite-latest', 'gemini-flash-latest'];
    case 'critical':
      // Policy and approval work benefits from the strongest reasoning tier.
      return ['gemini-pro-latest', 'gemini-flash-latest'];
    default:
      return ['gemini-flash-latest', 'gemini-flash-lite-latest'];
  }
}

export async function callLLM(
  prompt: string,
  opts?: CallOptions,
): Promise<LLMResult> {
  const maxTokens = opts?.maxTokens ?? 2048;
  const temperature = opts?.temperature ?? 0.15;

  const apiKey = clean(opts?.apiKey || process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_SECONDARY);
  const orKey = clean(opts?.apiKey && opts.provider === 'openrouter' ? opts.apiKey : process.env.OPENROUTER_API_KEY);
  const openAIKey = clean(opts?.apiKey && opts.provider === 'openai' ? opts.apiKey : process.env.OPENAI_API_KEY);

  let rawText = "";
  let success = false;
  let tokensUsed = 0;
  const debugLogs: string[] = [];

  const effectivePrompt = opts?.systemPrompt
    ? `${opts.systemPrompt}\n\n${prompt}`
    : prompt;

  // 1. Direct Gemini (or if explicitly chosen)
  if (apiKey && (!opts?.provider || opts.provider === 'gemini')) {
    const directModels = geminiModelsFor(opts);
    for (const model of directModels) {
      if (success) break;
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(opts?.timeoutMs ?? 45_000),
            body: JSON.stringify({
              contents: [{
                parts: [
                  ...(opts?.attachments ?? []).map((a) => (a.fileUri ? { fileData: { mimeType: a.mimeType, fileUri: a.fileUri } } : { inlineData: { mimeType: a.mimeType, data: a.data } })),
                  { text: effectivePrompt },
                ],
              }],
              generationConfig: {
                temperature,
                maxOutputTokens: maxTokens + GEMINI_THINKING_HEADROOM,
                ...(opts?.jsonMode ? { responseMimeType: "application/json" } : {}),
              },
            }),
          },
        );
        if (res.ok) {
          const data = await res.json();
          const finishReason = data?.candidates?.[0]?.finishReason;
          const text = geminiText(data);
          if (finishReason === "MAX_TOKENS") {
            // A truncated answer is worse than none: it parses as garbage.
            debugLogs.push(`Gemini ${model} -> truncated (MAX_TOKENS)`);
          } else if (!text) {
            debugLogs.push(`Gemini ${model} -> empty response (${finishReason ?? data?.promptFeedback?.blockReason ?? "unknown"})`);
          } else {
            rawText = text;
            success = true;
            tokensUsed = data?.usageMetadata?.totalTokenCount ?? Math.ceil((effectivePrompt.length + rawText.length) / 4);
          }
        } else {
          debugLogs.push(`Gemini ${model} -> ${res.status}: ${await res.text()}`);
        }
      } catch (e: any) {
        debugLogs.push(`Gemini ${model} failed: ${e.message || e}`);
      }
    }
  }

  // 2. OpenRouter
  if (!success && !opts?.geminiOnly && !opts?.attachments?.length && (orKey || (opts?.provider === 'openrouter' && opts?.apiKey))) {
    const orModels = opts?.model
      ? [opts.model]
      : [
          "meta-llama/llama-3.3-70b-instruct:free",
          "google/gemini-2.5-flash",
          "mistralai/mistral-7b-instruct",
          "meta-llama/llama-3-8b-instruct",
        ];
    const useKey = orKey || clean(opts?.apiKey);
    for (const orModel of orModels) {
      if (success) break;
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${useKey}`,
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "WhatsApp CRM",
          },
          body: JSON.stringify({
            model: orModel,
            messages: [{ role: "user", content: effectivePrompt }],
            temperature,
            max_tokens: maxTokens,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          rawText = data?.choices?.[0]?.message?.content ?? "";
          if (rawText) {
            success = true;
            tokensUsed = data?.usage?.total_tokens ?? Math.ceil((effectivePrompt.length + rawText.length) / 4);
          }
        } else {
          debugLogs.push(`OpenRouter ${orModel} -> ${res.status}: ${await res.text()}`);
        }
      } catch (e: any) {
        debugLogs.push(`OpenRouter ${orModel} failed: ${e.message || e}`);
      }
    }
  }

  // 3. OpenAI / OpenRouter via OPENAI_API_KEY
  if (!success && !opts?.geminiOnly && !opts?.attachments?.length && (openAIKey || (opts?.provider === 'openai' && opts?.apiKey))) {
    const useKey = openAIKey || clean(opts?.apiKey);
    if (useKey) {
      try {
        const isOrToken = useKey.startsWith("sk-or-v1-");
        const endpoint = isOrToken
          ? "https://openrouter.ai/api/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";
        const modelName = opts?.model || (isOrToken
          ? "meta-llama/llama-3.3-70b-instruct:free"
          : "gpt-4o-mini");
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${useKey}`,
        };
        if (isOrToken) {
          headers["HTTP-Referer"] = "http://localhost:3000";
          headers["X-Title"] = "WhatsApp CRM";
        }
        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: "user", content: effectivePrompt }],
            temperature,
            max_tokens: maxTokens,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          rawText = data?.choices?.[0]?.message?.content ?? "";
          if (rawText) {
            success = true;
            tokensUsed = data?.usage?.total_tokens ?? Math.ceil((effectivePrompt.length + rawText.length) / 4);
          }
        } else {
          debugLogs.push(`OpenAI fallback -> ${res.status}: ${await res.text()}`);
        }
      } catch (e: any) {
        debugLogs.push(`OpenAI fallback failed: ${e.message || e}`);
      }
    }
  }

  if (!tokensUsed && rawText) {
    tokensUsed = Math.ceil((effectivePrompt.length + rawText.length) / 4);
  }

  return { text: rawText, success, debugLogs, tokensUsed };
}

/** Strips ```json fences and parses. Returns null on failure. */
export function parseJSONFromLLM<T>(raw: string): T | null {
  const jsonText = raw
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
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
