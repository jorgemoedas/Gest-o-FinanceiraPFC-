import { NextResponse } from 'next/server';
import { documentVersionsSchema } from '@/features/auth/validation';
import { apiErrorResponse } from '@/lib/auth-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const versions = documentVersionsSchema.safeParse({
    termsVersion: process.env.TERMS_VERSION,
    privacyVersion: process.env.PRIVACY_POLICY_VERSION
  });
  if (!versions.success) {
    return apiErrorResponse(
      { message: 'Configure TERMS_VERSION e PRIVACY_POLICY_VERSION no ambiente Next.js com as mesmas versões do NestJS.' },
      503
    );
  }

  return NextResponse.json(versions.data, { headers: { 'Cache-Control': 'no-store' } });
}
