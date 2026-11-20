import { z } from 'zod';

import { callLLM, hasGeminiKey, parseJSONFromLLM } from '@/lib/ai/llm';
import { createHandler, ExternalApiError, ValidationError } from '@/server/kernel';

/**
 * AI pipeline designer: a one-line description of the business → a named
 * pipeline with 4–8 well-ordered stages. Nothing is saved here; the UI
 * shows the proposal and creates it through POST /api/pipelines.
 */

const bodySchema = z.object({
  description: z.string().trim().min(5, 'Describe your sales process in a sentence.').max(1000),
});

const PALETTE = ['#64748b', '#3b82f6', '#0ea5e9', '#6366f1', '#8b5cf6', '#f59e0b', '#f97316', '#22c55e'];

export const POST = createHandler({
  operation: 'pipelines.aiDesign',
  auth: 'tenant',
  body: bodySchema,
  response: z.any(),
  rateLimit: { limit: 10, windowMs: 60_000 },
  async handle({ body }) {
    if (!hasGeminiKey()) throw new ValidationError('AI is unavailable: GEMINI_API_KEY is not configured.');

    const prompt = `You are a CRM consultant. Design a sales/deal pipeline for this business:
"${body.description}"

Rules:
- 4 to 8 stages, in the order a deal moves. Start with the first touchpoint (often a WhatsApp enquiry); end with the single winning outcome (e.g. "Won", "Booked", "Enrolled"). Do NOT add a "Lost" stage — lost is a deal status, not a stage.
- Stage names: 1–3 words, specific to this industry, Title Case.
- Each stage gets a short hint (≤ 60 chars) describing when a deal belongs there.

Return ONLY JSON: {"name":"Pipeline name (≤ 40 chars)","stages":[{"name":"","hint":""}],"tips":["one or two short tips for running this pipeline on WhatsApp"]}`;

    const llm = await callLLM(prompt, { geminiOnly: true, jsonMode: true, maxTokens: 1024, temperature: 0.3, taskCriticality: 'standard' });
    const raw = llm.success ? parseJSONFromLLM<{ name?: unknown; stages?: unknown; tips?: unknown }>(llm.text) : null;
    const stages = (Array.isArray(raw?.stages) ? raw!.stages : [])
      .map((s) => ({
        name: String((s as { name?: unknown })?.name ?? '').trim().slice(0, 60),
        hint: String((s as { hint?: unknown })?.hint ?? '').trim().slice(0, 120),
      }))
      .filter((s) => s.name)
      .slice(0, 8);
    if (stages.length < 3) throw new ExternalApiError('Gemini', 'The AI could not design a pipeline. Try describing your process differently.');

    // Colour by position so the board always reads cool → warm → green.
    const colored = stages.map((s, i) => ({
      ...s,
      color: i === stages.length - 1 ? '#22c55e' : PALETTE[Math.round((i / Math.max(1, stages.length - 2)) * (PALETTE.length - 2))],
    }));
    return {
      name: String(raw?.name ?? '').trim().slice(0, 40) || 'Sales Pipeline',
      stages: colored,
      tips: (Array.isArray(raw?.tips) ? raw!.tips : []).filter((t): t is string => typeof t === 'string').slice(0, 2),
    };
  },
});
