import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CounterpartyRole, FinanceAdjustmentKind, FinanceCategory, FinanceEntryType, FinanceTransactionStatus, Prisma } from '../../generated/prisma/client';
import { AuthPrincipal } from '../../common/auth-principal';
import { PrismaService } from '../../database/prisma.service';
import { setTenantContext } from '../../database/tenant-context';
import { READ_TRANSACTION_OPTIONS, withTransientRetry } from '../../database/transient-retry';
import { escapeLikeSearch } from '../../common/escape-like-search';
import { compareDecimals } from './comparison';

type DashboardAggregate = {
  kind: 'CURRENT' | 'CATEGORY' | 'MONTHLY' | 'PENDING' | 'OVERDUE' | 'PREVIOUS';
  type: FinanceEntryType | null;
  category: FinanceCategory | null;
  month: Date | null;
  amount: Prisma.Decimal | null;
  count: number;
};

type TransactionStatusFilter = FinanceTransactionStatus | 'OVERDUE' | 'REFUNDED';
type TransactionInput = {
  type?: FinanceEntryType;
  category?: FinanceCategory;
  subcategory?: string | null;
  counterpartyId?: string | null;
  description?: string;
  amount?: number;
  occurredAt?: string;
  dueAt?: string | null;
  status?: FinanceTransactionStatus;
};

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

export const DASHBOARD_TRANSACTION_OPTIONS = READ_TRANSACTION_OPTIONS;

const CATEGORY_MISMATCH_MESSAGE = 'A categoria não corresponde ao tipo de lançamento.';
const TRANSACTION_NOT_FOUND_MESSAGE = 'Lançamento não encontrado.';
const TRANSACTION_CONFLICT_MESSAGE = 'O lançamento foi alterado por outra solicitação. Atualize o histórico e tente novamente.';

const transactionSelect = {
  id: true,
  type: true,
  category: true,
  subcategory: true,
  counterpartyId: true,
  counterparty: { select: { id: true, name: true, role: true } },
  description: true,
  amount: true,
  occurredAt: true,
  dueAt: true,
  status: true,
  reversalOfId: true,
  adjustmentKind: true,
  reversedAt: true,
  version: true,
  reversal: { select: { id: true, adjustmentKind: true } }
} as const;

type TransactionRecord = Prisma.FinanceTransactionGetPayload<{ select: typeof transactionSelect }>;

function decimalValue(value: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return value ?? new Prisma.Decimal(0);
}

function decimalNumber(value: Prisma.Decimal | null | undefined): number {
  return decimalValue(value).toNumber();
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .format(date)
    .replace('.', '');
}

function periodFor(months: number, now = new Date()) {
  if (![3, 6, 12].includes(months)) throw new BadRequestException('O período deve ser de 3, 6 ou 12 meses.');
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function publicTransaction(row: TransactionRecord) {
  const { reversalOfId, reversedAt: _reversedAt, reversal, amount, status, dueAt, adjustmentKind, ...fields } = row;
  const overdue = status === FinanceTransactionStatus.PENDING && dueAt !== null && dueAt < startOfUtcDay();
  return {
    ...fields,
    amount: decimalNumber(amount),
    dueAt,
    hasAdjustment: Boolean(reversalOfId || reversal),
    status: adjustmentKind === FinanceAdjustmentKind.REFUND
      ? 'REFUNDED' as const
      : adjustmentKind === FinanceAdjustmentKind.VOID || status === FinanceTransactionStatus.REVERSED
      ? FinanceTransactionStatus.REVERSED
      : overdue
        ? 'OVERDUE' as const
        : status
  };
}

function auditSnapshot(row: TransactionRecord) {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    subcategory: row.subcategory,
    counterpartyId: row.counterpartyId,
    description: row.description,
    amount: row.amount.toFixed(2),
    occurredAt: row.occurredAt.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    status: row.status,
    reversalOfId: row.reversalOfId,
    adjustmentKind: row.adjustmentKind,
    reversedAt: row.reversedAt?.toISOString() ?? null,
    version: row.version
  };
}

function openBalance(rows: Array<{ type: FinanceEntryType; _sum: { amount: Prisma.Decimal | null }; _count: { _all: number } }>, type: FinanceEntryType) {
  const row = rows.find((item) => item.type === type);
  return { amount: decimalNumber(row?._sum.amount), count: row?._count._all ?? 0 };
}

function publicComparisonMetric(current: Prisma.Decimal, previous: Prisma.Decimal) {
  const metric = compareDecimals(current, previous);
  return {
    amount: metric.amount.toNumber(),
    percent: metric.percent?.toNumber() ?? null
  };
}

type TransactionUpdateFields = {
  type: FinanceEntryType;
  category: FinanceCategory;
  status: FinanceTransactionStatus;
  counterpartyId: string | null;
};

type DashboardPeriod = { start: Date; end: Date; previousStart: Date; previousEnd: Date; today: Date };
type DashboardData = { aggregateRows: DashboardAggregate[]; recentTransactions: TransactionRecord[] };

function updateFields(existing: TransactionRecord, input: TransactionInput): TransactionUpdateFields {
  return {
    type: input.type ?? existing.type,
    category: input.category ?? existing.category,
    status: input.status ?? existing.status,
    counterpartyId: input.counterpartyId === undefined ? existing.counterpartyId : input.counterpartyId
  };
}

function validateUpdateFields(existing: TransactionRecord, fields: TransactionUpdateFields): void {
  if (!CATEGORIES_BY_TYPE[fields.type].includes(fields.category)) {
    throw new BadRequestException(CATEGORY_MISMATCH_MESSAGE);
  }
  if (fields.status !== FinanceTransactionStatus.PAID && fields.status !== FinanceTransactionStatus.PENDING) {
    throw new BadRequestException('A situação deve ser paga ou pendente.');
  }
  if (existing.status === FinanceTransactionStatus.PAID && fields.status === FinanceTransactionStatus.PENDING) {
    throw new BadRequestException('Um lançamento pago não pode voltar para pendente; use o estorno para corrigir o histórico.');
  }
}

function transactionUpdateData(input: TransactionInput): Prisma.FinanceTransactionUncheckedUpdateManyInput {
  const data: Prisma.FinanceTransactionUncheckedUpdateManyInput = { version: { increment: 1 } };
  if (input.type !== undefined) data.type = input.type;
  if (input.category !== undefined) data.category = input.category;
  if (input.subcategory !== undefined) data.subcategory = input.subcategory?.trim() || null;
  if (input.counterpartyId !== undefined) data.counterpartyId = input.counterpartyId;
  if (input.description !== undefined) data.description = input.description.trim();
  if (input.amount !== undefined) data.amount = new Prisma.Decimal(input.amount.toFixed(2));
  return { ...data, ...transactionTimingData(input) };
}

function transactionTimingData(input: TransactionInput): Prisma.FinanceTransactionUncheckedUpdateManyInput {
  const data: Prisma.FinanceTransactionUncheckedUpdateManyInput = {};
  if (input.occurredAt !== undefined) data.occurredAt = new Date(input.occurredAt);
  if (input.dueAt !== undefined) data.dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (input.status !== undefined) data.status = input.status;
  return data;
}

function reversalAudit(reversal: TransactionRecord | null) {
  return { reversalId: reversal?.id ?? null, reversal: reversal ? auditSnapshot(reversal) : null };
}

function assertCancelable(existing: TransactionRecord): void {
  if (existing.status === FinanceTransactionStatus.CANCELLED || existing.status === FinanceTransactionStatus.REVERSED || existing.reversalOfId || existing.reversal) {
    throw new ConflictException('O lançamento já foi cancelado, anulado ou ajustado.');
  }
}

function cancellationState(existing: TransactionRecord): { paid: boolean; nextStatus: FinanceTransactionStatus; reversedAt: Date | null } {
  const paid = existing.status === FinanceTransactionStatus.PAID;
  return {
    paid,
    nextStatus: paid ? FinanceTransactionStatus.REVERSED : FinanceTransactionStatus.CANCELLED,
    reversedAt: paid ? new Date() : null
  };
}

function dashboardPeriod(months: number): DashboardPeriod {
  const { start, end } = periodFor(months);
  return {
    start,
    end,
    previousStart: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - months, 1)),
    previousEnd: start,
    today: startOfUtcDay()
  };
}

function rowsFor(aggregateRows: DashboardAggregate[], kind: DashboardAggregate['kind']): DashboardAggregate[] {
  return aggregateRows.filter((row) => row.kind === kind);
}

function dashboardTotals(aggregateRows: DashboardAggregate[], kind: DashboardAggregate['kind']) {
  return rowsFor(aggregateRows, kind).map((row) => ({
    type: row.type!, _sum: { amount: row.amount }, _count: { _all: row.count }
  }));
}

function monthlyDashboardRows(aggregateRows: DashboardAggregate[]): Array<{ month: Date; income: Prisma.Decimal; expense: Prisma.Decimal }> {
  const monthlyRows = new Map<string, { month: Date; income: Prisma.Decimal; expense: Prisma.Decimal }>();
  for (const row of rowsFor(aggregateRows, 'MONTHLY')) {
    if (!row.month) continue;
    const key = monthKey(row.month);
    const monthlyRow = monthlyRows.get(key) ?? { month: row.month, income: decimalValue(null), expense: decimalValue(null) };
    if (row.type === FinanceEntryType.INCOME) monthlyRow.income = decimalValue(row.amount);
    else monthlyRow.expense = decimalValue(row.amount);
    monthlyRows.set(key, monthlyRow);
  }
  return [...monthlyRows.values()].sort((a, b) => a.month.getTime() - b.month.getTime());
}

function dashboardMonthly(months: number, start: Date, rawMonthly: Array<{ month: Date; income: Prisma.Decimal; expense: Prisma.Decimal }>) {
  const byMonth = new Map(rawMonthly.map((row) => [monthKey(new Date(row.month)), row]));
  return Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    const row = byMonth.get(monthKey(date));
    const monthIncome = decimalValue(row?.income);
    const monthExpense = decimalValue(row?.expense);
    return {
      month: monthKey(date),
      label: monthLabel(date),
      income: monthIncome.toNumber(),
      expense: monthExpense.toNumber(),
      net: monthIncome.minus(monthExpense).toNumber()
    };
  });
}

function buildDashboard(period: DashboardPeriod, months: number, data: DashboardData) {
  const totals = dashboardTotals(data.aggregateRows, 'CURRENT');
  const categories = rowsFor(data.aggregateRows, 'CATEGORY').sort((a, b) => (b.amount ?? decimalValue(null)).comparedTo(a.amount ?? decimalValue(null)));
  const pendingTotals = dashboardTotals(data.aggregateRows, 'PENDING');
  const overdueTotals = dashboardTotals(data.aggregateRows, 'OVERDUE');
  const previousTotals = dashboardTotals(data.aggregateRows, 'PREVIOUS');
  const rawMonthly = monthlyDashboardRows(data.aggregateRows);
  const incomeAmount = decimalValue(totals.find((row) => row.type === FinanceEntryType.INCOME)?._sum.amount);
  const expenseAmount = decimalValue(totals.find((row) => row.type === FinanceEntryType.EXPENSE)?._sum.amount);
  const previousIncomeAmount = decimalValue(previousTotals.find((row) => row.type === FinanceEntryType.INCOME)?._sum.amount);
  const previousExpenseAmount = decimalValue(previousTotals.find((row) => row.type === FinanceEntryType.EXPENSE)?._sum.amount);
  const monthly = dashboardMonthly(months, period.start, rawMonthly);
  return {
    currency: 'BRL',
    period: { months, from: period.start.toISOString(), to: period.end.toISOString() },
    summary: {
      income: incomeAmount.toNumber(),
      expense: expenseAmount.toNumber(),
      net: incomeAmount.minus(expenseAmount).toNumber(),
      transactionCount: totals.reduce((count, row) => count + row._count._all, 0)
    },
    comparison: {
      previousPeriod: { from: period.previousStart.toISOString(), to: period.previousEnd.toISOString() },
      previousSummary: {
        income: previousIncomeAmount.toNumber(),
        expense: previousExpenseAmount.toNumber(),
        net: previousIncomeAmount.minus(previousExpenseAmount).toNumber(),
        transactionCount: previousTotals.reduce((count, row) => count + row._count._all, 0)
      },
      changes: {
        income: publicComparisonMetric(incomeAmount, previousIncomeAmount),
        expense: publicComparisonMetric(expenseAmount, previousExpenseAmount),
        net: publicComparisonMetric(incomeAmount.minus(expenseAmount), previousIncomeAmount.minus(previousExpenseAmount))
      }
    },
    openBalances: {
      receivables: openBalance(pendingTotals, FinanceEntryType.INCOME),
      payables: openBalance(pendingTotals, FinanceEntryType.EXPENSE),
      overdueReceivables: openBalance(overdueTotals, FinanceEntryType.INCOME),
      overduePayables: openBalance(overdueTotals, FinanceEntryType.EXPENSE)
    },
    monthly,
    expensesByCategory: categories.map((row) => ({
      category: row.category!,
      amount: decimalNumber(row.amount),
      sharePercent: expenseAmount.gt(0)
        ? decimalValue(row.amount).dividedBy(expenseAmount).times(100).toDecimalPlaces(1).toNumber()
        : 0
    })),
    recentTransactions: data.recentTransactions.map(publicTransaction)
  };
}

function validateListInput(input: { type?: FinanceEntryType; category?: FinanceCategory; from?: string; to?: string }): void {
  if (input.type && input.category && !CATEGORIES_BY_TYPE[input.type].includes(input.category)) {
    throw new BadRequestException(CATEGORY_MISMATCH_MESSAGE);
  }
  if (input.from && input.to && input.from > input.to) {
    throw new BadRequestException('A data final deve ser igual ou posterior à data inicial.');
  }
}

function listDateFilter(input: { from?: string; to?: string }): Prisma.DateTimeFilter {
  const occurredAt: Prisma.DateTimeFilter = {};
  if (input.from) occurredAt.gte = new Date(`${input.from}T00:00:00.000Z`);
  if (input.to) {
    const endExclusive = new Date(`${input.to}T00:00:00.000Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    occurredAt.lt = endExclusive;
  }
  return occurredAt;
}

function listStatusFilter(status: TransactionStatusFilter | undefined, today: Date): Prisma.FinanceTransactionWhereInput {
  if (status === 'OVERDUE') return { status: FinanceTransactionStatus.PENDING, dueAt: { lt: today } };
  if (status === FinanceTransactionStatus.PENDING) return { status: FinanceTransactionStatus.PENDING, OR: [{ dueAt: null }, { dueAt: { gte: today } }] };
  if (status === FinanceTransactionStatus.PAID) return { status: FinanceTransactionStatus.PAID, reversalOfId: null, adjustmentKind: null };
  if (status === 'REFUNDED') return { adjustmentKind: FinanceAdjustmentKind.REFUND };
  if (status === FinanceTransactionStatus.REVERSED) return { OR: [{ status: FinanceTransactionStatus.REVERSED }, { adjustmentKind: FinanceAdjustmentKind.VOID }] };
  return status ? { status, reversalOfId: null, adjustmentKind: null } : {};
}

function listWhere(
  companyId: string,
  input: { type?: FinanceEntryType; category?: FinanceCategory; search?: string; status?: TransactionStatusFilter },
  occurredAt: Prisma.DateTimeFilter,
  statusWhere: Prisma.FinanceTransactionWhereInput
): Prisma.FinanceTransactionWhereInput {
  const predicates: Prisma.FinanceTransactionWhereInput[] = [];
  const search = input.search?.trim();
  if (search) {
    const escaped = escapeLikeSearch(search);
    predicates.push({ OR: [
      { description: { contains: escaped, mode: 'insensitive' } },
      { counterparty: { is: { name: { contains: escaped, mode: 'insensitive' } } } }
    ] });
  }
  if (input.status) predicates.push(statusWhere);
  return {
    companyId,
    ...(input.type ? { type: input.type } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(predicates.length === 1 ? predicates[0] : {}),
    ...(predicates.length > 1 ? { AND: predicates } : {}),
    ...(Object.keys(occurredAt).length ? { occurredAt } : {})
  };
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async createTransaction(principal: AuthPrincipal, input: Required<Pick<TransactionInput, 'type' | 'category' | 'description' | 'amount' | 'occurredAt'>> & TransactionInput) {
    if (!CATEGORIES_BY_TYPE[input.type].includes(input.category)) {
      throw new BadRequestException(CATEGORY_MISMATCH_MESSAGE);
    }
    if (input.status && input.status !== FinanceTransactionStatus.PAID && input.status !== FinanceTransactionStatus.PENDING) {
      throw new BadRequestException('A situação inicial deve ser paga ou pendente.');
    }

    const occurredAt = new Date(input.occurredAt);
    const amount = new Prisma.Decimal(input.amount.toFixed(2));
    const status = input.status ?? FinanceTransactionStatus.PAID;
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    const subcategory = input.subcategory?.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      await this.assertCounterparty(tx, principal.companyId, input.counterpartyId ?? null, input.type);
      const entry = await tx.financeTransaction.create({
        data: {
          companyId: principal.companyId,
          createdByUserId: principal.userId,
          type: input.type,
          category: input.category,
          subcategory,
          counterpartyId: input.counterpartyId ?? null,
          description: input.description.trim(),
          amount,
          occurredAt,
          dueAt,
          status
        },
        select: transactionSelect
      });

      await tx.auditLog.create({
        data: {
          actorUserId: principal.userId,
          companyId: principal.companyId,
          action: 'FINANCE_TRANSACTION_CREATED',
          entityType: 'FinanceTransaction',
          entityId: entry.id,
          metadata: { after: auditSnapshot(entry) }
        }
      });

      return publicTransaction(entry);
    });
  }

  async updateTransaction(principal: AuthPrincipal, id: string, input: TransactionInput) {
    if (!Object.keys(input).length) throw new BadRequestException('Informe ao menos um campo para atualizar.');
    return this.prisma.$transaction((tx) => this.updateTransactionInTransaction(tx, principal, id, input));
  }

  private async updateTransactionInTransaction(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    id: string,
    input: TransactionInput
  ) {
    await setTenantContext(tx, principal);
    const existing = await tx.financeTransaction.findFirst({
      where: { id, companyId: principal.companyId },
      select: transactionSelect
    });
    if (!existing) throw new NotFoundException(TRANSACTION_NOT_FOUND_MESSAGE);
    if (existing.status === FinanceTransactionStatus.CANCELLED || existing.status === FinanceTransactionStatus.REVERSED || existing.reversalOfId || existing.reversal) {
      throw new ConflictException('Lançamentos cancelados, anulados ou já ajustados não podem ser alterados.');
    }
    const fields = updateFields(existing, input);
    await this.assertCounterparty(tx, principal.companyId, fields.counterpartyId, fields.type);
    validateUpdateFields(existing, fields);
    const changed = await tx.financeTransaction.updateMany({
      where: { id, companyId: principal.companyId, status: existing.status, reversalOfId: null, version: existing.version },
      data: transactionUpdateData(input)
    });
    if (changed.count !== 1) throw new ConflictException(TRANSACTION_CONFLICT_MESSAGE);
    const updated = await tx.financeTransaction.findFirst({
      where: { id, companyId: principal.companyId },
      select: transactionSelect
    });
    if (!updated) throw new NotFoundException(TRANSACTION_NOT_FOUND_MESSAGE);
    await tx.auditLog.create({
      data: {
        actorUserId: principal.userId,
        companyId: principal.companyId,
        action: 'FINANCE_TRANSACTION_UPDATED',
        entityType: 'FinanceTransaction',
        entityId: id,
        metadata: { before: auditSnapshot(existing), after: auditSnapshot(updated) }
      }
    });
    return publicTransaction(updated);
  }

  async cancelTransaction(principal: AuthPrincipal, id: string) {
    return this.prisma.$transaction((tx) => this.cancelTransactionInTransaction(tx, principal, id));
  }

  private async cancelTransactionInTransaction(tx: Prisma.TransactionClient, principal: AuthPrincipal, id: string) {
    await setTenantContext(tx, principal);
    const existing = await tx.financeTransaction.findFirst({
      where: { id, companyId: principal.companyId },
      select: transactionSelect
    });
    if (!existing) throw new NotFoundException(TRANSACTION_NOT_FOUND_MESSAGE);
    assertCancelable(existing);
    const { paid, nextStatus, reversedAt } = cancellationState(existing);
    const changed = await tx.financeTransaction.updateMany({
      where: { id, companyId: principal.companyId, status: existing.status, reversalOfId: null, version: existing.version },
      data: { status: nextStatus, ...(reversedAt ? { reversedAt } : {}), version: { increment: 1 } }
    });
    if (changed.count !== 1) throw new ConflictException(TRANSACTION_CONFLICT_MESSAGE);
    const reversal = paid ? await this.createVoidReversal(tx, principal, id, existing) : null;
    const updated = await tx.financeTransaction.findFirst({
      where: { id, companyId: principal.companyId },
      select: transactionSelect
    });
    if (!updated) throw new NotFoundException(TRANSACTION_NOT_FOUND_MESSAGE);
    await tx.auditLog.create({
      data: {
        actorUserId: principal.userId,
        companyId: principal.companyId,
        action: paid ? 'FINANCE_TRANSACTION_VOIDED' : 'FINANCE_TRANSACTION_CANCELLED',
        entityType: 'FinanceTransaction',
        entityId: id,
        metadata: {
          before: auditSnapshot(existing),
          after: auditSnapshot(updated),
          ...reversalAudit(reversal)
        }
      }
    });
    return { cancelled: true as const, adjustmentKind: paid ? FinanceAdjustmentKind.VOID : null, reversalId: reversal?.id ?? null };
  }

  private async createVoidReversal(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    id: string,
    existing: TransactionRecord
  ): Promise<TransactionRecord> {
    return tx.financeTransaction.create({
      data: {
        companyId: principal.companyId,
        createdByUserId: principal.userId,
        type: existing.type === FinanceEntryType.INCOME ? FinanceEntryType.EXPENSE : FinanceEntryType.INCOME,
        category: FinanceCategory.OTHER,
        description: `Estorno do lançamento ${id.slice(0, 8)}`,
        amount: existing.amount,
        occurredAt: new Date(),
        status: FinanceTransactionStatus.PAID,
        reversalOfId: id,
        adjustmentKind: FinanceAdjustmentKind.VOID
      },
      select: transactionSelect
    });
  }

  async refundTransaction(principal: AuthPrincipal, id: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await setTenantContext(tx, principal);
        const existing = await tx.financeTransaction.findFirst({
          where: { id, companyId: principal.companyId },
          select: transactionSelect
        });
        if (!existing) throw new NotFoundException(TRANSACTION_NOT_FOUND_MESSAGE);
        if (existing.status !== FinanceTransactionStatus.PAID || existing.reversalOfId || existing.reversal) {
          throw new ConflictException('A devolução integral só pode ser registrada uma vez para um lançamento pago sem ajustes.');
        }

        const changed = await tx.financeTransaction.updateMany({
          where: { id, companyId: principal.companyId, status: FinanceTransactionStatus.PAID, reversalOfId: null, version: existing.version },
          data: { version: { increment: 1 } }
        });
        if (changed.count !== 1) throw new ConflictException(TRANSACTION_CONFLICT_MESSAGE);

        const adjustment = await tx.financeTransaction.create({
          data: {
            companyId: principal.companyId,
            createdByUserId: principal.userId,
            type: existing.type === FinanceEntryType.INCOME ? FinanceEntryType.EXPENSE : FinanceEntryType.INCOME,
            category: FinanceCategory.OTHER,
            description: `Devolução do lançamento ${id.slice(0, 8)}`,
            amount: existing.amount,
            occurredAt: new Date(),
            status: FinanceTransactionStatus.PAID,
            reversalOfId: id,
            adjustmentKind: FinanceAdjustmentKind.REFUND
          },
          select: transactionSelect
        });

        const updated = await tx.financeTransaction.findFirst({
          where: { id, companyId: principal.companyId },
          select: transactionSelect
        });
        if (!updated) throw new NotFoundException(TRANSACTION_NOT_FOUND_MESSAGE);

        await tx.auditLog.create({
          data: {
            actorUserId: principal.userId,
            companyId: principal.companyId,
            action: 'FINANCE_TRANSACTION_REFUND_RECORDED',
            entityType: 'FinanceTransaction',
            entityId: id,
            metadata: {
              before: auditSnapshot(existing),
              after: auditSnapshot(updated),
              adjustment: auditSnapshot(adjustment)
            }
          }
        });

        return { refunded: true as const, adjustmentId: adjustment.id };
      });
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('Já existe uma anulação ou devolução vinculada a este lançamento.');
      }
      throw error;
    }
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

    const allowed: CounterpartyRole[] = type === FinanceEntryType.INCOME
      ? [CounterpartyRole.CUSTOMER, CounterpartyRole.BOTH]
      : [CounterpartyRole.SUPPLIER, CounterpartyRole.BOTH];
    if (!allowed.includes(counterparty.role)) {
      throw new BadRequestException(type === FinanceEntryType.INCOME
        ? 'Selecione um cliente para vincular à receita.'
        : 'Selecione um fornecedor para vincular à despesa.');
    }
  }

  async listTransactions(principal: AuthPrincipal, input: {
    page: number;
    limit: number;
    search?: string;
    type?: FinanceEntryType;
    category?: FinanceCategory;
    status?: TransactionStatusFilter;
    from?: string;
    to?: string;
  }) {
    validateListInput(input);
    const occurredAt = listDateFilter(input);
    const statusWhere = listStatusFilter(input.status, startOfUtcDay());
    const where = listWhere(principal.companyId, input, occurredAt, statusWhere);
    const [total, rows] = await withTransientRetry(
      () => this.prisma.$transaction(async (tx) => {
        await setTenantContext(tx, principal);
        return Promise.all([
          tx.financeTransaction.count({ where }),
          tx.financeTransaction.findMany({
            where,
            orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
            skip: (input.page - 1) * input.limit,
            take: input.limit,
            select: transactionSelect
          })
        ]);
      }, READ_TRANSACTION_OPTIONS),
      { operation: 'finance.transactions.list', writeSafety: 'read-only' }
    );
    return {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
      items: rows.map(publicTransaction)
    };
  }

  async getDashboard(principal: AuthPrincipal, months: number) {
    const period = dashboardPeriod(months);
    const data = await this.readDashboardData(principal, period);
    return buildDashboard(period, months, data);
  }

  private async readDashboardData(principal: AuthPrincipal, period: DashboardPeriod): Promise<DashboardData> {
    return withTransientRetry(
      () => this.prisma.$transaction(async (tx) => {
        await setTenantContext(tx, principal);
        return Promise.all([
          tx.$queryRaw<DashboardAggregate[]>`
          WITH scoped AS MATERIALIZED (
            SELECT "type", "category", "amount", "occurredAt", "status", "dueAt", "adjustmentKind", "reversalOfId"
            FROM "gft_inteligente"."FinanceTransaction"
            WHERE "companyId" = ${principal.companyId}::uuid
              AND (
                ("occurredAt" >= ${period.previousStart} AND "occurredAt" < ${period.end}
                  AND "status" = 'PAID' AND ("adjustmentKind" IS NULL OR "adjustmentKind" = 'REFUND'))
                OR ("status" = 'PENDING' AND "reversalOfId" IS NULL AND "adjustmentKind" IS NULL)
              )
          ),
          current_paid AS (
            SELECT * FROM scoped
            WHERE "occurredAt" >= ${period.start} AND "occurredAt" < ${period.end}
              AND "status" = 'PAID' AND ("adjustmentKind" IS NULL OR "adjustmentKind" = 'REFUND')
          ),
          previous_paid AS (
            SELECT * FROM scoped
            WHERE "occurredAt" >= ${period.previousStart} AND "occurredAt" < ${period.previousEnd}
              AND "status" = 'PAID' AND ("adjustmentKind" IS NULL OR "adjustmentKind" = 'REFUND')
          ),
          pending AS (
            SELECT * FROM scoped
            WHERE "status" = 'PENDING' AND "reversalOfId" IS NULL AND "adjustmentKind" IS NULL
          )
          SELECT 'CURRENT'::text AS "kind", "type"::text AS "type", NULL::text AS "category",
            NULL::timestamptz AS "month", SUM("amount")::numeric AS "amount", COUNT(*)::int AS "count"
          FROM current_paid
          GROUP BY "type"
          UNION ALL
          SELECT 'CATEGORY'::text, NULL::text, "category"::text, NULL::timestamptz,
            SUM("amount")::numeric, 0::int
          FROM current_paid
          WHERE "type" = 'EXPENSE'
          GROUP BY "category"
          UNION ALL
          SELECT 'MONTHLY'::text, "type"::text, NULL::text, date_trunc('month', "occurredAt", 'UTC'),
            SUM("amount")::numeric, 0::int
          FROM current_paid
          GROUP BY 4, "type"
          UNION ALL
          SELECT 'PENDING'::text, "type"::text, NULL::text, NULL::timestamptz,
            SUM("amount")::numeric, COUNT(*)::int
          FROM pending
          GROUP BY "type"
          UNION ALL
          SELECT 'OVERDUE'::text, "type"::text, NULL::text, NULL::timestamptz,
            SUM("amount")::numeric, COUNT(*)::int
          FROM pending
          WHERE "dueAt" < ${period.today}
          GROUP BY "type"
          UNION ALL
          SELECT 'PREVIOUS'::text, "type"::text, NULL::text, NULL::timestamptz,
            SUM("amount")::numeric, COUNT(*)::int
          FROM previous_paid
          GROUP BY "type"
          `,
          tx.financeTransaction.findMany({
            where: { companyId: principal.companyId, occurredAt: { gte: period.start, lt: period.end } },
            orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
            take: 10,
            select: transactionSelect
          })
        ]);
      }, DASHBOARD_TRANSACTION_OPTIONS),
      { operation: 'finance.dashboard', writeSafety: 'read-only' }
    ).then(([aggregateRows, recentTransactions]) => ({ aggregateRows, recentTransactions }));
  }

}
