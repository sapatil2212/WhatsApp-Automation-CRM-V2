/**
 * Profile persistence.
 *
 * `Profile` is the tenant-membership record, so this repository answers
 * "is this user part of my workspace?" — a question the old code never
 * asked. Conversations could be assigned to an arbitrary user id, and the
 * agent dropdown was populated from an unfiltered `profiles` read.
 */

import type { Prisma } from '@prisma/client';

import type { TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

const profileSelect = {
  id: true,
  userId: true,
  fullName: true,
  email: true,
  avatarUrl: true,
  role: true,
  businessName: true,
  businessType: true,
  phoneNumber: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProfileSelect;

export type ProfileRow = Prisma.ProfileGetPayload<{ select: typeof profileSelect }>;

export class ProfileRepository extends BaseRepository {
  protected readonly resourceName = 'Profile';

  constructor(db: TenantDb) {
    super(db);
  }

  /** Every member of the caller's tenant — the agent picker's source. */
  async listMembers(): Promise<ProfileRow[]> {
    return this.db.profile.findMany({ select: profileSelect, orderBy: { fullName: 'asc' } });
  }

  async findByUserId(userId: string): Promise<ProfileRow> {
    return this.requireFound(await this.db.profile.findFirst({ where: { userId }, select: profileSelect }));
  }

  /**
   * Tenant-membership check. Returns false for a user in another tenant
   * because the guard scopes the read — the caller cannot distinguish
   * "no such user" from "not your user", which is the intent.
   */
  async existsInTenant(userId: string): Promise<boolean> {
    return (await this.db.profile.count({ where: { userId } })) > 0;
  }

  async update(
    userId: string,
    data: Partial<{
      fullName: string | null;
      avatarUrl: string | null;
      businessName: string | null;
      businessType: string | null;
      phoneNumber: string | null;
    }>,
  ): Promise<ProfileRow> {
    this.requireAffected(await this.db.profile.updateMany({ where: { userId }, data }));
    return this.findByUserId(userId);
  }
}
