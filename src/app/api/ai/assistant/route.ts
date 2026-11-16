import { z } from 'zod';
import { createHandler, result, type AuthContext } from '@/server/kernel';
import { AiAssistantService } from '@/server/services/ai-assistant.service';

function assertTenant(ctx: AuthContext | null): asserts ctx is AuthContext {
  if (!ctx?.tenantId) throw new Error('Tenant context required.');
}

const aiAssistantBodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('suggest_replies'),
    conversationId: z.string(),
    recentMessages: z
      .array(
        z.object({
          senderType: z.enum(['customer', 'agent', 'bot']),
          text: z.string().max(4000),
        }),
      )
      .min(1),
  }),
  z.object({
    action: z.literal('polish_draft'),
    text: z.string().min(1).max(4000),
    style: z.enum(['professional', 'friendly', 'concise', 'fix_grammar']),
  }),
]);

const aiAssistantResponseSchema = z.object({
  suggestions: z.array(z.string()).optional(),
  polished: z.string().optional(),
  original: z.string().optional(),
  style: z.string().optional(),
  tokensUsed: z.number().int().nonnegative(),
});

export const POST = createHandler({
  operation: 'ai.assistant',
  auth: 'tenant',
  body: aiAssistantBodySchema,
  response: aiAssistantResponseSchema,
  rateLimit: { limit: 30, windowMs: 60_000 },
  async handle({ body, ctx, db }) {
    assertTenant(ctx);
    const service = AiAssistantService.create(db, ctx.userId);

    if (body.action === 'suggest_replies') {
      const res = await service.suggestReplies({
        conversationId: body.conversationId,
        recentMessages: body.recentMessages,
      });
      return result(res);
    }

    if (body.action === 'polish_draft') {
      const res = await service.polishDraft({
        text: body.text,
        style: body.style,
      });
      return result(res);
    }

    throw new Error('Unknown AI action');
  },
});
