/**
 * Team-Facing AI Assistant Service.
 *
 * Provides contextual reply suggestions, message polishing, and draft translation
 * for human agents working in the inbox.
 */

import { callLLM, parseJSONFromLLM, type CallOptions } from '@/lib/ai/llm';
import { ValidationError, type TenantDb } from '../kernel';

export interface SuggestRepliesInput {
  conversationId: string;
  recentMessages: Array<{
    senderType: 'customer' | 'agent' | 'bot';
    text: string;
  }>;
  businessName?: string;
  businessContext?: string;
  language?: string;
}

export interface PolishDraftInput {
  text: string;
  style: 'professional' | 'friendly' | 'concise' | 'fix_grammar';
  language?: string;
}

export interface SuggestRepliesResult {
  suggestions: string[];
  tokensUsed: number;
}

export interface PolishDraftResult {
  original: string;
  polished: string;
  style: string;
  tokensUsed: number;
}

export class AiAssistantService {
  constructor(
    private readonly db: TenantDb,
    private readonly userId: string,
  ) {}

  static create(db: TenantDb, userId: string): AiAssistantService {
    return new AiAssistantService(db, userId);
  }

  /**
   * Loads custom AI config from TenantConfiguration if configured.
   */
  private async getTenantAiConfig(): Promise<CallOptions> {
    const config = await this.db.tenantConfiguration.findFirst({
      select: {
        aiProvider: true,
        aiApiKey: true,
        aiModel: true,
        aiTemperature: true,
        aiSystemPrompt: true,
        aiPersonality: true,
        aiBusinessContext: true,
      },
    });

    if (!config) return {};

    return {
      provider: (config.aiProvider as 'gemini' | 'openai' | 'openrouter') || undefined,
      apiKey: config.aiApiKey || undefined,
      model: config.aiModel || undefined,
      temperature: config.aiTemperature ? Number(config.aiTemperature) : undefined,
      systemPrompt: config.aiSystemPrompt || undefined,
    };
  }

  /**
   * Generates 3 quick smart reply suggestions based on the conversation history.
   */
  async suggestReplies(input: SuggestRepliesInput): Promise<SuggestRepliesResult> {
    if (!input.recentMessages || input.recentMessages.length === 0) {
      throw new ValidationError('Conversation has no recent messages to generate suggestions from.');
    }

    const tenantConfig = await this.getTenantAiConfig();

    const formattedHistory = input.recentMessages
      .slice(-6)
      .map((m) => `${m.senderType.toUpperCase()}: ${m.text}`)
      .join('\n');

    const prompt = `You are a helpful customer support AI assistant for ${input.businessName || 'our business'}.
${input.businessContext ? `Business context: ${input.businessContext}` : ''}

Analyze the recent conversation between the customer and agent:
---
${formattedHistory}
---

Generate 3 natural, concise, and helpful reply suggestions for the agent to send next to the customer.
Format output strictly as a JSON array of 3 strings:
["Suggestion 1", "Suggestion 2", "Suggestion 3"]`;

    const llmResult = await callLLM(prompt, {
      ...tenantConfig,
      maxTokens: 500,
      temperature: 0.3,
    });

    if (!llmResult.success) {
      return {
        suggestions: [
          'Thank you for reaching out! How can I assist you further today?',
          'I am looking into this for you right now.',
          'Could you please share a few more details so I can help?',
        ],
        tokensUsed: 0,
      };
    }

    const parsed = parseJSONFromLLM<string[]>(llmResult.text);
    const suggestions = Array.isArray(parsed) && parsed.length > 0
      ? parsed.slice(0, 3).map((s) => String(s).trim())
      : [llmResult.text.trim()];

    return {
      suggestions,
      tokensUsed: llmResult.tokensUsed,
    };
  }

  /**
   * Rewrites/polishes draft text in the requested tone or fixes grammar.
   */
  async polishDraft(input: PolishDraftInput): Promise<PolishDraftResult> {
    if (!input.text || input.text.trim().length === 0) {
      throw new ValidationError('Text to polish cannot be empty.');
    }

    const tenantConfig = await this.getTenantAiConfig();

    const styleInstructions: Record<string, string> = {
      professional: 'Rewrite this message in a polite, highly professional, and courteous tone.',
      friendly: 'Rewrite this message in a warm, welcoming, friendly, and approachable tone.',
      concise: 'Make this message clear, direct, and concise while preserving all necessary details.',
      fix_grammar: 'Correct any spelling, grammar, punctuation, and phrasing errors without altering the core tone.',
    };

    const prompt = `You are an expert copywriter and communication assistant.
Instruction: ${styleInstructions[input.style] || styleInstructions.professional}
${input.language ? `Target Language: ${input.language}` : ''}

Original message:
"${input.text}"

Return ONLY the rewritten message text without quotation marks, markdown wrappers, or explanation.`;

    const llmResult = await callLLM(prompt, {
      ...tenantConfig,
      maxTokens: 500,
      temperature: 0.2,
    });

    const polished = llmResult.success ? llmResult.text.trim().replace(/^["']|["']$/g, '') : input.text;

    return {
      original: input.text,
      polished,
      style: input.style,
      tokensUsed: llmResult.tokensUsed,
    };
  }
}
