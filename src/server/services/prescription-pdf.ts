/**
 * Prescription PDF (A4, selectable text — not an image).
 *
 * Renders from a frozen snapshot so a finalized prescription always looks
 * the way it did when the doctor signed it, even if branding changes later.
 * Header + footer repeat on every page; the medicine table wraps cells and
 * breaks across pages with its header repeated. The doctor's signature is
 * drawn only when `final` is true.
 */

import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';

import type { Advice, MedicineLine, Vitals } from '@/lib/healthcare/prescription';

export interface RxSnapshot {
  prescriptionNo: string;
  date: string; // YYYY-MM-DD
  generatedAt: string; // ISO
  clinic: { name: string; address?: string | null; phone?: string | null; email?: string | null; website?: string | null; registrationNo?: string | null; footerText?: string | null; accentColor?: string | null };
  doctor: { name: string; qualification?: string | null; specialization?: string | null; registrationNo?: string | null; department?: string | null; designation?: string | null };
  patient: { name: string; patientCode?: string | null; age?: string | null; gender?: string | null; phone?: string | null };
  clinical: { chiefComplaint?: string | null; vitals?: Vitals | null; diagnoses: string[]; findings?: string | null; investigations?: string[] };
  medicines: Array<Pick<MedicineLine, 'name' | 'genericName' | 'strength' | 'dosage' | 'route' | 'frequency' | 'timing' | 'duration' | 'quantity' | 'instructions'>>;
  advice?: Advice | null;
  followUpDate?: string | null;
  verifyUrl?: string | null;
}

export interface RxImages {
  logo?: { bytes: Uint8Array; mime: string } | null;
  signature?: { bytes: Uint8Array; mime: string } | null;
  stamp?: { bytes: Uint8Array; mime: string } | null;
}

const A4: [number, number] = [595.28, 841.89];
const M = 36; // margin
const W = A4[0] - M * 2;

/** Standard fonts are WinAnsi: map common symbols and drop the rest. */
export function pdfSafe(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/×/g, 'x')
    .replace(/[ \t]/g, ' ')
    .replace(/[^\x20-\x7e\n¡-ÿ]/g, '');
}

function hexColor(hex?: string | null) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  const n = m ? parseInt(m[1], 16) : 0x0f766e;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Splits text into lines that fit `width` at `size`. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // Break very long words.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut -= 1;
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      line = w;
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

async function embed(doc: PDFDocument, img?: { bytes: Uint8Array; mime: string } | null): Promise<PDFImage | null> {
  if (!img?.bytes?.length) return null;
  try {
    return /png/i.test(img.mime) ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
  } catch {
    return null; // unsupported image — render without it rather than failing the prescription
  }
}

function fit(img: PDFImage, maxW: number, maxH: number) {
  const s = Math.min(maxW / img.width, maxH / img.height, 1);
  return { width: img.width * s, height: img.height * s };
}

const fmtDate = (d?: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

export async function renderPrescriptionPdf(snap: RxSnapshot, images: RxImages, opts: { final: boolean }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Prescription ${snap.prescriptionNo}`);
  doc.setAuthor(pdfSafe(snap.doctor.name));
  doc.setSubject(`Prescription for ${pdfSafe(snap.patient.name)}`);
  doc.setCreator('ChatNexGen');
  doc.setCreationDate(new Date(snap.generatedAt));

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const accent = hexColor(snap.clinic.accentColor);
  const ink = rgb(0.11, 0.12, 0.14);
  const muted = rgb(0.42, 0.45, 0.5);
  const line = rgb(0.85, 0.87, 0.9);
  const logo = await embed(doc, images.logo);
  const signature = opts.final ? await embed(doc, images.signature) : null;
  const stamp = await embed(doc, images.stamp);

  let page!: PDFPage;
  let y = 0;
  const FOOTER_H = 46;

  const text = (s: string, x: number, yy: number, size = 9, f: PDFFont = font, color = ink) => page.drawText(pdfSafe(s), { x, y: yy, size, font: f, color });

  /** Full header on page 1, compact header on following pages. */
  const header = (first: boolean) => {
    page = doc.addPage(A4);
    y = A4[1] - M;
    if (first) {
      let x = M;
      if (logo) {
        const d = fit(logo, 64, 56);
        page.drawImage(logo, { x, y: y - d.height, ...d });
        x += d.width + 10;
      }
      const leftW = W * 0.58 - (x - M);
      text(snap.clinic.name, x, y - 13, 15, bold, accent);
      let ly = y - 26;
      for (const l of [snap.clinic.address, [snap.clinic.phone, snap.clinic.email].filter(Boolean).join('  |  '), snap.clinic.website, snap.clinic.registrationNo ? `Reg. No: ${snap.clinic.registrationNo}` : '']) {
        if (!l) continue;
        for (const w of wrap(l, font, 8, leftW)) {
          text(w, x, ly, 8, font, muted);
          ly -= 10;
        }
      }
      // Doctor block (right)
      const rx = M + W * 0.6;
      let ry = y - 13;
      text(snap.doctor.name, rx, ry, 11.5, bold);
      ry -= 12;
      for (const l of [snap.doctor.qualification, [snap.doctor.specialization, snap.doctor.department].filter(Boolean).join(' | '), snap.doctor.designation, snap.doctor.registrationNo ? `Reg. No: ${snap.doctor.registrationNo}` : '']) {
        if (!l) continue;
        for (const w of wrap(l, font, 8, W * 0.4)) {
          text(w, rx, ry, 8, font, muted);
          ry -= 10;
        }
      }
      y = Math.min(ly, ry, y - 60) - 6;
    } else {
      text(snap.clinic.name, M, y - 11, 11, bold, accent);
      const right = `${snap.doctor.name}  |  ${snap.prescriptionNo}`;
      text(right, M + W - font.widthOfTextAtSize(pdfSafe(right), 8), y - 10, 8, font, muted);
      y -= 20;
    }
    page.drawRectangle({ x: M, y, width: W, height: 1.6, color: accent });
    y -= 10;
  };

  const ensure = (h: number, onBreak?: () => void) => {
    if (y - h < M + FOOTER_H) {
      header(false);
      onBreak?.();
    }
  };

  header(true);

  // Patient strip
  const pRows: Array<[string, string]> = [
    ['Patient', snap.patient.name],
    ['Patient ID', snap.patient.patientCode ?? '-'],
    ['Age / Gender', [snap.patient.age ? `${snap.patient.age} yrs` : '', snap.patient.gender ?? ''].filter(Boolean).join(' / ') || '-'],
    ['Phone', snap.patient.phone ?? '-'],
    ['Date', fmtDate(snap.date)],
    ['Prescription No', snap.prescriptionNo],
  ];
  const colW = W / 3;
  page.drawRectangle({ x: M, y: y - 40, width: W, height: 40, color: rgb(0.965, 0.973, 0.98), borderColor: line, borderWidth: 0.6 });
  pRows.forEach(([k, v], i) => {
    const cx = M + 8 + (i % 3) * colW;
    const cy = y - 13 - Math.floor(i / 3) * 17;
    text(`${k}:`, cx, cy, 7.5, font, muted);
    text(wrap(v, bold, 8.5, colW - 70)[0], cx + 62, cy, 8.5, bold);
  });
  y -= 52;

  // Clinical section
  const section = (title: string, body?: string | null) => {
    if (!body?.trim()) return;
    const lines = wrap(body, font, 9, W - 110);
    ensure(12 + lines.length * 11);
    text(title, M, y - 9, 8.5, bold, accent);
    lines.forEach((l, i) => text(l, M + 110, y - 9 - i * 11, 9));
    y -= Math.max(14, lines.length * 11 + 3);
  };
  const v = snap.clinical.vitals ?? {};
  const vitalsLine = [
    v.bp && `BP ${v.bp} mmHg`,
    v.pulse && `Pulse ${v.pulse}/min`,
    v.temperature && `Temp ${v.temperature}`,
    v.spo2 && `SpO2 ${v.spo2}%`,
    v.respiratoryRate && `RR ${v.respiratoryRate}/min`,
    v.heightCm && `Ht ${v.heightCm} cm`,
    v.weightKg && `Wt ${v.weightKg} kg`,
    v.bmi && `BMI ${v.bmi}`,
  ].filter(Boolean).join('   ');
  section('Chief complaint', snap.clinical.chiefComplaint);
  section('Vitals', vitalsLine);
  section('Diagnosis', snap.clinical.diagnoses.join('\n'));
  section('Clinical findings', snap.clinical.findings);

  // Medicine table
  y -= 4;
  ensure(40);
  text('Rx', M, y - 16, 18, bold, accent);
  y -= 24;
  const cols: Array<{ key: string; label: string; w: number }> = [
    { key: 'n', label: '#', w: 18 },
    { key: 'name', label: 'Medicine', w: 132 },
    { key: 'dosage', label: 'Dosage', w: 52 },
    { key: 'route', label: 'Route', w: 42 },
    { key: 'frequency', label: 'Frequency', w: 64 },
    { key: 'duration', label: 'Duration', w: 50 },
    { key: 'quantity', label: 'Qty', w: 46 },
    { key: 'instructions', label: 'Instructions', w: W - 404 },
  ];
  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - 16, width: W, height: 16, color: accent });
    let cx = M;
    for (const c of cols) {
      text(c.label, cx + 4, y - 11, 7.5, bold, rgb(1, 1, 1));
      cx += c.w;
    }
    y -= 16;
  };
  tableHeader();
  snap.medicines.forEach((m, i) => {
    const cells: Record<string, string[]> = {
      n: [String(i + 1)],
      name: [...wrap(`${m.name}${m.strength ? ` ${m.strength}` : ''}`, bold, 8.5, cols[1].w - 8), ...(m.genericName ? wrap(`(${m.genericName})`, font, 7.5, cols[1].w - 8) : [])],
      dosage: wrap(m.dosage ?? '-', font, 8, cols[2].w - 8),
      route: wrap(m.route ?? '-', font, 8, cols[3].w - 8),
      frequency: wrap([m.frequency, m.timing && !(m.frequency ?? '').toLowerCase().includes(m.timing.toLowerCase()) ? m.timing : null].filter(Boolean).join(', ') || '-', font, 8, cols[4].w - 8),
      duration: wrap(m.duration ?? '-', font, 8, cols[5].w - 8),
      quantity: wrap(m.quantity ?? '-', font, 8, cols[6].w - 8),
      instructions: wrap(m.instructions ?? '', font, 8, cols[7].w - 8),
    };
    const rows = Math.max(...Object.values(cells).map((c) => c.length));
    const h = rows * 10 + 8;
    ensure(h, tableHeader);
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - h, width: W, height: h, color: rgb(0.975, 0.98, 0.985) });
    let cx = M;
    for (const c of cols) {
      cells[c.key].forEach((l, li) => text(l, cx + 4, y - 11 - li * 10, c.key === 'name' && li === 0 ? 8.5 : 8, c.key === 'name' && li === 0 ? bold : font));
      cx += c.w;
    }
    page.drawLine({ start: { x: M, y: y - h }, end: { x: M + W, y: y - h }, thickness: 0.5, color: line });
    y -= h;
  });
  if (!snap.medicines.length) {
    ensure(18);
    text('No medicines prescribed.', M + 4, y - 12, 8.5, font, muted);
    y -= 18;
  }
  y -= 8;

  // Advice
  const a = snap.advice ?? {};
  section('Investigations', [...(snap.clinical.investigations ?? []), a.investigations].filter(Boolean).join('\n'));
  section('Diet advice', a.diet);
  section('Lifestyle', a.lifestyle);
  section('Precautions', a.precautions);
  section('Advice', a.general);
  section('Follow-up', [snap.followUpDate ? `On ${fmtDate(snap.followUpDate)}` : '', a.followUp].filter(Boolean).join(' - '));

  // Signature / stamp block on the last page
  ensure(92);
  const sigY = y - 78;
  if (stamp) {
    const d = fit(stamp, 80, 70);
    page.drawImage(stamp, { x: M + W - 250, y: sigY + 6, ...d, opacity: 0.9 });
  }
  if (signature) {
    const d = fit(signature, 140, 46);
    page.drawImage(signature, { x: M + W - 150, y: sigY + 20, ...d });
  }
  page.drawLine({ start: { x: M + W - 150, y: sigY + 16 }, end: { x: M + W, y: sigY + 16 }, thickness: 0.6, color: muted });
  text(snap.doctor.name, M + W - 150, sigY + 4, 8.5, bold);
  text(opts.final ? 'Digitally signed' : 'Not signed - draft', M + W - 150, sigY - 7, 7.5, font, opts.final ? muted : rgb(0.75, 0.2, 0.2));
  if (snap.verifyUrl && opts.final) {
    try {
      const png = await QRCode.toBuffer(snap.verifyUrl, { type: 'png', margin: 0, width: 160, errorCorrectionLevel: 'M' });
      const qr = await doc.embedPng(png);
      page.drawImage(qr, { x: M, y: sigY - 6, width: 64, height: 64 });
      text('Scan to verify this prescription', M + 70, sigY + 26, 7, font, muted);
      text(snap.prescriptionNo, M + 70, sigY + 16, 7.5, bold);
    } catch {
      /* QR is optional */
    }
  }
  y = sigY - 12;

  // Footers + draft watermark on every page
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M + 26 }, end: { x: M + W, y: M + 26 }, thickness: 0.6, color: line });
    const left = `${snap.prescriptionNo}  |  Generated ${new Date(snap.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' })}`;
    p.drawText(pdfSafe(left), { x: M, y: M + 14, size: 7, font, color: muted });
    const pg = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pg, { x: M + W - font.widthOfTextAtSize(pg, 7), y: M + 14, size: 7, font, color: muted });
    const foot = snap.clinic.footerText || 'This prescription is valid only with the doctor\'s signature.';
    p.drawText(wrap(foot, font, 6.5, W)[0], { x: M, y: M + 3, size: 6.5, font, color: muted });
    if (!opts.final) {
      p.drawText('DRAFT - NOT VALID', { x: 120, y: 380, size: 54, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.12, rotate: degrees(35) });
    }
  });

  return doc.save();
}
