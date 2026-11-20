import { NextRequest, NextResponse } from 'next/server';
import { callLLM, hasGeminiKey, parseJSONFromLLM } from '@/lib/ai/llm';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { getAuthUser } from '@/lib/whatsapp/template-context';
import {
  authBodyPreview,
  DEFAULT_AUTH_OPTIONS,
  validateTemplate,
  type TemplateDraft,
} from '@/lib/whatsapp/template-rules';

/**
 * Pre-submission review.
 *
 *  1. Deterministic Meta rules (template-rules.ts) — always run, never flaky.
 *  2. Gemini judgment checks (category fit, phishing tone, content quality).
 *
 * If Gemini is unavailable the review still returns the deterministic result
 * with `aiAvailable: false`, so an AI outage never blocks a valid template.
 */

export interface ReviewCheck {
  id: string;
  label: string;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
  source: 'rules' | 'ai';
}

export interface ReviewResult {
  passed: boolean;
  score: number;
  summary: string;
  checks: ReviewCheck[];
  improvements: string[];
  aiAvailable: boolean;
  /** Category Gemini thinks fits best, when it differs from the chosen one. */
  suggestedCategory?: 'Marketing' | 'Utility' | 'Authentication';
}

const RULE_LABELS: Record<string, string> = {
  name: 'Template name', language: 'Language', category: 'Category fit', header: 'Header',
  body: 'Body text', variables: 'Variables & samples', footer: 'Footer', buttons: 'Buttons',
};

interface AiReview {
  summary?: string;
  checks?: Array<{ id?: string; label?: string; passed?: boolean; severity?: string; message?: string; suggestion?: string }>;
  improvements?: string[];
  suggested_category?: string;
}

function asDraft(body: Partial<TemplateDraft> & { header_text_example?: string | string[] }): TemplateDraft {
  return {
    name: body.name ?? '',
    category: (body.category as TemplateDraft['category']) ?? 'Marketing',
    language: body.language ?? 'en_US',
    header_type: (body.header_type as TemplateDraft['header_type']) ?? 'none',
    header_text: body.header_text ?? '',
    header_example: body.header_example ?? '',
    header_text_example: Array.isArray(body.header_text_example) ? body.header_text_example[0] ?? '' : body.header_text_example ?? '',
    body_text: body.body_text ?? '',
    body_example: Array.isArray(body.body_example) ? body.body_example.map(String) : [],
    footer_text: body.footer_text ?? '',
    buttons: Array.isArray(body.buttons) ? body.buttons : [],
    auth: body.auth ?? (body.category === 'Authentication' ? DEFAULT_AUTH_OPTIONS : undefined),
  };
}

function buildPrompt(t: TemplateDraft): string {
  const isAuth = t.category === 'Authentication';
  return `You are a senior WhatsApp Business API policy reviewer. Judge this template the way Meta's reviewers would. Structural limits (lengths, variable numbering, button formats) are already validated by code — focus on JUDGMENT.

TEMPLATE
Category: ${t.category}
Language: ${t.language}
Header: ${t.header_type === 'text' ? t.header_text : t.header_type === 'none' ? '(none)' : `${t.header_type} media`}
Body: ${isAuth ? authBodyPreview(t.auth) : t.body_text}
Sample values: ${t.body_example.filter(Boolean).map((v, i) => `{{${i + 1}}}=${v}`).join(', ') || '(none)'}
Footer: ${t.footer_text || '(none)'}
Buttons: ${t.buttons.length ? t.buttons.map((b) => `${b.type} "${b.text}"${b.url ? ` → ${b.url}` : ''}`).join('; ') : '(none)'}

Evaluate exactly these checks:
- CATEGORY_FIT: Utility must be strictly transactional/non-promotional and triggered by a user action or account event; anything promotional is Marketing. Authentication is only for OTPs.
- NO_PHISHING: no requests for passwords/PINs/card details, no threats, no impersonation, no deceptive links.
- CONTENT_QUALITY: clear purpose, grammatical, not spammy, no excessive caps/emoji, variables used sensibly, samples realistic and matching their placeholder.
- POLICY_COMPLIANCE: no prohibited goods/services (WhatsApp Commerce Policy), no misleading claims or fake urgency.

severity: "error" only for things that will very likely be rejected; "warning" for risks; "info" for fine.
Return ONLY JSON:
{"summary":"one sentence verdict","checks":[{"id":"CATEGORY_FIT","label":"Category fit","passed":true,"severity":"info","message":"…","suggestion":"…"}],"improvements":["concrete tip"],"suggested_category":"Marketing|Utility|Authentication"}`;
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const limit = checkRateLimit(`template-review:${user.userId}`, { limit: 20, windowMs: 60_000 });
  if (!limit.success) return rateLimitResponse(limit);

  let raw: Partial<TemplateDraft>;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const template = asDraft(raw);

  // 1. Deterministic rules.
  const ruleIssues = validateTemplate(template);
  const checks: ReviewCheck[] = ruleIssues.map((issue) => ({
    id: issue.id,
    label: RULE_LABELS[issue.field] ?? issue.field,
    passed: false,
    severity: issue.severity,
    message: issue.message,
    source: 'rules',
  }));
  if (!ruleIssues.length) {
    checks.push({
      id: 'META_FORMAT', label: 'Meta format rules', passed: true, severity: 'info',
      message: 'Name, lengths, variables, samples and buttons meet Meta’s structural requirements.', source: 'rules',
    });
  }

  // 2. Gemini judgment.
  let aiAvailable = false;
  let summary = '';
  let improvements: string[] = [];
  let suggestedCategory: ReviewResult['suggestedCategory'];

  if (hasGeminiKey()) {
    const llm = await callLLM(buildPrompt(template), {
      geminiOnly: true,
      taskCriticality: 'critical',
      jsonMode: true,
      maxTokens: 2048,
      temperature: 0.1,
    });
    const ai = llm.success ? parseJSONFromLLM<AiReview>(llm.text) : null;
    if (ai && Array.isArray(ai.checks)) {
      aiAvailable = true;
      summary = typeof ai.summary === 'string' ? ai.summary : '';
      improvements = Array.isArray(ai.improvements) ? ai.improvements.filter((t): t is string => typeof t === 'string').slice(0, 6) : [];
      for (const c of ai.checks) {
        const severity = c.severity === 'error' || c.severity === 'warning' ? c.severity : 'info';
        checks.push({
          id: `AI_${String(c.id ?? 'CHECK').toUpperCase()}`,
          label: c.label || String(c.id ?? 'AI check'),
          passed: c.passed !== false,
          severity: c.passed === false ? (severity === 'info' ? 'warning' : severity) : 'info',
          message: c.message || '',
          suggestion: c.suggestion || undefined,
          source: 'ai',
        });
      }
      const sc = String(ai.suggested_category ?? '');
      if (['Marketing', 'Utility', 'Authentication'].includes(sc) && sc !== template.category) {
        suggestedCategory = sc as ReviewResult['suggestedCategory'];
      }
    } else {
      console.warn('[ai.templateReview] Gemini unavailable', llm.debugLogs);
    }
  }

  if (!aiAvailable) {
    checks.push({
      id: 'AI_UNAVAILABLE', label: 'AI policy review', passed: true, severity: 'warning',
      message: 'The AI reviewer is temporarily unavailable — only Meta’s format rules were checked.',
      suggestion: 'You can still submit; re-run the review later for a content check.', source: 'ai',
    });
  }

  const failed = checks.filter((c) => !c.passed);
  const errors = failed.filter((c) => c.severity === 'error').length;
  const warnings = failed.filter((c) => c.severity === 'warning').length + (aiAvailable ? 0 : 1);
  const score = Math.max(0, Math.min(100, 100 - errors * 15 - warnings * 5));
  const passed = errors === 0;

  const result: ReviewResult = {
    passed,
    score,
    summary:
      summary ||
      (passed ? 'This template meets Meta’s requirements and is ready to submit.' : `Fix ${errors} blocking issue${errors === 1 ? '' : 's'} before submitting.`),
    // Failed checks first, errors before warnings.
    checks: checks.sort((a, b) => Number(a.passed) - Number(b.passed) || (a.severity === 'error' ? -1 : b.severity === 'error' ? 1 : 0)),
    improvements,
    aiAvailable,
    suggestedCategory,
  };
  return NextResponse.json(result);
}
