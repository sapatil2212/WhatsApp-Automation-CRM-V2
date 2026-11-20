/**
 * Built-in WhatsApp **utility** templates for appointment notifications.
 *
 * One lifecycle skeleton (confirmation, reminder, cancelled, rescheduled,
 * completed) with vertical-specific wording, so a gym says "session", a
 * hotel says "reservation" and a clinic names the doctor — without keeping
 * five near-identical copies per vertical.
 *
 * Content rules followed (Meta utility category): strictly transactional,
 * tied to an appointment the customer booked, no offers, upsell or
 * promotional CTAs; variables never start or end the body and are never
 * adjacent; each variable has a sample value for review.
 *
 * Bump LIBRARY_VERSION when wording changes. Already-provisioned tenant
 * copies are never overwritten (their approval stays valid); the UI offers
 * the newer wording as an edit, which starts a new approval.
 */

export const LIBRARY_VERSION = 1;

export const TEMPLATE_EVENTS = ['confirmation', 'token_confirmation', 'reminder', 'cancelled', 'rescheduled', 'completed', 'prescription'] as const;
export type TemplateEvent = (typeof TEMPLATE_EVENTS)[number];

export const VERTICALS = ['clinic', 'dental', 'hospital', 'gym', 'salon', 'hotel', 'other'] as const;
export type Vertical = (typeof VERTICALS)[number];

/** Where each `{{n}}` gets its value when a message is sent. */
export const VARIABLE_SOURCES = ['customer_name', 'business_name', 'appointment_date', 'appointment_time', 'service_name', 'appointment_ref', 'token_number', 'doctor_name'] as const;
export type VariableSource = (typeof VARIABLE_SOURCES)[number];

export interface TemplateVariable {
  position: number;
  name: string;
  source: VariableSource;
  fallback: string;
  example: string;
}

export interface LibraryTemplate {
  key: string; // Meta template name (lowercase, underscores)
  event: TemplateEvent;
  vertical: Vertical;
  title: string;
  description: string;
  category: 'Utility';
  language: string;
  bodyText: string;
  footerText: string | null;
  /** 'document' = PDF attached as the template header (prescriptions). */
  headerType?: 'none' | 'document';
  variables: TemplateVariable[];
  version: number;
}

export const TEMPLATE_KEYS: Record<TemplateEvent, string> = {
  confirmation: 'appointment_confirmation',
  token_confirmation: 'appointment_token_confirmation',
  prescription: 'patient_prescription_delivery',
  reminder: 'appointment_reminder',
  cancelled: 'appointment_cancelled',
  rescheduled: 'appointment_rescheduled',
  completed: 'appointment_completed',
};

export const EVENT_LABEL: Record<TemplateEvent, string> = {
  confirmation: 'Appointment created',
  token_confirmation: 'Booked & confirmed (with token no.)',
  prescription: 'Prescription delivery (PDF)',
  reminder: 'Appointment reminder',
  cancelled: 'Appointment cancelled',
  rescheduled: 'Appointment rescheduled',
  completed: 'Appointment completed',
};

interface Terms {
  label: string;
  visit: string; // "appointment" | "session" | "reservation"
  serviceLabel: string; // line label for {{5}}
  serviceExample: string;
  businessExample: string;
}

const TERMS: Record<Vertical, Terms> = {
  clinic: { label: 'Clinic / Healthcare', visit: 'appointment', serviceLabel: 'Consultation', serviceExample: 'Dr. Mehta (General Physician)', businessExample: 'Sunrise Clinic' },
  dental: { label: 'Dental clinic', visit: 'appointment', serviceLabel: 'Treatment', serviceExample: 'Dental check-up with Dr. Rao', businessExample: 'BrightSmile Dental' },
  hospital: { label: 'Hospital', visit: 'appointment', serviceLabel: 'Department', serviceExample: 'Cardiology OPD with Dr. Shah', businessExample: 'City Care Hospital' },
  gym: { label: 'Gym / Fitness centre', visit: 'session', serviceLabel: 'Session', serviceExample: 'Personal Training Session', businessExample: 'Get Fit Gym' },
  salon: { label: 'Salon / Beauty', visit: 'appointment', serviceLabel: 'Service', serviceExample: 'Haircut and Styling', businessExample: 'Glow Salon' },
  hotel: { label: 'Hotel / Hospitality', visit: 'reservation', serviceLabel: 'Booking', serviceExample: 'Deluxe Room, 2 nights', businessExample: 'Lakeview Hotel' },
  other: { label: 'Other appointment-based business', visit: 'appointment', serviceLabel: 'Service', serviceExample: 'Consultation', businessExample: 'Acme Studio' },
};

export const VERTICAL_LABEL: Record<Vertical, string> = Object.fromEntries(VERTICALS.map((v) => [v, TERMS[v].label])) as Record<Vertical, string>;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function vars(t: Terms, which: VariableSource[]): TemplateVariable[] {
  const meta: Record<VariableSource, { name: string; fallback: string; example: string }> = {
    customer_name: { name: 'Customer name', fallback: 'there', example: 'Priya' },
    business_name: { name: 'Business name', fallback: 'our team', example: t.businessExample },
    appointment_date: { name: 'Date', fallback: 'the scheduled date', example: '25 Nov 2026' },
    appointment_time: { name: 'Time', fallback: 'the scheduled time', example: '10:30 AM' },
    service_name: { name: t.serviceLabel, fallback: t.visit, example: t.serviceExample },
    appointment_ref: { name: 'Booking ID', fallback: '-', example: 'APT-261125-K7Q2M' },
    token_number: { name: 'Token number', fallback: '-', example: '12' },
    doctor_name: { name: 'Doctor name', fallback: 'your doctor', example: 'Dr. Mehta' },
  };
  return which.map((source, i) => ({ position: i + 1, source, ...meta[source] }));
}

function build(vertical: Vertical, event: TemplateEvent): LibraryTemplate {
  const t = TERMS[vertical];
  const V = cap(t.visit);
  const full: VariableSource[] = ['customer_name', 'business_name', 'appointment_date', 'appointment_time', 'service_name'];
  const base = { key: TEMPLATE_KEYS[event], event, vertical, category: 'Utility' as const, language: 'en_US', footerText: null, version: LIBRARY_VERSION };
  switch (event) {
    case 'confirmation':
      return {
        ...base,
        title: `${V} confirmation`,
        description: `Sent when a ${t.visit} is booked.`,
        bodyText: `Hello {{1}},\n\nYour ${t.visit} at {{2}} has been confirmed.\n\n${V} details:\nDate: {{3}}\nTime: {{4}}\n${t.serviceLabel}: {{5}}\n\nWe look forward to seeing you. Reply to this message if you need to make any changes.`,
        variables: vars(t, full),
      };
    case 'reminder':
      return {
        ...base,
        title: `${V} reminder`,
        description: `Sent before the ${t.visit} at the reminder times you choose.`,
        bodyText: `Hello {{1}},\n\nThis is a reminder of your upcoming ${t.visit} at {{2}}.\n\nDate: {{3}}\nTime: {{4}}\n${t.serviceLabel}: {{5}}\n\nPlease reply to this message if you need any assistance.`,
        variables: vars(t, full),
      };
    case 'cancelled':
      return {
        ...base,
        title: `${V} cancelled`,
        description: `Sent when a ${t.visit} is cancelled.`,
        bodyText: `Hello {{1}},\n\nYour ${t.visit} at {{2}} scheduled for {{3}} at {{4}} has been cancelled.\n\nFor further assistance, please reply to this message.`,
        variables: vars(t, ['customer_name', 'business_name', 'appointment_date', 'appointment_time']),
      };
    case 'rescheduled':
      return {
        ...base,
        title: `${V} rescheduled`,
        description: `Sent when a ${t.visit} moves to a new date or time.`,
        bodyText: `Hello {{1}},\n\nYour ${t.visit} at {{2}} has been rescheduled.\n\nNew ${t.visit} details:\nDate: {{3}}\nTime: {{4}}\n${t.serviceLabel}: {{5}}\n\nWe look forward to seeing you.`,
        variables: vars(t, full),
      };
    case 'completed':
      return {
        ...base,
        title: `${V} completed`,
        description: `Sent after the ${t.visit} is marked completed.`,
        bodyText: `Hello {{1}},\n\nYour ${t.visit} at {{2}} on {{3}} has been marked as completed.\n\nThank you for choosing us.`,
        variables: vars(t, ['customer_name', 'business_name', 'appointment_date']),
      };
    case 'token_confirmation':
      return {
        ...base,
        title: 'Booking confirmed with token',
        description: 'Healthcare: sent when an appointment is booked, with the token number and booking ID for the reception desk.',
        bodyText: `Hello {{1}},

Your appointment at {{2}} has been booked and confirmed.

Token number: {{3}}
Booking ID: {{4}}
Date: {{5}}
Time: {{6}}
${t.serviceLabel}: {{7}}

Please show your token number at the reception when you arrive. Reply to this message if you need to make any changes.`,
        variables: vars(t, ['customer_name', 'business_name', 'token_number', 'appointment_ref', 'appointment_date', 'appointment_time', 'service_name']),
      };
    case 'prescription':
      return {
        ...base,
        headerType: 'document',
        title: 'Prescription delivery',
        description: 'Healthcare: the finalized prescription PDF, attached as the message header, after the consultation is completed.',
        bodyText: `Hello {{1}},\n\nYour consultation with {{2}} has been completed.\n\nPlease find your prescription attached to this message.\n\nThank you for choosing {{3}}. Reply to this message if you have any questions.`,
        variables: vars(t, ['customer_name', 'doctor_name', 'business_name']),
      };
  }
}

/** Healthcare verticals issue token numbers at the front desk. */
export const TOKEN_VERTICALS: readonly Vertical[] = ['clinic', 'dental', 'hospital'];

/** The predefined collection for a vertical (one template per lifecycle event). */
export function libraryFor(vertical: Vertical): LibraryTemplate[] {
  const healthcareOnly: TemplateEvent[] = ['token_confirmation', 'prescription'];
  return TEMPLATE_EVENTS.filter((e) => !healthcareOnly.includes(e) || TOKEN_VERTICALS.includes(vertical)).map((e) => build(vertical, e));
}

/** Maps free-text business / clinic types to a vertical. */
export function detectVertical(input: { hasClinic: boolean; clinicType?: string | null; businessType?: string | null; name?: string | null }): Vertical {
  const byType = classify(`${input.clinicType ?? ''} ${input.businessType ?? ''}`.toLowerCase(), input.hasClinic);
  // A vague type ("wellness", "services") falls back to the business name ("Get Fit Gym").
  return byType === 'other' && input.name ? classify(input.name.toLowerCase(), false) : byType;
}

function classify(text: string, hasClinic: boolean): Vertical {
  if (/dent/.test(text)) return 'dental';
  if (/hospital|multi.?speciality|multispecialty/.test(text)) return 'hospital';
  if (hasClinic || /clinic|health|doctor|medical|physio|diagnos|pathology|ayurved|homeo/.test(text)) return 'clinic';
  if (/gym|fitness|yoga|crossfit|pilates|zumba|martial|sport/.test(text)) return 'gym';
  if (/salon|beauty|spa|parlou?r|barber|grooming|nail|makeup|skin/.test(text)) return 'salon';
  if (/hotel|resort|hostel|homestay|lodge|stay|hospitality|guest ?house/.test(text)) return 'hotel';
  return 'other';
}

/** Meta template name for a version ("appointment_reminder", then "appointment_reminder_v2"...). */
export function versionedName(key: string, version: number): string {
  return version > 1 ? `${key}_v${version}` : key;
}

/** Builds the `{{n}}` values in order, using fallbacks for blanks. */
export function mapVariables(variables: TemplateVariable[], values: Partial<Record<VariableSource, string | null | undefined>>): string[] {
  return [...variables]
    .sort((a, b) => a.position - b.position)
    .map((v) => {
      const raw = values[v.source];
      const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
      // Meta rejects empty parameters and newlines/tabs inside them.
      return (text || v.fallback || '-').slice(0, 1000);
    });
}

/** Number of `{{n}}` placeholders in a body. */
export function placeholderCount(body: string): number {
  const nums = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

/** Content checks that mirror Meta's utility review rules (subset Meta documents). */
export function lintUtilityBody(body: string, variables: TemplateVariable[]): string[] {
  const issues: string[] = [];
  const trimmed = body.trim();
  if (!trimmed) issues.push('Message body is required.');
  if (trimmed.length > 1024) issues.push('Message body must be at most 1024 characters.');
  if (/^\{\{\d+\}\}/.test(trimmed)) issues.push('The message cannot start with a variable.');
  if (/\{\{\d+\}\}[.!?]?$/.test(trimmed)) issues.push('The message cannot end with a variable.');
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(trimmed)) issues.push('Two variables cannot be next to each other.');
  const count = placeholderCount(trimmed);
  const nums = new Set([...trimmed.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
  for (let i = 1; i <= count; i++) if (!nums.has(i)) issues.push(`Variable {{${i}}} is missing — variables must be numbered 1, 2, 3… without gaps.`);
  if (count !== variables.length) issues.push(`The message uses ${count} variable(s) but ${variables.length} are mapped.`);
  if (/\b(offer|discount|% off|sale|deal|coupon|promo|free trial|limited time|buy now|upgrade)\b/i.test(trimmed)) {
    issues.push('Utility templates cannot contain offers or promotional wording — Meta will re-categorise them as Marketing.');
  }
  return issues;
}
