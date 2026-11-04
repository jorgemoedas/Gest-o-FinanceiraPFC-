'use client';

import { useState } from 'react';
import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import type { UseFormRegisterReturn } from 'react-hook-form';

interface PasswordFieldProps {
  registration: UseFormRegisterReturn<'password'>;
  error?: string;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
}

export function PasswordField({ registration, error, autoComplete, hint }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const feedbackId = error ? 'password-error' : hint ? 'password-hint' : undefined;

  return (
    <div className="field-group">
      <label className="field-label" htmlFor="password">Senha</label>
      <div className={`input-wrap${error ? ' input-wrap--error' : ''}`}>
        <LockKeyhole className="input-icon" size={18} aria-hidden="true" />
        <input
          id="password"
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          maxLength={72}
          minLength={autoComplete === 'new-password' ? 12 : 1}
          required
          placeholder={autoComplete === 'new-password' ? 'Crie uma senha segura' : 'Digite sua senha'}
          aria-invalid={Boolean(error)}
          aria-describedby={feedbackId}
          {...registration}
        />
        <button
          className="password-toggle"
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {error ? <p className="field-error" id="password-error">{error}</p> : null}
      {!error && hint ? <p className="field-hint" id="password-hint">{hint}</p> : null}
    </div>
  );
}
