import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { isSameOriginMutation, requestNest } from '@/lib/auth-proxy';

vi.mock('@/lib/auth-proxy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-proxy')>('@/lib/auth-proxy');
  return { ...actual, isSameOriginMutation: vi.fn(), requestNest: vi.fn() };
});

function request(payload: unknown) {
  return new NextRequest('https://app.example.test/api/auth/password-reset', {
    method: 'POST',
    headers: { origin: 'https://app.example.test', 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

describe('POST /api/auth/password-reset', () => {
  beforeEach(() => {
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    vi.mocked(requestNest).mockResolvedValue({ status: 200, ok: true, payload: { delivered: false }, requestId: 'test-correlation', correlationId: 'test-correlation' });
  });

  it('recusa origem e payload inválidos antes do Nest', async () => {
    vi.mocked(isSameOriginMutation).mockReturnValue(false);
    expect((await POST(request({ email: 'a@b.test' }))).status).toBe(403);
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    expect((await POST(request({ email: 'inválido' }))).status).toBe(400);
    expect(requestNest).not.toHaveBeenCalled();
  });

  it('encaminha payload validado e retorna resposta neutra', async () => {
    const result = await POST(request({ email: 'pessoa@empresa.test' }));
    expect(result.status).toBe(200);
    expect(requestNest).toHaveBeenCalledWith('/auth/password-reset', expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'pessoa@empresa.test' }) }));
  });
});
