import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { ACCESS_TOKEN_COOKIE, isSameOriginMutation, requestNest } from '@/lib/auth-proxy';

vi.mock('@/lib/auth-proxy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-proxy')>('@/lib/auth-proxy');
  return { ...actual, isSameOriginMutation: vi.fn(), requestNest: vi.fn() };
});

function request(payload: unknown, token = 'access-token') {
  return new NextRequest('https://app.example.test/api/privacy/erase', { method: 'POST', headers: { origin: 'https://app.example.test', 'content-type': 'application/json', cookie: `${ACCESS_TOKEN_COOKIE}=${token}` }, body: JSON.stringify(payload) });
}

describe('POST /api/privacy/erase', () => {
  beforeEach(() => {
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    vi.mocked(requestNest).mockResolvedValue({ status: 200, ok: true, payload: { erased: true, retained: ['lançamentos'] }, requestId: 'test-correlation', correlationId: 'test-correlation' });
  });

  it('exige confirmação textual exata antes do upstream', async () => {
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    expect((await POST(request({ confirmation: 'apagar' }))).status).toBe(400);
    expect(requestNest).not.toHaveBeenCalled();
  });

  it('encaminha sessão e retorna resposta de eliminação', async () => {
    const result = await POST(request({ confirmation: 'ELIMINAR MEUS DADOS' }));
    expect(result.status).toBe(200);
    expect(requestNest).toHaveBeenCalledWith('/privacy/erase', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-token' }) }));
  });
});
