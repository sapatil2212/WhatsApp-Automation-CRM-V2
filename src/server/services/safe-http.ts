/**
 * Outbound HTTPS for tenant-authored flow steps.
 *
 * Defences, all of them needed:
 *  - https only, standard ports (`checkWebhookUrl`)
 *  - the address is validated **at connect time** through a custom `lookup`,
 *    so a hostname that resolves to a public address when checked and to a
 *    private one when connected (DNS rebinding) is still refused
 *  - redirects are never followed (a 302 to http://169.254.169.254 is a
 *    classic bypass)
 *  - hard timeout and response size cap
 */

import dns from 'node:dns';
import https from 'node:https';

import { checkWebhookUrl, isPrivateAddress } from '@/lib/flows/safe-url';

export interface SafeRequestInput {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface SafeResponse {
  status: number;
  text: string;
  truncated: boolean;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0) return callback(new Error('The host did not resolve.') as NodeJS.ErrnoException);
    if (list.some((a) => isPrivateAddress(a.address))) {
      return callback(new Error('That address is not allowed.') as NodeJS.ErrnoException);
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

export function safeRequest(input: SafeRequestInput): Promise<SafeResponse> {
  const problem = checkWebhookUrl(input.url);
  if (problem) return Promise.reject(new Error(problem));

  const url = new URL(input.url);
  const maxBytes = input.maxBytes ?? 64 * 1024;
  const timeoutMs = input.timeoutMs ?? 8_000;

  return new Promise<SafeResponse>((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: input.method,
        headers: {
          'User-Agent': 'ChatNexGen-Flows/1.0',
          Accept: 'application/json, text/plain;q=0.8, */*;q=0.5',
          ...(input.body !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(input.body) } : {}),
          ...(input.headers ?? {}),
        },
        lookup: guardedLookup as unknown as https.RequestOptions['lookup'],
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            truncated = true;
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const done = () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), truncated });
        res.on('end', done);
        res.on('close', done);
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('The request timed out.')));
    req.on('error', reject);
    if (input.body !== undefined) req.write(input.body);
    req.end();
  });
}
