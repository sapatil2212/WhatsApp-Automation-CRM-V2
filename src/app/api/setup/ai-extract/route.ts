import { z } from 'zod';

import { hasGeminiKey } from '@/lib/ai/llm';
import { extractSetupFromFile, extractSetupFromText, SETUP_MAX_BYTES } from '@/lib/ai/setup-extract';
import { getBusinessSegment } from '@/lib/business/terminology';
import { createHandler, systemDb, ValidationError } from '@/server/kernel';

/**
 * POST /api/setup/ai-extract — multipart `file` (≤ 50 MB). Returns extracted
 * setup data for review; nothing is saved until the owner approves it.
 */
export const POST = createHandler({
  operation: 'setup.aiExtract',
  auth: 'tenant',
  response: z.any(),
  rateLimit: { limit: 6, windowMs: 60_000 },
  async handle({ ctx, request }) {
    if (!hasGeminiKey()) throw new ValidationError('AI import is unavailable: GEMINI_API_KEY is not configured.');
    const form = await request.formData();
    const file = form.get('file');
    const typed = form.get('text');
    const profile = await systemDb.profile.findUnique({ where: { userId: ctx.userId }, select: { businessType: true } });
    const segment = getBusinessSegment(profile?.businessType ?? null);

    // Typed / pasted details instead of a document.
    if (!(file instanceof File) && typeof typed === 'string') {
      if (typed.length > 200_000) throw new ValidationError('The text is too long. Paste up to about 200,000 characters.');
      try {
        return await extractSetupFromText({ text: typed, segment });
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : 'Could not analyse this text.');
      }
    }

    if (!(file instanceof File)) throw new ValidationError('Choose a document to upload, or type the details.');
    if (file.size === 0) throw new ValidationError('The file is empty.');
    if (file.size > SETUP_MAX_BYTES) throw new ValidationError('Documents must be 50 MB or smaller.');
    try {
      return await extractSetupFromFile({
        buffer: Buffer.from(await file.arrayBuffer()),
        fileName: file.name,
        mimeType: file.type,
        segment,
      });
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Could not analyse this document.');
    }
  },
});
