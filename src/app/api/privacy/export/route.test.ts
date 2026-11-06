import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { ACCESS_TOKEN_COOKIE, isSameOriginRequest, requestNest } from '@/lib/auth-proxy';

vi.mock('@/lib/auth-proxy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-proxy')>('@/lib/auth-proxy');
  return { ...actual, isSameOriginRequest: vi.fn(), requestNest: vi.fn() };
});

const payload = { generatedAt: '2026-10-21T00:00:00.000Z', subject: { userId: 'u', email: 'a@b.test' }, memberships: [], acceptances: [], authoredTransactions: [], auditEvents: [] };
function request(token = 'access-token') {
  return new NextRequest('https://app.example.test/api/privacy/export', { headers: { 'sec-fetch-site': 'same-origin', cookie: `${ACCESS_TOKEN_COOKIE}=${token}` } });
}

describe('GET /api/privacy/export', () => {
  beforeEach(() => {
    vi.mocked(isSameOriginRequest).mockReturnValue(true);
    vi.mocked(requestNest).mockResolvedValue({ status: 200, ok: true, payload, requestId: 'test-correlation', correlationId: 'test-correlation' });
  });

  it('exige mesma origem e sessão', async () => {
    vi.mocked(isSameOriginRequest).mockReturnValue(false);
    expect((await GET(request())).status).toBe(403);
    vi.mocked(isSameOriginRequest).mockReturnValue(true);
    expect((await GET(request(''))).status).toBe(401);
  });

  it('encaminha bearer e devolve JSON como attachment', async () => {
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(result.headers.get('content-disposition')).toContain('attachment');
    expect(requestNest).toHaveBeenCalledWith('/privacy/export', expect.objectContaining({ headers: { Authorization: 'Bearer access-token' } }));
  });
});
