import { NextRequest } from 'next/server';
import { erasePrivacyRequestSchema, privacyEraseResponseSchema } from '@/features/privacy/privacy-client';
import { isSameOriginMutation, readJsonBody, requestNest, apiErrorResponse } from '@/lib/auth-proxy';
import { nestErrorResponse, requireBffSession, successJsonResponse, invalidJsonResponse } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return apiErrorResponse({ message: 'Origem da solicitação não permitida.' }, 403);
  const session = requireBffSession(request);
  if (!session.ok) return session.response;
  const body = await readJsonBody(request);
  if (!body.ok) return invalidJsonResponse();
  const input = erasePrivacyRequestSchema.safeParse(body.body);
  if (!input.success) return apiErrorResponse({ message: input.error.issues[0]?.message ?? 'Digite a confirmação solicitada.' }, 400);

  const upstream = await requestNest('/privacy/erase', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input.data)
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
  const result = privacyEraseResponseSchema.safeParse(upstream.payload);
  if (!result.success) return apiErrorResponse({ message: 'A API de privacidade retornou uma confirmação inválida.' }, 502);
  return successJsonResponse(result.data, upstream.status);
}
