/**
 * AI campaign copilot: turns a plain-language goal into a complete,
 * launch-ready campaign plan (template, audience, personalization, timing),
 * and reviews a finished draft before launch.
 *
 * The model only ever chooses among things that exist in the workspace
 * (approved templates, tags, custom fields); everything it returns is
 * validated and repaired here, so the UI can apply a plan blindly.
 */

import { z } from 'zod';

import {
  templateSlots,
  validatePersonalization,
  type MappingSource,
  type Personalization,
  type SlotMapping,
} from '@/lib/campaigns/personalization';

export interface AssistTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  headerType: string | null;
  headerContent: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: Array<{ type: string; text: string; url: string | null }>;
}

export interface AssistContext {
  templates: AssistTemplate[];
  tags: Array<{ id: string; name: string; contactCount: number }>;
  customFields: Array<{ id: string; name: string }>;
  totalContacts: number;
  now: string;
  timezone: string;
}

export const assistRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('plan'),
    goal: z.string().trim().min(5, 'Describe the campaign goal in a sentence.').max(1500),
    timezone: z.string().max(64).default('UTC'),
    /** When the user already picked a template, plan around it. */
    templateId: z.string().optional(),
  }),
  z.object({
    mode: z.literal('review'),
    timezone: z.string().max(64).default('UTC'),
    draft: z.object({
      name: z.string().max(160),
      goal: z.string().max(1500).optional(),
      templateId: z.string(),
      audienceSummary: z.string().max(500),
      reach: z.number().int().nonnegative(),
      personalization: z.record(z.string(), z.object({ source: z.string(), value: z.string().optional(), fallback: z.string().optional() })),
      sampleMessage: z.string().max(2000),
      scheduledAt: z.string().nullable(),
    }),
  }),
]);
export type AssistRequest = z.infer<typeof assistRequestSchema>;

export interface CampaignPlan {
  name: string;
  summary: string;
  templateId: string | null;
  templateReason: string;
  /** Present when no approved template fits — a brief for the template builder. */
  newTemplateBrief: string | null;
  audience: { type: 'all' | 'tags'; tagIds: string[]; excludeTagIds: string[]; reason: string };
  personalization: Personalization;
  schedule: { mode: 'now' | 'later'; at: string | null; reason: string };
  tips: string[];
}

export interface CampaignReview {
  verdict: 'ready' | 'caution' | 'blocked';
  summary: string;
  findings: Array<{ severity: 'error' | 'warning' | 'info'; step: 'template' | 'audience' | 'personalize' | 'schedule' | 'general'; message: string }>;
}

const SOURCES: MappingSource[] = ['static', 'name', 'first_name', 'phone', 'email', 'company', 'custom_field'];

function describeTemplates(templates: AssistTemplate[]): string {
  if (!templates.length) return '(none — the workspace has no approved templates)';
  return templates
    .slice(0, 40)
    .map((t) => {
      const slots = templateSlots(t).map((s) => `${s.key} [${s.context}]`).join('; ');
      return `- id=${t.id} name=${t.name} lang=${t.language} category=${t.category}\n  body: ${t.bodyText.replace(/\s+/g, ' ').slice(0, 400)}\n  slots: ${slots || 'none'}`;
    })
    .join('\n');
}

export function buildPlanPrompt(goal: string, ctx: AssistContext, lockedTemplateId?: string): string {
  const locked = lockedTemplateId ? ctx.templates.find((t) => t.id === lockedTemplateId) : undefined;
  return `You are a senior WhatsApp marketing strategist configuring a broadcast campaign inside a CRM. Plan a complete, launch-ready campaign from the user's goal using ONLY the workspace data below.

GOAL: ${goal}
NOW: ${ctx.now} (user timezone: ${ctx.timezone})
TOTAL REACHABLE CONTACTS: ${ctx.totalContacts}

APPROVED TEMPLATES (only these can be sent):
${describeTemplates(ctx.templates)}

TAGS (segments): ${ctx.tags.length ? ctx.tags.map((t) => `${t.id}="${t.name}" (${t.contactCount} contacts)`).join(', ') : '(none)'}
CUSTOM FIELDS: ${ctx.customFields.length ? ctx.customFields.map((f) => `${f.id}="${f.name}"`).join(', ') : '(none)'}

INSTRUCTIONS
${locked ? `0. The user already chose template id=${locked.id} (${locked.name}). You MUST use it as templateId.
` : ''}1. templateId: the approved template whose purpose best matches the goal. If none fits reasonably, set templateId to null and write newTemplateBrief: a one-paragraph description of the template that should be created.
2. audience: "tags" with the most relevant tagIds when the goal implies a segment and matching tags exist; otherwise "all". Use excludeTagIds for obvious exclusions (e.g. tags meaning unsubscribed, opted-out, do-not-contact, churned, blocked, test).
3. personalization: for EVERY slot of the chosen template, choose a mapping:
   {"source":"first_name"|"name"|"phone"|"email"|"company"|"custom_field"|"static","value":"…","fallback":"…"}
   - Greetings/names → first_name with fallback like "there" or "Customer".
   - Facts that are the same for everyone (offer %, event date, store name, deadline) → static with a concrete value taken from the goal. Never invent prices, dates or codes not in the goal — if unknown, use a clear placeholder like "[add date]".
   - Per-contact data held in a custom field → custom_field with value = the field id.
   - header_media needs a public https URL: use static with value "" unless the goal provides one.
   - URL button suffixes: static (e.g. a campaign code) unless clearly per-contact.
   - Dynamic sources ALWAYS need a non-empty fallback.
4. schedule: "now" for urgent/transactional goals; otherwise "later" at a sensible local time (Tue–Thu 10:00–12:00 or 17:00–19:00 work well for marketing; never 21:00–09:00). Give "at" as ISO 8601 with offset, in the future.
5. name: short, human campaign name (e.g. "Diwali Sale – Loyal Customers").
6. tips: 2–4 concrete, specific suggestions to improve results or compliance.

Return ONLY JSON:
{"name":"","summary":"one sentence plan summary","templateId":"id or null","templateReason":"","newTemplateBrief":null,"audience":{"type":"all|tags","tagIds":[],"excludeTagIds":[],"reason":""},"personalization":{"body_1":{"source":"first_name","value":"","fallback":"there"}},"schedule":{"mode":"now|later","at":null,"reason":""},"tips":[]}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function normalizePlan(raw: any, ctx: AssistContext): CampaignPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const template = ctx.templates.find((t) => t.id === raw.templateId) ?? null;
  const tagIds = new Set(ctx.tags.map((t) => t.id));
  const fieldIds = new Set(ctx.customFields.map((f) => f.id));

  const personalization: Personalization = {};
  if (template) {
    const rawP = raw.personalization && typeof raw.personalization === 'object' ? raw.personalization : {};
    for (const slot of templateSlots(template)) {
      const m = rawP[slot.key] ?? {};
      let source: MappingSource = SOURCES.includes(m.source) ? m.source : 'static';
      let value = str(m.value).slice(0, 1024);
      let fallback = str(m.fallback).slice(0, 1024);
      if (source === 'custom_field' && !fieldIds.has(value)) {
        source = 'static';
        value = fallback;
      }
      if (slot.kind === 'header_media') {
        source = 'static';
        if (!/^https:\/\//i.test(value)) value = '';
      }
      if (source !== 'static' && !fallback.trim()) fallback = source.includes('name') ? 'there' : '-';
      const mapping: SlotMapping = { source };
      if (value) mapping.value = value;
      if (source !== 'static') mapping.fallback = fallback;
      personalization[slot.key] = mapping;
    }
  }

  const audienceRaw = raw.audience ?? {};
  const includeTags = (Array.isArray(audienceRaw.tagIds) ? audienceRaw.tagIds : []).filter((id: string) => tagIds.has(id));
  const excludeTags = (Array.isArray(audienceRaw.excludeTagIds) ? audienceRaw.excludeTagIds : [])
    .filter((id: string) => tagIds.has(id) && !includeTags.includes(id));
  const type: 'all' | 'tags' = audienceRaw.type === 'tags' && includeTags.length ? 'tags' : 'all';

  const scheduleRaw = raw.schedule ?? {};
  let at: string | null = null;
  if (scheduleRaw.mode === 'later' && scheduleRaw.at) {
    const d = new Date(scheduleRaw.at);
    if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now() + 5 * 60_000) at = d.toISOString();
  }

  return {
    name: str(raw.name).trim().slice(0, 160) || 'New campaign',
    summary: str(raw.summary).slice(0, 400),
    templateId: template?.id ?? null,
    templateReason: str(raw.templateReason).slice(0, 400),
    newTemplateBrief: template ? null : str(raw.newTemplateBrief).slice(0, 1200) || null,
    audience: { type, tagIds: type === 'tags' ? includeTags : [], excludeTagIds: excludeTags, reason: str(audienceRaw.reason).slice(0, 300) },
    personalization,
    schedule: { mode: at ? 'later' : 'now', at, reason: str(scheduleRaw.reason).slice(0, 300) },
    tips: (Array.isArray(raw.tips) ? raw.tips : []).filter((t: unknown) => typeof t === 'string').slice(0, 4),
  };
}

export function buildReviewPrompt(draft: Extract<AssistRequest, { mode: 'review' }>['draft'], template: AssistTemplate | undefined, timezone: string): string {
  return `You are a WhatsApp campaign QA lead doing the final check before a broadcast is sent to real customers. Be concise and practical.

CAMPAIGN: ${draft.name}
GOAL: ${draft.goal || '(not stated)'}
TEMPLATE: ${template ? `${template.name} (${template.category}) — ${template.bodyText.replace(/\s+/g, ' ')}` : '(unknown)'}
AUDIENCE: ${draft.audienceSummary} — ${draft.reach} recipients
PERSONALIZATION: ${JSON.stringify(draft.personalization)}
SAMPLE MESSAGE AS A RECIPIENT SEES IT: ${draft.sampleMessage}
SEND TIME: ${draft.scheduledAt ?? 'immediately'} (user timezone ${timezone}, now ${new Date().toISOString()})

Check: does the message read naturally with the sample data (no leftover placeholders like "[add date]", awkward fallbacks, wrong values in the wrong slot)? Is the template category appropriate for the goal? Is the audience sensible for the goal and size? Is the send time considerate (not night-time for recipients)? Any compliance risk (marketing to everyone without opt-out, sensitive data)?

Return ONLY JSON:
{"verdict":"ready|caution|blocked","summary":"one sentence","findings":[{"severity":"error|warning|info","step":"template|audience|personalize|schedule|general","message":"specific, actionable"}]}
Use "blocked" only for problems that would embarrass the business or break the message.`;
}

export function normalizeReview(raw: any): CampaignReview | null {
  if (!raw || typeof raw !== 'object') return null;
  const verdict = ['ready', 'caution', 'blocked'].includes(raw.verdict) ? raw.verdict : 'caution';
  const steps = ['template', 'audience', 'personalize', 'schedule', 'general'];
  return {
    verdict,
    summary: str(raw.summary).slice(0, 400),
    findings: (Array.isArray(raw.findings) ? raw.findings : [])
      .filter((f: any) => f && typeof f.message === 'string')
      .slice(0, 8)
      .map((f: any) => ({
        severity: ['error', 'warning', 'info'].includes(f.severity) ? f.severity : 'info',
        step: steps.includes(f.step) ? f.step : 'general',
        message: f.message.slice(0, 300),
      })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** True when every slot of the plan's template has a usable mapping. */
export function planIsComplete(plan: CampaignPlan, ctx: AssistContext): boolean {
  const t = ctx.templates.find((x) => x.id === plan.templateId);
  return Boolean(t) && validatePersonalization(templateSlots(t!), plan.personalization).length === 0;
}
