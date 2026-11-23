/**
 * AI Business Setup import: any business document (brochure, rate card,
 * doctor roster, website export, prospectus, menu — PDF/DOCX/XLSX/CSV/TXT
 * or a photo) → structured setup data the wizard can pre-fill.
 *
 * Nothing is saved here. The UI shows the extraction, the owner approves
 * the sections they want, and the normal setup save paths persist them.
 */

import { callLLM, deleteGeminiFile, GEMINI_INLINE_MAX_BYTES, parseJSONFromLLM, uploadGeminiFile } from '@/lib/ai/llm';
import { extractTextFromDocument, MAX_DOCUMENT_SIZE_BYTES } from '@/lib/healthcare/document-parser';

export const SETUP_MAX_BYTES = MAX_DOCUMENT_SIZE_BYTES; // 50 MB
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const IMAGE = /^image\/(png|jpe?g|webp|heic|heif)$/;
const MAX_TEXT = 120_000;

export interface ExtractedSetup {
  profile: Record<string, string>;
  timings: Array<{ day_name: string; is_closed: boolean; opening_time: string; closing_time: string; lunch_break_start: string; lunch_break_end: string }>;
  departments: string[];
  people: Array<{
    name: string;
    department: string;
    role: string;
    qualification: string;
    experience: string;
    available_days: string[];
    available_start_time: string;
    available_end_time: string;
    fee: number;
    languages: string;
  }>;
  services: Array<{ name: string; description: string; price: number; duration: number; category: string }>;
  faqs: Array<{ question: string; answer: string }>;
  knowledge: string;
  notes: string[];
}

const str = (v: unknown, max = 500) => String(v ?? '').trim().slice(0, max);
const time = (v: unknown) => {
  const s = str(v, 12).toLowerCase().replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/);
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const dayName = (v: unknown) => DAYS.find((d) => d.toLowerCase().startsWith(str(v, 12).toLowerCase().slice(0, 3))) ?? '';

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalize(raw: any, segment: string): ExtractedSetup {
  const p = raw?.profile ?? {};
  const timingsRaw: any[] = Array.isArray(raw?.timings) ? raw.timings : [];
  const timings = DAYS.map((d) => {
    const t = timingsRaw.find((x) => dayName(x?.day_name ?? x?.day) === d);
    return {
      day_name: d,
      is_closed: t ? Boolean(t.is_closed) || (!time(t.opening_time) && !time(t.closing_time)) : false,
      opening_time: time(t?.opening_time) || '09:00',
      closing_time: time(t?.closing_time) || '18:00',
      lunch_break_start: time(t?.lunch_break_start),
      lunch_break_end: time(t?.lunch_break_end),
    };
  });
  const hasTimings = timingsRaw.length > 0;

  const people = (Array.isArray(raw?.people) ? raw.people : [])
    .map((d: any) => ({
      name: str(d?.name, 120),
      department: str(d?.department, 80),
      role: str(d?.role, 80),
      qualification: str(d?.qualification, 160),
      experience: str(d?.experience, 60),
      available_days: (Array.isArray(d?.available_days) ? d.available_days : []).map(dayName).filter(Boolean),
      available_start_time: time(d?.available_start_time),
      available_end_time: time(d?.available_end_time),
      fee: num(d?.fee),
      languages: str(d?.languages, 120),
    }))
    .filter((d: { name: string }) => d.name)
    .slice(0, 100);

  return {
    profile: Object.fromEntries(
      ['name', 'type', 'description', 'phone', 'whatsapp_number', 'email', 'website', 'address', 'city', 'state', 'pincode', 'google_map_link', 'instagram_url', 'facebook_url']
        .map((k) => [k, str(p[k], k === 'description' ? 2000 : 300)])
        .filter(([, v]) => v),
    ),
    timings: hasTimings ? timings : [],
    departments: [...new Set([...(Array.isArray(raw?.departments) ? raw.departments.map((d: unknown) => str(d, 80)) : []), ...people.map((p: { department: string }) => p.department)].filter(Boolean))] as string[],
    people,
    services: (Array.isArray(raw?.services) ? raw.services : [])
      .map((s: any) => ({ name: str(s?.name, 160), description: str(s?.description, 1000), price: num(s?.price), duration: Math.max(5, Math.min(480, num(s?.duration) || 30)), category: str(s?.category, 80) }))
      .filter((s: { name: string }) => s.name)
      .slice(0, 200),
    faqs: (Array.isArray(raw?.faqs) ? raw.faqs : [])
      .map((f: any) => ({ question: str(f?.question, 500), answer: str(f?.answer, 2000) }))
      .filter((f: { question: string; answer: string }) => f.question && f.answer)
      .slice(0, 100),
    knowledge: str(raw?.knowledge, 8000),
    notes: segment === 'healthcare' && people.some((d: { available_days: string[] }) => !d.available_days.length)
      ? ['Some doctors have no consultation days in the document — set them in the Doctors step.']
      : [],
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function prompt(segment: string, source: string): string {
  const clinic = segment === 'healthcare';
  return `You are onboarding a ${clinic ? 'healthcare clinic / hospital' : `${segment} business`} into a WhatsApp CRM. Extract every setup detail present in ${source}. Only use facts that appear in the source — use "" / [] when something is not stated. Do not invent doctors, prices or timings.

Return ONLY JSON:
{
 "profile": {"name":"","type":"${clinic ? 'e.g. Multi-speciality clinic' : 'business category'}","description":"2-4 sentence summary","phone":"","whatsapp_number":"","email":"","website":"","address":"street address","city":"","state":"","pincode":"","google_map_link":"","instagram_url":"","facebook_url":""},
 "timings": [{"day_name":"Monday","is_closed":false,"opening_time":"09:00","closing_time":"18:00","lunch_break_start":"","lunch_break_end":""}],   // 24h HH:MM, one per day mentioned
 "departments": ["${clinic ? 'Cardiology' : 'category'}"],
 "people": [{"name":"","department":"${clinic ? 'department / specialization' : 'team / category'}","role":"${clinic ? 'Consultant' : 'job title'}","qualification":"","experience":"e.g. 12 years","available_days":["Monday"],"available_start_time":"10:00","available_end_time":"14:00","fee":0,"languages":"English, Hindi"}],
 "services": [{"name":"","description":"","price":0,"duration":30,"category":""}],
 "faqs": [{"question":"","answer":""}],   // policies, insurance, parking, payment, cancellation, preparation instructions — anything a customer may ask
 "knowledge": "Everything else useful for answering customer questions on WhatsApp (policies, facilities, offers, USPs), as concise bullet points"
}`;
}

/** Same extraction as a document, from details the owner typed or pasted. */
export async function extractSetupFromText(input: { text: string; segment: string }): Promise<ExtractedSetup> {
  const text = input.text.trim();
  if (text.length < 20) throw new Error('Write a little more about the business (at least a sentence or two).');
  const llm = await callLLM(`${prompt(input.segment, 'the text below, written by the business owner')}\n\nOWNER'S TEXT:\n${text.slice(0, MAX_TEXT)}`, {
    geminiOnly: true,
    jsonMode: true,
    maxTokens: 12_000,
    temperature: 0.1,
    taskCriticality: 'standard' as const,
    timeoutMs: 120_000,
  });
  const raw = llm.success ? parseJSONFromLLM<unknown>(llm.text) : null;
  if (!raw) throw new Error('The AI could not read this text. Please try again.');
  const out = normalize(raw, input.segment);
  if (text.length > MAX_TEXT) out.notes.push('The text is very long; only the first part was analysed.');
  return out;
}

export async function extractSetupFromFile(input: { buffer: Buffer; fileName: string; mimeType: string; segment: string }): Promise<ExtractedSetup> {
  const { buffer, fileName, mimeType, segment } = input;
  if (buffer.length > SETUP_MAX_BYTES) throw new Error('Files must be 50 MB or smaller.');
  const isImage = IMAGE.test(mimeType) || /\.(png|jpe?g|webp|heic)$/i.test(fileName);

  const isPdf = /\.pdf$/i.test(fileName) || mimeType === 'application/pdf';
  let text = '';
  if (!isImage) {
    try {
      text = (await extractTextFromDocument(buffer, fileName, mimeType)).text;
    } catch (err) {
      // A PDF the local parser can't read (engine/worker problem, odd encoding)
      // is still readable by the AI directly; other formats have no fallback.
      if (!isPdf) throw err;
      text = '';
    }
  }
  const scanned = !isImage && isPdf && text.replace(/\s/g, '').length < 80;

  const opts = { geminiOnly: true, jsonMode: true, maxTokens: 12_000, temperature: 0.1, taskCriticality: 'standard' as const, timeoutMs: 120_000 };
  let llm;
  if (isImage || scanned) {
    // The AI reads the file itself. Small files go inline; larger ones (up to
    // the 50 MB upload limit) through the Gemini File API, deleted afterwards.
    const mime = isImage ? mimeType || 'image/jpeg' : 'application/pdf';
    if (buffer.length <= GEMINI_INLINE_MAX_BYTES) {
      llm = await callLLM(prompt(segment, 'the attached document'), { ...opts, attachments: [{ mimeType: mime, data: buffer.toString('base64') }] });
    } else {
      const uploaded = await uploadGeminiFile(buffer, mime, fileName);
      try {
        llm = await callLLM(prompt(segment, 'the attached document'), { ...opts, timeoutMs: 180_000, attachments: [{ mimeType: mime, fileUri: uploaded.uri }] });
      } finally {
        void deleteGeminiFile(uploaded.name);
      }
    }
  } else {
    if (!text.trim()) throw new Error('No readable text was found in this file.');
    llm = await callLLM(`${prompt(segment, 'the document below')}\n\nDOCUMENT (${fileName}):\n${text.slice(0, MAX_TEXT)}`, opts);
  }
  const raw = llm.success ? parseJSONFromLLM<unknown>(llm.text) : null;
  if (!raw) throw new Error('The AI could not read this document. Please try again or use a clearer file.');
  const out = normalize(raw, segment);
  if (text.length > MAX_TEXT) out.notes.push('The document is very long; only the first part was analysed.');
  return out;
}
