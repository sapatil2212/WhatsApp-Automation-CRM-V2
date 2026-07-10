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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 500 });
  }

  let body: ReviewRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const varCount = (body.body_text.match(/\{\{\d+\}\}/g) ?? []).length;
  const uniqueVarNums = [...new Set((body.body_text.match(/\{\{(\d+)\}\}/g) ?? []).map(m => m.replace(/[{}]/g, '').trim()))];
  const missingExamples = varCount > 0 && body.body_example.filter(Boolean).length < uniqueVarNums.length;

  const prompt = `You are a WhatsApp Business API expert who reviews message templates before Meta submission.

Analyze this template and return ONLY valid JSON (no markdown fences, no explanation text):

## Template
- Name: ${body.name}
- Category: ${body.category}
- Language: ${body.language}
- Header Type: ${body.header_type}${body.header_text ? `\n- Header Text: ${body.header_text}` : ''}
- Body: ${body.body_text}${body.footer_text ? `\n- Footer: ${body.footer_text}` : ''}
- Buttons: ${body.buttons.length > 0 ? body.buttons.map(b => b.type + ': "' + b.text + '"').join(', ') : 'None'}
- Variable Examples: ${body.body_example.filter(Boolean).join(', ') || 'None'}${body.header_text_example ? `\n- Header Variable Example: ${body.header_text_example}` : ''}

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

  // Try direct Gemini first
  if (apiKey) {
    try {
      const geminiRes = await fetch(GEMINI_API_URL + '?key=' + apiKey, {
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
        if (rawText) success = true;
      } else {
        const errText = await geminiRes.text();
        console.warn('Direct Gemini API returned non-OK status:', geminiRes.status, errText);
      }
    } catch (e) {
      console.warn('Direct Gemini API call failed:', e);
    }
  }

  // Try OpenRouter fallback — try multiple models in priority order
  if (!success && process.env.OPENROUTER_API_KEY) {
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
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
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
          if (rawText) { success = true; console.log(`OpenRouter success with: ${orModel}`); }
        } else {
          const errText = await orRes.text();
          console.warn(`OpenRouter model ${orModel} returned: ${orRes.status}`, errText);
        }
      } catch (e) {
        console.warn(`OpenRouter model ${orModel} failed:`, e);
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
