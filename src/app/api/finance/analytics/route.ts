import { NextRequest } from 'next/server';
import { analyticsQuerySchema, analyticsReportSchema } from '@/features/finance/analytics';
import { isSameOriginRequest, requestNest } from '@/lib/auth-proxy';
import { badOriginResponse, invalidUpstreamResponse, nestErrorResponse, requireBffSession, successJsonResponse } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isSameOriginRequest(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const input = analyticsQuerySchema.safeParse({
    months: Number(request.nextUrl.searchParams.get('months') ?? '6'),
    projectionMonths: Number(request.nextUrl.searchParams.get('projectionMonths') ?? '3')
  });
  if (!input.success) {
    return nestErrorResponse({ message: 'Selecione meses de análise 3, 6 ou 12 e projeção de 1, 3 ou 6 meses.' }, 400);
  }

  const upstream = await requestNest(`/finance/analytics?months=${input.data.months}&projectionMonths=${input.data.projectionMonths}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
  const result = analyticsReportSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}
