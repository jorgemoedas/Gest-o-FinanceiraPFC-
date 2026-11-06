import { NextRequest } from 'next/server';
import { counterpartyInputSchema, counterpartyListQuerySchema } from '@/features/finance/validation';
import { financeCounterpartyListSchema, financeCounterpartySchema } from '@/features/finance/types';
import { isSameOriginMutation, readJsonBody, requestNest } from '@/lib/auth-proxy';
import { badOriginResponse, invalidJsonResponse, invalidUpstreamResponse, nestErrorResponse, requireBffSession, successJsonResponse } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const query = counterpartyListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!query.success) {
    return nestErrorResponse({ message: query.error.issues[0]?.message ?? 'Confira os filtros informados.' }, 400);
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query.data)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }

  const upstream = await requestNest(`/finance/counterparties?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);

  const result = financeCounterpartyListSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data);
}

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const body = await readJsonBody(request);
  if (!body.ok) return invalidJsonResponse();
  const input = counterpartyInputSchema.safeParse(body.body);
  if (!input.success) {
    return nestErrorResponse({ message: input.error.issues[0]?.message ?? 'Confira os dados do cadastro.' }, 400);
  }

  const inputWithOptionalCnpj = input.data as typeof input.data & { cnpj?: string };
  const safePayload = {
    name: inputWithOptionalCnpj.name,
    role: inputWithOptionalCnpj.role,
    ...(inputWithOptionalCnpj.cnpj ? { cnpj: inputWithOptionalCnpj.cnpj } : {})
  };

  const upstream = await requestNest('/finance/counterparties', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(safePayload)
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);

  const result = financeCounterpartySchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}
