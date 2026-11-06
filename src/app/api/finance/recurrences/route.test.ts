import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ACCESS_TOKEN_COOKIE, isSameOriginMutation, requestNest } from '@/lib/auth-proxy';
import { GET, POST } from './route';

vi.mock('@/lib/auth-proxy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-proxy')>('@/lib/auth-proxy');
  return { ...actual, isSameOriginMutation: vi.fn(), requestNest: vi.fn() };
});

const id = 'f47ac10b-58cc-11cf-a447-001122334455';
const response = { page: 1, limit: 50, total: 1, totalPages: 1, items: [{ id, type: 'INCOME', category: 'SALES', subcategory: null, description: 'Mensalidade', amount: 100, counterpartyId: null, frequency: 'MONTHLY', intervalCount: 1, startDate: '2026-01-01T00:00:00.000Z', endDate: null, nextRunAt: '2026-02-01T00:00:00.000Z', lastRunAt: null, isActive: true, version: 1 }] };
const createBody = { type: 'INCOME', category: 'SALES', description: 'Mensalidade', amount: 100, frequency: 'MONTHLY', intervalCount: 1, startDate: '2026-01-01T00:00:00.000Z' };

function request(method: string, path: string, body?: unknown, token = 'token') {
  const headers = new Headers({ origin: 'https://app.example.test', 'content-type': 'application/json' });
  if (token) headers.set('cookie', `${ACCESS_TOKEN_COOKIE}=${token}`);
  return new NextRequest(`https://app.example.test${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe('recurrences BFF collection', () => {
  beforeEach(() => {
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    vi.mocked(requestNest).mockResolvedValue({ status: 200, ok: true, payload: response, requestId: 'test-correlation', correlationId: 'test-correlation' });
  });

  it('requires a session for reads and validates create mutations', async () => {
    expect((await GET(request('GET', '/api/finance/recurrences', undefined, ''))).status).toBe(401);
    expect((await POST(request('POST', '/api/finance/recurrences', { ...createBody, companyId: id }))).status).toBe(400);
    expect(requestNest).not.toHaveBeenCalled();
  });

  it('forwards only the validated tenant-independent payload', async () => {
    vi.mocked(requestNest).mockResolvedValue({ status: 201, ok: true, payload: response.items[0], requestId: 'test-correlation', correlationId: 'test-correlation' });
    const result = await POST(request('POST', '/api/finance/recurrences', createBody));
    expect(result.status).toBe(201);
    expect(requestNest).toHaveBeenCalledWith('/finance/recurrences', expect.objectContaining({ body: JSON.stringify(createBody) }));
  });
});
