import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function request(query = '?from=2026-12-01T00:00:00.000Z&to=2026-12-31T23:59:59.999Z&format=pdf', origin = 'http://localhost:3000') {
  return new NextRequest(`http://localhost:3000/api/fiscal/export${query}`, { method: 'GET', headers: { host: 'localhost:3000', origin, 'sec-fetch-site': 'same-origin', cookie: 'gft_access_token=session-token' } });
}

describe('fiscal export BFF', () => {
  it('propaga content type e disposition sem aceitar companyId', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    const fetchMock = vi.fn().mockResolvedValue(new Response('%PDF-1.4', { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="fiscal.pdf"' } })); vi.stubGlobal('fetch', fetchMock);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('fiscal.pdf');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/fiscal/export?from='), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer session-token' }) }));
  });

  it('recusa origem cruzada', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect((await GET(request('?from=2026-12-01T00:00:00.000Z&to=2026-12-31T23:59:59.999Z&format=csv', 'https://attacker.example'))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
