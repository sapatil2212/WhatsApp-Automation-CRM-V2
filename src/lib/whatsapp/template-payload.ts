import type {
  MetaTemplateButtonInput,
  MetaTemplateCategory,
  MetaTemplateComponentInput,
} from './meta-api';
import {
  DEFAULT_AUTH_OPTIONS,
  placeholderNumbers,
  urlButtonExample,
  type TemplateDraft,
} from './template-rules';

export function toMetaCategory(c: string): MetaTemplateCategory {
  switch ((c ?? '').toUpperCase()) {
    case 'UTILITY':
      return 'UTILITY';
    case 'AUTHENTICATION':
      return 'AUTHENTICATION';
    default:
      return 'MARKETING';
  }
}

export function fromMetaCategory(c: string): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = (c ?? '').toUpperCase();
  if (upper === 'UTILITY') return 'Utility';
  if (upper === 'AUTHENTICATION') return 'Authentication';
  return 'Marketing';
}

/** Meta status (UPPER) → local catalog status (TitleCase). */
export function toLocalStatus(meta: string): 'Draft' | 'Pending' | 'Approved' | 'Rejected' {
  switch ((meta ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'Approved';
    case 'REJECTED':
    case 'DISABLED':
    case 'PAUSED':
    case 'DELETED':
    case 'ARCHIVED':
      return 'Rejected';
    case 'PENDING':
    case 'IN_APPEAL':
    case 'PENDING_DELETION':
    case 'LIMIT_EXCEEDED':
    default:
      return 'Pending';
  }
}

/**
 * Assemble Meta's `components` array from a validated builder draft.
 * `mediaHandle` must already be a Resumable-Upload handle for media headers.
 */
export function buildComponents(
  t: TemplateDraft,
  mediaHandle?: string,
): { components: MetaTemplateComponentInput[]; localButtons: MetaTemplateButtonInput[] | null } {
  if (t.category === 'Authentication') {
    const auth = t.auth ?? DEFAULT_AUTH_OPTIONS;
    const components: MetaTemplateComponentInput[] = [
      { type: 'BODY', add_security_recommendation: Boolean(auth.add_security_recommendation) },
    ];
    if (auth.code_expiration_minutes) {
      components.push({ type: 'FOOTER', code_expiration_minutes: auth.code_expiration_minutes });
    }
    const buttons: MetaTemplateButtonInput[] = [
      { type: 'OTP', otp_type: 'COPY_CODE', text: auth.button_text.trim() || 'Copy code' },
    ];
    components.push({ type: 'BUTTONS', buttons });
    return { components, localButtons: buttons };
  }

  const components: MetaTemplateComponentInput[] = [];

  if (t.header_type === 'text') {
    const text = t.header_text.trim();
    const header: MetaTemplateComponentInput = { type: 'HEADER', format: 'TEXT', text };
    if (placeholderNumbers(text).length) header.example = { header_text: [t.header_text_example.trim()] };
    components.push(header);
  } else if (t.header_type !== 'none') {
    components.push({
      type: 'HEADER',
      format: t.header_type.toUpperCase() as 'IMAGE' | 'VIDEO' | 'DOCUMENT',
      example: { header_handle: [mediaHandle ?? t.header_example.trim()] },
    });
  }

  const bodyText = t.body_text.trim();
  const body: MetaTemplateComponentInput = { type: 'BODY', text: bodyText };
  const varCount = new Set(placeholderNumbers(bodyText)).size;
  if (varCount) body.example = { body_text: [t.body_example.slice(0, varCount).map((s) => s.trim())] };
  components.push(body);

  const footer = t.footer_text.trim();
  if (footer) components.push({ type: 'FOOTER', text: footer });

  let localButtons: MetaTemplateButtonInput[] | null = null;
  const buttons = t.buttons.filter((b) => b.text?.trim());
  if (buttons.length) {
    localButtons = buttons.map((b): MetaTemplateButtonInput => {
      const text = b.text.trim();
      if (b.type === 'URL') {
        const url = (b.url ?? '').trim();
        const btn: MetaTemplateButtonInput = { type: 'URL', text, url };
        if (placeholderNumbers(url).length) btn.example = [urlButtonExample(url, b.example)];
        return btn;
      }
      if (b.type === 'PHONE_NUMBER') {
        return { type: 'PHONE_NUMBER', text, phone_number: (b.phone_number ?? '').replace(/[\s-]/g, '') };
      }
      return { type: 'QUICK_REPLY', text };
    });
    components.push({ type: 'BUTTONS', buttons: localButtons });
  }

  return { components, localButtons };
}

/** Coerce an untrusted request body into a TemplateDraft. */
export function draftFromBody(body: Record<string, unknown>): TemplateDraft {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const headerTextExample = Array.isArray(body.header_text_example)
    ? s(body.header_text_example[0])
    : s(body.header_text_example);
  const auth = body.auth && typeof body.auth === 'object' ? (body.auth as Record<string, unknown>) : null;
  const category = fromMetaCategory(s(body.category) || 'Marketing');
  return {
    name: s(body.name).trim().toLowerCase().replace(/\s+/g, '_'),
    category,
    language: s(body.language).trim() || 'en_US',
    header_type: (['none', 'text', 'image', 'video', 'document'].includes(s(body.header_type))
      ? s(body.header_type)
      : 'none') as TemplateDraft['header_type'],
    header_text: s(body.header_text),
    header_example: s(body.header_example),
    header_text_example: headerTextExample,
    body_text: s(body.body_text),
    body_example: Array.isArray(body.body_example) ? body.body_example.map((v) => s(v)) : [],
    footer_text: s(body.footer_text),
    buttons: Array.isArray(body.buttons)
      ? (body.buttons as Array<Record<string, unknown>>).map((b) => ({
          type: (['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(s(b.type)) ? s(b.type) : 'QUICK_REPLY') as
            'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER',
          text: s(b.text),
          url: s(b.url),
          phone_number: s(b.phone_number),
          example: s(b.example),
        }))
      : [],
    auth:
      category === 'Authentication'
        ? {
            add_security_recommendation: auth ? auth.add_security_recommendation !== false : DEFAULT_AUTH_OPTIONS.add_security_recommendation,
            code_expiration_minutes: auth
              ? Number(auth.code_expiration_minutes) || undefined
              : DEFAULT_AUTH_OPTIONS.code_expiration_minutes,
            button_text: auth ? s(auth.button_text) || DEFAULT_AUTH_OPTIONS.button_text : DEFAULT_AUTH_OPTIONS.button_text,
          }
        : undefined,
  };
}
