import { describe, expect, it } from 'vitest';
import { authFormErrorMessage } from './form-errors';

describe('auth form error allowlist', () => {
  it('returns only explicit string messages for each page', () => {
    expect(authFormErrorMessage('login', 'invalid-credentials')).toBe('E-mail ou senha inválidos.');
    expect(authFormErrorMessage('register', 'documents-updated')).toContain('recarregue');
  });
  it('ignores prototype/inherited keys and unknown codes', () => {
    for (const kind of ['login', 'register'] as const) {
      for (const code of ['__proto__', 'constructor', 'toString', 'attacker-controlled']) {
        expect(authFormErrorMessage(kind, code)).toBe('');
      }
    }
  });
  it('does not render non-string values from parameters', () => {
    expect(authFormErrorMessage('login', ['invalid-form'])).toBe('');
    expect(authFormErrorMessage('register', {})).toBe('');
    expect(authFormErrorMessage('register', undefined)).toBe('');
  });
});
