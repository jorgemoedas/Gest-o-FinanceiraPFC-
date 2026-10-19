import { BadRequestException, Injectable } from '@nestjs/common';
import { FinanceCategory, FinanceEntryType, Prisma } from '../../generated/prisma/client';
import { AuthPrincipal } from '../../common/auth-principal';
import { PrismaService } from '../../database/prisma.service';

interface RawMonthAggregate {
  month: Date;
  income: Prisma.Decimal;
  expense: Prisma.Decimal;
}

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

function decimalNumber(value: Prisma.Decimal | null | undefined): number {
  return value ? Number(value.toString()) : 0;
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

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async createTransaction(principal: AuthPrincipal, input: {
    type: FinanceEntryType;
    category: FinanceCategory;
    description: string;
    amount: number;
    occurredAt: string;
  }) {
    if (!CATEGORIES_BY_TYPE[input.type].includes(input.category)) {
      throw new BadRequestException('A categoria não corresponde ao tipo de lançamento.');
    }

    const occurredAt = new Date(input.occurredAt);
    const amount = new Prisma.Decimal(input.amount.toFixed(2));

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.financeTransaction.create({
        data: {
          companyId: principal.companyId,
          createdByUserId: principal.userId,
          type: input.type,
          category: input.category,
          description: input.description.trim(),
          amount,
          occurredAt
        },
        select: { id: true, type: true, category: true, description: true, amount: true, occurredAt: true }
      });

      await tx.auditLog.create({
        data: {
          actorUserId: principal.userId,
          companyId: principal.companyId,
          action: 'FINANCE_TRANSACTION_CREATED',
          entityType: 'FinanceTransaction',
          entityId: entry.id,
          metadata: { type: entry.type, category: entry.category }
        }
      });

      return { ...entry, amount: decimalNumber(entry.amount) };
    });
  }

  async listTransactions(companyId: string, input: {
    page: number;
    limit: number;
    search?: string;
    type?: FinanceEntryType;
    category?: FinanceCategory;
    from?: string;
    to?: string;
  }) {
    if (input.type && input.category && !CATEGORIES_BY_TYPE[input.type].includes(input.category)) {
      throw new BadRequestException('A categoria não corresponde ao tipo de lançamento.');
    }
    if (input.from && input.to && input.from > input.to) {
      throw new BadRequestException('A data final deve ser igual ou posterior à data inicial.');
    }

    const occurredAt: Prisma.DateTimeFilter = {};
    if (input.from) occurredAt.gte = new Date(`${input.from}T00:00:00.000Z`);
    if (input.to) {
      const endExclusive = new Date(`${input.to}T00:00:00.000Z`);
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
      occurredAt.lt = endExclusive;
    }

    const where: Prisma.FinanceTransactionWhereInput = {
      companyId,
      ...(input.type ? { type: input.type } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.search ? { description: { contains: input.search.trim(), mode: 'insensitive' } } : {}),
      ...(Object.keys(occurredAt).length ? { occurredAt } : {})
    };
    const [total, rows] = await Promise.all([
      this.prisma.financeTransaction.count({ where }),
      this.prisma.financeTransaction.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        select: { id: true, type: true, category: true, description: true, amount: true, occurredAt: true }
      })
    ]);

    return {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
      items: rows.map((row) => ({ ...row, amount: decimalNumber(row.amount) }))
    };
  }

  async getDashboard(companyId: string, months: number) {
    const { start, end } = periodFor(months);
    const where = { companyId, occurredAt: { gte: start, lt: end } };

    const [totals, categories, rawMonthly, recentTransactions] = await Promise.all([
      this.prisma.financeTransaction.groupBy({
        by: ['type'],
        where,
        _sum: { amount: true },
        _count: { _all: true }
      }),
      this.prisma.financeTransaction.groupBy({
        by: ['category'],
        where: { ...where, type: FinanceEntryType.EXPENSE },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } }
      }),
      this.prisma.$queryRaw<RawMonthAggregate[]>`
        SELECT date_trunc('month', "occurredAt") AS "month",
          COALESCE(SUM(CASE WHEN "type" = 'INCOME' THEN "amount" ELSE 0 END), 0)::numeric AS "income",
          COALESCE(SUM(CASE WHEN "type" = 'EXPENSE' THEN "amount" ELSE 0 END), 0)::numeric AS "expense"
        FROM "gft_inteligente"."FinanceTransaction"
        WHERE "companyId" = ${companyId}::uuid
          AND "occurredAt" >= ${start}
          AND "occurredAt" < ${end}
        GROUP BY date_trunc('month', "occurredAt")
        ORDER BY date_trunc('month', "occurredAt") ASC
      `,
      this.prisma.financeTransaction.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: 10,
        select: { id: true, type: true, category: true, description: true, amount: true, occurredAt: true }
      })
    ]);

    const income = decimalNumber(totals.find((row) => row.type === FinanceEntryType.INCOME)?._sum.amount);
    const expense = decimalNumber(totals.find((row) => row.type === FinanceEntryType.EXPENSE)?._sum.amount);
    const transactionCount = totals.reduce((count, row) => count + row._count._all, 0);
    const byMonth = new Map(rawMonthly.map((row) => [monthKey(new Date(row.month)), row]));
    const monthly = Array.from({ length: months }, (_, index) => {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
      const row = byMonth.get(monthKey(date));
      const monthIncome = decimalNumber(row?.income);
      const monthExpense = decimalNumber(row?.expense);
      return {
        month: monthKey(date),
        label: monthLabel(date),
        income: monthIncome,
        expense: monthExpense,
        net: monthIncome - monthExpense
      };
    });

    return {
      currency: 'BRL',
      period: { months, from: start.toISOString(), to: end.toISOString() },
      summary: { income, expense, net: income - expense, transactionCount },
      monthly,
      expensesByCategory: categories.map((row) => ({
        category: row.category,
        amount: decimalNumber(row._sum.amount),
        sharePercent: expense > 0 ? Math.round((decimalNumber(row._sum.amount) / expense) * 1000) / 10 : 0
      })),
      recentTransactions: recentTransactions.map((row) => ({ ...row, amount: decimalNumber(row.amount) }))
    };
  }
}
