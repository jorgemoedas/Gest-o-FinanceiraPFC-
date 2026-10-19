import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';
import { authFormErrorMessage } from '@/features/auth/form-errors';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  return (
    <AuthShell variant="login">
      <LoginForm initialError={authFormErrorMessage('login', errorCode)} />
    </AuthShell>
  );
}
