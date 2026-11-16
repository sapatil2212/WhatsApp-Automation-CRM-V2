/**
 * Broadcast business rules.
 *
 * The structural change: **sending runs on the server, in bounded
 * batches, driven by a caller that can be a cron tick.**
 *
 * Previously the fan-out loop lived in a React hook
 * (`use-broadcast-sending.ts`) that iterated `fetch` calls from the
 * browser. Consequences of that design, all removed here:
 *   - closing the tab stranded the campaign in `sending` with no way to
 *     resume,
 *   - a 10 000-recipient campaign meant ~1 000 sequential round trips from
 *     a phone,
 *   - the per-user rate limit (5/min) throttled the campaign's own batches,
 *     so most recipients were marked failed by design,
 *   - progress was synthetic and advanced even when nothing sent.
 *
 * `dispatch()` is idempotent per recipient: it only claims rows still
 * `pending`, and `recordRecipientResult` writes conditionally on that same
 * precondition. Calling it twice concurrently cannot double-send.
 */

import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type Page,
  type TenantDb,
} from '../kernel';
import { toInputJson } from '../dtos/common.dto';
import {
  toBroadcastDto,
  toBroadcastRecipientDto,
  type Audience,
  type AudiencePreviewDto,
  type BroadcastDto,
  type BroadcastRecipientDto,
  type BroadcastSendResultDto,
} from '../dtos/broadcast.dto';
import { AudienceRepository } from '../repositories/audience.repository';
import { BroadcastRepository } from '../repositories/broadcast.repository';
import type {
  CreateBroadcastBody,
  ListBroadcastsQuery,
  ListRecipientsQuery,
  UpdateBroadcastBody,
} from '../validators/broadcast.validator';
import {
  assertBroadcastTransition,
  isEditableBroadcastStatus,
  isValidRecipientTransition,
  resolveFinalBroadcastStatus,
} from './broadcast-status';
import type { TemplateService } from './template.service';

/** Per-recipient outcome from the transport. */
export interface BroadcastSendOutcome {
  whatsappMessageId?: string;
  error?: string;
}

export interface BroadcastTransport {
  sendTemplate(input: {
    to: string;
    templateName: string;
    language: string;
    params: string[];
  }): Promise<{ whatsappMessageId: string }>;
}

export interface BroadcastServiceDeps {
  broadcasts: BroadcastRepository;
  audience: AudienceRepository;
  templates: Pick<TemplateService, 'assertSendable'>;
  transport?: BroadcastTransport;
}

/** Preview sample size — enough to sanity-check a segment, small enough to be cheap. */
const PREVIEW_SAMPLE = 5;

/**
 * Hard ceiling on a campaign's audience. A cap that surfaces as a clear
 * error is better than a job that runs for hours and exhausts the tenant's
 * Meta messaging tier.
 */
export const MAX_AUDIENCE_SIZE = 50_000;

export class BroadcastService {
  constructor(
    private readonly deps: BroadcastServiceDeps,
    private readonly userId: string,
  ) {}

  static create(
    db: TenantDb,
    userId: string,
    templates: Pick<TemplateService, 'assertSendable'>,
    transport?: BroadcastTransport,
  ): BroadcastService {
    return new BroadcastService(
      {
        broadcasts: new BroadcastRepository(db),
        audience: new AudienceRepository(db),
        templates,
        transport,
      },
      userId,
    );
  }

  async list(query: ListBroadcastsQuery): Promise<Page<BroadcastDto>> {
    const page = await this.deps.broadcasts.list(
      { status: query.status, search: query.search },
      { page: query.page, pageSize: query.pageSize },
    );
    return { ...page, items: page.items.map(toBroadcastDto) };
  }

  async getById(id: string): Promise<BroadcastDto> {
    return toBroadcastDto(await this.deps.broadcasts.findById(id));
  }

  async previewAudience(audience: Audience): Promise<AudiencePreviewDto> {
    const [reach, beforeExclusions, sample] = await Promise.all([
      this.deps.audience.count(audience),
      this.deps.audience.countBeforeExclusions(audience),
      this.deps.audience.sample(audience, PREVIEW_SAMPLE),
    ]);

    return {
      reach,
      excluded: Math.max(0, beforeExclusions - reach),
      sample: sample.map((contact) => ({
        id: contact.id,
        phone: contact.phone,
        name: contact.name ?? null,
      })),
    };
  }

  /**
   * Creates the campaign and materialises its recipients up front, so the
   * audience is frozen at creation time. Otherwise a contact added between
   * creation and send would silently join a campaign the user already
   * reviewed and approved a reach figure for.
   */
  async create(body: CreateBroadcastBody): Promise<BroadcastDto> {
    // Approval gate: the wizard listed every template regardless of status,
    // so Draft and Rejected templates were selectable and every send failed
    // at Meta with #132001.
    await this.deps.templates.assertSendable(
      body.templateName,
      body.templateLanguage,
      body.templateVariables,
    );

    const reach = await this.deps.audience.count(body.audience);
    if (reach === 0) {
      throw new ValidationError('This audience matches no contacts.', {
        details: { audience: body.audience },
      });
    }
    if (reach > MAX_AUDIENCE_SIZE) {
      throw new ValidationError(
        `This audience matches ${reach.toLocaleString()} contacts, above the ${MAX_AUDIENCE_SIZE.toLocaleString()} per-campaign limit.`,
        { details: { reach, limit: MAX_AUDIENCE_SIZE } },
      );
    }

    const broadcast = await this.deps.broadcasts.create({
      name: body.name,
      templateName: body.templateName,
      templateLanguage: body.templateLanguage,
      templateVariables: toInputJson(toVariableMap(body.templateVariables)),
      audienceFilter: toInputJson(body.audience),
      scheduledAt: body.scheduledAt ?? null,
      status: body.scheduledAt ? 'scheduled' : 'draft',
      userId: this.userId,
    });

    await this.materialiseAudience(broadcast.id, body.audience);

    return toBroadcastDto(await this.deps.broadcasts.findById(broadcast.id));
  }

  /** Streams the audience in keyset-paginated batches — never all at once. */
  private async materialiseAudience(broadcastId: string, audience: Audience): Promise<number> {
    const BATCH = 500;
    let cursor: string | undefined;
    let total = 0;

    for (;;) {
      const { ids, nextCursor } = await this.deps.audience.pageIds(audience, BATCH, cursor);
      if (ids.length === 0) break;
      total += await this.deps.broadcasts.addRecipients(broadcastId, ids);
      if (!nextCursor) break;
      cursor = nextCursor;
    }

    return total;
  }

  async update(id: string, body: UpdateBroadcastBody): Promise<BroadcastDto> {
    const existing = await this.deps.broadcasts.findById(id);
    if (!isEditableBroadcastStatus(existing.status)) {
      throw new ConflictError(`A ${existing.status} campaign can no longer be edited.`, {
        details: { status: existing.status },
      });
    }

    if (body.templateName || body.templateVariables) {
      await this.deps.templates.assertSendable(
        body.templateName ?? existing.templateName,
        body.templateLanguage ?? existing.templateLanguage,
        body.templateVariables ?? [],
      );
    }

    // Changing the audience after creation would leave the already-frozen
    // recipient set inconsistent with the stored filter. Refusing is
    // honest; the user duplicates the campaign instead.
    if (body.audience) {
      throw new ConflictError(
        'The audience is fixed once a campaign is created. Create a new campaign to target a different segment.',
      );
    }

    await this.deps.broadcasts.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.templateName !== undefined ? { templateName: body.templateName } : {}),
      ...(body.templateLanguage !== undefined ? { templateLanguage: body.templateLanguage } : {}),
      ...(body.templateVariables !== undefined
        ? { templateVariables: toInputJson(toVariableMap(body.templateVariables)) }
        : {}),
      ...(body.scheduledAt !== undefined
        ? {
            scheduledAt: body.scheduledAt,
            status: body.scheduledAt ? 'scheduled' : 'draft',
          }
        : {}),
    });

    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.deps.broadcasts.findById(id);
    if (existing.status === 'sending') {
      throw new ConflictError('A campaign cannot be deleted while it is sending.');
    }
    await this.deps.broadcasts.delete(id);
  }

  async listRecipients(id: string, query: ListRecipientsQuery): Promise<Page<BroadcastRecipientDto>> {
    await this.deps.broadcasts.findById(id);
    const page = await this.deps.broadcasts.listRecipients(
      id,
      { page: query.page, pageSize: query.pageSize },
      query.status,
    );
    return { ...page, items: page.items.map(toBroadcastRecipientDto) };
  }

  /**
   * Moves a campaign into `sending`. Guarded by the state machine and by a
   * conditional update, so two callers racing to start the same campaign
   * produce one winner.
   */
  async start(id: string): Promise<BroadcastDto> {
    const existing = await this.deps.broadcasts.findById(id);
    assertBroadcastTransition(existing.status, 'sending');

    await this.deps.templates.assertSendable(
      existing.templateName,
      existing.templateLanguage,
      toVariableArray(existing.templateVariables),
    );

    const claimed = await this.deps.broadcasts.transitionStatus(id, existing.status, 'sending');
    if (!claimed) {
      throw new ConflictError('This campaign was already started by another request.');
    }

    return this.getById(id);
  }

  /**
   * One bounded pass of the sender. Returns `hasMore` so the caller loops
   * or reschedules; the campaign is finalised on the pass that drains the
   * queue.
   */
  async dispatch(id: string, batchSize: number): Promise<BroadcastSendResultDto> {
    const transport = this.deps.transport;
    if (!transport) {
      throw new ValidationError('WhatsApp is not connected for this workspace.');
    }

    const broadcast = await this.deps.broadcasts.findById(id);
    if (broadcast.status !== 'sending') {
      throw new ConflictError(`A ${broadcast.status} campaign is not dispatching.`, {
        details: { status: broadcast.status },
      });
    }

    const params = toVariableArray(broadcast.templateVariables);
    const batch = await this.deps.broadcasts.claimPendingBatch(id, batchSize);

    let sent = 0;
    let failed = 0;

    for (const recipient of batch) {
      const phone = recipient.contact?.phone;

      if (!phone) {
        failed += 1;
        await this.deps.broadcasts.recordRecipientResult({
          broadcastId: id,
          recipientId: recipient.id,
          status: 'failed',
          at: new Date(),
          errorMessage: 'Contact has no phone number.',
        });
        continue;
      }

      try {
        const { whatsappMessageId } = await transport.sendTemplate({
          to: phone,
          templateName: broadcast.templateName,
          language: broadcast.templateLanguage,
          params,
        });
        sent += 1;
        await this.deps.broadcasts.recordRecipientResult({
          broadcastId: id,
          recipientId: recipient.id,
          status: 'sent',
          at: new Date(),
          // Recorded so the delivery webhook can correlate a status callback
          // back to this recipient row.
          whatsappMessageId,
        });
      } catch (error) {
        failed += 1;
        await this.deps.broadcasts.recordRecipientResult({
          broadcastId: id,
          recipientId: recipient.id,
          status: 'failed',
          at: new Date(),
          // Kept verbatim: Meta's per-recipient reasons are the only way a
          // user can tell "invalid number" from "template paused".
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
        });
      }
    }

    const remaining = await this.deps.broadcasts.countPending(id);
    let status = broadcast.status;

    if (remaining === 0) {
      const finalRow = await this.deps.broadcasts.findById(id);
      status = resolveFinalBroadcastStatus({
        total: finalRow.totalRecipients,
        sent: finalRow.sentCount + finalRow.deliveredCount + finalRow.readCount + finalRow.repliedCount,
        failed: finalRow.failedCount,
      });
      await this.deps.broadcasts.transitionStatus(id, 'sending', status);
    }

    return {
      broadcastId: id,
      status: status as BroadcastSendResultDto['status'],
      attempted: batch.length,
      sent,
      failed,
      hasMore: remaining > 0,
    };
  }

  /**
   * Applies a Meta delivery callback to a recipient row, gated by the
   * monotonic ladder so out-of-order webhooks cannot move a row backwards.
   */
  async applyDeliveryStatus(input: {
    recipientId: string;
    broadcastId: string;
    currentStatus: string;
    incomingStatus: 'delivered' | 'read' | 'replied';
    at: Date;
  }): Promise<boolean> {
    if (!isValidRecipientTransition(input.currentStatus, input.incomingStatus)) return false;
    return this.deps.broadcasts.advanceRecipientStatus({
      recipientId: input.recipientId,
      broadcastId: input.broadcastId,
      from: input.currentStatus,
      to: input.incomingStatus,
      at: input.at,
    });
  }

  /**
   * Entry point for the delivery webhook: resolves the recipient from Meta's
   * message id, then applies the ladder. Returns false when the id belongs to
   * no campaign (an ordinary inbox message) or the transition is not forward.
   */
  async applyDeliveryStatusByWhatsappMessageId(input: {
    whatsappMessageId: string;
    incomingStatus: 'delivered' | 'read' | 'replied';
    at: Date;
  }): Promise<boolean> {
    const recipient = await this.deps.broadcasts.findRecipientByWhatsappMessageId(
      input.whatsappMessageId,
    );
    if (!recipient) return false;

    return this.applyDeliveryStatus({
      recipientId: recipient.id,
      broadcastId: recipient.broadcastId,
      currentStatus: recipient.status,
      incomingStatus: input.incomingStatus,
      at: input.at,
    });
  }

  /**
   * Flags that a contact replied to a campaign they received.
   *
   * A reply carries no reference to the campaign message, so it is attributed
   * by recency: the most recent delivered recipient row for this contact
   * inside the attribution window. Bounded deliberately — a reply six weeks
   * after a campaign is not a response to it, and counting it would overstate
   * every campaign's reply rate forever.
   *
   * Nothing recorded this before. The old handler queried
   * `BroadcastRecipient` by `id: <meta wamid>`, which never matched, so
   * `repliedCount` was permanently zero.
   */
  async flagReplyForContact(contactId: string, windowDays = 30): Promise<boolean> {
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const candidates = await this.deps.broadcasts.findRecipientsForContact(contactId, since);
    const recipient = candidates[0];
    if (!recipient) return false;

    return this.applyDeliveryStatus({
      recipientId: recipient.id,
      broadcastId: recipient.broadcastId,
      currentStatus: recipient.status,
      incomingStatus: 'replied',
      at: new Date(),
    });
  }

  /** Campaigns whose schedule has come due, for the dispatch cron. */
  async findDueScheduled(limit = 20): Promise<string[]> {
    const rows = await this.deps.broadcasts.findDueScheduled(new Date(), limit);
    return rows.map((row) => row.id);
  }

  async assertExists(id: string): Promise<void> {
    if (!(await this.deps.broadcasts.findById(id).catch(() => null))) {
      throw new NotFoundError('Campaign');
    }
  }
}

/**
 * Positional array ⇄ the `{ "1": … }` map the column already holds.
 * Preserved rather than migrated so existing rows keep working.
 */
function toVariableMap(values: string[]): Record<string, string> {
  return Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
}

function toVariableArray(stored: unknown): string[] {
  if (stored === null || stored === undefined || typeof stored !== 'object' || Array.isArray(stored)) {
    return [];
  }
  const record = stored as Record<string, unknown>;
  const keys = Object.keys(record)
    .map(Number)
    .filter((key) => Number.isInteger(key) && key >= 1)
    .sort((a, b) => a - b);
  return keys.map((key) => {
    const value = record[String(key)];
    return typeof value === 'string' ? value : '';
  });
}
