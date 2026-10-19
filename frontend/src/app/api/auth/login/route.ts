import { NextRequest, NextResponse } from 'next/server';
import { authResponseSchema, loginSchema } from '@/features/auth/validation';
import {
  ACCESS_TOKEN_COOKIE,
  accessCookieOptions,
  apiErrorResponse,
  authFormRedirect,
  isNativeFormSubmission,
  isSameOriginMutation,
  readAuthRequestBody,
  requestNest
} from '@/lib/auth-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const nativeForm = isNativeFormSubmission(request);
  if (!isSameOriginMutation(request)) {
    return apiErrorResponse({ message: 'Origem da solicitação não permitida.' }, 403);
  }

  const body = await readAuthRequestBody(request);
  if (!body.ok) {
    return nativeForm ? authFormRedirect('/login?error=invalid-form') : apiErrorResponse({ message: 'O corpo da solicitação deve ser um JSON válido.' }, 400);
  }

  const input = loginSchema.safeParse(body.body);
  if (!input.success) {
    return nativeForm
      ? authFormRedirect('/login?error=invalid-form')
      : apiErrorResponse({ message: input.error.issues[0]?.message ?? 'Confira os dados informados.' }, 400);
  }

  const upstream = await requestNest('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input.data)
  });
  if (!upstream.ok) {
    if (nativeForm) {
      const code = upstream.status === 401 ? 'invalid-credentials'
        : upstream.status === 429 ? 'rate-limited' : 'service-unavailable';
      return authFormRedirect(`/login?error=${code}`);
    }
    return apiErrorResponse(upstream.payload, upstream.status);
  }

  const auth = authResponseSchema.safeParse(upstream.payload);
  if (!auth.success) {
    return nativeForm
      ? authFormRedirect('/login?error=service-unavailable')
      : apiErrorResponse({ message: 'A API de autenticação retornou uma resposta inválida.' }, 502);
  }

  const response = nativeForm
    ? authFormRedirect('/dashboard')
    : NextResponse.json(
      { user: auth.data.user, expiresInSeconds: auth.data.expiresInSeconds },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  response.cookies.set(ACCESS_TOKEN_COOKIE, auth.data.accessToken, accessCookieOptions(auth.data.expiresInSeconds));
  return response;
}
