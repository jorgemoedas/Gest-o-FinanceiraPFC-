'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Building2, LoaderCircle, Mail } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { register as createAccount } from '@/features/auth/auth-client';
import type { AuthDocumentVersions } from '@/features/auth/types';
import { registerFormSchema, type RegisterFormValues } from '@/features/auth/validation';
import { PasswordField } from './password-field';

export function RegisterForm({ documentVersions, initialError = '' }: { documentVersions: AuthDocumentVersions | null; initialError?: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState(initialError);
  const {
    register: registerField,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { email: '', password: '', companyName: '', acceptedTerms: false, acceptedPrivacy: false },
    mode: 'onTouched'
  });

  async function onSubmit(values: RegisterFormValues) {
    if (!documentVersions) {
      setServerError('As versões vigentes dos documentos não estão configuradas no servidor. Avise o administrador.');
      return;
    }
    setServerError('');
    try {
      await createAccount({
        ...values,
        termsVersion: documentVersions.termsVersion,
        privacyVersion: documentVersions.privacyVersion
      });
      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Não foi possível criar a conta. Tente novamente.');
    }
  }

  const versionsUnavailable = !documentVersions;
  const versionsError = versionsUnavailable
    ? 'As versões vigentes dos Termos de Uso e da Política de Privacidade não estão configuradas no servidor.'
    : '';

  return (
    <section className="form-card form-card--register" aria-labelledby="register-title">
      <div className="form-heading">
        <p className="form-kicker">CADASTRO DA EMPRESA</p>
        <h1 id="register-title">Comece com sua empresa em foco</h1>
        <p>Crie seu acesso para organizar a rotina financeira.</p>
      </div>

      {serverError ? <div className="notice notice--error" role="alert">{serverError}</div> : null}
      {versionsError ? <div className="notice notice--error" role="alert">{versionsError}</div> : null}

      <form method="post" action="/api/auth/register" className="auth-form" onSubmit={handleSubmit(onSubmit)}>
        {documentVersions ? (
          <>
            <input type="hidden" name="termsVersion" value={documentVersions.termsVersion} />
            <input type="hidden" name="privacyVersion" value={documentVersions.privacyVersion} />
          </>
        ) : null}
        <div className="field-group">
          <label className="field-label" htmlFor="companyName">Nome da empresa</label>
          <div className={`input-wrap${errors.companyName ? ' input-wrap--error' : ''}`}>
            <Building2 className="input-icon" size={18} aria-hidden="true" />
            <input
              id="companyName"
              type="text"
              autoComplete="organization"
              maxLength={160}
              minLength={2}
              required
              placeholder="Ex.: Café da Praça"
              aria-invalid={Boolean(errors.companyName)}
              aria-describedby={errors.companyName ? 'company-error' : undefined}
              {...registerField('companyName')}
            />
          </div>
          {errors.companyName?.message ? <p className="field-error" id="company-error">{errors.companyName.message}</p> : null}
        </div>

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
          autoComplete="new-password"
          hint="Mínimo de 12 caracteres e até 72 bytes em UTF-8."
        />

        <fieldset className="consent-fieldset" disabled={isSubmitting}>
          <legend>Confirmações obrigatórias</legend>
          <div className="consent-row">
            <label className={`consent-option${errors.acceptedTerms ? ' consent-option--error' : ''}`} htmlFor="acceptedTerms">
              <input id="acceptedTerms" type="checkbox" required {...registerField('acceptedTerms')} aria-invalid={Boolean(errors.acceptedTerms)} />
              <span>Li e aceito os <strong>Termos de Uso</strong>{documentVersions ? <small>Versão {documentVersions.termsVersion}</small> : null}</span>
            </label>
            <Link className="consent-document-link" href="/termos" target="_blank" rel="noopener noreferrer">Ler termos</Link>
          </div>
          {errors.acceptedTerms?.message ? <p className="field-error consent-error">{errors.acceptedTerms.message}</p> : null}

          <div className="consent-row">
            <label className={`consent-option${errors.acceptedPrivacy ? ' consent-option--error' : ''}`} htmlFor="acceptedPrivacy">
              <input id="acceptedPrivacy" type="checkbox" required {...registerField('acceptedPrivacy')} aria-invalid={Boolean(errors.acceptedPrivacy)} />
              <span>Li e aceito a <strong>Política de Privacidade</strong>{documentVersions ? <small>Versão {documentVersions.privacyVersion}</small> : null}</span>
            </label>
            <Link className="consent-document-link" href="/privacidade" target="_blank" rel="noopener noreferrer">Ler política</Link>
          </div>
          {errors.acceptedPrivacy?.message ? <p className="field-error consent-error">{errors.acceptedPrivacy.message}</p> : null}

          {versionsUnavailable ? <p className="field-hint">O cadastro será liberado após configurar as versões legais no servidor.</p> : null}
        </fieldset>

        <button className="primary-button" type="submit" disabled={isSubmitting || versionsUnavailable || Boolean(versionsError)}>
          {isSubmitting ? <LoaderCircle size={18} className="spinner" aria-hidden="true" /> : null}
          <span>{isSubmitting ? 'Criando seu acesso…' : 'Criar conta'}</span>
          {!isSubmitting ? <ArrowRight size={18} aria-hidden="true" /> : null}
        </button>
      </form>

      <p className="switch-auth">Já tem acesso? <Link href="/login">Entrar na conta <ArrowRight size={15} aria-hidden="true" /></Link></p>
      <p className="form-security">O token da sessão não é exposto ao JavaScript do navegador.</p>
    </section>
  );
}
