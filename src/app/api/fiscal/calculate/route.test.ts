import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function request(body: unknown, options: { cookie?: string; origin?: string } = {}) {
  const headers = new Headers({ host: 'localhost:3000', origin: options.origin ?? 'http://localhost:3000', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' });
  if (options.cookie) headers.set('cookie', options.cookie);
  return new NextRequest('http://localhost:3000/api/fiscal/calculate', { method: 'POST', headers, body: JSON.stringify(body) });
}

const simplesResponse = {
  regime: 'SIMPLES_NACIONAL',
  annex: 'I',
  rbt12: '180000.00',
  monthlyRevenue: '0.13',
  band: 1,
  nominalRatePercent: '4.00',
  deduction: '0.00',
  effectiveRatePercent: '4',
  effectiveRate: '0.04',
  monthlyTax: '0.01',
  rounding: 'HALF_UP_2_DECIMAL_PLACES_ON_MONTHLY_TAX_ONLY',
  source: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm'
};

describe('fiscal calculation BFF', () => {
  it('recusa sessão ausente e payload inválido sem chamar Nest', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    expect((await POST(request({ regime: 'SIMPLES_NACIONAL' }))).status).toBe(401);
    expect((await POST(request({ regime: 'SIMPLES_NACIONAL' }, { cookie: 'gft_access_token=x', origin: 'https://attacker.example' }))).status).toBe(403);
    expect((await POST(request({ regime: 'SIMPLES_NACIONAL' }, { cookie: 'gft_access_token=x' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encaminha sessão, correlação e valores decimais e valida a resposta do Nest', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(simplesResponse), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(request({ regime: 'SIMPLES_NACIONAL', annex: 'I', rbt12: '180000.00', monthlyRevenue: '0.13' }, { cookie: 'gft_access_token=session-token' }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const forwardedHeaders = new Headers(init.headers);
    const correlationId = forwardedHeaders.get('x-correlation-id');
    expect(response.status).toBe(200);
    expect(url).toBe('https://nest.example/api/v1/fiscal/calculate');
    expect(forwardedHeaders.get('authorization')).toBe('Bearer session-token');
    expect(correlationId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(forwardedHeaders.get('x-request-id')).toBe(correlationId);
    expect(JSON.parse(String(init.body))).toEqual({ regime: 'SIMPLES_NACIONAL', annex: 'I', rbt12: '180000.00', monthlyRevenue: '0.13' });
    expect(response.headers.get('x-correlation-id')).toBe(correlationId);
    expect(JSON.parse(await response.text())).toEqual(simplesResponse);
  });
});
