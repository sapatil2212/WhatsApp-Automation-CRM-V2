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
  provider?: 'gemini' | 'openai' | 'openrouter';
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
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
    const directModels = opts?.model
      ? [opts.model]
      : ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
    for (const model of directModels) {
      if (success) break;
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: effectivePrompt }] }],
              generationConfig: { temperature, maxOutputTokens: maxTokens },
            }),
          },
        );
        if (res.ok) {
          const data = await res.json();
          rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          if (rawText) {
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
  if (!success && (orKey || (opts?.provider === 'openrouter' && opts?.apiKey))) {
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
  if (!success && (openAIKey || (opts?.provider === 'openai' && opts?.apiKey))) {
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
