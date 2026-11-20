/**
 * AI contact extraction from arbitrary documents.
 *
 * Strategy by file kind:
 *  - Spreadsheets / CSV: parse every row in code, ask the AI only to map the
 *    columns (header + a few sample rows). Exact for 10 or 10 000 rows and
 *    costs one small call.
 *  - Text documents (PDF, DOCX, TXT, VCF…): extract text, then let the AI
 *    pull contacts out of it in chunks.
 *  - Images and scanned PDFs: sent to Gemini as files (business cards,
 *    photographed registers, screenshots).
 *
 * Every phone is normalised to digits-only E.164 and de-duplicated here; the
 * model never decides what is valid.
 */

import * as XLSX from 'xlsx';

import { callLLM, parseJSONFromLLM } from '@/lib/ai/llm';
import { extractTextFromDocument } from '@/lib/healthcare/document-parser';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';

export interface ExtractedContact {
  name: string;
  phone: string;
  email: string;
  company: string;
  /** Original phone text before normalisation, for review. */
  rawPhone: string;
  valid: boolean;
  issue?: string;
}

export interface ExtractionResult {
  method: 'columns' | 'text' | 'vision';
  contacts: ExtractedContact[];
  totalFound: number;
  validCount: number;
  duplicatesRemoved: number;
  notes: string[];
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
const MAX_TEXT_CHUNKS = 8;
const CHUNK_CHARS = 14_000;
const MAX_ROWS = 10_000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePhone(raw: string, defaultCountryCode?: string): string {
  let digits = sanitizePhoneForMeta(raw.replace(/^\s*00/, '+'));
  const international = raw.trim().startsWith('+') || /^\s*00/.test(raw);
  // National numbers: ≤ 10 digits, or a trunk "0" prefix (e.g. 022 2345 6789, 098201 44556).
  const national = digits.length <= 10 || (digits.startsWith('0') && digits.length <= 12);
  if (defaultCountryCode && digits && !international && national) {
    digits = `${defaultCountryCode}${digits.replace(/^0+/, '')}`;
  }
  return digits;
}

export function finalizeContacts(
  rows: Array<Partial<Record<'name' | 'phone' | 'email' | 'company', unknown>>>,
  defaultCountryCode?: string,
): { contacts: ExtractedContact[]; duplicatesRemoved: number } {
  const seen = new Set<string>();
  const out: ExtractedContact[] = [];
  let duplicatesRemoved = 0;
  for (const row of rows) {
    const rawPhone = String(row.phone ?? '').trim();
    const name = String(row.name ?? '').trim().slice(0, 120);
    const emailRaw = String(row.email ?? '').trim().toLowerCase();
    const company = String(row.company ?? '').trim().slice(0, 160);
    if (!rawPhone && !name) continue;
    const phone = normalizePhone(rawPhone, defaultCountryCode);
    const valid = isValidE164(phone);
    if (valid) {
      if (seen.has(phone)) {
        duplicatesRemoved += 1;
        continue;
      }
      seen.add(phone);
    }
    out.push({
      name,
      phone: valid ? phone : rawPhone,
      email: EMAIL.test(emailRaw) ? emailRaw : '',
      company,
      rawPhone,
      valid,
      issue: valid ? undefined : rawPhone ? 'Phone number is not valid' : 'No phone number',
    });
  }
  return { contacts: out, duplicatesRemoved };
}

// ── spreadsheets ─────────────────────────────────────────────────────

function readSheetRows(buffer: Buffer): string[][] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const rows: string[][] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
    for (const r of data) {
      const cells = (r as unknown[]).map((c) => String(c ?? '').trim());
      if (cells.some(Boolean)) rows.push(cells);
      if (rows.length > MAX_ROWS + 1) return rows;
    }
  }
  return rows;
}

interface ColumnMap {
  headerRow: boolean;
  name: number[];
  phone: number;
  email: number;
  company: number;
}

async function mapColumns(rows: string[][]): Promise<ColumnMap | null> {
  const sample = rows.slice(0, 8).map((r, i) => `${i}: ${r.map((c, j) => `[${j}] ${c.slice(0, 40)}`).join(' | ')}`).join('\n');
  const prompt = `These are the first rows of a spreadsheet of people/customers. Identify which column index holds each field.
${sample}

Return ONLY JSON: {"headerRow": true|false (is row 0 a header?), "name": [column indexes that together form the full name, e.g. [0] or [1,2] for first+last; [] if none], "phone": index or -1, "email": index or -1, "company": index or -1}
Pick the mobile/WhatsApp number column when several phone columns exist.`;
  const llm = await callLLM(prompt, { geminiOnly: true, jsonMode: true, maxTokens: 512, temperature: 0, taskCriticality: 'standard' });
  const raw = llm.success ? parseJSONFromLLM<Record<string, unknown>>(llm.text) : null;
  if (!raw) return null;
  const idx = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : -1);
  return {
    headerRow: raw.headerRow !== false,
    name: Array.isArray(raw.name) ? raw.name.filter((n): n is number => Number.isInteger(n)) : [],
    phone: idx(raw.phone),
    email: idx(raw.email),
    company: idx(raw.company),
  };
}

/** Header-keyword fallback when the AI is unavailable. */
function guessColumns(header: string[]): ColumnMap {
  const find = (re: RegExp) => header.findIndex((h) => re.test(h.toLowerCase()));
  const first = find(/first/);
  const last = find(/last|surname/);
  const name = find(/name/);
  return {
    headerRow: true,
    name: first >= 0 ? [first, ...(last >= 0 ? [last] : [])] : name >= 0 ? [name] : [],
    phone: find(/whatsapp|mobile|phone|number|contact/),
    email: find(/mail/),
    company: find(/company|organi[sz]ation|business|firm/),
  };
}

// ── main ─────────────────────────────────────────────────────────────

export async function extractContactsFromFile(input: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  defaultCountryCode?: string;
}): Promise<ExtractionResult> {
  const { buffer, fileName, mimeType, defaultCountryCode } = input;
  const lower = fileName.toLowerCase();
  const notes: string[] = [];

  // Spreadsheets & CSV → deterministic rows + AI column mapping.
  if (/\.(xlsx|xls|csv|tsv|ods)$/.test(lower) || /spreadsheet|excel|csv/.test(mimeType)) {
    const rows = readSheetRows(buffer);
    if (rows.length === 0) throw new Error('The spreadsheet is empty.');
    if (rows.length > MAX_ROWS + 1) notes.push(`Only the first ${MAX_ROWS.toLocaleString()} rows were read.`);
    let map = await mapColumns(rows);
    if (!map || map.phone < 0) {
      const guessed = guessColumns(rows[0]);
      if (!map || guessed.phone >= 0) {
        if (!map) notes.push('AI column mapping was unavailable — columns were matched by their headers.');
        map = guessed;
      }
    }
    if (map.phone < 0) throw new Error('Could not find a phone number column in this file.');
    const body = (map.headerRow ? rows.slice(1) : rows).slice(0, MAX_ROWS);
    const { contacts, duplicatesRemoved } = finalizeContacts(
      body.map((r) => ({
        name: map!.name.map((i) => r[i] ?? '').filter(Boolean).join(' '),
        phone: r[map!.phone] ?? '',
        email: map!.email >= 0 ? r[map!.email] : '',
        company: map!.company >= 0 ? r[map!.company] : '',
      })),
      defaultCountryCode,
    );
    return summarize('columns', contacts, duplicatesRemoved, notes);
  }

  const extractPrompt = (what: string) => `Extract every person or business contact from ${what}. Include anyone with a phone number; include name, email and company when present. Do not invent data — leave a field "" when it is not in the source. Keep phone numbers exactly as written (with country code if shown).
Return ONLY JSON: {"contacts":[{"name":"","phone":"","email":"","company":""}]}`;

  // Images (and PDFs with no extractable text) → Gemini vision.
  const isImage = IMAGE_TYPES.includes(mimeType) || /\.(png|jpe?g|webp|heic)$/.test(lower);
  let text = '';
  if (!isImage) {
    if (/\.vcf$/.test(lower) || mimeType === 'text/vcard' || /\.(txt|md|json|html?)$/.test(lower)) {
      text = buffer.toString('utf8');
    } else {
      text = (await extractTextFromDocument(buffer, fileName, mimeType)).text;
    }
  }

  if (isImage || (/\.pdf$/.test(lower) && text.replace(/\s/g, '').length < 40)) {
    if (buffer.length > 15 * 1024 * 1024) throw new Error('Images and scanned PDFs must be 15 MB or smaller.');
    const llm = await callLLM(extractPrompt('this document'), {
      attachments: [{ mimeType: isImage ? mimeType || 'image/jpeg' : 'application/pdf', data: buffer.toString('base64') }],
      jsonMode: true,
      maxTokens: 8192,
      temperature: 0,
      taskCriticality: 'standard',
      timeoutMs: 90_000,
    });
    const parsed = llm.success ? parseJSONFromLLM<{ contacts?: unknown[] }>(llm.text) : null;
    if (!parsed) throw new Error('The AI could not read this file. Try a clearer image or a different format.');
    const { contacts, duplicatesRemoved } = finalizeContacts((parsed.contacts ?? []) as never[], defaultCountryCode);
    return summarize('vision', contacts, duplicatesRemoved, notes);
  }

  if (!text.trim()) throw new Error('No readable text was found in this file.');
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < MAX_TEXT_CHUNKS; i += CHUNK_CHARS) chunks.push(text.slice(i, i + CHUNK_CHARS));
  if (text.length > CHUNK_CHARS * MAX_TEXT_CHUNKS) notes.push('This document is very long — only the first part was analysed.');

  const results = await Promise.all(
    chunks.map((chunk) =>
      callLLM(`${extractPrompt('the text below')}\n\nTEXT:\n${chunk}`, {
        geminiOnly: true,
        jsonMode: true,
        maxTokens: 8192,
        temperature: 0,
        taskCriticality: 'standard',
        timeoutMs: 90_000,
      }),
    ),
  );
  const all: unknown[] = [];
  let failedChunks = 0;
  for (const r of results) {
    const parsed = r.success ? parseJSONFromLLM<{ contacts?: unknown[] }>(r.text) : null;
    if (parsed?.contacts) all.push(...parsed.contacts);
    else failedChunks += 1;
  }
  if (failedChunks === results.length) throw new Error('The AI service did not respond. Please try again.');
  if (failedChunks) notes.push(`${failedChunks} part(s) of the document could not be analysed.`);
  const { contacts, duplicatesRemoved } = finalizeContacts(all as never[], defaultCountryCode);
  return summarize('text', contacts, duplicatesRemoved, notes);
}

function summarize(
  method: ExtractionResult['method'],
  contacts: ExtractedContact[],
  duplicatesRemoved: number,
  notes: string[],
): ExtractionResult {
  return {
    method,
    contacts,
    totalFound: contacts.length + duplicatesRemoved,
    validCount: contacts.filter((c) => c.valid).length,
    duplicatesRemoved,
    notes,
  };
}
