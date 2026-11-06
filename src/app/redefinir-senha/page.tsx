'use client';

import Link from 'next/link';
import { ArrowRight, KeyRound, LoaderCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { confirmPasswordReset, passwordResetConfirmSchema } from '@/features/auth/password-reset-client';

function RedefinirSenhaForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (newPassword !== repeatPassword) {
      setError('As duas senhas precisam ser iguais.');
      return;
    }
    const parsed = passwordResetConfirmSchema.safeParse({ token, newPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira o token e a nova senha.');
      return;
    }
    setLoading(true);
    try {
      await confirmPasswordReset(parsed.data);
      setSuccess(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível redefinir sua senha.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell variant="login">
      <section className="form-card" aria-labelledby="reset-title">
        <div className="form-heading">
          <p className="form-kicker">NOVA CREDENCIAL</p>
          <h1 id="reset-title">Defina uma nova senha</h1>
          <p>Escolha uma senha com pelo menos 12 caracteres e até 72 bytes em UTF-8.</p>
        </div>
        {error ? <div className="notice notice--error" role="alert">{error}</div> : null}
        {success ? (
          <div className="notice" role="status">Senha redefinida com sucesso. Agora você já pode entrar com a nova senha.</div>
        ) : (
          <form className="auth-form" onSubmit={submit} noValidate>
            <div className="field-group">
              <label className="field-label" htmlFor="new-password">Nova senha</label>
              <div className={`input-wrap${error ? ' input-wrap--error' : ''}`}>
                <KeyRound className="input-icon" size={18} aria-hidden="true" />
                <input id="new-password" type="password" autoComplete="new-password" maxLength={72} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
              </div>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="repeat-password">Repita a nova senha</label>
              <div className="input-wrap">
                <KeyRound className="input-icon" size={18} aria-hidden="true" />
                <input id="repeat-password" type="password" autoComplete="new-password" maxLength={72} value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} required />
              </div>
            </div>
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? <LoaderCircle size={18} className="spinner" aria-hidden="true" /> : null}
              <span>{loading ? 'Salvando…' : 'Redefinir senha'}</span>
              {!loading ? <ArrowRight size={18} aria-hidden="true" /> : null}
            </button>
          </form>
        )}
        <p className="switch-auth"><Link href="/login">Voltar para o login <ArrowRight size={15} aria-hidden="true" /></Link></p>
        <p className="form-security">O link é de uso único e expira após 30 minutos.</p>
      </section>
    </AuthShell>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <Suspense fallback={null}>
      <RedefinirSenhaForm />
    </Suspense>
  );
}
