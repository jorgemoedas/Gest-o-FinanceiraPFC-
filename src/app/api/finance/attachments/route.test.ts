import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';

const attachment = {
  id: 'f47ac10b-58cc-11cf-a447-001122334456',
  transactionId: 'f47ac10b-58cc-11cf-a447-001122334455',
  fileName: 'nota.pdf',
  contentType: 'application/pdf',
  byteSize: 4,
  checksum: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  createdAt: '2026-11-09T12:00:00.000Z'
};

function request(method: 'GET' | 'POST', options: { cookie?: string; query?: string; origin?: string; body?: BodyInit } = {}) {
  const headers = new Headers({ host: 'localhost:3000', 'sec-fetch-site': 'same-origin' });
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.origin) headers.set('origin', options.origin);
  return new NextRequest(`http://localhost:3000/api/finance/attachments${options.query ?? ''}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: options.body } : {})
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('finance attachments BFF', () => {
  it('rejects listing without a session and does not call Nest', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(request('GET', { query: `?transactionId=${attachment.transactionId}` }));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the tenant transaction filter and validates the list', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([attachment]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(request('GET', {
      cookie: 'gft_access_token=session-token',
      query: `?transactionId=${attachment.transactionId}`
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([attachment]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://nest.example/api/v1/finance/attachments?transactionId=${attachment.transactionId}`);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer session-token');
  });

  it('rejects invalid ids and cross-origin uploads before Nest', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invalid = await GET(request('GET', { cookie: 'gft_access_token=session-token', query: '?transactionId=bad' }));
    expect(invalid.status).toBe(400);

    const body = new FormData();
    body.append('transactionId', attachment.transactionId);
    body.append('file', new Blob([Buffer.from('x')], { type: 'application/pdf' }), 'nota.pdf');
    const crossOrigin = await POST(request('POST', {
      cookie: 'gft_access_token=session-token',
      origin: 'https://attacker.example',
      body
    }));
    expect(crossOrigin.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the original multipart stream and does not synthesize a content type', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(attachment), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const body = new FormData();
    body.append('transactionId', attachment.transactionId);
    body.append('file', new Blob([Buffer.from('test')], { type: 'application/pdf' }), 'nota.pdf');
    const response = await POST(request('POST', {
      cookie: 'gft_access_token=session-token',
      origin: 'http://localhost:3000',
      body
    }));
    expect(response.status).toBe(201);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer session-token');
    expect(new Headers(init.headers).get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    expect(init.body).toBeInstanceOf(ReadableStream);
  });

  it('propagates upstream status and message', async () => {
    vi.stubEnv('AUTH_API_BASE_URL', 'https://nest.example/api/v1');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Arquivo rejeitado' }), { status: 413 }));
    vi.stubGlobal('fetch', fetchMock);
    const body = new FormData();
    body.append('transactionId', attachment.transactionId);
    body.append('file', new Blob([Buffer.from('x')], { type: 'application/pdf' }), 'nota.pdf');
    const response = await POST(request('POST', { cookie: 'gft_access_token=session-token', origin: 'http://localhost:3000', body }));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const forwardedHeaders = new Headers(init.headers);
    const correlationId = forwardedHeaders.get('x-request-id');
    expect(response.status).toBe(413);
    expect(correlationId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(forwardedHeaders.get('x-correlation-id')).toBe(correlationId);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe(correlationId);
    expect(response.headers.get('x-correlation-id')).toBe(correlationId);
    await expect(response.json()).resolves.toEqual({
      message: `Arquivo rejeitado (correlationId: ${correlationId})`,
      correlationId
    });
  });
});
