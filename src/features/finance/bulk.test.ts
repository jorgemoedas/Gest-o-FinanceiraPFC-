import { afterEach, describe, expect, it, vi } from 'vitest';
import { bulkUpdateFinanceTransactions, bulkUpdateTransactionsRequestSchema } from './bulk';

const id = 'f47ac10b-58cc-11cf-a447-001122334455';
const transaction = {
  id,
  type: 'EXPENSE',
  category: 'OTHER',
  subcategory: null,
  counterpartyId: null,
  counterparty: null,
  description: 'Aluguel',
  amount: 100,
  occurredAt: '2026-10-01T00:00:00.000Z',
  dueAt: null,
  status: 'PAID',
  hasAdjustment: false,
  version: 3
};

afterEach(() => vi.restoreAllMocks());

describe('bulk finance contract', () => {
  it('accepts supported changes and rejects duplicates or over-limit payloads', () => {
    expect(bulkUpdateTransactionsRequestSchema.safeParse({ items: [{ id, version: 2 }], changes: { category: 'OTHER' } }).success).toBe(true);
    expect(bulkUpdateTransactionsRequestSchema.safeParse({ items: [{ id, version: 2 }, { id, version: 2 }], changes: { status: 'PAID' } }).success).toBe(false);
    expect(bulkUpdateTransactionsRequestSchema.safeParse({ items: Array.from({ length: 101 }, (_, index) => ({ id: `f47ac10b-58cc-11cf-a447-${String(index).padStart(12, '0')}`, version: 1 })), changes: { status: 'PAID' } }).success).toBe(false);
  });

  it('sends a PATCH to the BFF and validates its response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [transaction] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const result = await bulkUpdateFinanceTransactions({ items: [{ id, version: 2 }], changes: { category: 'OTHER' } });
    expect(fetchMock).toHaveBeenCalledWith('/api/finance/transactions/bulk', expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"version":2') }));
    expect(result.items[0].version).toBe(3);
  });

  it('surfaces an upstream conflict', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ message: 'Conflito de versão.' }), { status: 409 }));
    await expect(bulkUpdateFinanceTransactions({ items: [{ id, version: 2 }], changes: { status: 'PAID' } })).rejects.toThrow('Conflito de versão.');
  });
});
