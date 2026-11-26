/**
 * Health & fitness members and packages.
 *
 *   Packages      what the gym sells (duration, price, joining fee).
 *   Members       people onboarded manually or imported; each is linked to a
 *                 Contact so the Inbox, campaigns and CRM see one person.
 *   Memberships   a package assigned to a member for a period, with payment.
 *
 * Everything runs on the tenant-scoped client. New members can get an
 * instant WhatsApp welcome (free text inside the 24-hour window, otherwise
 * the approved "Membership activated" template).
 */

import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { ConflictError, getLogger, NotFoundError, ValidationError, type TenantDb } from '../kernel';
import { normalizeBookingPhone } from './public-booking.service';
import { deliverMemberMessage } from './member-notify';

const log = getLogger('gym-members');
const DAY = 86_400_000;

// ── helpers ──────────────────────────────────────────────────────────

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.');
const money = z.coerce.number().min(0).max(10_000_000);
export const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
export const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
export function todayUtc(): string {
  // Business days follow India time (the product's market).
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}
/** Inclusive end date: a 30-day package starting 1 Dec ends 30 Dec. */
export function endDateFor(start: string, durationDays: number): string {
  return new Date(toDate(start).getTime() + (Math.max(1, durationDays) - 1) * DAY).toISOString().slice(0, 10);
}
export function paymentStatusFor(due: number, paid: number): 'paid' | 'partial' | 'unpaid' {
  if (paid <= 0) return due <= 0 ? 'paid' : 'unpaid';
  return paid + 0.005 >= due ? 'paid' : 'partial';
}
const pretty = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

async function requireBusiness(db: TenantDb) {
  const biz = await db.businessProfile.findFirst({ select: { id: true, businessName: true } });
  if (!biz) throw new NotFoundError('Business profile', { details: { hint: 'Complete Business Setup first.' } });
  return biz;
}

/** "Get Fit Gym" → "GF". */
export function codePrefix(name: string | null | undefined): string {
  const words = (name ?? '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const p = words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  return p.length >= 2 ? p : (words[0]?.slice(0, 2).toUpperCase() || 'MB');
}

async function nextMemberCode(db: TenantDb, businessId: string, prefix: string): Promise<string> {
  const rows = await db.gymMember.findMany({ where: { businessId, memberCode: { startsWith: `${prefix}-` } }, select: { memberCode: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.memberCode.split('-').pop()) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

// ── packages ─────────────────────────────────────────────────────────

export const packageSchema = z.object({
  name: z.string().trim().min(2, 'Enter the package name.').max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  durationDays: z.coerce.number().int().min(1, 'Duration must be at least 1 day.').max(3650),
  price: money,
  joiningFee: money.nullable().optional(),
  features: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

function toPackageRow(p: { id: string; name: string; description: string | null; durationDays: number; price: Prisma.Decimal; joiningFee: Prisma.Decimal | null; features: unknown; isActive: boolean; sortOrder: number }, activeMembers = 0) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    durationDays: p.durationDays,
    price: num(p.price),
    joiningFee: p.joiningFee == null ? null : num(p.joiningFee),
    features: Array.isArray(p.features) ? (p.features as string[]) : [],
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    activeMembers,
  };
}

export async function listPackages(db: TenantDb) {
  const biz = await requireBusiness(db);
  const today = toDate(todayUtc());
  const [rows, active] = await Promise.all([
    db.gymPackage.findMany({ where: { businessId: biz.id }, orderBy: [{ sortOrder: 'asc' }, { durationDays: 'asc' }, { name: 'asc' }] }),
    db.gymMembership.groupBy({ by: ['packageId'], where: { status: 'active', endDate: { gte: today }, member: { businessId: biz.id } }, _count: { _all: true } }),
  ]);
  const counts = new Map(active.map((a) => [a.packageId, a._count._all]));
  return { items: rows.map((p) => toPackageRow(p, counts.get(p.id) ?? 0)) };
}

export async function createPackage(db: TenantDb, ctx: { tenantId: string }, body: z.infer<typeof packageSchema>) {
  const biz = await requireBusiness(db);
  const row = await db.gymPackage.create({
    data: { tenantId: ctx.tenantId, businessId: biz.id, name: body.name, description: body.description || null, durationDays: body.durationDays, price: body.price, joiningFee: body.joiningFee ?? null, features: body.features ?? [], isActive: body.isActive, sortOrder: body.sortOrder },
  });
  return toPackageRow(row);
}

export async function updatePackage(db: TenantDb, id: string, body: z.infer<typeof packageSchema>) {
  const biz = await requireBusiness(db);
  const res = await db.gymPackage.updateMany({
    where: { id, businessId: biz.id },
    data: { name: body.name, description: body.description || null, durationDays: body.durationDays, price: body.price, joiningFee: body.joiningFee ?? null, features: body.features ?? [], isActive: body.isActive, sortOrder: body.sortOrder },
  });
  if (!res.count) throw new NotFoundError('Package');
  const row = await db.gymPackage.findFirst({ where: { id, businessId: biz.id } });
  return toPackageRow(row!);
}

/** Memberships keep their own copy of the package name and price, so history survives. */
export async function deletePackage(db: TenantDb, id: string) {
  const biz = await requireBusiness(db);
  const res = await db.gymPackage.deleteMany({ where: { id, businessId: biz.id } });
  if (!res.count) throw new NotFoundError('Package');
  return { deleted: true };
}

// ── members ──────────────────────────────────────────────────────────

const optText = (max: number) => z.string().trim().max(max).nullable().optional();

export const assignSchema = z.object({
  packageId: z.string().uuid(),
  startDate: ymd,
  /** Overrides the package price (e.g. a negotiated rate). */
  price: money.optional(),
  discount: money.default(0),
  amountPaid: money.default(0),
  paymentMode: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'online', 'other']).nullable().optional(),
  includeJoiningFee: z.boolean().default(false),
  notes: optText(1000),
});

export const memberSchema = z.object({
  name: z.string().trim().min(2, 'Enter the name.').max(120),
  phone: z.string().trim().min(6, 'Enter the WhatsApp number.').max(20),
  email: z.string().trim().email('Enter a valid email.').max(191).nullable().optional().or(z.literal('')),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  dateOfBirth: ymd.nullable().optional().or(z.literal('')),
  address: optText(500),
  emergencyContactName: optText(120),
  emergencyContactPhone: optText(20),
  heightCm: z.coerce.number().int().min(50).max(260).nullable().optional(),
  weightKg: z.coerce.number().min(10).max(400).nullable().optional(),
  fitnessGoal: optText(191),
  medicalNotes: optText(2000),
  notes: optText(2000),
  joinedAt: ymd.optional(),
  status: z.enum(['active', 'frozen', 'inactive']).default('active'),
  whatsappConsent: z.boolean().default(true),
});

export const createMemberSchema = memberSchema.extend({
  membership: assignSchema.nullable().optional(),
  sendWelcome: z.boolean().default(true),
});

export const memberListSchema = z.object({
  filter: z.enum(['all', 'active', 'expiring', 'expired', 'no_package', 'frozen']).default('all'),
  search: z.string().trim().max(100).optional(),
  packageId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const bulkIdsSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

type MembershipRow = { id: string; packageId: string | null; packageName: string; startDate: Date; endDate: Date; price: Prisma.Decimal; discount: Prisma.Decimal; amountPaid: Prisma.Decimal; paymentStatus: string; paymentMode: string | null; status: string; notes: string | null; createdAt: Date };

function toMembershipRow(m: MembershipRow, today = todayUtc()) {
  const end = dateStr(m.endDate)!;
  const start = dateStr(m.startDate)!;
  const due = Math.max(0, num(m.price) - num(m.discount));
  return {
    id: m.id,
    packageId: m.packageId,
    packageName: m.packageName,
    startDate: start,
    endDate: end,
    price: num(m.price),
    discount: num(m.discount),
    amountPaid: num(m.amountPaid),
    balance: Math.max(0, due - num(m.amountPaid)),
    paymentStatus: m.paymentStatus,
    paymentMode: m.paymentMode,
    status: m.status,
    notes: m.notes,
    state: m.status === 'cancelled' ? 'cancelled' : start > today ? 'upcoming' : end < today ? 'expired' : 'active',
    daysLeft: Math.round((toDate(end).getTime() - toDate(today).getTime()) / DAY),
    createdAt: m.createdAt.toISOString(),
  };
}
export type MembershipDto = ReturnType<typeof toMembershipRow>;

/** The membership that defines "now": the running one, else the next upcoming, else the latest ended. */
export function currentMembership(list: MembershipDto[]): MembershipDto | null {
  const live = list.filter((m) => m.state !== 'cancelled');
  return (
    live.filter((m) => m.state === 'active').sort((a, b) => b.endDate.localeCompare(a.endDate))[0] ??
    live.filter((m) => m.state === 'upcoming').sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ??
    live.sort((a, b) => b.endDate.localeCompare(a.endDate))[0] ??
    null
  );
}

const memberInclude = { memberships: { orderBy: { endDate: 'desc' as const }, take: 20 } };
type MemberWithMemberships = Prisma.GymMemberGetPayload<{ include: typeof memberInclude }>;

function toMemberRow(m: MemberWithMemberships) {
  const memberships = m.memberships.map((x) => toMembershipRow(x));
  const current = currentMembership(memberships);
  return {
    id: m.id,
    contactId: m.contactId,
    memberCode: m.memberCode,
    name: m.name,
    phone: m.phone,
    email: m.email,
    gender: m.gender,
    dateOfBirth: dateStr(m.dateOfBirth),
    address: m.address,
    emergencyContactName: m.emergencyContactName,
    emergencyContactPhone: m.emergencyContactPhone,
    heightCm: m.heightCm,
    weightKg: m.weightKg == null ? null : num(m.weightKg),
    fitnessGoal: m.fitnessGoal,
    medicalNotes: m.medicalNotes,
    notes: m.notes,
    joinedAt: dateStr(m.joinedAt),
    status: m.status,
    source: m.source,
    whatsappConsent: m.whatsappConsent,
    welcomeSentAt: m.welcomeSentAt?.toISOString() ?? null,
    lastAttendanceAt: m.lastAttendanceAt?.toISOString() ?? null,
    current,
    memberships,
    createdAt: m.createdAt.toISOString(),
  };
}
export type MemberDto = ReturnType<typeof toMemberRow>;

export async function listMembers(db: TenantDb, q: z.infer<typeof memberListSchema>) {
  const biz = await requireBusiness(db);
  const today = toDate(todayUtc());
  const soon = new Date(today.getTime() + 7 * DAY);
  const running = { status: 'active', startDate: { lte: today }, endDate: { gte: today } } satisfies Prisma.GymMembershipWhereInput;
  const and: Prisma.GymMemberWhereInput[] = [{ businessId: biz.id }];
  if (q.search) {
    const s = q.search;
    and.push({ OR: [{ name: { contains: s } }, { memberCode: { contains: s.toUpperCase() } }, { phone: { contains: s.replace(/\D/g, '') || s } }, { email: { contains: s } }] });
  }
  if (q.packageId) and.push({ memberships: { some: { packageId: q.packageId, status: 'active' } } });
  if (q.filter === 'active') and.push({ status: 'active', memberships: { some: running } });
  if (q.filter === 'expiring') and.push({ memberships: { some: { ...running, endDate: { gte: today, lte: soon } } } }, { memberships: { none: { status: 'active', startDate: { gt: today } } } });
  if (q.filter === 'expired') and.push({ memberships: { some: { status: 'active' } } }, { memberships: { none: { status: 'active', endDate: { gte: today } } } });
  if (q.filter === 'no_package') and.push({ memberships: { none: { status: 'active' } } });
  if (q.filter === 'frozen') and.push({ status: 'frozen' });
  const where: Prisma.GymMemberWhereInput = { AND: and };

  const monthStart = toDate(`${todayUtc().slice(0, 7)}-01`);
  const [total, rows, all, active, expiring, expired, newThisMonth] = await Promise.all([
    db.gymMember.count({ where }),
    db.gymMember.findMany({ where, include: memberInclude, orderBy: [{ createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.gymMember.count({ where: { businessId: biz.id } }),
    db.gymMember.count({ where: { businessId: biz.id, status: 'active', memberships: { some: running } } }),
    db.gymMember.count({ where: { businessId: biz.id, AND: [{ memberships: { some: { ...running, endDate: { gte: today, lte: soon } } } }, { memberships: { none: { status: 'active', startDate: { gt: today } } } }] } }),
    db.gymMember.count({ where: { businessId: biz.id, AND: [{ memberships: { some: { status: 'active' } } }, { memberships: { none: { status: 'active', endDate: { gte: today } } } }] } }),
    db.gymMember.count({ where: { businessId: biz.id, createdAt: { gte: monthStart } } }),
  ]);
  return {
    items: rows.map(toMemberRow),
    pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
    stats: { total: all, active, expiring, expired, newThisMonth },
  };
}

export async function getMember(db: TenantDb, id: string) {
  const biz = await requireBusiness(db);
  const m = await db.gymMember.findFirst({ where: { id, businessId: biz.id }, include: { memberships: { orderBy: { endDate: 'desc' } } } });
  if (!m) throw new NotFoundError('Member');
  const [messages, conversation] = await Promise.all([
    db.memberMessageLog.findMany({ where: { memberId: id }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, eventType: true, channel: true, status: true, templateName: true, errorMessage: true, createdAt: true, sentAt: true } }),
    db.conversation.findFirst({ where: { contactId: m.contactId }, orderBy: { updatedAt: 'desc' }, select: { id: true } }),
  ]);
  return {
    ...toMemberRow(m),
    conversationId: conversation?.id ?? null,
    messages: messages.map((x) => ({ ...x, createdAt: x.createdAt.toISOString(), sentAt: x.sentAt?.toISOString() ?? null })),
  };
}

/** Existing contact by phone, otherwise a new one. */
async function contactFor(db: TenantDb, ctx: { tenantId: string; userId: string }, phone: string, name: string, email: string | null) {
  const existing = await db.contact.findFirst({ where: { phone }, select: { id: true, name: true, email: true } });
  if (existing) {
    const patch: Record<string, string> = {};
    if (!existing.name) patch.name = name;
    if (!existing.email && email) patch.email = email;
    if (Object.keys(patch).length) await db.contact.updateMany({ where: { id: existing.id }, data: patch });
    return existing.id;
  }
  const created = await db.contact.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, phone, name, email } as never, select: { id: true } });
  return created.id;
}

function memberData(body: z.infer<typeof memberSchema>) {
  return {
    name: body.name,
    email: body.email || null,
    gender: body.gender ?? null,
    dateOfBirth: body.dateOfBirth ? toDate(body.dateOfBirth) : null,
    address: body.address || null,
    emergencyContactName: body.emergencyContactName || null,
    emergencyContactPhone: body.emergencyContactPhone || null,
    heightCm: body.heightCm ?? null,
    weightKg: body.weightKg ?? null,
    fitnessGoal: body.fitnessGoal || null,
    medicalNotes: body.medicalNotes || null,
    notes: body.notes || null,
    status: body.status,
    whatsappConsent: body.whatsappConsent,
  };
}

/** Validates an assignment and returns the membership row to create (no writes). */
async function planMembership(db: TenantDb, businessId: string, a: z.infer<typeof assignSchema>) {
  const pkg = await db.gymPackage.findFirst({ where: { id: a.packageId, businessId } });
  if (!pkg) throw new ValidationError('That package no longer exists.');
  const base = a.price ?? num(pkg.price);
  const price = base + (a.includeJoiningFee ? num(pkg.joiningFee) : 0);
  const discount = Math.min(a.discount, price);
  const due = price - discount;
  if (a.amountPaid > due + 0.005) throw new ValidationError('Amount paid is more than the amount due.');
  return { pkg, price, discount, due };
}

async function createMembership(db: TenantDb, tenantId: string, memberId: string, businessId: string, a: z.infer<typeof assignSchema>) {
  const { pkg, price, discount, due } = await planMembership(db, businessId, a);
  return db.gymMembership.create({
    data: {
      tenantId,
      memberId,
      packageId: pkg.id,
      packageName: pkg.name,
      startDate: toDate(a.startDate),
      endDate: toDate(endDateFor(a.startDate, pkg.durationDays)),
      price,
      discount,
      amountPaid: a.amountPaid,
      paymentStatus: paymentStatusFor(due, a.amountPaid),
      paymentMode: a.paymentMode ?? null,
      notes: a.notes || null,
    },
  });
}

export async function createMember(db: TenantDb, ctx: { tenantId: string; userId: string }, body: z.infer<typeof createMemberSchema>, source: 'manual' | 'import' = 'manual') {
  const biz = await requireBusiness(db);
  const phone = normalizeBookingPhone(body.phone, '91');
  if (!phone) throw new ValidationError('Enter a valid WhatsApp number.');
  const contactId = await contactFor(db, ctx, phone, body.name, body.email || null);
  if (await db.gymMember.findFirst({ where: { businessId: biz.id, contactId }, select: { id: true } })) {
    throw new ConflictError('A member with this phone number already exists.');
  }
  // Check the package and amounts first, so a bad assignment leaves nothing behind.
  if (body.membership) await planMembership(db, biz.id, body.membership);
  const prefix = codePrefix(biz.businessName);
  let member: { id: string } | null = null;
  for (let attempt = 0; attempt < 3 && !member; attempt++) {
    try {
      member = await db.gymMember.create({
        data: {
          tenantId: ctx.tenantId,
          businessId: biz.id,
          contactId,
          memberCode: await nextMemberCode(db, biz.id, prefix),
          phone,
          joinedAt: toDate(body.joinedAt ?? body.membership?.startDate ?? todayUtc()),
          source,
          ...memberData(body),
        },
        select: { id: true },
      });
    } catch (error) {
      // Two members created at once can pick the same code; take the next one.
      if ((error as { code?: string }).code !== 'P2002' || attempt === 2) throw error;
    }
  }
  if (body.membership) await createMembership(db, ctx.tenantId, member!.id, biz.id, body.membership);
  let welcome: string | null = null;
  if (body.sendWelcome && body.whatsappConsent) welcome = (await sendWelcome(db, ctx.tenantId, member!.id)).status;
  return { member: await getMember(db, member!.id), welcome };
}

export async function updateMember(db: TenantDb, id: string, body: z.infer<typeof memberSchema>) {
  const biz = await requireBusiness(db);
  const before = await db.gymMember.findFirst({ where: { id, businessId: biz.id }, select: { id: true, phone: true } });
  if (!before) throw new NotFoundError('Member');
  const phone = normalizeBookingPhone(body.phone, '91');
  if (!phone) throw new ValidationError('Enter a valid WhatsApp number.');
  if (phone !== before.phone) throw new ValidationError('The WhatsApp number identifies the member and cannot be changed here. Add them as a new member instead.');
  await db.gymMember.updateMany({ where: { id, businessId: biz.id }, data: { ...memberData(body), ...(body.joinedAt ? { joinedAt: toDate(body.joinedAt) } : {}) } });
  return getMember(db, id);
}

/** Removes the members and their memberships and message history. The WhatsApp contact and chats stay. */
export async function deleteMembers(db: TenantDb, ids: string[]) {
  const biz = await requireBusiness(db);
  const unique = [...new Set(ids)];
  const found = await db.gymMember.findMany({ where: { id: { in: unique }, businessId: biz.id }, select: { id: true } });
  const deleted = found.map((m) => m.id);
  if (deleted.length) await db.gymMember.deleteMany({ where: { id: { in: deleted }, businessId: biz.id } });
  const seen = new Set(deleted);
  return { deleted, blocked: unique.filter((i) => !seen.has(i)).map((i) => ({ id: i, reason: 'Member not found.' })) };
}

export async function assignMembership(db: TenantDb, ctx: { tenantId: string }, memberId: string, body: z.infer<typeof assignSchema>) {
  const biz = await requireBusiness(db);
  const m = await db.gymMember.findFirst({ where: { id: memberId, businessId: biz.id }, select: { id: true } });
  if (!m) throw new NotFoundError('Member');
  await createMembership(db, ctx.tenantId, memberId, biz.id, body);
  return getMember(db, memberId);
}

export const membershipUpdateSchema = z.object({
  amountPaid: money.optional(),
  paymentMode: assignSchema.shape.paymentMode,
  status: z.enum(['active', 'cancelled']).optional(),
  notes: optText(1000),
});

export async function updateMembership(db: TenantDb, memberId: string, membershipId: string, body: z.infer<typeof membershipUpdateSchema>) {
  const biz = await requireBusiness(db);
  const row = await db.gymMembership.findFirst({ where: { id: membershipId, memberId, member: { businessId: biz.id } } });
  if (!row) throw new NotFoundError('Membership');
  const due = Math.max(0, num(row.price) - num(row.discount));
  const paid = body.amountPaid ?? num(row.amountPaid);
  if (paid > due + 0.005) throw new ValidationError('Amount paid is more than the amount due.');
  await db.gymMembership.updateMany({
    where: { id: membershipId },
    data: {
      amountPaid: paid,
      paymentStatus: paymentStatusFor(due, paid),
      ...(body.paymentMode !== undefined ? { paymentMode: body.paymentMode } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
    },
  });
  return getMember(db, memberId);
}

// ── welcome message ──────────────────────────────────────────────────

export async function sendWelcome(db: TenantDb, tenantId: string, memberId: string, opts: { resend?: boolean } = {}) {
  const biz = await requireBusiness(db);
  const m = await db.gymMember.findFirst({ where: { id: memberId, businessId: biz.id }, include: { memberships: { orderBy: { endDate: 'desc' }, take: 5 } } });
  if (!m) throw new NotFoundError('Member');
  if (!m.whatsappConsent) throw new ValidationError('This member has not agreed to WhatsApp messages.');
  const current = currentMembership(m.memberships.map((x) => toMembershipRow(x)));
  const business = biz.businessName || 'our gym';
  const first = m.name.split(/\s+/)[0] || m.name;
  const lines = [
    `Hi ${first}! 👋 Welcome to *${business}*. 💪`,
    '',
    `🆔 Member ID: *${m.memberCode}*`,
    current ? `📦 Package: ${current.packageName}` : null,
    current ? `📅 Valid: ${pretty(current.startDate)} – ${pretty(current.endDate)}` : null,
    '',
    'Show your member ID at the front desk on your first visit. Reply here anytime if you need help. See you at the gym! 🏋️',
  ].filter((l): l is string => l !== null);
  const result = await deliverMemberMessage({
    tenantId,
    memberId: m.id,
    contactId: m.contactId,
    phone: m.phone,
    consent: m.whatsappConsent,
    event: 'member_welcome',
    // A deliberate resend gets its own key (one per minute at most).
    eventKey: opts.resend ? `welcome#${new Date().toISOString().slice(0, 16)}` : 'welcome',
    text: lines.join('\n'),
    values: {
      customer_name: m.name,
      business_name: business,
      member_code: m.memberCode,
      package_name: current?.packageName ?? null,
      membership_start: current ? pretty(current.startDate) : null,
      membership_end: current ? pretty(current.endDate) : null,
    },
  });
  if (result.status === 'sent') await db.gymMember.updateMany({ where: { id: m.id }, data: { welcomeSentAt: new Date() } });
  else log.info('welcome not sent', { tenantId, memberId, status: result.status });
  return result;
}

// ── import ───────────────────────────────────────────────────────────

export const importRowSchema = memberSchema.extend({
  packageId: z.string().uuid().nullable().optional(),
  startDate: ymd.nullable().optional().or(z.literal('')),
  amountPaid: money.nullable().optional(),
});
export const importSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(2000),
  sendWelcome: z.boolean().default(false),
});

/**
 * Creates the reviewed rows. Rows whose phone already belongs to a member are
 * skipped (reported), never overwritten. Welcome messages are optional.
 */
export async function importMembers(db: TenantDb, ctx: { tenantId: string; userId: string }, body: z.infer<typeof importSchema>) {
  const created: string[] = [];
  const skipped: Array<{ row: number; name: string; reason: string }> = [];
  for (const [i, r] of body.rows.entries()) {
    try {
      const membership = r.packageId && r.startDate ? { packageId: r.packageId, startDate: r.startDate, discount: 0, amountPaid: r.amountPaid ?? 0, includeJoiningFee: false } : null;
      const res = await createMember(db, ctx, { ...r, membership, sendWelcome: body.sendWelcome }, 'import');
      created.push(res.member.id);
    } catch (error) {
      skipped.push({ row: i + 1, name: r.name, reason: error instanceof Error ? error.message : 'Could not be added.' });
    }
  }
  return { created: created.length, skipped };
}
