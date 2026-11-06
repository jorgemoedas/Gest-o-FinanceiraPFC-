import { NextRequest, NextResponse } from 'next/server';
import { passwordResetConfirmResponseSchema, passwordResetConfirmSchema } from '@/features/auth/password-reset-client';
import { apiErrorResponse, isSameOriginMutation, readJsonBody, requestNest } from '@/lib/auth-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return apiErrorResponse({ message: 'Origem da solicitação não permitida.' }, 403);
  const body = await readJsonBody(request);
  if (!body.ok) return apiErrorResponse({ message: 'O corpo da solicitação deve ser um JSON válido.' }, 400);
  const input = passwordResetConfirmSchema.safeParse(body.body);
  if (!input.success) return apiErrorResponse({ message: input.error.issues[0]?.message ?? 'Confira o token e a nova senha.' }, 400);

  const upstream = await requestNest('/auth/password-reset/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input.data)
  });
  if (!upstream.ok) return apiErrorResponse(upstream.payload, upstream.status);
  const result = passwordResetConfirmResponseSchema.safeParse(upstream.payload);
  if (!result.success) return apiErrorResponse({ message: 'A API de autenticação retornou uma confirmação inválida.' }, 502);
  return NextResponse.json(result.data, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
}
