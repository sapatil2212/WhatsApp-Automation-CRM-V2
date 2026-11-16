import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { buildStepTree, flattenStepTree, type StepTreeInput } from './automation.repository';

function input(stepType: string, branches?: StepTreeInput['branches']): StepTreeInput {
  return { stepType, stepConfig: {}, branches };
}

describe('flattenStepTree', () => {
  it('assigns positions within each sibling list', () => {
    const rows = flattenStepTree('auto-1', [input('send_message'), input('send_template')]);
    expect(rows.map((row) => row.position)).toEqual([0, 1]);
    expect(rows.every((row) => row.parentStepId === null && row.branch === null)).toBe(true);
  });

  it('wires branch steps to their condition parent', () => {
    const rows = flattenStepTree('auto-1', [
      input('condition', { yes: [input('send_message')], no: [input('close_conversation')] }),
    ]);

    const parent = rows.find((row) => row.stepType === 'condition');
    const yesStep = rows.find((row) => row.stepType === 'send_message');
    const noStep = rows.find((row) => row.stepType === 'close_conversation');

    expect(yesStep?.parentStepId).toBe(parent?.id);
    expect(yesStep?.branch).toBe('yes');
    expect(noStep?.parentStepId).toBe(parent?.id);
    expect(noStep?.branch).toBe('no');
  });

  it('restarts positions inside a branch', () => {
    const rows = flattenStepTree('auto-1', [
      input('condition', { yes: [input('send_message'), input('add_tag')] }),
    ]);
    const branchRows = rows.filter((row) => row.branch === 'yes');
    expect(branchRows.map((row) => row.position)).toEqual([0, 1]);
  });

  it('ignores branches on a non-condition step, which would be unreachable', () => {
    const rows = flattenStepTree('auto-1', [
      input('send_message', { yes: [input('add_tag')] }),
    ]);
    expect(rows).toHaveLength(1);
  });

  it('handles nested conditions', () => {
    const rows = flattenStepTree('auto-1', [
      input('condition', {
        yes: [input('condition', { yes: [input('send_message')] })],
      }),
    ]);
    expect(rows).toHaveLength(3);
    const innermost = rows.find((row) => row.stepType === 'send_message');
    const middle = rows.find((row) => row.stepType === 'condition' && row.parentStepId !== null);
    expect(innermost?.parentStepId).toBe(middle?.id);
  });

  it('generates a distinct id per step', () => {
    const rows = flattenStepTree('auto-1', [input('send_message'), input('send_message')]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });

  it('stamps the automation id on every row', () => {
    const rows = flattenStepTree('auto-9', [input('condition', { yes: [input('add_tag')] })]);
    expect(rows.every((row) => row.automationId === 'auto-9')).toBe(true);
  });

  it('returns nothing for an empty tree', () => {
    expect(flattenStepTree('auto-1', [])).toEqual([]);
  });
});

describe('buildStepTree', () => {
  const rows = [
    { id: 's1', parentStepId: null, branch: null, stepType: 'condition', stepConfig: {}, position: 0 },
    { id: 's2', parentStepId: 's1', branch: 'yes', stepType: 'send_message', stepConfig: {}, position: 1 },
    { id: 's3', parentStepId: 's1', branch: 'yes', stepType: 'add_tag', stepConfig: {}, position: 0 },
    { id: 's4', parentStepId: 's1', branch: 'no', stepType: 'close_conversation', stepConfig: {}, position: 0 },
    { id: 's5', parentStepId: null, branch: null, stepType: 'send_template', stepConfig: {}, position: 1 },
  ];

  it('nests branch steps under their parent', () => {
    const tree = buildStepTree(rows);
    expect(tree).toHaveLength(2);
    expect(tree[0].branches.yes.map((node) => node.id)).toEqual(['s3', 's2']);
    expect(tree[0].branches.no.map((node) => node.id)).toEqual(['s4']);
  });

  it('sorts every level by position, including inside branches', () => {
    const tree = buildStepTree(rows);
    expect(tree.map((node) => node.id)).toEqual(['s1', 's5']);
    expect(tree[0].branches.yes[0].position).toBe(0);
  });

  it('round-trips with flattenStepTree', () => {
    const original: StepTreeInput[] = [
      input('condition', { yes: [input('send_message'), input('add_tag')], no: [input('close_conversation')] }),
      input('send_template'),
    ];
    const flat = flattenStepTree('auto-1', original);
    const tree = buildStepTree(
      flat.map((row) => ({
        id: row.id,
        parentStepId: row.parentStepId,
        branch: row.branch,
        stepType: row.stepType,
        // `flattenStepTree` emits Prisma's write-side JSON type; reading it
        // back through the row shape needs the read-side type.
        stepConfig: row.stepConfig as Prisma.JsonValue,
        position: row.position,
      })),
    );

    expect(tree.map((node) => node.stepType)).toEqual(['condition', 'send_template']);
    expect(tree[0].branches.yes.map((node) => node.stepType)).toEqual(['send_message', 'add_tag']);
    expect(tree[0].branches.no.map((node) => node.stepType)).toEqual(['close_conversation']);
  });

  it('surfaces an orphaned step as a root instead of dropping it', () => {
    const tree = buildStepTree([
      { id: 'x', parentStepId: 'deleted', branch: 'yes', stepType: 'add_tag', stepConfig: {}, position: 0 },
    ]);
    expect(tree.map((node) => node.id)).toEqual(['x']);
  });

  it('treats an unrecognised branch value as the yes branch', () => {
    const tree = buildStepTree([
      { id: 'p', parentStepId: null, branch: null, stepType: 'condition', stepConfig: {}, position: 0 },
      { id: 'c', parentStepId: 'p', branch: 'maybe', stepType: 'add_tag', stepConfig: {}, position: 0 },
    ]);
    expect(tree[0].branches.yes.map((node) => node.id)).toEqual(['c']);
  });

  it('returns an empty tree for no rows', () => {
    expect(buildStepTree([])).toEqual([]);
  });
});
