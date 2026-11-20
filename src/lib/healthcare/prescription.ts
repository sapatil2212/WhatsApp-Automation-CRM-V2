/**
 * Prescription data model + clinical-safety helpers (pure, unit-tested).
 *
 * AI never decides anything here: every AI- or template-sourced line starts
 * `verified: false`, and finalization is refused until the doctor has
 * confirmed each one. Values the transcript doesn't literally support are
 * flagged for manual verification instead of being "corrected".
 */

export type MedicineSource = 'ai' | 'manual' | 'catalog' | 'template';

export interface MedicineLine {
  id: string;
  name: string;
  genericName?: string;
  brandName?: string;
  strength?: string;
  dosage?: string; // "1 tablet", "5 ml"
  route?: string; // Oral, Topical…
  frequency?: string; // "Twice daily", "1-0-1"
  timing?: string; // "After food"
  duration?: string; // "3 days"
  quantity?: string; // "6 tablets"
  instructions?: string;
  source: MedicineSource;
  verified: boolean;
  /** Reasons this line needs a closer look (unclear speech, value not in transcript…). */
  flags: string[];
}

export interface Advice {
  diet?: string;
  lifestyle?: string;
  precautions?: string;
  followUp?: string;
  investigations?: string;
  general?: string;
}

export interface Diagnosis {
  id: string;
  text: string;
  code?: string; // ICD-10, when chosen from the list
  source: MedicineSource;
  verified: boolean;
}

export interface Vitals {
  bp?: string;
  pulse?: string;
  temperature?: string;
  spo2?: string;
  respiratoryRate?: string;
  heightCm?: string;
  weightKg?: string;
  bmi?: string;
}

export interface ChiefComplaint {
  complaint?: string;
  symptoms?: string;
  duration?: string;
  severity?: string;
  notes?: string;
}

export function newId(prefix = 'm'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Body-mass index from height (cm) and weight (kg), 1 decimal. */
export function bmi(heightCm?: string | number, weightKg?: string | number): string | undefined {
  const h = Number(heightCm);
  const w = Number(weightKg);
  if (!(h > 30 && h < 260 && w > 1 && w < 400)) return undefined;
  return (w / (h / 100) ** 2).toFixed(1);
}

// Most specific first: "twice daily" must not match the bare "daily" rule.
const FREQ_WORDS: Array<[RegExp, number]> = [
  [/\b(four times|qid|qds)\b/i, 4],
  [/\b(thrice|three times|tds|tid)\b/i, 3],
  [/\b(twice|two times|bd|bid)\b/i, 2],
  [/\b(once|one time|od|qd|daily|every day|at bedtime|hs)\b/i, 1],
];

const NUMBER_WORDS: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', fourteen: '14', fifteen: '15', twenty: '20', thirty: '30', ek: '1', teen: '3', char: '4', paanch: '5', saat: '7' };
/** "three days" → "3 days" (spoken dictation). */
export function spokenNumbers(s?: string): string | undefined {
  return s?.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|fourteen|fifteen|twenty|thirty|ek|teen|char|paanch|saat)\b/gi, (w) => NUMBER_WORDS[w.toLowerCase()] ?? w);
}

/** Doses per day from a frequency phrase, or null when it can't be read safely. */
export function dosesPerDay(frequency?: string): number | null {
  if (!frequency) return null;
  const f = frequency.toLowerCase();
  const pattern = /^\s*(\d)\s*-\s*(\d)\s*-\s*(\d)(?:\s*-\s*(\d))?\s*$/.exec(f);
  if (pattern) return pattern.slice(1).filter(Boolean).reduce((a, b) => a + Number(b), 0) || null;
  const every = /every\s+(\d{1,2})\s*(?:hours?|hrs?)/.exec(f);
  if (every) return Math.round(24 / Number(every[1]));
  if (/\b(sos|as needed|when required|prn)\b/.test(f)) return null;
  for (const [re, n] of FREQ_WORDS) if (re.test(f)) return n;
  return null;
}

/** Days from "3 days", "1 week", "2 weeks", "10 din". */
export function durationDays(duration?: string): number | null {
  if (!duration) return null;
  const m = /(\d{1,3})\s*(day|days|d|din|week|weeks|wk|month|months)\b/i.exec(spokenNumbers(duration) ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('w')) return n * 7;
  if (unit.startsWith('m')) return n * 30;
  return n;
}

/**
 * Quantity = units per dose × doses per day × days, only for countable forms
 * (tablets/capsules). Returns undefined when any part is uncertain — the
 * doctor then enters it.
 */
export function autoQuantity(line: Pick<MedicineLine, 'dosage' | 'frequency' | 'duration'>): string | undefined {
  const dose = /^\s*(\d+(?:\.\d+)?|half|½)\s*(tab|tablet|tablets|cap|capsule|capsules|sachet|sachets)?\b/i.exec(spokenNumbers(line.dosage) ?? '');
  if (!dose) return undefined;
  const per = dose[1] === 'half' || dose[1] === '½' ? 0.5 : Number(dose[1]);
  const unit = dose[2] ? (/cap/i.test(dose[2]) ? 'capsules' : /sachet/i.test(dose[2]) ? 'sachets' : 'tablets') : null;
  const perDay = dosesPerDay(line.frequency);
  const days = durationDays(line.duration);
  if (!unit || !perDay || !days) return undefined;
  const total = Math.ceil(per * perDay * days);
  return `${total} ${unit}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();

/**
 * Clinical-safety pass over an AI extraction: every line is unverified,
 * and anything the transcript doesn't literally contain is flagged.
 */
export function flagAgainstTranscript(lines: MedicineLine[], transcript: string): MedicineLine[] {
  const t = ` ${norm(transcript)} `;
  const has = (v?: string) => !v || t.includes(` ${norm(v)} `) || t.includes(norm(v));
  return lines.map((l) => {
    const flags = [...l.flags];
    if (!l.name.trim()) flags.push('Medicine name missing — dictate or type it.');
    else if (!has(l.name)) flags.push(`"${l.name}" was not heard exactly — verify the medicine name.`);
    const strengthNum = l.strength?.match(/\d+(?:\.\d+)?/)?.[0];
    if (strengthNum && !t.includes(strengthNum)) flags.push(`Strength ${l.strength} was not in the dictation.`);
    const durNum = l.duration?.match(/\d+/)?.[0];
    if (durNum && !t.includes(durNum) && !/\b(one|two|three|four|five|six|seven|ten|fourteen)\b/.test(t)) flags.push(`Duration ${l.duration} was not in the dictation.`);
    if (!l.frequency) flags.push('Frequency not stated.');
    if (!l.duration) flags.push('Duration not stated.');
    return { ...l, source: 'ai' as const, verified: false, flags: [...new Set(flags)] };
  });
}

export interface FinalizeCheck {
  ok: boolean;
  issues: string[];
}

/** Everything that must be true before a prescription can be signed. */
export function checkFinalize(input: {
  medicines: MedicineLine[];
  diagnoses: Diagnosis[];
  chiefComplaint?: ChiefComplaint;
  doctorApproved: boolean;
  hasDoctor: boolean;
}): FinalizeCheck {
  const issues: string[] = [];
  if (!input.hasDoctor) issues.push('Assign a doctor to this appointment before finalizing.');
  if (!input.chiefComplaint?.complaint?.trim()) issues.push('Add the chief complaint.');
  if (!input.diagnoses.length) issues.push('Add at least one diagnosis (or "Provisional: …").');
  const unverifiedDx = input.diagnoses.filter((d) => !d.verified);
  if (unverifiedDx.length) issues.push(`${unverifiedDx.length} diagnosis line(s) still need your confirmation.`);
  input.medicines.forEach((m, i) => {
    const label = m.name.trim() || `Medicine ${i + 1}`;
    if (!m.name.trim()) issues.push(`Medicine ${i + 1}: name is required.`);
    if (!m.verified) issues.push(`${label}: confirm this line (AI/template lines need your review).`);
    if (m.name.trim() && !m.frequency?.trim()) issues.push(`${label}: frequency is required.`);
    if (m.name.trim() && !m.duration?.trim() && !/sos|as needed|prn/i.test(m.frequency ?? '')) issues.push(`${label}: duration is required.`);
  });
  if (!input.doctorApproved) issues.push('Tick the doctor approval to sign the prescription.');
  return { ok: issues.length === 0, issues };
}

/** Prescription number: RX-YYMMDD-#### (sequence per tenant per day). */
export function prescriptionNumber(date: string, seq: number): string {
  return `RX-${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-${String(seq).padStart(4, '0')}`;
}

/** Common ICD-10 codes for quick picking (searchable; free text always allowed). */
export const COMMON_ICD10: Array<{ code: string; text: string }> = [
  { code: 'J06.9', text: 'Acute upper respiratory infection, unspecified' },
  { code: 'J02.9', text: 'Acute pharyngitis, unspecified' },
  { code: 'J03.90', text: 'Acute tonsillitis, unspecified' },
  { code: 'J00', text: 'Acute nasopharyngitis (common cold)' },
  { code: 'J20.9', text: 'Acute bronchitis, unspecified' },
  { code: 'J45.909', text: 'Asthma, unspecified, uncomplicated' },
  { code: 'R50.9', text: 'Fever, unspecified' },
  { code: 'R51', text: 'Headache' },
  { code: 'R05', text: 'Cough' },
  { code: 'A09', text: 'Infectious gastroenteritis and colitis, unspecified' },
  { code: 'K21.9', text: 'Gastro-oesophageal reflux disease without oesophagitis' },
  { code: 'K30', text: 'Functional dyspepsia' },
  { code: 'K59.00', text: 'Constipation, unspecified' },
  { code: 'N39.0', text: 'Urinary tract infection, site not specified' },
  { code: 'E11.9', text: 'Type 2 diabetes mellitus without complications' },
  { code: 'E78.5', text: 'Hyperlipidaemia, unspecified' },
  { code: 'I10', text: 'Essential (primary) hypertension' },
  { code: 'E03.9', text: 'Hypothyroidism, unspecified' },
  { code: 'D64.9', text: 'Anaemia, unspecified' },
  { code: 'M54.5', text: 'Low back pain' },
  { code: 'M25.50', text: 'Pain in unspecified joint' },
  { code: 'M79.1', text: 'Myalgia' },
  { code: 'L30.9', text: 'Dermatitis, unspecified' },
  { code: 'L50.9', text: 'Urticaria, unspecified' },
  { code: 'L70.0', text: 'Acne vulgaris' },
  { code: 'B35.4', text: 'Tinea corporis' },
  { code: 'H10.9', text: 'Conjunctivitis, unspecified' },
  { code: 'H66.90', text: 'Otitis media, unspecified' },
  { code: 'K02.9', text: 'Dental caries, unspecified' },
  { code: 'K04.7', text: 'Periapical abscess without sinus' },
  { code: 'K05.10', text: 'Chronic gingivitis, plaque induced' },
  { code: 'K08.89', text: 'Other disorders of teeth (toothache)' },
  { code: 'F41.9', text: 'Anxiety disorder, unspecified' },
  { code: 'G43.909', text: 'Migraine, unspecified' },
  { code: 'R10.9', text: 'Unspecified abdominal pain' },
  { code: 'R11.2', text: 'Nausea with vomiting, unspecified' },
  { code: 'Z00.00', text: 'General adult medical examination' },
  { code: 'Z09', text: 'Follow-up examination after completed treatment' },
];
