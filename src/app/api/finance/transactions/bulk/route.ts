import { NextRequest } from 'next/server';
import { bulkUpdateTransactionsRequestSchema, bulkUpdateTransactionsResponseSchema } from '@/features/finance/bulk';
import { isSameOriginMutation, readJsonBody, requestNest } from '@/lib/auth-proxy';
import { badOriginResponse, invalidJsonResponse, invalidUpstreamResponse, nestErrorResponse, requireBffSession, successJsonResponse } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest) {
  if (!isSameOriginMutation(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;
  const body = await readJsonBody(request);
  if (!body.ok) return invalidJsonResponse();
  const input = bulkUpdateTransactionsRequestSchema.safeParse(body.body);
  if (!input.success) {
    return nestErrorResponse({ message: input.error.issues[0]?.message ?? 'Confira os lançamentos selecionados e as alterações.' }, 400);
  }
  const upstream = await requestNest('/finance/transactions/bulk', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input.data)
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
  const result = bulkUpdateTransactionsResponseSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}
