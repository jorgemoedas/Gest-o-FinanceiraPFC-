'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, LoaderCircle, Mail } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { login } from '@/features/auth/auth-client';
import { loginSchema, type LoginFormValues } from '@/features/auth/validation';
import { PasswordField } from './password-field';

export function LoginForm({ initialError = '' }: { initialError?: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState(initialError);
  const {
    register: registerField,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onTouched'
  });

  async function onSubmit(values: LoginFormValues) {
    setServerError('');
    try {
      await login(values);
      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Não foi possível entrar. Tente novamente.');
    }
  }

  return (
    <section className="form-card" aria-labelledby="login-title">
      <div className="form-heading">
        <p className="form-kicker">SUA EMPRESA, EM FOCO</p>
        <h1 id="login-title">Acesse sua gestão financeira</h1>
        <p>Entre com os dados cadastrados para continuar.</p>
      </div>

      {serverError ? <div className="notice notice--error" role="alert">{serverError}</div> : null}

      <form method="post" action="/api/auth/login" className="auth-form" onSubmit={handleSubmit(onSubmit)}>
        <div className="field-group">
          <label className="field-label" htmlFor="email">E-mail</label>
          <div className={`input-wrap${errors.email ? ' input-wrap--error' : ''}`}>
            <Mail className="input-icon" size={18} aria-hidden="true" />
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={320}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              placeholder="voce@empresa.com.br"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...registerField('email')}
            />
          </div>
          {errors.email?.message ? <p className="field-error" id="email-error">{errors.email.message}</p> : null}
        </div>

        <PasswordField
          registration={registerField('password')}
          error={errors.password?.message}
          autoComplete="current-password"
        />

        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? <LoaderCircle size={18} className="spinner" aria-hidden="true" /> : null}
          <span>{isSubmitting ? 'Verificando acesso…' : 'Entrar na conta'}</span>
          {!isSubmitting ? <ArrowRight size={18} aria-hidden="true" /> : null}
        </button>
      </form>

      <p className="switch-auth">Ainda não tem acesso? <Link href="/register">Criar uma conta <ArrowRight size={15} aria-hidden="true" /></Link></p>
      <p className="form-security">O token da sessão não é exposto ao JavaScript do navegador.</p>
    </section>
  );
}
