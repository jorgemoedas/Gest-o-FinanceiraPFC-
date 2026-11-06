import { NextRequest } from 'next/server';
import { z } from 'zod';
import { transactionUpdateSchema } from '@/features/finance/validation';
import { financeTransactionCancellationSchema, financeTransactionSchema } from '@/features/finance/types';
import { isSameOriginMutation, readJsonBody, requestNest } from '@/lib/auth-proxy';
import { badOriginResponse, invalidJsonResponse, invalidUpstreamResponse, nestErrorResponse, requireBffSession, successJsonResponse } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const transactionIdSchema = z.string().uuid();
type RouteContext = { params: Promise<{ id: string }> };

async function readTransactionId(context: RouteContext): Promise<string | null> {
  const { id } = await context.params;
  return transactionIdSchema.safeParse(id).success ? id : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isSameOriginMutation(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const id = await readTransactionId(context);
  if (!id) return nestErrorResponse({ message: 'Identificador de lançamento inválido.' }, 400);

  const body = await readJsonBody(request);
  if (!body.ok) return invalidJsonResponse();
  const input = transactionUpdateSchema.safeParse(body.body);
  if (!input.success) {
    return nestErrorResponse({ message: input.error.issues[0]?.message ?? 'Confira os dados do lançamento.' }, 400);
  }

  const upstream = await requestNest(`/finance/transactions/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input.data)
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);

  const result = financeTransactionSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isSameOriginMutation(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const id = await readTransactionId(context);
  if (!id) return nestErrorResponse({ message: 'Identificador de lançamento inválido.' }, 400);

  const upstream = await requestNest(`/finance/transactions/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);

  const result = financeTransactionCancellationSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}
