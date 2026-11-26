/**
 * AI member extraction for health & fitness businesses: any member register
 * (Excel/CSV export from old software, PDF, Word, a photographed register or
 * admission forms) → reviewed rows for onboarding.
 *
 *  - Spreadsheets: rows are read in code; the AI only maps columns.
 *  - Text documents: text is extracted and the AI pulls members out in chunks.
 *  - Images / scanned PDFs: sent to the vision model.
 *
 * Phones, dates, gender and package matching are normalised here; the model
 * never decides what is valid, and nothing is saved until the owner confirms.
 */

import * as XLSX from 'xlsx';

import { callLLM, parseJSONFromLLM } from '@/lib/ai/llm';
import { normalizePhone } from '@/lib/ai/contact-extract';
import { extractTextFromDocument } from '@/lib/healthcare/document-parser';
import { isValidE164 } from '@/lib/whatsapp/phone-utils';

export const MEMBER_FIELDS = [
  'name', 'phone', 'email', 'gender', 'dateOfBirth', 'address', 'emergencyContactName', 'emergencyContactPhone',
  'fitnessGoal', 'medicalNotes', 'packageName', 'startDate', 'endDate', 'amountPaid', 'notes',
] as const;
export type MemberField = (typeof MEMBER_FIELDS)[number];
type RawMember = Partial<Record<MemberField, unknown>>;

export interface ExtractedMember {
  name: string;
  phone: string;
  rawPhone: string;
  email: string;
  gender: 'male' | 'female' | 'other' | null;
  dateOfBirth: string | null;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  fitnessGoal: string;
  medicalNotes: string;
  packageName: string;
  /** Matched package id (by name, else by duration), or null. */
  packageId: string | null;
  startDate: string | null;
  endDate: string | null;
  amountPaid: number | null;
  notes: string;
  valid: boolean;
  issue?: string;
}

export interface MemberExtraction {
  method: 'columns' | 'text' | 'vision';
  members: ExtractedMember[];
  totalFound: number;
  validCount: number;
  duplicatesRemoved: number;
  notes: string[];
}

export interface PackageRef { id: string; name: string; durationDays: number }

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
const MAX_ROWS = 2000;
const CHUNK_CHARS = 12_000;
const MAX_CHUNKS = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const pad = (n: number) => String(n).padStart(2, '0');
function valid(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Dates as written in Indian registers: 05/03/2026 is 5 March. Also ISO, "5 Mar 2026" and Excel serials. */
export function parseDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || /^\d{5}(\.\d+)?$/.test(String(value).trim())) {
    const serial = Number(value);
    if (serial > 20000 && serial < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  const s = String(value).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    // Day first; fall back to month first only when the day-first reading is impossible.
    return valid(y, +m[2], +m[1]) ?? valid(y, +m[1], +m[2]);
  }
  const month = (word: string) => MONTHS[word.slice(0, 4)] ?? MONTHS[word.slice(0, 3)];
  m = /^(\d{1,2})[\s-]+([a-z]{3,9})[,\s-]+(\d{2,4})$/.exec(s);
  if (m) {
    const mon = month(m[2]);
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return mon ? valid(y, mon, +m[1]) : null;
  }
  m = /^([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const mon = month(m[1]);
    return mon ? valid(+m[3], mon, +m[2]) : null;
  }
  return null;
}

export function parseGender(value: unknown): ExtractedMember['gender'] {
  const s = String(value ?? '').trim().toLowerCase();
  if (/^(m|male|man|boy|mr)\.?$/.test(s)) return 'male';
  if (/^(f|female|woman|girl|mrs|ms|miss)\.?$/.test(s)) return 'female';
  if (/^(o|other|non.?binary)$/.test(s)) return 'other';
  return null;
}

function parseAmount(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[₹,\s]|rs\.?|inr/gi, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Package by name (contains either way), else by the period's length (±3 days). */
export function matchPackage(name: string, start: string | null, end: string | null, packages: PackageRef[]): string | null {
  const n = name.trim().toLowerCase();
  if (n) {
    const exact = packages.find((p) => p.name.trim().toLowerCase() === n);
    if (exact) return exact.id;
    const partial = packages.find((p) => n.includes(p.name.trim().toLowerCase()) || p.name.trim().toLowerCase().includes(n));
    if (partial) return partial.id;
  }
  if (start && end) {
    const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
    const byLength = packages.find((p) => Math.abs(p.durationDays - days) <= 3);
    if (byLength) return byLength.id;
  }
  return null;
}

const str = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function finalizeMembers(rows: RawMember[], packages: PackageRef[], countryCode = '91'): { members: ExtractedMember[]; duplicatesRemoved: number } {
  const seen = new Set<string>();
  const out: ExtractedMember[] = [];
  let duplicatesRemoved = 0;
  for (const r of rows) {
    const name = str(r.name, 120);
    const rawPhone = str(r.phone, 40);
    if (!name && !rawPhone) continue;
    const phone = normalizePhone(rawPhone, countryCode);
    const ok = isValidE164(phone);
    if (ok) {
      if (seen.has(phone)) {
        duplicatesRemoved += 1;
        continue;
      }
      seen.add(phone);
    }
    const startDate = parseDate(r.startDate);
    const endDate = parseDate(r.endDate);
    const packageName = str(r.packageName, 120);
    const email = str(r.email, 191).toLowerCase();
    const emergencyRaw = str(r.emergencyContactPhone, 40);
    const emergency = emergencyRaw ? normalizePhone(emergencyRaw, countryCode) : '';
    out.push({
      name,
      phone: ok ? phone : rawPhone,
      rawPhone,
      email: EMAIL.test(email) ? email : '',
      gender: parseGender(r.gender),
      dateOfBirth: parseDate(r.dateOfBirth),
      address: str(r.address, 500),
      emergencyContactName: str(r.emergencyContactName, 120),
      emergencyContactPhone: emergency && isValidE164(emergency) ? emergency : '',
      fitnessGoal: str(r.fitnessGoal, 191),
      medicalNotes: str(r.medicalNotes, 1000),
      packageName,
      packageId: matchPackage(packageName, startDate, endDate, packages),
      startDate,
      endDate,
      amountPaid: parseAmount(r.amountPaid),
      notes: str(r.notes, 1000),
      valid: ok && name.length >= 2,
      issue: !name || name.length < 2 ? 'No name' : ok ? undefined : rawPhone ? 'Phone number is not valid' : 'No phone number',
    });
  }
  return { members: out, duplicatesRemoved };
}

// ── spreadsheets ─────────────────────────────────────────────────────

function readSheetRows(buffer: Buffer): string[][] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const rows: string[][] = [];
  for (const name of wb.SheetNames) {
    const data = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    for (const r of data) {
      const cells = (r as unknown[]).map((c) => String(c ?? '').trim());
      if (cells.some(Boolean)) rows.push(cells);
      if (rows.length > MAX_ROWS + 1) return rows;
    }
  }
  return rows;
}

type ColumnMap = { headerRow: boolean; name: number[] } & Partial<Record<Exclude<MemberField, 'name'>, number>>;

async function mapColumns(rows: string[][]): Promise<ColumnMap | null> {
  const sample = rows.slice(0, 8).map((r, i) => `${i}: ${r.map((c, j) => `[${j}] ${c.slice(0, 40)}`).join(' | ')}`).join('\n');
  const prompt = `These are the first rows of a gym / fitness centre member register. Identify which column index holds each field.
${sample}

Return ONLY JSON with column indexes (-1 when absent):
{"headerRow": true|false, "name": [indexes forming the full name, e.g. [0] or [1,2]], "phone": n, "email": n, "gender": n, "dateOfBirth": n, "address": n, "emergencyContactName": n, "emergencyContactPhone": n, "fitnessGoal": n, "medicalNotes": n, "packageName": n (plan / membership type), "startDate": n (joining / start / from), "endDate": n (expiry / valid till / to), "amountPaid": n (fees paid / amount), "notes": n}
Pick the member's own mobile / WhatsApp column for "phone".`;
  const llm = await callLLM(prompt, { geminiOnly: true, jsonMode: true, maxTokens: 700, temperature: 0, taskCriticality: 'standard' });
  const raw = llm.success ? parseJSONFromLLM<Record<string, unknown>>(llm.text) : null;
  if (!raw) return null;
  const idx = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined);
  const map: ColumnMap = { headerRow: raw.headerRow !== false, name: Array.isArray(raw.name) ? raw.name.filter((n): n is number => Number.isInteger(n) && n >= 0) : [] };
  for (const f of MEMBER_FIELDS) if (f !== 'name') map[f] = idx(raw[f]);
  return map;
}

/** Header keywords, when the AI is unavailable. */
export function guessColumns(header: string[]): ColumnMap {
  const h = header.map((x) => x.toLowerCase());
  const find = (re: RegExp, not?: RegExp) => {
    const i = h.findIndex((x) => re.test(x) && !(not && not.test(x)));
    return i >= 0 ? i : undefined;
  };
  const first = find(/first/);
  const last = find(/last|surname/);
  const name = find(/name/, /emergency|guardian|father|package|plan|trainer/);
  return {
    headerRow: true,
    name: first !== undefined ? [first, ...(last !== undefined ? [last] : [])] : name !== undefined ? [name] : [],
    phone: find(/whatsapp|mobile|phone|contact no|number/, /emergency|guardian|alternate/),
    email: find(/mail/),
    gender: find(/gender|sex/),
    dateOfBirth: find(/birth|dob/),
    address: find(/address|area|locality/),
    emergencyContactName: find(/emergency.*name|guardian/),
    emergencyContactPhone: find(/emergency.*(phone|mobile|no)|alternate/),
    fitnessGoal: find(/goal/),
    medicalNotes: find(/medical|health|injur/),
    packageName: find(/package|plan|membership|scheme/),
    startDate: find(/join|start|from|admission/),
    endDate: find(/expir|end|till|valid|to date|renew/),
    amountPaid: find(/paid|amount|fee/),
    notes: find(/note|remark/),
  };
}

const EXTRACT_PROMPT = (what: string) => `Extract every gym / fitness member from ${what}. Do not invent data; use "" when a field is not in the source. Keep phone numbers and dates exactly as written.
Return ONLY JSON: {"members":[{"name":"","phone":"","email":"","gender":"","dateOfBirth":"","address":"","emergencyContactName":"","emergencyContactPhone":"","fitnessGoal":"","medicalNotes":"","packageName":"","startDate":"","endDate":"","amountPaid":"","notes":""}]}`;

export async function extractMembersFromFile(input: { buffer: Buffer; fileName: string; mimeType: string; packages: PackageRef[] }): Promise<MemberExtraction> {
  const { buffer, fileName, mimeType, packages } = input;
  const lower = fileName.toLowerCase();
  const notes: string[] = [];

  if (/\.(xlsx|xls|csv|tsv|ods)$/.test(lower) || /spreadsheet|excel|csv/.test(mimeType)) {
    const rows = readSheetRows(buffer);
    if (!rows.length) throw new Error('The spreadsheet is empty.');
    if (rows.length > MAX_ROWS + 1) notes.push(`Only the first ${MAX_ROWS.toLocaleString()} rows were read.`);
    let map = await mapColumns(rows);
    if (!map || map.phone === undefined) {
      const guessed = guessColumns(rows[0]);
      if (!map) notes.push('AI column mapping was unavailable, so columns were matched by their headers.');
      if (!map || guessed.phone !== undefined) map = guessed;
    }
    if (map.phone === undefined) throw new Error('Could not find a phone number column in this file.');
    const body = (map.headerRow ? rows.slice(1) : rows).slice(0, MAX_ROWS);
    const raw = body.map((r) => {
      const row: RawMember = { name: map!.name.map((i) => r[i] ?? '').filter(Boolean).join(' ') };
      for (const f of MEMBER_FIELDS) if (f !== 'name' && map![f] !== undefined) row[f] = r[map![f]!] ?? '';
      return row;
    });
    return summarize('columns', finalizeMembers(raw, packages), notes);
  }

  const isImage = IMAGE_TYPES.includes(mimeType) || /\.(png|jpe?g|webp|heic)$/.test(lower);
  let text = '';
  if (!isImage) text = /\.(txt|md|json|html?)$/.test(lower) ? buffer.toString('utf8') : (await extractTextFromDocument(buffer, fileName, mimeType)).text;

  if (isImage || (/\.pdf$/.test(lower) && text.replace(/\s/g, '').length < 40)) {
    if (buffer.length > 15 * 1024 * 1024) throw new Error('Images and scanned PDFs must be 15 MB or smaller.');
    const llm = await callLLM(EXTRACT_PROMPT('this document (a register, form or list)'), {
      attachments: [{ mimeType: isImage ? mimeType || 'image/jpeg' : 'application/pdf', data: buffer.toString('base64') }],
      jsonMode: true,
      maxTokens: 8192,
      temperature: 0,
      taskCriticality: 'standard',
      timeoutMs: 90_000,
    });
    const parsed = llm.success ? parseJSONFromLLM<{ members?: RawMember[] }>(llm.text) : null;
    if (!parsed) throw new Error('The AI could not read this file. Try a clearer photo or a different format.');
    return summarize('vision', finalizeMembers(parsed.members ?? [], packages), notes);
  }

  if (!text.trim()) throw new Error('No readable text was found in this file.');
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < MAX_CHUNKS; i += CHUNK_CHARS) chunks.push(text.slice(i, i + CHUNK_CHARS));
  if (text.length > CHUNK_CHARS * MAX_CHUNKS) notes.push('This document is very long, so only the first part was analysed.');
  const results = await Promise.all(
    chunks.map((chunk) => callLLM(`${EXTRACT_PROMPT('the text below')}\n\nTEXT:\n${chunk}`, { geminiOnly: true, jsonMode: true, maxTokens: 8192, temperature: 0, taskCriticality: 'standard', timeoutMs: 90_000 })),
  );
  const all: RawMember[] = [];
  let failed = 0;
  for (const r of results) {
    const parsed = r.success ? parseJSONFromLLM<{ members?: RawMember[] }>(r.text) : null;
    if (parsed?.members) all.push(...parsed.members);
    else failed += 1;
  }
  if (failed === results.length) throw new Error('The AI service did not respond. Please try again.');
  if (failed) notes.push(`${failed} part(s) of the document could not be analysed.`);
  return summarize('text', finalizeMembers(all, packages), notes);
}

function summarize(method: MemberExtraction['method'], r: { members: ExtractedMember[]; duplicatesRemoved: number }, notes: string[]): MemberExtraction {
  return { method, members: r.members, totalFound: r.members.length + r.duplicatesRemoved, validCount: r.members.filter((m) => m.valid).length, duplicatesRemoved: r.duplicatesRemoved, notes };
}
