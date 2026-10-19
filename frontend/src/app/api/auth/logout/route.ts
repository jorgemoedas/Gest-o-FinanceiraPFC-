import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_TOKEN_COOKIE,
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

  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(ACCESS_TOKEN_COOKIE, '', accessCookieOptions(0));
  return response;
}
