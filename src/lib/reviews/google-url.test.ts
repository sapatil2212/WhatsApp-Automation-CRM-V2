import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { validateGoogleReviewUrl } from './google-url';

const require = createRequire(import.meta.url);
// The worker is plain Node and carries its own copy of the rules.
const worker = require('../../../workers/review-automation/google-url.js') as { validateGoogleReviewUrl: typeof validateGoogleReviewUrl };

const CASES: Array<[string, boolean]> = [
  ['https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4', true],
  ['https://g.page/r/CabcDEFghi123/review', true],
  ['https://maps.app.goo.gl/AbCdEf12345', true],
  ['https://www.google.com/maps/place/Some+Clinic/@19.07,72.87,17z', true],
  ['search.google.com/local/writereview?placeid=ChIJxyz', true], // https is added
  ['', false],
  ['not a url', false],
  ['http://g.page/r/abc/review', true], // upgraded to https
  ['https://evil.example.com/local/writereview?placeid=abc', false],
  ['https://google.com.evil.com/local/writereview?placeid=abc', false],
  ['https://g.page/r/abc/', false], // not a review link
  ['https://www.google.com/', false],
  ['https://search.google.com/local/writereview', false], // no placeid
  ['https://user:pass@search.google.com/local/writereview?placeid=abc', false],
  ['https://search.google.com:8443/local/writereview?placeid=abc', false],
  ['javascript:alert(1)', false],
];

describe('validateGoogleReviewUrl', () => {
  it.each(CASES)('%s -> %s', (input, valid) => {
    expect(validateGoogleReviewUrl(input).valid).toBe(valid);
  });

  it('normalizes to https and keeps the place id', () => {
    const r = validateGoogleReviewUrl('http://search.google.com/local/writereview?placeid=ChIJabc&utm=x');
    expect(r.normalized).toBe('https://search.google.com/local/writereview?placeid=ChIJabc');
  });

  it('gives the same answer in the worker copy', () => {
    for (const [input] of CASES) {
      const a = validateGoogleReviewUrl(input);
      const b = worker.validateGoogleReviewUrl(input);
      expect({ input, valid: b.valid, normalized: b.normalized }).toEqual({ input, valid: a.valid, normalized: a.normalized });
    }
  });
});