import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const payload = {
  currency: 'BRL',
  period: { from: '2026-07-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', months: 3 },
  monthly: [],
  trend: {
    income: { direction: 'FLAT', slopePerMonth: 0, changePercent: null, explanation: 'sem dados' },
    expense: { direction: 'FLAT', slopePerMonth: 0, changePercent: null, explanation: 'sem dados' },
    net: { direction: 'FLAT', slopePerMonth: 0, changePercent: null, explanation: 'sem dados' }
  },
  seasonality: { index: null, monthsObserved: 0, explanation: '24 meses são necessários' },
  projection: [{ monthKey: '2026-10', income: 0, expense: 0, net: 0 }],
  projectionAssumptions: ['tendência linear dos meses observados'],
  alerts: []
};

function request(query = '?months=3&projectionMonths=1', options: { cookie?: string; fetchSite?: string; origin?: string } = {}) {
  const headers = new Headers({ host: 'localhost:3000', 'sec-fetch-site': options.fetchSite ?? 'same-origin' });
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.origin) headers.set('origin', options.origin);
  return new NextRequest(`http://localhost:3000/api/finance/analytics${query}`, { method: 'GET', headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('finance analytics BFF', () => {
  it('requires a same-origin authenticated session before calling Nest', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect((await GET(request())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(request('?months=3&projectionMonths=1', { cookie: 'gft_access_token=t', fetchSite: 'cross-site', origin: 'https://attacker.example' }));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates query and forwards the token and parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(request('?months=6&projectionMonths=3', { cookie: 'gft_access_token=token' }));
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://nest.example/api/v1/finance/analytics?months=6&projectionMonths=3');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
  });

  it('returns 400 for invalid query without forwarding', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(request('?months=5&projectionMonths=2', { cookie: 'gft_access_token=t' }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates upstream status and rejects malformed success payloads', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example');
    const upstream = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Sem acesso' }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ invalid: true }), { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    expect((await GET(request('?months=3&projectionMonths=1', { cookie: 'gft_access_token=t' }))).status).toBe(403);
    expect((await GET(request('?months=3&projectionMonths=1', { cookie: 'gft_access_token=t' }))).status).toBe(502);
  });
});
