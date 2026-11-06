import { NextRequest } from 'next/server';
import { businessRegistryRecordSchema, companyProfileSaveInputSchema } from '@/features/business-registry/types';
import {
  apiErrorResponse,
  isSameOriginMutation,
  isSameOriginRequest,
  readJsonBody,
  requestNest
} from '@/lib/auth-proxy';
import {
  badOriginResponse,
  invalidJsonResponse,
  nestErrorResponse,
  requireBffSession,
  successJsonResponse
} from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isSameOriginRequest(request)) return badOriginResponse();

  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const upstream = await requestNest('/business-registry/profile', {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
  if (upstream.payload === null) return successJsonResponse(null);

  const result = businessRegistryRecordSchema.safeParse(upstream.payload);
  if (!result.success) return apiErrorResponse({ message: 'A API retornou um perfil empresarial em formato inválido.' }, 502);
  return successJsonResponse(result.data);
}

export async function PUT(request: NextRequest) {
  if (!isSameOriginMutation(request)) return badOriginResponse();

  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const body = await readJsonBody(request);
  if (!body.ok) return invalidJsonResponse();

  const input = companyProfileSaveInputSchema.safeParse(body.body);
  if (!input.success) return apiErrorResponse({ message: 'Informe um CNPJ válido de 14 caracteres.' }, 400);

  const upstream = await requestNest('/business-registry/profile', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(input.data)
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);

  const result = businessRegistryRecordSchema.safeParse(upstream.payload);
  if (!result.success) return apiErrorResponse({ message: 'A API retornou um perfil empresarial em formato inválido.' }, 502);
  return successJsonResponse(result.data);
}
