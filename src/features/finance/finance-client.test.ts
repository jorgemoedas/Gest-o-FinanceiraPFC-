import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFinanceCounterparties } from './finance-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getFinanceCounterparties', () => {
  it('encodes role, search and pagination and returns the page metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      page: 2,
      limit: 100,
      total: 101,
      totalPages: 2,
      items: [{ id: '5d2a9a0e-339a-470e-9cc0-4624044cae86', name: 'Cliente', role: 'CUSTOMER' }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getFinanceCounterparties({ page: 2, limit: 100, role: 'CUSTOMER', search: 'Clínica São José' })).resolves.toEqual({
      page: 2,
      limit: 100,
      total: 101,
      totalPages: 2,
      items: [{ id: '5d2a9a0e-339a-470e-9cc0-4624044cae86', name: 'Cliente', role: 'CUSTOMER' }]
    });

    const [requestPath] = fetchMock.mock.calls[0] as [string];
    const url = new URL(requestPath, 'https://app.example');
    expect(url.pathname).toBe('/api/finance/counterparties');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('role')).toBe('CUSTOMER');
    expect(url.searchParams.get('search')).toBe('Clínica São José');
  });
});
