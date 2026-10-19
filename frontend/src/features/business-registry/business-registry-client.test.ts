import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupBusinessRegistry, normalizeCnpjInput } from './business-registry-client';

const record = {
  cnpj: '11378117000120',
  legalName: 'Empresa Exemplo Ltda.',
  tradeName: 'Exemplo',
  registrationStatus: 'ATIVA',
  companyType: 'MATRIZ',
  size: 'ME',
  openingDate: '24/11/2009',
  mainActivity: { code: '62.01-5-01', description: 'Desenvolvimento de programas' },
  address: { street: null, number: null, complement: null, district: null, city: 'São Paulo', state: 'SP', postalCode: null },
  source: 'ReceitaWS',
  sourceUpdatedAt: '2026-10-05T17:00:00.000Z'
};

afterEach(() => vi.unstubAllGlobals());

describe('business registry client', () => {
  it('normalizes punctuation and uppercase letters for numeric and alphanumeric CNPJs', () => {
    expect(normalizeCnpjInput('11.378.117/0001-20')).toBe('11378117000120');
    expect(normalizeCnpjInput('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });

  it('rejects malformed CNPJ input before calling the BFF', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(lookupBusinessRegistry('12345')).rejects.toThrow('14 caracteres');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the same-origin BFF without caching and validates a ReceitaWS record', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(record), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(lookupBusinessRegistry('11.378.117/0001-20')).resolves.toEqual(record);
    expect(fetchMock).toHaveBeenCalledWith('/api/business-registry/cnpj/11378117000120', expect.objectContaining({
      method: 'GET', cache: 'no-store', credentials: 'same-origin'
    }));
  });

  it('surfaces a safe API message for a CNPJ not found by ReceitaWS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'A consulta pública da ReceitaWS não tem este CNPJ disponível no cache.' }), { status: 404 })));
    await expect(lookupBusinessRegistry('11.378.117/0001-20')).rejects.toThrow('CNPJ disponível no cache');
  });

  it('rejects malformed provider records instead of rendering untrusted shapes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...record, source: 'Other' }), { status: 200 })));
    await expect(lookupBusinessRegistry('11.378.117/0001-20')).rejects.toThrow('formato inválido');
  });

  it('maps network errors to a safe localized message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private network detail')));
    await expect(lookupBusinessRegistry('11.378.117/0001-20')).rejects.toThrow('Verifique sua conexão');
  });
});
