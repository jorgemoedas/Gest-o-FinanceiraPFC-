import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FiscalObligationStatus, Prisma } from '../../generated/prisma/client';
import type { AuthPrincipal } from '../../common/auth-principal';
import { PrismaService } from '../../database/prisma.service';
import { setTenantContext } from '../../database/tenant-context';

const DAY_MS = 86_400_000;

const obligationSelect = {
  id: true,
  companyId: true,
  kind: true,
  title: true,
  description: true,
  dueAt: true,
  status: true,
  source: true,
  periodKey: true,
  completedAt: true,
  version: true,
  createdAt: true,
  updatedAt: true
} as const;

type ObligationRecord = Prisma.FiscalObligationGetPayload<{ select: typeof obligationSelect }>;
export type FiscalStatus = 'PENDING' | 'DONE' | 'DISMISSED';

export type PublicObligation = {
  id: string;
  companyId: string;
  kind: string;
  title: string;
  description: string | null;
  dueAt: string;
  status: FiscalStatus;
  source: string;
  periodKey: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isOverdue: boolean;
  daysUntilDue: number;
  version: number;
};

type CalendarQuery = { from: string; to: string; status?: FiscalStatus };
type CreateInput = { kind: string; title: string; description?: string | null; dueAt: string; periodKey?: string | null };
type UpdateStatusInput = { status: FiscalStatus; version: number };
type GenerateInput = { regime: 'MEI' | 'SIMPLES_ME_EPP'; from: string; to: string };

function parseDate(value: string, label: string): Date {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new BadRequestException(`${label} deve ser uma data ISO válida.`);
  return date;
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysUntil(dueAt: Date, now = new Date()): number {
  return Math.floor((dueAt.getTime() - startOfUtcDay(now).getTime()) / DAY_MS);
}

function toPublic(row: ObligationRecord, now = new Date()): PublicObligation {
  const dueDays = daysUntil(row.dueAt, now);
  return {
    id: row.id,
    companyId: row.companyId,
    kind: row.kind,
    title: row.title,
    description: row.description,
    dueAt: row.dueAt.toISOString(),
    status: row.status,
    source: row.source,
    periodKey: row.periodKey,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isOverdue: row.status === FiscalObligationStatus.PENDING && row.dueAt < startOfUtcDay(now),
    daysUntilDue: dueDays,
    version: row.version
  };
}

function snapshot(row: ObligationRecord) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    dueAt: row.dueAt.toISOString(),
    status: row.status,
    source: row.source,
    periodKey: row.periodKey,
    completedAt: row.completedAt?.toISOString() ?? null,
    version: row.version
  };
}

function assertPrincipal(principal: AuthPrincipal): void {
  if (!principal?.companyId || !principal.userId) {
    throw new BadRequestException('É necessário informar uma empresa e usuário autenticados.');
  }
}

function assertWritable(principal: AuthPrincipal): void {
  assertPrincipal(principal);
  if (principal.role === 'READ_ONLY') throw new ForbiddenException('Seu perfil permite consultar, mas não alterar o calendário fiscal.');
  if (!['OWNER', 'ADMIN', 'MEMBER'].includes(principal.role)) {
    throw new ForbiddenException('Seu perfil não pode alterar o calendário fiscal.');
  }
}

function validateStatus(status: string): asserts status is FiscalStatus {
  if (!['PENDING', 'DONE', 'DISMISSED'].includes(status)) {
    throw new BadRequestException('A situação deve ser PENDING, DONE ou DISMISSED.');
  }
}

function validateRange(fromValue: string, toValue: string): { from: Date; to: Date } {
  const from = parseDate(fromValue, 'from');
  const to = parseDate(toValue, 'to');
  if (from > to) throw new BadRequestException('A data inicial não pode ser posterior à data final.');
  return { from, to };
}

function isUniqueViolation(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && (reason as { code?: unknown }).code === 'P2002';
}

function periodKeys(from: Date, to: Date): string[] {
  const result: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor <= last) {
    result.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

@Injectable()
export class FiscalCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async list(principal: AuthPrincipal, query: CalendarQuery): Promise<{ items: PublicObligation[]; summary: { pending: number; overdue: number; dueSoon: number; done: number } }> {
    assertPrincipal(principal);
    const { from, to } = validateRange(query.from, query.to);
    if (query.status !== undefined) validateStatus(query.status);

    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      const rows = await tx.fiscalObligation.findMany({
        where: {
          companyId: principal.companyId,
          dueAt: { gte: from, lte: to },
          ...(query.status ? { status: query.status } : {})
        },
        orderBy: [{ dueAt: 'asc' }, { title: 'asc' }],
        select: obligationSelect
      });
      const items = rows.map((row) => toPublic(row));
      return {
        items,
        summary: {
          pending: items.filter((item) => item.status === 'PENDING').length,
          overdue: items.filter((item) => item.isOverdue).length,
          dueSoon: items.filter((item) => item.status === 'PENDING' && item.daysUntilDue >= 0 && item.daysUntilDue <= 7).length,
          done: items.filter((item) => item.status === 'DONE').length
        }
      };
    });
  }

  async create(principal: AuthPrincipal, input: CreateInput): Promise<PublicObligation> {
    assertWritable(principal);
    if (!input?.kind?.trim() || input.kind.trim().length > 40) throw new BadRequestException('Informe um tipo de obrigação de até 40 caracteres.');
    if (!input?.title?.trim() || input.title.trim().length > 160) throw new BadRequestException('Informe um título de até 160 caracteres.');
    if (input.description != null && input.description.length > 400) throw new BadRequestException('A descrição deve ter até 400 caracteres.');
    const dueAt = parseDate(input.dueAt, 'dueAt');
    const description = input.description?.trim() || null;
    const periodKey = input.periodKey?.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      const created = await tx.fiscalObligation.create({
        data: {
          companyId: principal.companyId,
          kind: input.kind.trim(),
          title: input.title.trim(),
          description,
          dueAt,
          source: 'MANUAL',
          periodKey
        },
        select: obligationSelect
      });
      await tx.auditLog.create({
        data: {
          actorUserId: principal.userId,
          companyId: principal.companyId,
          action: 'FISCAL_OBLIGATION_CREATED',
          entityType: 'FiscalObligation',
          entityId: created.id,
          metadata: { before: null, after: snapshot(created) }
        }
      });
      return toPublic(created);
    });
  }

  async updateStatus(principal: AuthPrincipal, id: string, input: UpdateStatusInput): Promise<PublicObligation> {
    assertWritable(principal);
    validateStatus(input?.status);
    if (!Number.isInteger(input?.version) || input.version < 1) throw new BadRequestException('A versão da obrigação é inválida.');

    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      const before = await tx.fiscalObligation.findFirst({ where: { id, companyId: principal.companyId }, select: obligationSelect });
      if (!before) throw new NotFoundException('Obrigação fiscal não encontrada nesta empresa.');
      const changed = await tx.fiscalObligation.updateMany({
        where: { id, companyId: principal.companyId, version: input.version },
        data: { status: input.status, completedAt: input.status === FiscalObligationStatus.DONE ? new Date() : null, version: { increment: 1 } }
      });
      if (changed.count !== 1) throw new ConflictException('A obrigação foi alterada por outra solicitação. Atualize o calendário e tente novamente.');
      const after = await tx.fiscalObligation.findFirst({ where: { id, companyId: principal.companyId }, select: obligationSelect });
      if (!after) throw new NotFoundException('Obrigação fiscal não encontrada após a atualização.');
      await tx.auditLog.create({
        data: {
          actorUserId: principal.userId,
          companyId: principal.companyId,
          action: 'FISCAL_OBLIGATION_STATUS_CHANGED',
          entityType: 'FiscalObligation',
          entityId: id,
          metadata: { before: snapshot(before), after: snapshot(after) }
        }
      });
      return toPublic(after);
    });
  }

  async remove(principal: AuthPrincipal, id: string): Promise<{ removed: true }> {
    assertWritable(principal);
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      const before = await tx.fiscalObligation.findFirst({ where: { id, companyId: principal.companyId }, select: obligationSelect });
      if (!before) throw new NotFoundException('Obrigação fiscal não encontrada nesta empresa.');
      const removed = await tx.fiscalObligation.deleteMany({ where: { id, companyId: principal.companyId } });
      if (removed.count !== 1) throw new ConflictException('A obrigação foi alterada por outra solicitação. Atualize o calendário e tente novamente.');
      await tx.auditLog.create({
        data: {
          actorUserId: principal.userId,
          companyId: principal.companyId,
          action: 'FISCAL_OBLIGATION_REMOVED',
          entityType: 'FiscalObligation',
          entityId: id,
          metadata: { before: snapshot(before), after: null }
        }
      });
      return { removed: true };
    });
  }

  async generateDefault(principal: AuthPrincipal, input: GenerateInput): Promise<{ created: number; skipped: number }> {
    assertWritable(principal);
    if (input?.regime !== 'MEI' && input?.regime !== 'SIMPLES_ME_EPP') throw new BadRequestException('O regime deve ser MEI ou SIMPLES_ME_EPP.');
    const { from, to } = validateRange(input.from, input.to);
    const periods = periodKeys(from, to);
    const kind = input.regime === 'MEI' ? 'DAS_MEI' : 'DAS_SIMPLES';
    const title = input.regime === 'MEI' ? 'DAS MEI — referência mensal' : 'DAS Simples Nacional — referência mensal';
    const description = 'Data de referência de calendário sujeita a alteração oficial; o sistema não transmite declarações.';

    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      const existing = await tx.fiscalObligation.findMany({
        where: { companyId: principal.companyId, kind, periodKey: { in: periods } },
        select: { periodKey: true }
      });
      const existingPeriods = new Set(existing.map((item) => item.periodKey).filter((item): item is string => Boolean(item)));
      let created = 0;
      let skipped = 0;
      for (const periodKey of periods) {
        if (existingPeriods.has(periodKey)) {
          skipped += 1;
          continue;
        }
        const [year, month] = periodKey.split('-').map(Number);
        const dueAt = new Date(Date.UTC(year, month, 20));
        try {
          await tx.fiscalObligation.create({
            data: { companyId: principal.companyId, kind, title, description, dueAt, status: FiscalObligationStatus.PENDING, source: 'SYSTEM_RULE', periodKey },
            select: obligationSelect
          });
          created += 1;
        } catch (reason: unknown) {
          if (!isUniqueViolation(reason)) throw reason;
          skipped += 1;
        }
      }
      await tx.auditLog.create({
        data: {
          actorUserId: principal.userId,
          companyId: principal.companyId,
          action: 'FISCAL_OBLIGATIONS_GENERATED',
          entityType: 'FiscalObligation',
          metadata: { before: { created: 0 }, after: { created, skipped, kind, periodCount: periods.length } }
        }
      });
      return { created, skipped };
    });
  }
}
