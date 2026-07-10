import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

interface ReviewRequest {
  name: string;
  category: string;
  language: string;
  header_type: string;
  header_text?: string;
  body_text: string;
  footer_text?: string;
  buttons: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  body_example: string[];
  header_text_example?: string;
}

export interface ReviewResult {
  passed: boolean;
  score: number;
  summary: string;
  checks: Array<{
    id: string;
    label: string;
    passed: boolean;
    severity: 'error' | 'warning' | 'info';
    message: string;
    suggestion?: string;
  }>;
  improvements: string[];
}

export async function POST(req: NextRequest) {
  let apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_SECONDARY || '';
  apiKey = apiKey.replace(/^["']|["']$/g, '');

  let orKey = process.env.OPENROUTER_API_KEY || '';
  orKey = orKey.replace(/^["']|["']$/g, '');

  if (!apiKey && !orKey) {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 500 });
  }

  let body: ReviewRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Safe fallbacks to prevent TypeErrors
  const name = body.name || '';
  const category = body.category || 'Marketing';
  const language = body.language || 'en_US';
  const headerType = body.header_type || 'none';
  const headerText = body.header_text || '';
  const bodyText = body.body_text || '';
  const footerText = body.footer_text || '';
  const buttons = body.buttons || [];
  const bodyExample = body.body_example || [];
  const headerTextExample = body.header_text_example || '';

  const varCount = (bodyText.match(/\{\{\d+\}\}/g) ?? []).length;
  const uniqueVarNums = [...new Set((bodyText.match(/\{\{(\d+)\}\}/g) ?? []).map(m => m.replace(/[{}]/g, '').trim()))];
  const missingExamples = varCount > 0 && bodyExample.filter(Boolean).length < uniqueVarNums.length;

  const prompt = `You are a WhatsApp Business API expert who reviews message templates before Meta submission.

Analyze this template and return ONLY valid JSON (no markdown fences, no explanation text):

## Template
- Name: ${name}
- Category: ${category}
- Language: ${language}
- Header Type: ${headerType}${headerText ? `\n- Header Text: ${headerText}` : ''}
- Body: ${bodyText}${footerText ? `\n- Footer: ${footerText}` : ''}
- Buttons: ${buttons.length > 0 ? buttons.map(b => (b.type || '') + ': "' + (b.text || '') + '"').join(', ') : 'None'}
- Variable Examples: ${bodyExample.filter(Boolean).join(', ') || 'None'}${headerTextExample ? `\n- Header Variable Example: ${headerTextExample}` : ''}

## Checks to perform (use exact IDs):
1. NAME_FORMAT - snake_case only (lowercase, numbers, underscores)
2. VARIABLE_EXAMPLES - All variables must have non-empty sample values
3. BODY_LENGTH - Under 1024 chars
4. HEADER_LENGTH - Header text under 60 chars
5. FOOTER_LENGTH - Footer under 60 chars
6. BUTTON_TEXT_LENGTH - Each button text must be under 25 characters. Emojis, variables ({{...}}), formatting symbols, and newlines are strictly prohibited in button text.
7. NO_PHISHING - No deceptive/spam content
8. CATEGORY_FIT - Category matches content intent (Utility templates must be strictly transactional and MUST NOT contain marketing language, promotional offers, or opt-out instructions like 'Reply STOP' or 'unsubscribe'. Opt-out instructions are only allowed in Marketing templates)
9. CONTENT_QUALITY - Clear, professional, no gibberish
10. URL_BUTTONS - https URLs required; mark passed:true if no URL buttons
11. PHONE_FORMAT - Country code required; mark passed:true if no phone buttons
12. VARIABLE_SEQUENCE - Variables must be sequential (no skipping)

Return JSON:
{"passed":boolean,"score":0-100,"summary":"one sentence","checks":[{"id":"CHECK_ID","label":"name","passed":boolean,"severity":"error"|"warning"|"info","message":"what was found","suggestion":"how to fix if failed"}],"improvements":["tip1","tip2"]}

Score: start 100, deduct 15 per error, 5 per warning. passed=true only if zero errors.`;

  try {
    let rawText = '';
    let success = false;

    // Try direct Gemini first with multiple model fallbacks
    if (apiKey) {
      const directModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
      for (const model of directModels) {
        if (success) break;
        try {
          const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
            }),
          });

          if (geminiRes.ok) {
            const geminiData = await geminiRes.json();
            rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            if (rawText) {
              success = true;
              break;
            }
          } else {
            const errText = await geminiRes.text();
            console.warn(`Direct Gemini model ${model} returned non-OK status:`, geminiRes.status, errText);
          }
        } catch (e) {
          console.warn(`Direct Gemini model ${model} call failed:`, e);
        }
      }
    }

    // Try OpenRouter fallback — try multiple models in priority order
    if (!success && orKey) {
      const orModels = [
        'google/gemini-2.5-flash',
        'google/gemini-2.5-pro',
        'meta-llama/llama-3-8b-instruct',
        'mistralai/mistral-7b-instruct',
        'meta-llama/llama-3.3-70b-instruct:free',
      ];

      for (const orModel of orModels) {
        if (success) break;
        try {
          console.log(`Attempting OpenRouter fallback with model: ${orModel}`);
          const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${orKey}`,
              'HTTP-Referer': 'http://localhost:3000',
              'X-Title': 'WhatsApp CRM',
            },
            body: JSON.stringify({
              model: orModel,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.1,
              max_tokens: 1500,
            }),
          });

          if (orRes.ok) {
            const orData = await orRes.json();
            rawText = orData?.choices?.[0]?.message?.content ?? '';
            if (rawText) {
              success = true;
              console.log(`OpenRouter success with: ${orModel}`);
            }
          } else {
            const errText = await orRes.text();
            console.warn(`OpenRouter model ${orModel} returned: ${orRes.status}`, errText);
          }
        } catch (e) {
          console.warn(`OpenRouter model ${orModel} failed:`, e);
        }
      }
    }

    // Try OpenAI/OpenRouter fallback (using OPENAI_API_KEY)
    if (!success) {
      let openAIKey = process.env.OPENAI_API_KEY || '';
      openAIKey = openAIKey.replace(/^["']|["']$/g, '');

      if (openAIKey) {
        try {
          const isOrToken = openAIKey.startsWith('sk-or-v1-');
          const endpoint = isOrToken 
            ? 'https://openrouter.ai/api/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';
          const modelName = isOrToken
            ? 'google/gemini-2.5-flash'
            : 'gpt-4o-mini';

          console.log(`Attempting OpenAI API Key fallback targeting: ${isOrToken ? 'OpenRouter' : 'OpenAI'} with model ${modelName}`);

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openAIKey}`,
          };
          if (isOrToken) {
            headers['HTTP-Referer'] = 'http://localhost:3000';
            headers['X-Title'] = 'WhatsApp CRM';
          }

          const res = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: modelName,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.1,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            rawText = data?.choices?.[0]?.message?.content ?? '';
            if (rawText) {
              success = true;
              console.log(`OpenAI/OpenRouter fallback success with: ${modelName}`);
            }
          } else {
            const errText = await res.text();
            console.warn(`OpenAI/OpenRouter fallback returned non-OK status: ${res.status}`, errText);
          }
        } catch (e) {
          console.warn('OpenAI/OpenRouter fallback failed:', e);
        }
      }
    }

    if (!success) {
      return NextResponse.json({ error: 'AI review service currently rate limited or unavailable. Please try again in a few seconds.' }, { status: 502 });
    }

  const jsonText = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

  let review: ReviewResult;
  try {
    review = JSON.parse(jsonText);
  } catch {
    console.error('Failed to parse Gemini response:', rawText);
    return NextResponse.json({ error: 'AI returned an unexpected format. Please try again.' }, { status: 502 });
  }

    if (missingExamples) {
      const existing = review.checks.find((c) => c.id === 'VARIABLE_EXAMPLES');
      if (existing) {
        existing.passed = false;
        existing.severity = 'error';
        existing.message = uniqueVarNums.length + ' variable(s) found but sample values are missing or incomplete.';
        existing.suggestion = 'Fill in a concrete example value for every placeholder (e.g. "John Doe" for {{1}}).';
      }
      review.passed = false;
    }

    return NextResponse.json(review);
  } catch (err) {
    console.error('AI review error:', err);
    return NextResponse.json({ error: 'AI review failed unexpectedly' }, { status: 500 });
  }
}
