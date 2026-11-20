/**
 * Booking link endpoints.
 *
 *   GET  /api/public/booking/[id]         public business profile for the booking page
 *   GET  /api/public/booking/[id]/slots   free slots (doctor or service)
 *   POST /api/public/booking/[id]         book → token + WhatsApp confirmation
 *   GET  /api/booking-link                (tenant) link + QR code for sharing
 */

import QRCode from 'qrcode';
import { z } from 'zod';

import { createHandler, NotFoundError } from '../kernel';
import { bookingIdForUser, publicBook, publicBookingBodySchema, publicProfile, publicSlots } from '../services/public-booking.service';

// A readable slug (sunrise-clinic) or a legacy UUID.
const params = z.object({ id: z.string().min(1).max(80).regex(/^[A-Za-z0-9-]+$/) });
const ipKey = ({ request }: { request: Request }) =>
  `public-booking:${(request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'}`;

function siteOrigin(request: Request): string {
  const env = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  if (env) return env;
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
  return `${proto}://${host}`;
}

export const bookingController = {
  profile: createHandler({
    operation: 'booking.publicProfile',
    auth: 'public',
    params,
    response: z.any(),
    rateLimit: { limit: 60, windowMs: 60_000, key: ipKey as never },
    handle: async ({ params: p }) => publicProfile(p.id),
  }),

  slots: createHandler({
    operation: 'booking.publicSlots',
    auth: 'public',
    params,
    query: z.object({
      doctorId: z.string().uuid().optional(),
      serviceId: z.string().uuid().optional(),
      from: z.string().optional(),
      days: z.coerce.number().int().min(1).max(31).default(7),
    }),
    response: z.any(),
    rateLimit: { limit: 120, windowMs: 60_000, key: ipKey as never },
    handle: async ({ params: p, query }) => publicSlots(p.id, query),
  }),

  book: createHandler({
    operation: 'booking.publicBook',
    auth: 'public',
    params,
    body: publicBookingBodySchema,
    response: z.any(),
    status: 201,
    rateLimit: { limit: 6, windowMs: 60_000, key: ipKey as never },
    handle: async ({ params: p, body }) => publicBook(p.id, body),
  }),

  link: createHandler({
    operation: 'booking.link',
    auth: 'tenant',
    response: z.any(),
    async handle({ ctx, request }) {
      const target = await bookingIdForUser(ctx.userId);
      if (!target) throw new NotFoundError('Business profile', { details: { hint: 'Complete Business Setup first.' } });
      const url = `${siteOrigin(request)}/book/${target.slug}`;
      const [qrPng, qrSvg] = await Promise.all([
        QRCode.toDataURL(url, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } }),
        QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }),
      ]);
      return { url, id: target.id, slug: target.slug, kind: target.kind, name: target.name, qrPng, qrSvg };
    },
  }),
};
