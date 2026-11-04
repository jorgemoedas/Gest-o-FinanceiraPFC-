import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function request(method: 'GET' | 'POST', options: { cookie?: string; body?: string; origin?: string } = {}) {
  const headers = new Headers({ host: 'localhost:3000', 'sec-fetch-site': 'same-origin' });
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.origin) headers.set('origin', options.origin);
  if (method === 'POST') headers.set('content-type', 'application/json');
  return new NextRequest(`http://localhost:3000/api/fiscal/calendar${method === 'GET' ? '?from=2026-12-01T00:00:00.000Z&to=2026-12-31T23:59:59.999Z' : ''}`, { method, headers, ...(options.body ? { body: options.body } : {}) });
}

const item = { id: 'f47ac10b-58cc-11cf-a447-001122334455', companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8', kind: 'MANUAL', title: 'Entrega', description: null, dueAt: '2026-12-20T00:00:00.000Z', status: 'PENDING', source: 'MANUAL', periodKey: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', isOverdue: false, daysUntilDue: 5, version: 1 };

describe('fiscal calendar BFF', () => {
  it('recusa sessão ausente sem chamar Nest', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect((await GET(request('GET'))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('valida origem e payload antes de encaminhar criação', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect((await POST(request('POST', { cookie: 'gft_access_token=x', origin: 'https://attacker.example', body: JSON.stringify({ kind: 'MANUAL', title: 'x', dueAt: item.dueAt }) }))).status).toBe(403);
    expect((await POST(request('POST', { cookie: 'gft_access_token=x', origin: 'http://localhost:3000', body: JSON.stringify({ companyId: 'não aceitar' }) }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encaminha criação normal e valida resposta', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(item), { status: 201 })); vi.stubGlobal('fetch', fetchMock);
    const response = await POST(request('POST', { cookie: 'gft_access_token=session-token', origin: 'http://localhost:3000', body: JSON.stringify({ kind: 'MANUAL', title: 'Entrega', dueAt: item.dueAt }) }));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const forwardedHeaders = new Headers(init.headers);
    const correlationId = forwardedHeaders.get('x-request-id');
    expect(response.status).toBe(201);
    expect(correlationId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(forwardedHeaders.get('authorization')).toBe('Bearer session-token');
    expect(forwardedHeaders.get('x-correlation-id')).toBe(correlationId);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe(correlationId);
    expect(response.headers.get('x-correlation-id')).toBe(correlationId);
    expect(JSON.parse(await response.text())).toEqual(item);
    expect(url).toBe('https://nest.example/api/v1/fiscal/calendar');
  });
});
