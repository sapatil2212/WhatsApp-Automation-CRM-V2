/**
 * WhatsApp message-template rules, shared by the builder UI (live checklist),
 * the AI draft/review routes (normalisation + deterministic checks) and the
 * submit route (last line of defence before Meta).
 *
 * Pure functions only — safe to import from client components.
 *
 * Source: Meta "Message templates" + "Authentication templates" docs. The
 * rules below are the ones that most often cause an instant rejection
 * (error 2388xxx) or a review rejection.
 */

export const TEMPLATE_CATEGORIES = ['Marketing', 'Utility', 'Authentication'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export type TemplateHeaderType = 'none' | 'text' | 'image' | 'video' | 'document';
export type TemplateButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';

export interface TemplateButtonDraft {
  type: TemplateButtonType;
  text: string;
  url?: string;
  phone_number?: string;
  /** Sample value for a URL button ending in {{1}} — full URL or just the suffix. */
  example?: string;
}

export interface AuthOptions {
  /** Adds "For your security, do not share this code." */
  add_security_recommendation: boolean;
  /** 1–90 minutes; 0 / undefined = no expiry footer. */
  code_expiration_minutes?: number;
  /** Label of the copy-code button. */
  button_text: string;
}

export interface TemplateDraft {
  name: string;
  category: TemplateCategory;
  language: string;
  header_type: TemplateHeaderType;
  header_text: string;
  /** Media header: a Meta upload handle ("4::…") or a public https URL. */
  header_example: string;
  header_text_example: string;
  body_text: string;
  body_example: string[];
  footer_text: string;
  buttons: TemplateButtonDraft[];
  auth?: AuthOptions;
}

export const LIMITS = {
  nameMaxLength: 512,
  bodyMaxLength: 1024,
  headerTextMaxLength: 60,
  footerMaxLength: 60,
  buttonTextMaxLength: 25,
  maxButtons: 10,
  maxUrlButtons: 2,
  maxPhoneButtons: 1,
  maxQuickReply: 10,
} as const;

export const DEFAULT_AUTH_OPTIONS: AuthOptions = {
  add_security_recommendation: true,
  code_expiration_minutes: 10,
  button_text: 'Copy code',
};

/** Fixed body Meta renders for authentication templates (preview only). */
export function authBodyPreview(auth: AuthOptions | undefined): string {
  const base = '*{{1}}* is your verification code.';
  return auth?.add_security_recommendation
    ? `${base} For your security, do not share this code.`
    : base;
}

export function authFooterPreview(auth: AuthOptions | undefined): string {
  const minutes = auth?.code_expiration_minutes;
  return minutes ? `This code expires in ${minutes} minutes.` : '';
}

// ── text helpers ─────────────────────────────────────────────────────

const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;
// Extended_Pictographic covers emoji; also strip variation selectors / ZWJ.
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

export function placeholderNumbers(text: string): number[] {
  return [...(text ?? '').matchAll(PLACEHOLDER)].map((m) => Number(m[1]));
}

export function maxPlaceholder(text: string): number {
  const nums = placeholderNumbers(text);
  return nums.length ? Math.max(...nums) : 0;
}

export function hasEmoji(text: string): boolean {
  EMOJI.lastIndex = 0;
  return EMOJI.test(text ?? '');
}

export function stripEmoji(text: string): string {
  return (text ?? '').replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim();
}

/** "Order Shipped!" → "order_shipped" */
export function normalizeTemplateName(raw: string): string {
  return (raw ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, LIMITS.nameMaxLength);
}

/**
 * Renumber placeholders so they are sequential in order of first appearance
 * ({{3}} {{1}} → {{1}} {{2}}) and reorder examples to match.
 */
export function renumberPlaceholders(text: string, examples: string[]): { text: string; examples: string[] } {
  const order: number[] = [];
  for (const n of placeholderNumbers(text)) if (!order.includes(n)) order.push(n);
  const map = new Map(order.map((n, i) => [n, i + 1]));
  return {
    text: text.replace(PLACEHOLDER, (_, n) => `{{${map.get(Number(n))}}}`),
    examples: order.map((n) => examples[n - 1] ?? ''),
  };
}

/** Substitute {{n}} with sample values for previews. */
export function fillPlaceholders(text: string, examples: string[]): string {
  return (text ?? '').replace(PLACEHOLDER, (match, n) => {
    const value = examples[Number(n) - 1];
    return value && value.trim() ? value : match;
  });
}

/** Full sample URL for a dynamic URL button, as Meta's `example` expects. */
export function urlButtonExample(url: string, example: string | undefined): string {
  const sample = (example ?? '').trim();
  if (!sample) return '';
  if (/^https?:\/\//i.test(sample)) return sample;
  return url.replace(/\{\{\s*1\s*\}\}/, sample.replace(/^\//, ''));
}

export function isMediaHandle(value: string): boolean {
  return /^\d+::/.test((value ?? '').trim());
}

// ── validation ──────────────────────────────────────────────────────

export type IssueSeverity = 'error' | 'warning';

export interface TemplateIssue {
  id: string;
  /** Form section the issue belongs to — used to highlight the field. */
  field: 'name' | 'language' | 'category' | 'header' | 'body' | 'variables' | 'footer' | 'buttons';
  severity: IssueSeverity;
  message: string;
}

function issue(id: string, field: TemplateIssue['field'], severity: IssueSeverity, message: string): TemplateIssue {
  return { id, field, severity, message };
}

/**
 * Deterministic Meta rules. Errors block submission; warnings are things
 * that frequently get a template rejected in review.
 */
export function validateTemplate(t: TemplateDraft): TemplateIssue[] {
  const out: TemplateIssue[] = [];
  const name = (t.name ?? '').trim();

  if (!name) out.push(issue('NAME_REQUIRED', 'name', 'error', 'Template name is required.'));
  else if (!/^[a-z0-9_]+$/.test(name)) {
    out.push(issue('NAME_FORMAT', 'name', 'error', 'Name may only contain lowercase letters, numbers and underscores.'));
  } else if (name.length > LIMITS.nameMaxLength) {
    out.push(issue('NAME_LENGTH', 'name', 'error', `Name must be ${LIMITS.nameMaxLength} characters or fewer.`));
  }
  if (!(t.language ?? '').trim()) out.push(issue('LANGUAGE_REQUIRED', 'language', 'error', 'Choose a language.'));

  if (t.category === 'Authentication') {
    const auth = t.auth ?? DEFAULT_AUTH_OPTIONS;
    const minutes = auth.code_expiration_minutes;
    if (minutes !== undefined && minutes !== 0 && (minutes < 1 || minutes > 90)) {
      out.push(issue('AUTH_EXPIRY', 'footer', 'error', 'Code expiry must be between 1 and 90 minutes.'));
    }
    const label = (auth.button_text ?? '').trim();
    if (!label) out.push(issue('AUTH_BUTTON', 'buttons', 'error', 'The copy-code button needs a label.'));
    else if (label.length > LIMITS.buttonTextMaxLength) {
      out.push(issue('AUTH_BUTTON_LENGTH', 'buttons', 'error', `Copy-code label must be ≤ ${LIMITS.buttonTextMaxLength} characters.`));
    }
    return out; // Meta generates the body/footer for authentication templates.
  }

  // HEADER
  if (t.header_type === 'text') {
    const text = (t.header_text ?? '').trim();
    const nums = placeholderNumbers(text);
    if (!text) out.push(issue('HEADER_EMPTY', 'header', 'error', 'Text header is selected but empty.'));
    if (text.length > LIMITS.headerTextMaxLength) {
      out.push(issue('HEADER_LENGTH', 'header', 'error', `Header must be ≤ ${LIMITS.headerTextMaxLength} characters (${text.length}).`));
    }
    if (nums.length > 1 || nums.some((n) => n !== 1)) {
      out.push(issue('HEADER_VARS', 'header', 'error', 'A text header supports a single {{1}} variable.'));
    } else if (nums.length === 1 && !(t.header_text_example ?? '').trim()) {
      out.push(issue('HEADER_EXAMPLE', 'header', 'error', 'Add a sample value for the header {{1}}.'));
    }
    if (hasEmoji(text)) out.push(issue('HEADER_EMOJI', 'header', 'error', 'Emoji are not allowed in a text header.'));
    if (/[\n*_~`]/.test(text)) {
      out.push(issue('HEADER_FORMAT', 'header', 'error', 'Header cannot contain new lines or formatting characters (* _ ~ `).'));
    }
  } else if (t.header_type !== 'none') {
    if (!(t.header_example ?? '').trim()) {
      out.push(issue('HEADER_MEDIA', 'header', 'error', `Upload a sample ${t.header_type} for Meta to review.`));
    }
  }

  // BODY
  const body = (t.body_text ?? '').trim();
  const bodyNums = placeholderNumbers(body);
  const uniq = [...new Set(bodyNums)].sort((a, b) => a - b);
  if (!body) out.push(issue('BODY_REQUIRED', 'body', 'error', 'Body text is required.'));
  if (body.length > LIMITS.bodyMaxLength) {
    out.push(issue('BODY_LENGTH', 'body', 'error', `Body must be ≤ ${LIMITS.bodyMaxLength} characters (${body.length}).`));
  }
  if (uniq.length && !uniq.every((n, i) => n === i + 1)) {
    out.push(issue('VAR_SEQUENCE', 'variables', 'error', 'Variables must be numbered {{1}}, {{2}}, … with no gaps.'));
  }
  if (uniq.length) {
    const missing = uniq.filter((n) => !(t.body_example?.[n - 1] ?? '').trim());
    if (missing.length) {
      out.push(issue('VAR_EXAMPLES', 'variables', 'error', `Add sample values for ${missing.map((n) => `{{${n}}}`).join(', ')}.`));
    }
    if (/^\s*\{\{\s*\d+\s*\}\}/.test(body) || /\{\{\s*\d+\s*\}\}[\s.!?]*$/.test(body)) {
      out.push(issue('VAR_EDGES', 'body', 'error', 'The body cannot start or end with a variable — add text before/after it.'));
    }
    if (/\}\}\s*\{\{/.test(body)) {
      out.push(issue('VAR_ADJACENT', 'body', 'warning', 'Two variables side by side are often rejected — separate them with words.'));
    }
    const words = body.replace(PLACEHOLDER, ' ').split(/\s+/).filter(Boolean).length;
    if (words < uniq.length * 3) {
      out.push(issue('VAR_RATIO', 'body', 'warning', 'Too many variables for the amount of text. Meta asks for more fixed wording.'));
    }
  }
  if (/\n{3,}/.test(body)) out.push(issue('BODY_NEWLINES', 'body', 'warning', 'Avoid more than two consecutive line breaks.'));
  if (/ {5,}|\t/.test(body)) out.push(issue('BODY_SPACES', 'body', 'error', 'Body cannot contain tabs or more than 4 consecutive spaces.'));

  // FOOTER
  const footer = (t.footer_text ?? '').trim();
  if (footer.length > LIMITS.footerMaxLength) {
    out.push(issue('FOOTER_LENGTH', 'footer', 'error', `Footer must be ≤ ${LIMITS.footerMaxLength} characters (${footer.length}).`));
  }
  if (placeholderNumbers(footer).length) out.push(issue('FOOTER_VARS', 'footer', 'error', 'The footer cannot contain variables.'));
  if (t.category === 'Utility' && /\b(stop|unsubscribe|opt[- ]?out)\b/i.test(footer + ' ' + body)) {
    out.push(issue('UTILITY_OPTOUT', 'category', 'warning', 'Opt-out wording suggests Marketing — Meta may recategorise this Utility template.'));
  }

  // BUTTONS
  const buttons = t.buttons ?? [];
  if (buttons.length > LIMITS.maxButtons) out.push(issue('BTN_COUNT', 'buttons', 'error', `At most ${LIMITS.maxButtons} buttons.`));
  const count = (type: TemplateButtonType) => buttons.filter((b) => b.type === type).length;
  if (count('URL') > LIMITS.maxUrlButtons) out.push(issue('BTN_URL_COUNT', 'buttons', 'error', `At most ${LIMITS.maxUrlButtons} website buttons.`));
  if (count('PHONE_NUMBER') > LIMITS.maxPhoneButtons) out.push(issue('BTN_PHONE_COUNT', 'buttons', 'error', 'At most 1 call button.'));
  const labels = new Set<string>();
  buttons.forEach((b, i) => {
    const label = (b.text ?? '').trim();
    const n = `Button ${i + 1}`;
    if (!label) out.push(issue(`BTN_${i}_TEXT`, 'buttons', 'error', `${n} needs a label.`));
    if (label.length > LIMITS.buttonTextMaxLength) out.push(issue(`BTN_${i}_LEN`, 'buttons', 'error', `${n} label must be ≤ ${LIMITS.buttonTextMaxLength} characters.`));
    if (hasEmoji(label) || /[\n*_~`]|\{\{/.test(label)) {
      out.push(issue(`BTN_${i}_FMT`, 'buttons', 'error', `${n} label cannot contain emoji, variables, new lines or formatting.`));
    }
    if (label && labels.has(label.toLowerCase())) out.push(issue(`BTN_${i}_DUP`, 'buttons', 'error', `${n} duplicates another button label.`));
    labels.add(label.toLowerCase());

    if (b.type === 'URL') {
      const url = (b.url ?? '').trim();
      if (!/^https:\/\/[^\s]+\.[^\s]+/i.test(url)) out.push(issue(`BTN_${i}_URL`, 'buttons', 'error', `${n} needs a valid https:// link.`));
      const vars = placeholderNumbers(url);
      if (vars.length > 1 || (vars.length === 1 && !/\{\{\s*1\s*\}\}$/.test(url))) {
        out.push(issue(`BTN_${i}_URLVAR`, 'buttons', 'error', `${n}: only one {{1}} is allowed, at the very end of the link.`));
      } else if (vars.length === 1 && !(b.example ?? '').trim()) {
        out.push(issue(`BTN_${i}_URLEX`, 'buttons', 'error', `${n}: add a sample value for the {{1}} in the link.`));
      }
    }
    if (b.type === 'PHONE_NUMBER' && !/^\+[1-9]\d{6,14}$/.test((b.phone_number ?? '').replace(/[\s-]/g, ''))) {
      out.push(issue(`BTN_${i}_PHONE`, 'buttons', 'error', `${n} needs a phone number in international format, e.g. +919876543210.`));
    }
  });
  // Quick replies must be grouped together, not interleaved with CTA buttons.
  const kinds = buttons.map((b) => (b.type === 'QUICK_REPLY' ? 'Q' : 'C')).join('');
  if (/Q+C+Q|C+Q+C/.test(kinds)) {
    out.push(issue('BTN_GROUPING', 'buttons', 'error', 'Group quick-reply buttons together (all before or all after link/call buttons).'));
  }

  return out;
}

export function hasBlockingIssues(issues: TemplateIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/** Stable fingerprint of the content Meta reviews (used to skip re-reviews). */
export function templateFingerprint(t: TemplateDraft): string {
  return JSON.stringify([
    t.name, t.category, t.language, t.header_type, t.header_text, t.header_text_example,
    t.body_text, t.body_example, t.footer_text, t.buttons, t.auth,
  ]);
}
