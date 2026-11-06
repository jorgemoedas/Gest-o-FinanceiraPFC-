import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateTransactionDto } from './update-transaction.dto';

describe('UpdateTransactionDto', () => {
  it.each([
    ['type', { type: null }],
    ['category', { category: null }],
    ['description', { description: null }],
    ['amount', { amount: null }],
    ['occurredAt', { occurredAt: null }],
    ['status', { status: null }]
  ])('rejects null for %s', (_field, input) => {
    const dto = plainToInstance(UpdateTransactionDto, input);
    expect(validateSync(dto)).not.toHaveLength(0);
  });

  it('allows clearing nullable subcategory and due date', () => {
    const dto = plainToInstance(UpdateTransactionDto, { subcategory: null, dueAt: null });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts a valid RFC UUID that is not version 4', () => {
    const dto = plainToInstance(UpdateTransactionDto, { counterpartyId: 'f47ac10b-58cc-11cf-a447-001122334455' });
    expect(validateSync(dto)).toHaveLength(0);
  });
});
