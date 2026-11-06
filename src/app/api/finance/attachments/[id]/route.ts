import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authApiUrl, isSameOriginMutation, isSameOriginRequest } from '@/lib/auth-proxy';
import { badOriginResponse, nestErrorResponse, requireBffSession, successJsonResponse } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();

async function readId(context: RouteContext): Promise<string | null> {
  const { id } = await context.params;
  return idSchema.safeParse(id).success ? id : null;
}

async function readUpstreamError(response: Response): Promise<unknown> {
  return response.json().catch(() => ({ message: 'A API de anexos retornou um erro.' }));
}

export async function GET(request: NextRequest, context: RouteContext) {
  if (!isSameOriginRequest(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const id = await readId(context);
  if (!id) return nestErrorResponse({ message: 'Identificador de anexo inválido.' }, 400);
  const url = authApiUrl(`/finance/attachments/${encodeURIComponent(id)}`);
  if (!url) return nestErrorResponse({ message: 'AUTH_API_BASE_URL não está configurada no servidor Next.js.' }, 503);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'GET',
      headers: { Accept: '*/*', Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    return nestErrorResponse({ message: 'Não foi possível alcançar a API de anexos.' }, 503);
  }
  if (!upstream.ok) return nestErrorResponse(await readUpstreamError(upstream), upstream.status);

  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream'
  });
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) headers.set('Content-Disposition', disposition);
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isSameOriginMutation(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const id = await readId(context);
  if (!id) return nestErrorResponse({ message: 'Identificador de anexo inválido.' }, 400);
  const url = authApiUrl(`/finance/attachments/${encodeURIComponent(id)}`);
  if (!url) return nestErrorResponse({ message: 'AUTH_API_BASE_URL não está configurada no servidor Next.js.' }, 503);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'DELETE',
      headers: { Accept: 'application/json', Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    return nestErrorResponse({ message: 'Não foi possível alcançar a API de anexos.' }, 503);
  }
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) return nestErrorResponse(payload, upstream.status);
  if (typeof payload !== 'object' || payload === null || !('removed' in payload) || payload.removed !== true) {
    return nestErrorResponse({ message: 'A API retornou uma confirmação de remoção inválida.' }, 502);
  }
  return successJsonResponse({ removed: true }, upstream.status);
}
