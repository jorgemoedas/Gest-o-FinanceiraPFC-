import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { FinanceEntryType, Prisma } from '../../generated/prisma/client';
import type { AuthPrincipal } from '../../common/auth-principal';
import type { PrismaService } from '../../database/prisma.service';
import { setTenantContext } from '../../database/tenant-context';
import { AnalyticsService } from './analytics.service';

jest.mock('../../database/tenant-context', () => ({ setTenantContext: jest.fn(async () => undefined) }));

const principal: AuthPrincipal = {
  userId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10',
  email: 'readonly@example.test',
  companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8',
  role: 'READ_ONLY' as AuthPrincipal['role']
};
const decimal = (value: string) => new Prisma.Decimal(value);

function aggregate(date: string, type: FinanceEntryType, category: string, amount: string, transactionCount: number) {
  return { month: new Date(`${date}T00:00:00.000Z`), type, category, amount: decimal(amount), transactionCount };
}

const mock = () => jest.fn<(...args: any[]) => any>();

describe('AnalyticsService', () => {
  const globalPrisma = {
    financeTransaction: { findMany: mock() },
    $transaction: mock()
  };
  const tx = {
    financeTransaction: { findMany: mock() },
    auditLog: { create: mock() },
    $queryRaw: mock()
  };
  let service: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    globalPrisma.$transaction.mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
    tx.$queryRaw.mockResolvedValue([]);
    tx.auditLog.create.mockResolvedValue({});
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-05T12:00:00.000Z'));
    service = new AnalyticsService(globalPrisma as unknown as PrismaService);
  });

  afterEach(() => { jest.useRealTimers(); });

  it('returns a zero-filled report with finite values and uses only the distinct transaction client', async () => {
    const result = await service.report(principal, { months: 3, projectionMonths: 1 });
    expect(result.monthly).toHaveLength(3);
    expect(result.monthly.every((item) => item.income === 0 && item.expense === 0 && item.net === 0 && item.transactionCount === 0)).toBe(true);
    expect(result.trend.income.slopePerMonth).toBe(0);
    expect(result.seasonality.index).toBeNull();
    expect(result.seasonality.explanation).toContain('24');
    expect(setTenantContext).toHaveBeenCalledWith(tx, principal);
    expect(globalPrisma.financeTransaction.findMany).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.financeTransaction.findMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'FINANCE_ANALYTICS_VIEWED', entityType: 'Analytics', companyId: principal.companyId });
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toEqual(expect.objectContaining({ months: 3, projectionMonths: 1, monthlyCount: 3, projectionCount: 1 }));
  });

  it('keeps Decimal aggregation, applies the paid/refund criterion and fires explicit alerts', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([
        aggregate('2026-07-01', FinanceEntryType.INCOME, 'SALES', '100', 1), aggregate('2026-07-01', FinanceEntryType.EXPENSE, 'RENT', '100', 1),
        aggregate('2026-08-01', FinanceEntryType.INCOME, 'SALES', '100', 1), aggregate('2026-08-01', FinanceEntryType.EXPENSE, 'RENT', '100', 1),
        aggregate('2026-09-01', FinanceEntryType.INCOME, 'SALES', '0', 1), aggregate('2026-09-01', FinanceEntryType.EXPENSE, 'RENT', '131', 1)
      ])
      .mockResolvedValueOnce([{ amount: decimal('55.50'), count: 1 }]);

    const result = await service.report(principal, { months: 3, projectionMonths: 1 });
    const paidSql = (tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('');
    expect(paidSql).toContain('SUM("amount")::numeric');
    expect(paidSql).toContain('GROUP BY 1, "type", "category"');
    expect(paidSql).toContain('AND "status" = \'PAID\'');
    expect(paidSql).toContain('AND ("adjustmentKind" IS NULL OR "adjustmentKind" = \'REFUND\')');
    expect(tx.$queryRaw.mock.calls[0]).toContain(principal.companyId);
    expect(result.alerts.map((alert) => alert.code)).toEqual(expect.arrayContaining(['EXPENSE_GROWTH', 'CATEGORY_EXPENSE_GROWTH', 'OVERDUE_RECEIVABLES', 'NEGATIVE_PROJECTED_NET']));
    for (const alert of result.alerts) {
      expect(alert.source.metric).toBeTruthy();
      expect(alert.source.reference).toBeTruthy();
      expect(alert.explanation).toMatch(/R\$|conta|receita|despesa|saldo/i);
    }
    expect(result.monthly.find((item) => item.monthKey === '2026-09')).toMatchObject({ expense: 131, net: -131 });
    expect(result.projection[0].net).toBeLessThan(0);
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject({ transactionCount: 6 });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('does not fire growth or overdue alerts for balanced data, including READ_ONLY readers', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([
        aggregate('2026-07-01', FinanceEntryType.INCOME, 'SALES', '100', 1), aggregate('2026-07-01', FinanceEntryType.EXPENSE, 'RENT', '100', 1),
        aggregate('2026-08-01', FinanceEntryType.INCOME, 'SALES', '100', 1), aggregate('2026-08-01', FinanceEntryType.EXPENSE, 'RENT', '100', 1),
        aggregate('2026-09-01', FinanceEntryType.INCOME, 'SALES', '100', 1), aggregate('2026-09-01', FinanceEntryType.EXPENSE, 'RENT', '100', 1)
      ])
      .mockResolvedValueOnce([{ amount: decimal('0'), count: 0 }]);
    const result = await service.report(principal, { months: 3, projectionMonths: 1 });
    expect(result.alerts.some((alert) => ['EXPENSE_GROWTH', 'CATEGORY_EXPENSE_GROWTH', 'OVERDUE_RECEIVABLES', 'NEGATIVE_PROJECTED_NET'].includes(alert.code))).toBe(false);
    expect(result.monthly.every((item) => Number.isFinite(item.net))).toBe(true);
  });
});
