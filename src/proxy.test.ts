import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

function expiredJwt() {
  return `x.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.x`;
}
const request = () => new NextRequest('https://app.example.test/api/finance/transactions', {
  headers: { cookie: `gft_access_token=${expiredJwt()}; gft_refresh_token=opaque-secret` }
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('proxy de renovação de sessão', () => {
  it('renova de forma transparente e encaminha a nova sessão', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://api.example.test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ accessToken: 'new.jwt', refreshToken: 'new-opaque', expiresInSeconds: 600 }), { status: 200 })));
    const response = await proxy(request());
    expect(response.headers.get('set-cookie')).toContain('gft_access_token=new.jwt');
    expect(response.headers.get('set-cookie')).toContain('gft_refresh_token=new-opaque');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=none');
    expect(fetch).toHaveBeenCalledWith('https://api.example.test/auth/refresh', expect.objectContaining({ method: 'POST' }));
  });
  it('limpa os cookies se a API recusar a renovação', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://api.example.test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const response = await proxy(request());
    expect(response.headers.get('set-cookie')).toContain('gft_access_token=');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response.headers.get('set-cookie')).toContain('gft_refresh_token=');
  });
});
