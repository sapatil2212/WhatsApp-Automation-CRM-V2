/**
 * Three-layer reply context for inbound WhatsApp messages.
 *
 *   1. Meta ads   — the customer arrived from a Click-to-WhatsApp ad (Meta
 *                   sends a `referral` on the first message; we keep a
 *                   "[Meta Ad]" note so follow-ups keep the context).
 *   2. Campaign   — the customer recently received one of our broadcasts
 *                   (or tapped one of its buttons / quoted it), so the reply
 *                   is almost certainly about that campaign.
 *   3. General    — everything else: intent detection on the message alone.
 *
 * Priority: an explicit reply to a campaign message wins, then an ad
 * referral, then a recent campaign, then general. The result is a prompt
 * block the AI responders append to their system prompt.
 */

import { prisma } from '@/lib/prisma';
import { fromStoredVariables, resolveMapping, renderBody } from '@/lib/campaigns/personalization';

export type ReplyLayer = 'meta_ad' | 'campaign' | 'general';

export interface AdReferral {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  ctwa_clid?: string;
}

export interface ReplyContext {
  layer: ReplyLayer;
  /** Short human label, e.g. "Campaign: Diwali Sale". */
  label: string;
  /** Instructions + facts appended to the AI system prompt. */
  promptBlock: string;
}

const CAMPAIGN_WINDOW_DAYS = 7;
const AD_WINDOW_DAYS = 14;
export const META_AD_NOTE_PREFIX = '[Meta Ad]';

export function adNoteText(r: AdReferral): string {
  return [
    META_AD_NOTE_PREFIX,
    r.headline ? `Headline: ${r.headline}` : '',
    r.body ? `Ad text: ${r.body}` : '',
    r.source_url ? `Link: ${r.source_url}` : '',
    r.source_id ? `Ad ID: ${r.source_id}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
}

function parseAdNote(text: string): AdReferral {
  const get = (label: string) => text.match(new RegExp(`^${label}: (.*)$`, 'm'))?.[1]?.trim();
  return { headline: get('Headline'), body: get('Ad text'), source_url: get('Link'), source_id: get('Ad ID') };
}

function adBlock(r: AdReferral, firstTouch: boolean): string {
  return `### CONVERSATION CONTEXT — META ADS LEAD
This customer ${firstTouch ? 'just tapped' : 'recently came from'} our Click-to-WhatsApp advertisement:
- Ad headline: ${r.headline || '(not provided)'}
- Ad text: ${r.body || '(not provided)'}
- Ad link: ${r.source_url || '(none)'}

PLAYBOOK FOR AD LEADS:
- They saw this specific ad — connect your answer to its offer/product first; never ask "how can I help?" generically.
- ${firstTouch ? 'Welcome them warmly, confirm what the ad offered, and answer their message.' : 'Continue the conversation; do not re-introduce yourself.'}
- Qualify naturally (need, preference, timeline, name if unknown) one question at a time.
- Move them to the next step: booking, price/quote, visit, or purchase link from the business details. Keep it short and specific.
- Do not invent ad terms (prices, discounts, deadlines) that are not stated above or in the business knowledge.`;
}

export async function resolveReplyContext(input: {
  tenantId: string;
  contactId: string;
  referral?: AdReferral | null;
  /** Meta id of the message the customer replied to / quoted. */
  contextWhatsappMessageId?: string | null;
  /** True when the customer tapped a template quick-reply button. */
  isButtonReply?: boolean;
}): Promise<ReplyContext> {
  const { tenantId, contactId } = input;
  const since = new Date(Date.now() - CAMPAIGN_WINDOW_DAYS * 86_400_000);

  const [recipient, quoted] = await Promise.all([
    prisma.broadcastRecipient
      .findFirst({
        where: {
          contactId,
          status: { in: ['sent', 'delivered', 'read', 'replied'] },
          sentAt: { gte: since },
          broadcast: { tenantId },
        },
        orderBy: { sentAt: 'desc' },
        select: {
          sentAt: true,
          whatsappMessageId: true,
          broadcast: { select: { name: true, templateName: true, templateLanguage: true, templateVariables: true } },
        },
      })
      .catch(() => null),
    input.contextWhatsappMessageId
      ? prisma.broadcastRecipient
          .findFirst({
            where: { whatsappMessageId: input.contextWhatsappMessageId, contactId, broadcast: { tenantId } },
            select: {
              sentAt: true,
              whatsappMessageId: true,
              broadcast: { select: { name: true, templateName: true, templateLanguage: true, templateVariables: true } },
            },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  // 1. An explicit reply to a campaign message (quoted or button tap) is the strongest signal.
  const explicitCampaign = quoted ?? (input.isButtonReply ? recipient : null);
  if (explicitCampaign) return campaignContext(tenantId, contactId, explicitCampaign, true);

  // 2. Meta ad referral on this message, or a recent ad note for follow-ups.
  if (input.referral && (input.referral.headline || input.referral.body || input.referral.source_id)) {
    return { layer: 'meta_ad', label: `Meta ad: ${input.referral.headline || input.referral.source_id || 'ad'}`, promptBlock: adBlock(input.referral, true) };
  }
  const adNote = await prisma.contactNote
    .findFirst({
      where: { contactId, noteText: { startsWith: META_AD_NOTE_PREFIX }, createdAt: { gte: new Date(Date.now() - AD_WINDOW_DAYS * 86_400_000) } },
      orderBy: { createdAt: 'desc' },
      select: { noteText: true, createdAt: true },
    })
    .catch(() => null);

  // 3. A recent campaign — unless the ad touch is more recent.
  if (recipient && (!adNote || (recipient.sentAt && recipient.sentAt > adNote.createdAt))) {
    return campaignContext(tenantId, contactId, recipient, false);
  }
  if (adNote) {
    const r = parseAdNote(adNote.noteText);
    return { layer: 'meta_ad', label: `Meta ad: ${r.headline || 'ad lead'}`, promptBlock: adBlock(r, false) };
  }

  return { layer: 'general', label: 'General enquiry', promptBlock: GENERAL_BLOCK };
}

const GENERAL_BLOCK = `### CONVERSATION CONTEXT — GENERAL ENQUIRY
No campaign or ad is linked to this customer right now. Work out what they want from their message and the conversation history, then answer it directly using the business details.`;

async function campaignContext(
  tenantId: string,
  contactId: string,
  recipient: {
    sentAt: Date | null;
    broadcast: { name: string; templateName: string; templateLanguage: string; templateVariables: unknown };
  },
  explicit: boolean,
): Promise<ReplyContext> {
  const { broadcast } = recipient;
  const [template, contact] = await Promise.all([
    prisma.messageTemplate
      .findFirst({
        where: { tenantId, name: broadcast.templateName, language: broadcast.templateLanguage },
        select: { bodyText: true, headerType: true, headerContent: true, footerText: true, buttons: true, category: true },
      })
      .catch(() => null),
    prisma.contact
      .findFirst({
        where: { id: contactId, tenantId },
        select: { name: true, phone: true, email: true, company: true, customValues: { select: { customFieldId: true, value: true } } },
      })
      .catch(() => null),
  ]);

  const personalization = fromStoredVariables(broadcast.templateVariables);
  const contactData = {
    name: contact?.name,
    phone: contact?.phone,
    email: contact?.email,
    company: contact?.company,
    custom: Object.fromEntries((contact?.customValues ?? []).map((v) => [v.customFieldId, v.value])),
  };
  const buttons = Array.isArray(template?.buttons) ? (template!.buttons as Array<{ type?: string; text?: string; url?: string }>) : [];
  const sentMessage = template
    ? [
        template.headerType === 'text' && template.headerContent
          ? template.headerContent.replace(/\{\{\s*1\s*\}\}/, resolveMapping(personalization.header_1, contactData) || '')
          : '',
        renderBody({ bodyText: template.bodyText, headerType: template.headerType, headerContent: template.headerContent, buttons }, personalization, contactData),
        template.footerText ?? '',
        buttons.length ? `Buttons: ${buttons.map((b) => `${b.text}${b.url ? ` (${b.url})` : ''}`).join(' | ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : `(template "${broadcast.templateName}")`;

  const when = recipient.sentAt ? recipient.sentAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'recently';
  return {
    layer: 'campaign',
    label: `Campaign: ${broadcast.name}`,
    promptBlock: `### CONVERSATION CONTEXT — CAMPAIGN RESPONSE
${explicit ? 'The customer is replying directly to' : 'The customer recently received'} our WhatsApp campaign "${broadcast.name}" (sent ${when}). This is exactly what they received:
"""
${sentMessage.slice(0, 1500)}
"""

PLAYBOOK FOR CAMPAIGN REPLIES:
- Assume their message is about this campaign unless it is clearly about something else. If they tapped a button, act on that button's intent.
- Use the campaign's own details (offer, dates, codes, links) as ground truth; combine them with the business knowledge for anything else. Never contradict or extend the offer terms.
- Make it easy to act: give the next step (link, booking, price, how to claim) in one or two short messages.
- If they are not interested or ask to stop, acknowledge politely and do not push.`,
  };
}
