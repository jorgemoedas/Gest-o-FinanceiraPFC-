import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fiscalObligationSchema, updateFiscalObligationStatusRequestSchema } from '@/features/fiscal/calendar';
import { isSameOriginMutation, readJsonBody, requestNest } from '@/lib/auth-proxy';
import { badOriginResponse, invalidJsonResponse, invalidUpstreamResponse, nestErrorResponse, requireBffSession, successJsonResponse } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();

async function readId(context: RouteContext): Promise<string | null> {
  const { id } = await context.params;
  return idSchema.safeParse(id).success ? id : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isSameOriginMutation(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;
  const id = await readId(context);
  if (!id) return nestErrorResponse({ message: 'Identificador de obrigação inválido.' }, 400);
  const body = await readJsonBody(request);
  if (!body.ok) return invalidJsonResponse();
  const input = updateFiscalObligationStatusRequestSchema.safeParse(body.body);
  if (!input.success) return nestErrorResponse({ message: input.error.issues[0]?.message ?? 'Confira a situação e a versão da obrigação.' }, 400);
  const upstream = await requestNest(`/fiscal/calendar/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input.data) });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
  const result = fiscalObligationSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isSameOriginMutation(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;
  const id = await readId(context);
  if (!id) return nestErrorResponse({ message: 'Identificador de obrigação inválido.' }, 400);
  const upstream = await requestNest(`/fiscal/calendar/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.accessToken}` } });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
  const result = z.object({ removed: z.literal(true) }).strict().safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}
