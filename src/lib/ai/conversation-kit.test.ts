import { describe, expect, it } from 'vitest';
import { buildMemory, declinesHuman, humanIsActive, wantsHuman } from './conversation-kit';

const at = (min: number) => new Date(Date.UTC(2026, 10, 26, 17, 0) + min * 60_000);

describe('wantsHuman / declinesHuman', () => {
  it('detects explicit requests for a person in several languages', () => {
    for (const t of ['I want to talk to a human', 'connect me to your staff', 'kisi insaan se baat karao', 'मला माणसाशी बोलायचे आहे', 'call me please, customer care']) {
      expect(wantsHuman(t)).toBe(true);
    }
  });

  it('does not treat ordinary replies or refusals as a request', () => {
    for (const t of ['No', 'Ok', 'No need to transfer', 'agent ki zarurat nahi', 'Clinic ka address bhejo', 'I need to book appointment', 'doctor available?']) {
      expect(wantsHuman(t)).toBe(false);
    }
  });

  it('recognises a customer declining a transfer', () => {
    expect(declinesHuman('No need to transfer')).toBe(true);
    expect(declinesHuman("don't connect me to anyone")).toBe(true);
    expect(declinesHuman('transfer nako')).toBe(true);
    expect(declinesHuman('Ok')).toBe(false);
  });
});

describe('buildMemory', () => {
  const msgs = [
    { senderType: 'customer', contentText: 'Hi need to book appointment', createdAt: at(49) },
    { senderType: 'bot', contentText: "Sure! Could you please tell me the patient's name and age?", createdAt: at(49.5) },
    { senderType: 'customer', contentText: 'रुग्णाचे नाव स्वप्नील पाटील आणि वय २७', createdAt: at(50) },
    { senderType: 'bot', contentText: 'कोणत्या विभागात अपॉइंटमेंट हवी आहे?', createdAt: at(50.5) },
    { senderType: 'customer', contentText: 'Cancel karo', createdAt: at(51) },
  ];

  it('turns the stored chat into alternating turns without the message being answered', () => {
    const m = buildMemory([...msgs].reverse(), 'Cancel karo');
    expect(m.history.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(m.history[0].content).toBe('Hi need to book appointment');
    expect(m.history.at(-1)?.content).toContain('विभागात');
  });

  it('remembers the customer language for short replies', () => {
    const m = buildMemory([...msgs.slice(0, 4), { senderType: 'customer', contentText: '2', createdAt: at(52) }], '2');
    expect(m.language.code).toBe('mr');
  });

  it('labels team replies and reports when the team last wrote', () => {
    const m = buildMemory([...msgs, { senderType: 'agent', contentText: 'Hello, this is Priya from the clinic', createdAt: at(53) }, { senderType: 'customer', contentText: 'ok', createdAt: at(54) }], 'ok');
    expect(m.history.at(-1)?.content).toMatch(/^\[Team member replied\]/);
    expect(m.lastAgentAt?.toISOString()).toBe(at(53).toISOString());
    expect(humanIsActive(m, at(60).getTime())).toBe(true);
    expect(humanIsActive(m, at(53).getTime() + 31 * 60_000)).toBe(false);
  });

  it('describes media and drops a media-only current message', () => {
    const m = buildMemory(
      [
        { senderType: 'customer', contentType: 'image', contentText: null, createdAt: at(40) },
        { senderType: 'bot', contentText: 'Thanks!', createdAt: at(41) },
        { senderType: 'customer', contentType: 'audio', contentText: null, createdAt: at(42) },
      ],
      '[Voice note transcript] mala appointment pahije',
    );
    expect(m.history).toEqual([
      { role: 'user', content: '[sent a photo]' },
      { role: 'assistant', content: 'Thanks!' },
    ]);
  });
});
