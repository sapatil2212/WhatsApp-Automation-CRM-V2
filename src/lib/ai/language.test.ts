import { describe, expect, it } from 'vitest';
import { detectLanguage, normalizeDigits, resolveLanguage, templatesFit } from './language';

describe('detectLanguage', () => {
  it('tells Marathi from Hindi in Devanagari (the reported chat)', () => {
    expect(detectLanguage('रुग्णाचे नाव स्वप्नील पाटील आणि वय २७').code).toBe('mr');
    expect(detectLanguage('मला उद्या अपॉइंटमेंट पाहिजे आहे').code).toBe('mr');
    expect(detectLanguage('मुझे कल अपॉइंटमेंट चाहिए').code).toBe('hi');
    expect(detectLanguage('मरीज का नाम राहुल है और उम्र 30 साल').code).toBe('hi');
  });

  it('separates English, Hinglish and romanised Marathi', () => {
    expect(detectLanguage('Hi need to book appointment').code).toBe('en');
    expect(detectLanguage('No need to transfer').code).toBe('en');
    expect(detectLanguage('Cancel karo').code).toBe('hi-Latn');
    expect(detectLanguage('Clinic ka address bhejo').code).toBe('hi-Latn');
    expect(detectLanguage('mala udya appointment pahije').code).toBe('mr-Latn');
  });

  it('recognises other Indian scripts', () => {
    expect(detectLanguage('મારે એપોઇન્ટમેન્ટ જોઈએ છે').code).toBe('gu');
    expect(detectLanguage('எனக்கு அப்பாயின்ட்மென்ட் வேண்டும்').code).toBe('ta');
    expect(detectLanguage('నాకు అపాయింట్మెంట్ కావాలి').code).toBe('te');
  });

  it('has no strong opinion on "ok", numbers or emoji', () => {
    expect(detectLanguage('Ok').confidence).toBe('weak');
    expect(detectLanguage('2').code).toBe('und');
    expect(detectLanguage('👍').code).toBe('und');
  });
});

describe('resolveLanguage', () => {
  it('keeps the conversation language for short ambiguous replies', () => {
    const earlier = ['रुग्णाचे नाव स्वप्नील पाटील आणि वय २७', 'Hi need to book appointment'];
    expect(resolveLanguage('2', earlier).code).toBe('mr');
    expect(resolveLanguage('ok', earlier).code).toBe('mr');
  });

  it('follows the customer when they clearly switch language', () => {
    expect(resolveLanguage('Please send the clinic address', ['मला अपॉइंटमेंट पाहिजे आहे']).code).toBe('en');
  });

  it('defaults to English with no signal at all', () => {
    expect(resolveLanguage('👍', []).code).toBe('en');
  });
});

describe('helpers', () => {
  it('normalises Indic digits', () => {
    expect(normalizeDigits('वय २७')).toBe('वय 27');
    expect(normalizeDigits('૧૨:૩૦')).toBe('12:30');
  });

  it('only English and Hinglish fit the fixed booking templates', () => {
    expect(templatesFit(detectLanguage('book appointment please'))).toBe(true);
    expect(templatesFit(detectLanguage('appointment chahiye kal'))).toBe(true);
    expect(templatesFit(detectLanguage('मला अपॉइंटमेंट पाहिजे आहे'))).toBe(false);
  });
});
