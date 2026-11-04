import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterForm } from '@/components/auth/register-form';
import { documentVersionsSchema } from '@/features/auth/validation';
import { authFormErrorMessage } from '@/features/auth/form-errors';

export const dynamic = 'force-dynamic';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const versions = documentVersionsSchema.safeParse({
    termsVersion: process.env.TERMS_VERSION,
    privacyVersion: process.env.PRIVACY_POLICY_VERSION
  });

  return (
    <AuthShell variant="register">
      <RegisterForm
        documentVersions={versions.success ? versions.data : null}
        initialError={authFormErrorMessage('register', errorCode)}
      />
    </AuthShell>
  );
}
