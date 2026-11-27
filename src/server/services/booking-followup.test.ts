import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── mocks for the cross-tenant runner ─────────────────────────────────
const { db, sendTenantText, callLLM } = vi.hoisted(() => ({
  db: {
    conversation: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    tenant: { findMany: vi.fn() },
    message: { findMany: vi.fn() },
    clinic: { findUnique: vi.fn() },
    contact: { findUnique: vi.fn() },
  },
  sendTenantText: vi.fn(async (..._a: unknown[]) => true),
  callLLM: vi.fn(),
}));
vi.mock('../kernel', () => ({ systemDb: db, getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock('./booking-notify', () => ({ sendTenantText }));
vi.mock('@/lib/ai/llm', () => ({ callLLM }));

import { bookingSummary, dueBookingReminder, fallbackReminder, isFollowUpEnabled, runBookingFollowUps } from './booking-followup';
import { advance, isActiveWizard, WIZARD_TTL_MS, type FlowData, type WizardState } from './whatsapp-booking-flow';

const MIN = 60_000;
const H = 60 * MIN;
// 11:30 in India — inside daytime sending hours.
const NOW = new Date('2026-11-27T06:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const STATE: WizardState = {
  flow: 'wizard',
  updatedAt: ago(6 * MIN).getTime(),
  invalid: 0,
  lang: 'en',
  name: 'Swapnil Patil',
  age: '27',
  departmentId: 'dep-opd',
  departmentName: 'OPD',
  doctorId: 'doc-riya',
  doctorName: 'Riya Shah',
  date: '2026-12-01',
  awaiting: 'time',
};

describe('dueBookingReminder', () => {
  it('reminds 5 minutes, 5 hours and 10 hours after the last patient message', () => {
    expect(dueBookingReminder({ sent: 0, inboundAt: ago(4 * MIN), now: NOW })).toBeNull();
    expect(dueBookingReminder({ sent: 0, inboundAt: ago(5 * MIN), now: NOW })).toBe(0);
    expect(dueBookingReminder({ sent: 1, inboundAt: ago(4.9 * H), now: NOW })).toBeNull();
    expect(dueBookingReminder({ sent: 1, inboundAt: ago(5 * H), now: NOW })).toBe(1);
    expect(dueBookingReminder({ sent: 2, inboundAt: ago(10 * H), now: NOW })).toBe(2);
    expect(dueBookingReminder({ sent: 3, inboundAt: ago(12 * H), now: NOW })).toBeNull();
  });

  it('stays inside the 24h WhatsApp window', () => {
    expect(dueBookingReminder({ sent: 2, inboundAt: ago(23.8 * H), now: NOW })).toBeNull();
  });

  it('sends the later reminders only in daytime and never twice within an hour', () => {
    const night = new Date('2026-11-27T20:00:00Z'); // 01:30 IST
    expect(dueBookingReminder({ sent: 0, inboundAt: new Date(night.getTime() - 6 * MIN), now: night })).toBe(0);
    expect(dueBookingReminder({ sent: 1, inboundAt: new Date(night.getTime() - 6 * H), now: night })).toBeNull();
    expect(dueBookingReminder({ sent: 2, inboundAt: ago(10 * H), now: NOW, lastReminderAt: ago(30 * MIN) })).toBeNull();
  });

  it('is on by default and can be turned off per tenant', () => {
    expect(isFollowUpEnabled({})).toBe(true);
    expect(isFollowUpEnabled({ bookingFollowUp: { enabled: false } })).toBe(false);
  });
});

describe('reminder text', () => {
  it('remembers what the patient already chose', () => {
    expect(bookingSummary(STATE)).toBe('OPD with Dr. Riya Shah on Tue, 1 Dec');
    const t = fallbackReminder(0, STATE, 'Care Clinic', false);
    expect(t).toContain('Hi Swapnil');
    expect(t).toContain('OPD with Dr. Riya Shah on Tue, 1 Dec');
    expect(t).toContain('Which time suits you?');
  });
  it('has Hinglish versions and a soft last reminder', () => {
    expect(fallbackReminder(1, STATE, 'Care Clinic', true)).toContain('Kaunsa time theek rahega?');
    expect(fallbackReminder(2, STATE, 'Care Clinic', false)).toContain('no problem at all');
  });
});

describe('runBookingFollowUps', () => {
  const conv = { id: 'conv-1', tenantId: 't-1', userId: 'u-1', contactId: 'c-1', bookingState: STATE, updatedAt: ago(6 * MIN) };
  const chat = [
    { senderType: 'bot', contentType: 'text', contentText: 'Dr. Riya Shah चे Tue, 1 Dec रोजीचे उपलब्ध वेळा: …', createdAt: ago(6 * MIN) },
    { senderType: 'customer', contentType: 'text', contentText: '1 december', createdAt: ago(6.5 * MIN) },
    { senderType: 'bot', contentType: 'text', contentText: 'कोणती date तुमच्यासाठी सोयीची राहील?', createdAt: ago(7 * MIN) },
    { senderType: 'customer', contentType: 'text', contentText: 'opd sathi मला अपॉइंटमेंट पाहिजे आहे', createdAt: ago(8 * MIN) },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    db.conversation.findMany.mockResolvedValue([conv]);
    db.tenant.findMany.mockResolvedValue([{ id: 't-1', name: 'Care Clinic', settings: {} }]);
    db.message.findMany.mockResolvedValue(chat);
    db.clinic.findUnique.mockResolvedValue({ clinicName: 'Care Clinic', aiSettings: { aiEnabled: true } });
    db.contact.findUnique.mockResolvedValue({ phone: '+91 98765 43210' });
    db.conversation.updateMany.mockResolvedValue({ count: 1 });
    callLLM.mockResolvedValue({ success: true, text: 'नमस्कार स्वप्नील 🙂 Dr. Riya Shah यांच्याकडे 1 Dec ची अपॉइंटमेंट पूर्ण करूया का? कोणती वेळ सोयीची आहे?' });
  });

  it('sends the AI-written reminder with the chat history, in the patient language, and records it', async () => {
    const r = await runBookingFollowUps(NOW);
    expect(r).toEqual({ checked: 1, sent: 1 });
    const opts = callLLM.mock.calls[0][1];
    expect(opts.history.length).toBeGreaterThan(2);
    expect(opts.systemPrompt).toContain('Marathi');
    expect(opts.systemPrompt).toContain('OPD with Dr. Riya Shah on Tue, 1 Dec');
    expect(sendTenantText).toHaveBeenCalledWith('t-1', '919876543210', expect.stringContaining('स्वप्नील'), 'c-1');
    const saved = db.conversation.updateMany.mock.calls[0][0];
    expect(saved.where).toEqual({ id: 'conv-1', updatedAt: conv.updatedAt });
    expect(saved.data.bookingState).toMatchObject({ reminders: 1, reminderFor: ago(6.5 * MIN).getTime() });
  });

  it('does nothing when the patient wrote last, or another tick already claimed it', async () => {
    db.message.findMany.mockResolvedValueOnce([{ ...chat[1], createdAt: ago(5.5 * MIN) }, ...chat]);
    expect((await runBookingFollowUps(NOW)).sent).toBe(0);
    db.conversation.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await runBookingFollowUps(NOW)).sent).toBe(0);
    expect(sendTenantText).not.toHaveBeenCalled();
  });

  it('stays out of chats a team member is handling, and when the AI is off', async () => {
    db.message.findMany.mockResolvedValueOnce([chat[0], { senderType: 'agent', contentType: 'text', contentText: 'Hi, Priya here', createdAt: ago(5.8 * MIN) }, ...chat.slice(1)]);
    expect((await runBookingFollowUps(NOW)).sent).toBe(0);
    db.clinic.findUnique.mockResolvedValueOnce({ clinicName: 'Care Clinic', aiSettings: { aiEnabled: false } });
    expect((await runBookingFollowUps(NOW)).sent).toBe(0);
  });

  it('falls back to a static reminder when the AI is down, and gives the slot back if sending fails', async () => {
    callLLM.mockResolvedValue({ success: false, text: '' });
    db.message.findMany.mockResolvedValue([
      { senderType: 'bot', contentType: 'text', contentText: 'Which time suits you?', createdAt: ago(6 * MIN) },
      { senderType: 'customer', contentType: 'text', contentText: 'I want to book with Dr Riya on 1 december', createdAt: ago(7 * MIN) },
    ]);
    sendTenantText.mockResolvedValueOnce(false);
    expect((await runBookingFollowUps(NOW)).sent).toBe(0);
    expect(sendTenantText.mock.calls[0][2]).toContain('Shall we finish your appointment booking?');
    expect(db.conversation.update).toHaveBeenCalledWith({ where: { id: 'conv-1' }, data: { bookingState: STATE } });
  });
});

describe('replying to a reminder', () => {
  const reminded: WizardState = { ...STATE, updatedAt: NOW.getTime() - 6 * H, reminders: 2, remindedAt: NOW.getTime() - H, reminderFor: 1 };
  const flow: FlowData = {
    clinicName: 'Care Clinic',
    contactName: 'Swapnil',
    today: '2026-11-27',
    departments: async () => [{ id: 'dep-opd', name: 'OPD', doctorCount: 1 }],
    doctors: async () => [{ id: 'doc-riya', name: 'Riya Shah', departmentIds: ['dep-opd'], specialization: 'General', qualification: null, experience: null, fee: 300 }],
    availability: async (_d, from, days) =>
      Array.from({ length: days }, (_, i) => {
        const d = new Date(`${from}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        return { date: d.toISOString().slice(0, 10), slots: ['10:00', '11:00'], closedReason: null };
      }),
  };

  it('keeps a reminded booking resumable for the day', () => {
    expect(isActiveWizard({ ...STATE, updatedAt: NOW.getTime() - 2 * WIZARD_TTL_MS }, NOW.getTime())).toBe(false);
    expect(isActiveWizard(reminded, NOW.getTime())).toBe(true);
  });

  it('"yes" re-asks the pending question and ends the reminder cycle', async () => {
    const r = await advance(reminded, 'ho', flow, NOW.getTime());
    expect(r.kind).toBe('reply');
    if (r.kind === 'reply') {
      expect(r.text).toContain('11:00 AM');
      expect(r.state.reminders).toBeUndefined();
    }
  });

  it('"no" stops the booking politely', async () => {
    expect((await advance(reminded, 'नको', flow, NOW.getTime())).kind).toBe('exit');
    expect((await advance(reminded, 'not now', flow, NOW.getTime())).kind).toBe('exit');
  });

  it('a time answer books straight away', async () => {
    const r = await advance(reminded, '11 am', flow, NOW.getTime());
    expect(r.kind).toBe('book');
  });
});
