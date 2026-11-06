import { NextRequest, NextResponse } from 'next/server';
import { fiscalExportRequestSchema } from '@/features/fiscal/export';
import { authApiUrl, isSameOriginRequest } from '@/lib/auth-proxy';
import { badOriginResponse, nestErrorResponse, requireBffSession } from '@/lib/finance-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isSameOriginRequest(request)) return badOriginResponse();
  const session = requireBffSession(request);
  if (!session.ok) return session.response;
  const input = fiscalExportRequestSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!input.success) return nestErrorResponse({ message: input.error.issues[0]?.message ?? 'Confira o período e o formato da exportação.' }, 400);
  const base = authApiUrl(`/fiscal/export?from=${encodeURIComponent(input.data.from)}&to=${encodeURIComponent(input.data.to)}&format=${input.data.format}`);
  if (!base) return nestErrorResponse({ message: 'AUTH_API_BASE_URL não está configurada no servidor Next.js.' }, 503);
  let upstream: Response;
  try {
    upstream = await fetch(base, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(15_000), headers: { Accept: input.data.format === 'pdf' ? 'application/pdf' : 'text/csv', Authorization: `Bearer ${session.accessToken}` } });
  } catch {
    return nestErrorResponse({ message: 'Não foi possível alcançar a API NestJS para exportar o calendário fiscal.' }, 503);
  }
  if (!upstream.ok) {
    const payload = await upstream.json().catch(() => ({ message: 'A exportação fiscal não pôde ser concluída.' }));
    return nestErrorResponse(payload, upstream.status);
  }
  const body = await upstream.arrayBuffer();
  const contentType = upstream.headers.get('content-type') ?? (input.data.format === 'pdf' ? 'application/pdf' : 'text/csv');
  const contentDisposition = upstream.headers.get('content-disposition') ?? `attachment; filename="calendario-fiscal.${input.data.format}"`;
  return new NextResponse(body, { status: upstream.status, headers: { 'Content-Type': contentType, 'Content-Disposition': contentDisposition, 'Cache-Control': 'no-store' } });
}
