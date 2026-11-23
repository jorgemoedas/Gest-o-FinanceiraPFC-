'use client';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterForm } from './register-form';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => <a {...props}>{children}</a>
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() })
}));

vi.mock('@/features/auth/auth-client', () => ({
  register: vi.fn().mockResolvedValue(undefined)
}));

describe('RegisterForm draft persistence', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('preserva os campos não sensíveis ao navegar para os termos e voltar ao cadastro', async () => {
    const user = userEvent.setup();
    const view = render(<RegisterForm documentVersions={{ termsVersion: '2026.1', privacyVersion: '2026.1' }} />);

    await user.type(screen.getByLabelText('Nome da empresa'), 'Café da Praça');
    await user.type(screen.getByLabelText('E-mail'), 'pessoa@empresa.test');
    await user.click(screen.getByLabelText(/Li e aceito os Termos de Uso/));
    await user.click(screen.getByLabelText(/Li e aceito a Política de Privacidade/));

    const termsLink = screen.getByRole('link', { name: 'Ler termos' });
    expect(termsLink).toHaveAttribute('href', '/termos?from=cadastro');
    await user.click(termsLink);
    expect(JSON.parse(sessionStorage.getItem('gft_register_draft') ?? '{}')).toEqual({
      companyName: 'Café da Praça',
      email: 'pessoa@empresa.test',
      acceptedTerms: true,
      acceptedPrivacy: true
    });

    window.history.pushState({}, '', '/termos?from=cadastro');
    view.unmount();
    window.history.pushState({}, '', '/register');
    render(<RegisterForm documentVersions={{ termsVersion: '2026.1', privacyVersion: '2026.1' }} />);

    expect(screen.getByLabelText('Nome da empresa')).toHaveValue('Café da Praça');
    expect(screen.getByLabelText('E-mail')).toHaveValue('pessoa@empresa.test');
    expect(screen.getByLabelText(/Li e aceito os Termos de Uso/)).toBeChecked();
    expect(screen.getByLabelText(/Li e aceito a Política de Privacidade/)).toBeChecked();
    expect(screen.getByLabelText('Senha')).toHaveValue('');
  });
});
