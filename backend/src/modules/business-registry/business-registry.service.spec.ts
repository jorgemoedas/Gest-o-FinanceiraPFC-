import { GatewayTimeoutException, NotFoundException } from '@nestjs/common';
import { AuthPrincipal } from '../../common/auth-principal';
import { AuditLogWriter } from '../audit/audit-log-writer.service';
import { BusinessRegistryService } from './business-registry.service';

const principal: AuthPrincipal = {
  userId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10',
  email: 'owner@example.test',
  companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8',
  role: 'OWNER' as AuthPrincipal['role']
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('BusinessRegistryService', () => {
  const audit = { write: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogWriter;
  let service: BusinessRegistryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BusinessRegistryService(audit);
  });

  it('normalizes only necessary company registration fields and reuses the local cache', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({
      status: 'OK',
      cnpj: '11.378.117/0001-20',
      nome: 'Empresa Exemplo Ltda.',
      fantasia: 'Exemplo',
      situacao: 'ATIVA',
      tipo: 'MATRIZ',
      porte: 'ME',
      abertura: '24/11/2009',
      email: 'nao-deve-retornar@example.test',
      telefone: '11999999999',
      atividade_principal: [{ code: '62.01-5-01', text: 'Desenvolvimento de programas' }],
      municipio: 'São Paulo',
      uf: 'SP'
    }));

    const first = await service.lookup('11.378.117/0001-20', principal);
    const second = await service.lookup('11378117000120', principal);

    expect(first.legalName).toBe('Empresa Exemplo Ltda.');
    expect(first.mainActivity?.code).toBe('62.01-5-01');
    expect('email' in first).toBe(false);
    expect('telefone' in first).toBe(false);
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(audit.write).toHaveBeenCalledTimes(2);
    fetch.mockRestore();
  });

  it('maps a public API cache miss to a safe not-found response', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ status: 'ERROR', message: 'CNPJ não encontrado no cache' }));
    await expect(service.lookup('12.ABC.345/01DE-35', principal)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'BUSINESS_REGISTRY_CNPJ_LOOKUP' }));
    fetch.mockRestore();
  });

  it('maps an upstream timeout to a gateway timeout without leaking the provider error', async () => {
    const timeout = new Error('socket detail should not escape');
    timeout.name = 'TimeoutError';
    const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(timeout);
    await expect(service.lookup('12.ABC.345/01DE-35', principal)).rejects.toBeInstanceOf(GatewayTimeoutException);
    fetch.mockRestore();
  });
});
