import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { CounterpartyRole } from '../../generated/prisma/client';
import { AuthPrincipal } from '../../common/auth-principal';
import { setTenantContext } from '../../database/tenant-context';
import { PrismaService } from '../../database/prisma.service';
import { BusinessRegistryRecord, BusinessRegistryService } from '../business-registry/business-registry.service';
import { CounterpartyService } from './counterparty.service';

jest.mock('../../database/tenant-context', () => ({
  setTenantContext: jest.fn(async (_tx: unknown, _principal: unknown) => undefined)
}));

const principal: AuthPrincipal = {
  userId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10',
  email: 'owner@example.test',
  companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8',
  role: 'OWNER' as AuthPrincipal['role']
};
const counterparty = {
  id: '5d2a9a0e-339a-470e-9cc0-4624044cae86',
  name: 'Fornecedor Exemplo',
  role: CounterpartyRole.SUPPLIER,
  cnpj: null,
  legalName: null,
  tradeName: null,
  source: null,
  consultedAt: null
};
const registryRecord: BusinessRegistryRecord = {
  cnpj: '11378117000120',
  legalName: 'Fornecedor Exemplo Ltda.',
  tradeName: 'Exemplo',
  registrationStatus: 'ATIVA',
  companyType: 'MATRIZ',
  size: 'ME',
  openingDate: '24/11/2009',
  mainActivity: null,
  address: {
    street: 'Rua privada',
    number: '10',
    complement: null,
    district: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    postalCode: '01001000'
  },
  source: 'ReceitaWS',
  sourceUpdatedAt: '2026-10-20T20:00:00.000Z'
};
const enrichedCounterparty = {
  ...counterparty,
  cnpj: registryRecord.cnpj,
  legalName: registryRecord.legalName,
  tradeName: registryRecord.tradeName,
  source: registryRecord.source,
  consultedAt: new Date(registryRecord.sourceUpdatedAt)
};

const transaction = {
  financeCounterparty: {
    count: jest.fn<(...args: unknown[]) => Promise<number>>(),
    findMany: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
    create: jest.fn<(...args: unknown[]) => Promise<unknown>>()
  },
  auditLog: { create: jest.fn<(...args: unknown[]) => Promise<unknown>>() }
};
const prismaMock = {
  financeCounterparty: {
    count: jest.fn<(...args: unknown[]) => Promise<number>>(),
    findMany: jest.fn<(...args: unknown[]) => Promise<unknown[]>>()
  },
  $transaction: jest.fn<(...args: unknown[]) => Promise<unknown>>()
};
const registryMock = {
  lookup: jest.fn<(...args: unknown[]) => Promise<BusinessRegistryRecord>>()
};

function runTransaction(callback: unknown): Promise<unknown> {
  return (callback as (tx: typeof transaction) => Promise<unknown>)(transaction);
}

describe('CounterpartyService', () => {
  let service: CounterpartyService;

  beforeEach(() => {
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation(runTransaction);
    service = new CounterpartyService(
      prismaMock as unknown as PrismaService,
      registryMock as unknown as BusinessRegistryService
    );
  });

  it('lists only the authenticated company and includes records usable in the requested role', async () => {
    transaction.financeCounterparty.count.mockResolvedValue(1);
    transaction.financeCounterparty.findMany.mockResolvedValue([counterparty]);

    const result = await service.list(principal, { page: 1, limit: 100, role: CounterpartyRole.SUPPLIER });

    expect(transaction.financeCounterparty.count).toHaveBeenCalledWith({
      where: { companyId: principal.companyId, role: { in: [CounterpartyRole.SUPPLIER, CounterpartyRole.BOTH] } }
    });
    expect(transaction.financeCounterparty.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: principal.companyId, role: { in: [CounterpartyRole.SUPPLIER, CounterpartyRole.BOTH] } },
      skip: 0,
      take: 100,
      select: { id: true, name: true, role: true, cnpj: true, legalName: true, tradeName: true, source: true, consultedAt: true }
    }));
    expect(result).toMatchObject({ total: 1, totalPages: 1, items: [counterparty] });
    expect(setTenantContext).toHaveBeenCalledWith(transaction, principal);
    expect(prismaMock.financeCounterparty.count).not.toHaveBeenCalled();
    expect(prismaMock.financeCounterparty.findMany).not.toHaveBeenCalled();
  });

  it('searches by name within the company and applies the requested page after filtering', async () => {
    const customer = { id: 'c937a3ab-37a8-4451-9f8d-3efbe5784619', name: 'Clínica Exemplo', role: CounterpartyRole.BOTH };
    transaction.financeCounterparty.count.mockResolvedValue(101);
    transaction.financeCounterparty.findMany.mockResolvedValue([customer]);

    const result = await service.list(principal, {
      page: 2,
      limit: 100,
      role: CounterpartyRole.CUSTOMER,
      search: 'Clínica'
    });

    const where = {
      companyId: principal.companyId,
      role: { in: [CounterpartyRole.CUSTOMER, CounterpartyRole.BOTH] },
      name: { contains: 'Clínica', mode: 'insensitive' }
    };
    expect(transaction.financeCounterparty.count).toHaveBeenCalledWith({ where });
    expect(transaction.financeCounterparty.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where,
      skip: 100,
      take: 100
    }));
    expect(result).toMatchObject({ page: 2, total: 101, totalPages: 2, items: [customer] });
  });

  it('trata percentual como caractere literal e não retorna toda a lista', async () => {
    transaction.financeCounterparty.count.mockResolvedValue(0);
    transaction.financeCounterparty.findMany.mockResolvedValue([]);

    const result = await service.list(principal, { page: 1, limit: 100, search: '%' });

    expect(transaction.financeCounterparty.count).toHaveBeenCalledWith({ where: {
      companyId: principal.companyId,
      name: { contains: '\\%', mode: 'insensitive' }
    } });
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('creates a company-owned record and writes an audit event in the same transaction', async () => {
    transaction.financeCounterparty.create.mockResolvedValue(counterparty);
    transaction.auditLog.create.mockResolvedValue({});

    await expect(service.create(principal, { name: '  Fornecedor Exemplo  ', role: CounterpartyRole.SUPPLIER })).resolves.toEqual(counterparty);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.financeCounterparty.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        companyId: principal.companyId,
        name: 'Fornecedor Exemplo',
        role: CounterpartyRole.SUPPLIER,
        cnpj: null,
        legalName: null,
        tradeName: null,
        source: null,
        consultedAt: null
      },
      select: { id: true, name: true, role: true, cnpj: true, legalName: true, tradeName: true, source: true, consultedAt: true }
    }));
    expect(registryMock.lookup).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: principal.userId,
        companyId: principal.companyId,
        action: 'FINANCE_COUNTERPARTY_CREATED',
        entityId: counterparty.id,
        metadata: {
          before: null,
          after: {
            id: counterparty.id,
            name: counterparty.name,
            role: CounterpartyRole.SUPPLIER,
            cnpjMasked: null,
            legalName: null,
            tradeName: null,
            source: null,
            consultedAt: null
          }
        }
      })
    }));
  });

  it('propagates an audit failure so the transaction can roll back the new record', async () => {
    transaction.financeCounterparty.create.mockResolvedValue(counterparty);
    transaction.auditLog.create.mockRejectedValue(new Error('audit unavailable'));

    await expect(service.create(principal, { name: counterparty.name, role: counterparty.role }))
      .rejects.toThrow('audit unavailable');

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.financeCounterparty.create).toHaveBeenCalledTimes(1);
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('reconsults ReceitaWS server-side and stores only the minimum trusted cadastral fields', async () => {
    registryMock.lookup.mockResolvedValue(registryRecord);
    transaction.financeCounterparty.create.mockResolvedValue(enrichedCounterparty);
    transaction.auditLog.create.mockResolvedValue({});

    await expect(service.create(principal, {
      name: '  Nome informado pelo usuário  ',
      role: CounterpartyRole.SUPPLIER,
      cnpj: '11.378.117/0001-20'
    })).resolves.toEqual(enrichedCounterparty);

    expect(registryMock.lookup).toHaveBeenCalledWith('11.378.117/0001-20', principal);
    expect(transaction.financeCounterparty.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        companyId: principal.companyId,
        name: 'Nome informado pelo usuário',
        role: CounterpartyRole.SUPPLIER,
        cnpj: registryRecord.cnpj,
        legalName: registryRecord.legalName,
        tradeName: registryRecord.tradeName,
        source: 'ReceitaWS',
        consultedAt: new Date(registryRecord.sourceUpdatedAt)
      }
    }));
    const auditCall = transaction.auditLog.create.mock.calls[0]?.[0] as { data: { metadata: { after: Record<string, unknown> } } };
    expect(auditCall.data.metadata.after).toMatchObject({
      cnpjMasked: '11**********20',
      legalName: registryRecord.legalName,
      tradeName: registryRecord.tradeName,
      source: 'ReceitaWS'
    });
    expect(auditCall.data.metadata.after).not.toHaveProperty('address');
  });

  it('does not open a database transaction when the server-side registry consultation fails', async () => {
    registryMock.lookup.mockRejectedValue(new Error('provider unavailable'));

    await expect(service.create(principal, {
      name: 'Fornecedor Exemplo',
      role: CounterpartyRole.SUPPLIER,
      cnpj: '11378117000120'
    })).rejects.toThrow('provider unavailable');

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('maps a duplicate enriched CNPJ to a safe conflict response', async () => {
    registryMock.lookup.mockResolvedValue(registryRecord);
    transaction.financeCounterparty.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.create(principal, {
      name: 'Fornecedor Exemplo',
      role: CounterpartyRole.SUPPLIER,
      cnpj: registryRecord.cnpj
    })).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });
});
