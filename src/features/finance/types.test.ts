import { describe, expect, it } from 'vitest';
import { financeCounterpartySchema, financeTransactionCancellationSchema, financeTransactionRefundSchema, financeTransactionSchema } from './types';

const id = '5d2a9a0e-339a-470e-9cc0-4624044cae86';
const transaction = {
  id,
  version: 1,
  type: 'EXPENSE',
  category: 'OTHER',
  subcategory: null,
  counterpartyId: null,
  counterparty: null,
  description: 'Devolução do lançamento',
  amount: 25,
  occurredAt: '2026-10-21T11:00:00.000Z',
  dueAt: null,
  hasAdjustment: true,
  status: 'REFUNDED'
};

describe('finance adjustment contracts', () => {
  it('requires the real optimistic version instead of assuming a default', () => {
    const { version: _version, ...missingVersion } = transaction;
    expect(financeTransactionSchema.safeParse(missingVersion).success).toBe(false);
    expect(financeTransactionSchema.safeParse({ ...transaction, version: 0 }).success).toBe(false);
    expect(financeTransactionSchema.safeParse({ ...transaction, version: 1.5 }).success).toBe(false);
  });

  it('accepts a refund entry as a distinct paid-flow status', () => {
    expect(financeTransactionSchema.parse(transaction)).toMatchObject({ status: 'REFUNDED', hasAdjustment: true });
  });

  it('accepts a void result and does not treat it as a cash refund', () => {
    expect(financeTransactionCancellationSchema.parse({ cancelled: true, adjustmentKind: 'VOID', reversalId: id })).toMatchObject({
      cancelled: true,
      adjustmentKind: 'VOID'
    });
    expect(financeTransactionCancellationSchema.parse({ cancelled: true, adjustmentKind: null, reversalId: null })).toMatchObject({
      cancelled: true,
      adjustmentKind: null
    });
  });

  it('requires a separately identified refund adjustment', () => {
    expect(financeTransactionRefundSchema.safeParse({ refunded: true, adjustmentId: id }).success).toBe(true);
    expect(financeTransactionRefundSchema.safeParse({ cancelled: true, reversalId: id }).success).toBe(false);
  });

  it('accepts a company-scoped customer/supplier contract and rejects unsupported fields', () => {
    const linked = { ...transaction, counterpartyId: id, counterparty: { id, name: 'Fornecedor Exemplo', role: 'SUPPLIER' } };
    expect(financeTransactionSchema.parse(linked).counterparty).toMatchObject({ id, role: 'SUPPLIER' });
    expect(financeCounterpartySchema.safeParse({ id, name: 'Exemplo', role: 'BOTH', companyId: id }).success).toBe(false);
  });
});
