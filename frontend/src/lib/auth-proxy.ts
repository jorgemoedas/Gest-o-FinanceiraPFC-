import { NextRequest, NextResponse } from 'next/server';
import { extractApiMessage } from '../features/auth/api-message';

export const ACCESS_TOKEN_COOKIE = 'gft_access_token';

function firstHeaderValue(request: NextRequest, name: string): string | undefined {
  return request.headers.get(name)?.split(',')[0]?.trim();
}

export function isSameOriginMutation(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') return false;

  const host = firstHeaderValue(request, 'host');
  const forwardedHost = firstHeaderValue(request, 'x-forwarded-host') ?? host;
  const forwardedProto = firstHeaderValue(request, 'x-forwarded-proto') ?? new URL(request.url).protocol.slice(0, -1);
  if (!forwardedHost || (forwardedProto !== 'http' && forwardedProto !== 'https')) return false;

  let publicOrigin: string;
  let requestOrigin: string;
  try {
    publicOrigin = new URL(`${forwardedProto}://${forwardedHost}`).origin;
    requestOrigin = new URL(origin).origin;
  } catch {
    return false;
  }

  const configuredOrigin = process.env.APP_ORIGIN?.trim();
  if (configuredOrigin) {
    try {
      if (publicOrigin !== new URL(configuredOrigin).origin) return false;
    } catch {
      return false;
    }
  }

  // O proxy pode normalizar Origin; o caminho interno exige Sec-Fetch-Site same-origin.
  if (requestOrigin === publicOrigin) return true;
  if (fetchSite !== 'same-origin' || !host) return false;

  try {
    // TLS termina no proxy; a conexão interna usa HTTP.
    const internalOrigin = new URL(`http://${host}`).origin;
    return requestOrigin === internalOrigin;
  } catch {
    return false;
  }
}

export function isSameOriginRequest(request: NextRequest): boolean {
  if (request.headers.get('sec-fetch-site') !== 'same-origin') return false;
  if (request.headers.get('origin')) return isSameOriginMutation(request);

  const host = firstHeaderValue(request, 'host');
  const forwardedHost = firstHeaderValue(request, 'x-forwarded-host') ?? host;
  const forwardedProto = firstHeaderValue(request, 'x-forwarded-proto') ?? new URL(request.url).protocol.slice(0, -1);
  if (!forwardedHost || (forwardedProto !== 'http' && forwardedProto !== 'https')) return false;

  try {
    const publicOrigin = new URL(`${forwardedProto}://${forwardedHost}`).origin;
    const configuredOrigin = process.env.APP_ORIGIN?.trim();
    return !configuredOrigin || publicOrigin === new URL(configuredOrigin).origin;
  } catch {
    return false;
  }
}

export function accessCookieOptions(maxAge: number) {
  // Desabilitar Secure somente em desenvolvimento local com HTTP.
  const secure = process.env.AUTH_COOKIE_SECURE !== 'false';
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ('none' as const) : ('lax' as const),
    path: '/',
    maxAge
  };
}

export function authApiUrl(path: string): string | null {
  const base = process.env.AUTH_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function requestNest(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; ok: boolean; payload: unknown }> {
  const url = authApiUrl(path);
  if (!url) {
    return {
      status: 503,
      ok: false,
      payload: { message: 'AUTH_API_BASE_URL não está configurada no servidor Next.js.' }
    };
  }

  try {
    const upstream = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
      headers: {
        Accept: 'application/json',
        ...(init.headers ?? {})
      }
    });
    const payload: unknown = await upstream.json().catch(() => null);
    return { status: upstream.status, ok: upstream.ok, payload };
  } catch {
    return {
      status: 503,
      ok: false,
      payload: { message: 'Não foi possível alcançar a API NestJS. Confira AUTH_API_BASE_URL e se o serviço está ativo.' }
    };
  }
}

export function apiErrorResponse(payload: unknown, status: number): NextResponse {
  return NextResponse.json(
    { message: extractApiMessage(payload, status) },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export function isNativeFormSubmission(request: NextRequest): boolean {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return contentType === 'application/x-www-form-urlencoded' || contentType === 'multipart/form-data';
}

export async function readAuthRequestBody(request: NextRequest, registration = false): Promise<{ ok: true; body: unknown } | { ok: false }> {
  if (!isNativeFormSubmission(request)) return readJsonBody(request);

  try {
    const form = await request.formData();
    const body: Record<string, string | boolean> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') body[key] = value;
    }
    if (registration) {
      body.acceptedTerms = form.get('acceptedTerms') === 'on';
      body.acceptedPrivacy = form.get('acceptedPrivacy') === 'on';
    }
    return { ok: true, body };
  } catch {
    return { ok: false };
  }
}

export function authFormRedirect(location: string): NextResponse {
  if (!location.startsWith('/') || location.startsWith('//')) {
    throw new Error('Auth form redirects must use a root-relative path.');
  }
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store' }
  });
}

export async function readJsonBody(request: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}
