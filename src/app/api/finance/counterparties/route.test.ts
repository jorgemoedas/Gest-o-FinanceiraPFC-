import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function request(method: 'GET' | 'POST', options: { cookie?: string; query?: string; origin?: string; fetchSite?: string; body?: string } = {}) {
  const headers = new Headers({
    host: 'localhost:3000',
    'sec-fetch-site': options.fetchSite ?? 'same-origin'
  });
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.origin) headers.set('origin', options.origin);
  if (method === 'POST') headers.set('content-type', 'application/json');
  return new NextRequest(`http://localhost:3000/api/finance/counterparties${options.query ?? ''}`, {
    method,
    headers,
    ...(options.body ? { body: options.body } : {})
  });
}

const listed = { page: 1, limit: 100, total: 1, totalPages: 1, items: [{
  id: '5d2a9a0e-339a-470e-9cc0-4624044cae86',
  name: 'Clínica São José',
  role: 'CUSTOMER'
}] };

describe('finance counterparties BFF', () => {
  it('rejects list requests without a session and does not call Nest', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request('GET'));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards authenticated role and search filters and validates the API response', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(listed), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request('GET', {
      cookie: 'gft_access_token=session-token',
      query: '?role=CUSTOMER&search=Cl%C3%ADnica'
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(listed);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsedUrl = new URL(url);
    expect(parsedUrl.pathname).toBe('/api/v1/finance/counterparties');
    expect(parsedUrl.searchParams.get('role')).toBe('CUSTOMER');
    expect(parsedUrl.searchParams.get('search')).toBe('Clínica');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer session-token');
  });

  it('rejects cross-origin creation before accessing the session or Nest', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request('POST', {
      cookie: 'gft_access_token=session-token',
      origin: 'https://attacker.example',
      fetchSite: 'cross-site',
      body: JSON.stringify({ name: 'Cliente', role: 'CUSTOMER' })
    }));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid input without forwarding it to Nest', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request('POST', {
      cookie: 'gft_access_token=session-token',
      origin: 'http://localhost:3000',
      body: JSON.stringify({ name: ' ', role: 'READ_ONLY' })
    }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards a normalized authenticated creation and validates the API response', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
    const created = listed.items[0];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(created), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request('POST', {
      cookie: 'gft_access_token=session-token',
      origin: 'http://localhost:3000',
      body: JSON.stringify({ name: '  Clínica São José  ', role: 'CUSTOMER' })
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(created);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://nest.example/api/v1/finance/counterparties');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer session-token');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Clínica São José', role: 'CUSTOMER' });
  });

  it('forwards only the optional CNPJ along with name and role', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(listed.items[0]), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request('POST', {
      cookie: 'gft_access_token=session-token',
      origin: 'http://localhost:3000',
      body: JSON.stringify({
        name: 'Clínica São José',
        role: 'CUSTOMER',
        cnpj: '11.378.117/0001-20'
      })
    }));

    expect(response.status).toBe(201);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Clínica São José',
      role: 'CUSTOMER',
      cnpj: '11378117000120'
    });
  });

  it('rejects arbitrary address data instead of forwarding it to Nest', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request('POST', {
      cookie: 'gft_access_token=session-token',
      origin: 'http://localhost:3000',
      body: JSON.stringify({
        name: 'Clínica São José',
        role: 'CUSTOMER',
        address: { street: 'não aceitar' }
      })
    }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a gateway error when the API response does not match the public schema', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"unexpected":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request('POST', {
      cookie: 'gft_access_token=session-token',
      origin: 'http://localhost:3000',
      body: JSON.stringify({ name: 'Cliente', role: 'CUSTOMER' })
    }));

    expect(response.status).toBe(502);
  });
});
