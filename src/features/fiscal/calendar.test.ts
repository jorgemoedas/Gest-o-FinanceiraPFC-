import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFiscalObligation, generateDefaultFiscalCalendar, getFiscalCalendar } from './calendar';

const item = { id: 'f47ac10b-58cc-11cf-a447-001122334455', companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8', kind: 'MANUAL', title: 'Entrega', description: null, dueAt: '2026-12-20T00:00:00.000Z', status: 'PENDING', source: 'MANUAL', periodKey: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', isOverdue: false, daysUntilDue: 5, version: 1 };
const query = { from: '2026-12-01T00:00:00.000Z', to: '2026-12-31T23:59:59.999Z' };

afterEach(() => vi.unstubAllGlobals());

describe('fiscal calendar client', () => {
  it('valida e consulta o calendário no caminho relativo com same-origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [item], summary: { pending: 1, overdue: 0, dueSoon: 1, done: 0 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getFiscalCalendar(query)).resolves.toEqual(expect.objectContaining({ items: [item] }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/fiscal/calendar?'), expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
  });

  it('usa schemas estritos para criação e geração', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(item), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ created: 2, skipped: 1 }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createFiscalObligation({ kind: 'MANUAL', title: 'Entrega', dueAt: item.dueAt })).resolves.toEqual(item);
    await expect(generateDefaultFiscalCalendar({ regime: 'MEI', ...query })).resolves.toEqual({ created: 2, skipped: 1 });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1] && (fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual(expect.objectContaining({ kind: 'MANUAL' }));
    await expect(getFiscalCalendar({ ...query, status: 'PENDING', extra: true } as never)).rejects.toThrow();
  });
});
