import { z } from 'zod';

import {
  DEFAULT_AUTH_OPTIONS,
  LIMITS,
  normalizeTemplateName,
  placeholderNumbers,
  renumberPlaceholders,
  stripEmoji,
  type TemplateButtonDraft,
  type TemplateCategory,
  type TemplateDraft,
} from '@/lib/whatsapp/template-rules';

/**
 * Prompt + response normalisation for AI template drafting
 * (used by /api/ai/template-draft). Kept outside the route so it can be
 * unit-tested and reused.
 */

export const templateCategorySchema = z.enum(['Marketing', 'Utility', 'Authentication']);

export const templateDraftRequestSchema = z.object({
  description: z.string().trim().min(3, 'Describe the message in a little more detail.').max(1500),
  category: z.union([templateCategorySchema, z.literal('auto')]).default('auto'),
  language: z.string().trim().min(2).max(20).default('en_US'),
  /** Optional business name / website / phone the AI may use in buttons. */
  businessContext: z.string().trim().max(500).optional(),
});

export type TemplateDraftRequest = z.infer<typeof templateDraftRequestSchema>;

const draftButtonSchema = z.object({
  type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']),
  text: z.string(),
  url: z.string().optional(),
  phone_number: z.string().optional(),
  example: z.string().optional(),
});

export const generatedDraftSchema = z.object({
  name: z.string(),
  category: templateCategorySchema,
  language: z.string(),
  header_type: z.enum(['none', 'text']),
  header_text: z.string(),
  header_text_example: z.string(),
  body_text: z.string().min(1),
  body_example: z.array(z.string()),
  footer_text: z.string(),
  buttons: z.array(draftButtonSchema),
  rationale: z.string(),
  warnings: z.array(z.string()),
});

export const templateDraftResponseSchema = z.object({ draft: generatedDraftSchema });

export type GeneratedTemplateDraft = z.infer<typeof generatedDraftSchema>;

// ── coercion of whatever the model returned ─────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function coerceCategory(v: unknown, fallback: TemplateCategory): TemplateCategory {
  const s = str(v).toLowerCase();
  if (s.startsWith('util')) return 'Utility';
  if (s.startsWith('auth')) return 'Authentication';
  if (s.startsWith('mark')) return 'Marketing';
  return fallback;
}

function coerceButtons(raw: unknown): TemplateButtonDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateButtonDraft[] = [];
  for (const b of raw as any[]) {
    const type = str(b?.type).toUpperCase().replace(/[\s-]/g, '_');
    const text = stripEmoji(str(b?.text)).replace(/[\n*_~`]|\{\{\s*\d+\s*\}\}/g, '').trim().slice(0, LIMITS.buttonTextMaxLength);
    if (!text) continue;
    if (type === 'URL') {
      const url = str(b?.url).trim();
      if (!/^https:\/\//i.test(url)) continue; // never keep an invented / insecure link
      out.push({ type: 'URL', text, url, example: str(b?.example).trim() });
    } else if (type === 'PHONE_NUMBER' || type === 'PHONE') {
      const phone = str(b?.phone_number).replace(/[\s()-]/g, '');
      if (!/^\+[1-9]\d{6,14}$/.test(phone)) continue;
      out.push({ type: 'PHONE_NUMBER', text, phone_number: phone });
    } else {
      out.push({ type: 'QUICK_REPLY', text });
    }
  }
  // Meta: quick replies grouped together, ≤2 URL, ≤1 phone, ≤10 total, unique labels.
  const seen = new Set<string>();
  const unique = out.filter((b) => !seen.has(b.text.toLowerCase()) && seen.add(b.text.toLowerCase()));
  const ctas = unique.filter((b) => b.type !== 'QUICK_REPLY');
  const urls = ctas.filter((b) => b.type === 'URL').slice(0, LIMITS.maxUrlButtons);
  const phones = ctas.filter((b) => b.type === 'PHONE_NUMBER').slice(0, LIMITS.maxPhoneButtons);
  const quick = unique.filter((b) => b.type === 'QUICK_REPLY');
  return [...quick, ...urls, ...phones].slice(0, LIMITS.maxButtons);
}

export function normalizeDraft(raw: any, requested: TemplateDraftRequest): GeneratedTemplateDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.draft && typeof raw.draft === 'object' ? raw.draft : raw;

  const category =
    requested.category === 'auto' ? coerceCategory(src.category, 'Marketing') : requested.category;
  const warnings: string[] = [];

  if (category === 'Authentication') {
    // Meta generates the body of authentication templates; custom copy is rejected.
    return {
      name: normalizeTemplateName(str(src.name)) || 'login_verification_code',
      category,
      language: requested.language,
      header_type: 'none',
      header_text: '',
      header_text_example: '',
      body_text: 'Your verification code.',
      body_example: [],
      footer_text: '',
      buttons: [],
      rationale: 'Authentication templates use Meta’s fixed one-time-passcode layout with a copy-code button.',
      warnings,
    };
  }

  const rawExamples: string[] = Array.isArray(src.body_example) ? src.body_example.map(str) : [];
  const rawBody = str(src.body_text).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!rawBody) return null;
  const { text: body_text, examples } = renumberPlaceholders(rawBody, rawExamples);
  const varCount = new Set(placeholderNumbers(body_text)).size;
  const body_example = Array.from({ length: varCount }, (_, i) => (examples[i] ?? '').trim());
  if (body_example.some((e) => !e)) warnings.push('Fill in a sample value for every variable.');

  let header_type: 'none' | 'text' = str(src.header_type).toLowerCase() === 'text' ? 'text' : 'none';
  let header_text = stripEmoji(str(src.header_text)).replace(/[\n*_~`]/g, '').trim();
  if (header_text.length > LIMITS.headerTextMaxLength) header_text = header_text.slice(0, LIMITS.headerTextMaxLength).trim();
  if (!header_text) header_type = 'none';
  if (header_type === 'none') header_text = '';
  const headerVars = placeholderNumbers(header_text);
  if (headerVars.length > 1 || headerVars.some((n) => n !== 1)) {
    header_text = header_text.replace(/\{\{\s*\d+\s*\}\}/g, '').replace(/\s{2,}/g, ' ').trim();
  }

  const footer_text = str(src.footer_text).replace(/\{\{\s*\d+\s*\}\}/g, '').trim().slice(0, LIMITS.footerMaxLength);

  return {
    name: normalizeTemplateName(str(src.name)) || normalizeTemplateName(requested.description.split(/\s+/).slice(0, 4).join('_')) || 'new_template',
    category,
    language: requested.language,
    header_type,
    header_text,
    header_text_example: placeholderNumbers(header_text).length ? str(src.header_text_example).trim() : '',
    body_text: body_text.slice(0, LIMITS.bodyMaxLength),
    body_example,
    footer_text,
    buttons: coerceButtons(src.buttons),
    rationale: str(src.rationale).trim().slice(0, 300) || 'Drafted to follow Meta’s template guidelines.',
    warnings,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function toRulesDraft(d: GeneratedTemplateDraft): TemplateDraft {
  return {
    ...d,
    header_example: '',
    auth: d.category === 'Authentication' ? DEFAULT_AUTH_OPTIONS : undefined,
  };
}

export function buildDraftPrompt(body: TemplateDraftRequest, feedback?: string): string {
  return `You are an expert at writing WhatsApp Business message templates that pass Meta review on the first try.

USER GOAL: ${body.description}
${body.businessContext ? `BUSINESS DETAILS (the only source for links / phone numbers): ${body.businessContext}\n` : ''}CATEGORY: ${body.category === 'auto' ? 'Choose the correct one — Utility (transactional: orders, bookings, account updates, payment receipts, reminders the user expects), Marketing (offers, promotions, newsletters, re-engagement), or Authentication (one-time passcodes only).' : body.category}
LANGUAGE: write all customer-facing text in the language for locale "${body.language}".

META RULES (violations get the template rejected):
- name: lower_snake_case, descriptive, ≤ 50 chars.
- body ≤ 1024 chars. Variables are {{1}}, {{2}} … numbered sequentially in order of appearance. Use variables only for values that change per customer (name, order id, date, amount). Never start or end the body with a variable and never place two variables next to each other. Keep plenty of fixed wording around variables.
- body_example: one realistic sample per variable, in order (e.g. "Priya", "ORD-48213", "12 Dec 2026").
- Header: optional plain text ≤ 60 chars with no emoji, no formatting, no line breaks, at most one {{1}}. Use "none" if a header adds nothing.
- Footer: optional ≤ 60 chars, no variables. Utility templates must NOT contain opt-out/unsubscribe wording. Marketing may include a short opt-out line.
- Buttons (optional): label ≤ 25 chars, no emoji or variables. Quick replies first, then links/calls. Only add a URL button (https only) or PHONE_NUMBER button (E.164, e.g. +919876543210) if the user goal or business details provide that exact link / number — never invent URLs or numbers. A URL may end with {{1}}; then "example" is the full sample URL.
- No misleading claims, threats, fake urgency, requests for passwords/card numbers, or content that looks like phishing. Do not fabricate prices, dates, plan names or discounts that the user did not give — use a variable instead.
- WhatsApp formatting (*bold*, _italic_) and emoji are allowed sparingly in the body only.
${feedback ? `\nYOUR PREVIOUS ATTEMPT HAD THESE PROBLEMS — FIX ALL OF THEM:\n${feedback}\n` : ''}
Return ONLY a JSON object with exactly these keys:
{"name":string,"category":"Marketing"|"Utility"|"Authentication","language":"${body.language}","header_type":"none"|"text","header_text":string,"header_text_example":string,"body_text":string,"body_example":string[],"footer_text":string,"buttons":[{"type":"QUICK_REPLY"|"URL"|"PHONE_NUMBER","text":string,"url":string,"phone_number":string,"example":string}],"rationale":string}
Use "" for unused strings and [] for no buttons. "rationale" is one sentence on why the category and wording will pass review.`;
}
