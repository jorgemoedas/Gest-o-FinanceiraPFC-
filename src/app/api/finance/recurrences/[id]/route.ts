import { NextRequest } from 'next/server';
import { z } from 'zod';
import { financeRecurrenceSchema, recurrencePatchRequestSchema } from '@/features/finance/recurrence';
import { isSameOriginMutation, readJsonBody, requestNest } from '@/lib/auth-proxy';
import { badOriginResponse, invalidJsonResponse, invalidUpstreamResponse, nestErrorResponse, requireBffSession, successJsonResponse } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isSameOriginMutation(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return nestErrorResponse({ message: 'Identificador de recorrência inválido.' }, 400);
  const body = await readJsonBody(request);
  if (!body.ok) return invalidJsonResponse();
  const input = recurrencePatchRequestSchema.safeParse(body.body);
  if (!input.success) return nestErrorResponse({ message: input.error.issues[0]?.message ?? 'Confira os dados da recorrência.' }, 400);
  const upstream = await requestNest(`/finance/recurrences/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input.data)
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
  const result = financeRecurrenceSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}
