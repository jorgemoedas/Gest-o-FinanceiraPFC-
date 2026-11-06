import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE, PATCH } from './route';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const id = 'f47ac10b-58cc-11cf-a447-001122334455';
function request(method: 'PATCH' | 'DELETE', body?: string, authenticated = true) {
  const headers = new Headers({ host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin', ...(authenticated ? { cookie: 'gft_access_token=session-token' } : {}) });
  if (body) headers.set('content-type', 'application/json');
  return new NextRequest(`http://localhost:3000/api/fiscal/calendar/${id}`, { method, headers, ...(body ? { body } : {}) });
}

describe('fiscal calendar item BFF', () => {
  it('valida sessão e versão antes do upstream', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect((await PATCH(request('PATCH', JSON.stringify({ status: 'DONE', version: 0 }), false), { params: Promise.resolve({ id }) })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encaminha PATCH autenticado e DELETE autenticado', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    const updated = { id, companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8', kind: 'MANUAL', title: 'Entrega', description: null, dueAt: '2026-12-20T00:00:00.000Z', status: 'DONE', source: 'MANUAL', periodKey: null, completedAt: '2026-12-20T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', isOverdue: false, daysUntilDue: 5, version: 2 };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ removed: true }), { status: 200 })); vi.stubGlobal('fetch', fetchMock);
    const patch = await PATCH(request('PATCH', JSON.stringify({ status: 'DONE', version: 1 })), { params: Promise.resolve({ id }) });
    const remove = await DELETE(request('DELETE'), { params: Promise.resolve({ id }) });
    expect(patch.status).toBe(200); expect(remove.status).toBe(200); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
