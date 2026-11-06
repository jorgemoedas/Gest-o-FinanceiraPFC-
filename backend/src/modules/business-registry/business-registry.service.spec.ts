import { BadGatewayException, GatewayTimeoutException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
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
  const audit = {
    write: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
  } as unknown as AuditLogWriter;
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

  it('rejects an invalid CNPJ returned by the provider', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({
      status: 'OK', cnpj: '11.378.117/0001-21', nome: 'Cadastro inválido'
    }));

    await expect(service.lookup('12.ABC.345/01DE-35', principal)).rejects.toBeInstanceOf(BadGatewayException);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ result: 'failed_502' })
    }));
    fetch.mockRestore();
  });

  it('rejects a valid but different CNPJ returned by the provider', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({
      status: 'OK', cnpj: '11.378.117/0001-20', nome: 'Cadastro divergente'
    }));

    await expect(service.lookup('12.ABC.345/01DE-35', principal)).rejects.toBeInstanceOf(BadGatewayException);
    fetch.mockRestore();
  });

  it('retries a transient network failure once and succeeds without a real network call', async () => {
    const fetch = jest.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockResolvedValueOnce(jsonResponse({ status: 'OK', cnpj: '11378117000120', nome: 'Cadastro de teste' }));
    await expect(service.lookup('11.378.117/0001-20', principal)).resolves.toMatchObject({ legalName: 'Cadastro de teste' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]?.signal).toBeDefined();
    fetch.mockRestore();
  });

  it('does not retry a permanent invalid provider response', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({
      status: 'OK', cnpj: '11378117000121', nome: 'Cadastro divergente'
    }));
    await expect(service.lookup('11.378.117/0001-20', principal)).rejects.toBeInstanceOf(BadGatewayException);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockRestore();
  });

  it('retries timeout failures and returns an explicit gateway timeout', async () => {
    const timeout = new Error('synthetic timeout');
    timeout.name = 'TimeoutError';
    const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(timeout);
    await expect(service.lookup('11.378.117/0001-20', principal)).rejects.toBeInstanceOf(GatewayTimeoutException);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockRestore();
  });

  it('opens the circuit after consecutive upstream failures and permits recovery after the window', async () => {
    jest.useFakeTimers();
    const config = { get: (_key: string, fallback?: string) => ({
      UPSTREAM_MAX_ATTEMPTS: '1', UPSTREAM_CIRCUIT_FAILURES: '2', UPSTREAM_CIRCUIT_RECOVERY_MS: '100'
    } as Record<string, string>)[_key] ?? fallback } as unknown as ConfigService;
    service = new BusinessRegistryService(audit, config);
    const fetch = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ status: 'OK', cnpj: '11378117000120', nome: 'Recuperada' }));
    await expect(service.lookup('11.378.117/0001-20', principal)).rejects.toThrow();
    await expect(service.lookup('11.378.117/0001-20', principal)).rejects.toThrow();
    await expect(service.lookup('11.378.117/0001-20', principal)).rejects.toThrow('temporariamente indisponível após falhas repetidas');
    expect(fetch).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(101);
    await expect(service.lookup('11.378.117/0001-20', principal)).resolves.toMatchObject({ legalName: 'Recuperada' });
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockRestore();
    jest.useRealTimers();
  });
});
