import { describe, expect, it } from 'vitest';
import { extractApiMessage } from './api-message';

describe('extractApiMessage', () => {
  it('joins validation messages returned as an array by NestJS', () => {
    expect(extractApiMessage({ message: ['E-mail inválido.', 'Senha obrigatória.'] }, 400)).toBe('E-mail inválido. Senha obrigatória.');
  });

  it('uses a safe credential message for 401 responses without details', () => {
    expect(extractApiMessage(null, 401)).toContain('E-mail ou senha incorretos');
  });

  it('explains an unavailable upstream API', () => {
    expect(extractApiMessage({}, 503)).toContain('Não foi possível conectar');
  });

  it('returns a generic safe message for an unknown payload', () => {
    expect(extractApiMessage({ detail: 'internal stack trace' }, 418)).toContain('Não foi possível concluir');
  });
});
