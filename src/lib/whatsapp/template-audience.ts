/**
 * Which kind of business a WhatsApp template is meant for, so each dashboard
 * only lists its own. Templates synced from Meta are shared by every app on
 * the same WhatsApp Business account, so a clinic can receive a gym's
 * templates and vice versa.
 *
 * A template is tied to a business type only on clear signals (the system
 * event it serves, or unmistakable words in its name or text). Everything
 * else (offers, order updates, generic appointment messages) is "general"
 * and shown to every business.
 */

export const AUDIENCES = ['healthcare', 'fitness', 'beauty', 'hospitality', 'education', 'automotive', 'pet'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<Audience, string> = {
  healthcare: 'Healthcare',
  fitness: 'Health & fitness',
  beauty: 'Beauty & salon',
  hospitality: 'Hospitality',
  education: 'Education',
  automotive: 'Automotive',
  pet: 'Pet services',
};

/** Business segment (see getBusinessSegment) → template audience; null = no specific audience. */
export function audienceForSegment(segment: string | null | undefined): Audience | null {
  switch (segment) {
    case 'healthcare':
      return 'healthcare';
    case 'wellness':
      return 'fitness';
    case 'beauty':
      return 'beauty';
    case 'hospitality':
      return 'hospitality';
    case 'education':
      return 'education';
    case 'automotive':
      return 'automotive';
    case 'pet':
      return 'pet';
    default:
      return null;
  }
}

const EVENT_AUDIENCE: Record<string, Audience> = {
  token_confirmation: 'healthcare',
  prescription: 'healthcare',
  doctor_ready: 'healthcare',
  member_welcome: 'fitness',
};

// Name words use "_" as separators; body words are matched as whole words.
const RULES: Array<{ audience: Audience; name: RegExp; body: RegExp }> = [
  { audience: 'healthcare', name: /patient|prescription|doctor|clinic|hospital|dental|medic|consult|lab_report|opd|token/, body: /\b(prescription|patients?|doctor|dr\.|clinic|hospital|dental|medicines?|consultation)\b/i },
  { audience: 'fitness', name: /gym|fitness|workout|trainer|membership|member_|yoga|crossfit|zumba|pilates/, body: /\b(gym|workouts?|trainer|fitness|membership|yoga)\b/i },
  { audience: 'beauty', name: /salon|spa_|beauty|parlou?r|haircut|facial|nail|makeup|barber/, body: /\b(salon|haircut|facial|manicure|pedicure|makeup|stylist)\b/i },
  { audience: 'hospitality', name: /hotel|resort|room_|check_?in|check_?out|stay_|reservation/, body: /\b(hotel|resort|check-in|room)\b/i },
  { audience: 'education', name: /course|class_|student|admission|exam|tuition|batch/, body: /\b(students?|courses?|admission|exams?|tuition)\b/i },
  { audience: 'automotive', name: /vehicle|car_|bike_|service_due|garage|workshop/, body: /\b(vehicle|car service|garage)\b/i },
  { audience: 'pet', name: /pet_|groom|vet_|puppy|dog_|cat_/, body: /\b(your pet|grooming|vet)\b/i },
];

export interface TemplateLike {
  name: string;
  eventType?: string | null;
  body_text?: string | null;
  bodyText?: string | null;
}

/** The audience a template is for, or null for a general template. */
export function templateAudience(t: TemplateLike): Audience | null {
  if (t.eventType && EVENT_AUDIENCE[t.eventType]) return EVENT_AUDIENCE[t.eventType];
  const name = `_${t.name.toLowerCase()}_`;
  const byName = RULES.filter((r) => r.name.test(name));
  if (byName.length === 1) return byName[0].audience;
  if (byName.length > 1) return null; // ambiguous name: treat as general
  const body = t.body_text ?? t.bodyText ?? '';
  const byBody = RULES.filter((r) => r.body.test(body));
  return byBody.length === 1 ? byBody[0].audience : null;
}

/** Shown to this business: general templates and its own audience. */
export function isRelevantTemplate(t: TemplateLike, audience: Audience | null): boolean {
  const a = templateAudience(t);
  return a === null || a === audience;
}
