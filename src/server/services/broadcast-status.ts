/**
 * Broadcast state machines.
 *
 * Two of them, both pure:
 *
 *  - The **recipient ladder** (`pending → sent → delivered → read →
 *    replied`, with `failed` as a terminal branch). Extracted verbatim in
 *    behaviour from `api/whatsapp/webhook/route.ts`, where it sat inline
 *    and untested. It exists because Meta's status callbacks arrive out of
 *    order: a `delivered` webhook can land after `read`, and without a
 *    monotonic guard the recipient row flaps backwards.
 *
 *  - The **campaign lifecycle** (`draft → scheduled → sending → sent |
 *    failed`). Previously unguarded: the client set the final status
 *    directly, so a campaign that sent nothing was still marked `sent`.
 *
 * `src/lib/broadcast-status.ts` keeps the badge colours. This module owns
 * the rules.
 */

import { ConflictError } from '../kernel';

export const RECIPIENT_STATUSES = ['pending', 'sent', 'delivered', 'read', 'replied', 'failed'] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const BROADCAST_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'failed'] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

/** Ordered progress ladder. `failed` is deliberately absent — it branches. */
const LADDER: readonly RecipientStatus[] = ['pending', 'sent', 'delivered', 'read', 'replied'];

function ladderLevel(status: string): number {
  const index = LADDER.indexOf(status as RecipientStatus);
  return index < 0 ? -1 : index;
}

/**
 * Whether a recipient may move from `current` to `incoming`.
 *
 * Rules:
 *  - `failed` is only reachable from `pending` or `sent`. Meta will not
 *    report a failure for a message it already delivered, so a late
 *    `failed` is noise.
 *  - `failed` is terminal.
 *  - Otherwise the ladder is strictly monotonic, which discards Meta's
 *    out-of-order and duplicate callbacks.
 */
export function isValidRecipientTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') return current === 'pending' || current === 'sent';
  if (current === 'failed') return false;

  const incomingLevel = ladderLevel(incoming);
  if (incomingLevel < 0) return false;

  const currentLevel = ladderLevel(current);
  if (currentLevel < 0) return true;

  return incomingLevel > currentLevel;
}

/** Which campaign statuses each status may move to. */
const BROADCAST_TRANSITIONS: Record<BroadcastStatus, readonly BroadcastStatus[]> = {
  draft: ['scheduled', 'sending', 'failed'],
  scheduled: ['sending', 'draft', 'failed'],
  sending: ['sent', 'failed'],
  sent: [],
  failed: [],
};

export function canTransitionBroadcast(current: string, next: BroadcastStatus): boolean {
  const allowed = BROADCAST_TRANSITIONS[current as BroadcastStatus];
  return allowed ? allowed.includes(next) : false;
}

export function assertBroadcastTransition(current: string, next: BroadcastStatus): void {
  if (!canTransitionBroadcast(current, next)) {
    throw new ConflictError(`A ${current} campaign cannot move to ${next}.`, {
      details: { from: current, to: next },
    });
  }
}

/** A campaign in a terminal state can never be edited or re-sent. */
export function isTerminalBroadcastStatus(status: string): boolean {
  return status === 'sent' || status === 'failed';
}

/** Only a draft or scheduled campaign may still be edited. */
export function isEditableBroadcastStatus(status: string): boolean {
  return status === 'draft' || status === 'scheduled';
}

/**
 * Final status once every recipient has been attempted.
 *
 * `failed` only when nothing at all got out. A partial failure is still a
 * campaign that reached people, and the per-recipient report carries the
 * detail. The old client computed `failedCount === totalRecipients` — same
 * intent, but it ran against counters that were never populated, so a
 * campaign that sent zero messages reported `sent`.
 */
export function resolveFinalBroadcastStatus(counts: { total: number; sent: number; failed: number }): BroadcastStatus {
  if (counts.total === 0) return 'failed';
  if (counts.sent === 0) return 'failed';
  return 'sent';
}
