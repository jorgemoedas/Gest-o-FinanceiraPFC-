import { afterEach, describe, expect, it, vi } from 'vitest';
import { erasePrivacyData, exportPrivacyData } from './privacy-client';

afterEach(() => vi.restoreAllMocks());

const exportData = {
  generatedAt: '2026-10-21T00:00:00.000Z',
  subject: { userId: 'user-1', email: 'a@b.test' },
  memberships: [],
  acceptances: [],
  authoredTransactions: [],
  auditEvents: []
};

describe('privacy client', () => {
  it('exporta dados pelo caminho relativo e usa credentials same-origin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => exportData }));
    await expect(exportPrivacyData()).resolves.toEqual(exportData);
    expect(fetch).toHaveBeenCalledWith('/api/privacy/export', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));
  });

  it('envia confirmação de eliminação e valida a resposta', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ erased: true, retained: ['lançamentos'] }) }));
    await expect(erasePrivacyData('ELIMINAR MEUS DADOS')).resolves.toEqual({ erased: true, retained: ['lançamentos'] });
    expect(fetch).toHaveBeenCalledWith('/api/privacy/erase', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ confirmation: 'ELIMINAR MEUS DADOS' }) }));
  });
});
