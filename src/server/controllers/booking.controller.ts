/**
 * Booking link endpoints.
 *
 *   GET  /api/public/booking/[id]         public business profile for the booking page
 *   GET  /api/public/booking/[id]/slots   free slots (doctor or service)
 *   GET  /api/public/booking/[id]/logo    clinic logo (from Prescription setup)
 *   POST /api/public/booking/[id]         book → token + WhatsApp confirmation
 *   GET  /api/booking-link                (tenant) link + QR code for sharing
 */

import { requestOrigin as siteOrigin } from '../site-origin';
import QRCode from 'qrcode';
import { z } from 'zod';

import { createHandler, createRawHandler, NotFoundError } from '../kernel';
import { bookingIdForUser, publicBook, publicBookingBodySchema, publicLogo, publicProfile, publicSlots } from '../services/public-booking.service';

// A readable slug (sunrise-clinic) or a legacy UUID.
const params = z.object({ id: z.string().min(1).max(80).regex(/^[A-Za-z0-9-]+$/) });
const ipKey = ({ request }: { request: Request }) =>
  `public-booking:${(request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'}`;

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

  logo: createRawHandler({
    operation: 'booking.publicLogo',
    auth: 'public',
    async handle({ request }) {
      // /api/public/booking/[id]/logo
      const ref = decodeURIComponent(new URL(request.url).pathname.split('/').at(-2) ?? '');
      const parsed = params.safeParse({ id: ref });
      if (!parsed.success) throw new NotFoundError('Logo');
      const img = await publicLogo(parsed.data.id);
      if (!img || !/^image\/(png|jpe?g|webp|gif)$/i.test(img.mimeType)) throw new NotFoundError('Logo');
      return new Response(Buffer.from(img.data), {
        headers: {
          'Content-Type': img.mimeType,
          // URL carries ?v=<updatedAt>, so a new upload gets a new URL.
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    },
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
