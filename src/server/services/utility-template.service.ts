/**
 * Per-tenant appointment utility templates.
 *
 *  - provision: copies the built-in library for the tenant's business
 *    vertical into the tenant's own `MessageTemplate` rows (Draft). Each
 *    tenant has its own rows and its own approval status — nothing is shared.
 *  - edit: a never-submitted Draft is edited in place; editing anything
 *    already submitted/approved/rejected creates a NEW version (new Meta
 *    name `…_v2`) that needs its own approval. The previous approved version
 *    keeps sending until the new one is approved.
 *  - submit: through the tenant's own WABA (existing WhatsappTransport).
 *    Status only ever becomes Approved from Meta (submit response, webhook
 *    or sync) — never locally.
 */

import { z } from 'zod';

import type { Prisma } from '@prisma/client';

import {
  detectVertical,
  EVENT_LABEL,
  libraryVersionFor,
  libraryFor,
  lintUtilityBody,
  TEMPLATE_EVENTS,
  TEMPLATE_KEYS,
  VARIABLE_SOURCES,
  versionedName,
  VERTICAL_LABEL,
  VERTICALS,
  type TemplateEvent,
  type TemplateVariable,
  type Vertical,
} from '@/lib/whatsapp/appointment-template-library';
import { ConflictError, ExternalApiError, NotFoundError, systemDb, ValidationError, type TenantDb } from '../kernel';
import { buildTemplateComponents, toLocalStatus } from './template-components';
import { WhatsappTransport } from './whatsapp-transport';
import { renderPrescriptionPdf, type RxSnapshot } from './prescription-pdf';

/** Neutral sample used only as the header example Meta reviews. */
const SAMPLE_RX: RxSnapshot = {
  prescriptionNo: 'RX-SAMPLE-0001',
  date: '2026-01-15',
  generatedAt: '2026-01-15T10:00:00.000Z',
  clinic: { name: 'Sample Clinic', address: '1 Health Street', phone: '+91 00000 00000' },
  doctor: { name: 'Dr. Sample Doctor', qualification: 'MBBS', specialization: 'General Physician' },
  patient: { name: 'Sample Patient', patientCode: 'P-000000', age: '30', gender: 'Female' },
  clinical: { chiefComplaint: 'Sample', diagnoses: ['Sample diagnosis'] },
  medicines: [{ name: 'Sample medicine', strength: '500 mg', dosage: '1 tablet', route: 'Oral', frequency: 'Twice daily', duration: '3 days', quantity: '6 tablets' }],
};

// ── reminder settings (stored in Tenant.settings.appointmentReminders) ─

export const REMINDER_OFFSETS = [
  { key: 'r_1d', label: '24 hours before', minutes: 24 * 60 },
  { key: 'r_2h', label: '2 hours before', minutes: 120 },
  { key: 'r_1h', label: '1 hour before', minutes: 60 },
  { key: 'r_30m', label: '30 minutes before', minutes: 30 },
] as const;
export type ReminderKey = (typeof REMINDER_OFFSETS)[number]['key'];
export const DEFAULT_REMINDERS: Record<ReminderKey, boolean> = { r_1d: true, r_2h: true, r_1h: true, r_30m: false };

export function readReminderSettings(settings: unknown): Record<ReminderKey, boolean> {
  const raw = settings && typeof settings === 'object' ? (settings as { appointmentReminders?: unknown }).appointmentReminders : undefined;
  const out = { ...DEFAULT_REMINDERS };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(out) as ReminderKey[]) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

// ── validation ───────────────────────────────────────────────────────

const variableSchema = z.object({
  position: z.number().int().min(1).max(20),
  name: z.string().trim().min(1).max(40),
  source: z.enum(VARIABLE_SOURCES),
  fallback: z.string().trim().max(60).default(''),
  example: z.string().trim().min(1, 'Every variable needs a sample value for Meta review.').max(120),
});
export const updateTemplateSchema = z.object({
  bodyText: z.string().trim().min(10).max(1024),
  footerText: z.string().trim().max(60).nullish(),
  language: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'Use a Meta language code like en_US or hi.').optional(),
  variables: z.array(variableSchema).max(10),
});
export const reminderSettingsSchema = z.object(Object.fromEntries(REMINDER_OFFSETS.map((r) => [r.key, z.boolean()])) as Record<ReminderKey, z.ZodBoolean>);

// ── helpers ──────────────────────────────────────────────────────────

const select = {
  id: true,
  name: true,
  category: true,
  language: true,
  bodyText: true,
  footerText: true,
  headerType: true,
  headerContent: true,
  buttons: true,
  status: true,
  libraryKey: true,
  eventType: true,
  vertical: true,
  libraryVersion: true,
  version: true,
  isEnabled: true,
  metaTemplateId: true,
  wabaId: true,
  variables: true,
  rejectionReason: true,
  submittedAt: true,
  approvedAt: true,
  rejectedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
type TemplateRow = Prisma.MessageTemplateGetPayload<{ select: typeof select }>;

export function readVariables(v: unknown): TemplateVariable[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
    .map((x) => ({
      position: Number(x.position),
      name: String(x.name ?? ''),
      source: (VARIABLE_SOURCES as readonly string[]).includes(String(x.source)) ? (x.source as TemplateVariable['source']) : 'customer_name',
      fallback: String(x.fallback ?? ''),
      example: String(x.example ?? ''),
    }))
    .filter((x) => Number.isInteger(x.position) && x.position > 0)
    .sort((a, b) => a.position - b.position);
}

/** UI-facing status: Drafts that pass the checks are "Ready to submit". */
function displayStatus(row: TemplateRow): string {
  if (row.status === 'Draft') return lintUtilityBody(row.bodyText, readVariables(row.variables)).length ? 'Draft' : 'Ready';
  return row.status;
}

function toDto(row: TemplateRow, latestApprovedId: string | null) {
  const variables = readVariables(row.variables);
  return {
    id: row.id,
    name: row.name,
    event: row.eventType as TemplateEvent,
    eventLabel: EVENT_LABEL[row.eventType as TemplateEvent] ?? row.eventType,
    category: row.category,
    language: row.language,
    bodyText: row.bodyText,
    footerText: row.footerText,
    headerType: row.headerType,
    variables,
    status: row.status,
    displayStatus: displayStatus(row),
    issues: row.status === 'Draft' ? lintUtilityBody(row.bodyText, variables) : [],
    version: row.version,
    vertical: row.vertical,
    isEnabled: row.isEnabled,
    metaTemplateId: row.metaTemplateId,
    rejectionReason: row.rejectionReason,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    /** The version the notification engine will send for this event. */
    inUse: row.id === latestApprovedId,
    libraryOutdated: (row.libraryVersion ?? 1) < libraryVersionFor(row.eventType ?? ''),
  };
}
export type UtilityTemplateDto = ReturnType<typeof toDto>;

export async function resolveVertical(db: TenantDb): Promise<Vertical> {
  const [clinic, biz, profile] = await Promise.all([
    db.clinic.findFirst({ select: { id: true, clinicType: true, clinicName: true } }),
    db.businessProfile.findFirst({ select: { businessType: true, businessName: true } }),
    db.profile.findFirst({ select: { businessType: true } }),
  ]);
  return detectVertical({ hasClinic: Boolean(clinic), clinicType: clinic?.clinicType, businessType: biz?.businessType ?? profile?.businessType, name: clinic?.clinicName ?? biz?.businessName });
}

/**
 * Creates the tenant's copy of every library template that is missing.
 * Idempotent: existing rows (any status, any version) are never touched;
 * a manually created template with the same Meta name is adopted instead
 * of duplicated.
 */
export async function provisionTemplates(db: TenantDb, ctx: { tenantId: string; userId: string }, vertical?: Vertical): Promise<{ vertical: Vertical; created: number; adopted: number }> {
  const v = vertical ?? (await resolveVertical(db));
  const existing = await db.messageTemplate.findMany({ select: { id: true, name: true, language: true, eventType: true, status: true, submittedAt: true, vertical: true, version: true } });
  let created = 0;
  let adopted = 0;
  for (const t of libraryFor(v)) {
    const forEvent = existing.filter((e) => e.eventType === t.event);
    if (forEvent.length) {
      // Business type changed before anything was submitted → refresh the
      // untouched first draft with the new vertical's wording.
      const draft = forEvent.length === 1 && forEvent[0].version === 1 && forEvent[0].status === 'Draft' && !forEvent[0].submittedAt && forEvent[0].vertical !== v ? forEvent[0] : null;
      if (draft) {
        await db.messageTemplate.updateMany({
          where: { id: draft.id },
          data: { bodyText: t.bodyText, footerText: t.footerText, vertical: v, libraryVersion: t.version, variables: t.variables as unknown as Prisma.InputJsonValue },
        });
      }
      continue;
    }
    const sameName = existing.find((e) => e.name === t.key && e.language === t.language && !e.eventType);
    if (sameName) {
      await db.messageTemplate.updateMany({
        where: { id: sameName.id },
        data: { libraryKey: t.key, eventType: t.event, vertical: v, libraryVersion: t.version, variables: t.variables as unknown as Prisma.InputJsonValue, category: 'Utility' },
      });
      adopted += 1;
      continue;
    }
    await db.messageTemplate.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        name: t.key,
        category: 'Utility',
        language: t.language,
        bodyText: t.bodyText,
        footerText: t.footerText,
        headerType: t.headerType === 'document' ? 'document' : null,
        status: 'Draft',
        libraryKey: t.key,
        eventType: t.event,
        vertical: v,
        libraryVersion: t.version,
        version: 1,
        isEnabled: true,
        variables: t.variables as unknown as Prisma.InputJsonValue,
      } as never,
    });
    created += 1;
  }
  return { vertical: v, created, adopted };
}

/** Newest approved + enabled version per event — what the sender uses. */
export function pickActive<T extends { id: string; eventType: string | null; status: string; isEnabled: boolean; version: number; language: string }>(rows: T[], event: string, language?: string): T | null {
  const candidates = rows
    .filter((r) => r.eventType === event && r.status === 'Approved' && r.isEnabled && (!language || r.language === language))
    .sort((a, b) => b.version - a.version);
  return candidates[0] ?? null;
}

export async function listUtilityTemplates(db: TenantDb, ctx: { tenantId: string; userId: string }) {
  const provisioned = await provisionTemplates(db, ctx);
  const [rows, tenant, config] = await Promise.all([
    db.messageTemplate.findMany({ where: { eventType: { not: null } }, select, orderBy: [{ eventType: 'asc' }, { version: 'desc' }] }),
    // Tenant is a global model: read only this tenant's row, by id.
    systemDb.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } }),
    db.whatsappConfig.findFirst({ select: { wabaId: true, phoneNumberId: true } }),
  ]);
  const activeByEvent = new Map<string, string | null>(TEMPLATE_EVENTS.map((e) => [e, pickActive(rows, e)?.id ?? null]));
  const items = rows.map((r) => toDto(r, activeByEvent.get(r.eventType ?? '') ?? null));
  // Order by lifecycle, newest version first.
  items.sort((a, b) => TEMPLATE_EVENTS.indexOf(a.event) - TEMPLATE_EVENTS.indexOf(b.event) || b.version - a.version);
  const latest = TEMPLATE_EVENTS.map((e) => items.find((i) => i.event === e)).filter((x): x is UtilityTemplateDto => Boolean(x));
  const count = (s: string) => latest.filter((i) => i.displayStatus === s).length;
  return {
    vertical: provisioned.vertical,
    verticalLabel: VERTICAL_LABEL[provisioned.vertical],
    verticals: VERTICALS.map((v) => ({ id: v, label: VERTICAL_LABEL[v] })),
    whatsapp: { connected: Boolean(config?.phoneNumberId), wabaId: config?.wabaId ?? null },
    stats: {
      total: latest.length,
      approved: count('Approved'),
      pending: count('Pending'),
      rejected: latest.filter((i) => ['Rejected', 'Paused', 'Disabled'].includes(i.displayStatus)).length,
      draft: count('Draft') + count('Ready'),
      active: TEMPLATE_EVENTS.filter((e) => activeByEvent.get(e)).length,
    },
    reminders: readReminderSettings(tenant?.settings),
    reminderOptions: REMINDER_OFFSETS.map((r) => ({ key: r.key, label: r.label })),
    items,
  };
}

async function loadRow(db: TenantDb, id: string): Promise<TemplateRow> {
  const row = await db.messageTemplate.findFirst({ where: { id, eventType: { not: null } }, select });
  if (!row) throw new NotFoundError('Template');
  return row;
}

export async function updateUtilityTemplate(db: TenantDb, ctx: { tenantId: string; userId: string }, id: string, body: z.infer<typeof updateTemplateSchema>) {
  const row = await loadRow(db, id);
  const variables = [...body.variables].sort((a, b) => a.position - b.position);
  const issues = lintUtilityBody(body.bodyText, variables);
  if (issues.length) throw new ValidationError(issues[0], { details: { issues } });
  const data = {
    bodyText: body.bodyText,
    footerText: body.footerText || null,
    language: body.language ?? row.language,
    variables: variables as unknown as Prisma.InputJsonValue,
  };

  // Never submitted → edit in place.
  if (row.status === 'Draft' && !row.submittedAt) {
    await db.messageTemplate.updateMany({ where: { id }, data });
    return toDto(await loadRow(db, id), null);
  }

  // Submitted / approved / rejected → new version with its own approval.
  const versions = await db.messageTemplate.findMany({ where: { eventType: row.eventType }, select: { version: true, status: true, submittedAt: true, id: true } });
  const openDraft = versions.find((v) => v.status === 'Draft' && !v.submittedAt);
  if (openDraft) {
    await db.messageTemplate.updateMany({ where: { id: openDraft.id }, data });
    return toDto(await loadRow(db, openDraft.id), null);
  }
  const version = Math.max(...versions.map((v) => v.version)) + 1;
  const created = await db.messageTemplate.create({
    data: {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      name: versionedName(row.libraryKey ?? TEMPLATE_KEYS[row.eventType as TemplateEvent], version),
      category: 'Utility',
      status: 'Draft',
      libraryKey: row.libraryKey,
      eventType: row.eventType,
      vertical: row.vertical,
      libraryVersion: row.libraryVersion,
      version,
      isEnabled: true,
      ...data,
    } as never,
    select: { id: true },
  });
  return toDto(await loadRow(db, created.id), null);
}

/** Restores the library wording for an event as a fresh draft/version. */
export async function resetToLibrary(db: TenantDb, ctx: { tenantId: string; userId: string }, id: string) {
  const row = await loadRow(db, id);
  const vertical = (VERTICALS as readonly string[]).includes(row.vertical ?? '') ? (row.vertical as Vertical) : await resolveVertical(db);
  const lib = libraryFor(vertical).find((t) => t.event === row.eventType);
  if (!lib) throw new NotFoundError('Library template');
  return updateUtilityTemplate(db, ctx, id, { bodyText: lib.bodyText, footerText: lib.footerText, language: lib.language, variables: lib.variables });
}

export async function submitUtilityTemplate(db: TenantDb, ctx: { tenantId: string; userId: string }, id: string) {
  const row = await loadRow(db, id);
  if (row.status === 'Approved') throw new ConflictError('This template is already approved by Meta. Edit it to submit a new version.');
  if (row.status === 'Pending') throw new ConflictError('This template is already waiting for Meta review.');
  const variables = readVariables(row.variables);
  const issues = lintUtilityBody(row.bodyText, variables);
  if (issues.length) throw new ValidationError(issues[0], { details: { issues } });

  const transport = await WhatsappTransport.forTenant(db);
  if (!transport) throw new ValidationError('Connect your WhatsApp Business account in Integrations before submitting templates.');
  const config = await db.whatsappConfig.findFirst({ select: { wabaId: true } });

  // A rejected/paused/disabled version cannot be re-created under the same
  // name; move it to a fresh version name first.
  let target = row;
  if (row.submittedAt && row.status !== 'Draft') {
    const versions = await db.messageTemplate.findMany({ where: { eventType: row.eventType }, select: { version: true } });
    const version = Math.max(...versions.map((v) => v.version)) + 1;
    const created = await db.messageTemplate.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        name: versionedName(row.libraryKey ?? TEMPLATE_KEYS[row.eventType as TemplateEvent], version),
        category: 'Utility',
        language: row.language,
        bodyText: row.bodyText,
        footerText: row.footerText,
        status: 'Draft',
        libraryKey: row.libraryKey,
        headerType: row.headerType,
        eventType: row.eventType,
        vertical: row.vertical,
        libraryVersion: row.libraryVersion,
        version,
        isEnabled: true,
        variables: variables as unknown as Prisma.InputJsonValue,
      } as never,
      select: { id: true },
    });
    target = await loadRow(db, created.id);
  }

  // Document-header templates (prescriptions) need a sample PDF for Meta's review.
  let headerExample: string | undefined;
  if (target.headerType === 'document') {
    const sample = await renderPrescriptionPdf(SAMPLE_RX, {}, { final: false });
    headerExample = await transport.uploadTemplateSample({ bytes: sample, mimeType: 'application/pdf', fileName: 'sample-prescription.pdf' });
  }

  const { components } = buildTemplateComponents({
    name: target.name,
    category: 'Utility',
    language: target.language,
    headerType: target.headerType === 'document' ? 'document' : 'none',
    headerExample,
    bodyText: target.bodyText,
    bodyExample: variables.map((v) => v.example),
    footerText: target.footerText ?? undefined,
  });

  let result: { status: string; id?: string };
  try {
    result = await transport.submit({ name: target.name, language: target.language, category: 'UTILITY', components });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await db.messageTemplate.updateMany({ where: { id: target.id }, data: { rejectionReason: msg.slice(0, 2000) } });
    if (/already exists|duplicate|2388024/i.test(msg)) {
      throw new ConflictError('A template with this name already exists on your WhatsApp account. Use "Sync with Meta" to pull its status.', { details: { meta: msg } });
    }
    throw new ExternalApiError('Meta', `Meta did not accept the template: ${msg}`, { cause: error });
  }

  const status = toLocalStatus(result.status);
  const now = new Date();
  await db.messageTemplate.updateMany({
    where: { id: target.id },
    data: {
      status,
      metaTemplateId: result.id ?? null,
      wabaId: config?.wabaId ?? null,
      submittedAt: now,
      rejectionReason: null,
      ...(status === 'Approved' ? { approvedAt: now } : {}),
      ...(status === 'Rejected' ? { rejectedAt: now } : {}),
    },
  });
  return toDto(await loadRow(db, target.id), null);
}

/** Pulls status, Meta ids and rejection reasons for this tenant's WABA. */
export async function syncUtilityTemplates(db: TenantDb) {
  const transport = await WhatsappTransport.forTenant(db);
  if (!transport) throw new ValidationError('Connect your WhatsApp Business account in Integrations first.');
  let listed: Awaited<ReturnType<WhatsappTransport['listAll']>>;
  try {
    listed = await transport.listAll();
  } catch (error) {
    throw new ExternalApiError('Meta', `Could not read templates from Meta: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
  }
  const rows = await db.messageTemplate.findMany({ where: { eventType: { not: null } }, select });
  let updated = 0;
  for (const row of rows) {
    const remote = listed.templates.find((t) => (row.metaTemplateId && t.id === row.metaTemplateId) || (t.name === row.name && t.language === row.language));
    if (!remote) continue;
    const status = toLocalStatus(remote.status);
    const changed = status !== row.status || (remote.id && remote.id !== row.metaTemplateId) || (remote.rejectedReason ?? null) !== (row.rejectionReason ?? null);
    if (!changed) continue;
    const now = new Date();
    await db.messageTemplate.updateMany({
      where: { id: row.id },
      data: {
        status,
        metaTemplateId: remote.id ?? row.metaTemplateId,
        submittedAt: row.submittedAt ?? now,
        rejectionReason: status === 'Approved' ? null : remote.rejectedReason && remote.rejectedReason !== 'NONE' ? remote.rejectedReason : row.rejectionReason,
        ...(status === 'Approved' && !row.approvedAt ? { approvedAt: now } : {}),
        ...(['Rejected', 'Paused', 'Disabled'].includes(status) && row.status !== status ? { rejectedAt: now } : {}),
      },
    });
    updated += 1;
  }
  return { updated, checked: rows.length };
}

/**
 * Deletes a template version: from Meta first (only that exact template, by
 * id) when it was ever submitted, then locally. If no version is left for
 * the event, the next list re-creates a default draft so the event stays
 * covered.
 */
export async function deleteUtilityTemplate(db: TenantDb, id: string): Promise<void> {
  const row = await loadRow(db, id);
  if (row.submittedAt || row.metaTemplateId || row.status !== 'Draft') {
    const transport = await WhatsappTransport.forTenant(db);
    if (transport) {
      try {
        await transport.remove({ name: row.name, templateId: row.metaTemplateId ?? undefined });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // Already gone at Meta → still clean up locally.
        if (!/not found|does not exist|100|#100|2593002/i.test(msg)) {
          throw new ExternalApiError('Meta', `Meta could not delete "${row.name}": ${msg}`, { cause: error });
        }
      }
    }
  }
  await db.messageTemplate.deleteMany({ where: { id } });
}

export type BulkResult = { id: string; name: string; ok: boolean; error?: string };

/** Submits or deletes several templates; one failure doesn't stop the rest. */
export async function bulkUtilityTemplates(db: TenantDb, ctx: { tenantId: string; userId: string }, action: 'submit' | 'delete', ids: string[]): Promise<{ results: BulkResult[]; succeeded: number; failed: number }> {
  const results: BulkResult[] = [];
  for (const id of [...new Set(ids)]) {
    const name = (await db.messageTemplate.findFirst({ where: { id, eventType: { not: null } }, select: { name: true } }))?.name ?? id;
    try {
      if (action === 'submit') await submitUtilityTemplate(db, ctx, id);
      else await deleteUtilityTemplate(db, id);
      results.push({ id, name, ok: true });
    } catch (error) {
      results.push({ id, name, ok: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
  const succeeded = results.filter((r) => r.ok).length;
  return { results, succeeded, failed: results.length - succeeded };
}

export async function setTemplateEnabled(db: TenantDb, id: string, enabled: boolean) {
  await loadRow(db, id);
  await db.messageTemplate.updateMany({ where: { id }, data: { isEnabled: enabled } });
  return toDto(await loadRow(db, id), null);
}

export async function saveReminderSettings(tenantId: string, settings: Record<ReminderKey, boolean>) {
  // Tenant is a global model: update only the caller's own row, by id.
  const tenant = await systemDb.tenant.findUnique({ where: { id: tenantId }, select: { id: true, settings: true } });
  if (!tenant) throw new NotFoundError('Workspace');
  const current = tenant.settings && typeof tenant.settings === 'object' ? (tenant.settings as Record<string, unknown>) : {};
  await systemDb.tenant.update({ where: { id: tenantId }, data: { settings: { ...current, appointmentReminders: settings } as Prisma.InputJsonValue } });
  return readReminderSettings({ appointmentReminders: settings });
}
