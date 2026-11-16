import { z } from 'zod';
import { createHandler, result, type AuthContext } from '@/server/kernel';

function assertTenant(ctx: AuthContext | null): asserts ctx is AuthContext {
  if (!ctx?.tenantId) throw new Error('Tenant context required.');
}

const aiConfigDtoSchema = z.object({
  aiProvider: z.string(),
  aiApiKey: z.string().nullable(),
  aiModel: z.string().nullable(),
  aiTemperature: z.number(),
  aiSystemPrompt: z.string().nullable(),
  aiPersonality: z.string().nullable(),
  aiLanguage: z.string(),
  aiBusinessContext: z.string().nullable(),
});

const updateAiConfigBodySchema = z.object({
  aiProvider: z.enum(['gemini', 'openai', 'openrouter']).default('gemini'),
  aiApiKey: z.string().trim().max(500).nullable().optional(),
  aiModel: z.string().trim().max(100).nullable().optional(),
  aiTemperature: z.number().min(0).max(1).default(0.7),
  aiSystemPrompt: z.string().max(5000).nullable().optional(),
  aiPersonality: z.string().max(200).nullable().optional(),
  aiLanguage: z.string().max(50).default('English'),
  aiBusinessContext: z.string().max(5000).nullable().optional(),
});

export const GET = createHandler({
  operation: 'settings.aiConfig.get',
  auth: 'tenant',
  response: aiConfigDtoSchema,
  async handle({ ctx, db }) {
    assertTenant(ctx);

    const config = await db.tenantConfiguration.upsert({
      where: { tenantId: ctx.tenantId },
      update: {},
      create: {
        tenantId: ctx.tenantId,
        aiProvider: 'gemini',
        aiLanguage: 'English',
        aiTemperature: 0.7,
      },
    });

    return result({
      aiProvider: config.aiProvider,
      aiApiKey: config.aiApiKey ? `${config.aiApiKey.slice(0, 4)}...${config.aiApiKey.slice(-4)}` : null,
      aiModel: config.aiModel,
      aiTemperature: Number(config.aiTemperature || 0.7),
      aiSystemPrompt: config.aiSystemPrompt,
      aiPersonality: config.aiPersonality,
      aiLanguage: config.aiLanguage,
      aiBusinessContext: config.aiBusinessContext,
    });
  },
});

export const PATCH = createHandler({
  operation: 'settings.aiConfig.update',
  auth: 'tenant',
  body: updateAiConfigBodySchema,
  response: aiConfigDtoSchema,
  message: 'AI settings updated successfully.',
  async handle({ body, ctx, db }) {
    assertTenant(ctx);

    const updateData: Record<string, unknown> = {
      aiProvider: body.aiProvider,
      aiTemperature: body.aiTemperature,
      aiLanguage: body.aiLanguage,
    };

    if (body.aiApiKey !== undefined) {
      // If user typed a new key (and not masked stars), update it
      if (body.aiApiKey && !body.aiApiKey.includes('...')) {
        updateData.aiApiKey = body.aiApiKey;
      } else if (body.aiApiKey === null || body.aiApiKey === '') {
        updateData.aiApiKey = null;
      }
    }

    if (body.aiModel !== undefined) updateData.aiModel = body.aiModel;
    if (body.aiSystemPrompt !== undefined) updateData.aiSystemPrompt = body.aiSystemPrompt;
    if (body.aiPersonality !== undefined) updateData.aiPersonality = body.aiPersonality;
    if (body.aiBusinessContext !== undefined) updateData.aiBusinessContext = body.aiBusinessContext;

    const updated = await db.tenantConfiguration.upsert({
      where: { tenantId: ctx.tenantId },
      update: updateData,
      create: {
        tenantId: ctx.tenantId,
        ...updateData,
      },
    });

    return result({
      aiProvider: updated.aiProvider,
      aiApiKey: updated.aiApiKey ? `${updated.aiApiKey.slice(0, 4)}...${updated.aiApiKey.slice(-4)}` : null,
      aiModel: updated.aiModel,
      aiTemperature: Number(updated.aiTemperature || 0.7),
      aiSystemPrompt: updated.aiSystemPrompt,
      aiPersonality: updated.aiPersonality,
      aiLanguage: updated.aiLanguage,
      aiBusinessContext: updated.aiBusinessContext,
    });
  },
});
