import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as llmModule from '@/lib/ai/llm';
import { ValidationError } from '../kernel';
import { AiAssistantService } from './ai-assistant.service';

describe('AiAssistantService', () => {
  const fakeDb: any = {
    tenantConfiguration: {
      findFirst: vi.fn(async () => null),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('suggestReplies', () => {
    it('throws validation error when recent messages are empty', async () => {
      const service = AiAssistantService.create(fakeDb, 'user-1');
      await expect(
        service.suggestReplies({
          conversationId: 'conv-1',
          recentMessages: [],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('returns parsed smart reply suggestions from LLM', async () => {
      vi.spyOn(llmModule, 'callLLM').mockResolvedValueOnce({
        text: '```json\n["Hello, how can I help you?", "Let me check that for you right away.", "Could you provide your order number?"]\n```',
        success: true,
        debugLogs: [],
        tokensUsed: 42,
      });

      const service = AiAssistantService.create(fakeDb, 'user-1');
      const result = await service.suggestReplies({
        conversationId: 'conv-1',
        recentMessages: [
          { senderType: 'customer', text: 'Hi, I need help with my appointment.' },
        ],
        businessName: 'Apex Health',
      });

      expect(result.suggestions).toHaveLength(3);
      expect(result.suggestions[0]).toBe('Hello, how can I help you?');
      expect(result.tokensUsed).toBe(42);
    });

    it('returns fallback suggestions when LLM call fails', async () => {
      vi.spyOn(llmModule, 'callLLM').mockResolvedValueOnce({
        text: '',
        success: false,
        debugLogs: ['All providers failed'],
        tokensUsed: 0,
      });

      const service = AiAssistantService.create(fakeDb, 'user-1');
      const result = await service.suggestReplies({
        conversationId: 'conv-1',
        recentMessages: [
          { senderType: 'customer', text: 'Hello' },
        ],
      });

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.tokensUsed).toBe(0);
    });
  });

  describe('polishDraft', () => {
    it('throws validation error when input text is empty', async () => {
      const service = AiAssistantService.create(fakeDb, 'user-1');
      await expect(
        service.polishDraft({
          text: '',
          style: 'professional',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('returns polished message from LLM with selected tone', async () => {
      vi.spyOn(llmModule, 'callLLM').mockResolvedValueOnce({
        text: 'Dear Customer, your appointment has been confirmed for tomorrow at 10:00 AM. Thank you.',
        success: true,
        debugLogs: [],
        tokensUsed: 25,
      });

      const service = AiAssistantService.create(fakeDb, 'user-1');
      const result = await service.polishDraft({
        text: 'ur appt is confirmed tmrw 10am thx',
        style: 'professional',
      });

      expect(result.polished).toBe('Dear Customer, your appointment has been confirmed for tomorrow at 10:00 AM. Thank you.');
      expect(result.style).toBe('professional');
      expect(result.tokensUsed).toBe(25);
    });
  });
});
