import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  createFiscalObligationRequestSchema,
  fiscalCalendarQuerySchema,
  fiscalCalendarResponseSchema,
  fiscalObligationSchema,
  generateDefaultFiscalCalendarRequestSchema
} from '@/features/fiscal/calendar';
import { isSameOriginMutation, isSameOriginRequest, readJsonBody, requestNest } from '@/lib/auth-proxy';
import { badOriginResponse, invalidJsonResponse, invalidUpstreamResponse, nestErrorResponse, requireBffSession, successJsonResponse } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isSameOriginRequest(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;
  const query = fiscalCalendarQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!query.success) return nestErrorResponse({ message: query.error.issues[0]?.message ?? 'Confira o período do calendário fiscal.' }, 400);
  const params = new URLSearchParams({ from: query.data.from, to: query.data.to });
  if (query.data.status) params.set('status', query.data.status);
  const upstream = await requestNest(`/fiscal/calendar?${params.toString()}`, { method: 'GET', headers: { Authorization: `Bearer ${session.accessToken}` } });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
  const result = fiscalCalendarResponseSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data);
}

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;
  const body = await readJsonBody(request);
  if (!body.ok) return invalidJsonResponse();
  const raw = body.body;
  const generated = generateDefaultFiscalCalendarRequestSchema.safeParse(raw && typeof raw === 'object' ? (() => { const copy = { ...(raw as Record<string, unknown>) }; delete copy.generateDefault; return copy; })() : raw);
  const create = createFiscalObligationRequestSchema.safeParse(raw);
  if (!generated.success && !create.success) return nestErrorResponse({ message: create.error.issues[0]?.message ?? generated.error.issues[0]?.message ?? 'Confira os dados da obrigação fiscal.' }, 400);
  const isGenerate = generated.success && !create.success && typeof raw === 'object' && raw !== null && 'regime' in raw;
  if (isGenerate) {
    const upstream = await requestNest('/fiscal/calendar/generate-default', { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(generated.data) });
    if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
    const result = z.object({ created: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() }).strict().safeParse(upstream.payload);
    if (!result.success) return invalidUpstreamResponse();
    return successJsonResponse(result.data, upstream.status);
  }
  if (!create.success) return nestErrorResponse({ message: 'Confira os dados da obrigação fiscal.' }, 400);
  const upstream = await requestNest('/fiscal/calendar', { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(create.data) });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
  const result = fiscalObligationSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}
