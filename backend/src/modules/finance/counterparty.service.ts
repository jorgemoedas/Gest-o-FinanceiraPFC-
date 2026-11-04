import { BadGatewayException, ConflictException, Injectable } from '@nestjs/common';
import { CounterpartyRole, Prisma } from '../../generated/prisma/client';
import { AuthPrincipal } from '../../common/auth-principal';
import { PrismaService } from '../../database/prisma.service';
import { setTenantContext } from '../../database/tenant-context';
import { escapeLikeSearch } from '../../common/escape-like-search';
import { BusinessRegistryRecord, BusinessRegistryService } from '../business-registry/business-registry.service';
import { isValidCnpj, maskCnpj, normalizeCnpj } from '../business-registry/cnpj';

const counterpartySelect = {
  id: true,
  name: true,
  role: true,
  cnpj: true,
  legalName: true,
  tradeName: true,
  source: true,
  consultedAt: true
} as const;

type CounterpartyQuery = {
  page: number;
  limit: number;
  role?: CounterpartyRole;
  search?: string;
};

type CounterpartyCreateInput = {
  name: string;
  role: CounterpartyRole;
  cnpj?: string | null;
};

function toRegistryData(record: BusinessRegistryRecord, requestedCnpj: string) {
  const cnpj = normalizeCnpj(record.cnpj);
  if (cnpj !== normalizeCnpj(requestedCnpj) || !isValidCnpj(cnpj) || record.source !== 'ReceitaWS') {
    throw new BadGatewayException('A fonte consultada retornou dados cadastrais inconsistentes.');
  }

  const legalName = record.legalName.trim();
  const tradeName = record.tradeName?.trim() || null;
  const consultedAt = new Date(record.sourceUpdatedAt);
  if (!legalName || legalName.length > 200 || (tradeName && tradeName.length > 200)) {
    throw new BadGatewayException('A fonte consultada retornou um nome cadastral fora do limite permitido.');
  }
  if (!Number.isFinite(consultedAt.getTime())) {
    throw new BadGatewayException('A fonte consultada retornou uma data inválida.');
  }

  return { cnpj, legalName, tradeName, source: record.source, consultedAt };
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function auditSnapshot(counterparty: {
  id: string;
  name: string;
  role: CounterpartyRole;
  cnpj: string | null;
  legalName: string | null;
  tradeName: string | null;
  source: string | null;
  consultedAt: Date | null;
}): Prisma.InputJsonObject {
  return {
    id: counterparty.id,
    name: counterparty.name,
    role: counterparty.role,
    cnpjMasked: counterparty.cnpj ? maskCnpj(counterparty.cnpj) : null,
    legalName: counterparty.legalName,
    tradeName: counterparty.tradeName,
    source: counterparty.source,
    consultedAt: counterparty.consultedAt?.toISOString() ?? null
  } satisfies Prisma.InputJsonObject;
}

@Injectable()
export class CounterpartyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: BusinessRegistryService
  ) {}

  async list(principal: AuthPrincipal, input: CounterpartyQuery) {
    const companyId = principal.companyId;
    const role: Prisma.EnumCounterpartyRoleFilter | undefined = input.role === CounterpartyRole.CUSTOMER
      ? { in: [CounterpartyRole.CUSTOMER, CounterpartyRole.BOTH] }
      : input.role === CounterpartyRole.SUPPLIER
        ? { in: [CounterpartyRole.SUPPLIER, CounterpartyRole.BOTH] }
        : input.role
          ? { equals: input.role }
          : undefined;
    const where: Prisma.FinanceCounterpartyWhereInput = {
      companyId,
      ...(role ? { role } : {}),
      ...(input.search ? { name: { contains: escapeLikeSearch(input.search), mode: 'insensitive' } } : {})
    };
    const [total, items] = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      return Promise.all([
        tx.financeCounterparty.count({ where }),
        tx.financeCounterparty.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          select: counterpartySelect
        })
      ]);
    });

    return {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
      items
    };
  }

  async create(principal: AuthPrincipal, input: CounterpartyCreateInput) {
    const requestedCnpj = typeof input.cnpj === 'string' ? input.cnpj.trim() : '';
    const registryData = requestedCnpj
      ? toRegistryData(await this.registry.lookup(requestedCnpj, principal), requestedCnpj)
      : null;
    const enrichment = registryData ?? {
      cnpj: null,
      legalName: null,
      tradeName: null,
      source: null,
      consultedAt: null
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        await setTenantContext(tx, principal);
        const counterparty = await tx.financeCounterparty.create({
          data: {
            companyId: principal.companyId,
            name: input.name.trim(),
            role: input.role,
            ...enrichment
          },
          select: counterpartySelect
        });
        await tx.auditLog.create({
          data: {
            actorUserId: principal.userId,
            companyId: principal.companyId,
            action: 'FINANCE_COUNTERPARTY_CREATED',
            entityType: 'FinanceCounterparty',
            entityId: counterparty.id,
            metadata: {
              before: null,
              after: auditSnapshot(counterparty)
            } satisfies Prisma.InputJsonObject
          }
        });
        return counterparty;
      });
    } catch (error: unknown) {
      if (isUniqueConflict(error)) {
        throw new ConflictException('Já existe um cliente ou fornecedor com este CNPJ nesta empresa.');
      }
      throw error;
    }
  }
}
