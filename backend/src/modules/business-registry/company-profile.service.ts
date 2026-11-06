import { BadGatewayException, BadRequestException, ConflictException, GatewayTimeoutException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type CompanyProfile } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthPrincipal } from '../../common/auth-principal';
import { setTenantContext } from '../../database/tenant-context';
import { BusinessRegistryRecord, BusinessRegistryService } from './business-registry.service';
import { isValidCnpj, maskCnpj, normalizeCnpj } from './cnpj';

const fieldLimits = [
  ['legalName', 200],
  ['tradeName', 200],
  ['registrationStatus', 40],
  ['companyType', 40],
  ['size', 40],
  ['openingDate', 10],
  ['mainActivityCode', 32],
  ['mainActivityDescription', 200],
  ['street', 160],
  ['number', 40],
  ['complement', 80],
  ['district', 100],
  ['city', 100],
  ['state', 2],
  ['postalCode', 8]
] as const;

function ensureRecordFitsStorage(record: BusinessRegistryRecord): void {
  const values: Record<string, string | null> = {
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
    postalCode: record.address.postalCode
  };

  if (fieldLimits.some(([field, limit]) => (values[field]?.length ?? 0) > limit)) {
    throw new BadGatewayException('A fonte consultada retornou um campo cadastral fora do limite permitido.');
  }
}

function toDatabaseData(record: BusinessRegistryRecord) {
  ensureRecordFitsStorage(record);
  const consultedAt = new Date(record.sourceUpdatedAt);
  if (!Number.isFinite(consultedAt.getTime())) {
    throw new BadGatewayException('A fonte consultada retornou uma data de atualização inválida.');
  }
  return {
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
    consultedAt
  };
}

function toRegistryRecord(profile: CompanyProfile): BusinessRegistryRecord {
  const mainActivity = profile.mainActivityCode || profile.mainActivityDescription
    ? { code: profile.mainActivityCode, description: profile.mainActivityDescription }
    : null;

  return {
    cnpj: profile.cnpj,
    legalName: profile.legalName,
    tradeName: profile.tradeName,
    registrationStatus: profile.registrationStatus,
    companyType: profile.companyType,
    size: profile.size,
    openingDate: profile.openingDate,
    mainActivity,
    address: {
      street: profile.street,
      number: profile.number,
      complement: profile.complement,
      district: profile.district,
      city: profile.city,
      state: profile.state,
      postalCode: profile.postalCode
    },
    source: 'ReceitaWS',
    sourceUpdatedAt: profile.consultedAt.toISOString()
  };
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function auditSnapshot(profile: CompanyProfile): Prisma.InputJsonObject {
  return {
    version: profile.version,
    cnpjMasked: maskCnpj(profile.cnpj),
    source: profile.source,
    consultedAt: profile.consultedAt.toISOString(),
    legalName: profile.legalName,
    tradeName: profile.tradeName,
    registrationStatus: profile.registrationStatus,
    companyType: profile.companyType,
    size: profile.size,
    openingDate: profile.openingDate,
    mainActivityCode: profile.mainActivityCode,
    mainActivityDescription: profile.mainActivityDescription,
    address: {
      street: profile.street,
      number: profile.number,
      complement: profile.complement,
      district: profile.district,
      city: profile.city,
      state: profile.state,
      postalCode: profile.postalCode
    }
  };
}

@Injectable()
export class CompanyProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: BusinessRegistryService
  ) {}

  async getForCompany(principal: AuthPrincipal): Promise<BusinessRegistryRecord | null> {
    const profile = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      return tx.companyProfile.findUnique({ where: { companyId: principal.companyId } });
    });
    return profile ? toRegistryRecord(profile) : null;
  }

  async saveForCompany(input: string, principal: AuthPrincipal): Promise<BusinessRegistryRecord> {
    const cnpj = normalizeCnpj(input);
    if (!isValidCnpj(cnpj)) throw new BadRequestException('Informe um CNPJ válido de 14 caracteres.');

    let record: BusinessRegistryRecord;
    try {
      record = await this.registry.lookup(cnpj, principal);
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException || error instanceof GatewayTimeoutException) {
        const previous = await this.getForCompany(principal);
        if (previous?.cnpj === cnpj) {
          return {
            ...previous,
            stale: true,
            availabilityNotice: `ReceitaWS temporariamente indisponível. Exibindo os dados consultados anteriormente em ${previous.sourceUpdatedAt}.`
          };
        }
      }
      throw error;
    }
    const data = toDatabaseData(record);

    try {
      const saved = await this.prisma.$transaction(async (transaction) => {
        await setTenantContext(transaction, principal);
        const previous = await transaction.companyProfile.findUnique({
          where: { companyId: principal.companyId }
        });
        let profile: CompanyProfile;

        if (previous) {
          const changed = await transaction.companyProfile.updateMany({
            where: { companyId: principal.companyId, version: previous.version },
            data: { ...data, version: { increment: 1 } }
          });
          if (changed.count !== 1) {
            throw new ConflictException('O perfil foi alterado por outra solicitação. Atualize a página e tente novamente.');
          }

          const updated = await transaction.companyProfile.findUnique({
            where: { companyId: principal.companyId }
          });
          if (!updated) throw new ConflictException('O perfil foi alterado por outra solicitação. Atualize a página e tente novamente.');
          profile = updated;
        } else {
          profile = await transaction.companyProfile.create({
            data: { companyId: principal.companyId, ...data, version: 1 }
          });
        }

        await transaction.auditLog.create({
          data: {
            action: 'COMPANY_PROFILE_SAVED',
            actorUserId: principal.userId,
            companyId: principal.companyId,
            entityType: 'CompanyProfile',
            entityId: principal.companyId,
            metadata: {
              source: record.source,
              change: previous ? 'updated' : 'created',
              before: previous ? auditSnapshot(previous) : null,
              after: auditSnapshot(profile)
            } satisfies Prisma.InputJsonObject
          }
        });

        return profile;
      });

      return toRegistryRecord(saved);
    } catch (error: unknown) {
      if (isUniqueConflict(error)) {
        throw new ConflictException('O perfil ou CNPJ foi alterado por outra solicitação. Atualize a página e tente novamente.');
      }
      throw error;
    }
  }
}
