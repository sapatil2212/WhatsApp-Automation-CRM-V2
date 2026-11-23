import { describe, expect, it } from 'vitest';

import { boardActionSchema, boardBulkDeleteSchema } from './appointment-board.service';

const uuid = '123e4567-e89b-42d3-a456-426614174000';

describe('appointment board edit / bulk delete schemas', () => {
  it('accepts a valid edit and rejects bad input', () => {
    expect(boardActionSchema.safeParse({ action: 'edit', name: 'Asha Patil', age: '32', gender: 'female', email: '', complaint: 'Fever' }).success).toBe(true);
    expect(boardActionSchema.safeParse({ action: 'edit', name: 'A' }).success).toBe(false);
    expect(boardActionSchema.safeParse({ action: 'edit', name: 'Asha', age: 'abc' }).success).toBe(false);
    expect(boardActionSchema.safeParse({ action: 'edit', name: 'Asha', email: 'nope' }).success).toBe(false);
  });
  it('limits bulk deletes to 1-200 valid ids', () => {
    expect(boardBulkDeleteSchema.safeParse({ ids: [uuid] }).success).toBe(true);
    expect(boardBulkDeleteSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(boardBulkDeleteSchema.safeParse({ ids: ['x'] }).success).toBe(false);
    expect(boardBulkDeleteSchema.safeParse({ ids: Array(201).fill(uuid) }).success).toBe(false);
  });
});
