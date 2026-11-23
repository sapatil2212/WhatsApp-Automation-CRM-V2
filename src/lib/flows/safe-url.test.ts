import { describe, expect, it } from 'vitest';

import { checkWebhookUrl, isPrivateAddress, readJsonPath } from './safe-url';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd12:3456::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '999.1.1.1',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '203.0.113.9'.replace('203.0.113.9', '52.1.2.3'), '2606:4700:4700::1111'])('allows %s', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('checkWebhookUrl', () => {
  it('accepts a normal public https URL, with placeholders', () => {
    expect(checkWebhookUrl('https://api.example.com/orders?id={{vars.order_id}}')).toBeNull();
    expect(checkWebhookUrl('https://api.example.com:8443/x')).toBeNull();
  });

  it.each([
    ['', 'Enter'],
    ['not a url', 'valid URL'],
    ['http://api.example.com', 'https'],
    ['https://user:pw@api.example.com', 'credentials'],
    ['https://api.example.com:8080/x', 'ports'],
    ['https://localhost/x', 'Internal'],
    ['https://printer.local/x', 'Internal'],
    ['https://metadata.internal/x', 'Internal'],
    ['https://169.254.169.254/latest/meta-data', 'Private'],
    ['https://127.0.0.1/x', 'Private'],
    ['https://[::1]/x', 'Private'],
    ['https://intranet/x', 'full public domain'],
    ['ftp://example.com/x', 'https'],
  ])('rejects %s', (url, hint) => {
    expect(checkWebhookUrl(url)).toContain(hint);
  });
});

describe('readJsonPath', () => {
  const data = { data: { status: 'shipped', items: [{ name: 'a' }, { name: 'b' }] } };
  it('reads dotted and indexed paths', () => {
    expect(readJsonPath(data, 'data.status')).toBe('shipped');
    expect(readJsonPath(data, 'data.items.1.name')).toBe('b');
    expect(readJsonPath(data, 'data.items[0].name')).toBe('a');
  });
  it('returns undefined for missing or unsafe paths', () => {
    expect(readJsonPath(data, 'data.nope.deeper')).toBeUndefined();
    expect(readJsonPath(data, '__proto__.polluted')).toBeUndefined();
    expect(readJsonPath(data, 'data.constructor')).toBeUndefined();
  });
});
