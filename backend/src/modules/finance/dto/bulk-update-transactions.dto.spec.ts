import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BulkUpdateTransactionsDto } from './bulk-update-transactions.dto';

const id = 'f47ac10b-58cc-11cf-a447-001122334455';

function valid(input: Record<string, unknown>) {
  return validateSync(plainToInstance(BulkUpdateTransactionsDto, input), { whitelist: true, forbidNonWhitelisted: true });
}

describe('BulkUpdateTransactionsDto', () => {
  it('accepts a bounded request with explicit versions and supported changes', () => {
    expect(valid({
      items: [{ id, version: 2 }],
      changes: { category: 'OTHER', subcategory: null, status: 'PAID', dueAt: null }
    })).toHaveLength(0);
  });

  it('rejects an empty or over-limit item list', () => {
    expect(valid({ items: [], changes: { status: 'PAID' } })).not.toHaveLength(0);
    expect(valid({ items: Array.from({ length: 101 }, () => ({ id, version: 1 })), changes: { status: 'PAID' } })).not.toHaveLength(0);
  });

  it('rejects invalid versions, identifiers, statuses and unknown fields', () => {
    expect(valid({ items: [{ id: 'not-an-id', version: 0 }], changes: { status: 'CANCELLED' } })).not.toHaveLength(0);
    expect(valid({ items: [{ id, version: 1 }], changes: { description: 'não permitido' } })).not.toHaveLength(0);
  });
});
