'use client';

import Link from 'next/link';
import { ArrowRight, LoaderCircle, Mail } from 'lucide-react';
import { useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { passwordResetRequestSchema, requestPasswordReset } from '@/features/auth/password-reset-client';

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const parsed = passwordResetRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Informe um e-mail válido.');
      return;
    }
    setLoading(true);
    try {
      await requestPasswordReset(parsed.data.email);
      setSuccess(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível solicitar a recuperação.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell variant="login">
      <section className="form-card" aria-labelledby="recover-title">
        <div className="form-heading">
          <p className="form-kicker">RECUPERE SEU ACESSO</p>
          <h1 id="recover-title">Esqueceu sua senha?</h1>
          <p>Informe o e-mail da conta. Se existir um acesso, enviaremos as instruções disponíveis para redefinição.</p>
        </div>
        {error ? <div className="notice notice--error" role="alert">{error}</div> : null}
        {success ? (
          <div className="notice" role="status">Se houver uma conta para este e-mail, você receberá um link de redefinição. Confira também a caixa de spam.</div>
        ) : (
          <form className="auth-form" onSubmit={submit} noValidate>
            <div className="field-group">
              <label className="field-label" htmlFor="recover-email">E-mail</label>
              <div className={`input-wrap${error ? ' input-wrap--error' : ''}`}>
                <Mail className="input-icon" size={18} aria-hidden="true" />
                <input id="recover-email" type="email" inputMode="email" autoComplete="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com.br" required />
              </div>
            </div>
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? <LoaderCircle size={18} className="spinner" aria-hidden="true" /> : null}
              <span>{loading ? 'Solicitando…' : 'Enviar instruções'}</span>
              {!loading ? <ArrowRight size={18} aria-hidden="true" /> : null}
            </button>
          </form>
        )}
        <p className="switch-auth"><Link href="/login">Voltar para o login <ArrowRight size={15} aria-hidden="true" /></Link></p>
        <p className="form-security">Por segurança, a resposta não confirma se o e-mail está cadastrado.</p>
      </section>
    </AuthShell>
  );
}
