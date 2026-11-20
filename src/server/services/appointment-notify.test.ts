import { describe, expect, it, vi } from 'vitest';

import {
  detectVertical,
  libraryFor,
  lintUtilityBody,
  mapVariables,
  versionedName,
  VERTICALS,
} from '@/lib/whatsapp/appointment-template-library';
import { appointmentValues, deliverAppointmentMessage, isTransient, type DeliverDeps, type DeliverInput } from './appointment-notify';
import { dueStep, eventForStep } from './appointment-lifecycle';
import { pickActive, readReminderSettings } from './utility-template.service';

// ── library ──────────────────────────────────────────────────────────

describe('template library', () => {
  it.each(VERTICALS)('%s: lifecycle templates that pass the utility checks', (v) => {
    const lib = libraryFor(v);
    const healthcare = ['clinic', 'dental', 'hospital'].includes(v);
    expect(lib.map((t) => t.key)).toEqual([
      'appointment_confirmation',
      ...(healthcare ? ['appointment_token_confirmation'] : []),
      'appointment_reminder', 'appointment_cancelled', 'appointment_rescheduled', 'appointment_completed',
      ...(healthcare ? ['patient_prescription_delivery'] : []),
    ]);
    for (const t of lib) {
      expect(t.category).toBe('Utility');
      expect(lintUtilityBody(t.bodyText, t.variables)).toEqual([]);
      expect(t.variables.every((x) => x.example.length > 0)).toBe(true);
    }
  });

  it('uses vertical wording', () => {
    expect(libraryFor('gym')[0].bodyText).toContain('Your session at');
    expect(libraryFor('hotel')[0].bodyText).toContain('Your reservation at');
    expect(libraryFor('clinic').find((t) => t.event === 'reminder')!.bodyText).toContain('Consultation: {{5}}');
  });

  it.each([
    [{ hasClinic: true, clinicType: 'Dental Clinic' }, 'dental'],
    [{ hasClinic: true, clinicType: null }, 'clinic'],
    [{ hasClinic: true, clinicType: 'Multi-speciality hospital' }, 'hospital'],
    [{ hasClinic: false, businessType: 'gym' }, 'gym'],
    [{ hasClinic: false, businessType: 'Fitness Studio' }, 'gym'],
    [{ hasClinic: false, businessType: 'beauty_salon' }, 'salon'],
    [{ hasClinic: false, businessType: 'Resort & Spa hotel' }, 'salon'],
    [{ hasClinic: false, businessType: 'hotel' }, 'hotel'],
    [{ hasClinic: false, businessType: 'law firm' }, 'other'],
    [{ hasClinic: false, businessType: 'wellness', name: 'Get Fit Gym & Wellness Center' }, 'gym'],
  ] as const)('detects %o → %s', (input, expected) => {
    expect(detectVertical(input)).toBe(expected);
  });

  it('flags non-compliant bodies', () => {
    const v = libraryFor('clinic')[0].variables;
    expect(lintUtilityBody('{{1}} your appointment is confirmed at {{2}} on {{3}} {{4}} with {{5}} today.', v).join(' ')).toContain('cannot start');
    expect(lintUtilityBody('Hello {{1}}, get 20% off your next visit at {{2}} on {{3}} at {{4}} with {{5}}.', v).join(' ')).toContain('promotional');
    expect(lintUtilityBody('Hello {{1}} {{2}}, see you on {{3}} at {{4}} with {{5}} soon.', v).join(' ')).toContain('next to each other');
    expect(lintUtilityBody('Hello {{1}}, see you at {{2}} on {{3}} at {{4}}.', v).join(' ')).toContain('4 variable(s) but 5');
  });

  it('maps variables with fallbacks and strips newlines', () => {
    const v = libraryFor('clinic')[0].variables;
    expect(mapVariables(v, { customer_name: 'Riya\nShah', business_name: 'BrightSmile', appointment_date: '', appointment_time: '10:30 AM', service_name: null })).toEqual([
      'Riya Shah', 'BrightSmile', 'the scheduled date', '10:30 AM', 'appointment',
    ]);
  });

  it('versions names', () => {
    expect(versionedName('appointment_reminder', 1)).toBe('appointment_reminder');
    expect(versionedName('appointment_reminder', 3)).toBe('appointment_reminder_v3');
  });
});

// ── active version selection ─────────────────────────────────────────

describe('pickActive', () => {
  const row = (over: Partial<{ id: string; status: string; isEnabled: boolean; version: number }>) => ({ id: 'x', eventType: 'reminder', status: 'Approved', isEnabled: true, version: 1, language: 'en_US', ...over });
  it('uses the newest approved + enabled version', () => {
    expect(pickActive([row({ id: 'v1' }), row({ id: 'v2', version: 2 })], 'reminder')?.id).toBe('v2');
  });
  it('keeps the old approved version while the edit is pending (edit needs new approval)', () => {
    expect(pickActive([row({ id: 'v1' }), row({ id: 'v2', version: 2, status: 'Pending' })], 'reminder')?.id).toBe('v1');
  });
  it('never uses drafts, rejected or disabled templates', () => {
    expect(pickActive([row({ status: 'Draft' }), row({ status: 'Rejected' }), row({ isEnabled: false })], 'reminder')).toBeNull();
  });
});

// ── delivery engine ──────────────────────────────────────────────────

const APPROVED = { id: 't1', name: 'appointment_reminder', language: 'en_US', status: 'Approved', isEnabled: true, version: 1, eventType: 'reminder', variables: libraryFor('clinic').find((t) => t.event === 'reminder')!.variables, bodyText: libraryFor('clinic').find((t) => t.event === 'reminder')!.bodyText };

function harness(over: Partial<DeliverDeps> = {}) {
  const calls = { text: [] as unknown[], template: [] as Array<{ tenantId: string; input: unknown }>, finish: [] as Array<Record<string, unknown>>, alerts: [] as unknown[], find: [] as unknown[] };
  const deps: DeliverDeps = {
    windowOpen: async () => false,
    sendText: async (...a) => (calls.text.push(a), true),
    findTemplates: async (tenantId, event) => (calls.find.push([tenantId, event]), [APPROVED]),
    sendTemplate: async (tenantId, input) => (calls.template.push({ tenantId, input }), { whatsappMessageId: 'wamid.1' }),
    claim: async () => ({ id: 'log1' }),
    finish: async (_id, data) => void calls.finish.push(data),
    recordInInbox: async () => undefined,
    alertTenant: (...a) => void calls.alerts.push(a),
    sleep: async () => undefined,
    ...over,
  };
  return { deps, calls };
}

const input = (deps: DeliverDeps, over: Partial<DeliverInput> = {}): DeliverInput => ({
  tenantId: 'tenant-A',
  appointmentId: 'appt-1',
  contactId: 'c1',
  phone: '919876543210',
  consent: true,
  event: 'reminder',
  eventKey: 'r_1d@2026-11-20 10:30',
  text: 'Reminder text',
  values: appointmentValues({ patientName: 'Riya', businessName: 'BrightSmile', date: '2026-11-20', time: '10:30', doctorName: 'Ana Rao', department: 'Dentist', ref: 'APT-1' }),
  deps,
  ...over,
});

describe('token confirmation (healthcare)', () => {
  const tokenTpl = libraryFor('clinic').find((t) => t.event === 'token_confirmation')!;
  const TOKEN = { ...APPROVED, id: 't-token', name: 'appointment_token_confirmation', eventType: 'token_confirmation', variables: tokenTpl.variables, bodyText: tokenTpl.bodyText };
  const CONF = { ...APPROVED, id: 't-conf', name: 'appointment_confirmation', eventType: 'confirmation', variables: libraryFor('clinic')[0].variables, bodyText: libraryFor('clinic')[0].bodyText };
  const values = appointmentValues({ patientName: 'Riya', businessName: 'BrightSmile', date: '2026-11-20', time: '10:30', doctorName: 'Ana Rao', department: 'Dentist', ref: 'APT-261120-AB12C', token: 7 });
  const byEvent = (rows: Record<string, unknown[]>) => async (_t: string, e: string) => (rows[e] ?? []) as never;

  it('is a healthcare-only template with token and booking ID', () => {
    expect(tokenTpl.bodyText).toContain('Token number: {{3}}');
    expect(tokenTpl.bodyText).toContain('Booking ID: {{4}}');
    expect(libraryFor('gym').some((t) => t.event === 'token_confirmation')).toBe(false);
  });

  it('confirmations with a token use the token template when it is approved', async () => {
    const { deps, calls } = harness({ findTemplates: byEvent({ token_confirmation: [TOKEN], confirmation: [CONF] }) });
    await deliverAppointmentMessage(input(deps, { event: 'confirmation', eventKey: 'confirmation@x', values }));
    expect(calls.template[0].input).toMatchObject({
      templateName: 'appointment_token_confirmation',
      params: ['Riya', 'BrightSmile', '7', 'APT-261120-AB12C', expect.stringMatching(/20 Nov/), '10:30 AM', 'Dr. Ana Rao (Dentist)'],
    });
  });

  it('falls back to the standard confirmation while the token template is not approved', async () => {
    const { deps, calls } = harness({ findTemplates: byEvent({ token_confirmation: [{ ...TOKEN, status: 'Pending' }], confirmation: [CONF] }) });
    await deliverAppointmentMessage(input(deps, { event: 'confirmation', eventKey: 'confirmation@x', values }));
    expect((calls.template[0].input as { templateName: string }).templateName).toBe('appointment_confirmation');
  });

  it('without a token number the standard confirmation is used', async () => {
    const { deps, calls } = harness({ findTemplates: byEvent({ token_confirmation: [TOKEN], confirmation: [CONF] }) });
    await deliverAppointmentMessage(input(deps, { event: 'confirmation', eventKey: 'confirmation@x', values: { ...values, token_number: undefined } }));
    expect((calls.template[0].input as { templateName: string }).templateName).toBe('appointment_confirmation');
  });
});

describe('deliverAppointmentMessage', () => {
  it('inside the 24h window sends the normal text', async () => {
    const { deps, calls } = harness({ windowOpen: async () => true });
    const r = await deliverAppointmentMessage(input(deps));
    expect(r).toMatchObject({ status: 'sent', channel: 'text' });
    expect(calls.template).toHaveLength(0);
  });

  it('outside the window sends the approved utility template with mapped variables', async () => {
    const { deps, calls } = harness();
    const r = await deliverAppointmentMessage(input(deps));
    expect(r).toMatchObject({ status: 'sent', channel: 'template', messageId: 'wamid.1' });
    expect(calls.template[0]).toEqual({
      tenantId: 'tenant-A',
      input: { to: '919876543210', templateName: 'appointment_reminder', language: 'en_US', params: ['Riya', 'BrightSmile', expect.stringMatching(/^Fri, 20 Nov,? 2026$/), '10:30 AM', 'Dr. Ana Rao (Dentist)'] },
    });
    expect(calls.finish.at(-1)).toMatchObject({ status: 'sent', channel: 'template', templateVersion: 1 });
  });

  it('falls back to the template when the text fails at the window edge', async () => {
    const { deps, calls } = harness({ windowOpen: async () => true, sendText: async () => false });
    expect((await deliverAppointmentMessage(input(deps))).channel).toBe('template');
    expect(calls.template).toHaveLength(1);
  });

  it('without an approved template it blocks, logs and alerts the tenant — never sends free text', async () => {
    const { deps, calls } = harness({ findTemplates: async () => [{ ...APPROVED, status: 'Pending' }] });
    const r = await deliverAppointmentMessage(input(deps));
    expect(r.status).toBe('blocked_no_template');
    expect(calls.text).toHaveLength(0);
    expect(calls.template).toHaveLength(0);
    expect(calls.alerts).toEqual([['tenant-A', 'reminder']]);
  });

  it('skips without consent or a valid number', async () => {
    const { deps, calls } = harness();
    expect((await deliverAppointmentMessage(input(deps, { consent: false }))).status).toBe('skipped_no_consent');
    expect((await deliverAppointmentMessage(input(deps, { phone: '123' }))).status).toBe('skipped_no_consent');
    expect(calls.template).toHaveLength(0);
  });

  it('is idempotent: an already-claimed event key sends nothing', async () => {
    const { deps, calls } = harness({ claim: async () => null });
    expect((await deliverAppointmentMessage(input(deps))).status).toBe('duplicate');
    expect(calls.template).toHaveLength(0);
  });

  it('retries temporary Meta failures, then succeeds', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('Meta API error (#131000) Something went wrong')).mockResolvedValueOnce({ whatsappMessageId: 'wamid.2' });
    const { deps } = harness({ sendTemplate: send });
    const r = await deliverAppointmentMessage(input(deps));
    expect(r).toMatchObject({ status: 'sent', messageId: 'wamid.2' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not retry permanent failures and logs them', async () => {
    const send = vi.fn().mockRejectedValue(new Error('(#132001) Template name does not exist in the translation'));
    const { deps, calls } = harness({ sendTemplate: send });
    const r = await deliverAppointmentMessage(input(deps));
    expect(r.status).toBe('failed');
    expect(send).toHaveBeenCalledTimes(1);
    expect(calls.finish.at(-1)).toMatchObject({ status: 'failed' });
  });

  it('keeps tenants isolated: templates and the WABA are resolved for the same tenant', async () => {
    const { deps, calls } = harness();
    await deliverAppointmentMessage(input(deps, { tenantId: 'tenant-B' }));
    expect(calls.find[0]).toEqual(['tenant-B', 'reminder']);
    expect(calls.template[0].tenantId).toBe('tenant-B');
  });

  it('follow-ups outside the window are skipped (no utility template exists for them)', async () => {
    const { deps, calls } = harness();
    expect((await deliverAppointmentMessage(input(deps, { event: 'followup' }))).status).toBe('skipped_window');
    expect(calls.template).toHaveLength(0);
  });

  it('classifies transient errors', () => {
    expect(isTransient('fetch failed')).toBe(true);
    expect(isTransient('Request timed out')).toBe(true);
    expect(isTransient('(#130429) Rate limit hit')).toBe(true);
    expect(isTransient('(#132001) Template does not exist')).toBe(false);
  });
});

// ── scheduling ───────────────────────────────────────────────────────

describe('reminder scheduling', () => {
  const H = 3_600_000;
  const at = new Date('2026-11-20T10:00:00Z');
  const base = { status: 'scheduled', at, createdAt: new Date(at.getTime() - 3 * 24 * H), updatedAt: new Date(at.getTime() - 3 * 24 * H), sent: { confirmation: 'x' } };

  it('sends the 30-minute reminder only when enabled', () => {
    const now = new Date(at.getTime() - 25 * 60_000);
    expect(dueStep({ ...base, now, sent: { ...base.sent, r_1h: 'x' } })).toBeNull();
    expect(dueStep({ ...base, now, sent: { ...base.sent, r_1h: 'x' }, reminders: { r_30m: true } })).toBe('r_30m');
  });

  it('respects disabled intervals', () => {
    expect(dueStep({ ...base, now: new Date(at.getTime() - 23 * H), reminders: { r_1d: false } })).toBeNull();
    expect(dueStep({ ...base, now: new Date(at.getTime() - 2 * H), reminders: { r_2h: false } })).toBeNull();
  });

  it('maps steps to template events', () => {
    expect(eventForStep('r_1d')).toBe('reminder');
    expect(eventForStep('r_30m')).toBe('reminder');
    expect(eventForStep('confirmation')).toBe('confirmation');
    expect(eventForStep('completed')).toBe('completed');
    expect(eventForStep('health_2d')).toBe('followup');
  });

  it('reads reminder settings with defaults', () => {
    expect(readReminderSettings(null)).toEqual({ r_1d: true, r_2h: true, r_1h: true, r_30m: false });
    expect(readReminderSettings({ appointmentReminders: { r_30m: true, r_1h: false } })).toEqual({ r_1d: true, r_2h: true, r_1h: false, r_30m: true });
  });
});
