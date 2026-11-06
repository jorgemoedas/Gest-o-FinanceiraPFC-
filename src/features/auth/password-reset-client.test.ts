import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmPasswordReset, passwordResetConfirmSchema, passwordResetRequestSchema, requestPasswordReset } from './password-reset-client';

afterEach(() => vi.restoreAllMocks());

describe('password reset client', () => {
  it('usa schemas estritos e política UTF-8 da senha', () => {
    expect(passwordResetRequestSchema.safeParse({ email: 'a@b.test', extra: true }).success).toBe(false);
    expect(passwordResetConfirmSchema.safeParse({ token: 'x', newPassword: 'é'.repeat(37) }).success).toBe(false);
  });

  it('solicita reset no caminho relativo com same-origin credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ delivered: false }) }));
    await expect(requestPasswordReset(' pessoa@empresa.test ')).resolves.toEqual({ delivered: false });
    expect(fetch).toHaveBeenCalledWith('/api/auth/password-reset', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
  });

  it('confirma reset e propaga mensagem de erro da API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reset: true }) }));
    await expect(confirmPasswordReset({ token: 'token', newPassword: 'senha-nova-segura' })).resolves.toEqual({ reset: true });
    expect(fetch).toHaveBeenCalledWith('/api/auth/password-reset/confirm', expect.objectContaining({ credentials: 'same-origin' }));
  });
});
