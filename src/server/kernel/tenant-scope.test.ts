import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { TENANT_SCOPES, getTenantScope } from './tenant-scope';

const models = Prisma.dmmf.datamodel.models;
const modelNames = models.map((model) => model.name);

function fieldNames(modelName: string): string[] {
  const model = models.find((candidate) => candidate.name === modelName);
  if (!model) throw new Error(`Model ${modelName} missing from DMMF`);
  return model.fields.map((field) => field.name);
}

describe('TENANT_SCOPES', () => {
  it('classifies every model in the Prisma schema', () => {
    const unclassified = modelNames.filter((name) => getTenantScope(name) === undefined);
    expect(
      unclassified,
      `Unclassified models would be rejected at runtime by the tenant guard. Add them to TENANT_SCOPES: ${unclassified.join(', ')}`,
    ).toEqual([]);
  });

  it('declares no scope for a model that does not exist', () => {
    const phantom = Object.keys(TENANT_SCOPES).filter((name) => !modelNames.includes(name));
    expect(phantom, `Stale entries in TENANT_SCOPES: ${phantom.join(', ')}`).toEqual([]);
  });

  it('only marks a model `direct` when it really has a tenantId column', () => {
    const wrong = Object.entries(TENANT_SCOPES)
      .filter(([, scope]) => scope.kind === 'direct')
      .map(([name]) => name)
      .filter((name) => !fieldNames(name).includes('tenantId'));
    expect(wrong, `Models marked direct without a tenantId field: ${wrong.join(', ')}`).toEqual([]);
  });

  it('never marks a model `parent` when it has its own tenantId', () => {
    const redundant = Object.entries(TENANT_SCOPES)
      .filter(([, scope]) => scope.kind === 'parent' || scope.kind === 'scalarParent')
      .map(([name]) => name)
      .filter((name) => fieldNames(name).includes('tenantId'));
    expect(redundant, `Models needlessly guarded via a parent: ${redundant.join(', ')}`).toEqual([]);
  });

  it('points every `parent` scope at a real relation and foreign key', () => {
    for (const [name, scope] of Object.entries(TENANT_SCOPES)) {
      if (scope.kind !== 'parent') continue;
      const fields = fieldNames(name);
      expect(fields, `${name}.${scope.relation}`).toContain(scope.relation);
      expect(fields, `${name}.${scope.foreignKey}`).toContain(scope.foreignKey);
      expect(modelNames, `${name} parent model`).toContain(scope.parentModel);
    }
  });

  it('points every `scalarParent` scope at a real column with no relation', () => {
    for (const [name, scope] of Object.entries(TENANT_SCOPES)) {
      if (scope.kind !== 'scalarParent') continue;
      const fields = fieldNames(name);
      expect(fields).toContain(scope.foreignKey);
      expect(modelNames).toContain(scope.parentModel);
    }
  });

  it('resolves every `parent` chain to a model with a tenantId', () => {
    for (const [name, scope] of Object.entries(TENANT_SCOPES)) {
      if (scope.kind !== 'parent' && scope.kind !== 'scalarParent') continue;

      // Walk up until we find a direct scope, so a parent-of-a-parent
      // chain can never silently terminate at an unguarded model.
      let cursor: string = scope.parentModel;
      const seen = new Set<string>([name]);
      for (let depth = 0; depth < 10; depth += 1) {
        expect(seen.has(cursor), `Cycle in tenant scope chain at ${cursor}`).toBe(false);
        seen.add(cursor);
        const parentScope = getTenantScope(cursor);
        expect(parentScope, `${cursor} has no scope`).toBeDefined();
        if (parentScope?.kind === 'direct') break;
        if (parentScope?.kind === 'parent' || parentScope?.kind === 'scalarParent') {
          cursor = parentScope.parentModel;
          continue;
        }
        throw new Error(`${name} resolves to non-tenant model ${cursor}`);
      }
      expect(getTenantScope(cursor)?.kind, `${name} chain end (${cursor})`).toBe('direct');
    }
  });

  it('keeps the global allow-list minimal and justified', () => {
    const globals = Object.entries(TENANT_SCOPES)
      .filter(([, scope]) => scope.kind === 'global')
      .map(([name, scope]) => ({ name, reason: (scope as { reason: string }).reason }));

    expect(globals.map((entry) => entry.name).sort()).toEqual(['RefreshToken', 'Tenant', 'User']);
    for (const entry of globals) {
      expect(entry.reason.length, `${entry.name} needs a justification`).toBeGreaterThan(10);
    }
  });
});
