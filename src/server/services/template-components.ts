/**
 * Meta message-template component assembly.
 *
 * Pure functions, no I/O. Lifted verbatim in behaviour from
 * `src/app/api/whatsapp/templates/route.ts`, where ~200 lines of the
 * codebase's strongest validation logic sat inline in a route handler and
 * could not be unit-tested or reused. The only change is that failures are
 * `ValidationError` instead of bare `Error`, so the global handler maps
 * them to 400 with field-level details automatically.
 */

import {
  TEMPLATE_LIMITS,
  type MetaTemplateButtonInput,
  type MetaTemplateCategory,
  type MetaTemplateComponentInput,
} from '@/lib/whatsapp/meta-api';

import { ValidationError } from '../kernel';

export const TEMPLATE_CATEGORIES = ['Marketing', 'Utility', 'Authentication'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_STATUSES = ['Draft', 'Pending', 'Approved', 'Rejected'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const TEMPLATE_HEADER_TYPES = ['none', 'text', 'image', 'video', 'document'] as const;
export type TemplateHeaderType = (typeof TEMPLATE_HEADER_TYPES)[number];

export interface TemplateButtonInput {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text: string;
  url?: string;
  phoneNumber?: string;
  /** Sample suffix for a URL button whose link ends in `{{1}}`. */
  example?: string;
}

export interface TemplateDefinition {
  name: string;
  category: TemplateCategory;
  language: string;
  headerType: TemplateHeaderType;
  headerText?: string;
  /** Sample media URL — Meta requires one to review a media header. */
  headerExample?: string;
  /** Samples for `{{1}}…{{n}}` in a text header. */
  headerTextExample?: string[];
  bodyText: string;
  bodyExample?: string[];
  footerText?: string;
  buttons?: TemplateButtonInput[];
}

/**
 * Meta template names are lowercase, underscore-separated. Normalising
 * rather than rejecting means "Order Update" becomes `order_update`
 * instead of erroring on a difference the user cannot see.
 */
export function normalizeTemplateName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

export function assertValidTemplateName(name: string): void {
  if (!name) {
    throw new ValidationError('Template name is required.', { details: { field: 'name' } });
  }
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new ValidationError(
      'Name may only contain lowercase letters, numbers and underscores.',
      { details: { field: 'name' } },
    );
  }
  if (name.length > TEMPLATE_LIMITS.nameMaxLength) {
    throw new ValidationError(`Template name must be ${TEMPLATE_LIMITS.nameMaxLength} characters or fewer.`, {
      details: { field: 'name' },
    });
  }
}

export function toMetaCategory(category: string): MetaTemplateCategory {
  switch (category.toUpperCase()) {
    case 'UTILITY':
      return 'UTILITY';
    case 'AUTHENTICATION':
      return 'AUTHENTICATION';
    default:
      return 'MARKETING';
  }
}

export function toLocalCategory(metaCategory: string): TemplateCategory {
  switch (metaCategory.toUpperCase()) {
    case 'UTILITY':
      return 'Utility';
    case 'AUTHENTICATION':
      return 'Authentication';
    default:
      return 'Marketing';
  }
}

/**
 * Meta's states collapse onto four local ones. `DISABLED` and `PAUSED`
 * both mean "cannot be sent", which is what `Rejected` conveys to a user
 * looking at the template list.
 */
export function toLocalStatus(metaStatus: string): TemplateStatus {
  switch (metaStatus.toUpperCase()) {
    case 'APPROVED':
      return 'Approved';
    case 'REJECTED':
    case 'DISABLED':
    case 'PAUSED':
      return 'Rejected';
    case 'PENDING':
    case 'IN_APPEAL':
    case 'PENDING_DELETION':
    default:
      return 'Pending';
  }
}

/**
 * Highest `{{n}}` placeholder plus whether the numbering is gap-free.
 * Meta rejects a template whose variables skip a number, and requires a
 * sample for each one.
 */
export function placeholderCount(text: string): { max: number; gapFree: boolean } {
  const numbers = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1]));
  if (numbers.length === 0) return { max: 0, gapFree: true };
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  return {
    max: unique[unique.length - 1],
    gapFree: unique.every((value, index) => value === index + 1),
  };
}

function buildHeader(definition: TemplateDefinition): MetaTemplateComponentInput | null {
  const headerType = definition.headerType;
  if (headerType === 'none') return null;

  if (headerType === 'text') {
    const text = (definition.headerText ?? '').trim();
    if (!text) {
      throw new ValidationError('Text header selected but header text is empty.', {
        details: { field: 'headerText' },
      });
    }
    if (text.length > TEMPLATE_LIMITS.headerTextMaxLength) {
      throw new ValidationError(
        `Header text exceeds ${TEMPLATE_LIMITS.headerTextMaxLength} characters.`,
        { details: { field: 'headerText' } },
      );
    }

    const { max, gapFree } = placeholderCount(text);
    if (max > 1) {
      throw new ValidationError('A text header supports at most one {{1}} variable.', {
        details: { field: 'headerText' },
      });
    }
    if (!gapFree) {
      throw new ValidationError('Header variables must be numbered starting at {{1}}.', {
        details: { field: 'headerText' },
      });
    }

    const header: MetaTemplateComponentInput = { type: 'HEADER', format: 'TEXT', text };
    if (max === 1) {
      const sample = definition.headerTextExample?.[0]?.trim();
      if (!sample) {
        throw new ValidationError('Provide a sample value for the header {{1}} variable.', {
          details: { field: 'headerTextExample' },
        });
      }
      header.example = { header_text: [sample] };
    }
    return header;
  }

  const sample = (definition.headerExample ?? '').trim();
  if (!sample) {
    throw new ValidationError(
      `A ${headerType} header requires a sample media URL so Meta can review it.`,
      { details: { field: 'headerExample' } },
    );
  }
  return {
    type: 'HEADER',
    format: headerType.toUpperCase() as 'IMAGE' | 'VIDEO' | 'DOCUMENT',
    example: { header_handle: [sample] },
  };
}

function buildBody(definition: TemplateDefinition): MetaTemplateComponentInput {
  const bodyText = (definition.bodyText ?? '').trim();
  if (!bodyText) {
    throw new ValidationError('Body text is required.', { details: { field: 'bodyText' } });
  }
  if (bodyText.length > TEMPLATE_LIMITS.bodyMaxLength) {
    throw new ValidationError(`Body text exceeds ${TEMPLATE_LIMITS.bodyMaxLength} characters.`, {
      details: { field: 'bodyText' },
    });
  }

  const { max, gapFree } = placeholderCount(bodyText);
  if (!gapFree) {
    throw new ValidationError('Body variables must be sequential starting at {{1}} with no gaps.', {
      details: { field: 'bodyText' },
    });
  }

  const component: MetaTemplateComponentInput = { type: 'BODY', text: bodyText };
  if (max > 0) {
    const examples = (definition.bodyExample ?? []).map((sample) => (sample ?? '').trim());
    if (examples.length < max || examples.slice(0, max).some((sample) => !sample)) {
      throw new ValidationError(`Provide a sample value for each of the ${max} body variable(s).`, {
        details: { field: 'bodyExample', required: max },
      });
    }
    component.example = { body_text: [examples.slice(0, max)] };
  }
  return component;
}

function buildButtons(definition: TemplateDefinition): MetaTemplateButtonInput[] | null {
  const raw = (definition.buttons ?? []).filter((button) => button.text?.trim());
  if (raw.length === 0) return null;

  if (raw.length > TEMPLATE_LIMITS.maxButtons) {
    throw new ValidationError(`A template supports at most ${TEMPLATE_LIMITS.maxButtons} buttons.`, {
      details: { field: 'buttons' },
    });
  }

  let urlCount = 0;
  let phoneCount = 0;
  let quickReplyCount = 0;

  const buttons: MetaTemplateButtonInput[] = raw.map((button) => {
    const text = button.text.trim();
    if (text.length > TEMPLATE_LIMITS.buttonTextMaxLength) {
      throw new ValidationError(
        `Button "${text}" exceeds ${TEMPLATE_LIMITS.buttonTextMaxLength} characters.`,
        { details: { field: 'buttons' } },
      );
    }

    if (button.type === 'URL') {
      urlCount += 1;
      const url = (button.url ?? '').trim();
      if (!url) {
        throw new ValidationError(`URL button "${text}" is missing its link.`, {
          details: { field: 'buttons' },
        });
      }
      if (!/^https?:\/\//i.test(url)) {
        throw new ValidationError(`URL button "${text}" link must start with http(s)://`, {
          details: { field: 'buttons' },
        });
      }
      const built: MetaTemplateButtonInput = { type: 'URL', text, url };
      if (/\{\{\s*1\s*\}\}/.test(url)) {
        const sample = (button.example ?? '').trim();
        if (!sample) {
          throw new ValidationError(`URL button "${text}" uses {{1}} — provide a sample URL suffix.`, {
            details: { field: 'buttons' },
          });
        }
        built.example = [sample];
      }
      return built;
    }

    if (button.type === 'PHONE_NUMBER') {
      phoneCount += 1;
      const phone = (button.phoneNumber ?? '').trim();
      if (!/^\+?[1-9]\d{6,14}$/.test(phone)) {
        throw new ValidationError(`Call button "${text}" needs a valid phone number in E.164.`, {
          details: { field: 'buttons' },
        });
      }
      return { type: 'PHONE_NUMBER', text, phone_number: phone };
    }

    quickReplyCount += 1;
    return { type: 'QUICK_REPLY', text };
  });

  if (urlCount > TEMPLATE_LIMITS.maxUrlButtons) {
    throw new ValidationError(`At most ${TEMPLATE_LIMITS.maxUrlButtons} URL buttons are allowed.`, {
      details: { field: 'buttons' },
    });
  }
  if (phoneCount > TEMPLATE_LIMITS.maxPhoneButtons) {
    throw new ValidationError(`At most ${TEMPLATE_LIMITS.maxPhoneButtons} call button is allowed.`, {
      details: { field: 'buttons' },
    });
  }
  if (quickReplyCount > TEMPLATE_LIMITS.maxQuickReply) {
    throw new ValidationError(
      `At most ${TEMPLATE_LIMITS.maxQuickReply} quick-reply buttons are allowed.`,
      { details: { field: 'buttons' } },
    );
  }

  return buttons;
}

export interface BuiltTemplate {
  components: MetaTemplateComponentInput[];
  /** Button set stored locally so the UI can preview without re-fetching. */
  localButtons: MetaTemplateButtonInput[] | null;
}

export function buildTemplateComponents(definition: TemplateDefinition): BuiltTemplate {
  const components: MetaTemplateComponentInput[] = [];

  const header = buildHeader(definition);
  if (header) components.push(header);

  components.push(buildBody(definition));

  const footer = (definition.footerText ?? '').trim();
  if (footer) {
    if (footer.length > TEMPLATE_LIMITS.footerMaxLength) {
      throw new ValidationError(`Footer exceeds ${TEMPLATE_LIMITS.footerMaxLength} characters.`, {
        details: { field: 'footerText' },
      });
    }
    components.push({ type: 'FOOTER', text: footer });
  }

  const buttons = buildButtons(definition);
  if (buttons) components.push({ type: 'BUTTONS', buttons });

  return { components, localButtons: buttons };
}

/**
 * Verifies a caller supplied the right number of positional variables for
 * a template body before a send is attempted. Meta answers a mismatch with
 * error #132000 *after* the request; checking first turns that into a 400
 * the client can act on.
 */
export function assertParamCount(bodyText: string, params: string[]): void {
  const { max } = placeholderCount(bodyText);
  if (params.length < max) {
    throw new ValidationError(
      `This template needs ${max} variable value(s); ${params.length} provided.`,
      { details: { required: max, provided: params.length } },
    );
  }
}
