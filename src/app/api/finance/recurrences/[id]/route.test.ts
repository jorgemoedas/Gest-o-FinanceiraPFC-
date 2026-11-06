import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ACCESS_TOKEN_COOKIE, isSameOriginMutation, requestNest } from '@/lib/auth-proxy';
import { PATCH } from './route';

vi.mock('@/lib/auth-proxy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-proxy')>('@/lib/auth-proxy');
  return { ...actual, isSameOriginMutation: vi.fn(), requestNest: vi.fn() };
});

const id = 'f47ac10b-58cc-11cf-a447-001122334455';
const response = { id, type: 'INCOME', category: 'SALES', subcategory: null, description: 'Mensalidade', amount: 100, counterpartyId: null, frequency: 'MONTHLY', intervalCount: 1, startDate: '2026-01-01T00:00:00.000Z', endDate: null, nextRunAt: '2026-02-01T00:00:00.000Z', lastRunAt: null, isActive: false, version: 2 };

function request(body: unknown, path = `/api/finance/recurrences/${id}`) {
  const headers = new Headers({ origin: 'https://app.example.test', 'content-type': 'application/json', cookie: `${ACCESS_TOKEN_COOKIE}=token` });
  return new NextRequest(`https://app.example.test${path}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
}

describe('PATCH /api/finance/recurrences/[id]', () => {
  beforeEach(() => {
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    vi.mocked(requestNest).mockResolvedValue({ status: 200, ok: true, payload: response, requestId: 'test-correlation', correlationId: 'test-correlation' });
  });

  it('rejects cross-origin and invalid ids before forwarding', async () => {
    vi.mocked(isSameOriginMutation).mockReturnValue(false);
    expect((await PATCH(request({ isActive: false, version: 1 }), { params: Promise.resolve({ id }) })).status).toBe(403);
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    expect((await PATCH(request({ isActive: false, version: 1 }, '/api/finance/recurrences/not-an-id'), { params: Promise.resolve({ id: 'not-an-id' }) })).status).toBe(400);
    expect(requestNest).not.toHaveBeenCalled();
  });

  it('forwards optimistic active changes and propagates upstream status', async () => {
    const result = await PATCH(request({ isActive: false, version: 1 }), { params: Promise.resolve({ id }) });
    expect(result.status).toBe(200);
    expect(requestNest).toHaveBeenCalledWith(`/finance/recurrences/${id}`, expect.objectContaining({ method: 'PATCH' }));
  });
});
