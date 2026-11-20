import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { autoQuantity, bmi, checkFinalize, dosesPerDay, durationDays, flagAgainstTranscript, prescriptionNumber, type MedicineLine } from './prescription';
import { parseExtraction } from '@/server/services/consultation.service';
import { pdfSafe, renderPrescriptionPdf, wrap } from '@/server/services/prescription-pdf';

const line = (over: Partial<MedicineLine> = {}): MedicineLine => ({ id: 'm1', name: 'Paracetamol', strength: '500 mg', dosage: '1 tablet', route: 'Oral', frequency: 'Twice daily', timing: 'After food', duration: '3 days', source: 'manual', verified: true, flags: [], ...over });

describe('dose arithmetic', () => {
  it('reads frequencies', () => {
    expect(dosesPerDay('Twice daily')).toBe(2);
    expect(dosesPerDay('BD')).toBe(2);
    expect(dosesPerDay('1-0-1')).toBe(2);
    expect(dosesPerDay('1-1-1')).toBe(3);
    expect(dosesPerDay('every 8 hours')).toBe(3);
    expect(dosesPerDay('SOS')).toBeNull();
  });
  it('reads durations', () => {
    expect(durationDays('3 days')).toBe(3);
    expect(durationDays('2 weeks')).toBe(14);
    expect(durationDays('5 din')).toBe(5);
    expect(durationDays('till better')).toBeNull();
  });
  it('auto-calculates quantity only for countable forms', () => {
    expect(autoQuantity(line())).toBe('6 tablets');
    expect(autoQuantity(line({ dosage: 'half tablet', frequency: 'Thrice daily', duration: '5 days' }))).toBe('8 tablets');
    expect(autoQuantity(line({ dosage: '5 ml' }))).toBeUndefined();
    expect(autoQuantity(line({ frequency: 'SOS' }))).toBeUndefined();
    expect(autoQuantity(line({ dosage: 'one tablet', frequency: 'twice daily', duration: 'three days' }))).toBe('6 tablets');
  });
  it('computes BMI', () => {
    expect(bmi(170, 68)).toBe('23.5');
    expect(bmi('', 68)).toBeUndefined();
  });
  it('numbers prescriptions', () => {
    expect(prescriptionNumber('2026-11-20', 7)).toBe('RX-261120-0007');
  });
});

describe('clinical safety', () => {
  const transcript = 'Patient has fever and throat pain for three days. Prescribe Paracetamol 500 mg one tablet after food twice daily for 3 days.';

  it('marks every AI line unverified and flags values not in the dictation', () => {
    const [ok, invented] = flagAgainstTranscript(
      [line({ id: 'a' }), line({ id: 'b', name: 'Amoxicillin', strength: '250 mg', duration: '7 days' })],
      transcript,
    );
    expect(ok.verified).toBe(false);
    expect(ok.source).toBe('ai');
    expect(ok.flags).toEqual([]);
    expect(invented.flags.join(' ')).toContain('"Amoxicillin" was not heard exactly');
    expect(invented.flags.join(' ')).toContain('Strength 250 mg');
  });

  it('flags missing frequency/duration instead of guessing', () => {
    const [m] = flagAgainstTranscript([line({ frequency: undefined, duration: undefined })], transcript);
    expect(m.flags).toEqual(expect.arrayContaining(['Frequency not stated.', 'Duration not stated.']));
  });

  it('parses model output into unverified suggestions and never trusts invented drugs', () => {
    const raw = JSON.stringify({
      chiefComplaint: { complaint: 'Fever and throat pain', duration: '3 days' },
      diagnoses: [{ text: 'Acute pharyngitis' }],
      medicines: [
        { name: 'Paracetamol', strength: '500 mg', dosage: '1 tablet', frequency: 'Twice daily', timing: 'After food', duration: '3 days' },
        { name: 'Azithromycin', strength: '500 mg', frequency: 'Once daily', duration: '3 days' },
      ],
      followUpInDays: 3,
    });
    const s = parseExtraction(raw, transcript)!;
    expect(s.medicines).toHaveLength(2);
    expect(s.medicines.every((m) => !m.verified)).toBe(true);
    expect(s.diagnoses.every((d) => !d.verified)).toBe(true);
    expect(s.medicines[1].flags.join(' ')).toContain('"Azithromycin" was not heard exactly');
    expect(s.followUpInDays).toBe(3);
    expect(parseExtraction('not json', transcript)).toBeNull();
  });

  it('blocks finalizing until every line is confirmed and the doctor approves', () => {
    const base = { diagnoses: [{ id: 'd', text: 'Pharyngitis', source: 'manual' as const, verified: true }], chiefComplaint: { complaint: 'Fever' }, hasDoctor: true };
    expect(checkFinalize({ ...base, medicines: [line({ verified: false })], doctorApproved: true }).issues.join(' ')).toContain('confirm this line');
    expect(checkFinalize({ ...base, medicines: [line()], doctorApproved: false }).issues.join(' ')).toContain('doctor approval');
    expect(checkFinalize({ ...base, medicines: [line({ duration: '' })], doctorApproved: true }).issues.join(' ')).toContain('duration is required');
    expect(checkFinalize({ ...base, diagnoses: [], medicines: [line()], doctorApproved: true }).issues.join(' ')).toContain('diagnosis');
    expect(checkFinalize({ ...base, medicines: [line()], doctorApproved: true })).toEqual({ ok: true, issues: [] });
  });
});

describe('prescription PDF', () => {
  const snap = (n: number) => ({
    prescriptionNo: 'RX-261120-0001',
    date: '2026-11-20',
    generatedAt: '2026-11-20T10:00:00.000Z',
    clinic: { name: 'BrightSmile Dental Studio', address: 'Pune ₹', phone: '+91 98765 43210' },
    doctor: { name: 'Dr. Swapnil Patil', qualification: 'BDS' },
    patient: { name: 'Riya Shah', patientCode: 'P-000001', age: '29', gender: 'female' },
    clinical: { chiefComplaint: 'Fever', diagnoses: ['J02.9 Acute pharyngitis'] },
    medicines: Array.from({ length: n }, (_, i) => ({ name: `Med ${i + 1}`, strength: '500 mg', dosage: '1 tablet', frequency: 'Twice daily', duration: '3 days', quantity: '6 tablets', instructions: 'After food, with water. Stop if any rash appears.' })),
    verifyUrl: 'https://example.com/verify/rx/abc',
  });

  it('is a real PDF, A4, and spans pages when needed', async () => {
    const one = await PDFDocument.load(await renderPrescriptionPdf(snap(2), {}, { final: true }));
    expect(one.getPageCount()).toBe(1);
    const [w, h] = [one.getPage(0).getWidth(), one.getPage(0).getHeight()];
    expect(Math.round(w)).toBe(595);
    expect(Math.round(h)).toBe(842);
    const many = await PDFDocument.load(await renderPrescriptionPdf(snap(40), {}, { final: true }));
    expect(many.getPageCount()).toBeGreaterThan(1);
    expect(many.getTitle()).toBe('Prescription RX-261120-0001');
  });

  it('keeps text encodable and wraps long words', async () => {
    expect(pdfSafe('₹500 – “ok”')).toBe('Rs.500 - "ok"');
    const { StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(wrap('a'.repeat(200), font, 9, 60).length).toBeGreaterThan(3);
  });
});
