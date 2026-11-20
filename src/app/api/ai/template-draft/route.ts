import { callLLM, hasGeminiKey, parseJSONFromLLM } from '@/lib/ai/llm';
import {
  buildDraftPrompt,
  normalizeDraft,
  templateDraftRequestSchema,
  templateDraftResponseSchema,
  toRulesDraft,
  type GeneratedTemplateDraft,
} from '@/lib/ai/template-draft';
import { validateTemplate } from '@/lib/whatsapp/template-rules';
import { createHandler, ExternalApiError, result, ValidationError } from '@/server/kernel';

export type { GeneratedTemplateDraft };

export const POST = createHandler({
  operation: 'ai.templateDraft',
  auth: 'tenant',
  body: templateDraftRequestSchema,
  response: templateDraftResponseSchema,
  rateLimit: { limit: 12, windowMs: 60_000 },
  async handle({ body }) {
    if (!hasGeminiKey()) {
      throw new ValidationError('AI drafting is unavailable: GEMINI_API_KEY is not configured on the server.');
    }

    // Meta writes authentication template copy itself — no model call needed.
    if (body.category === 'Authentication') {
      const draft = normalizeDraft({ name: 'login_verification_code' }, body);
      if (draft) return result({ draft });
    }

    let feedback: string | undefined;
    let best: GeneratedTemplateDraft | null = null;

    // One generation + at most one self-repair pass when the deterministic
    // rules still find blocking problems.
    for (let attempt = 0; attempt < 2; attempt++) {
      const llm = await callLLM(buildDraftPrompt(body, feedback), {
        geminiOnly: true,
        taskCriticality: attempt === 0 ? 'standard' : 'critical',
        jsonMode: true,
        maxTokens: 2048,
        temperature: 0.3,
      });
      if (!llm.success) {
        if (best) break;
        console.error('[ai.templateDraft] Gemini failed', llm.debugLogs);
        throw new ExternalApiError('Gemini', 'The AI service did not respond. Please try again in a moment.');
      }

      const draft = normalizeDraft(parseJSONFromLLM<unknown>(llm.text), body);
      if (!draft) {
        console.warn('[ai.templateDraft] unparseable response', llm.text.slice(0, 500));
        feedback = '- The response was not the requested JSON object.';
        continue;
      }
      best = draft;

      const errors = validateTemplate(toRulesDraft(draft)).filter((i) => i.severity === 'error');
      if (!errors.length) break;
      feedback = errors.map((e) => `- ${e.message}`).join('\n');
    }

    if (!best) {
      throw new ExternalApiError('Gemini', 'The AI returned an unusable draft. Try rephrasing your description.');
    }

    const remaining = validateTemplate(toRulesDraft(best)).map((i) => i.message);
    best.warnings = [...new Set([...best.warnings, ...remaining])].slice(0, 8);
    return result({ draft: best });
  },
});
