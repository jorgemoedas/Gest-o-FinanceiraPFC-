import { NextRequest, NextResponse } from 'next/server';
import { privacyExportShape } from '@/features/privacy/privacy-client';
import { isSameOriginRequest, requestNest, apiErrorResponse } from '@/lib/auth-proxy';
import { nestErrorResponse, requireBffSession } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isSameOriginRequest(request)) return apiErrorResponse({ message: 'Origem da solicitação não permitida.' }, 403);
  const session = requireBffSession(request);
  if (!session.ok) return session.response;
  const upstream = await requestNest('/privacy/export', {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);
  if (!privacyExportShape(upstream.payload)) return apiErrorResponse({ message: 'A API de privacidade retornou um arquivo inválido.' }, 502);

  const response = NextResponse.json(upstream.payload, {
    status: upstream.status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="gft-dados-privacidade.json"'
    }
  });
  return response;
}
