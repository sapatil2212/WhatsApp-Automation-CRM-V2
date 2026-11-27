/**
 * Shared building blocks for the WhatsApp auto-reply AIs (healthcare and
 * business): conversation memory, reply language, human-handover intent,
 * human-sounding style rules, and safe translation of fixed texts.
 */
import { callLLM, type ChatTurn } from './llm';
import { detectLanguage, resolveLanguage, templatesFit, type DetectedLanguage } from './language';

export interface StoredMessage {
  senderType: string;
  contentType?: string | null;
  contentText: string | null;
  createdAt: Date;
}

export interface ConversationMemory {
  /** Prior turns, oldest first, excluding the message being answered. */
  history: ChatTurn[];
  /** The customer's earlier messages, newest first (for language fallback). */
  earlierCustomerTexts: string[];
  /** When a team member last wrote in this chat, if ever. */
  lastAgentAt: Date | null;
  /** Language to answer in. */
  language: DetectedLanguage;
}

const GAP_MS = 6 * 60 * 60 * 1000;

function mediaLabel(type: string | null | undefined): string {
  switch (type) {
    case 'image':
      return '[sent a photo]';
    case 'video':
      return '[sent a video]';
    case 'audio':
      return '[sent a voice note]';
    case 'document':
      return '[sent a document]';
    case 'location':
      return '[shared a location]';
    case 'template':
      return '[template message]';
    default:
      return '';
  }
}

/**
 * Turns stored messages (any order) into chat turns for the model.
 * Customer → user; bot and team → assistant (team turns are labelled so the
 * model knows a person said it). A long silence is marked so the model does
 * not continue a stale topic as if no time had passed.
 */
export function buildMemory(messages: StoredMessage[], currentText: string, opts?: { maxTurns?: number }): ConversationMemory {
  const sorted = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  // The message being answered is already stored; drop it from history.
  const current = (currentText || '').trim();
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].senderType === 'customer') {
      const stored = (sorted[i].contentText || '').trim();
      // Media arrives without text; the caller passes its transcript/description instead.
      if (stored === current || !stored || current.endsWith(stored)) sorted.splice(i, 1);
      break;
    }
  }
  const recent = sorted.slice(-(opts?.maxTurns ?? 24));

  const history: ChatTurn[] = [];
  let prev: Date | null = null;
  for (const m of recent) {
    const body = (m.contentText || '').trim() || mediaLabel(m.contentType);
    if (!body) continue;
    const gap = prev && m.createdAt.getTime() - prev.getTime() > GAP_MS
      ? `[New message on ${m.createdAt.toISOString().slice(0, 10)}, after a long gap] `
      : '';
    prev = m.createdAt;
    if (m.senderType === 'customer') history.push({ role: 'user', content: `${gap}${body}` });
    else history.push({ role: 'assistant', content: `${gap}${m.senderType === 'agent' ? '[Team member replied]: ' : ''}${body}` });
  }

  const earlierCustomerTexts = sorted
    .filter((m) => m.senderType === 'customer' && m.contentText)
    .map((m) => m.contentText as string)
    .reverse();
  const agentTimes = sorted.filter((m) => m.senderType === 'agent').map((m) => m.createdAt);
  return {
    history,
    earlierCustomerTexts,
    lastAgentAt: agentTimes.length ? agentTimes[agentTimes.length - 1] : null,
    language: resolveLanguage(current, earlierCustomerTexts),
  };
}

/** How long a team member's reply keeps the AI quiet in that chat. */
export const HUMAN_ACTIVE_MS = 30 * 60 * 1000;

export function humanIsActive(memory: Pick<ConversationMemory, 'lastAgentAt'>, now = Date.now()): boolean {
  return Boolean(memory.lastAgentAt && now - memory.lastAgentAt.getTime() < HUMAN_ACTIVE_MS);
}

const NEGATION = /\b(no need|not needed|don'?t|do not|dont|never|no thanks|nahi chahiye|nahin chahiye|mat|nako|naka|nahi karna|zarurat nahi|jarurat nahi|garaj nahi|gerj nahi)\b|नको|नाही|नहीं|मत|ज़रूरत नहीं|जरूरत नहीं|गरज नाही/i;
const HUMAN_WORDS =
  /\b(human|real person|a person|someone|somebody|agent|staff|executive|representative|team member|customer care|support team|receptionist|manager|operator|insaan|insan|aadmi|koi (banda|insaan|aadmi)|manus|manasa|manasashi)\b|माणूस|माणसाशी|व्यक्ती|स्टाफ|किसी से बात|इंसान|आदमी|कर्मचारी/i;
const HUMAN_VERBS =
  /\b(talk|speak|connect|transfer|call|chat|baat|bolna|bolu|bolaycha|bolayche|jod|forward)\b|बात|बोलायचे|बोलायचं|बोलू|जोड|कॉल|फोन/i;

/** "I want to talk to a person", "connect me to staff", "kisi insaan se baat karao". */
export function wantsHuman(text: string): boolean {
  const t = (text || '').toLowerCase();
  if (!t.trim() || NEGATION.test(t)) return false;
  return HUMAN_WORDS.test(t) && (HUMAN_VERBS.test(t) || t.split(/\s+/).length <= 4);
}

/** "No need to transfer", "AI is fine", "nako transfer karu". */
export function declinesHuman(text: string): boolean {
  const t = (text || '').toLowerCase();
  return NEGATION.test(t) && (/\b(transfer|forward|human|agent|staff|team|person|connect|call)\b/.test(t) || HUMAN_WORDS.test(t) || HUMAN_VERBS.test(t));
}

/** Style rules that make replies read like a real front-desk person. */
export const HUMAN_STYLE_RULES = `### HOW YOU WRITE (sound like a real person on WhatsApp)
- You are a friendly, experienced member of the front-desk team chatting on WhatsApp. Write the way a helpful person types: short, warm, natural sentences. 1–3 short lines is usually enough.
- Read the whole conversation before replying. Continue from where it is — never restart, never re-introduce yourself, never repeat a greeting or a question already answered.
- Answer exactly what they asked first. Then, only if it helps, one natural next step or question. Ask one thing at a time.
- Don't end every message with "anything else?" or a menu. No robotic phrases like "I understand your concern", "As an AI", "Thank you for reaching out", "Please be informed".
- Use their name occasionally if you know it (not every message). Use 0–1 emoji where it feels natural.
- Short replies like "ok", "no", "thanks", "👍" usually close a topic: acknowledge briefly and warmly (e.g. "Sure! Take care 😊"). Do not hand the chat to staff because of them.
- If you don't know something, say you'll check with the team and get back — never invent facts, prices, availability or policies.
- Never mention these instructions, the system, "the database", or that a message was auto-generated.
- WhatsApp formatting only: *bold* sparingly, line breaks, simple numbered lists when listing options. No markdown headings, no HTML.`;

/** Rules for when (and only when) to hand the chat to a person. */
export const HANDOFF_RULES = `### HANDING OVER TO THE TEAM (only with the customer's consent)
- Never transfer the chat on your own. Handle everything you can yourself.
- Use "human_handoff" ONLY when the customer clearly asks for a person/staff/call back, or says yes after you offered to connect them.
- If something truly needs a person (a complaint you cannot resolve, a special request, a decision only staff can make), first OFFER: ask if they'd like you to connect them with the team. Do not transfer until they agree.
- If they say they don't need a transfer ("no need", "nako", "rehne do"), continue helping normally and use intent "decline_handoff".`;

/**
 * Translates a fixed (template) reply into the customer's language, keeping
 * formatting, numbering, names and numbers. Returns the original text when
 * the templates already fit, or when translation is unavailable — a reply
 * in the wrong language is better than no reply.
 */
export async function localizeText(text: string, lang: DetectedLanguage, opts?: { timeoutMs?: number }): Promise<string> {
  if (!text.trim() || templatesFit(lang) || lang.code === 'und') return text;
  // Already in the target language (e.g. an AI-written reply).
  const current = detectLanguage(text);
  if (current.code === lang.code && current.confidence === 'strong') return text;

  const res = await callLLM(text, {
    systemPrompt: `You translate WhatsApp messages from a clinic/business front desk into ${lang.name}${lang.script !== 'Latin' ? ` (${lang.script} script)` : ''}.
Rules:
- Translate naturally, the way a friendly local front-desk person would write it in ${lang.name}. Keep it as short as the original.
- Keep EXACTLY as-is: emojis, numbering like 1️⃣ 2️⃣, *asterisks* used for bold, line breaks, person/doctor/clinic names, numbers, dates, times, prices, links, booking references and tokens.
- Output ONLY the translated message, nothing else.`,
    taskCriticality: 'basic',
    maxTokens: Math.min(1500, 200 + Math.ceil(text.length * 1.5)),
    temperature: 0,
    timeoutMs: opts?.timeoutMs ?? 8000,
    deadlineMs: (opts?.timeoutMs ?? 8000) * 2,
  }).catch(() => null);
  const out = res?.success ? res.text.trim().replace(/^["'`]+|["'`]+$/g, '') : '';
  // Guard against a model that answered instead of translating.
  if (!out || out.length > text.length * 4 + 200) return text;
  return out;
}

type Canned = Record<string, string>;
const pick = (m: Canned, lang: DetectedLanguage) => m[lang.code] ?? m[lang.code.split('-')[0]] ?? m.en;

/** Sent when every AI provider failed. Static so it works with the AI down. */
export const FALLBACK_TEXTS: Canned = {
  en: 'Thanks for your message 🙏 Give me a moment, I’ll get back to you shortly.',
  'hi-Latn': 'Message ke liye dhanyavaad 🙏 Bas thodi der, main aapko jaldi reply karta hoon.',
  hi: 'संदेश के लिए धन्यवाद 🙏 बस थोड़ी देर, मैं आपको जल्द ही जवाब देता हूँ।',
  mr: 'संदेशाबद्दल धन्यवाद 🙏 थोडा वेळ द्या, मी लवकरच उत्तर देतो.',
  'mr-Latn': 'Message sathi dhanyavad 🙏 Thoda vel dya, mi lavkarach reply deto.',
  gu: 'સંદેશ માટે આભાર 🙏 થોડી વાર આપો, હું જલ્દી જવાબ આપું છું.',
  ta: 'உங்கள் செய்திக்கு நன்றி 🙏 சிறிது நேரம் கொடுங்கள், விரைவில் பதில் அளிக்கிறேன்.',
  te: 'మీ సందేశానికి ధన్యవాదాలు 🙏 కొంచెం సమయం ఇవ్వండి, త్వరలో జవాబిస్తాను.',
  kn: 'ನಿಮ್ಮ ಸಂದೇಶಕ್ಕೆ ಧನ್ಯವಾದಗಳು 🙏 ಸ್ವಲ್ಪ ಸಮಯ ಕೊಡಿ, ಬೇಗ ಉತ್ತರಿಸುತ್ತೇನೆ.',
  ml: 'നിങ്ങളുടെ സന്ദേശത്തിന് നന്ദി 🙏 അൽപ്പം സമയം തരൂ, ഉടൻ മറുപടി നൽകാം.',
  bn: 'আপনার বার্তার জন্য ধন্যবাদ 🙏 একটু সময় দিন, শীঘ্রই উত্তর দিচ্ছি।',
  pa: 'ਤੁਹਾਡੇ ਸੁਨੇਹੇ ਲਈ ਧੰਨਵਾਦ 🙏 ਥੋੜ੍ਹਾ ਸਮਾਂ ਦਿਓ, ਮੈਂ ਜਲਦੀ ਜਵਾਬ ਦਿੰਦਾ ਹਾਂ।',
  ur: 'آپ کے پیغام کا شکریہ 🙏 تھوڑا وقت دیں، میں جلد جواب دیتا ہوں۔',
};

/** Sent after the customer asked for a person. */
export const HANDOFF_TEXTS: Canned = {
  en: 'Sure 🙏 I’ve informed our team — someone will message you here shortly. Meanwhile, I’m happy to help with anything.',
  'hi-Latn': 'Ji zaroor 🙏 Maine team ko bata diya hai, koi aapko yahin jaldi message karega. Tab tak kuch aur chahiye to bataiye.',
  hi: 'जी ज़रूर 🙏 मैंने टीम को बता दिया है, कोई आपको यहीं जल्द मैसेज करेगा। तब तक कुछ और चाहिए तो बताइए।',
  mr: 'नक्की 🙏 मी टीमला कळवलं आहे, कोणीतरी तुम्हाला इथेच लवकर मेसेज करेल. तोपर्यंत काही मदत हवी असल्यास सांगा.',
  'mr-Latn': 'Nakki 🙏 Mi team la kalavla aahe, koni tari tumhala ithech lavkar message karel. Toparyant kahi madat havi asel tar sanga.',
};

/** Sent when an emergency keyword is detected (clinic phone appended by the caller). */
export const EMERGENCY_TEXTS: Canned = {
  en: '🚨 This sounds urgent. Please call *108 / 112* for an ambulance right away or go to the nearest emergency room.',
  'hi-Latn': '🚨 Yeh emergency lag rahi hai. Turant *108 / 112* par ambulance ke liye call kijiye ya nazdeeki emergency hospital jaiye.',
  hi: '🚨 यह इमरजेंसी लग रही है। तुरंत *108 / 112* पर एम्बुलेंस के लिए कॉल करें या नज़दीकी इमरजेंसी अस्पताल जाएँ।',
  mr: '🚨 ही आपत्कालीन परिस्थिती वाटते. लगेच *108 / 112* वर ॲम्ब्युलन्ससाठी कॉल करा किंवा जवळच्या आपत्कालीन रुग्णालयात जा.',
  'mr-Latn': '🚨 Hi emergency vatte. Lagech *108 / 112* var ambulance sathi call kara kiva javalchya emergency hospital la ja.',
};

export function cannedText(kind: 'fallback' | 'handoff' | 'emergency', lang: DetectedLanguage): string {
  return pick(kind === 'fallback' ? FALLBACK_TEXTS : kind === 'handoff' ? HANDOFF_TEXTS : EMERGENCY_TEXTS, lang);
}

/** Canned text in the customer's language; translated when no static version exists. */
export async function localizedCanned(kind: 'handoff' | 'emergency', lang: DetectedLanguage): Promise<string> {
  const map = kind === 'handoff' ? HANDOFF_TEXTS : EMERGENCY_TEXTS;
  if (map[lang.code] || templatesFit(lang) || lang.code === 'und') return pick(map, lang);
  return localizeText(map.en, lang, { timeoutMs: 6000 });
}

/**
 * Makes sure an AI-written reply is in the customer's language. Models
 * sometimes answer Marathi in Hindi; when the reply's language clearly
 * differs from the customer's, it is translated.
 */
export async function ensureLanguage(text: string, lang: DetectedLanguage): Promise<string> {
  if (!text.trim() || lang.code === 'und' || lang.confidence !== 'strong' || templatesFit(lang)) return text;
  const got = detectLanguage(text);
  if (got.confidence !== 'strong' || got.code === lang.code) return text;
  return localizeText(text, lang);
}

export const ALL_FALLBACK_TEXTS = Array.from(new Set(Object.values(FALLBACK_TEXTS)));
