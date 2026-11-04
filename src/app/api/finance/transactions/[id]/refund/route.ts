import { NextRequest } from 'next/server';
import { z } from 'zod';
import { financeTransactionRefundSchema } from '@/features/finance/types';
import { isSameOriginMutation, requestNest } from '@/lib/auth-proxy';
import { badOriginResponse, invalidUpstreamResponse, nestErrorResponse, requireBffSession, successJsonResponse } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const transactionIdSchema = z.string().uuid();
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isSameOriginMutation(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const { id } = await context.params;
  if (!transactionIdSchema.safeParse(id).success) {
    return nestErrorResponse({ message: 'Identificador de lançamento inválido.' }, 400);
  }

  const upstream = await requestNest(`/finance/transactions/${id}/refund`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);

  const result = financeTransactionRefundSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}
