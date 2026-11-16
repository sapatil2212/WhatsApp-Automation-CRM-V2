import { describe, expect, it } from 'vitest';

import { ConflictError } from '../kernel';
import {
  assertBroadcastTransition,
  canTransitionBroadcast,
  isEditableBroadcastStatus,
  isTerminalBroadcastStatus,
  isValidRecipientTransition,
  resolveFinalBroadcastStatus,
} from './broadcast-status';

describe('isValidRecipientTransition', () => {
  it('advances up the ladder', () => {
    expect(isValidRecipientTransition('pending', 'sent')).toBe(true);
    expect(isValidRecipientTransition('sent', 'delivered')).toBe(true);
    expect(isValidRecipientTransition('delivered', 'read')).toBe(true);
    expect(isValidRecipientTransition('read', 'replied')).toBe(true);
  });

  it('allows skipping a rung, because Meta may omit one', () => {
    expect(isValidRecipientTransition('sent', 'read')).toBe(true);
    expect(isValidRecipientTransition('pending', 'replied')).toBe(true);
  });

  it('refuses to move backwards, discarding out-of-order webhooks', () => {
    expect(isValidRecipientTransition('read', 'delivered')).toBe(false);
    expect(isValidRecipientTransition('delivered', 'sent')).toBe(false);
    expect(isValidRecipientTransition('replied', 'read')).toBe(false);
  });

  it('refuses a repeat of the same status, discarding duplicate webhooks', () => {
    expect(isValidRecipientTransition('delivered', 'delivered')).toBe(false);
  });

  it('allows failure only before delivery', () => {
    expect(isValidRecipientTransition('pending', 'failed')).toBe(true);
    expect(isValidRecipientTransition('sent', 'failed')).toBe(true);
    expect(isValidRecipientTransition('delivered', 'failed')).toBe(false);
    expect(isValidRecipientTransition('read', 'failed')).toBe(false);
  });

  it('treats failure as terminal', () => {
    expect(isValidRecipientTransition('failed', 'sent')).toBe(false);
    expect(isValidRecipientTransition('failed', 'delivered')).toBe(false);
    expect(isValidRecipientTransition('failed', 'failed')).toBe(false);
  });

  it('rejects an unrecognised incoming status', () => {
    expect(isValidRecipientTransition('sent', 'exploded')).toBe(false);
  });

  it('accepts any ladder status from an unrecognised current status', () => {
    // Legacy rows may hold something outside the ladder; letting them
    // rejoin is preferable to freezing them forever.
    expect(isValidRecipientTransition('legacy_value', 'delivered')).toBe(true);
  });
});

describe('canTransitionBroadcast', () => {
  it('allows a draft to be scheduled or started', () => {
    expect(canTransitionBroadcast('draft', 'scheduled')).toBe(true);
    expect(canTransitionBroadcast('draft', 'sending')).toBe(true);
  });

  it('allows a scheduled campaign to start or revert to draft', () => {
    expect(canTransitionBroadcast('scheduled', 'sending')).toBe(true);
    expect(canTransitionBroadcast('scheduled', 'draft')).toBe(true);
  });

  it('only allows a sending campaign to finish', () => {
    expect(canTransitionBroadcast('sending', 'sent')).toBe(true);
    expect(canTransitionBroadcast('sending', 'failed')).toBe(true);
    expect(canTransitionBroadcast('sending', 'draft')).toBe(false);
    expect(canTransitionBroadcast('sending', 'scheduled')).toBe(false);
  });

  it('treats sent and failed as terminal, so a campaign cannot be re-sent', () => {
    expect(canTransitionBroadcast('sent', 'sending')).toBe(false);
    expect(canTransitionBroadcast('failed', 'sending')).toBe(false);
    expect(isTerminalBroadcastStatus('sent')).toBe(true);
    expect(isTerminalBroadcastStatus('failed')).toBe(true);
    expect(isTerminalBroadcastStatus('draft')).toBe(false);
  });

  it('rejects an unknown current status', () => {
    expect(canTransitionBroadcast('paused', 'sending')).toBe(false);
  });
});

describe('assertBroadcastTransition', () => {
  it('throws a 409 with both states named', () => {
    expect(() => assertBroadcastTransition('sent', 'sending')).toThrow(ConflictError);
    try {
      assertBroadcastTransition('sent', 'sending');
    } catch (error) {
      expect((error as ConflictError).details).toEqual({ from: 'sent', to: 'sending' });
    }
  });

  it('passes a legal transition', () => {
    expect(() => assertBroadcastTransition('draft', 'sending')).not.toThrow();
  });
});

describe('isEditableBroadcastStatus', () => {
  it('permits editing only before dispatch', () => {
    expect(isEditableBroadcastStatus('draft')).toBe(true);
    expect(isEditableBroadcastStatus('scheduled')).toBe(true);
    expect(isEditableBroadcastStatus('sending')).toBe(false);
    expect(isEditableBroadcastStatus('sent')).toBe(false);
  });
});

describe('resolveFinalBroadcastStatus', () => {
  it('marks a fully successful campaign sent', () => {
    expect(resolveFinalBroadcastStatus({ total: 10, sent: 10, failed: 0 })).toBe('sent');
  });

  it('marks a partially successful campaign sent, because it did reach people', () => {
    expect(resolveFinalBroadcastStatus({ total: 10, sent: 7, failed: 3 })).toBe('sent');
  });

  it('marks a campaign that reached nobody failed', () => {
    expect(resolveFinalBroadcastStatus({ total: 10, sent: 0, failed: 10 })).toBe('failed');
  });

  it('marks an empty campaign failed rather than reporting success — the old bug', () => {
    expect(resolveFinalBroadcastStatus({ total: 0, sent: 0, failed: 0 })).toBe('failed');
  });
});
