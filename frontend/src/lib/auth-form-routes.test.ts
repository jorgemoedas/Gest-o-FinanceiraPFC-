import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as login } from '../app/api/auth/login/route';
import { POST as register } from '../app/api/auth/register/route';
import { authFormRedirect, readAuthRequestBody } from './auth-proxy';

const authResponse = {
  accessToken: 'synthetic-test-token', tokenType: 'Bearer', expiresInSeconds: 900,
  user: { id: 'u1', email: 'demo@example.invalid', companyId: 'c1', companyName: 'Empresa demonstrativa', role: 'OWNER' }
};
const values = {
  email: 'demo@example.invalid', password: 'Senha-sintetica-123', companyName: 'Empresa demonstrativa',
  acceptedTerms: 'on', acceptedPrivacy: 'on', termsVersion: '2026-10-01', privacyVersion: '2026-10-01'
};
function form(path: string, data: Record<string, string>, site = 'same-origin') {
  return new NextRequest(`https://preview.example/api/auth/${path}`, {
    method: 'POST',
    headers: { origin: 'https://preview.example', host: 'preview.example', 'x-forwarded-proto': 'https',
      'sec-fetch-site': site, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString()
  });
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', 'https://preview.example');
  vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
  vi.stubEnv('AUTH_COOKIE_SECURE', 'true');
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(authResponse), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('native authentication POST fallback', () => {
  it('parses only login fields without adding registration consent fields', async () => {
    const result = await readAuthRequestBody(form('login', { email: values.email, password: values.password }));
    expect(result).toEqual({ ok: true, body: { email: values.email, password: values.password } });
  });
  it('logs in with URL-encoded body and redirects without exposing credentials or token', async () => {
    const response = await login(form('login', { email: values.email, password: values.password }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/dashboard');
    expect(await response.text()).toBe('');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(response.headers.get('set-cookie')).toContain('SameSite=none');
    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body)).toEqual({ email: values.email, password: values.password });
  });
  it('registers with explicit consent booleans and versions, then redirects', async () => {
    const response = await register(form('register', values));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/dashboard');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ acceptedTerms: true, acceptedPrivacy: true });
  });
  it('rejects missing privacy consent before contacting NestJS', async () => {
    const { acceptedPrivacy: _, ...input } = values;
    const response = await register(form('register', input));
    expect(response.headers.get('location')).toBe('/register?error=invalid-form');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not treat a false consent value as acceptance', async () => {
    const response = await register(form('register', { ...values, acceptedTerms: 'false' }));
    expect(response.headers.get('location')).toBe('/register?error=invalid-form');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects cross-site native POSTs before contacting NestJS', async () => {
    const response = await login(form('login', { email: values.email, password: values.password }, 'cross-site'));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('returns a bounded error code for rejected credentials', async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"invalid"}', { status: 401 }));
    const response = await login(form('login', { email: values.email, password: values.password }));
    expect(response.headers.get('location')).toBe('/login?error=invalid-credentials');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('returns an email-exists code without reflecting registration values', async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"duplicate"}', { status: 409 }));
    const response = await register(form('register', values));
    expect(response.headers.get('location')).toBe('/register?error=email-exists');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('keeps React JSON login compatible and omits the JWT from its body', async () => {
    const request = form('login', {});
    const response = await login(new NextRequest(request.url, {
      method: 'POST', headers: { ...Object.fromEntries(request.headers.entries()), 'content-type': 'application/json' },
      body: JSON.stringify({ email: values.email, password: values.password })
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: authResponse.user, expiresInSeconds: 900 });
  });
  it('refuses non-relative redirects', () => {
    expect(() => authFormRedirect('https://attacker.example')).toThrow();
    expect(() => authFormRedirect('//attacker.example')).toThrow();
  });
});

describe('native fallback upstream error feedback', () => {
  it('instructs reloading and renewing legal acceptance after upstream 400', async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"documents updated"}', { status: 400 }));
    const response = await register(form('register', values));
    expect(response.headers.get('location')).toBe('/register?error=documents-updated');
  });
  it('distinguishes the login rate limit', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    const response = await login(form('login', { email: values.email, password: values.password }));
    expect(response.headers.get('location')).toBe('/login?error=rate-limited');
  });
  it('distinguishes the registration rate limit', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    const response = await register(form('register', values));
    expect(response.headers.get('location')).toBe('/register?error=rate-limited');
  });
  it('maps an upstream abort to a visible error with no cookie', async () => {
    fetchMock.mockRejectedValue(new DOMException('synthetic timeout', 'TimeoutError'));
    const response = await login(form('login', { email: values.email, password: values.password }));
    expect(response.headers.get('location')).toBe('/login?error=service-unavailable');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
