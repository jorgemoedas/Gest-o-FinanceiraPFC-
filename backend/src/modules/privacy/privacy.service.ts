import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CompanyRole, UserStatus } from '../../generated/prisma/client';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { setTenantContext } from '../../database/tenant-context';
import type { AuthPrincipal } from '../../common/auth-principal';

const ERASE_CONFIRMATION = 'ELIMINAR MEUS DADOS';

export interface PrivacyExport {
  generatedAt: string;
  subject: { userId: string; email: string };
  company: unknown;
  memberships: unknown[];
  acceptances: unknown[];
  authoredTransactions: unknown[];
  auditEvents: unknown[];
}

export interface PrivacyEraseResult {
  erased: true;
  anonymized: {
    email: string;
    name: string;
    namePersisted: false;
    reversible: false;
  };
  retained: string[];
}

/**
 * O modelo User não possui uma coluna de nome. O identificador abaixo é usado
 * tanto para o e-mail persistido quanto para o registro de auditoria, sem
 * guardar o valor original e sem permitir reversão pelo serviço.
 */
export function deterministicAnonymization(userId: string): { email: string; name: string } {
  const digest = createHash('sha256').update(`gft-inteligente:privacy:${userId}`, 'utf8').digest('hex');
  return {
    email: `anon+${digest}@invalid.local`,
    name: `Titular anonimizado ${digest.slice(0, 24)}`
  };
}


async function loadPrivacyData(tx: Prisma.TransactionClient, principal: AuthPrincipal): Promise<Omit<PrivacyExport, 'generatedAt'>> {
  const user = await tx.user.findUnique({ where: { id: principal.userId }, select: { id: true, email: true } });
  if (!user) throw new ConflictException('Não foi possível localizar o titular dos dados.');
  const [company, memberships, acceptances, authoredTransactions, auditEvents] = await Promise.all([
    loadCompany(tx, principal.companyId),
    tx.companyMembership.findMany({ where: { userId: principal.userId, companyId: principal.companyId }, select: { userId: true, companyId: true, role: true, isActive: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
    tx.termAcceptance.findMany({ where: { userId: principal.userId, companyId: principal.companyId }, select: { id: true, userId: true, companyId: true, termsVersion: true, privacyVersion: true, acceptedAt: true }, orderBy: { acceptedAt: 'asc' } }),
    tx.financeTransaction.findMany({ where: { companyId: principal.companyId, createdByUserId: principal.userId }, select: { id: true, companyId: true, createdByUserId: true, type: true, category: true, subcategory: true, description: true, amount: true, occurredAt: true, dueAt: true, status: true, counterpartyId: true, recurrenceId: true, reversalOfId: true, adjustmentKind: true, reversedAt: true, version: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'asc' } }),
    tx.auditLog.findMany({ where: { actorUserId: principal.userId, companyId: principal.companyId }, select: { id: true, actorUserId: true, companyId: true, action: true, entityType: true, entityId: true, requestId: true, metadata: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
  ]);
  return { subject: { userId: user.id, email: user.email }, company, memberships: memberships as unknown[], acceptances: acceptances as unknown[], authoredTransactions: authoredTransactions as unknown[], auditEvents: auditEvents as unknown[] };
}

async function loadCompany(tx: Prisma.TransactionClient, companyId: string): Promise<unknown> {
  if (!tx.company?.findUnique) return { id: companyId };
  return tx.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, createdAt: true, updatedAt: true, businessProfile: { select: { companyId: true, cnpj: true, legalName: true, tradeName: true, registrationStatus: true, companyType: true, size: true, openingDate: true, mainActivityCode: true, mainActivityDescription: true, street: true, number: true, complement: true, district: true, city: true, state: true, postalCode: true, source: true, version: true, consultedAt: true, createdAt: true, updatedAt: true } } } });
}

async function recordPrivacyExport(tx: Prisma.TransactionClient, principal: AuthPrincipal, generatedAt: string): Promise<void> {
  await tx.auditLog.create({ data: { actorUserId: principal.userId, companyId: principal.companyId, action: 'PRIVACY_DATA_EXPORTED', entityType: 'User', entityId: principal.userId, metadata: { generatedAt } } });
}

@Injectable()
export class PrivacyService {
  constructor(private readonly prisma: PrismaService) {}

  async exportData(principal: AuthPrincipal): Promise<PrivacyExport> {
    const generatedAt = new Date().toISOString();
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      const data = await loadPrivacyData(tx, principal);
      await recordPrivacyExport(tx, principal, generatedAt);
      return { generatedAt, ...data };
    });
  }

  async eraseData(principal: AuthPrincipal, input: { confirmation: string }): Promise<PrivacyEraseResult> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      if (input.confirmation !== ERASE_CONFIRMATION) {
        throw new BadRequestException(`Digite exatamente: ${ERASE_CONFIRMATION}.`);
      }

      if (principal.role === CompanyRole.OWNER) {
        const activeOwners = await tx.companyMembership.count({
          where: { companyId: principal.companyId, role: CompanyRole.OWNER, isActive: true }
        });
        if (activeOwners === 1) {
          throw new ConflictException('Transfira a propriedade antes de eliminar seus dados: você é o único OWNER ativo desta empresa.');
        }
      }

      const anonymized = deterministicAnonymization(principal.userId);
      const now = new Date();
      await tx.user.update({
        where: { id: principal.userId },
        data: { email: anonymized.email, status: UserStatus.SUSPENDED }
      });
      await tx.companyMembership.deleteMany({
        where: { userId: principal.userId, companyId: principal.companyId }
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: principal.userId, usedAt: null },
        data: { usedAt: now }
      });
      await tx.auditLog.create({
        data: {
          actorUserId: principal.userId,
          companyId: principal.companyId,
          action: 'PRIVACY_DATA_ERASED',
          entityType: 'User',
          entityId: principal.userId,
          metadata: {
            status: 'SUSPENDED',
            membershipsRemoved: true,
            resetTokensInvalidated: true,
            anonymizedEmail: anonymized.email,
            anonymizedName: anonymized.name,
            irreversible: true,
            reversible: false
          }
        }
      });

      return {
        erased: true,
        anonymized: { ...anonymized, namePersisted: false, reversible: false },
        retained: [
          'Lançamentos financeiros preservados por obrigação legal e contábil.',
          'Trilha de auditoria preservada para rastreabilidade e obrigações de registro.'
        ]
      };
    });
  }
}
