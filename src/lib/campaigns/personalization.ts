/**
 * Campaign personalization — shared by the wizard (preview), the AI planner
 * and the server sender. Pure functions only.
 *
 * A template can need parameters in four places. Each is a "slot":
 *   body_<n>      body {{n}}
 *   header_1      text header {{1}}
 *   header_media  image / video / document header (a public https URL)
 *   button_<i>    dynamic suffix of the URL button at index i
 *
 * Each slot is filled by a mapping: a fixed value, a contact field, or a
 * custom field — with a fallback for contacts missing that data (Meta
 * rejects an empty parameter, so a fallback is mandatory for dynamic data).
 */

export type MappingSource = 'static' | 'name' | 'first_name' | 'phone' | 'email' | 'company' | 'custom_field';

export interface SlotMapping {
  source: MappingSource;
  /** Fixed value (static) or custom field id (custom_field). */
  value?: string;
  /** Used when the contact has no value for a dynamic source. */
  fallback?: string;
}

export type Personalization = Record<string, SlotMapping>;

export interface CampaignTemplateShape {
  bodyText: string;
  headerType?: string | null;
  headerContent?: string | null;
  buttons?: Array<{ type?: string; url?: string | null; text?: string }> | null;
}

export interface SlotInfo {
  key: string;
  label: string;
  kind: 'body' | 'header' | 'header_media' | 'button';
  /** Text around the placeholder, to help humans and the AI choose a value. */
  context: string;
}

export const SOURCE_LABELS: Record<MappingSource, string> = {
  static: 'Same text for everyone',
  name: 'Contact full name',
  first_name: 'Contact first name',
  phone: 'Contact phone',
  email: 'Contact email',
  company: 'Contact company',
  custom_field: 'Custom field',
};

const PH = /\{\{\s*(\d+)\s*\}\}/g;

function contextAround(text: string, index: number, token: string): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + token.length + 40);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`;
}

/** Every parameter slot this template needs at send time, in Meta order. */
export function templateSlots(t: CampaignTemplateShape): SlotInfo[] {
  const slots: SlotInfo[] = [];
  const headerType = (t.headerType ?? '').toLowerCase();

  if (headerType === 'text' && t.headerContent && /\{\{\s*1\s*\}\}/.test(t.headerContent)) {
    slots.push({ key: 'header_1', label: 'Header {{1}}', kind: 'header', context: t.headerContent });
  } else if (['image', 'video', 'document'].includes(headerType)) {
    slots.push({ key: 'header_media', label: `Header ${headerType}`, kind: 'header_media', context: `A ${headerType} shown above the message` });
  }

  const seen = new Set<number>();
  for (const m of t.bodyText.matchAll(PH)) {
    const n = Number(m[1]);
    if (seen.has(n)) continue;
    seen.add(n);
    slots.push({ key: `body_${n}`, label: `{{${n}}}`, kind: 'body', context: contextAround(t.bodyText, m.index ?? 0, m[0]) });
  }
  slots.sort((a, b) => {
    if (a.kind !== 'body' || b.kind !== 'body') return 0;
    return Number(a.key.slice(5)) - Number(b.key.slice(5));
  });

  (t.buttons ?? []).forEach((b, i) => {
    if (String(b.type).toUpperCase() === 'URL' && b.url && /\{\{\s*1\s*\}\}/.test(b.url)) {
      slots.push({ key: `button_${i}`, label: `“${b.text ?? 'Link'}” link suffix`, kind: 'button', context: b.url });
    }
  });
  return slots;
}

export interface ContactData {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  /** customFieldId → value */
  custom?: Record<string, string | null | undefined>;
}

export function resolveMapping(mapping: SlotMapping | undefined, contact: ContactData): string {
  if (!mapping) return '';
  const fallback = (mapping.fallback ?? '').trim();
  let value = '';
  switch (mapping.source) {
    case 'static':
      value = mapping.value ?? '';
      break;
    case 'name':
      value = contact.name ?? '';
      break;
    case 'first_name':
      value = (contact.name ?? '').trim().split(/\s+/)[0] ?? '';
      break;
    case 'phone':
      value = contact.phone ?? '';
      break;
    case 'email':
      value = contact.email ?? '';
      break;
    case 'company':
      value = contact.company ?? '';
      break;
    case 'custom_field':
      value = (mapping.value && contact.custom?.[mapping.value]) || '';
      break;
  }
  // Meta rejects parameters with newlines/tabs or >4 consecutive spaces.
  value = value.replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
  return value || fallback;
}

export interface MappingIssue {
  key: string;
  message: string;
}

/** Problems that would make Meta reject the send for some or all contacts. */
export function validatePersonalization(slots: SlotInfo[], p: Personalization): MappingIssue[] {
  const issues: MappingIssue[] = [];
  for (const slot of slots) {
    const m = p[slot.key];
    if (!m) {
      issues.push({ key: slot.key, message: `${slot.label} has no value.` });
      continue;
    }
    if (slot.kind === 'header_media') {
      if (!/^https:\/\/\S+$/i.test(m.value ?? '')) issues.push({ key: slot.key, message: 'Provide a public https:// link to the header media.' });
      continue;
    }
    if (m.source === 'static') {
      if (!(m.value ?? '').trim()) issues.push({ key: slot.key, message: `${slot.label} needs a value.` });
    } else {
      if (m.source === 'custom_field' && !m.value) issues.push({ key: slot.key, message: `${slot.label}: choose a custom field.` });
      if (!(m.fallback ?? '').trim()) {
        issues.push({ key: slot.key, message: `${slot.label}: add a fallback for contacts without this data.` });
      }
    }
  }
  return issues;
}

/** Meta `components` for one recipient. */
export function buildSendComponents(
  t: CampaignTemplateShape,
  p: Personalization,
  contact: ContactData,
): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [];
  const slots = templateSlots(t);
  const header = slots.find((s) => s.kind === 'header' || s.kind === 'header_media');
  if (header?.kind === 'header') {
    components.push({ type: 'header', parameters: [{ type: 'text', text: resolveMapping(p.header_1, contact) }] });
  } else if (header?.kind === 'header_media') {
    const kind = (t.headerType ?? 'image').toLowerCase();
    const link = (p.header_media?.value ?? '').trim();
    components.push({ type: 'header', parameters: [{ type: kind, [kind]: { link } }] });
  }

  const body = slots.filter((s) => s.kind === 'body');
  if (body.length) {
    components.push({
      type: 'body',
      parameters: body.map((s) => ({ type: 'text', text: resolveMapping(p[s.key], contact) })),
    });
  }

  for (const s of slots.filter((x) => x.kind === 'button')) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: s.key.slice('button_'.length),
      parameters: [{ type: 'text', text: resolveMapping(p[s.key], contact) }],
    });
  }
  return components;
}

/** Render the body as a given contact would see it (preview). */
export function renderBody(t: CampaignTemplateShape, p: Personalization, contact: ContactData): string {
  return t.bodyText.replace(PH, (token, n) => resolveMapping(p[`body_${n}`], contact) || token);
}

/**
 * Stored form: the Broadcast.templateVariables JSON column. Numeric keys
 * ("1","2") keep holding the static string for legacy readers; the full
 * mapping lives under "__personalization".
 */
export function toStoredVariables(slots: SlotInfo[], p: Personalization): Record<string, unknown> {
  const stored: Record<string, unknown> = { __personalization: p };
  for (const s of slots) {
    if (s.kind === 'body') {
      const m = p[s.key];
      stored[s.key.slice(5)] = m?.source === 'static' ? m.value ?? '' : m?.fallback ?? '';
    }
  }
  return stored;
}

export function fromStoredVariables(stored: unknown): Personalization {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const record = stored as Record<string, unknown>;
  const p = record.__personalization;
  if (p && typeof p === 'object' && !Array.isArray(p)) return p as Personalization;
  // Legacy rows: { "1": "Asha" } → static body mappings.
  const legacy: Personalization = {};
  for (const [k, v] of Object.entries(record)) {
    if (/^\d+$/.test(k) && typeof v === 'string') legacy[`body_${k}`] = { source: 'static', value: v };
  }
  return legacy;
}
