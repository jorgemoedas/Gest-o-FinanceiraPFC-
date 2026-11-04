import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ACCESS_TOKEN_COOKIE, isSameOriginMutation, requestNest } from '@/lib/auth-proxy';
import { POST } from './route';

vi.mock('@/lib/auth-proxy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-proxy')>('@/lib/auth-proxy');
  return { ...actual, isSameOriginMutation: vi.fn(), requestNest: vi.fn() };
});

function request(body: unknown, token = 'token') {
  const headers = new Headers({ origin: 'https://app.example.test', 'content-type': 'application/json' });
  if (token) headers.set('cookie', `${ACCESS_TOKEN_COOKIE}=${token}`);
  return new NextRequest('https://app.example.test/api/finance/recurrences/run', { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('POST /api/finance/recurrences/run', () => {
  beforeEach(() => {
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    vi.mocked(requestNest).mockResolvedValue({ status: 200, ok: true, payload: { generated: 1, skipped: 0, items: [{ id: 'f47ac10b-58cc-11cf-a447-001122334455', recurrenceId: 'f47ac10b-58cc-11cf-a447-001122334455', occurredAt: '2026-01-01T00:00:00.000Z' }] }, requestId: 'test-correlation', correlationId: 'test-correlation' });
  });

  it('requires same origin and validates until', async () => {
    vi.mocked(isSameOriginMutation).mockReturnValue(false);
    expect((await POST(request({ until: '2026-12-31T00:00:00.000Z' }))).status).toBe(403);
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    expect((await POST(request({ until: 'invalid' }))).status).toBe(400);
    expect(requestNest).not.toHaveBeenCalled();
  });

  it('forwards the authenticated materialization request', async () => {
    const result = await POST(request({ until: '2026-12-31T00:00:00.000Z' }));
    expect(result.status).toBe(200);
    expect(requestNest).toHaveBeenCalledWith('/finance/recurrences/run', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }));
  });
});
