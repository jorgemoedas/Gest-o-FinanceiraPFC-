import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  refreshCookieOptions,
  requestNest,
  accessCookieOptions,
  apiErrorResponse,
  isSameOriginMutation
} from '@/lib/auth-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return apiErrorResponse({ message: 'Origem da solicitação não permitida.' }, 403);
  }

  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (refreshToken) await requestNest('/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(ACCESS_TOKEN_COOKIE, '', accessCookieOptions(0));
  response.cookies.set(REFRESH_TOKEN_COOKIE, '', refreshCookieOptions(0));
  return response;
}
