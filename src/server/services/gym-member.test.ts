import { describe, expect, it } from 'vitest';

import { finalizeMembers, guessColumns, matchPackage, parseDate, parseGender } from '@/lib/ai/member-extract';
import { libraryFor } from '@/lib/whatsapp/appointment-template-library';
import { codePrefix, currentMembership, endDateFor, paymentStatusFor, type MembershipDto } from './gym-member.service';

const PKGS = [
  { id: 'm', name: 'Monthly', durationDays: 30 },
  { id: 'q', name: 'Quarterly', durationDays: 90 },
];

describe('memberships', () => {
  it('ends a package on its last included day', () => {
    expect(endDateFor('2026-12-01', 30)).toBe('2026-12-30');
    expect(endDateFor('2026-12-01', 1)).toBe('2026-12-01');
    expect(endDateFor('2027-01-31', 30)).toBe('2027-03-01');
  });

  it('derives the payment status from what is due and paid', () => {
    expect(paymentStatusFor(1000, 1000)).toBe('paid');
    expect(paymentStatusFor(1000, 400)).toBe('partial');
    expect(paymentStatusFor(1000, 0)).toBe('unpaid');
    expect(paymentStatusFor(0, 0)).toBe('paid');
  });

  it('builds member code prefixes from the business name', () => {
    expect(codePrefix('Get Fit Gym & Wellness Center')).toBe('GF');
    expect(codePrefix('Powerhouse')).toBe('PO');
    expect(codePrefix('')).toBe('MB');
  });

  it('picks the running membership, then the next one, then the latest ended', () => {
    const m = (id: string, state: MembershipDto['state'], startDate: string, endDate: string) => ({ id, state, startDate, endDate }) as MembershipDto;
    expect(currentMembership([m('old', 'expired', '2026-01-01', '2026-01-30'), m('now', 'active', '2026-11-01', '2026-11-30')])?.id).toBe('now');
    expect(currentMembership([m('old', 'expired', '2026-01-01', '2026-01-30'), m('next', 'upcoming', '2026-12-01', '2026-12-30')])?.id).toBe('next');
    expect(currentMembership([m('a', 'expired', '2026-01-01', '2026-01-30'), m('b', 'expired', '2026-05-01', '2026-05-30')])?.id).toBe('b');
    expect(currentMembership([m('x', 'cancelled', '2026-11-01', '2026-11-30')])).toBeNull();
  });
});

describe('member import parsing', () => {
  it('reads Indian day-first dates, ISO, month names and Excel serials', () => {
    expect(parseDate('05/03/2026')).toBe('2026-03-05');
    expect(parseDate('2026-03-05')).toBe('2026-03-05');
    expect(parseDate('5 Mar 2026')).toBe('2026-03-05');
    expect(parseDate('March 5, 2026')).toBe('2026-03-05');
    expect(parseDate('12/25/2026')).toBe('2026-12-25'); // impossible day-first → month-first
    expect(parseDate(46086)).toBe('2026-03-05');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('soon')).toBeNull();
  });

  it('normalises gender words', () => {
    expect(parseGender('M')).toBe('male');
    expect(parseGender('Female')).toBe('female');
    expect(parseGender('mrs')).toBe('female');
    expect(parseGender('?')).toBeNull();
  });

  it('matches packages by name, then by the period length', () => {
    expect(matchPackage('monthly plan', null, null, PKGS)).toBe('m');
    expect(matchPackage('', '2026-01-01', '2026-03-31', PKGS)).toBe('q');
    expect(matchPackage('Yearly', '2026-01-01', '2026-12-31', PKGS)).toBeNull();
  });

  it('validates phones, removes duplicates and flags rows to fix', () => {
    const { members, duplicatesRemoved } = finalizeMembers(
      [
        { name: 'Asha Rao', phone: '98201 44556', packageName: 'Quarterly', startDate: '01/12/2026', amountPaid: '₹4,500' },
        { name: 'Asha R', phone: '+91 98201-44556' },
        { name: 'No Phone' },
        { name: 'R', phone: '9876543210' },
      ],
      PKGS,
    );
    expect(duplicatesRemoved).toBe(1);
    expect(members[0]).toMatchObject({ phone: '919820144556', valid: true, packageId: 'q', startDate: '2026-12-01', amountPaid: 4500 });
    expect(members[1]).toMatchObject({ valid: false, issue: 'No phone number' });
    expect(members[2]).toMatchObject({ valid: false, issue: 'No name' });
  });

  it('guesses register columns from headers when the AI is unavailable', () => {
    const map = guessColumns(['Member Name', 'Mobile No', 'Emergency Mobile', 'Plan', 'Joining Date', 'Expiry Date', 'Fees Paid']);
    expect(map).toMatchObject({ name: [0], phone: 1, emergencyContactPhone: 2, packageName: 3, startDate: 4, endDate: 5, amountPaid: 6 });
  });
});

describe('fitness templates', () => {
  it('offers the membership welcome template only to fitness businesses', () => {
    expect(libraryFor('gym').some((t) => t.event === 'member_welcome')).toBe(true);
    expect(libraryFor('clinic').some((t) => t.event === 'member_welcome')).toBe(false);
    expect(libraryFor('salon').some((t) => t.event === 'member_welcome')).toBe(false);
  });
});
