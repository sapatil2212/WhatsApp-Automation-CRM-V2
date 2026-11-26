import { describe, expect, it } from 'vitest';

import { getBusinessSegment } from '@/lib/business/terminology';
import { audienceForSegment, isRelevantTemplate, templateAudience } from './template-audience';

const t = (name: string, eventType: string | null = null, body = '') => ({ name, eventType, body_text: body });

describe('template audience', () => {
  it('ties system event templates to their business type', () => {
    expect(templateAudience(t('patient_prescription_delivery', 'prescription'))).toBe('healthcare');
    expect(templateAudience(t('appointment_token_confirmation_v2', 'token_confirmation'))).toBe('healthcare');
    expect(templateAudience(t('gym_membership_activated', 'member_welcome'))).toBe('fitness');
  });

  it('recognises gym and clinic templates synced from Meta by name', () => {
    expect(templateAudience(t('gympilot_welcome'))).toBe('fitness');
    expect(templateAudience(t('gympilot_membership_expiring'))).toBe('fitness');
    expect(templateAudience(t('gympilot_trial_booked'))).toBe('fitness');
    expect(templateAudience(t('clinic_lab_report_ready'))).toBe('healthcare');
  });

  it('keeps generic and promotional templates general', () => {
    expect(templateAudience(t('appointment_confirmation', 'confirmation', 'Hello {{1}}, your appointment at {{2}} is confirmed.'))).toBeNull();
    expect(templateAudience(t('festive_weekend_sale', null, 'Flat 20% off this weekend!'))).toBeNull();
    expect(templateAudience(t('black_friday_offer_2026'))).toBeNull();
  });

  it('uses the body when the name says nothing', () => {
    expect(templateAudience(t('new_offer', null, 'Join our gym this month and get 2 free workouts.'))).toBe('fitness');
    expect(templateAudience(t('reminder_1', null, 'Your prescription is ready at the clinic.'))).toBe('healthcare');
  });

  it('shows a business only general templates and its own', () => {
    const clinic = audienceForSegment('healthcare');
    const gym = audienceForSegment('wellness');
    expect(isRelevantTemplate(t('gympilot_welcome'), clinic)).toBe(false);
    expect(isRelevantTemplate(t('gympilot_welcome'), gym)).toBe(true);
    expect(isRelevantTemplate(t('patient_prescription_delivery', 'prescription'), gym)).toBe(false);
    expect(isRelevantTemplate(t('festive_weekend_sale'), gym)).toBe(true);
    // A general business sees only general templates.
    expect(isRelevantTemplate(t('gympilot_welcome'), audienceForSegment('business'))).toBe(false);
  });
});

describe('business categories', () => {
  it('opens the fitness dashboard for Gym & Fitness and the older Health & Wellness', () => {
    expect(getBusinessSegment('Gym & Fitness')).toBe('wellness');
    expect(getBusinessSegment('Health & Wellness')).toBe('wellness');
    expect(getBusinessSegment('Medical & Allied Health')).toBe('healthcare');
    expect(audienceForSegment(getBusinessSegment('Gym & Fitness'))).toBe('fitness');
  });
});
