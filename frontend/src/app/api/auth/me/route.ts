import { NextRequest } from 'next/server';
import { currentUserSchema } from '@/features/auth/validation';
import {
  ACCESS_TOKEN_COOKIE,
  accessCookieOptions,
  apiErrorResponse,
  requestNest
} from '@/lib/auth-proxy';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) return apiErrorResponse({ message: 'Sua sessão expirou. Entre novamente.' }, 401);

  const upstream = await requestNest('/auth/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!upstream.ok) {
    const response = apiErrorResponse(upstream.payload, upstream.status);
    if (upstream.status === 401) {
      response.cookies.set(ACCESS_TOKEN_COOKIE, '', accessCookieOptions(0));
    }
    return response;
  }

  const currentUser = currentUserSchema.safeParse(upstream.payload);
  if (!currentUser.success) {
    return apiErrorResponse({ message: 'A API retornou os dados da sessão em formato inválido.' }, 502);
  }

  return NextResponse.json(currentUser.data, { headers: { 'Cache-Control': 'no-store' } });
}
