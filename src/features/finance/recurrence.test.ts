import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFinanceRecurrence, listFinanceRecurrences, runDueFinanceRecurrences, setFinanceRecurrenceActive } from './recurrence';

const id = 'f47ac10b-58cc-11cf-a447-001122334455';
const recurrence = {
  id,
  type: 'INCOME',
  category: 'SALES',
  subcategory: null,
  description: 'Mensalidade',
  amount: 100,
  counterpartyId: null,
  frequency: 'MONTHLY',
  intervalCount: 1,
  startDate: '2026-01-31T00:00:00.000Z',
  endDate: null,
  nextRunAt: '2026-02-28T00:00:00.000Z',
  lastRunAt: null,
  isActive: true,
  version: 1
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('finance recurrence client', () => {
  it('lists with a relative path and same-origin credentials', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ page: 1, limit: 50, total: 1, totalPages: 1, items: [recurrence] }), { status: 200 }));
    await listFinanceRecurrences();
    expect(fetchMock).toHaveBeenCalledWith('/api/finance/recurrences?page=1&limit=50', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('validates requests and forwards create and active mutations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...recurrence, isActive: false, version: 2 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...recurrence, isActive: false, version: 2 }), { status: 200 }));
    await createFinanceRecurrence({ type: 'INCOME', category: 'SALES', description: 'Mensalidade', amount: 100, frequency: 'MONTHLY', intervalCount: 1, startDate: recurrence.startDate });
    await setFinanceRecurrenceActive(id, false, 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/finance/recurrences/${id}`);
  });

  it('returns Portuguese upstream messages and validates materialization response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ message: 'Versão desatualizada.' }), { status: 409 }));
    await expect(runDueFinanceRecurrences('2026-12-31T00:00:00.000Z')).rejects.toThrow('Versão desatualizada.');
  });
});
