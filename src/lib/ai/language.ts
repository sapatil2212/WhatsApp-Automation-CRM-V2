/**
 * Lightweight, dependency-free language detection for WhatsApp messages.
 *
 * The models handle any language, but they need a firm hint: Marathi and
 * Hindi share the Devanagari script and models often answer Marathi in
 * Hindi. Script ranges settle most languages; word markers separate
 * Marathi from Hindi and English from Hinglish / romanised Marathi.
 *
 * `resolveLanguage` looks at the latest message first and falls back to the
 * customer's earlier messages when the latest one carries no signal
 * ("2", "ok", "👍").
 */

export interface DetectedLanguage {
  /** BCP-47-ish code: en, hi, hi-Latn, mr, mr-Latn, gu, ta, … or `und` when unknown. */
  code: string;
  /** Human name used in prompts, e.g. "Marathi". */
  name: string;
  script: string;
  /** How sure the detector is: 'strong' (script/markers) or 'weak' (guess). */
  confidence: 'strong' | 'weak';
}

const SCRIPTS: Array<{ re: RegExp; code: string; name: string; script: string }> = [
  { re: /[઀-૿]/g, code: 'gu', name: 'Gujarati', script: 'Gujarati' },
  { re: /[਀-੿]/g, code: 'pa', name: 'Punjabi', script: 'Gurmukhi' },
  { re: /[ঀ-৿]/g, code: 'bn', name: 'Bengali', script: 'Bengali' },
  { re: /[଀-୿]/g, code: 'or', name: 'Odia', script: 'Odia' },
  { re: /[஀-௿]/g, code: 'ta', name: 'Tamil', script: 'Tamil' },
  { re: /[ఀ-౿]/g, code: 'te', name: 'Telugu', script: 'Telugu' },
  { re: /[ಀ-೿]/g, code: 'kn', name: 'Kannada', script: 'Kannada' },
  { re: /[ഀ-ൿ]/g, code: 'ml', name: 'Malayalam', script: 'Malayalam' },
  { re: /[؀-ۿ]/g, code: 'ur', name: 'Urdu', script: 'Arabic' },
  { re: /[Ѐ-ӿ]/g, code: 'ru', name: 'Russian', script: 'Cyrillic' },
  { re: /[一-鿿]/g, code: 'zh', name: 'Chinese', script: 'Han' },
  { re: /[぀-ヿ]/g, code: 'ja', name: 'Japanese', script: 'Kana' },
  { re: /[가-힯]/g, code: 'ko', name: 'Korean', script: 'Hangul' },
  { re: /[฀-๿]/g, code: 'th', name: 'Thai', script: 'Thai' },
];
const DEVANAGARI = /[ऀ-ॿ]/g;

// Devanagari word markers. Marathi markers are words Hindi does not use.
const MR_DEVA = ['आहे', 'आहेत', 'आहात', 'आणि', 'नाव', 'माझे', 'माझं', 'माझा', 'माझी', 'मला', 'तुम्ही', 'तुम्हाला', 'आम्ही', 'आम्हाला', 'काय', 'कसे', 'कसा', 'कशी', 'करायचे', 'करायची', 'करायचा', 'पाहिजे', 'हवी', 'हवे', 'हवा', 'नको', 'होय', 'नाही', 'झाले', 'झाली', 'द्या', 'सांगा', 'कुठे', 'किती', 'उद्या', 'परवा', 'वय', 'वर्ष', 'वर्षे', 'रुग्णाचे', 'रुग्ण', 'डॉक्टरांना', 'भेट', 'वेळ', 'दवाखाना', 'दवाखान्याचा', 'पत्ता', 'बरं', 'ठीक', 'धन्यवाद', 'कृपया', 'येऊ', 'जाऊ', 'शकतो', 'शकते', 'असेल', 'आहोत', 'त्यांचे', 'त्याचे', 'माहिती'];
const HI_DEVA = ['है', 'हैं', 'और', 'नाम', 'मेरा', 'मेरी', 'मेरे', 'मुझे', 'आप', 'आपका', 'आपकी', 'क्या', 'कैसे', 'करना', 'करनी', 'चाहिए', 'नहीं', 'हाँ', 'हां', 'में', 'से', 'था', 'थी', 'कल', 'कहाँ', 'कहां', 'कितना', 'कितने', 'उम्र', 'साल', 'मरीज', 'मरीज़', 'समय', 'पता', 'ठीक', 'धन्यवाद', 'कृपया', 'हूँ', 'हूं', 'रहा', 'रही', 'गया', 'गई', 'बताइए', 'बताओ', 'दीजिए', 'भेजो', 'भेजिए'];

// Roman-script markers.
const HINGLISH = /\b(hai|hain|hu|hoon|kal|parso|chahiye|chaiye|chahie|karna|krna|karni|karo|kijiye|mujhe|muje|mujhko|mera|meri|mere|naam|umar|umr|saal|kab|kya|kyu|kyun|haan|nahi|nahin|aap|aapka|apka|dikhana|baje|subah|shaam|sham|bhejo|bhejiye|batao|bataiye|kaise|kitna|kitne|kahan|kaha|accha|acha|theek|thik|bhai|ji|wala|wali|raha|rahi|gaya|gayi|ka|ki|ke|ko|mein|mai|par|bhi|sirf|abhi)\b/gi;
const MARATHI_LATN = /\b(ahe|aahe|ahet|aahet|ani|aani|mala|majhe|maze|majha|maza|tumhi|tumhala|amhi|kay|kasa|kashi|kase|karaycha|karaychi|karayche|pahije|pahiji|nako|hoy|nahi ka|zala|zali|jhala|dya|sanga|kuthe|kiti|udya|parva|vay|varsh|davakhana|patta|bara|thik ahe|dhanyavad|krupaya|yeu|jau|shakto|shakte|asel|ahot|mahiti)\b/gi;
const ENGLISH = /\b(the|please|want|need|my|is|am|are|book|appointment|tomorrow|today|what|where|when|how|which|can|could|would|address|timing|timings|price|cost|doctor|thanks|thank|hello|hi|yes|no|okay|ok|sure|send|clinic|available|i|you|your|me|for|with|and|to|of)\b/gi;

const count = (text: string, re: RegExp) => (text.match(re) || []).length;

function devanagariWords(text: string): { mr: number; hi: number } {
  const words = text.split(/[\s,.!?।॥:;()'"-]+/).filter(Boolean);
  let mr = 0;
  let hi = 0;
  for (const w of words) {
    if (MR_DEVA.includes(w)) mr++;
    if (HI_DEVA.includes(w)) hi++;
    // Marathi genitive/dative endings: रुग्णाचे, क्लिनिकचा, डॉक्टरांना
    else if (/(चे|चा|ची|च्या|ांना|ाला|ाने|ामध्ये|मधे|मध्ये)$/.test(w) && w.length > 2) mr += 0.5;
  }
  return { mr, hi };
}

const LANG = (code: string, name: string, script: string, confidence: DetectedLanguage['confidence']): DetectedLanguage => ({ code, name, script, confidence });

export const UNKNOWN_LANGUAGE: DetectedLanguage = LANG('und', 'Unknown', 'Unknown', 'weak');

/** Detects the language of a single message. */
export function detectLanguage(raw: string): DetectedLanguage {
  const text = (raw || '').trim();
  if (!text) return UNKNOWN_LANGUAGE;
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!letters) return UNKNOWN_LANGUAGE;

  // Non-Latin scripts.
  let best: { code: string; name: string; script: string; n: number } | null = null;
  for (const s of SCRIPTS) {
    const n = count(text, s.re);
    if (n && (!best || n > best.n)) best = { ...s, n };
  }
  const deva = count(text, DEVANAGARI);
  if (deva && (!best || deva >= best.n)) {
    const { mr, hi } = devanagariWords(text);
    if (mr > hi) return LANG('mr', 'Marathi', 'Devanagari', 'strong');
    if (hi > mr) return LANG('hi', 'Hindi', 'Devanagari', 'strong');
    return LANG('hi', 'Hindi', 'Devanagari', 'weak');
  }
  if (best) return LANG(best.code, best.name, best.script, 'strong');

  // Latin script: English vs Hinglish vs romanised Marathi.
  const lower = text.toLowerCase();
  const mrL = count(lower, MARATHI_LATN);
  const hiL = count(lower, HINGLISH);
  const en = count(lower, ENGLISH);
  if (mrL > 0 && mrL >= hiL) return LANG('mr-Latn', 'Marathi written in Roman/English letters', 'Latin', mrL >= 2 || en === 0 ? 'strong' : 'weak');
  if (hiL > 0 && hiL >= en) return LANG('hi-Latn', 'Hinglish (Hindi written in Roman/English letters)', 'Latin', hiL >= 2 || en === 0 ? 'strong' : 'weak');
  if (en > 0) return LANG('en', 'English', 'Latin', en >= 2 ? 'strong' : 'weak');
  if (hiL > 0) return LANG('hi-Latn', 'Hinglish (Hindi written in Roman/English letters)', 'Latin', 'weak');
  return LANG('en', 'English', 'Latin', 'weak');
}

/**
 * The language to reply in: the latest message when it is clear, otherwise
 * the most recent clear language from the customer's earlier messages
 * (newest first), otherwise the latest message's best guess.
 */
export function resolveLanguage(latest: string, earlierCustomerMessagesNewestFirst: string[] = []): DetectedLanguage {
  const now = detectLanguage(latest);
  if (now.confidence === 'strong') return now;
  for (const prev of earlierCustomerMessagesNewestFirst.slice(0, 8)) {
    const d = detectLanguage(prev);
    if (d.confidence === 'strong') {
      // A weak latest guess in the same script family yields to history.
      if (now.code === 'und' || now.script === d.script || now.script === 'Latin') return d;
    }
  }
  return now.code === 'und' ? LANG('en', 'English', 'Latin', 'weak') : now;
}

/** True when deterministic English/Hinglish templates already fit the customer. */
export function templatesFit(lang: DetectedLanguage): boolean {
  return lang.code === 'en' || lang.code === 'hi-Latn';
}

/** Prompt block that pins the reply language. */
export function languageInstruction(lang: DetectedLanguage): string {
  const name = lang.code === 'und' ? 'the same language the customer wrote in' : lang.name;
  const marathiNote =
    lang.code === 'mr'
      ? '\n- The customer writes MARATHI (मराठी), not Hindi. Use Marathi words and grammar (आहे, आणि, तुम्ही, करायची, पाहिजे, नाव, वय). Never answer in Hindi.'
      : lang.code === 'mr-Latn'
        ? '\n- The customer writes Marathi in Roman letters (e.g. "mala appointment pahije"). Reply in Marathi using Roman letters, not Hindi.'
        : lang.code === 'hi-Latn'
          ? '\n- Reply in Hinglish using Roman letters (e.g. "Ji bilkul, kal 5 baje ka slot free hai"), not Devanagari.'
          : '';
  return `### REPLY LANGUAGE (mandatory)
- Detected customer language: ${name}${lang.script !== 'Unknown' ? ` (${lang.script} script)` : ''}.
- Write your entire reply in ${name}, in the same script the customer uses. If the customer switches language, follow their latest message.${marathiNote}
- Keep names, doctor names, numbers, dates, times, prices, links and codes exactly as they are.`;
}

/** Converts Devanagari / other Indic / Arabic-Indic digits to ASCII. */
export function normalizeDigits(text: string): string {
  return (text || '').replace(/[०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯٠-٩۰-۹]/g, (ch) => {
    const cp = ch.codePointAt(0)!;
    for (const zero of [0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0660, 0x06f0]) {
      if (cp >= zero && cp <= zero + 9) return String(cp - zero);
    }
    return ch;
  });
}
