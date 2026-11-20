/**
 * AI review drafting for the Google Review module.
 *
 * Uses the shared `callLLM` (same provider cascade as every other AI
 * feature). The AI only helps the customer put their OWN experience into
 * words: it must not invent experiences, inflate sentiment or add claims the
 * customer did not make. Low ratings stay critical.
 */

import { callLLM, parseJSONFromLLM } from '@/lib/ai/llm';
import { LANGUAGE_NAME, MAX_REVIEW_CHARS, type ReviewLanguage } from '@/lib/reviews/constants';

export interface DraftBusiness {
  name: string;
  category?: string | null;
  description?: string | null;
  services?: string[];
}

export interface AiOutcome<T> {
  value: T;
  tokensUsed: number;
}

const POSITIVE_WORDS = /\b(excellent|amazing|fantastic|perfect|outstanding|best ever|highly recommend|wonderful|superb|love(?:d)? it|five stars?)\b/i;
const BAD_CONTENT = /(https?:\/\/|www\.|@\w+\.\w+|\+?\d[\d\s-]{8,}|#\w+)/i;

function sentimentRule(rating: number): string {
  if (rating <= 2) return `The customer rated ${rating} out of 5. This is a NEGATIVE experience. Write honestly and politely about what went wrong, using only what they said. Do NOT add praise, thanks or recommendations.`;
  if (rating === 3) return `The customer rated 3 out of 5. This is a MIXED experience. Keep the tone balanced: mention good and not-so-good points only if the customer said them.`;
  if (rating === 4) return `The customer rated 4 out of 5. This is a POSITIVE experience with room for improvement. Do not oversell.`;
  return `The customer rated 5 out of 5. This is a very positive experience, but do not exaggerate beyond what they said.`;
}

export function buildDraftPrompt(input: { business: DraftBusiness; rating: number; feedback: string; language: ReviewLanguage; count: number }): string {
  const { business, rating, feedback, language, count } = input;
  const services = (business.services ?? []).slice(0, 12).join(', ');
  return `You help a real customer write their OWN Google review. You are not writing marketing copy.
Business: ${business.name}${business.category ? ` (${business.category})` : ''}
${business.description ? `About: ${business.description.slice(0, 400)}\n` : ''}${services ? `Services: ${services}\n` : ''}
${sentimentRule(rating)}
Customer's own words:
"""${feedback.trim().slice(0, 1200) || '(no details given, rating only)'}"""

RULES (strict):
- Write in ${LANGUAGE_NAME[language]}.
- Use ONLY facts in the customer's own words. Never invent a visit detail, staff name, price, date, treatment, product, result or feeling they did not state.
- If the customer gave no details, write ${count === 1 ? 'one very short' : 'very short'} neutral ${count === 1 ? 'line' : 'lines'} that match the rating and mention no specifics.
- Natural, first-person, human writing. No keyword stuffing, no hashtags, no emojis, no links, no phone numbers.
- Do not copy the business description. Mention the business name at most once, and only if it reads naturally.
- Each draft must be different in structure and wording, 1 to 4 sentences, at most ${MAX_REVIEW_CHARS} characters.
- Keep the customer's sentiment exactly. Do not make it more positive or more negative.
Return JSON only: {"drafts":[${Array.from({ length: count }, () => '""').join(',')}]}`;
}

export function cleanDrafts(raw: unknown, rating: number, limit: number): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const text = item.replace(/\s+/g, ' ').trim().slice(0, MAX_REVIEW_CHARS);
    if (text.length < 8) continue;
    if (BAD_CONTENT.test(text)) continue;
    if (rating <= 2 && POSITIVE_WORDS.test(text)) continue; // never turn a bad experience into praise
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

export async function generateDrafts(input: { business: DraftBusiness; rating: number; feedback: string; language: ReviewLanguage; count?: number }): Promise<AiOutcome<string[]>> {
  const count = Math.min(Math.max(input.count ?? 3, 1), 3);
  const res = await callLLM(buildDraftPrompt({ ...input, count }), { jsonMode: true, maxTokens: 1200, temperature: 0.7, taskCriticality: 'standard' });
  if (!res.success) throw new Error('The AI assistant is unavailable right now. You can write your review yourself.');
  const parsed = parseJSONFromLLM<{ drafts?: unknown }>(res.text);
  const drafts = cleanDrafts(parsed?.drafts, input.rating, count);
  if (!drafts.length) throw new Error('The AI could not prepare a draft. Please add a few more words or try again.');
  return { value: drafts, tokensUsed: res.tokensUsed ?? 0 };
}

export type TransformKind = 'translate' | 'shorten' | 'expand';

export async function transformDraft(input: { kind: TransformKind; text: string; language: ReviewLanguage; rating: number }): Promise<AiOutcome<string>> {
  const task =
    input.kind === 'translate'
      ? `Translate the review into ${LANGUAGE_NAME[input.language]}. Keep the meaning and sentiment exactly.`
      : input.kind === 'shorten'
        ? `Shorten the review to about half its length in ${LANGUAGE_NAME[input.language]}. Keep every fact and the same sentiment.`
        : `Expand the review slightly in ${LANGUAGE_NAME[input.language]} for readability (at most 2 more sentences). Do NOT add any new fact, detail or feeling that is not already in the text.`;
  const prompt = `${task}
${sentimentRule(input.rating)}
Review:
"""${input.text.slice(0, MAX_REVIEW_CHARS)}"""
Rules: first person, natural, no emojis, no links, no hashtags, at most ${MAX_REVIEW_CHARS} characters.
Return JSON only: {"text":""}`;
  const res = await callLLM(prompt, { jsonMode: true, maxTokens: 900, temperature: 0.4, taskCriticality: 'standard' });
  if (!res.success) throw new Error('The AI assistant is unavailable right now.');
  const parsed = parseJSONFromLLM<{ text?: unknown }>(res.text);
  const cleaned = cleanDrafts([parsed?.text], input.rating, 1);
  if (!cleaned.length) throw new Error('The AI could not process that text. Please try again.');
  return { value: cleaned[0], tokensUsed: res.tokensUsed ?? 0 };
}