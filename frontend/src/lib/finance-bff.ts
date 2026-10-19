import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_TOKEN_COOKIE,
  accessCookieOptions,
  apiErrorResponse
} from '@/lib/auth-proxy';

export type BffSession =
  | { ok: true; accessToken: string }
  | { ok: false; response: NextResponse };

export function requireBffSession(request: NextRequest): BffSession {
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (accessToken) return { ok: true, accessToken };
  return { ok: false, response: apiErrorResponse({ message: 'Sua sessão expirou. Entre novamente.' }, 401) };
}

export function nestErrorResponse(payload: unknown, status: number): NextResponse {
  const response = apiErrorResponse(payload, status);
  if (status === 401) response.cookies.set(ACCESS_TOKEN_COOKIE, '', accessCookieOptions(0));
  return response;
}

export function badOriginResponse(): NextResponse {
  return apiErrorResponse({ message: 'Origem da solicitação não permitida.' }, 403);
}

export function invalidJsonResponse(): NextResponse {
  return apiErrorResponse({ message: 'O corpo da solicitação deve ser um JSON válido.' }, 400);
}

export function invalidUpstreamResponse(): NextResponse {
  return apiErrorResponse({ message: 'A API retornou dados financeiros em formato inválido.' }, 502);
}

export function successJsonResponse(value: unknown, status = 200): NextResponse {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
