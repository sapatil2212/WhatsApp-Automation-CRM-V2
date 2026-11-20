import { describe, expect, it } from 'vitest';

import { nextRunFor, personalize, stepsSchema } from './drip.service';

describe('drip sequences', () => {
  const steps = stepsSchema.parse([
    { kind: 'template', delayHours: 0, templateName: 'welcome', params: ['{{name}}'] },
    { kind: 'text', delayHours: 24, text: 'Hi {{ name }}!' },
  ]);
  it('schedules each step relative to the previous send', () => {
    const t = new Date('2026-11-20T10:00:00Z');
    expect(nextRunFor(steps, 0, t)?.toISOString()).toBe('2026-11-20T10:00:00.000Z');
    expect(nextRunFor(steps, 1, t)?.toISOString()).toBe('2026-11-21T10:00:00.000Z');
    expect(nextRunFor(steps, 2, t)).toBeNull();
  });
  it('personalises with the first name', () => {
    expect(personalize('Hi {{name}}', 'Asha Patil')).toBe('Hi Asha');
    expect(personalize('Hi {{ name }}', null)).toBe('Hi there');
  });
  it('rejects invalid steps', () => {
    expect(stepsSchema.safeParse([]).success).toBe(false);
    expect(stepsSchema.safeParse([{ kind: 'text', delayHours: 1 }]).success).toBe(false);
  });
});
