/**
 * Team and Workspace Member endpoints.
 */

import { z } from 'zod';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  createHandler,
  result,
  systemDb,
  type AuthContext,
} from '../kernel';
import { deleted } from './controller-kit';

function assertTenant(ctx: AuthContext | null): asserts ctx is AuthContext {
  if (!ctx?.tenantId) throw new Error('Tenant context required.');
}

const teamMemberDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

const inviteMemberBodySchema = z.object({
  email: z.string().email(),
  role: z.enum(['tenant_admin', 'agent', 'manager']).default('agent'),
  fullName: z.string().trim().max(100).optional(),
});

const removeMemberQuerySchema = z.object({
  memberId: z.string(),
});

export const teamController = {
  list: createHandler({
    operation: 'team.members.list',
    auth: 'tenant',
    response: z.array(teamMemberDtoSchema),
    async handle({ ctx, db }) {
      assertTenant(ctx);

      // Find all profiles belonging to this tenant
      const profiles = await db.profile.findMany({
        select: {
          id: true,
          userId: true,
          email: true,
          fullName: true,
          avatarUrl: true,
          role: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      return result(
        profiles.map((p) => ({
          id: p.id,
          userId: p.userId,
          email: p.email,
          fullName: p.fullName,
          avatarUrl: p.avatarUrl,
          role: p.role || 'agent',
          status: 'active',
          createdAt: p.createdAt.toISOString(),
        })),
      );
    },
  }),

  invite: createHandler({
    operation: 'team.members.invite',
    auth: 'tenant',
    body: inviteMemberBodySchema,
    response: teamMemberDtoSchema,
    status: 201,
    async handle({ body, ctx, db }) {
      assertTenant(ctx);

      const email = body.email.trim().toLowerCase();

      // Check if user already exists
      const existingUser = await systemDb.user.findUnique({
        where: { email },
        include: { profile: true },
      });

      if (existingUser?.profile?.tenantId === ctx.tenantId) {
        throw new ConflictError('A team member with this email is already in your workspace.');
      }

      if (existingUser) {
        // Associate existing user's profile with this tenant
        const updatedProfile = await systemDb.profile.update({
          where: { userId: existingUser.id },
          data: {
            tenantId: ctx.tenantId,
            role: body.role,
            ...(body.fullName ? { fullName: body.fullName } : {}),
          },
        });

        return result({
          id: updatedProfile.id,
          userId: existingUser.id,
          email: existingUser.email,
          fullName: updatedProfile.fullName,
          avatarUrl: updatedProfile.avatarUrl,
          role: updatedProfile.role || body.role,
          status: 'active',
          createdAt: updatedProfile.createdAt.toISOString(),
        });
      }

      // Create user placeholder and profile for tenant
      const createdUser = await systemDb.user.create({
        data: {
          email,
          passwordHash: 'pending_invitation_placeholder_hash',
          role: body.role,
          isVerified: true,
          isEmailVerified: true,
          profile: {
            create: {
              tenantId: ctx.tenantId,
              email,
              fullName: body.fullName || email.split('@')[0],
              role: body.role,
              betaFeatures: [],
            },
          },
        },
        include: { profile: true },
      });

      return result({
        id: createdUser.profile!.id,
        userId: createdUser.id,
        email: createdUser.email,
        fullName: createdUser.profile!.fullName,
        avatarUrl: createdUser.profile!.avatarUrl,
        role: createdUser.profile!.role || body.role,
        status: 'active',
        createdAt: createdUser.createdAt.toISOString(),
      });
    },
  }),

  remove: createHandler({
    operation: 'team.members.remove',
    auth: 'tenant',
    query: removeMemberQuerySchema,
    response: z.object({ deleted: z.literal(true) }),
    async handle({ query, ctx, db }) {
      assertTenant(ctx);

      const targetProfile = await db.profile.findFirst({
        where: { id: query.memberId },
      });

      if (!targetProfile) {
        throw new NotFoundError('Team member');
      }

      if (targetProfile.userId === ctx.userId) {
        throw new ValidationError('You cannot remove yourself from the workspace.');
      }

      // Detach user profile from tenant
      await db.profile.updateMany({
        where: { id: query.memberId },
        data: { tenantId: null },
      });

      return deleted('Team member removed from workspace.');
    },
  }),
};
