/**
 * AI flow builder endpoints.
 *
 *   POST /api/flows/ai-generate   instruction (+ optional feedback on a previous draft) → draft (nothing saved)
 *   POST /api/flows/ai-create     approved draft → tags resolved/created → flow saved → optionally activated
 */

import { z } from 'zod';

import { hasGeminiKey } from '@/lib/ai/llm';
import { generateFlow, generateFlowBodySchema, validateDraft, type FlowDraft } from '@/lib/ai/flow-generate';
import { createHandler, ExternalApiError, result, systemDb, ValidationError } from '../kernel';
import { FlowService } from '../services/flow.service';
import { TagService } from '../services/tag.service';

const draftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(''),
  summary: z.string().max(800).default(''),
  trigger_type: z.enum(['keyword', 'first_inbound_message', 'manual']),
  trigger_config: z.record(z.unknown()),
  entry_node_key: z.string().min(1).max(64),
  nodes: z
    .array(z.object({ node_key: z.string().min(1).max(64), node_type: z.string(), config: z.record(z.unknown()) }))
    .min(2)
    .max(200),
  tag_names: z.array(z.string().max(60)).default([]),
});

const createBodySchema = z.object({ draft: draftSchema, activate: z.boolean().default(false) });

export const flowAiController = {
  generate: createHandler({
    operation: 'flows.aiGenerate',
    auth: 'tenant',
    body: generateFlowBodySchema,
    response: z.any(),
    rateLimit: { limit: 10, windowMs: 60_000 },
    async handle({ ctx, db, body }) {
      if (!hasGeminiKey()) throw new ValidationError('AI is unavailable: GEMINI_API_KEY is not configured.');
      const [business, tags] = await Promise.all([
        // Keyed by the signed-in user, so the lookup cannot cross tenants.
        systemDb.businessProfile
          .findUnique({ where: { userId: ctx.userId }, select: { businessName: true, description: true, city: true, website: true } })
          .catch(() => null),
        db.tag.findMany({ select: { name: true }, orderBy: { name: 'asc' }, take: 100 }),
      ]);
      const businessContext = business
        ? [business.businessName, business.description, business.city, business.website].filter(Boolean).join(' — ')
        : '';
      try {
        const draft = await generateFlow({
          instruction: body.instruction,
          businessContext,
          existingTags: tags.map((t) => t.name),
          feedback: body.feedback,
          previous: body.previous,
        });
        return { draft };
      } catch (error) {
        throw new ExternalApiError('Gemini', error instanceof Error ? error.message : 'AI flow generation failed.');
      }
    },
  }),

  create: createHandler({
    operation: 'flows.aiCreate',
    auth: 'tenant',
    body: createBodySchema,
    response: z.any(),
    async handle({ ctx, db, body }) {
      const draft = body.draft as FlowDraft;
      const blocking = validateDraft(draft).filter((i) => i.severity === 'error');
      if (blocking.length && body.activate) throw new ValidationError(`The flow still has problems: ${blocking[0].message}`, { details: { issues: blocking } });

      // Resolve tag names → ids, creating missing tags only now that the
      // user approved the flow.
      const existing = await db.tag.findMany({ select: { id: true, name: true } });
      const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t.id]));
      const tagService = TagService.create(db, ctx.userId);
      const tagIdFor = async (name: string): Promise<string> => {
        const key = name.trim().toLowerCase();
        const found = byName.get(key);
        if (found) return found;
        const created = await tagService.create({ name: name.trim(), color: '#8b5cf6' });
        byName.set(key, created.id);
        return created.id;
      };

      const nodes = [];
      for (const n of draft.nodes) {
        const config = { ...n.config } as Record<string, unknown>;
        if (n.node_type === 'set_tag') {
          config.tag_id = await tagIdFor(String(config.tag_name ?? 'Flow lead'));
          delete config.tag_name;
        }
        if (n.node_type === 'condition' && config.subject === 'tag') {
          config.subject_key = await tagIdFor(String(config.subject_key ?? ''));
        }
        nodes.push({ nodeKey: n.node_key, nodeType: n.node_type as never, config: config as never });
      }

      const service = FlowService.create(db, ctx.userId);
      const flow = await service.create({
        name: draft.name,
        description: draft.description || draft.summary.slice(0, 500) || null,
        triggerType: draft.trigger_type,
        triggerConfig: draft.trigger_config as never,
        entryNodeKey: draft.entry_node_key,
        nodes,
      });

      if (!body.activate) return result({ flow, activated: false }, { message: 'Flow saved as draft.' });
      const activation = await service.activate(flow.id);
      return result(
        { flow, activated: Boolean(activation.flow), issues: activation.issues },
        { message: activation.flow ? 'Flow activated.' : 'Flow saved as draft — fix the remaining issues to activate it.' },
      );
    },
  }),
};
