import { describe, expect, it } from 'vitest';

import {
  advance,
  detectLang,
  extractRules,
  isActiveWizard,
  isBookingRequest,
  isCancelRequest,
  isRescheduleRequest,
  parseDate,
  parseTime,
  pickOption,
  startManage,
  startWizard,
  WIZARD_TTL_MS,
  type FlowData,
  type FlowDay,
  type FlowDepartment,
  type FlowDoctor,
  type FlowResult,
  type WizardState,
} from './whatsapp-booking-flow';

const TODAY = '2026-11-19'; // Thursday

const DEPTS: FlowDepartment[] = [
  { id: 'd-dent', name: 'Dentist', doctorCount: 1 },
  { id: 'd-skin', name: 'Dermatology', doctorCount: 2 },
  { id: 'd-empty', name: 'Cardiology', doctorCount: 0 },
];
const DOCS: FlowDoctor[] = [
  { id: 'doc-minal', name: 'Dr. Minal Patil', departmentIds: ['d-skin'], specialization: 'Dermatologist', qualification: 'MD', experience: '8 years', fee: 500 },
  { id: 'doc-swap', name: 'Swapnil Patil', departmentIds: ['d-dent'], specialization: 'Dentist', qualification: 'BDS', experience: null, fee: 400 },
  { id: 'doc-ana', name: 'Ana Rao', departmentIds: ['d-skin'], specialization: 'Dermatologist', qualification: null, experience: null, fee: 0 },
];

function data(over: Partial<FlowData> = {}, slotsByDate: Record<string, string[]> = {}): FlowData {
  const slots = (date: string) => slotsByDate[date] ?? (['2026-11-19', '2026-11-20', '2026-11-23'].includes(date) ? ['10:00', '10:30', '17:00', '17:30'] : []);
  return {
    clinicName: 'BrightSmile Dental Studio',
    contactName: 'Swapnil Anil Patil',
    today: TODAY,
    departments: async () => DEPTS,
    doctors: async () => DOCS,
    availability: async (_doctor: string, from: string, days: number): Promise<FlowDay[]> =>
      Array.from({ length: days }, (_, i) => {
        const d = new Date(`${from}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        const date = d.toISOString().slice(0, 10);
        const s = slots(date);
        return { date, slots: s, closedReason: s.length ? null : 'Doctor does not consult on this day.' };
      }),
    ...over,
  };
}
const noDepts = (over: Partial<FlowData> = {}) => data({ departments: async () => [], ...over });

const reply = (r: FlowResult) => {
  if (r.kind !== 'reply') throw new Error(`expected reply, got ${r.kind}`);
  return r;
};

async function chat(first: string, replies: string[], d = data()) {
  const transcript: string[] = [];
  let r = await startWizard(d, first);
  transcript.push(r.kind === 'reply' ? r.text : r.kind);
  for (const msg of replies) {
    r = await advance(reply(r).state, msg, d);
    transcript.push(r.kind === 'reply' || r.kind === 'exit' ? r.text : r.kind);
  }
  return { last: r, transcript };
}

describe('intent', () => {
  it.each(['Appointment booking', 'Want to book appointment', 'I want to book', 'doctor ko dikhana hai', 'appoinment chahiye'])('detects %s', (t) => {
    expect(isBookingRequest(t)).toBe(true);
  });
  it.each(['cancel my appointment', 'reschedule appointment', 'what is the appointment fee', 'hi', 'clinic timings'])('ignores %s', (t) => {
    expect(isBookingRequest(t)).toBe(false);
  });
  it('detects Hinglish', () => {
    expect(detectLang('kal appointment chahiye')).toBe('hi');
    expect(detectLang('I want to book an appointment')).toBe('en');
  });
});

describe('conversation 1 — one detail at a time, sounds human', () => {
  it('asks name and age together, without "step" wording', async () => {
    const r = reply(await startWizard(data(), 'Want to book appointment'));
    expect(r.text).toBe("Sure! 😊 Could you please tell me the patient's *name* and *age*?");
    expect(r.text.toLowerCase()).not.toContain('step');
  });

  it('name + age → department (with doctors) → doctor → date → slots → booked', async () => {
    const { last, transcript } = await chat('Want to book appointment', ['Swapnil patil 26', 'Dermatology Department', 'Dr. Ana', '20 nov', '2']);
    // "Swapnil patil 26" → both understood, then the department list
    expect(transcript[1]).toContain('Okay Swapnil, which *department*');
    expect(transcript[1]).toContain('*Dentist* — Dr. Swapnil Patil');
    expect(transcript[1]).toContain('*Dermatology* — Dr. Minal Patil, Dr. Ana Rao');
    expect(transcript[1]).not.toContain('Cardiology'); // no doctors there
    // Only that department's doctors
    expect(transcript[2]).toContain('for *Dermatology*, which *doctor*');
    expect(transcript[2]).not.toContain('Swapnil Patil*');
    // Date question with the next free days
    expect(transcript[3]).toContain('Which *date* works for you with Dr. Ana Rao?');
    expect(transcript[3]).toContain('today (Thu, 19 Nov), tomorrow (Fri, 20 Nov), Mon, 23 Nov');
    // Slots for that date
    expect(transcript[4]).toContain('available times with Dr. Ana Rao on *tomorrow (Fri, 20 Nov)*');
    expect(transcript[4]).toContain('5:00 PM');
    // Picking a slot books it
    expect(last.kind).toBe('book');
    if (last.kind === 'book') {
      expect(last.state).toMatchObject({ name: 'Swapnil Patil', age: '26', departmentId: 'd-skin', doctorId: 'doc-ana', date: '2026-11-20', time: '10:30' });
    }
  });

  it('skips the doctor question when the department has one doctor', async () => {
    const { transcript, last } = await chat('book appointment', ['Riya Shah 8', 'dentist']);
    expect(transcript[2]).toContain('*Dr. Swapnil Patil* will see you.');
    expect(reply(last).state.awaiting).toBe('date');
  });

  it('asks for a doctor directly when the clinic has no departments configured', async () => {
    const { transcript } = await chat('book appointment', ['Riya 30'], noDepts());
    expect(transcript[1]).toContain('which *doctor* would you like to see?');
    expect(transcript[1]).not.toContain('department');
    expect(transcript[1]).toContain('Dr. Swapnil Patil* — Dentist');
  });

  it('understands a specialty as the doctor when there are no departments', async () => {
    const { last } = await chat('book appointment', ['Riya 30', 'Dentist Department'], noDepts());
    expect(reply(last).state.doctorId).toBe('doc-swap');
  });

  it('asks to change the date when the doctor is not available', async () => {
    const { transcript, last } = await chat('book appointment', ['Riya 30', '1', '21 nov']);
    expect(transcript[3]).toContain("isn't available on Sat, 21 Nov");
    expect(transcript[3]).toContain('Next available');
    expect(reply(last).state.awaiting).toBe('date');
  });

  it('books a typed time that matches a free slot', async () => {
    const { last } = await chat('book appointment', ['Riya 30', '1', 'tomorrow', '5:30 pm']);
    expect(last.kind).toBe('book');
    if (last.kind === 'book') expect(last.state.time).toBe('17:30');
  });

  it('re-lists slots when the typed time is not free', async () => {
    const { last } = await chat('book appointment', ['Riya 30', '1', 'tomorrow', '9 pm']);
    expect(reply(last).text).toContain("9:00 PM isn't available");
  });
});

describe('conversation 2 — details given up front', () => {
  it('"…for tomorrow" asks name, age and department together', async () => {
    const r = reply(await startWizard(data(), 'Hello i want to book appointment for tomorrow'));
    expect(r.state.date).toBe('2026-11-20');
    expect(r.text).toContain("patient's *name* and *age*");
    expect(r.text).toContain('*department*');
    expect(r.text).toContain('*Dermatology* — Dr. Minal Patil, Dr. Ana Rao');
  });

  it('then one reply with everything goes straight to the slots, and a time books it', async () => {
    const { transcript, last } = await chat('Hello i want to book appointment for tomorrow', ['Swapnil Patil, 26, dermatology, Dr Minal']);
    expect(transcript[1]).toContain('available times with Dr. Minal Patil on *tomorrow');
    const booked = await advance(reply(last).state, '10 am', data());
    expect(booked.kind).toBe('book');
  });

  it('books in one message when everything is there', async () => {
    const r = await startWizard(data(), 'Book appointment with Dr. Ana Rao tomorrow at 5 pm, my name is Riya Shah, age 29');
    expect(r.kind).toBe('book');
    if (r.kind === 'book') expect(r.state).toMatchObject({ name: 'Riya Shah', age: '29', doctorId: 'doc-ana', date: '2026-11-20', time: '17:00' });
  });

  it('narrows "Dr. Patil" to the right doctor inside the department', async () => {
    const { last } = await chat('book appointment', ['Riya 30', 'dentist', ]);
    expect(reply(last).state.doctorId).toBe('doc-swap');
    const amb = await chat('book appointment', ['Riya 30', '2', 'Dr. Patil']);
    expect(reply(amb.last).state.doctorId).toBe('doc-minal');
  });
});

describe('Hinglish', () => {
  it('replies in Hinglish', async () => {
    const r = reply(await startWizard(data(), 'kal ke liye appointment chahiye'));
    expect(r.state.date).toBe('2026-11-20');
    expect(r.text).toContain('Patient ka *naam* aur *umar*');
  });
  it('understands "shaam 5 baje"', async () => {
    const { last } = await chat('appointment chahiye', ['Riya 30', '1', 'kal', 'shaam 5 baje']);
    expect(last.kind).toBe('book');
  });
});

describe('side questions, mistakes, cancel', () => {
  it('lets the regular AI answer a side question and keeps the booking', async () => {
    const { last } = await chat('book appointment', ['Riya 30', 'what are your clinic timings?']);
    expect(last.kind).toBe('release');
    if (last.kind === 'release') expect(last.state?.name).toBe('Riya');
  });

  it('re-asks politely, then gives up after repeated misses', async () => {
    const d = data();
    let r = reply(await startWizard(d, 'book appointment'));
    r = reply(await advance(r.state, 'Riya 30', d));
    const miss = reply(await advance(r.state, 'hmm', d));
    expect(miss.text).toContain("Sorry, I didn't quite get that.");
    const miss2 = reply(await advance(miss.state, 'umm', d));
    expect((await advance(miss2.state, 'ok', d)).kind).toBe('release');
  });

  it('cancels', async () => {
    const { last } = await chat('book appointment', ['cancel']);
    expect(last.kind).toBe('exit');
  });

  it('lets the AI read the patient reply first and falls back to rules when it fails', async () => {
    let calls = 0;
    const d = data({
      extract: async () => {
        calls += 1;
        return { name: 'Kavya Iyer', age: '41' };
      },
    });
    const r = reply(await startWizard(d, 'book appointment'));
    const ai = reply(await advance(r.state, 'its for my mother, she is forty one, kavya iyer', d));
    expect(calls).toBeGreaterThanOrEqual(2); // opening message and the patient reply
    expect(ai.state).toMatchObject({ name: 'Kavya Iyer', age: '41' });

    const down = data({ extract: async () => null });
    const r2 = reply(await startWizard(down, 'book appointment'));
    const rules = reply(await advance(r2.state, 'Swapnil Patil 26', down));
    expect(rules.state).toMatchObject({ name: 'Swapnil Patil', age: '26' });
  });

  it('expires stale sessions', () => {
    const s: WizardState = { flow: 'wizard', updatedAt: 0, invalid: 0, lang: 'en' };
    expect(isActiveWizard(s, WIZARD_TTL_MS + 1)).toBe(false);
    expect(isActiveWizard({ ...s, updatedAt: 1000 }, 2000)).toBe(true);
  });
});

describe('parsers', () => {
  it('parses dates', () => {
    expect(parseDate('today', TODAY)).toBe(TODAY);
    expect(parseDate('kal', TODAY)).toBe('2026-11-20');
    expect(parseDate('parso', TODAY)).toBe('2026-11-21');
    expect(parseDate('monday', TODAY)).toBe('2026-11-23');
    expect(parseDate('25 Nov', TODAY)).toBe('2026-11-25');
    expect(parseDate('Nov 25th', TODAY)).toBe('2026-11-25');
    expect(parseDate('25/11', TODAY)).toBe('2026-11-25');
    expect(parseDate('5 jan', TODAY)).toBe('2027-01-05');
    expect(parseDate('31 feb', TODAY)).toBeNull();
  });

  it('parses times', () => {
    expect(parseTime('5:30 pm')).toBe('17:30');
    expect(parseTime('5 PM')).toBe('17:00');
    expect(parseTime('17:30')).toBe('17:30');
    expect(parseTime('12 am')).toBe('00:00');
    expect(parseTime('shaam 6 baje')).toBe('18:00');
    expect(parseTime('subah 10')).toBe('10:00');
    expect(parseTime('later')).toBeNull();
  });

  it('pulls several details from one sentence', () => {
    const ex = extractRules('Swapnil Patil, 26, dermatology, 20 nov at 5:30 pm', { today: TODAY, departments: DEPTS, doctors: DOCS, awaiting: 'patient' });
    expect(ex).toMatchObject({ age: '26', department: 'Dermatology', date: '2026-11-20', time: '17:30' });
  });

  it('ignores Hinglish filler words and typos when reading name and age', () => {
    const ex = extractRules('name swapnil aur uma 26', { today: TODAY, departments: DEPTS, doctors: [], awaiting: 'patient' });
    expect(ex).toMatchObject({ name: 'Swapnil', age: '26' });
    const ex2 = extractRules('mera naam swapnil hai aur umar 26 saal', { today: TODAY, departments: DEPTS, doctors: DOCS, awaiting: 'patient' });
    expect(ex2).toMatchObject({ name: 'Swapnil', age: '26' });
  });

  it('picks options by number, emoji number or name', () => {
    const items = ['Dentist', 'Dermatology'];
    expect(pickOption('2', items, (x) => x)).toBe('Dermatology');
    expect(pickOption('2️⃣', items, (x) => x)).toBe('Dermatology');
    expect(pickOption('derma', items, (x) => x)).toBe('Dermatology');
    expect(pickOption('3', items, (x) => x)).toBeNull();
  });
});

describe('cancel / reschedule on WhatsApp', () => {
  const appt = { id: 'appt-1', ref: 'APT-261120-AB12C', doctorId: 'doc-ana', doctorName: 'Ana Rao', departmentId: 'd-skin', date: '2026-11-20', time: '10:00', patientName: 'Riya Shah', patientAge: '29' };
  const withAppts = (list = [appt]) => data({ upcoming: async () => list });

  it('detects the requests', () => {
    expect(isCancelRequest('I want to cancel my appointment')).toBe(true);
    expect(isCancelRequest('appointment cancel karna hai')).toBe(true);
    expect(isRescheduleRequest('can I reschedule?')).toBe(true);
    expect(isRescheduleRequest('change my appointment time')).toBe(true);
    expect(isRescheduleRequest('appointment postpone karna hai')).toBe(true);
    expect(isCancelRequest('hello')).toBe(false);
  });

  it('confirms before cancelling', async () => {
    const r = reply(await startManage(withAppts(), 'cancel', 'cancel my appointment'));
    expect(r.text).toContain('cancel your appointment with *Dr. Ana Rao* on *tomorrow (Fri, 20 Nov) at 10:00 AM*');
    expect((await advance(r.state, '1', withAppts())).kind).toBe('cancel');
    expect((await advance(r.state, 'no', withAppts())).kind).toBe('exit');
  });

  it('asks which one when there are several', async () => {
    const two = [appt, { ...appt, id: 'appt-2', ref: 'APT-261123-ZZ99Q', date: '2026-11-23' }];
    const r = reply(await startManage(withAppts(two), 'cancel'));
    expect(r.text).toContain('Which appointment would you like to cancel?');
    const pick = reply(await advance(r.state, '2', withAppts(two)));
    expect(pick.state.targetId).toBe('appt-2');
  });

  it('reschedules: keeps patient and doctor, asks only for the new date and time', async () => {
    const r = reply(await startManage(withAppts(), 'reschedule', 'reschedule my appointment'));
    expect(r.text).toContain("let's move your appointment with *Dr. Ana Rao*");
    expect(r.state.awaiting).toBe('date');
    const t = reply(await advance(r.state, '23 nov', withAppts()));
    const done = await advance(t.state, '5 pm', withAppts());
    expect(done.kind).toBe('book');
    if (done.kind === 'book') expect(done.state).toMatchObject({ mode: 'reschedule', targetId: 'appt-1', doctorId: 'doc-ana', date: '2026-11-23', time: '17:00' });
  });

  it('reschedules in one message', async () => {
    const r = await startManage(withAppts(), 'reschedule', 'please reschedule my appointment to monday 5:30 pm');
    expect(r.kind).toBe('book');
  });

  it('says so when there is nothing to change', async () => {
    const r = await startManage(withAppts([]), 'cancel');
    expect(r.kind).toBe('exit');
  });
});
