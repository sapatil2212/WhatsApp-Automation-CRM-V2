/**
 * WhatsApp connection settings.
 *
 * Credentials are encrypted at rest with AES-256-GCM
 * (`src/lib/whatsapp/encryption.ts`). This repository is the only place that
 * decrypts them, and it never returns a plaintext token through a method
 * that a controller could reach by accident — `findCredentials` is separate
 * from `findPublic`, and only the transport factory calls it.
 *
 * The pre-existing legacy-CBC self-heal is preserved: a token stored in the
 * old two-part format is re-encrypted as GCM on first successful read.
 */

import type { Prisma } from '@prisma/client';

import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';

import { scoped, ValidationError, type TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

/** Safe to expose: no secrets. */
const publicSelect = {
  id: true,
  phoneNumberId: true,
  wabaId: true,
  status: true,
  connectedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WhatsappConfigSelect;

export type WhatsappConfigPublicRow = Prisma.WhatsappConfigGetPayload<{ select: typeof publicSelect }>;

export interface WhatsappCredentials {
  configId: string;
  phoneNumberId: string;
  wabaId: string | null;
  accessToken: string;
  /** Per-tenant Meta app secret for webhook signature verification. */
  metaAppSecret: string | null;
}

export class WhatsappConfigRepository extends BaseRepository {
  protected readonly resourceName = 'WhatsApp configuration';

  constructor(db: TenantDb) {
    super(db);
  }

  /** `@@unique([tenantId])` means at most one config per tenant. */
  async findPublic(): Promise<WhatsappConfigPublicRow | null> {
    return this.db.whatsappConfig.findFirst({ select: publicSelect });
  }

  async requirePublic(): Promise<WhatsappConfigPublicRow> {
    return this.requireFound(await this.findPublic());
  }

  /**
   * Decrypted credentials. Returns null when unconfigured so callers can
   * present "connect WhatsApp in Settings" rather than a 500.
   */
  async findCredentials(): Promise<WhatsappCredentials | null> {
    const row = await this.db.whatsappConfig.findFirst({
      select: {
        id: true,
        phoneNumberId: true,
        wabaId: true,
        accessToken: true,
        metaAppSecret: true,
        status: true,
      },
    });
    if (!row) return null;

    let accessToken: string;
    try {
      accessToken = decrypt(row.accessToken);
    } catch (error) {
      // A decrypt failure almost always means ENCRYPTION_KEY was rotated.
      // Saying so is far more useful than "internal server error".
      throw new ValidationError(
        'Stored WhatsApp credentials could not be decrypted. Re-save your WhatsApp settings to reconnect.',
        { cause: error },
      );
    }

    // Self-heal legacy CBC ciphertext. Fire-and-forget: a failed upgrade
    // just means the next read tries again, and the operation is idempotent.
    if (isLegacyFormat(row.accessToken)) {
      void this.db.whatsappConfig
        .updateMany({ where: { id: row.id }, data: { accessToken: encrypt(accessToken) } })
        .catch(() => undefined);
    }

    let metaAppSecret: string | null = null;
    if (row.metaAppSecret) {
      try {
        metaAppSecret = decrypt(row.metaAppSecret);
      } catch {
        // A broken app secret must not block sending; webhook verification
        // falls back to the platform-wide META_APP_SECRET.
        metaAppSecret = null;
      }
    }

    return {
      configId: row.id,
      phoneNumberId: row.phoneNumberId,
      wabaId: row.wabaId,
      accessToken,
      metaAppSecret,
    };
  }

  /** Creates or replaces the tenant's connection, encrypting on the way in. */
  async save(input: {
    phoneNumberId: string;
    wabaId: string | null;
    accessToken: string;
    verifyToken: string | null;
    metaAppSecret: string | null;
    userId: string;
  }): Promise<WhatsappConfigPublicRow> {
    const existing = await this.db.whatsappConfig.findFirst({ select: { id: true } });

    const data = {
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      accessToken: encrypt(input.accessToken),
      verifyToken: input.verifyToken ? encrypt(input.verifyToken) : null,
      metaAppSecret: input.metaAppSecret ? encrypt(input.metaAppSecret) : null,
      status: 'connected',
      connectedAt: new Date(),
    };

    if (existing) {
      await this.db.whatsappConfig.updateMany({ where: { id: existing.id }, data });
      return this.requirePublic();
    }

    return this.db.whatsappConfig.create({
      data: scoped({ ...data, userId: input.userId }),
      select: publicSelect,
    });
  }

  async markDisconnected(): Promise<void> {
    await this.db.whatsappConfig.updateMany({ data: { status: 'disconnected' } });
  }

  async delete(): Promise<void> {
    await this.db.whatsappConfig.deleteMany({});
  }
}
