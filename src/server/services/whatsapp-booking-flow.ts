/**
 * Conversational WhatsApp appointment booking for clinics.
 *
 * Works like a receptionist chatting, not a form: every message is mined for
 * whatever the patient already said — name, age, department, doctor, date,
 * time — and only the details still missing are asked for, in plain words.
 *
 *   "Hi, I want to book for tomorrow"      → asks name + age + doctor at once
 *   "Swapnil Patil 26"                      → name and age in one go
 *   "Dentist" / "Dr. Patil" / "2"           → list pick, name or specialty
 *   "20 nov", "kal", "5:30 pm", "shaam 6"   → dates and times in free text
 *
 * The department question appears only when the clinic has configured
 * departments with more than one choice; a single doctor is picked
 * automatically. Picking a free slot books the appointment.
 *
 * State lives in `Conversation.bookingState` ({ flow: 'wizard', ... }). Step
 * logic is pure; lookups (and the optional LLM extractor for messy
 * messages) come through the `FlowData` port, so it is unit-tested without
 * a database or network.
 */

export type Field = 'patient' | 'department' | 'doctor' | 'date' | 'time' | 'appointment' | 'confirm_cancel';
export type Lang = 'en' | 'hi';

export interface WizardState {
  flow: 'wizard';
  updatedAt: number;
  invalid: number;
  lang: Lang;
  name?: string;
  age?: string;
  departmentId?: string;
  departmentName?: string;
  doctorId?: string;
  doctorName?: string;
  date?: string;
  time?: string;
  /** Time mentioned before the slots were known ("17:00", or "05:00?" when am/pm was not said). */
  wantedTime?: string;
  /** What we asked last, and the values behind any numbered list shown. */
  awaiting?: Field;
  /** 'reschedule' / 'cancel' when managing an existing appointment. */
  mode?: 'book' | 'reschedule' | 'cancel';
  /** The existing appointment being rescheduled or cancelled. */
  targetId?: string;
  targetLabel?: string;
  options?: string[];
  /** Follow-up reminders sent while the patient was away (see booking-followup.ts). */
  reminders?: number;
  /** When the last reminder went out (ms). */
  remindedAt?: number;
  /** The patient message (createdAt ms) the reminder cycle belongs to. */
  reminderFor?: number;
}

export interface FlowDepartment {
  id: string;
  name: string;
  doctorCount: number;
}
export interface FlowDoctor {
  id: string;
  name: string;
  departmentIds: string[];
  specialization: string | null;
  qualification: string | null;
  experience: string | null;
  fee: number;
}
export interface FlowDay {
  date: string;
  slots: string[];
  closedReason: string | null;
}

/** Loose fields an extractor (rules or LLM) found in a message. */
export interface Extracted {
  name?: string;
  age?: string;
  department?: string;
  doctor?: string;
  date?: string;
  time?: string;
  isQuestion?: boolean;
}
type Found = Extracted & { meridiem?: boolean };

export interface FlowData {
  clinicName: string;
  contactName: string | null;
  today: string;
  /** Configured, active departments only (empty when the clinic has none). */
  departments(): Promise<FlowDepartment[]>;
  doctors(): Promise<FlowDoctor[]>;
  availability(doctorId: string, from: string, days: number): Promise<FlowDay[]>;
  /** Optional AI extractor for messages the rules can't read. */
  /** The patient's upcoming scheduled appointments (for cancel / reschedule). */
  upcoming?(): Promise<UpcomingAppointment[]>;
  extract?(message: string, hint: { today: string; departments: string[]; doctors: string[]; awaiting?: Field }): Promise<Extracted | null>;
}

export interface UpcomingAppointment {
  id: string;
  ref: string;
  doctorId: string | null;
  doctorName: string | null;
  departmentId: string | null;
  date: string;
  time: string;
  patientName: string | null;
  patientAge: string | null;
}

export type FlowResult =
  | { kind: 'reply'; text: string; state: WizardState }
  | { kind: 'exit'; text: string }
  /** Not about the booking — let the regular AI answer (state kept when given). */
  | { kind: 'release'; state?: WizardState }
  /** Book a new appointment — or move `state.targetId` when mode is 'reschedule'. */
  | { kind: 'book'; state: WizardState }
  | { kind: 'cancel'; state: WizardState };

export const WIZARD_TTL_MS = 30 * 60 * 1000;
const MAX_INVALID = 3;
const DATE_LOOKAHEAD_DAYS = 21;
const SLOTS_SHOWN = 24;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUM_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

// ── intent & session ─────────────────────────────────────────────────

/** "I want to book", "appointment chahiye", "doctor ko dikhana hai"… but not cancel/reschedule/fee questions. */
export function isBookingRequest(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(cancel\w*|reschedul\w*|postpon\w*|prepon\w*|change|shift|status|fees?|price|cost|charges?|timings?)\b/.test(t)) return false;
  return (
    /\b(book|booking|appointment|appoinment|apointment|appt|schedule|consult|consultation|visit)\b/.test(t) ||
    /(milna|dikhana|dikhane|checkup|check-up|check up|dakhvaycha|dakhvaych|tapasni)\b/.test(t) ||
    // Native-script spellings (Marathi/Hindi/Gujarati…): "अपॉइंटमेंट", "बुक करायची", "दाखवायचे".
    /(अपॉइ|अपॉई|अपोइ|अपाइ|एपॉइ|ऍपॉ|अपॉंट|बुक कर|बुकिंग|दाखवाय|दिखाना|दिखाने|तपासणी|चेकअप|એપોઇ|એપોઈ|બુક|অ্যাপয়|அப்பாயின்|అపాయిం|ಅಪಾಯಿಂ)/.test(text)
  );
}

const APPT_WORDS = /(appoint|appoinment|apointment|appt|booking|visit|slot)/;
/** "cancel my appointment", "appointment cancel karna hai". */
export function isCancelRequest(text: string): boolean {
  const t = text.toLowerCase();
  const cancelWord = /\bcancel\w*\b/.test(t) || /(रद्द|कॅन्सल|कैंसल)/.test(t);
  return cancelWord && (APPT_WORDS.test(t) || /(अपॉ|अपो|भेट)/.test(t) || t.split(/\s+/).length <= 4);
}
/** "reschedule", "change my appointment time", "appointment postpone karna hai". */
export function isRescheduleRequest(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(reschedul\w*|re-schedul\w*|postpon\w*|prepon\w*)\b/.test(t)) return true;
  return /\b(change|shift|move|badalna|badal)\b/.test(t) && (APPT_WORDS.test(t) || /\b(date|time|timing)\b/.test(t));
}

/** A booking we reminded the patient about can be resumed for a day (WhatsApp's reply window). */
export const REMINDED_WIZARD_TTL_MS = 24 * 60 * 60 * 1000;

export function isActiveWizard(v: unknown, now = Date.now()): v is WizardState {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<WizardState>;
  if (s.flow !== 'wizard' || typeof s.updatedAt !== 'number') return false;
  const ttl = s.reminders ? REMINDED_WIZARD_TTL_MS : WIZARD_TTL_MS;
  return now - s.updatedAt < ttl;
}

const YES_AFTER_REMINDER = /^(yes|yeah|yep|ya|yup|ok|okay|okk|sure|continue|go ahead|haan|han|ha|ho|hoy|chalel|chalega|theek hai|thik hai|ji|ji haan|haan ji|bilkul|nakki|👍)\W*$/i;
const YES_AFTER_REMINDER_NATIVE = /^(हो|होय|हाँ|हां|जी|ठीक आहे|ठीक है|चालेल|चलेगा|नक्की|बिल्कुल)[\s!.।]*$/;
const NO_AFTER_REMINDER = /^(no|nope|nah|not now|later|nahi|nahin|nako|nko|rehne do|rahu de|abhi nahi|nantar)\W*$/i;
const NO_AFTER_REMINDER_NATIVE = /^(नको|नाही|नहीं|नही|नंतर|बाद में|रहने दो|राहू दे)[\s!.।]*$/;

const HINGLISH = /\b(hai|hain|kal|parso|chahiye|chaiye|karna|krna|karni|mujhe|muje|mera|meri|naam|umar|umr|saal|kab|kya|haan|nahi|aap|dikhana|baje|subah|shaam|sham|ji)\b/;
export function detectLang(text: string, fallback: Lang = 'en'): Lang {
  const t = text.toLowerCase();
  if (/[ऀ-ॿ]/.test(t) || HINGLISH.test(t)) return 'hi';
  if (/\b(the|please|want|need|my|is|am|book|appointment|tomorrow|today)\b/.test(t)) return 'en';
  return fallback;
}

const isCancel = (t: string) =>
  t.split(/\s+/).length <= 4 &&
  (/^(cancel|stop|exit|quit|no thanks|nahi chahiye|rehne do|band karo|nako|nko|rahu de|rahude|cancel kara|cancel karo)\b/.test(t) ||
    /^(नको|रद्द|राहू दे|रहने दो|नहीं चाहिए|बंद करो|कॅन्सल|कैंसल)/.test(t));
const looksLikeQuestion = (raw: string) =>
  /\?\s*$/.test(raw) || /^(what|how|where|when|which|why|who|is|are|do|does|can|kya|kab|kaha|kahan|kitna|kitne|kaise)\b/i.test(raw.trim());

// ── formatting ───────────────────────────────────────────────────────

export function drName(n: string): string {
  return /^dr\.?\s/i.test(n.trim()) ? n.trim() : `Dr. ${n.trim()}`;
}
const num = (i: number) => NUM_EMOJI[i] ?? `${i + 1}.`;
export function prettyDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export function prettyTime12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
function addDays(d: string, n: number): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
const firstName = (n?: string) => (n ?? '').trim().split(/\s+/)[0] ?? '';
const titleCase = (s: string) => s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
function dayLabel(d: string, today: string, lang: Lang): string {
  if (d === today) return lang === 'hi' ? `aaj (${prettyDate(d)})` : `today (${prettyDate(d)})`;
  if (d === addDays(today, 1)) return lang === 'hi' ? `kal (${prettyDate(d)})` : `tomorrow (${prettyDate(d)})`;
  return prettyDate(d);
}

// ── parsing ──────────────────────────────────────────────────────────

/** Picks a numbered option ("2", "2️⃣", "option 2") or a fuzzy label match. */
export function pickOption<T>(input: string, items: T[], label: (x: T) => string): T | null {
  const t = input.trim().toLowerCase();
  const n = /^(?:option\s*|no\.?\s*)?(\d{1,2})(?:️?⃣)?\.?$/.exec(t);
  if (n) return items[Number(n[1]) - 1] ?? null;
  const clean = (s: string) => s.toLowerCase().replace(/^dr\.?\s*/, '').replace(/[^a-z0-9ऀ-ॿ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const q = clean(t);
  if (q.length < 2) return null;
  const exact = items.filter((x) => clean(label(x)) === q);
  if (exact.length === 1) return exact[0];
  const partial = items.filter((x) => clean(label(x)).includes(q) || q.includes(clean(label(x))));
  return partial.length === 1 ? partial[0] : null;
}

/** Free-text date → YYYY-MM-DD (today, tomorrow/kal, parso, weekday, "25 nov", "25/11", ISO). */
export function parseDate(input: string, today: string): string | null {
  const t = input.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/\s+/g, ' ');
  if (/^(today|aaj|aj)$/.test(t)) return today;
  if (/^(tomorrow|tmrw|tmr|kal)$/.test(t)) return addDays(today, 1);
  if (/^(day after tomorrow|parso|parson)$/.test(t)) return addDays(today, 2);
  const wd = WEEKDAYS.findIndex((w) => [w, w.slice(0, 3), `next ${w}`, `this ${w}`, `coming ${w}`].includes(t));
  if (wd >= 0) {
    const cur = new Date(`${today}T00:00:00Z`).getUTCDay();
    let diff = (wd - cur + 7) % 7;
    if (diff === 0 || t.startsWith('next')) diff = diff || 7;
    return addDays(today, diff);
  }
  const ty = Number(today.slice(0, 4));
  const build = (y: number, m: number, d: number): string | null => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) return null;
    return iso < today && y === ty ? build(y + 1, m, d) : iso; // "5 jan" asked in Nov → next year
  };
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(t);
  if (m) return build(m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : ty, Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})\s*([a-z]{3,9})(?:\s*(\d{4}))?$/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3));
    if (mi >= 0) return build(m[3] ? Number(m[3]) : ty, mi + 1, Number(m[1]));
  }
  m = /^([a-z]{3,9})\s*(\d{1,2})(?:\s*(\d{4}))?$/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3));
    if (mi >= 0) return build(m[3] ? Number(m[3]) : ty, mi + 1, Number(m[2]));
  }
  return null;
}

// Time-of-day and "o'clock" words in English, Hindi/Hinglish and Marathi (Roman + Devanagari).
const MORNING_WORDS = 'subah|subha|savere|sakali|sakaali|sakal|morning|सकाळी|सकाळ|सुबह|सवेरे';
const AFTERNOON_WORDS = 'dopahar|dophar|dupari|dupaari|dupar|afternoon|noon|दुपारी|दुपार|दोपहर';
const EVENING_WORDS = 'shaam|sham|saam|sandhyakali|sandhyakaali|sandhyakal|evening|संध्याकाळी|संध्याकाळ|शाम';
const NIGHT_WORDS = 'raat|rat|ratri|night|रात्री|रात';
const PERIOD_WORDS = `${MORNING_WORDS}|${AFTERNOON_WORDS}|${EVENING_WORDS}|${NIGHT_WORDS}`;
const OCLOCK_WORDS = "baje|bje|bajey|vajta|vajata|vaajta|vajle|vaje|wajta|o'?clock|वाजता|वाजे|बजे";
const hasWord = (t: string, words: string) => new RegExp(`(?<!\\p{L})(?:${words})(?!\\p{L})`, 'iu').test(t);

/**
 * "5:30 pm", "17:30", "5pm", "5.30 PM", "subah 10", "shaam 6 baje",
 * "sakali 11 vajta", "दुपारी 2 वाजता" → HH:MM.
 */
export function parseTime(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/a\.m\.?/g, 'am').replace(/p\.m\.?/g, 'pm');
  const period = hasWord(raw, MORNING_WORDS)
    ? 'am'
    : hasWord(raw, AFTERNOON_WORDS)
      ? 'afternoon'
      : hasWord(raw, EVENING_WORDS) || hasWord(raw, NIGHT_WORDS)
        ? 'pm'
        : null;
  const t = raw
    .replace(new RegExp(`(?<!\\p{L})(?:${PERIOD_WORDS}|${OCLOCK_WORDS}|ko|ke|la|ला|को|at|around|la)(?!\\p{L})`, 'giu'), ' ')
    .replace(/\s+/g, '');
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ampm = m[3] ?? (period === 'afternoon' ? (h >= 1 && h <= 7 ? 'pm' : null) : period);
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** "5:00" with no am/pm → the matching free slot (17:00 if only that exists). */
export function matchSlot(time: string, slots: string[], hadMeridiem: boolean): string | null {
  if (slots.includes(time)) return time;
  if (!hadMeridiem) {
    const [h, mm] = time.split(':').map(Number);
    if (h < 12) {
      const alt = `${String(h + 12).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      if (slots.includes(alt)) return alt;
    }
  }
  return null;
}

const STOP_WORDS = new Set(
  (
    "hi hello hey hii hlo namaste good morning evening afternoon i im i'm want wanna would like to book booking an a appointment appointments appt for my me mine name is am age aged years year yrs yr old please pls plz the patient with dr doctor doc and at on of in tomorrow today day " +
    'mera meri mujhe naam nam name hai hain hu hoon hun main mai aur or evam tatha umar umr uma umer umra ummar saal sal sala ka ki ke ko se karna krna karni karwani karani chahiye chaiye ji haan ha department dept consult consultation visit sir madam mam ok okay yes thanks thank you slot time date check checkup need get'
  ).split(/\s+/),
);

const norm = (s: string) => s.toLowerCase().replace(/^dr\.?\s*/, '').replace(/[^a-z0-9ऀ-ॿ ]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => norm(s).split(' ').filter(Boolean);
/** Loose word match on a shared stem ("dental" ~ "dentistry", "derma" ~ "dermatology"). */
function wordHit(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return a.slice(0, 4) === b.slice(0, 4);
}

/** Rule-based extraction of booking details from one message. */
export function extractRules(raw: string, ctx: { today: string; departments: FlowDepartment[]; doctors: FlowDoctor[]; awaiting?: Field }): Found {
  const out: Found = {};
  let rest = ` ${raw.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1')} `;
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean) => {
    const m = re.exec(rest);
    if (m && fn(m)) rest = rest.replace(m[0], ' ');
  };

  // Dates
  const datePatterns = [
    /\b(day after tomorrow|parso|parson)\b/,
    /\b(today|aaj|tomorrow|tmrw|tmr|kal)\b/,
    /\b(?:next |this |coming )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
    new RegExp(`\\b\\d{1,2}\\s*${MONTH_RE}(?:\\s*\\d{4})?\\b`),
    new RegExp(`\\b${MONTH_RE}\\s*\\d{1,2}(?:\\s*\\d{4})?\\b`),
    /\b\d{4}-\d{2}-\d{2}\b/,
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
  ];
  for (const re of datePatterns) {
    if (out.date) break;
    take(re, (m) => {
      const d = parseDate(m[0].trim(), ctx.today);
      if (d) out.date = d;
      return Boolean(d);
    });
  }

  // Times (need am/pm, a colon, or a time-of-day / o'clock word, so "26" stays an age)
  const N = '\\d{1,2}(?:[:.]\\d{2})?';
  const timePatterns = [
    // "sakali 11 vajta", "shaam 6 baje", "दुपारी 2 वाजता"
    new RegExp(`(?<!\\p{L})(?:${PERIOD_WORDS})\\s*(?:la\\s*|ko\\s*|at\\s*)?${N}\\s*(?:${OCLOCK_WORDS})?(?!\\p{L})`, 'iu'),
    // "11 vajta sakali", "6 baje shaam", "11 sakali"
    new RegExp(`(?<![\\p{L}\\d])${N}\\s*(?:${OCLOCK_WORDS})?\\s*(?:${PERIOD_WORDS})(?!\\p{L})`, 'iu'),
    /\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|a\.m\.?|p\.m\.?)(?![a-z])/,
    /\b\d{1,2}:\d{2}\b/,
    // "11 vajta", "5 baje", "11 o'clock"
    new RegExp(`(?<![\\p{L}\\d])${N}\\s*(?:${OCLOCK_WORDS})(?!\\p{L})`, 'iu'),
  ];
  for (const re of timePatterns) {
    if (out.time) break;
    take(re, (m) => {
      const tm = parseTime(m[0]);
      if (tm) {
        out.time = tm;
        out.meridiem = /(am|pm|a\.m|p\.m)/.test(m[0]) || hasWord(m[0], PERIOD_WORDS);
      }
      return Boolean(tm);
    });
  }

  // Doctor by name. "Dr X"/"doctor X" marks it explicitly; without the
  // marker a name only counts when we're not asking for the patient's name
  // (a patient can share a doctor's name).
  const used = new Set<string>();
  let docWords: string[] = [];
  take(/\b(?:dr\.?|doctor|doc)\s+([a-z\u0900-\u097f]+(?:\s+[a-z\u0900-\u097f]+)?)/, (m) => {
    docWords = words(m[1]);
    return true;
  });
  if (!docWords.length && ctx.awaiting !== 'patient') docWords = words(rest);
  const docScore = ctx.doctors
    .map((d) => {
      const hits = words(d.name).filter((w) => w.length >= 3 && docWords.includes(w));
      return { d, hits, score: hits.length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (docScore.length === 1 || (docScore.length > 1 && docScore[0].score > docScore[1].score)) {
    out.doctor = docScore[0].d.name;
    docScore[0].hits.forEach((w) => used.add(w));
  } else if (docScore.length > 1) {
    out.doctor = `?${docScore.filter((x) => x.score === docScore[0].score).map((x) => x.d.id).join(',')}`;
    docScore[0].hits.forEach((w) => used.add(w));
  }

  // Department (configured) — or a doctor's specialty when there are none
  const textWords = words(rest).filter((w) => !used.has(w));
  const deptHits = ctx.departments.filter((d) => words(d.name).some((dw) => textWords.some((w) => wordHit(w, dw))));
  if (deptHits.length === 1) {
    out.department = deptHits[0].name;
    textWords.filter((w) => words(deptHits[0].name).some((dw) => wordHit(w, dw))).forEach((w) => used.add(w));
  }
  if (!ctx.departments.length && (!out.doctor || out.doctor.startsWith('?'))) {
    const ids = out.doctor?.startsWith('?') ? out.doctor.slice(1).split(',') : null;
    const pool = ids ? ctx.doctors.filter((d) => ids.includes(d.id)) : ctx.doctors;
    const bySpec = pool.filter((d) => d.specialization && words(d.specialization).some((sw) => textWords.some((w) => wordHit(w, sw))));
    if (bySpec.length === 1) {
      out.doctor = bySpec[0].name;
      textWords.filter((w) => words(bySpec[0].specialization!).some((sw) => wordHit(w, sw))).forEach((w) => used.add(w));
    }
  }

  // Age: explicit ("26 years", "age 26", "26 saal")
  take(/\b(?:age|umar|umr)\s*(?:is|hai|:)?\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:years?|yrs?|yr|y\/o|saal|sal)\b(?:\s*old)?/, (m) => {
    const n = Number(m[1] ?? m[2]);
    if (n >= 0 && n <= 120) out.age = String(n);
    return out.age !== undefined;
  });

  // Name: explicit phrase, or leftover words when we asked for patient details
  const explicit = /\b(?:my name is|name is|i am|i'm|this is|mera naam|mera nam|my name|naam|name|nam)\s+(?:hai\s+)?([a-zऀ-ॿ][a-zऀ-ॿ .]{1,40}?)(?=\s*(?:,|\.|\band\b|\baur\b|\bage\b|\bum(?:a|ar|r|er|ra)\b|\d|\bhai\b|\bhu\b|\bhoon\b|$))/.exec(rest);
  const leftover = (explicit ? explicit[1] : rest).replace(/[^a-zऀ-ॿ\d ]/g, ' ').split(/\s+/).filter(Boolean);
  const nameContext = Boolean(explicit) || ctx.awaiting === 'patient';
  if (!out.age && nameContext) {
    const bare = (explicit ? rest : leftover.join(' ')).match(/\b\d{1,3}\b/g)?.map(Number).filter((n) => n > 0 && n <= 120) ?? [];
    if (bare.length === 1) out.age = String(bare[0]);
  }
  const nameWords = leftover.filter((w) => !/\d/.test(w) && !STOP_WORDS.has(w) && !used.has(w) && w.length >= 2);
  if (nameContext && nameWords.length >= 1 && nameWords.length <= 4) {
    out.name = titleCase(nameWords.join(' '));
  } else if (explicit && nameWords.length >= 1 && nameWords.length <= 4) {
    out.name = titleCase(nameWords.join(' '));
  }

  out.isQuestion = looksLikeQuestion(raw);
  return out;
}

// ── replies (English / Hinglish) ─────────────────────────────────────

const T = {
  askBoth: { en: 'Sure! 😊 Could you please tell me the patient\'s *name* and *age*?', hi: 'Ji zaroor! 😊 Patient ka *naam* aur *umar* bata dijiye.' },
  askName: { en: "May I have the patient's *full name*, please?", hi: 'Patient ka *poora naam* bata dijiye.' },
  askAge: { en: (n: string) => `Thanks${n ? ` ${n}` : ''}! And the patient's *age*?`, hi: (n: string) => `Shukriya${n ? ` ${n}` : ''}! Patient ki *umar* kitni hai?` },
  plusChoose: { en: ' Also, ', hi: ' Saath hi, ' },
  askDept: {
    en: (n: string) => `${n ? `Okay ${n}, ` : ''}which *department* would you like to book with?`,
    hi: (n: string) => `${n ? `Theek hai ${n}, ` : ''}kis *department* mein appointment chahiye?`,
  },
  askDoctor: {
    en: (n: string, dept?: string) => `${n ? `Okay ${n}, ` : ''}${dept ? `for *${dept}*, ` : ''}which *doctor* would you like to see?`,
    hi: (n: string, dept?: string) => `${n ? `Theek hai ${n}, ` : ''}${dept ? `*${dept}* mein ` : ''}kaunse *doctor* ko dikhana hai?`,
  },
  docAuto: { en: (doc: string) => `*${doc}* will see you. `, hi: (doc: string) => `Aapko *${doc}* dekhenge. ` },
  askDate: {
    en: (n: string, next: string, doc = '') => `${n ? `Okay ${n}! ` : ''}Which *date* works for you${doc ? ` with ${doc}` : ''}?${next ? `\nNext available: ${next}` : ''}`,
    hi: (n: string, next: string, doc = '') => `${n ? `Theek hai ${n}! ` : ''}${doc ? `${doc} ke liye ` : ''}kaunsi *date* theek rahegi?${next ? `\nAgle available din: ${next}` : ''}`,
  },
  noDate: {
    en: (doc: string, d: string) => `Sorry, ${doc} isn't available on ${d}.`,
    hi: (doc: string, d: string) => `Maaf kijiye, ${doc} ${d} ko available nahi hain.`,
  },
  otherDate: { en: (next: string) => ` Could you pick another date? Next available: ${next}`, hi: (next: string) => ` Koi aur date bataiye. Agle available din: ${next}` },
  noneSoon: {
    en: (doc: string) => `Sorry, ${doc} has no free slots in the next 3 weeks. Would you like to see another doctor?`,
    hi: (doc: string) => `Maaf kijiye, ${doc} ke agle 3 hafte mein koi slot khaali nahi hai. Kisi aur doctor ko dikhana chahenge?`,
  },
  askTime: { en: (doc: string, d: string) => `Here are the available times with ${doc} on *${d}*:`, hi: (doc: string, d: string) => `${doc} ke *${d}* ke available time:` },
  pickTime: { en: 'Just reply with the number or the time. 🙂', hi: 'Number ya time bhej dijiye. 🙂' },
  timeTaken: { en: (t: string) => `${t} isn't available. `, hi: (t: string) => `${t} khaali nahi hai. ` },
  cancelled: { en: 'No problem, I have stopped the booking. 🙏 Just message me whenever you want to book.', hi: 'Koi baat nahi, booking rok di hai. 🙏 Jab bhi appointment chahiye, message kar dijiye.' },
  noDoctors: { en: "Sorry, online booking isn't available right now. Our team will help you shortly. 🙏", hi: 'Maaf kijiye, abhi online booking available nahi hai. Hamari team jaldi aapki madad karegi. 🙏' },
  didntGet: { en: "Sorry, I didn't quite get that. ", hi: 'Maaf kijiye, samajh nahi aaya. ' },
  past: { en: 'That date has already passed. ', hi: 'Woh date nikal chuki hai. ' },
  noUpcoming: {
    en: "I couldn't find any upcoming appointment booked from this number. 🤔 Would you like to book a new one? Just say *book appointment*.",
    hi: 'Is number se koi upcoming appointment nahi mila. 🤔 Naya appointment book karna ho to *book appointment* likhiye.',
  },
  pickAppt: {
    en: (what: string) => `Which appointment would you like to ${what}?`,
    hi: (what: string) => `Kaunsa appointment ${what === 'cancel' ? 'cancel' : 'reschedule'} karna hai?`,
  },
  confirmCancel: {
    en: (label: string) => `Just to confirm, cancel your appointment with ${label}?\n\n1️⃣ Yes, cancel it\n2️⃣ No, keep it`,
    hi: (label: string) => `Confirm kar dijiye, ${label} wala appointment cancel karna hai?\n\n1️⃣ Haan, cancel karo\n2️⃣ Nahi, rehne do`,
  },
  keepAppt: { en: 'No problem, your appointment stays as it is. 🙂', hi: 'Theek hai, aapka appointment waise hi rahega. 🙂' },
  moving: {
    en: (label: string) => `Sure, let's move your appointment with ${label}. `,
    hi: (label: string) => `Zaroor, ${label} wala appointment shift karte hain. `,
  },
  more: { en: (n: number) => `\n…and ${n} more. Type a time like 6:30 PM.`, hi: (n: number) => `\n…aur ${n} slots. Time likhiye, jaise 6:30 PM.` },
};

// ── core ─────────────────────────────────────────────────────────────

interface Ctx {
  departments: FlowDepartment[];
  doctors: FlowDoctor[];
}

async function loadCtx(data: FlowData): Promise<Ctx> {
  const [departments, doctors] = await Promise.all([data.departments(), data.doctors()]);
  return { departments: departments.filter((d) => d.doctorCount > 0), doctors };
}

const needsDepartment = (ctx: Ctx) => ctx.departments.length > 1;
function doctorsIn(ctx: Ctx, s: WizardState): FlowDoctor[] {
  return s.departmentId ? ctx.doctors.filter((d) => d.departmentIds.includes(s.departmentId!)) : ctx.doctors;
}
function setDoctor(s: WizardState, ctx: Ctx, doc: FlowDoctor) {
  s.doctorId = doc.id;
  s.doctorName = doc.name;
  if (ctx.departments.length && !(s.departmentId && doc.departmentIds.includes(s.departmentId))) {
    const dep = ctx.departments.find((d) => doc.departmentIds.includes(d.id));
    s.departmentId = dep?.id;
    s.departmentName = dep?.name;
  }
}

function doctorLine(d: FlowDoctor, i: number, withSpec: boolean): string {
  const meta = [withSpec ? d.specialization : null, d.qualification, d.experience ? `${d.experience} exp.` : null, d.fee > 0 ? `₹${d.fee}` : null].filter(Boolean).join(' · ');
  return `${num(i)} *${drName(d.name)}*${meta ? ` — ${meta}` : ''}`;
}

/** Applies extracted fields to the state; returns whether anything new was learned. */
function apply(s: WizardState, ex: Found, ctx: Ctx, today: string): { learned: boolean; note: string } {
  let learned = false;
  let note = '';
  if (ex.name && ex.name !== s.name) {
    s.name = ex.name;
    learned = true;
  }
  if (ex.age && ex.age !== s.age) {
    s.age = ex.age;
    learned = true;
  }
  if (ex.department) {
    const dep = pickOption(ex.department, ctx.departments, (d) => d.name);
    if (dep && dep.id !== s.departmentId) {
      s.departmentId = dep.id;
      s.departmentName = dep.name;
      if (s.doctorId && !ctx.doctors.find((d) => d.id === s.doctorId)?.departmentIds.includes(dep.id)) {
        s.doctorId = undefined;
        s.doctorName = undefined;
        s.date = undefined;
      }
      learned = true;
    }
  }
  if (ex.doctor && !ex.doctor.startsWith('?')) {
    const doc = pickOption(ex.doctor, doctorsIn(ctx, s), (d) => d.name) ?? pickOption(ex.doctor, ctx.doctors, (d) => d.name);
    if (doc && doc.id !== s.doctorId) {
      setDoctor(s, ctx, doc);
      learned = true;
    }
  } else if (ex.doctor?.startsWith('?')) {
    // Ambiguous ("Dr. Patil" with two Patils): narrow down or show just those.
    const ids = ex.doctor.slice(1).split(',');
    const inScope = doctorsIn(ctx, s).filter((d) => ids.includes(d.id));
    if (inScope.length === 1) {
      setDoctor(s, ctx, inScope[0]);
      learned = true;
    } else if (inScope.length > 1) {
      s.options = inScope.map((d) => d.id);
      s.awaiting = 'doctor';
      learned = true;
    }
  }
  if (ex.date) {
    if (ex.date < today) note = T.past[s.lang];
    else if (ex.date !== s.date) {
      s.date = ex.date;
      s.time = undefined;
      learned = true;
    }
  }
  if (ex.time) {
    s.wantedTime = ex.meridiem ? ex.time : `${ex.time}?`;
    learned = true;
  }
  return { learned, note };
}

/** Reads an answer to the list we just showed ("2", "2️⃣", or a label). */
function answerFromOptions(s: WizardState, raw: string, ctx: Ctx): Found | null {
  if (!s.awaiting || !s.options?.length) return null;
  const isNumber = /^\s*(?:option\s*|no\.?\s*)?\d{1,2}(?:️?⃣)?\.?\s*$/i.test(raw);
  switch (s.awaiting) {
    case 'department': {
      const list = s.options.map((id) => ctx.departments.find((d) => d.id === id)).filter((d): d is FlowDepartment => Boolean(d));
      const dep = pickOption(raw, list, (d) => d.name);
      return dep ? { department: dep.name } : null;
    }
    case 'doctor':
    case 'patient': {
      // The combined first question shows the doctor list next to name/age.
      if (s.awaiting === 'patient' && !isNumber) return null;
      const list = s.options.map((id) => ctx.doctors.find((d) => d.id === id)).filter((d): d is FlowDoctor => Boolean(d));
      const doc = pickOption(raw, list, (d) => d.name) ?? (isNumber ? null : pickOption(raw, list, (d) => d.specialization ?? ''));
      return doc ? { doctor: doc.name } : null;
    }
    case 'time': {
      if (!isNumber) return null;
      const t = pickOption(raw, s.options, (x) => x);
      return t ? { time: t, meridiem: true } : null;
    }
    case 'date': {
      if (!isNumber) return null;
      const d = pickOption(raw, s.options, (x) => x);
      return d ? { date: d } : null;
    }
    default:
      return null;
  }
}

async function nextDates(data: FlowData, doctorId: string, count: number): Promise<string[]> {
  return (await data.availability(doctorId, data.today, DATE_LOOKAHEAD_DAYS)).filter((d) => d.slots.length).slice(0, count).map((d) => d.date);
}

function slotList(slots: string[], lang: Lang): { text: string; shown: string[] } {
  const shown = slots.slice(0, SLOTS_SHOWN);
  const groups: Array<[string, string[]]> = [
    [lang === 'hi' ? '🌅 Subah' : '🌅 Morning', shown.filter((t) => t < '12:00')],
    [lang === 'hi' ? '☀️ Dopahar' : '☀️ Afternoon', shown.filter((t) => t >= '12:00' && t < '16:00')],
    [lang === 'hi' ? '🌆 Shaam' : '🌆 Evening', shown.filter((t) => t >= '16:00')],
  ];
  let i = 0;
  const text = groups
    .filter(([, l]) => l.length)
    .map(([label, l]) => `${label}\n${l.map((t) => `${num(i++)} ${prettyTime12(t)}`).join('\n')}`)
    .join('\n\n');
  return { text: text + (slots.length > SLOTS_SHOWN ? T.more[lang](slots.length - SLOTS_SHOWN) : ''), shown };
}

/** Department list (only when configured) or doctor list, worded for chat. */
function chooser(s: WizardState, ctx: Ctx): { field: Field; question: string; list: string; options: string[] } {
  const L = s.lang;
  const fn = firstName(s.name);
  if (needsDepartment(ctx) && !s.departmentId) {
    // Each department with its doctors, so patients can pick either.
    const list = ctx.departments
      .map((d, i) => {
        const docs = ctx.doctors.filter((doc) => doc.departmentIds.includes(d.id)).map((doc) => drName(doc.name));
        return `${num(i)} *${d.name}*${docs.length ? ` — ${docs.join(', ')}` : ''}`;
      })
      .join('\n');
    return { field: 'department', question: T.askDept[L](fn), list, options: ctx.departments.map((d) => d.id) };
  }
  const narrowed = s.awaiting === 'doctor' && s.options?.length ? ctx.doctors.filter((d) => s.options!.includes(d.id)) : [];
  const pool = narrowed.length ? narrowed : doctorsIn(ctx, s);
  return {
    field: 'doctor',
    question: T.askDoctor[L](fn, s.departmentName),
    list: pool.map((d, i) => doctorLine(d, i, !s.departmentId)).join('\n'),
    options: pool.map((d) => d.id),
  };
}

/** Decides what to ask next — or books — from everything known so far. */
async function respond(s: WizardState, ctx: Ctx, data: FlowData, opener: string, combined: boolean): Promise<FlowResult> {
  const L = s.lang;
  const fn = firstName(s.name);

  if (!ctx.doctors.length) return { kind: 'exit', text: T.noDoctors[L] };

  // A single department / doctor needs no question.
  if (!s.departmentId && ctx.departments.length === 1) {
    s.departmentId = ctx.departments[0].id;
    s.departmentName = ctx.departments[0].name;
  }
  let auto = '';
  if (!s.doctorId && (!needsDepartment(ctx) || s.departmentId)) {
    const pool = doctorsIn(ctx, s);
    if (pool.length === 1) {
      setDoctor(s, ctx, pool[0]);
      auto = T.docAuto[L](drName(pool[0].name));
    }
  }

  // Patient name & age — on a detailed first message, also offer the doctor/department list.
  if (!s.name || !s.age) {
    const ask = !s.name && !s.age ? T.askBoth[L] : !s.name ? T.askName[L] : T.askAge[L](fn);
    if (combined && !s.doctorId) {
      const c = chooser(s, ctx);
      const q = c.question.replace(/^(Okay|Theek hai)[^,]*,\s*/, '');
      return {
        kind: 'reply',
        text: `${opener}${ask}${T.plusChoose[L]}${q}\n\n${c.list}`,
        state: { ...s, awaiting: 'patient', options: c.options },
      };
    }
    return { kind: 'reply', text: `${opener}${ask}`, state: { ...s, awaiting: 'patient', options: s.awaiting === 'patient' ? s.options : [] } };
  }

  if (!s.doctorId) {
    const c = chooser(s, ctx);
    return { kind: 'reply', text: `${opener}${c.question}\n\n${c.list}`, state: { ...s, awaiting: c.field, options: c.options } };
  }

  const doc = drName(s.doctorName!);

  if (!s.date) {
    const next = await nextDates(data, s.doctorId, 3);
    if (!next.length) {
      return { kind: 'reply', text: `${opener}${T.noneSoon[L](doc)}\n\n${chooser({ ...s, doctorId: undefined }, ctx).list}`, state: { ...s, doctorId: undefined, doctorName: undefined, awaiting: 'doctor', options: doctorsIn(ctx, s).map((d) => d.id) } };
    }
    return {
      kind: 'reply',
      text: `${opener}${auto}${T.askDate[L](auto ? '' : fn, next.map((d) => dayLabel(d, data.today, L)).join(', '), auto ? '' : doc)}`,
      state: { ...s, awaiting: 'date', options: next },
    };
  }

  const [day] = await data.availability(s.doctorId, s.date, 1);
  const slots = day?.slots ?? [];
  if (!slots.length) {
    const next = await nextDates(data, s.doctorId, 3);
    const text = `${opener}${auto}${T.noDate[L](doc, dayLabel(s.date, data.today, L))}${next.length ? T.otherDate[L](next.map((d) => dayLabel(d, data.today, L)).join(', ')) : ` ${T.noneSoon[L](doc)}`}`;
    return { kind: 'reply', text, state: { ...s, date: undefined, awaiting: 'date', options: next } };
  }

  let lead = `${opener}${auto}`;
  if (s.wantedTime) {
    const hadMeridiem = !s.wantedTime.endsWith('?');
    const wanted = s.wantedTime.replace('?', '');
    const hit = matchSlot(wanted, slots, hadMeridiem);
    if (hit) return { kind: 'book', state: { ...s, time: hit, wantedTime: undefined, awaiting: undefined, options: [] } };
    lead += T.timeTaken[L](prettyTime12(wanted));
  }

  const list = slotList(slots, L);
  return {
    kind: 'reply',
    text: `${lead}${T.askTime[L](doc, dayLabel(s.date, data.today, L))}\n\n${list.text}\n\n${T.pickTime[L]}`,
    state: { ...s, wantedTime: undefined, awaiting: 'time', options: list.shown },
  };
}

async function extractAll(raw: string, s: WizardState, ctx: Ctx, data: FlowData, first: boolean): Promise<Found> {
  const fromList = answerFromOptions(s, raw, ctx);
  if (fromList) return fromList;

  const rules = extractRules(raw, { today: data.today, departments: ctx.departments, doctors: ctx.doctors, awaiting: s.awaiting });
  const foundCount = (['name', 'age', 'department', 'doctor', 'date', 'time'] as const).filter((k) => rules[k]).length;
  const wordCount = raw.trim().split(/\s+/).length;
  const awaitedMissing =
    (s.awaiting === 'patient' && !rules.name && !rules.age) ||
    (s.awaiting === 'date' && !rules.date) ||
    (s.awaiting === 'time' && !rules.time) ||
    ((s.awaiting === 'doctor' || s.awaiting === 'department') && !rules.doctor && !rules.department);
  // The AI reads the patient's own words (any language, script or typo), so it leads whenever
  // patient details are expected or this is the opening message. Word rules are the fallback
  // for when the AI is unavailable and for the other wizard steps unless they miss something.
  const patientStep = s.awaiting === 'patient';
  // A reply can carry more than the one detail we asked for ("1 december
  // sakali 11 vajta" answers date AND time). When the rules found little in a
  // longer message, or it is written in a non-Latin script the rules only
  // partly read, the AI reads the whole message so nothing is asked twice.
  const nativeScript = /(?![a-z])\p{L}/iu.test(raw);
  const moreToRead = wordCount >= 3 && foundCount <= 1;
  const useAi = Boolean(data.extract) && (patientStep || first || nativeScript || moreToRead || (awaitedMissing && !rules.isQuestion));
  if (!useAi) return rules;

  const ai = await data
    .extract!(raw, {
      today: data.today,
      departments: ctx.departments.map((d) => d.name),
      doctors: ctx.doctors.map((d) => `${drName(d.name)}${d.specialization ? ` (${d.specialization})` : ''}`),
      awaiting: s.awaiting,
    })
    .catch(() => null);
  if (!ai) return rules;

  const merged: Found = { ...rules };
  const validName = (n?: string) => Boolean(n) && /\p{L}/u.test(n!) && n!.length <= 60;
  const validAge = (a?: string) => Boolean(a) && /^\d{1,3}$/.test(String(a)) && Number(a) <= 120;
  // AI wins over the word rules for name and age when it found them.
  if (validName(ai.name)) merged.name = titleCase(ai.name!.trim());
  if (validAge(ai.age)) merged.age = String(Number(ai.age));
  if (!merged.department && ai.department) merged.department = ai.department;
  if ((!merged.doctor || merged.doctor.startsWith('?')) && ai.doctor) merged.doctor = ai.doctor.replace(/\s*\(.*\)$/, '');
  if (!merged.date && ai.date && /^\d{4}-\d{2}-\d{2}$/.test(ai.date)) merged.date = ai.date;
  if (!merged.time && ai.time && /^\d{2}:\d{2}$/.test(ai.time)) {
    merged.time = ai.time;
    merged.meridiem = true;
  }
  merged.isQuestion = Boolean(rules.isQuestion || ai.isQuestion);
  return merged;
}

// ── cancel / reschedule an existing appointment ─────────────────────

function apptLabel(a: UpcomingAppointment, lang: Lang, today: string): string {
  return `${a.doctorName ? `*${drName(a.doctorName)}* ` : ''}on *${dayLabel(a.date, today, lang)} at ${prettyTime12(a.time)}*`;
}

async function beginManage(s: WizardState, a: UpcomingAppointment, data: FlowData, extra?: Found): Promise<FlowResult> {
  const label = apptLabel(a, s.lang, data.today);
  if (s.mode === 'cancel') {
    return { kind: 'reply', text: T.confirmCancel[s.lang](label), state: { ...s, targetId: a.id, targetLabel: label, awaiting: 'confirm_cancel', options: [] } };
  }
  const ctx = await loadCtx(data);
  const doc = a.doctorId ? ctx.doctors.find((d) => d.id === a.doctorId) : undefined;
  const next: WizardState = {
    ...s,
    targetId: a.id,
    targetLabel: label,
    name: a.patientName ?? s.name ?? data.contactName ?? 'Patient',
    age: a.patientAge ?? s.age ?? '0',
    doctorId: doc?.id,
    doctorName: doc?.name,
    departmentId: a.departmentId ?? undefined,
    awaiting: undefined,
    options: [],
  };
  if (extra) apply(next, { ...extra, name: undefined, age: undefined }, ctx, data.today);
  return respond(next, ctx, data, T.moving[s.lang](label), false);
}

/** "Cancel my appointment" / "reschedule" — finds the patient's upcoming bookings. */
export async function startManage(data: FlowData, mode: 'cancel' | 'reschedule', message = '', now = Date.now()): Promise<FlowResult> {
  const s: WizardState = { ...newWizard(detectLang(message), now), mode };
  const list = (await data.upcoming?.()) ?? [];
  if (!list.length) return { kind: 'exit', text: T.noUpcoming[s.lang] };
  let extra: Found | undefined;
  if (mode === 'reschedule' && message) {
    const ctx = await loadCtx(data);
    extra = extractRules(message, { today: data.today, departments: ctx.departments, doctors: ctx.doctors });
  }
  if (list.length === 1) return beginManage(s, list[0], data, extra);
  const lines = list.map((a, i) => `${num(i)} ${apptLabel(a, s.lang, data.today)} · ${a.ref}`);
  return {
    kind: 'reply',
    text: `${T.pickAppt[s.lang](mode)}\n\n${lines.join('\n')}`,
    state: { ...s, awaiting: 'appointment', options: list.map((a) => a.id) },
  };
}

async function continueManage(s: WizardState, raw: string, data: FlowData): Promise<FlowResult | null> {
  const t = raw.trim().toLowerCase();
  if (s.awaiting === 'confirm_cancel') {
    if (/^(1|1️⃣|y|yes|yeah|ok|okay|confirm|haan|han|ha|ji|cancel|cancel it|cancel karo)\b/.test(t)) return { kind: 'cancel', state: s };
    if (/^(2|2️⃣|n|no|nope|nahi|nahin|keep|rehne do)\b/.test(t)) return { kind: 'exit', text: T.keepAppt[s.lang] };
    return { kind: 'reply', text: `${T.didntGet[s.lang]}${T.confirmCancel[s.lang](s.targetLabel ?? '')}`, state: s };
  }
  const list = (await data.upcoming?.()) ?? [];
  const ordered = (s.options ?? []).map((id) => list.find((a) => a.id === id)).filter((a): a is UpcomingAppointment => Boolean(a));
  const pick = pickOption(raw, ordered, (a) => `${a.ref} ${a.doctorName ?? ''}`);
  if (!pick) return null;
  return beginManage(s, pick, data);
}

// ── public API ───────────────────────────────────────────────────────

export function newWizard(lang: Lang = 'en', now = Date.now()): WizardState {
  return { flow: 'wizard', updatedAt: now, invalid: 0, lang };
}

/** First booking message — picks up anything already said ("…for tomorrow at 5pm with Dr. Patil"). */
export async function startWizard(data: FlowData, message = '', now = Date.now()): Promise<FlowResult> {
  const ctx = await loadCtx(data);
  const s = newWizard(detectLang(message), now);
  if (message) apply(s, await extractAll(message, s, ctx, data, true), ctx, data.today);
  const rich = Boolean(s.date || s.doctorId || s.departmentId || s.wantedTime);
  return respond(s, ctx, data, '', rich);
}

/** Shows fresh times after the chosen slot was taken at the last moment. */
export async function retryTime(state: WizardState, data: FlowData, reason: string): Promise<FlowResult> {
  const ctx = await loadCtx(data);
  return respond({ ...state, time: undefined, wantedTime: undefined, invalid: 0 }, ctx, data, `😔 ${reason.trim()} `, false);
}

/** Handles the patient's next message in an ongoing booking chat. */
export async function advance(state: WizardState, input: string, data: FlowData, now = Date.now()): Promise<FlowResult> {
  const raw = input.trim();
  const afterReminder = Boolean(state.reminders);
  // The patient is back: the reminder cycle ends with this reply.
  const s: WizardState = { ...state, updatedAt: now, lang: detectLang(raw, state.lang), reminders: undefined, remindedAt: undefined, reminderFor: undefined };

  if (afterReminder && s.awaiting !== 'appointment' && s.awaiting !== 'confirm_cancel') {
    // "Yes" to "shall we continue?" → ask the pending question again; "no" → stop.
    if (NO_AFTER_REMINDER.test(raw) || NO_AFTER_REMINDER_NATIVE.test(raw)) {
      return { kind: 'exit', text: s.mode === 'reschedule' ? T.keepAppt[s.lang] : T.cancelled[s.lang] };
    }
    if (YES_AFTER_REMINDER.test(raw) || YES_AFTER_REMINDER_NATIVE.test(raw)) {
      return respond({ ...s, invalid: 0 }, await loadCtx(data), data, '', false);
    }
  }

  if (s.awaiting === 'appointment' || s.awaiting === 'confirm_cancel') {
    const managed = await continueManage(s, raw, data);
    if (managed) return managed;
  }

  if (isCancel(raw.toLowerCase())) return { kind: 'exit', text: s.mode === 'reschedule' ? T.keepAppt[s.lang] : T.cancelled[s.lang] };

  const ctx = await loadCtx(data);
  const ex = await extractAll(raw, s, ctx, data, false);
  const { learned, note } = apply(s, ex, ctx, data.today);

  if (!learned && !note) {
    // A side question ("what are your timings?") goes to the regular AI; booking resumes after.
    if (ex.isQuestion) return { kind: 'release', state: s };
    const invalid = s.invalid + 1;
    if (invalid >= MAX_INVALID) return { kind: 'release' };
    const again = await respond({ ...s, invalid }, ctx, data, T.didntGet[s.lang], false);
    return again.kind === 'reply' ? { ...again, state: { ...again.state, invalid } } : again;
  }
  return respond({ ...s, invalid: 0 }, ctx, data, note, false);
}
