import { NextRequest } from 'next/server';
import { dashboardMonthsSchema } from '@/features/finance/validation';
import { financeDashboardSchema } from '@/features/finance/types';
import { requestNest } from '@/lib/auth-proxy';
import { invalidUpstreamResponse, nestErrorResponse, requireBffSession, successJsonResponse } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const rawMonths = request.nextUrl.searchParams.get('months') ?? '6';
  const months = dashboardMonthsSchema.safeParse(Number(rawMonths));
  if (!months.success) return nestErrorResponse({ message: 'Selecione um período de 3, 6 ou 12 meses.' }, 400);

  const upstream = await requestNest(`/finance/dashboard?months=${months.data}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);

  const result = financeDashboardSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data);
}
