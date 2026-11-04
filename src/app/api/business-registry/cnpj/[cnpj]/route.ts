import { NextRequest } from 'next/server';
import { businessRegistryRecordSchema } from '@/features/business-registry/types';
import {
  apiErrorResponse,
  isSameOriginRequest,
  requestNest
} from '@/lib/auth-proxy';
import {
  badOriginResponse,
  nestErrorResponse,
  requireBffSession,
  successJsonResponse
} from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CNPJ_PATTERN = /^[A-Z0-9]{12}\d{2}$/;

type RouteContext = { params: Promise<{ cnpj: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  if (!isSameOriginRequest(request)) return badOriginResponse();

  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const { cnpj: rawCnpj } = await context.params;
  const cnpj = rawCnpj.replace(/[^0-9a-z]/gi, '').toUpperCase();
  if (!CNPJ_PATTERN.test(cnpj)) {
    return apiErrorResponse({ message: 'Informe um CNPJ válido com 14 caracteres.' }, 400);
  }

  const upstream = await requestNest(`/business-registry/cnpj/${encodeURIComponent(cnpj)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);

  const result = businessRegistryRecordSchema.safeParse(upstream.payload);
  if (!result.success) {
    return apiErrorResponse({ message: 'A API ReceitaWS retornou dados cadastrais em formato inválido.' }, 502);
  }
  return successJsonResponse(result.data);
}
