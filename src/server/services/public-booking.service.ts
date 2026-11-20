/**
 * Public booking (booking link + QR code).
 *
 * The link id is the clinic id (healthcare) or business-profile id (every
 * other business type). Everything a customer sees comes from Business
 * Setup: timings, closures, departments (doctor specialisations), doctors,
 * their weekly slots and leaves, and services.
 */

import { z } from 'zod';

import { exceptionsToRecord } from '@/lib/healthcare/exceptions';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { ConflictError, NotFoundError, systemDb, tenantDb, ValidationError } from '../kernel';
import { bookingSlugFor, isUuid, resolveBookingRef } from './booking-slug';
import { appointmentValues, deliverAppointmentMessage } from './appointment-notify';
import { triggerRealtimeEvent } from '@/lib/realtime';
import { AppointmentService, CLINIC_TIME_ZONE } from './appointment.service';
import { availabilityQuerySchema, bookAppointmentBodySchema } from '../validators/clinic.validator';
import { addDays, computeDaySlots, todayIn, type DayTiming } from './availability';
import {
  appointmentConfirmationText,
  assignToken,
  bookingRef,
  notifyTenant,
  pretty,
  prettyTime,
  pushToGoogleSheet,
  sendTenantText,
} from './booking-notify';

export const publicBookingBodySchema = z.object({
  name: z.string().trim().min(2, 'Please enter your full name.').max(120),
  /** WhatsApp number — optional for clinics, required for other businesses. */
  phone: z.string().trim().max(20).optional().default(''),
  email: z.string().trim().email('Please enter a valid email address.').max(191).optional().or(z.literal('')),
  age: z.string().trim().regex(/^\d{0,3}$/, 'Age must be a number.').max(3).optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  /** A configured department id, or `spec:<name>` for clinics that only have doctor specialisations. */
  departmentId: z.union([z.string().uuid(), z.string().regex(/^spec:.{1,120}$/)]).optional(),
  doctorId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  /** Chief complaint / notes. */
  notes: z.string().trim().max(500).optional(),
  /** Explicit, opt-in WhatsApp consent (never assumed for the booking link). */
  whatsappConsent: z.boolean().default(false),
  countryCode: z.string().regex(/^\d{1,4}$/).default('91'),
});
export type PublicBookingBody = z.infer<typeof publicBookingBodySchema>;

type Target =
  | { kind: 'clinic'; id: string; tenantId: string; userId: string; name: string }
  | { kind: 'business'; id: string; tenantId: string; userId: string; name: string; businessType: string };

/** Accepts the readable slug (/book/sunrise-clinic) or a legacy UUID link. */
export async function resolveTarget(ref: string): Promise<Target> {
  let id = ref;
  if (!isUuid(ref)) {
    const hit = await resolveBookingRef(ref);
    if (!hit) throw new NotFoundError('Booking page');
    id = hit.id;
  }
  const clinic = await systemDb.clinic.findUnique({ where: { id }, select: { id: true, tenantId: true, userId: true, clinicName: true } });
  if (clinic) return { kind: 'clinic', id: clinic.id, tenantId: clinic.tenantId, userId: clinic.userId, name: clinic.clinicName };
  const biz = await systemDb.businessProfile.findUnique({
    where: { id },
    select: { id: true, tenantId: true, userId: true, businessName: true, businessType: true },
  });
  if (biz) return { kind: 'business', id: biz.id, tenantId: biz.tenantId, userId: biz.userId, name: biz.businessName || 'Our business', businessType: biz.businessType };
  throw new NotFoundError('Booking page');
}

/** The booking link id for the signed-in tenant user. */
export async function bookingIdForUser(userId: string): Promise<{ id: string; slug: string; kind: 'clinic' | 'business'; name: string } | null> {
  const clinic = await systemDb.clinic.findUnique({ where: { userId }, select: { id: true, clinicName: true } });
  if (clinic) return { id: clinic.id, slug: await bookingSlugFor(clinic.id), kind: 'clinic', name: clinic.clinicName };
  const biz = await systemDb.businessProfile.findUnique({ where: { userId }, select: { id: true, businessName: true } });
  if (biz) return { id: biz.id, slug: await bookingSlugFor(biz.id), kind: 'business', name: biz.businessName || 'Business' };
  return null;
}

function businessTimings(value: unknown): DayTiming[] {
  const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  return rows.map((h) => ({
    dayName: String(h.day_name ?? h.dayName ?? ''),
    isClosed: Boolean(h.is_closed ?? h.isClosed),
    openingTime: (h.opening_time ?? h.openingTime ?? null) as string | null,
    closingTime: (h.closing_time ?? h.closingTime ?? null) as string | null,
    lunchBreakStart: (h.break_start ?? h.lunch_break_start ?? null) as string | null,
    lunchBreakEnd: (h.break_end ?? h.lunch_break_end ?? null) as string | null,
  }));
}

// ── profile ─────────────────────────────────────────────────────────

export async function publicProfile(ref: string) {
  const target = await resolveTarget(ref);
  const id = target.id;
  if (target.kind === 'clinic') {
    const clinic = await systemDb.clinic.findUnique({
      where: { id },
      include: {
        timings: true,
        doctors: { orderBy: { doctorName: 'asc' }, include: { departments: { select: { departmentId: true } } } },
        services: { where: { isActive: true }, orderBy: { serviceName: 'asc' } },
        departments: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
      },
    });
    if (!clinic) throw new NotFoundError('Booking page');
    const deptById = new Map(clinic.departments.map((d) => [d.id, d.name]));
    const doctors = clinic.doctors.map((d) => ({
      id: d.id,
      name: d.doctorName,
      departmentIds: d.departments.map((x) => x.departmentId).filter((id) => deptById.has(id)),
      department: d.departments.map((x) => deptById.get(x.departmentId)).filter(Boolean)[0] || d.specialization?.trim() || 'General',
      specialization: d.specialization,
      qualification: d.qualification,
      experience: d.experience,
      fee: Number(d.consultationFee ?? 0),
      languages: d.languagesSpoken,
      photo: d.profilePhoto,
      days: Array.isArray(d.availableDays) ? (d.availableDays as string[]) : [],
    }));
    return {
      kind: 'clinic' as const,
      id: clinic.id,
      name: clinic.clinicName,
      type: clinic.clinicType,
      description: clinic.clinicDescription,
      address: [clinic.address, clinic.city, clinic.state, clinic.pincode].filter(Boolean).join(', '),
      phone: clinic.phone,
      whatsapp: clinic.whatsappNumber,
      mapLink: clinic.googleMapLink,
      timings: clinic.timings.map((t) => ({ day: t.dayName, closed: t.isClosed, open: t.openingTime, close: t.closingTime })),
      // Configured departments (Step 2 of setup); older clinics without them
      // fall back to doctor specialisations.
      departmentList: clinic.departments.length
        ? clinic.departments.map((d) => ({ id: d.id, name: d.name, description: d.description, doctorCount: doctors.filter((doc) => doc.departmentIds.includes(d.id)).length }))
        : [...new Set(doctors.map((d) => d.department))].sort().map((name) => ({ id: `spec:${name}`, name, description: null, doctorCount: doctors.filter((doc) => doc.department === name).length })),
      departments: [...new Set(doctors.map((d) => d.department))].sort(),
      doctors,
      timeZone: CLINIC_TIME_ZONE,
      services: clinic.services.map((s) => ({ id: s.id, name: s.serviceName, price: Number(s.startingPrice ?? 0), duration: s.duration })),
    };
  }
  const biz = await systemDb.businessProfile.findUnique({
    where: { id },
    include: {
      services: { where: { isActive: true }, orderBy: { name: 'asc' } },
      staff: { where: { isActive: true }, orderBy: { name: 'asc' } },
    },
  });
  if (!biz) throw new NotFoundError('Booking page');
  return {
    kind: 'business' as const,
    id: biz.id,
    name: biz.businessName || 'Book an appointment',
    type: biz.businessType,
    description: biz.description,
    address: [biz.address, biz.city, biz.state, biz.pincode].filter(Boolean).join(', '),
    phone: biz.phone,
    whatsapp: biz.whatsappNumber,
    mapLink: biz.googleMapLink,
    timings: businessTimings(biz.workingHours).map((t) => ({ day: t.dayName, closed: t.isClosed, open: t.openingTime, close: t.closingTime })),
    departments: [...new Set(biz.services.map((s) => s.category?.trim()).filter(Boolean) as string[])].sort(),
    departmentList: [] as Array<{ id: string; name: string; description: string | null; doctorCount: number }>,
    timeZone: CLINIC_TIME_ZONE,
    doctors: biz.staff.map((s) => ({ id: s.id, name: s.name, departmentIds: [] as string[], department: s.role || s.specialization || 'Team', specialization: s.specialization, qualification: s.qualification, experience: null, fee: 0, languages: null, photo: null, days: [] as string[] })),
    services: biz.services.map((s) => ({ id: s.id, name: s.name, price: Number(s.price ?? 0), duration: s.durationMinutes ?? 30, category: s.category })),
  };
}

// ── slots ───────────────────────────────────────────────────────────

export async function publicSlots(ref: string, input: { doctorId?: string; serviceId?: string; from?: string; days: number }) {
  const target = await resolveTarget(ref);
  const id = target.id;
  const today = todayIn(CLINIC_TIME_ZONE);
  const from = input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from) && input.from >= today ? input.from : today;

  if (target.kind === 'clinic') {
    if (!input.doctorId) throw new ValidationError('Choose a doctor first.');
    const service = AppointmentService.create(tenantDb(target.tenantId));
    const res = await service.availability(availabilityQuerySchema.parse({ doctorId: input.doctorId, from, days: input.days }));
    return { days: res.days };
  }

  const biz = await systemDb.businessProfile.findUnique({ where: { id }, select: { workingHours: true, dateExceptions: true } });
  const svc = input.serviceId ? await systemDb.businessService.findFirst({ where: { id: input.serviceId, businessId: id }, select: { durationMinutes: true } }) : null;
  const slotMinutes = Math.max(10, Math.min(240, svc?.durationMinutes ?? 30));
  const end = addDays(from, input.days - 1);
  const taken = await systemDb.businessEnquiry.findMany({
    where: {
      businessId: id,
      status: { not: 'cancelled' },
      preferredDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) },
    },
    select: { preferredDate: true, preferredTime: true },
  });
  const timings = businessTimings(biz?.workingHours);
  const closures = exceptionsToRecord(biz?.dateExceptions);
  const days = Array.from({ length: input.days }, (_, i) => {
    const date = addDays(from, i);
    return computeDaySlots({
      date,
      timings,
      clinicDateExceptions: closures,
      doctor: { availableDays: [], availableStartTime: null, availableEndTime: null, dateExceptions: {} },
      slotMinutes,
      bookedTimes: taken.filter((t) => t.preferredDate?.toISOString().slice(0, 10) === date && t.preferredTime).map((t) => t.preferredTime!),
      now: new Date(),
      timeZone: CLINIC_TIME_ZONE,
    });
  });
  return { days };
}

// ── booking ─────────────────────────────────────────────────────────

async function upsertContact(target: Target, phone: string, name: string): Promise<string> {
  const existing = await systemDb.contact.findFirst({ where: { tenantId: target.tenantId, phone }, select: { id: true, name: true } });
  if (existing) {
    if (!existing.name) await systemDb.contact.update({ where: { id: existing.id }, data: { name } });
    return existing.id;
  }
  const created = await systemDb.contact.create({ data: { tenantId: target.tenantId, userId: target.userId, phone, name }, select: { id: true } });
  return created.id;
}

async function tagContact(tenantId: string, userId: string, contactId: string, tagName: string) {
  const tag =
    (await systemDb.tag.findFirst({ where: { tenantId, name: tagName }, select: { id: true } })) ??
    (await systemDb.tag.create({ data: { tenantId, userId, name: tagName, color: '#16a34a' }, select: { id: true } }));
  await systemDb.contactTag.upsert({ where: { contactId_tagId: { contactId, tagId: tag.id } }, create: { contactId, tagId: tag.id }, update: {} });
}

export interface BookingResult {
  ref: string;
  token: number;
  date: string;
  time: string;
  title: string;
  whatsappSent: boolean;
  businessWhatsapp: string | null;
}

export function normalizeBookingPhone(raw: string | undefined, countryCode: string): string | null {
  let phone = sanitizePhoneForMeta(raw ?? '');
  if (!phone) return null;
  if (phone.length <= 10) phone = `${countryCode}${phone.replace(/^0+/, '')}`;
  return isValidE164(phone) ? phone : null;
}

/** Human-friendly unique appointment ID, e.g. APT-261120-7K3QF. */
export async function newAppointmentRef(date: string): Promise<string> {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 6; attempt++) {
    let rand = '';
    for (let i = 0; i < 5; i++) rand += alphabet[Math.floor(Math.random() * alphabet.length)];
    const ref = `APT-${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-${rand}`;
    const clash = await systemDb.appointmentDetail.findUnique({ where: { appointmentRef: ref }, select: { appointmentId: true } });
    if (!clash) return ref;
  }
  throw new Error('Could not allocate an appointment ID.');
}

export async function publicBook(linkRef: string, body: PublicBookingBody, source = 'booking_link'): Promise<BookingResult> {
  const target = await resolveTarget(linkRef);
  const id = target.id;
  const phone = normalizeBookingPhone(body.phone, body.countryCode);
  if (body.phone && !phone) throw new ValidationError('Please enter a valid WhatsApp number (10 digits, or with country code).');
  if (target.kind === 'business' && !phone) throw new ValidationError('Please enter your WhatsApp number.');
  if (body.whatsappConsent && !phone) throw new ValidationError('Add your WhatsApp number to receive updates on WhatsApp, or untick the WhatsApp consent.');

  // Contact: matched by phone, else by email, else a new record (patients
  // may book without a phone number).
  let contactId: string;
  if (phone) {
    contactId = await upsertContact(target, phone, body.name);
  } else {
    const byEmail = body.email
      ? await systemDb.contact.findFirst({ where: { tenantId: target.tenantId, email: body.email }, select: { id: true } })
      : null;
    contactId = byEmail?.id ?? (await systemDb.contact.create({
      data: { tenantId: target.tenantId, userId: target.userId, phone: '', name: body.name, email: body.email || null },
      select: { id: true },
    })).id;
  }
  if (body.email) await systemDb.contact.updateMany({ where: { id: contactId, email: null }, data: { email: body.email } });
  await tagContact(target.tenantId, target.userId, contactId, source === 'booking_link' ? 'Booked Online' : 'Booked via WhatsApp');

  if (target.kind === 'clinic') {
    if (!body.doctorId) throw new ValidationError('Please choose a doctor.');
    const doctor = await systemDb.doctor.findFirst({
      where: { id: body.doctorId, clinicId: target.id },
      select: { id: true, departments: { select: { departmentId: true } } },
    });
    if (!doctor) throw new ValidationError('That doctor is not available for booking.');
    const departmentId = body.departmentId && !body.departmentId.startsWith('spec:') ? body.departmentId : undefined;
    if (departmentId && doctor.departments.length && !doctor.departments.some((d) => d.departmentId === departmentId)) {
      throw new ValidationError('The selected doctor is not part of that department.');
    }
    const service = AppointmentService.create(tenantDb(target.tenantId));
    const appt = await service.book(
      bookAppointmentBodySchema.parse({
        contactId,
        doctorId: body.doctorId,
        appointmentDate: body.date,
        appointmentTime: body.time,
        patientName: body.name,
        patientAge: body.age || null,
        reasonForVisit: body.notes || null,
      }),
    );
    const appointmentRef = await newAppointmentRef(body.date);
    await systemDb.appointmentDetail.create({
      data: {
        appointmentId: appt.id,
        appointmentRef,
        departmentId: departmentId ?? null,
        patientEmail: body.email || null,
        patientGender: body.gender ?? null,
        patientPhone: phone,
        whatsappConsent: Boolean(body.whatsappConsent && phone),
        consentAt: body.whatsappConsent && phone ? new Date() : null,
        source,
      },
    });
    return afterClinicBooking(target, appt.id, contactId, phone ?? '', source, Boolean(body.whatsappConsent && phone));
  }

  // Business booking → enquiry with a token in the notes.
  const taken = await systemDb.businessEnquiry.count({
    where: { businessId: id, status: { not: 'cancelled' }, preferredDate: new Date(`${body.date}T00:00:00Z`), preferredTime: body.time },
  });
  if (taken > 0) throw new ConflictError('That time was just booked. Please choose another slot.');
  const svc = body.serviceId ? await systemDb.businessService.findFirst({ where: { id: body.serviceId, businessId: id }, select: { name: true } }) : null;
  const sameDay = await systemDb.businessEnquiry.count({
    where: { businessId: id, status: { not: 'cancelled' }, preferredDate: new Date(`${body.date}T00:00:00Z`) },
  });
  const token = sameDay + 1;
  const enquiry = await systemDb.businessEnquiry.create({
    data: {
      businessId: id,
      contactId,
      contactName: body.name,
      contactPhone: phone!,
      enquiryType: svc?.name ?? 'Appointment',
      preferredDate: new Date(`${body.date}T00:00:00Z`),
      preferredTime: body.time,
      notes: [`Token #${token}`, body.notes].filter(Boolean).join(' · '),
      status: 'confirmed',
      source,
    },
  });
  const biz = await systemDb.businessProfile.findUnique({ where: { id }, select: { businessName: true, address: true, city: true, whatsappNumber: true } });
  const ref = bookingRef(enquiry.id);
  const text = [
    `✅ *Booking confirmed*`,
    ``,
    `🏢 ${biz?.businessName ?? target.name}`,
    `👤 ${body.name}`,
    `🛎️ ${svc?.name ?? 'Appointment'}`,
    `📅 ${pretty(body.date)} · ⏰ ${prettyTime(body.time)}`,
    `🎟️ Token No: *${token}*`,
    biz?.address ? `📍 ${[biz.address, biz.city].filter(Boolean).join(', ')}` : null,
    ``,
    `Ref: ${ref}. Reply here if you need to change anything.`,
  ].filter((l) => l !== null).join('\n');
  // WhatsApp only with explicit consent (the booking form's unticked-by-default checkbox).
  const whatsappSent = body.whatsappConsent ? await sendTenantText(target.tenantId, phone!, text, contactId) : false;
  notifyTenant(target.tenantId, { type: 'booking', title: `New booking · Token ${token}`, body: `${body.name} — ${svc?.name ?? 'Appointment'}, ${pretty(body.date)} ${prettyTime(body.time)}`, href: `/${target.businessType}/appointments` });
  void pushToGoogleSheet(target.tenantId, {
    type: 'booking', ref, token, name: body.name, phone, service: svc?.name ?? '', date: body.date, time: body.time, notes: body.notes ?? '', source,
  });
  return { ref, token, date: body.date, time: body.time, title: svc?.name ?? 'Appointment', whatsappSent, businessWhatsapp: biz?.whatsappNumber ?? null };
}

export async function afterClinicBooking(
  target: { tenantId: string; id: string },
  appointmentId: string,
  contactId: string,
  phone: string,
  source: string,
  /** Send WhatsApp only with explicit consent and a valid number. */
  notify = true,
): Promise<BookingResult> {
  const token = await assignToken(appointmentId);
  const appt = await systemDb.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: true, clinic: true, detail: { select: { appointmentRef: true } } },
  });
  if (!appt) throw new NotFoundError('Appointment');
  const ref = appt.detail?.appointmentRef ?? bookingRef(appt.id);
  try {
    triggerRealtimeEvent(target.tenantId, 'appointments:changed', { id: appointmentId, kind: 'created', at: new Date().toISOString() });
  } catch {
    /* best-effort */
  }
  const date = appt.appointmentDate.toISOString().slice(0, 10);
  const text = appointmentConfirmationText({
    clinicName: appt.clinic.clinicName,
    patientName: appt.patientName,
    doctorName: appt.doctor?.doctorName ?? null,
    department: appt.doctor?.specialization ?? null,
    date,
    time: appt.appointmentTime,
    token,
    address: [appt.clinic.address, appt.clinic.city].filter(Boolean).join(', ') || null,
    bookingRef: ref,
  });
  // Inside the 24h window → text; otherwise the tenant's approved utility template.
  const delivery = notify && phone
    ? await deliverAppointmentMessage({
        tenantId: target.tenantId,
        appointmentId,
        contactId,
        phone,
        consent: notify,
        event: 'confirmation',
        eventKey: `confirmation@${date} ${appt.appointmentTime}`,
        text,
        values: appointmentValues({
          patientName: appt.patientName,
          businessName: appt.clinic.clinicName,
          date,
          time: appt.appointmentTime,
          doctorName: appt.doctor?.doctorName,
          department: appt.doctor?.specialization,
          ref,
          token,
        }),
      })
    : null;
  const whatsappSent = delivery?.status === 'sent';
  const sent = (appt.remindersSent as Record<string, unknown> | null) ?? {};
  await systemDb.appointment.update({
    where: { id: appointmentId },
    // Without consent nothing is sent now or later (the lifecycle engine
    // checks the same flag).
    data: { remindersSent: { ...sent, token, confirmation: whatsappSent ? new Date().toISOString() : notify ? (delivery?.status === 'blocked_no_template' ? 'blocked_no_template' : null) : 'no_consent', source } },
  });
  notifyTenant(target.tenantId, {
    type: 'booking',
    title: `New appointment · Token ${token}`,
    body: `${appt.patientName ?? 'Patient'} with Dr. ${appt.doctor?.doctorName ?? ''} — ${pretty(date)} ${prettyTime(appt.appointmentTime)}`,
    href: '/healthcare/appointments',
  });
  void pushToGoogleSheet(target.tenantId, {
    type: 'appointment', ref, token, name: appt.patientName ?? '', age: appt.patientAge ?? '', phone,
    doctor: appt.doctor?.doctorName ?? '', department: appt.doctor?.specialization ?? '', date, time: appt.appointmentTime,
    reason: appt.reasonForVisit ?? '', source,
  }).then(async (ok) => {
    if (ok) await systemDb.appointment.update({ where: { id: appointmentId }, data: { sheetsSynced: true } });
  });
  return {
    ref, token, date, time: appt.appointmentTime,
    title: `${appt.doctor?.doctorName ? `Dr. ${appt.doctor.doctorName.replace(/^dr\.?\s*/i, '')}` : 'Consultation'}`,
    whatsappSent,
    businessWhatsapp: appt.clinic.whatsappNumber,
  };
}
