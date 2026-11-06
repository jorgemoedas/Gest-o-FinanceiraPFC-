import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from './route';
import { ACCESS_TOKEN_COOKIE, isSameOriginMutation, requestNest } from '@/lib/auth-proxy';

vi.mock('@/lib/auth-proxy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-proxy')>('@/lib/auth-proxy');
  return { ...actual, isSameOriginMutation: vi.fn(), requestNest: vi.fn() };
});

const id = 'f47ac10b-58cc-11cf-a447-001122334455';
const body = { items: [{ id, version: 2 }], changes: { category: 'OTHER' } };
const response = { items: [{ id, type: 'EXPENSE', category: 'OTHER', subcategory: null, counterpartyId: null, counterparty: null, description: 'Conta', amount: 10, occurredAt: '2026-10-01T00:00:00.000Z', dueAt: null, status: 'PAID', hasAdjustment: false, version: 3 }] };

function request(payload: unknown = body, token = 'token') {
  const headers = new Headers({ origin: 'https://app.example.test', 'content-type': 'application/json' });
  if (token) headers.set('cookie', `${ACCESS_TOKEN_COOKIE}=${token}`);
  return new NextRequest('https://app.example.test/api/finance/transactions/bulk', {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload)
  });
}

describe('PATCH /api/finance/transactions/bulk', () => {
  beforeEach(() => {
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    vi.mocked(requestNest).mockResolvedValue({ status: 200, ok: true, payload: response, requestId: 'test-correlation', correlationId: 'test-correlation' });
  });

  it('requires same origin before forwarding a mutation', async () => {
    vi.mocked(isSameOriginMutation).mockReturnValue(false);
    const result = await PATCH(request());
    expect(result.status).toBe(403);
    expect(requestNest).not.toHaveBeenCalled();
  });

  it('requires the BFF session and validates the request', async () => {
    expect((await PATCH(request(body, ''))).status).toBe(401);
    expect((await PATCH(request({ items: [], changes: {} }))).status).toBe(400);
    expect(requestNest).not.toHaveBeenCalled();
  });

  it('forwards bearer session and returns only a validated upstream response', async () => {
    const result = await PATCH(request());
    expect(result.status).toBe(200);
    expect(requestNest).toHaveBeenCalledWith('/finance/transactions/bulk', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }));
  });
});
