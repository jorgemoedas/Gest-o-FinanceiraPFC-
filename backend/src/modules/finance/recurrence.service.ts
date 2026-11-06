import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CompanyRole, CounterpartyRole, FinanceCategory, FinanceEntryType, FinanceTransactionStatus, Prisma, RecurrenceFrequency } from '../../generated/prisma/client';
import type { AuthPrincipal } from '../../common/auth-principal';
import { PrismaService } from '../../database/prisma.service';
import { setTenantContext } from '../../database/tenant-context';

export type RecurrenceInput = {
  type: FinanceEntryType;
  category: FinanceCategory;
  subcategory?: string | null;
  description: string;
  amount: number | string;
  counterpartyId?: string | null;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  startDate: string | Date;
  endDate?: string | Date | null;
};

export type RecurrenceUpdateInput = Partial<RecurrenceInput>;

export type PublicRecurrence = {
  id: string;
  type: FinanceEntryType;
  category: FinanceCategory;
  subcategory: string | null;
  description: string;
  amount: number;
  counterpartyId: string | null;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  startDate: string;
  endDate: string | null;
  nextRunAt: string;
  lastRunAt: string | null;
  isActive: boolean;
  version: number;
};

export const RECURRENCE_WRITE_ROLES: ReadonlySet<CompanyRole> = new Set([
  CompanyRole.OWNER,
  CompanyRole.ADMIN,
  CompanyRole.MEMBER
]);

const CATEGORIES_BY_TYPE: Record<FinanceEntryType, readonly FinanceCategory[]> = {
  [FinanceEntryType.INCOME]: [FinanceCategory.SALES, FinanceCategory.SERVICES, FinanceCategory.OTHER],
  [FinanceEntryType.EXPENSE]: [
    FinanceCategory.TAXES,
    FinanceCategory.RENT,
    FinanceCategory.PAYROLL,
    FinanceCategory.UTILITIES,
    FinanceCategory.MARKETING,
    FinanceCategory.TRANSPORT,
    FinanceCategory.SUPPLIERS,
    FinanceCategory.OTHER
  ]
};

const recurrenceSelect = {
  id: true,
  type: true,
  category: true,
  subcategory: true,
  description: true,
  amount: true,
  counterpartyId: true,
  frequency: true,
  intervalCount: true,
  startDate: true,
  endDate: true,
  nextRunAt: true,
  lastRunAt: true,
  isActive: true,
  version: true
} as const;

type RecurrenceRecord = Prisma.FinanceRecurrenceGetPayload<{ select: typeof recurrenceSelect }>;

type NormalizedRecurrence = {
  type: FinanceEntryType;
  category: FinanceCategory;
  subcategory: string | null;
  description: string;
  amount: Prisma.Decimal;
  counterpartyId: string | null;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  startDate: Date;
  endDate: Date | null;
};

type MaterializationState = {
  row: RecurrenceRecord;
  nextRunAt: Date;
  lastRunAt: Date | null;
  isActive: boolean;
  generated: number;
  skipped: number;
};

function requirePrincipal(principal: AuthPrincipal): void {
  if (!principal?.companyId || !principal.userId) {
    throw new BadRequestException('É necessário informar um tenant e usuário autenticados.');
  }
}

function requireWriteRole(principal: AuthPrincipal): void {
  requirePrincipal(principal);
  if (!RECURRENCE_WRITE_ROLES.has(principal.role)) {
    throw new ForbiddenException('Seu perfil não pode alterar regras de recorrência.');
  }
}

function parseDate(value: string | Date | null | undefined, field: string, required = true): Date | null {
  if (value === null || value === undefined || value === '') {
    if (!required) return null;
    throw new BadRequestException(`${field} deve ser uma data válida.`);
  }
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} deve ser uma data válida.`);
  return parsed;
}

function parseAmount(value: number | string): Prisma.Decimal {
  try {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite');
    const amount = new Prisma.Decimal(value);
    if (!amount.isFinite() || amount.decimalPlaces() > 2) throw new Error('scale');
    if (amount.lt(new Prisma.Decimal('0.01')) || amount.gt(new Prisma.Decimal('999999999999.99'))) throw new Error('range');
    return amount;
  } catch {
    throw new BadRequestException('O valor deve estar entre 0,01 e 999.999.999.999,99, com no máximo duas casas decimais.');
  }
}

function validateRecurrenceBasics(input: RecurrenceInput): void {
  if (!input || !Object.values(FinanceEntryType).includes(input.type)) throw new BadRequestException('O tipo de lançamento é inválido.');
  if (!Object.values(FinanceCategory).includes(input.category)) throw new BadRequestException('A categoria de lançamento é inválida.');
  if (!CATEGORIES_BY_TYPE[input.type].includes(input.category)) throw new BadRequestException('A categoria não corresponde ao tipo de lançamento.');
  if (!Object.values(RecurrenceFrequency).includes(input.frequency)) throw new BadRequestException('A frequência da recorrência é inválida.');
  if (!Number.isInteger(input.intervalCount) || input.intervalCount < 1 || input.intervalCount > 12) {
    throw new BadRequestException('O intervalo deve ser um número inteiro entre 1 e 12.');
  }
}

function recurrenceDescription(input: RecurrenceInput): string {
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length < 1 || description.length > 160) throw new BadRequestException('A descrição deve ter entre 1 e 160 caracteres.');
  return description;
}

function recurrenceSubcategory(input: RecurrenceInput): string | null {
  const subcategory = input.subcategory === null || input.subcategory === undefined
    ? null
    : typeof input.subcategory === 'string' ? input.subcategory.trim() : '';
  if (subcategory !== null && subcategory.length > 80) throw new BadRequestException('A subcategoria deve ter no máximo 80 caracteres.');
  return subcategory || null;
}

function recurrenceDates(input: RecurrenceInput): { startDate: Date; endDate: Date | null } {
  const startDate = parseDate(input.startDate, 'A data inicial')!;
  const endDate = parseDate(input.endDate, 'A data final', false);
  if (endDate && endDate < startDate) throw new BadRequestException('A data final deve ser igual ou posterior à data inicial.');
  return { startDate, endDate };
}

function normalizeRecurrence(input: RecurrenceInput): NormalizedRecurrence {
  validateRecurrenceBasics(input);
  const { startDate, endDate } = recurrenceDates(input);
  return {
    type: input.type,
    category: input.category,
    subcategory: recurrenceSubcategory(input),
    description: recurrenceDescription(input),
    amount: parseAmount(input.amount),
    counterpartyId: input.counterpartyId || null,
    frequency: input.frequency,
    intervalCount: input.intervalCount,
    startDate,
    endDate
  };
}

function assertCounterpartyRole(
  role: CounterpartyRole,
  type: FinanceEntryType
): void {
  const allowed: readonly CounterpartyRole[] = type === FinanceEntryType.INCOME
    ? [CounterpartyRole.CUSTOMER, CounterpartyRole.BOTH]
    : [CounterpartyRole.SUPPLIER, CounterpartyRole.BOTH];
  if (!allowed.includes(role)) {
    throw new BadRequestException(type === FinanceEntryType.INCOME
      ? 'Selecione um cliente para vincular à receita.'
      : 'Selecione um fornecedor para vincular à despesa.');
  }
}

function recurrenceSnapshot(row: {
  id: string;
  type: FinanceEntryType;
  category: FinanceCategory;
  subcategory: string | null;
  description: string;
  amount: Prisma.Decimal;
  counterpartyId: string | null;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  startDate: Date;
  endDate: Date | null;
  nextRunAt: Date;
  lastRunAt: Date | null;
  isActive: boolean;
  version: number;
}): Prisma.InputJsonObject {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    subcategory: row.subcategory,
    description: row.description,
    amount: row.amount.toFixed(2),
    counterpartyId: row.counterpartyId,
    frequency: row.frequency,
    intervalCount: row.intervalCount,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate?.toISOString() ?? null,
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    isActive: row.isActive,
    version: row.version
  };
}

function toPublicRecurrence(row: RecurrenceRecord): PublicRecurrence {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    subcategory: row.subcategory,
    description: row.description,
    amount: row.amount.toNumber(),
    counterpartyId: row.counterpartyId,
    frequency: row.frequency,
    intervalCount: row.intervalCount,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate?.toISOString() ?? null,
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    isActive: row.isActive,
    version: row.version
  };
}

function lastDayOfUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

type PeriodOptions = {
  frequency: RecurrenceFrequency;
  intervalCount: number;
  originalDay: number;
  originalMonth: number;
};

function addUtcPeriod(date: Date, options: PeriodOptions): Date {
  const { frequency, intervalCount, originalDay, originalMonth } = options;
  if (frequency === RecurrenceFrequency.WEEKLY) {
    return new Date(date.getTime() + intervalCount * 7 * 24 * 60 * 60 * 1000);
  }

  if (frequency === RecurrenceFrequency.MONTHLY) {
    const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() + intervalCount;
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex % 12;
    const day = Math.min(originalDay, lastDayOfUtcMonth(year, month));
    return new Date(Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
  }

  const year = date.getUTCFullYear() + intervalCount;
  const day = Math.min(originalDay, lastDayOfUtcMonth(year, originalMonth));
  return new Date(Date.UTC(year, originalMonth, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

type Occurrence = { recurrence: RecurrenceRecord; occurredAt: Date };
type MaterializationBatch = { states: Map<string, MaterializationState>; occurrences: Occurrence[] };

type RecurrenceUpdateData = {
  type: FinanceEntryType;
  category: FinanceCategory;
  subcategory: string | null;
  description: string;
  amount: Prisma.Decimal;
  counterpartyId: string | null;
  frequency: RecurrenceFrequency;
  intervalCount: number;
  startDate: Date;
  endDate: Date | null;
  nextRunAt?: Date;
  version: { increment: number };
};

function validateUpdateInput(input: RecurrenceUpdateInput & { version: number }): void {
  if (!Number.isInteger(input.version) || input.version < 1) throw new BadRequestException('A versão da recorrência é inválida.');
  if (Object.keys(input).filter((key) => key !== 'version').length === 0) throw new BadRequestException('Informe ao menos um campo para atualizar.');
}

function mergedRecurrence(existing: RecurrenceRecord, input: RecurrenceUpdateInput & { version: number }): RecurrenceInput {
  return {
    type: input.type ?? existing.type,
    category: input.category ?? existing.category,
    subcategory: input.subcategory === undefined ? existing.subcategory : input.subcategory,
    description: input.description ?? existing.description,
    amount: input.amount ?? existing.amount.toString(),
    counterpartyId: input.counterpartyId === undefined ? existing.counterpartyId : input.counterpartyId,
    ...mergedRecurrenceSchedule(existing, input)
  };
}

function mergedRecurrenceSchedule(existing: RecurrenceRecord, input: RecurrenceUpdateInput): Pick<RecurrenceInput, 'frequency' | 'intervalCount' | 'startDate' | 'endDate'> {
  return {
    frequency: input.frequency ?? existing.frequency,
    intervalCount: input.intervalCount ?? existing.intervalCount,
    startDate: input.startDate ?? existing.startDate,
    endDate: input.endDate === undefined ? existing.endDate : input.endDate
  };
}

function recurrenceUpdateData(normalized: NormalizedRecurrence, startChanged: boolean): RecurrenceUpdateData {
  return {
    type: normalized.type,
    category: normalized.category,
    subcategory: normalized.subcategory,
    description: normalized.description,
    amount: normalized.amount,
    counterpartyId: normalized.counterpartyId,
    frequency: normalized.frequency,
    intervalCount: normalized.intervalCount,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    ...(startChanged ? { nextRunAt: normalized.startDate } : {}),
    version: { increment: 1 }
  };
}

function materializationBatch(dueRows: RecurrenceRecord[], parsedUntil: Date): MaterializationBatch {
  const states = new Map<string, MaterializationState>();
  const occurrences: Occurrence[] = [];
  for (const row of dueRows) {
    const state: MaterializationState = { row, nextRunAt: row.nextRunAt, lastRunAt: row.lastRunAt, isActive: row.isActive, generated: 0, skipped: 0 };
    states.set(row.id, state);
    let occurrence = new Date(row.nextRunAt.getTime());
    const periodOptions: PeriodOptions = {
      frequency: row.frequency,
      intervalCount: row.intervalCount,
      originalDay: row.startDate.getUTCDate(),
      originalMonth: row.startDate.getUTCMonth()
    };
    while (occurrence <= parsedUntil) {
      if (row.endDate && occurrence > row.endDate) {
        state.isActive = false;
        break;
      }
      occurrences.push({ recurrence: row, occurredAt: new Date(occurrence.getTime()) });
      const next = addUtcPeriod(occurrence, periodOptions);
      if (next <= occurrence) throw new BadRequestException('Não foi possível calcular a próxima execução da recorrência.');
      occurrence = next;
    }
    state.nextRunAt = occurrence;
  }
  occurrences.sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.recurrence.id.localeCompare(right.recurrence.id));
  return { states, occurrences };
}

async function materializeOccurrences(
  tx: Prisma.TransactionClient,
  principal: AuthPrincipal,
  batch: MaterializationBatch,
  items: Array<{ id: string; recurrenceId: string; occurredAt: Date }>
): Promise<void> {
  for (const occurrence of batch.occurrences) {
    const state = batch.states.get(occurrence.recurrence.id)!;
    const existing = await tx.financeTransaction.findFirst({
      where: { companyId: principal.companyId, recurrenceId: occurrence.recurrence.id, occurredAt: occurrence.occurredAt },
      select: { id: true }
    });
    if (existing) {
      state.skipped += 1;
      continue;
    }
    const transaction = await tx.financeTransaction.create({
      data: {
        companyId: principal.companyId,
        createdByUserId: principal.userId,
        type: occurrence.recurrence.type,
        category: occurrence.recurrence.category,
        subcategory: occurrence.recurrence.subcategory,
        description: occurrence.recurrence.description,
        amount: occurrence.recurrence.amount,
        counterpartyId: occurrence.recurrence.counterpartyId,
        occurredAt: occurrence.occurredAt,
        dueAt: occurrence.occurredAt,
        status: FinanceTransactionStatus.PENDING,
        recurrenceId: occurrence.recurrence.id
      },
      select: { id: true }
    });
    state.generated += 1;
    items.push({ id: transaction.id, recurrenceId: occurrence.recurrence.id, occurredAt: occurrence.occurredAt });
    state.lastRunAt = occurrence.occurredAt;
  }
}

async function persistMaterializationStates(
  tx: Prisma.TransactionClient,
  principal: AuthPrincipal,
  states: Map<string, MaterializationState>,
  until: Date
): Promise<{ generated: number; skipped: number }> {
  let generated = 0;
  let skipped = 0;
  for (const state of states.values()) {
    generated += state.generated;
    skipped += state.skipped;
    const changed = await tx.financeRecurrence.updateMany({
      where: { id: state.row.id, companyId: principal.companyId },
      data: { nextRunAt: state.nextRunAt, ...(state.lastRunAt ? { lastRunAt: state.lastRunAt } : {}), isActive: state.isActive, version: { increment: 1 } }
    });
    if (changed.count !== 1) throw new ConflictException('Uma regra de recorrência foi alterada durante a materialização. Tente novamente.');
    await tx.auditLog.create({
      data: {
        actorUserId: principal.userId,
        companyId: principal.companyId,
        action: 'FINANCE_RECURRENCE_MATERIALIZED',
        entityType: 'FinanceRecurrence',
        entityId: state.row.id,
        metadata: {
          before: recurrenceSnapshot(state.row),
          after: recurrenceSnapshot({ ...state.row, nextRunAt: state.nextRunAt, lastRunAt: state.lastRunAt, isActive: state.isActive, version: state.row.version + 1 }),
          generated: state.generated,
          skipped: state.skipped,
          until: until.toISOString()
        }
      }
    });
  }
  return { generated, skipped };
}

@Injectable()
export class RecurrenceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(principal: AuthPrincipal, query: { page: number; limit: number }): Promise<{
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    items: PublicRecurrence[];
  }> {
    requirePrincipal(principal);
    if (!Number.isInteger(query.page) || query.page < 1 || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
      throw new BadRequestException('A página deve ser positiva e o limite deve estar entre 1 e 100.');
    }

    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      const where = { companyId: principal.companyId };
      const [total, rows] = await Promise.all([
        tx.financeRecurrence.count({ where }),
        tx.financeRecurrence.findMany({
          where,
          orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          select: recurrenceSelect
        })
      ]);
      return {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
        items: rows.map(toPublicRecurrence)
      };
    });
  }

  async create(principal: AuthPrincipal, input: RecurrenceInput): Promise<PublicRecurrence> {
    requireWriteRole(principal);
    const normalized = normalizeRecurrence(input);

    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      await this.assertCounterparty(tx, principal.companyId, normalized.counterpartyId, normalized.type);
      const created = await tx.financeRecurrence.create({
        data: {
          companyId: principal.companyId,
          createdByUserId: principal.userId,
          type: normalized.type,
          category: normalized.category,
          subcategory: normalized.subcategory,
          description: normalized.description,
          amount: normalized.amount,
          counterpartyId: normalized.counterpartyId,
          frequency: normalized.frequency,
          intervalCount: normalized.intervalCount,
          startDate: normalized.startDate,
          endDate: normalized.endDate,
          nextRunAt: normalized.startDate
        },
        select: recurrenceSelect
      });
      await tx.auditLog.create({
        data: {
          actorUserId: principal.userId,
          companyId: principal.companyId,
          action: 'FINANCE_RECURRENCE_CREATED',
          entityType: 'FinanceRecurrence',
          entityId: created.id,
          metadata: { before: null, after: recurrenceSnapshot(created) }
        }
      });
      return toPublicRecurrence(created);
    });
  }

  async update(principal: AuthPrincipal, id: string, input: RecurrenceUpdateInput & { version: number }): Promise<PublicRecurrence> {
    requireWriteRole(principal);
    validateUpdateInput(input);
    return this.prisma.$transaction((tx) => this.updateInTransaction(tx, principal, id, input));
  }

  private async updateInTransaction(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    id: string,
    input: RecurrenceUpdateInput & { version: number }
  ): Promise<PublicRecurrence> {
    await setTenantContext(tx, principal);
    const existing = await tx.financeRecurrence.findFirst({ where: { id, companyId: principal.companyId }, select: recurrenceSelect });
    if (!existing) throw new NotFoundException('Regra de recorrência não encontrada.');
    const normalized = normalizeRecurrence(mergedRecurrence(existing, input));
    await this.assertCounterparty(tx, principal.companyId, normalized.counterpartyId, normalized.type);
    const changed = await tx.financeRecurrence.updateMany({
      where: { id, companyId: principal.companyId, version: input.version },
      data: recurrenceUpdateData(normalized, normalized.startDate.getTime() !== existing.startDate.getTime())
    });
    if (changed.count !== 1) throw new ConflictException('A regra de recorrência foi alterada por outra solicitação. Atualize e tente novamente.');
    const updated = await tx.financeRecurrence.findFirst({ where: { id, companyId: principal.companyId }, select: recurrenceSelect });
    if (!updated) throw new NotFoundException('Regra de recorrência não encontrada após a atualização.');
    await tx.auditLog.create({
      data: {
        actorUserId: principal.userId,
        companyId: principal.companyId,
        action: 'FINANCE_RECURRENCE_UPDATED',
        entityType: 'FinanceRecurrence',
        entityId: id,
        metadata: { before: recurrenceSnapshot(existing), after: recurrenceSnapshot(updated) }
      }
    });
    return toPublicRecurrence(updated);
  }

  async setActive(principal: AuthPrincipal, id: string, isActive: boolean, version: number): Promise<PublicRecurrence> {
    requireWriteRole(principal);
    if (typeof isActive !== 'boolean') throw new BadRequestException('O estado ativo da recorrência é inválido.');
    if (!Number.isInteger(version) || version < 1) throw new BadRequestException('A versão da recorrência é inválida.');

    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      const existing = await tx.financeRecurrence.findFirst({
        where: { id, companyId: principal.companyId },
        select: recurrenceSelect
      });
      if (!existing) throw new NotFoundException('Regra de recorrência não encontrada.');
      const changed = await tx.financeRecurrence.updateMany({
        where: { id, companyId: principal.companyId, version },
        data: { isActive, version: { increment: 1 } }
      });
      if (changed.count !== 1) {
        throw new ConflictException('A regra de recorrência foi alterada por outra solicitação. Atualize e tente novamente.');
      }
      const updated = await tx.financeRecurrence.findFirst({
        where: { id, companyId: principal.companyId },
        select: recurrenceSelect
      });
      if (!updated) throw new NotFoundException('Regra de recorrência não encontrada após a alteração.');
      await tx.auditLog.create({
        data: {
          actorUserId: principal.userId,
          companyId: principal.companyId,
          action: 'FINANCE_RECURRENCE_STATUS_CHANGED',
          entityType: 'FinanceRecurrence',
          entityId: id,
          metadata: { before: recurrenceSnapshot(existing), after: recurrenceSnapshot(updated) }
        }
      });
      return toPublicRecurrence(updated);
    });
  }

  async runDue(principal: AuthPrincipal, until: Date): Promise<{
    generated: number;
    skipped: number;
    items: Array<{ id: string; recurrenceId: string; occurredAt: Date }>;
  }> {
    requireWriteRole(principal);
    const parsedUntil = parseDate(until, 'A data limite')!;
    return this.prisma.$transaction((tx) => this.runDueInTransaction(tx, principal, parsedUntil));
  }

  private async runDueInTransaction(tx: Prisma.TransactionClient, principal: AuthPrincipal, parsedUntil: Date) {
    await setTenantContext(tx, principal);
    const dueRows = await tx.financeRecurrence.findMany({
      where: { companyId: principal.companyId, isActive: true, nextRunAt: { lte: parsedUntil } },
      orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }],
      select: recurrenceSelect
    });
    const batch = materializationBatch(dueRows, parsedUntil);
    const items: Array<{ id: string; recurrenceId: string; occurredAt: Date }> = [];
    await materializeOccurrences(tx, principal, batch, items);
    const totals = await persistMaterializationStates(tx, principal, batch.states, parsedUntil);
    return { ...totals, items };
  }

  private async assertCounterparty(
    tx: Prisma.TransactionClient,
    companyId: string,
    counterpartyId: string | null,
    type: FinanceEntryType
  ): Promise<void> {
    if (!counterpartyId) return;
    const counterparty = await tx.financeCounterparty.findFirst({
      where: { id: counterpartyId, companyId },
      select: { role: true }
    });
    if (!counterparty) throw new BadRequestException('O cliente ou fornecedor não pertence à empresa autenticada.');
    assertCounterpartyRole(counterparty.role, type);
  }
}
