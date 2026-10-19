import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  accessCookieOptions,
  apiErrorResponse,
  authApiUrl,
  isSameOriginMutation,
  isSameOriginRequest,
  readJsonBody,
  requestNest
} from './auth-proxy';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function proxiedRequest(headers: Record<string, string>) {
  return new NextRequest('https://0.0.0.0:3000/api/auth/login', { headers });
}

describe('isSameOriginMutation', () => {
  it('accepts same-origin requests whose Preview proxy normalizes Origin to its internal host', () => {
    vi.stubEnv('APP_ORIGIN', 'https://preview.example');
    expect(isSameOriginMutation(proxiedRequest({
      origin: 'http://127.0.0.1:3000',
      host: '127.0.0.1:3000',
      'x-forwarded-host': 'preview.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin'
    }))).toBe(true);
  });

  it('accepts an exact local HTTP origin', () => {
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
    expect(isSameOriginMutation(new NextRequest('http://localhost:3000/api/auth/login', {
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'sec-fetch-site': 'same-origin'
      }
    }))).toBe(true);
  });

  it('rejects a cross-site request even if its Origin was normalized by the proxy', () => {
    vi.stubEnv('APP_ORIGIN', 'https://preview.example');
    expect(isSameOriginMutation(proxiedRequest({
      origin: 'http://127.0.0.1:3000',
      host: '127.0.0.1:3000',
      'x-forwarded-host': 'preview.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'cross-site'
    }))).toBe(false);
  });

  it('rejects a public forwarded host that does not match APP_ORIGIN', () => {
    vi.stubEnv('APP_ORIGIN', 'https://preview.example');
    expect(isSameOriginMutation(proxiedRequest({
      origin: 'http://127.0.0.1:3000',
      host: '127.0.0.1:3000',
      'x-forwarded-host': 'attacker.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin'
    }))).toBe(false);
  });

  it('rejects requests with a missing Origin', () => {
    vi.stubEnv('APP_ORIGIN', 'https://preview.example');
    expect(isSameOriginMutation(proxiedRequest({
      host: '127.0.0.1:3000',
      'x-forwarded-host': 'preview.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin'
    }))).toBe(false);
  });

  it('accepts a same-origin CNPJ GET when the browser omits Origin but Fetch Metadata and trusted Preview origin match', () => {
    vi.stubEnv('APP_ORIGIN', 'https://preview.example');
    expect(isSameOriginRequest(proxiedRequest({
      host: '127.0.0.1:3000',
      'x-forwarded-host': 'preview.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin'
    }))).toBe(true);
  });

  it('rejects cross-site CNPJ GET requests even without an Origin header', () => {
    vi.stubEnv('APP_ORIGIN', 'https://preview.example');
    expect(isSameOriginRequest(proxiedRequest({
      host: '127.0.0.1:3000',
      'x-forwarded-host': 'preview.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'cross-site'
    }))).toBe(false);
  });
});

describe('auth proxy helpers', () => {
  it('uses Secure/HttpOnly/SameSite=None for the HTTPS Preview cookie', () => {
    vi.stubEnv('AUTH_COOKIE_SECURE', 'true');
    expect(accessCookieOptions(60)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'none', path: '/', maxAge: 60 });
  });

  it('keeps plain-HTTP local cookies usable only when explicitly configured', () => {
    vi.stubEnv('AUTH_COOKIE_SECURE', 'false');
    expect(accessCookieOptions(60)).toMatchObject({ httpOnly: true, secure: false, sameSite: 'lax' });
  });

  it('constructs only the configured server-side Nest URL', () => {
    vi.stubEnv('AUTH_API_BASE_URL', ' https://nest.example/api/v1/// ');
    expect(authApiUrl('/auth/me')).toBe('https://nest.example/api/v1/auth/me');
    vi.stubEnv('AUTH_API_BASE_URL', ' ');
    expect(authApiUrl('/auth/me')).toBeNull();
  });

  it('returns a bounded 503 response when the Nest URL is absent', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', '');
    await expect(requestNest('/auth/me')).resolves.toMatchObject({
      status: 503,
      ok: false,
      payload: { message: expect.stringContaining('AUTH_API_BASE_URL') }
    });
  });

  it('forwards a no-store JSON request and parses a valid Nest response', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestNest('/auth/me', { method: 'GET' })).resolves.toMatchObject({ status: 200, ok: true, payload: { ok: true } });
    expect(fetchMock).toHaveBeenCalledWith('https://nest.example/api/v1/auth/me', expect.objectContaining({ cache: 'no-store' }));
  });

  it('maps upstream network failures to a bounded 503', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private upstream detail')));
    await expect(requestNest('/auth/me')).resolves.toMatchObject({ status: 503, ok: false });
  });

  it('sanitizes API errors into a no-store JSON response', async () => {
    const response = apiErrorResponse({ message: 'Credenciais inválidas' }, 401);
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ message: 'Credenciais inválidas' });
  });

  it('distinguishes valid JSON bodies from malformed JSON', async () => {
    const valid = await readJsonBody(new NextRequest('http://localhost/api', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ok":true}'
    }));
    const invalid = await readJsonBody(new NextRequest('http://localhost/api', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not-json'
    }));
    expect(valid).toEqual({ ok: true, body: { ok: true } });
    expect(invalid).toEqual({ ok: false });
  });
});
