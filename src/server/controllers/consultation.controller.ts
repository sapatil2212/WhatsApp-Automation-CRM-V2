/**
 * Smart consultation, patient records and prescription branding APIs.
 * All tenant routes run on the tenant-scoped client; binary files (PDFs,
 * images, documents) are served only through authenticated raw handlers.
 */

import { z } from 'zod';

import { createHandler, createRawHandler, NotFoundError, systemDb, tenantDb, type AuthContext } from '../kernel';
import {
  assertClinical,
  autosaveConsultation,
  autosaveSchema,
  catalogSchema,
  consultationQueue,
  consultationWorkspace,
  extractFromTranscript,
  suggestFromComplaint,
  finalizeConsultation,
  previewPdf,
  queueQuerySchema,
  searchMedicines,
  startConsultation,
  templateSchema,
  transcribeAudio,
} from '../services/consultation.service';
import {
  deletePatientDocument,
  documentSchema,
  listPatients,
  patientListSchema,
  patientRecord,
  profileSchema,
  readPatientDocument,
  readPrescriptionPdf,
  updatePatientProfile,
  uploadPatientDocument,
} from '../services/patient-record.service';
import {
  doctorBrandSchema,
  getPrescriptionSettings,
  imageSchema,
  readBrandImage,
  readDoctorSignature,
  saveDoctorBranding,
  savePrescriptionSettings,
  setBrandImage,
  settingsSchema,
} from '../services/prescription-settings.service';
import { deliverPrescription } from '../services/prescription-delivery';

const idParams = z.object({ id: z.string().uuid() });
const loose = z.any();
const uuidAt = (request: Request, index: number) => {
  const part = new URL(request.url).pathname.split('/').filter(Boolean)[index];
  if (!part || !/^[0-9a-f-]{36}$/i.test(part)) throw new NotFoundError('Resource');
  return part;
};
const fileResponse = (data: Uint8Array, mimeType: string, fileName?: string, inline = true) =>
  new Response(Buffer.from(data), {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(fileName ? { 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${fileName.replace(/[^\w.-]/g, '_')}"` } : {}),
    },
  });

export const consultationController = {
  // ── consultations ─────────────────────────────────────────────────
  queue: createHandler({ operation: 'consultations.queue', auth: 'tenant', query: queueQuerySchema, response: loose, handle: ({ db, query }) => consultationQueue(db, query) }),

  start: createHandler({
    operation: 'consultations.start',
    auth: 'tenant',
    body: z.object({ appointmentId: z.string().uuid() }),
    response: loose,
    handle: ({ ctx, db, body }) => startConsultation(db, ctx as AuthContext, body.appointmentId),
  }),

  workspace: createHandler({ operation: 'consultations.workspace', auth: 'tenant', params: idParams, response: loose, handle: ({ db, params }) => consultationWorkspace(db, params.id) }),

  autosave: createHandler({
    operation: 'consultations.autosave',
    auth: 'tenant',
    params: idParams,
    body: autosaveSchema,
    response: loose,
    handle: ({ ctx, db, params, body }) => autosaveConsultation(db, ctx as AuthContext, params.id, body),
  }),

  transcribe: createHandler({
    operation: 'consultations.transcribe',
    auth: 'tenant',
    params: idParams,
    body: z.object({ audioBase64: z.string().min(100), mimeType: z.string().regex(/^audio\//), }),
    response: loose,
    rateLimit: { limit: 30, windowMs: 60_000 },
    async handle({ ctx, body }) {
      assertClinical(ctx as AuthContext);
      return transcribeAudio(body);
    },
  }),

  extract: createHandler({
    operation: 'consultations.extract',
    auth: 'tenant',
    params: idParams,
    body: z.object({ originalText: z.string().trim().min(5).max(60000), editedText: z.string().trim().max(60000).optional(), source: z.enum(['voice', 'typed']).default('voice'), audioSeconds: z.number().int().min(0).max(36000).optional() }),
    response: loose,
    rateLimit: { limit: 30, windowMs: 60_000 },
    handle: ({ ctx, db, params, body }) => extractFromTranscript(db, ctx as AuthContext, params.id, body),
  }),

  suggest: createHandler({
    operation: 'consultations.suggest',
    auth: 'tenant',
    params: idParams,
    body: z.object({ complaint: z.string().trim().min(3).max(1000), symptoms: z.string().trim().max(1000).optional(), duration: z.string().trim().max(120).optional(), severity: z.string().trim().max(60).optional() }),
    response: loose,
    rateLimit: { limit: 20, windowMs: 60_000 },
    handle: ({ ctx, db, params, body }) => suggestFromComplaint(db, ctx as AuthContext, params.id, body),
  }),

  finalize: createHandler({
    operation: 'consultations.finalize',
    auth: 'tenant',
    params: idParams,
    body: z.object({ doctorApproved: z.literal(true, { errorMap: () => ({ message: 'Tick the doctor approval to sign.' }) }), revision: z.number().int().min(0) }),
    response: loose,
    message: 'Consultation completed and prescription finalized.',
    async handle({ ctx, db, params, body, request }) {
      const result = await finalizeConsultation(db, ctx as AuthContext, params.id, body, { origin: new URL(request.url).origin });
      // Clinical record is final at this point; delivery problems never undo it.
      const delivery = await deliverPrescription((ctx as AuthContext).tenantId, result.prescriptionId).catch((e) => ({ status: 'failed' as const, message: e instanceof Error ? e.message : 'Delivery error' }));
      return { ...result, delivery };
    },
  }),

  send: createHandler({
    operation: 'prescriptions.send',
    auth: 'tenant',
    params: idParams,
    response: loose,
    rateLimit: { limit: 10, windowMs: 60_000 },
    async handle({ ctx, params }) {
      assertClinical(ctx as AuthContext);
      return deliverPrescription((ctx as AuthContext).tenantId, params.id, { manual: true, byUserId: (ctx as AuthContext).userId });
    },
  }),

  consultationPdf: createRawHandler({
    operation: 'consultations.pdf',
    auth: 'tenant',
    async handle({ request, ctx }) {
      const id = uuidAt(request, 3); // /api/healthcare/consultations/[id]/pdf
      const bytes = await previewPdf(tenantDb(ctx!.tenantId), id);
      return fileResponse(bytes, 'application/pdf', 'prescription-preview.pdf');
    },
  }),

  prescriptionPdf: createRawHandler({
    operation: 'prescriptions.pdf',
    auth: 'tenant',
    async handle({ request, ctx }) {
      const id = uuidAt(request, 3); // /api/healthcare/prescriptions/[id]/pdf
      const download = new URL(request.url).searchParams.get('download') === '1';
      const { data, fileName } = await readPrescriptionPdf(tenantDb(ctx!.tenantId), ctx!, id);
      return fileResponse(data, 'application/pdf', fileName, !download);
    },
  }),

  // ── catalog & templates ───────────────────────────────────────────
  medicines: createHandler({ operation: 'medicines.search', auth: 'tenant', query: z.object({ q: z.string().max(80).default('') }), response: loose, handle: ({ db, query }) => searchMedicines(db, query.q) }),
  addMedicine: createHandler({
    operation: 'medicines.create',
    auth: 'tenant',
    body: catalogSchema,
    response: loose,
    async handle({ ctx, db, body }) {
      assertClinical(ctx as AuthContext);
      return db.medicineCatalog.create({ data: { tenantId: (ctx as AuthContext).tenantId, ...body } as never, select: { id: true, name: true, strength: true } });
    },
  }),
  templates: createHandler({ operation: 'rxTemplates.list', auth: 'tenant', response: loose, handle: ({ db }) => db.prescriptionTemplate.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, doctorId: true, medicines: true, advice: true } }) }),
  saveTemplate: createHandler({
    operation: 'rxTemplates.create',
    auth: 'tenant',
    body: templateSchema,
    response: loose,
    async handle({ ctx, db, body }) {
      assertClinical(ctx as AuthContext);
      // Templates are shortcuts: stored lines are always re-verified when inserted.
      const medicines = body.medicines.map((m) => ({ ...m, verified: false, source: 'template' as const, flags: [] }));
      return db.prescriptionTemplate.create({ data: { tenantId: (ctx as AuthContext).tenantId, name: body.name, doctorId: body.doctorId ?? null, medicines, advice: body.advice ?? {}, createdBy: (ctx as AuthContext).userId } as never, select: { id: true, name: true } });
    },
  }),
  deleteTemplate: createHandler({
    operation: 'rxTemplates.delete',
    auth: 'tenant',
    params: idParams,
    response: loose,
    async handle({ ctx, db, params }) {
      assertClinical(ctx as AuthContext);
      await db.prescriptionTemplate.deleteMany({ where: { id: params.id } });
      return { deleted: true };
    },
  }),

  // ── patients ──────────────────────────────────────────────────────
  patients: createHandler({ operation: 'patients.list', auth: 'tenant', query: patientListSchema, response: loose, handle: ({ db, query }) => listPatients(db, query) }),
  patient: createHandler({ operation: 'patients.get', auth: 'tenant', params: idParams, response: loose, handle: ({ db, params }) => patientRecord(db, params.id) }),
  updatePatient: createHandler({ operation: 'patients.update', auth: 'tenant', params: idParams, body: profileSchema, response: loose, handle: ({ ctx, db, params, body }) => updatePatientProfile(db, ctx as AuthContext, params.id, body) }),
  uploadDocument: createHandler({ operation: 'patients.documents.upload', auth: 'tenant', params: idParams, body: documentSchema, response: loose, status: 201, handle: ({ ctx, db, params, body }) => uploadPatientDocument(db, ctx as AuthContext, params.id, body) }),
  deleteDocument: createHandler({
    operation: 'patients.documents.delete',
    auth: 'tenant',
    params: idParams,
    response: loose,
    async handle({ ctx, db, params }) {
      await deletePatientDocument(db, ctx as AuthContext, params.id);
      return { deleted: true };
    },
  }),
  document: createRawHandler({
    operation: 'patients.documents.read',
    auth: 'tenant',
    async handle({ request, ctx }) {
      const id = uuidAt(request, 3); // /api/healthcare/documents/[id]
      const doc = await readPatientDocument(tenantDb(ctx!.tenantId), ctx!, id);
      return fileResponse(new Uint8Array(doc.data), doc.mimeType, doc.fileName, new URL(request.url).searchParams.get('download') !== '1');
    },
  }),

  // ── prescription branding ─────────────────────────────────────────
  settings: createHandler({ operation: 'rxSettings.get', auth: 'tenant', response: loose, handle: ({ db }) => getPrescriptionSettings(db) }),
  saveSettings: createHandler({ operation: 'rxSettings.save', auth: 'tenant', body: settingsSchema, response: loose, message: 'Prescription settings saved.', handle: ({ ctx, db, body }) => savePrescriptionSettings(db, ctx as AuthContext, body) }),
  setLogo: createHandler({ operation: 'rxSettings.logo', auth: 'tenant', body: z.object({ image: imageSchema.nullable() }), response: loose, handle: ({ ctx, db, body }) => setBrandImage(db, ctx as AuthContext, 'logo', body.image) }),
  setStamp: createHandler({ operation: 'rxSettings.stamp', auth: 'tenant', body: z.object({ image: imageSchema.nullable() }), response: loose, handle: ({ ctx, db, body }) => setBrandImage(db, ctx as AuthContext, 'stamp', body.image) }),
  logo: createRawHandler({ operation: 'rxSettings.logo.read', auth: 'tenant', handle: async ({ ctx }) => { const i = await readBrandImage(tenantDb(ctx!.tenantId), 'logo'); return fileResponse(i.data, i.mimeType); } }),
  stamp: createRawHandler({ operation: 'rxSettings.stamp.read', auth: 'tenant', handle: async ({ ctx }) => { const i = await readBrandImage(tenantDb(ctx!.tenantId), 'stamp'); return fileResponse(i.data, i.mimeType); } }),
  saveDoctor: createHandler({ operation: 'rxSettings.doctor', auth: 'tenant', params: idParams, body: doctorBrandSchema, response: loose, handle: ({ ctx, db, params, body }) => saveDoctorBranding(db, ctx as AuthContext, params.id, body) }),
  signature: createRawHandler({
    operation: 'rxSettings.signature.read',
    auth: 'tenant',
    async handle({ request, ctx }) {
      const id = uuidAt(request, 4); // /api/healthcare/prescription-settings/doctors/[id]/signature
      const i = await readDoctorSignature(tenantDb(ctx!.tenantId), id);
      return fileResponse(i.data, i.mimeType);
    },
  }),

  // ── public verification (no patient details) ──────────────────────
  verify: createHandler({
    operation: 'prescriptions.verify',
    auth: 'public',
    params: z.object({ token: z.string().regex(/^[a-f0-9]{32}$/) }),
    response: loose,
    rateLimit: { limit: 30, windowMs: 60_000 },
    async handle({ params }) {
      const rx = await systemDb.prescription.findFirst({
        where: { verifyToken: params.token, status: 'finalized' },
        select: { prescriptionNo: true, finalizedAt: true, pdfSha256: true, clinic: { select: { clinicName: true } }, doctor: { select: { doctorName: true } }, contact: { select: { name: true } } },
      });
      if (!rx) return { valid: false };
      const initials = (rx.contact.name ?? '').split(/\s+/).filter(Boolean).map((w) => `${w[0]!.toUpperCase()}.`).join(' ');
      return { valid: true, prescriptionNo: rx.prescriptionNo, issuedAt: rx.finalizedAt?.toISOString() ?? null, clinic: rx.clinic.clinicName, doctor: rx.doctor?.doctorName ?? null, patientInitials: initials || null, sha256: rx.pdfSha256 };
    },
  }),
};
