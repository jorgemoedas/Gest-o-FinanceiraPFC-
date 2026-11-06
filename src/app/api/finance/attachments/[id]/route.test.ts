import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE, GET } from './route';

const id = 'f47ac10b-58cc-11cf-a447-001122334456';

function request(method: 'GET' | 'DELETE', options: { cookie?: string; origin?: string } = {}) {
  const headers = new Headers({ host: 'localhost:3000', 'sec-fetch-site': 'same-origin' });
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.origin) headers.set('origin', options.origin);
  return new NextRequest(`http://localhost:3000/api/finance/attachments/${id}`, { method, headers });
}

const context = { params: Promise.resolve({ id }) };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('finance attachment item BFF', () => {
  it('streams a successful download and preserves content headers', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    const fetchMock = vi.fn().mockResolvedValue(new Response('arquivo', {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="nota.pdf"',
        'content-length': '7'
      }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(request('GET', { cookie: 'gft_access_token=session-token' }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="nota.pdf"');
    await expect(response.text()).resolves.toBe('arquivo');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://nest.example/api/v1/finance/attachments/${id}`);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer session-token');
  });

  it('forwards delete and validates its response', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ removed: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await DELETE(request('DELETE', { cookie: 'gft_access_token=session-token', origin: 'http://localhost:3000' }), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ removed: true });
    expect(fetchMock).toHaveBeenCalledWith(`https://nest.example/api/v1/finance/attachments/${id}`, expect.objectContaining({ method: 'DELETE' }));
  });

  it('rejects invalid ids and cross-origin deletion', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invalid = await GET(request('GET', { cookie: 'gft_access_token=session-token' }), { params: Promise.resolve({ id: 'bad' }) });
    expect(invalid.status).toBe(400);
    const crossOrigin = await DELETE(request('DELETE', { cookie: 'gft_access_token=session-token', origin: 'https://attacker.example' }), context);
    expect(crossOrigin.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
