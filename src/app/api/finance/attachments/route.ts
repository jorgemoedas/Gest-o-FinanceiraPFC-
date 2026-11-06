import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  attachmentListResponseSchema,
  publicAttachmentSchema
} from '@/features/finance/attachments';
import { isSameOriginMutation, isSameOriginRequest, requestNest } from '@/lib/auth-proxy';
import {
  badOriginResponse,
  invalidUpstreamResponse,
  nestErrorResponse,
  requireBffSession,
  successJsonResponse
} from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const transactionQuerySchema = z.object({ transactionId: z.string().uuid() }).strict();

export async function GET(request: NextRequest) {
  if (!isSameOriginRequest(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const query = transactionQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!query.success) return nestErrorResponse({ message: 'Identificador de lançamento inválido.' }, 400);

  const upstream = await requestNest(`/finance/attachments?transactionId=${encodeURIComponent(query.data.transactionId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);

  const result = attachmentListResponseSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;

  const contentType = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) {
    return nestErrorResponse({ message: 'O upload deve usar multipart/form-data.' }, 400);
  }

  const upstream = await requestNest('/finance/attachments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': contentType
    },
    body: request.body,
    duplex: 'half'
  } as RequestInit & { duplex: 'half' });
  if (!upstream.ok) return nestErrorResponse(upstream.payload, upstream.status);

  const result = publicAttachmentSchema.safeParse(upstream.payload);
  if (!result.success) return invalidUpstreamResponse();
  return successJsonResponse(result.data, upstream.status);
}
