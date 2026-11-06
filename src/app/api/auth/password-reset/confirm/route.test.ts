import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { isSameOriginMutation, requestNest } from '@/lib/auth-proxy';

vi.mock('@/lib/auth-proxy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-proxy')>('@/lib/auth-proxy');
  return { ...actual, isSameOriginMutation: vi.fn(), requestNest: vi.fn() };
});

function request(payload: unknown) {
  return new NextRequest('https://app.example.test/api/auth/password-reset/confirm', {
    method: 'POST',
    headers: { origin: 'https://app.example.test', 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

describe('POST /api/auth/password-reset/confirm', () => {
  beforeEach(() => {
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    vi.mocked(requestNest).mockResolvedValue({ status: 200, ok: true, payload: { reset: true }, requestId: 'test-correlation', correlationId: 'test-correlation' });
  });

  it('valida token e senha antes do encaminhamento', async () => {
    expect((await POST(request({ token: '', newPassword: 'curta' }))).status).toBe(400);
    expect(requestNest).not.toHaveBeenCalled();
  });

  it('encaminha confirmação e propaga sucesso', async () => {
    const result = await POST(request({ token: 'raw-token', newPassword: 'senha-nova-segura' }));
    expect(result.status).toBe(200);
    expect(requestNest).toHaveBeenCalledWith('/auth/password-reset/confirm', expect.objectContaining({ method: 'POST' }));
  });
});
