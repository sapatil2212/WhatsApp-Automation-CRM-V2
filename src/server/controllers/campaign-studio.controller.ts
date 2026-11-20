/**
 * Campaign Studio endpoints — everything the campaign wizard needs beyond
 * plain CRUD:
 *
 *   GET  /api/broadcasts/setup             workspace readiness + pickers in one call
 *   POST /api/broadcasts/import-audience   CSV rows → contacts → ids for a `contacts` audience
 *   POST /api/broadcasts/test-send         send the configured message to one phone
 *   POST /api/broadcasts/assist            AI plan (goal → full campaign) / AI pre-launch review
 */

import { z } from 'zod';

import { callLLM, hasGeminiKey, parseJSONFromLLM } from '@/lib/ai/llm';
import {
  assistRequestSchema,
  buildPlanPrompt,
  buildReviewPrompt,
  normalizePlan,
  normalizeReview,
  type AssistContext,
  type AssistTemplate,
} from '@/lib/ai/campaign-assist';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { createHandler, ExternalApiError, getLogger, ValidationError, type AuthContext, type TenantDb } from '../kernel';

const log = getLogger('campaign-studio');
import { toTemplateDto } from '../dtos/template.dto';
import { BroadcastService } from '../services/broadcast.service';
import { TemplateService } from '../services/template.service';
import { WhatsappTransport } from '../services/whatsapp-transport';
import { ContactRepository } from '../repositories/contact.repository';
import { TemplateRepository } from '../repositories/template.repository';
import { WhatsappConfigRepository } from '../repositories/whatsapp-config.repository';
import { importAudienceBodySchema, testSendBodySchema } from '../validators/broadcast.validator';

function assertTenant(ctx: AuthContext | null): asserts ctx is AuthContext {
  if (!ctx?.tenantId) throw new Error('Tenant context required.');
}

async function loadContext(db: TenantDb, timezone: string) {
  const [templatePage, tags, customFields, totalContacts, credentials] = await Promise.all([
    new TemplateRepository(db).list({ sendableOnly: true }, { page: 1, pageSize: 100 }),
    db.tag.findMany({
      select: { id: true, name: true, color: true, _count: { select: { contacts: true } } },
      orderBy: { name: 'asc' },
    }),
    db.customField.findMany({ select: { id: true, fieldName: true }, orderBy: { fieldName: 'asc' } }),
    db.contact.count({ where: { phone: { not: '' } } }),
    new WhatsappConfigRepository(db).findCredentials(),
  ]);

  const templates = templatePage.items.map(toTemplateDto);
  const assist: AssistContext = {
    templates: templates.map(
      (t): AssistTemplate => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        headerType: t.headerType,
        headerContent: t.headerContent,
        bodyText: t.bodyText,
        footerText: t.footerText,
        buttons: t.buttons.map((b) => ({ type: b.type, text: b.text, url: b.url })),
      }),
    ),
    tags: tags.map((t) => ({ id: t.id, name: t.name, contactCount: t._count.contacts })),
    customFields: customFields.map((f) => ({ id: f.id, name: f.fieldName })),
    totalContacts,
    now: new Date().toISOString(),
    timezone,
  };
  return { templates, tags, customFields, totalContacts, whatsappConnected: Boolean(credentials), assist };
}

const looseObject = z.record(z.string(), z.unknown());

export const campaignStudioController = {
  setup: createHandler({
    operation: 'broadcasts.setup',
    auth: 'tenant',
    response: looseObject,
    async handle({ ctx, db }) {
      assertTenant(ctx);
      const data = await loadContext(db, 'UTC');
      return {
        whatsappConnected: data.whatsappConnected,
        aiAvailable: hasGeminiKey(),
        totalContacts: data.totalContacts,
        templates: data.templates,
        tags: data.tags.map((t) => ({ id: t.id, name: t.name, color: t.color, contactCount: t._count.contacts })),
        customFields: data.customFields.map((f) => ({ id: f.id, name: f.fieldName })),
      };
    },
  }),

  importAudience: createHandler({
    operation: 'broadcasts.importAudience',
    auth: 'tenant',
    body: importAudienceBodySchema,
    response: looseObject,
    rateLimit: { limit: 10, windowMs: 60_000 },
    async handle({ body, ctx, db }) {
      assertTenant(ctx);
      const contacts = new ContactRepository(db);
      const invalid: Array<{ row: number; phone: string }> = [];
      const byPhone = new Map<string, string | undefined>();

      body.rows.forEach((row, index) => {
        let phone = sanitizePhoneForMeta(row.phone);
        // A bare national number (e.g. 10 digits) gets the default country code.
        if (body.defaultCountryCode && phone.length > 0 && phone.length <= 10 && !phone.startsWith(body.defaultCountryCode)) {
          phone = `${body.defaultCountryCode}${phone.replace(/^0+/, '')}`;
        }
        if (!isValidE164(phone)) {
          invalid.push({ row: index + 1, phone: row.phone });
          return;
        }
        if (!byPhone.has(phone)) byPhone.set(phone, row.name?.trim() || undefined);
      });

      const existing = await contacts.mapPhonesToIds([...byPhone.keys()]);
      const ids: string[] = [];
      let created = 0;
      for (const [phone, name] of byPhone) {
        const found = existing.get(phone);
        if (found) {
          ids.push(found);
          continue;
        }
        const contact = await contacts.create({ phone, name: name ?? null, email: null, company: null, avatarUrl: null, userId: ctx.userId });
        ids.push(contact.id);
        created += 1;
      }

      return {
        contactIds: ids,
        created,
        matched: ids.length - created,
        duplicates: body.rows.length - invalid.length - byPhone.size,
        invalid: invalid.slice(0, 50),
        invalidCount: invalid.length,
      };
    },
  }),

  testSend: createHandler({
    operation: 'broadcasts.testSend',
    auth: 'tenant',
    body: testSendBodySchema,
    response: looseObject,
    rateLimit: { limit: 10, windowMs: 60_000 },
    async handle({ body, ctx, db }) {
      assertTenant(ctx);
      const phone = sanitizePhoneForMeta(body.phone);
      if (!isValidE164(phone)) throw new ValidationError('Enter the test number in international format, e.g. +919876543210.');
      const transport = await WhatsappTransport.forTenant(db);
      const service = BroadcastService.create(
        db,
        ctx.userId,
        TemplateService.create(db, ctx.userId, transport ?? undefined),
        transport ?? undefined,
      );
      const res = await service.testSend({
        templateName: body.templateName,
        templateLanguage: body.templateLanguage,
        personalization: body.personalization,
        phone,
      });
      return { sent: true, whatsappMessageId: res.whatsappMessageId };
    },
  }),

  assist: createHandler({
    operation: 'broadcasts.assist',
    auth: 'tenant',
    body: assistRequestSchema,
    response: looseObject,
    rateLimit: { limit: 15, windowMs: 60_000 },
    async handle({ body, ctx, db }) {
      assertTenant(ctx);
      if (!hasGeminiKey()) throw new ValidationError('AI assistance is unavailable: GEMINI_API_KEY is not configured.');
      const { assist } = await loadContext(db, body.timezone);

      if (body.mode === 'plan') {
        const llm = await callLLM(buildPlanPrompt(body.goal, assist, body.templateId), {
          geminiOnly: true,
          taskCriticality: 'standard',
          jsonMode: true,
          maxTokens: 2048,
          temperature: 0.3,
        });
        const plan = llm.success ? normalizePlan(parseJSONFromLLM(llm.text), assist) : null;
        if (!plan) {
          log.warn('ai plan failed', { logs: llm.debugLogs, text: llm.text.slice(0, 300) });
          throw new ExternalApiError('Gemini', 'The AI could not build a plan right now. Please try again.');
        }
        return { plan };
      }

      const template = assist.templates.find((t) => t.id === body.draft.templateId);
      const llm = await callLLM(buildReviewPrompt(body.draft, template, body.timezone), {
        geminiOnly: true,
        taskCriticality: 'critical',
        jsonMode: true,
        maxTokens: 1536,
        temperature: 0.1,
      });
      const review = llm.success ? normalizeReview(parseJSONFromLLM(llm.text)) : null;
      if (!review) {
        log.warn('ai review failed', { logs: llm.debugLogs });
        throw new ExternalApiError('Gemini', 'The AI review is unavailable right now.');
      }
      return { review };
    },
  }),
};
