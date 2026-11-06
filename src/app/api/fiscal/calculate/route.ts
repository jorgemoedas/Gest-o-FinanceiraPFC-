import { NextRequest } from 'next/server';
import { taxCalculationRequestSchema, taxCalculationResponseSchema } from '@/features/tax/simulator';
import { isSameOriginMutation, readJsonBody, requestNest } from '@/lib/auth-proxy';
import { badOriginResponse, invalidJsonResponse, invalidUpstreamResponse, nestErrorResponse, requireBffSession, successJsonResponse } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;
  const body = await readJsonBody(request);
  if (!body.ok) return invalidJsonResponse();
  const input = taxCalculationRequestSchema.safeParse(body.body);
  if (!input.success) return nestErrorResponse({ message: input.error.issues[0]?.message ?? 'Confira os dados da simulação fiscal.' }, 400);
  const upstream = await requestNest('/fiscal/calculate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input.data)
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
  const result = taxCalculationResponseSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}
