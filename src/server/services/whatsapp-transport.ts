/**
 * Meta Cloud API transport.
 *
 * The single adapter between the service layer's narrow transport
 * interfaces (`OutboundTransport`, `TemplateTransport`,
 * `BroadcastTransport`) and `src/lib/whatsapp/meta-api.ts`. Credential
 * resolution, phone normalisation, and the sandbox variant retry live here
 * so no service needs to know any of it.
 *
 * Why this exists as its own module: the same send logic was previously
 * duplicated three times — `lib/automations/meta-send.ts`,
 * `lib/flows/meta-send.ts` (roughly 90% identical), and inline inside
 * `api/whatsapp/send/route.ts`. Each copy drifted: only the route had the
 * phone-variant retry, only the route persisted the message, and none of
 * them agreed on error shape.
 */

import {
  createMessageTemplate,
  deleteMessageTemplate,
  listMessageTemplates,
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendReactionMessage,
  sendTemplateMessage,
  sendTextMessage,
  type MetaTemplateCategory,
  type MetaTemplateComponentInput,
} from '@/lib/whatsapp/meta-api';
import {
  isRecipientNotAllowedError,
  isValidE164,
  phoneVariants,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';

import { ExternalApiError, ValidationError, getLogger, type TenantDb } from '../kernel';
import type { BroadcastTransport } from './broadcast.service';
import type { OutboundTransport } from './conversation.service';
import type { InteractiveTransport, ReactionTransport } from './outbound.service';
import type { MetaTemplateSummary, TemplateTransport } from './template.service';
import {
  WhatsappConfigRepository,
  type WhatsappCredentials,
} from '../repositories/whatsapp-config.repository';

const log = getLogger('whatsapp.transport');

/** Meta paginates template listings; cap the walk so a sync cannot hang. */
const MAX_TEMPLATE_PAGES = 20;

export class WhatsappTransport
  implements OutboundTransport, TemplateTransport, BroadcastTransport, InteractiveTransport, ReactionTransport
{
  private constructor(private readonly credentials: WhatsappCredentials) {}

  /**
   * Returns null when the tenant has not connected WhatsApp. Services treat
   * a null transport as "this capability is unavailable" and produce a clear
   * 400 rather than failing deep inside a send.
   */
  static async forTenant(db: TenantDb): Promise<WhatsappTransport | null> {
    const credentials = await new WhatsappConfigRepository(db).findCredentials();
    return credentials ? new WhatsappTransport(credentials) : null;
  }

  private normalise(to: string): string {
    const sanitized = sanitizePhoneForMeta(to);
    if (!isValidE164(sanitized)) {
      throw new ValidationError('Recipient phone number is not a valid international number.', {
        details: { phone: to },
      });
    }
    return sanitized;
  }

  /**
   * Meta's sandbox sometimes registers a number with a trunk `0` that the
   * international format drops, answering error #131030. Retrying the known
   * variants turns an unexplained failure into a successful send.
   *
   * Any other error propagates on the first attempt — retrying a bad token
   * or an unapproved template three times would only slow the failure down.
   */
  private async withPhoneVariants<T>(phone: string, attempt: (candidate: string) => Promise<T>): Promise<T> {
    const variants = phoneVariants(phone);
    let lastError: unknown = null;

    for (const variant of variants) {
      try {
        return await attempt(variant);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isRecipientNotAllowedError(message)) throw error;
        lastError = error;
        log.warn('recipient rejected, trying next phone variant', { variantCount: variants.length });
      }
    }

    throw lastError ?? new ExternalApiError('Meta', 'No phone number variant was accepted.');
  }

  private wrap(error: unknown, operation: string): never {
    if (error instanceof ValidationError || error instanceof ExternalApiError) throw error;
    throw new ExternalApiError(
      'Meta',
      `${operation} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error },
    );
  }

  // ── OutboundTransport ─────────────────────────────────────────────

  async sendText(input: {
    to: string;
    text: string;
    contextMessageId?: string;
  }): Promise<{ whatsappMessageId: string }> {
    const phone = this.normalise(input.to);
    try {
      const result = await this.withPhoneVariants(phone, (candidate) =>
        sendTextMessage({
          phoneNumberId: this.credentials.phoneNumberId,
          accessToken: this.credentials.accessToken,
          to: candidate,
          text: input.text,
          contextMessageId: input.contextMessageId,
        }),
      );
      return { whatsappMessageId: result.messageId };
    } catch (error) {
      this.wrap(error, 'Sending a text message');
    }
  }

  async sendTemplate(input: {
    to: string;
    templateName: string;
    language?: string;
    params: string[];
    contextMessageId?: string;
  }): Promise<{ whatsappMessageId: string }> {
    const phone = this.normalise(input.to);
    try {
      const result = await this.withPhoneVariants(phone, (candidate) =>
        sendTemplateMessage({
          phoneNumberId: this.credentials.phoneNumberId,
          accessToken: this.credentials.accessToken,
          to: candidate,
          templateName: input.templateName,
          language: input.language,
          params: input.params,
          contextMessageId: input.contextMessageId,
        }),
      );
      return { whatsappMessageId: result.messageId };
    } catch (error) {
      this.wrap(error, 'Sending a template message');
    }
  }

  /**
   * Media sending (image, document, audio, video) via Meta Cloud API.
   */
  async sendMedia(input: {
    to: string;
    contentType: 'image' | 'document' | 'audio' | 'video';
    mediaUrl: string;
    caption?: string;
    filename?: string;
    contextMessageId?: string;
  }): Promise<{ whatsappMessageId: string }> {
    const phone = this.normalise(input.to);
    try {
      const result = await this.withPhoneVariants(phone, (candidate) =>
        sendMediaMessage({
          phoneNumberId: this.credentials.phoneNumberId,
          accessToken: this.credentials.accessToken,
          to: candidate,
          contentType: input.contentType,
          mediaUrl: input.mediaUrl,
          caption: input.caption,
          filename: input.filename,
          contextMessageId: input.contextMessageId,
        }),
      );
      return { whatsappMessageId: result.messageId };
    } catch (error) {
      this.wrap(error, `Sending a ${input.contentType} message`);
    }
  }

  // ── BroadcastTransport ────────────────────────────────────────────
  // Structurally identical to sendTemplate but with a required language,
  // because a campaign always resolves one from the template row.

  // ── InteractiveTransport ──────────────────────────────────────────
  // Buttons and lists are what make a flow a flow. Previously these were
  // reachable only through `lib/flows/meta-send.ts`, which decrypted the
  // access token itself — a second credential path with no phone-variant
  // retry and no shared error shape.

  async sendInteractiveButtons(input: {
    to: string;
    bodyText: string;
    headerText?: string;
    footerText?: string;
    buttons: Array<{ id: string; title: string }>;
    contextMessageId?: string;
  }): Promise<{ whatsappMessageId: string }> {
    const phone = this.normalise(input.to);
    try {
      const result = await this.withPhoneVariants(phone, (candidate) =>
        sendInteractiveButtons({
          phoneNumberId: this.credentials.phoneNumberId,
          accessToken: this.credentials.accessToken,
          to: candidate,
          bodyText: input.bodyText,
          headerText: input.headerText,
          footerText: input.footerText,
          buttons: input.buttons,
          contextMessageId: input.contextMessageId,
        }),
      );
      return { whatsappMessageId: result.messageId };
    } catch (error) {
      this.wrap(error, 'Sending an interactive button message');
    }
  }

  async sendInteractiveList(input: {
    to: string;
    bodyText: string;
    buttonLabel: string;
    headerText?: string;
    footerText?: string;
    sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
    contextMessageId?: string;
  }): Promise<{ whatsappMessageId: string }> {
    const phone = this.normalise(input.to);
    try {
      const result = await this.withPhoneVariants(phone, (candidate) =>
        sendInteractiveList({
          phoneNumberId: this.credentials.phoneNumberId,
          accessToken: this.credentials.accessToken,
          to: candidate,
          bodyText: input.bodyText,
          buttonLabel: input.buttonLabel,
          headerText: input.headerText,
          footerText: input.footerText,
          sections: input.sections,
          contextMessageId: input.contextMessageId,
        }),
      );
      return { whatsappMessageId: result.messageId };
    } catch (error) {
      this.wrap(error, 'Sending an interactive list message');
    }
  }

  // ── ReactionTransport ─────────────────────────────────────────────

  /**
   * An empty `emoji` removes the reaction, per Meta's spec. No phone-variant
   * retry: a reaction targets a message that was already exchanged with this
   * number, so the number is known to work.
   */
  async sendReaction(input: {
    to: string;
    targetWhatsappMessageId: string;
    emoji: string;
  }): Promise<{ whatsappMessageId: string }> {
    const phone = this.normalise(input.to);
    try {
      const result = await sendReactionMessage({
        phoneNumberId: this.credentials.phoneNumberId,
        accessToken: this.credentials.accessToken,
        to: phone,
        targetMessageId: input.targetWhatsappMessageId,
        emoji: input.emoji,
      });
      return { whatsappMessageId: result.messageId };
    } catch (error) {
      this.wrap(error, 'Sending a reaction');
    }
  }

  // ── TemplateTransport ─────────────────────────────────────────────

  async submit(input: {
    name: string;
    language: string;
    category: MetaTemplateCategory;
    components: MetaTemplateComponentInput[];
  }): Promise<{ status: string }> {
    if (!this.credentials.wabaId) {
      throw new ValidationError(
        'WABA ID is missing. Reconnect your WhatsApp Business account in Settings before submitting templates.',
      );
    }
    try {
      const result = await createMessageTemplate({
        wabaId: this.credentials.wabaId,
        accessToken: this.credentials.accessToken,
        name: input.name,
        language: input.language,
        category: input.category,
        components: input.components,
      });
      return { status: result.status };
    } catch (error) {
      this.wrap(error, 'Submitting a template');
    }
  }

  async remove(input: { name: string }): Promise<void> {
    if (!this.credentials.wabaId) return;
    try {
      await deleteMessageTemplate({
        wabaId: this.credentials.wabaId,
        accessToken: this.credentials.accessToken,
        name: input.name,
      });
    } catch (error) {
      this.wrap(error, 'Deleting a template');
    }
  }

  async listAll(): Promise<{ templates: MetaTemplateSummary[]; truncated: boolean }> {
    if (!this.credentials.wabaId) {
      throw new ValidationError('WABA ID is missing. Reconnect your WhatsApp Business account in Settings.');
    }

    const templates: MetaTemplateSummary[] = [];
    let after: string | undefined;
    let pages = 0;

    try {
      for (;;) {
        const page = await listMessageTemplates({
          wabaId: this.credentials.wabaId,
          accessToken: this.credentials.accessToken,
          after,
        });

        for (const template of page.templates) {
          templates.push({
            name: template.name,
            language: template.language,
            category: template.category,
            status: template.status,
            components: (template.components ?? []) as Array<Record<string, unknown>>,
          });
        }

        pages += 1;
        after = page.nextCursor ?? undefined;
        if (!after) return { templates, truncated: false };
        if (pages >= MAX_TEMPLATE_PAGES) {
          log.warn('template sync truncated at page cap', { pages, collected: templates.length });
          return { templates, truncated: true };
        }
      }
    } catch (error) {
      this.wrap(error, 'Listing templates');
    }
  }
}
