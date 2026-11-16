import { describe, expect, it, vi } from 'vitest';

import { applyWhereGuard } from './db';
import type { TenantScope } from './tenant-scope';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';

const direct: TenantScope = { kind: 'direct' };
const viaConversation: TenantScope = {
  kind: 'parent',
  relation: 'conversation',
  foreignKey: 'conversationId',
  parentModel: 'Conversation',
};
const viaBusinessScalar: TenantScope = {
  kind: 'scalarParent',
  foreignKey: 'businessId',
  parentModel: 'BusinessProfile',
};

function resolver(ids: string[]) {
  return vi.fn().mockResolvedValue(ids);
}

describe('applyWhereGuard — direct tenantId', () => {
  it('injects tenantId when the caller passed no filter at all', async () => {
    const where = await applyWhereGuard({
      tenantId: TENANT,
      scope: direct,
      where: undefined,
      resolveOwnedIds: resolver([]),
    });
    expect(where).toEqual({ tenantId: TENANT });
  });

  it('preserves the caller filters alongside the guard', async () => {
    const where = await applyWhereGuard({
      tenantId: TENANT,
      scope: direct,
      where: { status: 'open', unreadCount: { gt: 0 } },
      resolveOwnedIds: resolver([]),
    });
    expect(where).toEqual({ status: 'open', unreadCount: { gt: 0 }, tenantId: TENANT });
  });

  it('overrides a caller-supplied tenantId — the compat-layer escalation is closed', async () => {
    const where = await applyWhereGuard({
      tenantId: TENANT,
      scope: direct,
      where: { tenantId: OTHER_TENANT },
      resolveOwnedIds: resolver([]),
    });
    expect(where.tenantId).toBe(TENANT);
  });

  it('does not mutate the caller-supplied where object', async () => {
    const original = { tenantId: OTHER_TENANT, name: 'x' };
    await applyWhereGuard({ tenantId: TENANT, scope: direct, where: original, resolveOwnedIds: resolver([]) });
    expect(original.tenantId).toBe(OTHER_TENANT);
  });
});

describe('applyWhereGuard — guarded through a relation', () => {
  it('adds a relation filter carrying the tenantId', async () => {
    const where = await applyWhereGuard({
      tenantId: TENANT,
      scope: viaConversation,
      where: { messageId: 'wamid.1' },
      resolveOwnedIds: resolver([]),
    });
    expect(where).toEqual({ messageId: 'wamid.1', conversation: { tenantId: TENANT } });
  });

  it('merges into an existing relation filter without dropping it', async () => {
    const where = await applyWhereGuard({
      tenantId: TENANT,
      scope: viaConversation,
      where: { conversation: { status: 'open' } },
      resolveOwnedIds: resolver([]),
    });
    expect(where.conversation).toEqual({ status: 'open', tenantId: TENANT });
  });

  it('overrides a spoofed tenantId inside the relation filter', async () => {
    const where = await applyWhereGuard({
      tenantId: TENANT,
      scope: viaConversation,
      where: { conversation: { tenantId: OTHER_TENANT } },
      resolveOwnedIds: resolver([]),
    });
    expect(where.conversation).toEqual({ tenantId: TENANT });
  });

  it('still guards when the caller targets a row by primary key', async () => {
    const where = await applyWhereGuard({
      tenantId: TENANT,
      scope: viaConversation,
      where: { id: 'msg-1' },
      resolveOwnedIds: resolver([]),
    });
    expect(where).toEqual({ id: 'msg-1', conversation: { tenantId: TENANT } });
  });
});

describe('applyWhereGuard — scalar-only owner', () => {
  it('restricts the foreign key to the ids the tenant owns', async () => {
    const resolve = resolver(['biz-1', 'biz-2']);
    const where = await applyWhereGuard({
      tenantId: TENANT,
      scope: viaBusinessScalar,
      where: { detectedIntent: 'booking' },
      resolveOwnedIds: resolve,
    });
    expect(where).toEqual({ detectedIntent: 'booking', businessId: { in: ['biz-1', 'biz-2'] } });
    expect(resolve).toHaveBeenCalledWith('BusinessProfile');
  });

  it('yields an empty result set rather than an unfiltered one when the tenant owns nothing', async () => {
    const where = await applyWhereGuard({
      tenantId: TENANT,
      scope: viaBusinessScalar,
      where: undefined,
      resolveOwnedIds: resolver([]),
    });
    expect(where).toEqual({ businessId: { in: [] } });
  });

  it('overrides a caller-supplied foreign key', async () => {
    const where = await applyWhereGuard({
      tenantId: TENANT,
      scope: viaBusinessScalar,
      where: { businessId: 'someone-elses-business' },
      resolveOwnedIds: resolver(['biz-1']),
    });
    expect(where.businessId).toEqual({ in: ['biz-1'] });
  });
});
