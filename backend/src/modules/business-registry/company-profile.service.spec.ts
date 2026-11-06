import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { AuthPrincipal } from '../../common/auth-principal';
import { setTenantContext } from '../../database/tenant-context';
import { PrismaService } from '../../database/prisma.service';
import { BusinessRegistryRecord, BusinessRegistryService } from './business-registry.service';
import { CompanyProfileService } from './company-profile.service';

jest.mock('../../database/tenant-context', () => ({
  setTenantContext: jest.fn(async (_tx: unknown, _principal: unknown) => undefined)
}));

const principal: AuthPrincipal = {
  userId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10',
  email: 'owner@example.test',
  companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8',
  role: 'OWNER' as AuthPrincipal['role']
};

const record: BusinessRegistryRecord = {
  cnpj: '11378117000120',
  legalName: 'Empresa Exemplo Ltda.',
  tradeName: 'Exemplo',
  registrationStatus: 'ATIVA',
  companyType: 'MATRIZ',
  size: 'ME',
  openingDate: '24/11/2009',
  mainActivity: { code: '62.01-5-01', description: 'Desenvolvimento de programas' },
  address: {
    street: 'Rua de Exemplo', number: '10', complement: null, district: 'Centro',
    city: 'São Paulo', state: 'SP', postalCode: '01001000'
  },
  source: 'ReceitaWS',
  sourceUpdatedAt: '2026-10-20T20:00:00.000Z'
};

function storedProfile(overrides: Record<string, unknown> = {}) {
  return {
    companyId: principal.companyId,
    cnpj: record.cnpj,
    legalName: record.legalName,
    tradeName: record.tradeName,
    registrationStatus: record.registrationStatus,
    companyType: record.companyType,
    size: record.size,
    openingDate: record.openingDate,
    mainActivityCode: record.mainActivity?.code ?? null,
    mainActivityDescription: record.mainActivity?.description ?? null,
    street: record.address.street,
    number: record.address.number,
    complement: record.address.complement,
    district: record.address.district,
    city: record.address.city,
    state: record.address.state,
    postalCode: record.address.postalCode,
    source: record.source,
    version: 1,
    consultedAt: new Date(record.sourceUpdatedAt),
    createdAt: new Date('2026-10-20T20:00:00.000Z'),
    updatedAt: new Date('2026-10-20T20:00:00.000Z'),
    ...overrides
  };
}

const transaction = {
  companyProfile: {
    findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    create: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    updateMany: jest.fn<(...args: unknown[]) => Promise<unknown>>()
  },
  auditLog: { create: jest.fn<(...args: unknown[]) => Promise<unknown>>() }
};

const prismaMock = {
  companyProfile: { findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>() },
  $transaction: jest.fn<(...args: unknown[]) => Promise<unknown>>()
};

const registryMock = {
  lookup: jest.fn<(...args: unknown[]) => Promise<BusinessRegistryRecord>>()
};

function runTransaction(callback: unknown): Promise<unknown> {
  return (callback as (tx: typeof transaction) => Promise<unknown>)(transaction);
}

describe('CompanyProfileService', () => {
  let service: CompanyProfileService;

  beforeEach(() => {
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation(runTransaction);
    service = new CompanyProfileService(
      prismaMock as unknown as PrismaService,
      registryMock as unknown as BusinessRegistryService
    );
  });

  it('returns null when the authenticated company has no saved profile', async () => {
    transaction.companyProfile.findUnique.mockResolvedValue(null);
    await expect(service.getForCompany(principal)).resolves.toBeNull();
    expect(setTenantContext).toHaveBeenCalledWith(transaction, principal);
    expect(prismaMock.companyProfile.findUnique).not.toHaveBeenCalled();
  });

  it('maps a saved profile to the public registry contract', async () => {
    transaction.companyProfile.findUnique.mockResolvedValue(storedProfile());
    await expect(service.getForCompany(principal)).resolves.toMatchObject({
      cnpj: record.cnpj,
      legalName: record.legalName,
      mainActivity: record.mainActivity,
      address: record.address,
      source: 'ReceitaWS'
    });
    expect(prismaMock.companyProfile.findUnique).not.toHaveBeenCalled();
  });

  it('creates the profile and writes its masked before/after audit in one transaction', async () => {
    registryMock.lookup.mockResolvedValue(record);
    transaction.companyProfile.findUnique.mockResolvedValue(null);
    transaction.companyProfile.create.mockResolvedValue(storedProfile());
    transaction.auditLog.create.mockResolvedValue({});

    await expect(service.saveForCompany(record.cnpj, principal)).resolves.toMatchObject({
      cnpj: record.cnpj,
      legalName: record.legalName,
      source: 'ReceitaWS'
    });

    expect(registryMock.lookup).toHaveBeenCalledWith(record.cnpj, principal);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.companyProfile.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId: principal.companyId, cnpj: record.cnpj, version: 1 })
    }));
    expect(transaction.companyProfile.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'COMPANY_PROFILE_SAVED',
        actorUserId: principal.userId,
        companyId: principal.companyId,
        metadata: expect.objectContaining({
          change: 'created',
          before: null,
          after: expect.objectContaining({
            version: 1,
            cnpjMasked: '11**********20',
            legalName: record.legalName
          })
        })
      })
    }));
  });

  it('increments the version and records before/after snapshots when refreshing a profile', async () => {
    const previous = storedProfile({ version: 4, legalName: 'Nome anterior' });
    const updated = storedProfile({ version: 5 });
    registryMock.lookup.mockResolvedValue(record);
    transaction.companyProfile.findUnique
      .mockResolvedValueOnce(previous)
      .mockResolvedValueOnce(updated);
    transaction.companyProfile.updateMany.mockResolvedValue({ count: 1 });
    transaction.auditLog.create.mockResolvedValue({});

    await expect(service.saveForCompany(record.cnpj, principal)).resolves.toMatchObject({
      legalName: record.legalName,
      sourceUpdatedAt: record.sourceUpdatedAt
    });

    expect(transaction.companyProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: principal.companyId, version: 4 },
      data: expect.objectContaining({ cnpj: record.cnpj, version: { increment: 1 } })
    }));
    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          change: 'updated',
          before: expect.objectContaining({ version: 4, legalName: 'Nome anterior' }),
          after: expect.objectContaining({ version: 5, legalName: record.legalName })
        })
      })
    }));
  });

  it('rejects a stale concurrent update without writing an audit event', async () => {
    transaction.companyProfile.findUnique.mockResolvedValue(storedProfile({ version: 2 }));
    transaction.companyProfile.updateMany.mockResolvedValue({ count: 0 });
    registryMock.lookup.mockResolvedValue(record);

    await expect(service.saveForCompany(record.cnpj, principal)).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.companyProfile.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid CNPJ before contacting the provider or database', async () => {
    await expect(service.saveForCompany('12345', principal)).rejects.toThrow('CNPJ válido');
    expect(registryMock.lookup).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects provider fields beyond database limits before persistence', async () => {
    registryMock.lookup.mockResolvedValue({ ...record, legalName: 'x'.repeat(201) });
    await expect(service.saveForCompany(record.cnpj, principal)).rejects.toThrow('fora do limite permitido');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('maps a unique CNPJ or concurrent profile conflict to a safe conflict response', async () => {
    registryMock.lookup.mockResolvedValue(record);
    transaction.companyProfile.findUnique.mockResolvedValue(null);
    transaction.companyProfile.create.mockRejectedValue({ code: 'P2002', meta: { target: ['cnpj'] } });

    await expect(service.saveForCompany(record.cnpj, principal)).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns a matching persisted profile marked as stale during a temporary provider outage', async () => {
    registryMock.lookup.mockRejectedValue(new ServiceUnavailableException('indisponível'));
    transaction.companyProfile.findUnique.mockResolvedValue(storedProfile());

    await expect(service.saveForCompany(record.cnpj, principal)).resolves.toMatchObject({
      cnpj: record.cnpj,
      legalName: record.legalName,
      sourceUpdatedAt: record.sourceUpdatedAt,
      stale: true,
      availabilityNotice: expect.stringContaining(record.sourceUpdatedAt)
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.companyProfile.create).not.toHaveBeenCalled();
    expect(transaction.companyProfile.updateMany).not.toHaveBeenCalled();
  });
});
