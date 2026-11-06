import { describe, expect, it } from 'vitest';
import { loginSchema, registerRequestSchema } from './validation';

const validRegistration = {
  email: 'financeiro@cafedapraca.com.br',
  password: 'senha-segura-de-12',
  companyName: 'Café da Praça',
  acceptedTerms: true,
  acceptedPrivacy: true,
  termsVersion: '2026-10-01',
  privacyVersion: '2026-10-01'
};

describe('auth input schemas', () => {
  it('accepts a valid login and trims email whitespace', () => {
    const result = loginSchema.safeParse({ email: '  pessoa@empresa.com.br ', password: 'senha-correta' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('pessoa@empresa.com.br');
  });

  it('rejects malformed email and empty password on login', () => {
    expect(loginSchema.safeParse({ email: 'invalido', password: '' }).success).toBe(false);
  });

  it('accepts a registration with both current document versions and consent', () => {
    expect(registerRequestSchema.safeParse(validRegistration).success).toBe(true);
  });

  it('requires separate affirmative terms and privacy acceptance', () => {
    expect(registerRequestSchema.safeParse({ ...validRegistration, acceptedTerms: false }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...validRegistration, acceptedPrivacy: false }).success).toBe(false);
  });

  it('rejects a password whose UTF-8 byte count exceeds bcrypt’s 72-byte limit', () => {
    const result = registerRequestSchema.safeParse({ ...validRegistration, password: 'é'.repeat(37) });
    expect(result.success).toBe(false);
  });

  it('rejects company names over 160 characters and passwords over 72 characters', () => {
    expect(registerRequestSchema.safeParse({ ...validRegistration, companyName: 'x'.repeat(161) }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...validRegistration, password: 'a'.repeat(73) }).success).toBe(false);
  });

  it('rejects unknown registration fields instead of forwarding them', () => {
    expect(registerRequestSchema.safeParse({ ...validRegistration, accessToken: 'injected' }).success).toBe(false);
  });
});
