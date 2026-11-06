import { NextRequest } from 'next/server';
import { recurrenceCreateRequestSchema, financeRecurrenceListSchema, financeRecurrenceSchema } from '@/features/finance/recurrence';
import { isSameOriginMutation, readJsonBody, requestNest } from '@/lib/auth-proxy';
import { badOriginResponse, invalidJsonResponse, invalidUpstreamResponse, nestErrorResponse, requireBffSession, successJsonResponse } from '@/lib/finance-bff';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50)
}).strict();

export async function GET(request: NextRequest) {
  const session = requireBffSession(request);
  if (!session.ok) return session.response;
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!query.success) return nestErrorResponse({ message: query.error.issues[0]?.message ?? 'Confira a paginação das recorrências.' }, 400);
  const upstream = await requestNest(`/finance/recurrences?page=${query.data.page}&limit=${query.data.limit}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
  const result = financeRecurrenceListSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data);
}

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;
  const body = await readJsonBody(request);
  if (!body.ok) return invalidJsonResponse();
  const input = recurrenceCreateRequestSchema.safeParse(body.body);
  if (!input.success) return nestErrorResponse({ message: input.error.issues[0]?.message ?? 'Confira os dados da recorrência.' }, 400);
  const upstream = await requestNest('/finance/recurrences', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input.data)
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
  const result = financeRecurrenceSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}
