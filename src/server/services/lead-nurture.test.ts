import { describe, expect, it } from 'vitest';

import { dueNudge, fallbackMessage, isEnabled, isOptOut, withinSendingHours } from './lead-nurture';

const H = 3_600_000;
const at = (hoursAgo: number, now: Date) => new Date(now.getTime() - hoursAgo * H);

describe('lead nurture', () => {
  const now = new Date('2026-11-20T06:00:00Z');
  it('waits for the silence threshold of each step', () => {
    expect(dueNudge({ step: 0, inboundAt: at(2, now), now })).toBeNull();
    expect(dueNudge({ step: 0, inboundAt: at(3.2, now), now })).toBe(0);
    expect(dueNudge({ step: 1, inboundAt: at(9, now), now })).toBeNull();
    expect(dueNudge({ step: 1, inboundAt: at(10.5, now), now })).toBe(1);
    expect(dueNudge({ step: 2, inboundAt: at(21.5, now), now })).toBe(2);
  });
  it('never sends after the 24h window or past the last step', () => {
    expect(dueNudge({ step: 2, inboundAt: at(23.9, now), now })).toBeNull();
    expect(dueNudge({ step: 3, inboundAt: at(5, now), now })).toBeNull();
  });
  it('detects opt-outs without matching normal sentences', () => {
    expect(isOptOut('STOP')).toBe(true);
    expect(isOptOut('Not interested.')).toBe(true);
    expect(isOptOut('please stop by tomorrow at 5')).toBe(false);
    expect(isOptOut(null)).toBe(false);
  });
  it('respects local sending hours', () => {
    expect(withinSendingHours(new Date('2026-11-20T06:00:00Z'), 'Asia/Kolkata')).toBe(true); // 11:30
    expect(withinSendingHours(new Date('2026-11-20T18:30:00Z'), 'Asia/Kolkata')).toBe(false); // 00:00
  });
  it('is on by default and can be disabled per tenant', () => {
    expect(isEnabled(null)).toBe(true);
    expect(isEnabled({ leadNurture: { enabled: false } })).toBe(false);
  });
  it('builds a fallback with the first name', () => {
    expect(fallbackMessage(0, 'Asha Patil', 'City Clinic')).toContain('Hi Asha');
  });
});
