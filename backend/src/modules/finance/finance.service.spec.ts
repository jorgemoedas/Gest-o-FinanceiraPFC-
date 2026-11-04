import { CounterpartyRole, FinanceAdjustmentKind, FinanceCategory, FinanceEntryType, FinanceTransactionStatus, Prisma } from '../../generated/prisma/client';
import { AuthPrincipal } from '../../common/auth-principal';
import { setTenantContext } from '../../database/tenant-context';
import { PrismaService } from '../../database/prisma.service';
import { DASHBOARD_TRANSACTION_OPTIONS, FinanceService } from './finance.service';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../database/tenant-context', () => ({
  setTenantContext: jest.fn(async (_tx: unknown, _principal: unknown) => undefined)
}));

const principal: AuthPrincipal = {
  userId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10',
  email: 'owner@example.test',
  companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8',
  role: 'OWNER' as AuthPrincipal['role']
};
const decimal = (value: string) => new Prisma.Decimal(value);
const dashboardRow = (kind: string, type: FinanceEntryType | null, amount: string, count = 0, extra: Record<string, unknown> = {}) => ({
  kind, type, category: null, month: null, amount: decimal(amount), count, ...extra
});
const transactionId = '5d2a9a0e-339a-470e-9cc0-4624044cae86';
const reversalId = '76be0472-03ca-44a5-88ec-d1e75e22fbea';

function transactionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: transactionId,
    type: FinanceEntryType.EXPENSE,
    category: FinanceCategory.RENT,
    subcategory: null,
    counterpartyId: null,
    counterparty: null,
    description: 'Aluguel da sala',
    amount: decimal('1250.50'),
    occurredAt: new Date('2026-09-30T16:00:00.000Z'),
    dueAt: null,
    status: FinanceTransactionStatus.PAID,
    reversalOfId: null,
    adjustmentKind: null,
    reversedAt: null,
    version: 1,
    reversal: null,
    createdAt: new Date('2026-09-30T16:00:00.000Z'),
    ...overrides
  };
}

const resolvesTo = <T>(value: T) => jest.fn<(...args: unknown[]) => Promise<T>>().mockResolvedValue(value);

describe('FinanceService', () => {
  const prismaMock = {
    financeTransaction: {
      groupBy: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
      findMany: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
      count: jest.fn<(...args: unknown[]) => Promise<number>>(),
      create: jest.fn<(...args: unknown[]) => Promise<unknown>>()
    },
    $queryRaw: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
    $transaction: jest.fn<(...args: unknown[]) => Promise<unknown>>()
  };
  const txMock = {
    financeTransaction: {
      groupBy: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
      findMany: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
      count: jest.fn<(...args: unknown[]) => Promise<number>>(),
      create: jest.fn<(...args: unknown[]) => Promise<unknown>>()
    },
    $queryRaw: jest.fn<(...args: unknown[]) => Promise<unknown[]>>()
  };
  const globalPrismaMock = prismaMock;
  const prisma = prismaMock as unknown as PrismaService;
  let service: FinanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: unknown) =>
      (callback as (tx: typeof txMock) => Promise<unknown>)(txMock)
    );
    jest.useFakeTimers().setSystemTime(new Date('2026-10-05T12:00:00.000Z'));
    service = new FinanceService(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns company-scoped paid aggregates, open balances and zero-filled months', async () => {
    txMock.$queryRaw.mockResolvedValue([
      dashboardRow('CURRENT', FinanceEntryType.INCOME, '1000.00', 2),
      dashboardRow('CURRENT', FinanceEntryType.EXPENSE, '250.00', 1),
      dashboardRow('CATEGORY', null, '250.00', 0, { category: FinanceCategory.TAXES }),
      dashboardRow('MONTHLY', FinanceEntryType.INCOME, '1000.00', 0, { month: new Date('2026-08-01T00:00:00.000Z') }),
      dashboardRow('MONTHLY', FinanceEntryType.EXPENSE, '250.00', 0, { month: new Date('2026-08-01T00:00:00.000Z') }),
      dashboardRow('PENDING', FinanceEntryType.INCOME, '400.00', 2),
      dashboardRow('PENDING', FinanceEntryType.EXPENSE, '80.00', 1),
      dashboardRow('OVERDUE', FinanceEntryType.INCOME, '100.00', 1),
      dashboardRow('PREVIOUS', FinanceEntryType.INCOME, '100.00', 1),
      dashboardRow('PREVIOUS', FinanceEntryType.EXPENSE, '50.00', 1)
    ] as never);
    txMock.financeTransaction.findMany.mockResolvedValue([]);

    const result = await service.getDashboard(principal, 3);
    const aggregateSql = (txMock.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('');
    expect(aggregateSql).toContain('date_trunc(\'month\', "occurredAt", \'UTC\')');
    expect(aggregateSql).toContain('AND "status" = \'PAID\'');
    expect(aggregateSql).toContain('AND ("adjustmentKind" IS NULL OR "adjustmentKind" = \'REFUND\')');
    expect(aggregateSql).toContain("'PENDING'::text");
    expect(aggregateSql).toContain("'OVERDUE'::text");
    expect(txMock.financeTransaction.groupBy).not.toHaveBeenCalled();
    expect(result.summary).toEqual({ income: 1000, expense: 250, net: 750, transactionCount: 3 });
    expect(result.openBalances).toEqual({
      receivables: { amount: 400, count: 2 },
      payables: { amount: 80, count: 1 },
      overdueReceivables: { amount: 100, count: 1 },
      overduePayables: { amount: 0, count: 0 }
    });
    expect(result.monthly).toHaveLength(3);
    expect(result.monthly[0]).toMatchObject({ month: '2026-08', income: 1000, expense: 250 });
    expect(result.monthly[1]).toMatchObject({ month: '2026-09', income: 0, expense: 0 });
    expect(result.expensesByCategory[0]).toMatchObject({ category: 'TAXES', amount: 250, sharePercent: 100 });
    expect(setTenantContext).toHaveBeenCalledWith(txMock, principal);
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), DASHBOARD_TRANSACTION_OPTIONS);
    expect(globalPrismaMock.financeTransaction.groupBy).not.toHaveBeenCalled();
    expect(globalPrismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('computes monetary differences in Decimal before converting to display numbers', async () => {
    txMock.$queryRaw.mockResolvedValue([
      dashboardRow('CURRENT', FinanceEntryType.INCOME, '0.30', 1),
      dashboardRow('CURRENT', FinanceEntryType.EXPENSE, '0.10', 1),
      dashboardRow('MONTHLY', FinanceEntryType.INCOME, '0.30', 0, { month: new Date('2026-10-01T00:00:00.000Z') }),
      dashboardRow('MONTHLY', FinanceEntryType.EXPENSE, '0.10', 0, { month: new Date('2026-10-01T00:00:00.000Z') })
    ] as never);
    txMock.financeTransaction.findMany.mockResolvedValue([]);

    const result = await service.getDashboard(principal, 3);
    const currentMonth = result.monthly.find((month) => month.month === '2026-10');

    expect(result.summary.net.toFixed(2)).toBe('0.20');
    expect(currentMonth?.net.toFixed(2)).toBe('0.20');
  });

  it('compares equivalent UTC calendar periods and keeps PAID refunds while excluding VOID adjustments', async () => {
    txMock.$queryRaw.mockResolvedValue([
      dashboardRow('CURRENT', FinanceEntryType.INCOME, '150.00', 1),
      dashboardRow('CURRENT', FinanceEntryType.EXPENSE, '80.00', 1),
      dashboardRow('PREVIOUS', FinanceEntryType.INCOME, '100.00', 1),
      dashboardRow('PREVIOUS', FinanceEntryType.EXPENSE, '50.00', 1)
    ] as never);
    txMock.financeTransaction.findMany.mockResolvedValue([]);

    const result = await service.getDashboard(principal, 3);
    expect((txMock.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('')).toContain("'PREVIOUS'::text");
    expect(txMock.$queryRaw.mock.calls[0]).toContainEqual(new Date('2026-05-01T00:00:00.000Z'));
    expect(result.comparison).toEqual({
      previousPeriod: { from: '2026-05-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
      previousSummary: { income: 100, expense: 50, net: 50, transactionCount: 2 },
      changes: {
        income: { amount: 50, percent: 50 },
        expense: { amount: 30, percent: 60 },
        net: { amount: 20, percent: 40 }
      }
    });
    expect(setTenantContext).toHaveBeenCalledWith(txMock, principal);
  });

  it('lists transactions with company scope, filters, inclusive date range and pagination', async () => {
    const row = transactionRow();
    txMock.financeTransaction.count.mockResolvedValue(21);
    txMock.financeTransaction.findMany.mockResolvedValue([row] as never);

    const result = await service.listTransactions(principal, {
      page: 2,
      limit: 10,
      type: FinanceEntryType.EXPENSE,
      category: FinanceCategory.RENT,
      search: ' Aluguel ',
      from: '2026-09-01',
      to: '2026-09-30'
    });
    const expectedWhere = expect.objectContaining({
      companyId: principal.companyId,
      type: FinanceEntryType.EXPENSE,
      category: FinanceCategory.RENT,
      OR: [
        { description: { contains: 'Aluguel', mode: 'insensitive' } },
        { counterparty: { is: { name: { contains: 'Aluguel', mode: 'insensitive' } } } }
      ],
      occurredAt: { gte: new Date('2026-09-01T00:00:00.000Z'), lt: new Date('2026-10-01T00:00:00.000Z') }
    });

    expect(txMock.financeTransaction.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(txMock.financeTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expectedWhere,
      skip: 10,
      take: 10,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }]
    }));
    expect(result).toMatchObject({ page: 2, limit: 10, total: 21, totalPages: 3 });
    expect(result.items[0]).toMatchObject({ amount: 1250.5, status: FinanceTransactionStatus.PAID, dueAt: null, subcategory: null, version: 1 });
  });

  it('trata percentual como caractere literal sem ampliar a busca para todos os lançamentos', async () => {
    txMock.financeTransaction.count.mockResolvedValue(0);
    txMock.financeTransaction.findMany.mockResolvedValue([]);

    const result = await service.listTransactions(principal, { page: 1, limit: 20, search: '%' });

    expect(txMock.financeTransaction.count).toHaveBeenCalledWith({ where: expect.objectContaining({
      companyId: principal.companyId,
      OR: [
        { description: { contains: '\\%', mode: 'insensitive' } },
        { counterparty: { is: { name: { contains: '\\%', mode: 'insensitive' } } } }
      ]
    }) });
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it.each([
    {
      status: FinanceTransactionStatus.PENDING,
      statusWhere: { status: FinanceTransactionStatus.PENDING, OR: [{ dueAt: null }, { dueAt: { gte: new Date('2026-10-05T00:00:00.000Z') } }] }
    },
    {
      status: FinanceTransactionStatus.REVERSED,
      statusWhere: { OR: [{ status: FinanceTransactionStatus.REVERSED }, { adjustmentKind: FinanceAdjustmentKind.VOID }] }
    }
  ])('combines description/counterparty search with the $status status predicate', async ({ status, statusWhere }) => {
    txMock.financeTransaction.count.mockResolvedValue(0);
    txMock.financeTransaction.findMany.mockResolvedValue([]);

    await service.listTransactions(principal, { page: 1, limit: 20, search: 'Cliente Exemplo', status });

    const args = txMock.financeTransaction.findMany.mock.calls[0]?.[0] as unknown as { where: Prisma.FinanceTransactionWhereInput };
    expect(args.where).toMatchObject({
      companyId: principal.companyId,
      AND: [
        { OR: [
          { description: { contains: 'Cliente Exemplo', mode: 'insensitive' } },
          { counterparty: { is: { name: { contains: 'Cliente Exemplo', mode: 'insensitive' } } } }
        ] },
        statusWhere
      ]
    });
    expect(args.where).not.toHaveProperty('OR');
  });

  it('maps an overdue filter to pending entries with a due date before the current UTC day', async () => {
    txMock.financeTransaction.count.mockResolvedValue(1);
    txMock.financeTransaction.findMany.mockResolvedValue([
      transactionRow({ status: FinanceTransactionStatus.PENDING, dueAt: new Date('2026-10-04T00:00:00.000Z') })
    ] as never);

    const result = await service.listTransactions(principal, { page: 1, limit: 20, status: 'OVERDUE' });
    const expectedWhere = expect.objectContaining({
      companyId: principal.companyId,
      status: FinanceTransactionStatus.PENDING,
      dueAt: { lt: new Date('2026-10-05T00:00:00.000Z') }
    });

    expect(txMock.financeTransaction.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(result.items[0].status).toBe('OVERDUE');
  });

  it('keeps overdue items out of the pending filter', async () => {
    txMock.financeTransaction.count.mockResolvedValue(1);
    txMock.financeTransaction.findMany.mockResolvedValue([
      transactionRow({ status: FinanceTransactionStatus.PENDING, dueAt: null })
    ] as never);

    await service.listTransactions(principal, { page: 1, limit: 20, status: FinanceTransactionStatus.PENDING });

    expect(txMock.financeTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        companyId: principal.companyId,
        status: FinanceTransactionStatus.PENDING,
        OR: [{ dueAt: null }, { dueAt: { gte: new Date('2026-10-05T00:00:00.000Z') } }]
      })
    }));
  });

  it('filters paid rows separately from both legs of a reversal', async () => {
    const original = transactionRow({ status: FinanceTransactionStatus.REVERSED, reversal: { id: reversalId, adjustmentKind: FinanceAdjustmentKind.VOID } });
    const reversal = transactionRow({
      id: reversalId,
      type: FinanceEntryType.INCOME,
      category: FinanceCategory.OTHER,
      status: FinanceTransactionStatus.PAID,
      reversalOfId: transactionId,
      adjustmentKind: FinanceAdjustmentKind.VOID
    });
    txMock.financeTransaction.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    txMock.financeTransaction.findMany.mockResolvedValueOnce([transactionRow()] as never).mockResolvedValueOnce([original, reversal] as never);

    const paid = await service.listTransactions(principal, { page: 1, limit: 20, status: FinanceTransactionStatus.PAID });
    const reversed = await service.listTransactions(principal, { page: 1, limit: 20, status: FinanceTransactionStatus.REVERSED });
    const listCalls = txMock.financeTransaction.findMany.mock.calls as unknown as Array<[{ where: Prisma.FinanceTransactionWhereInput }] >;

    expect(listCalls[0][0].where).toMatchObject({
      companyId: principal.companyId,
      status: FinanceTransactionStatus.PAID,
      reversalOfId: null,
      adjustmentKind: null
    });
    expect(listCalls[1][0].where).toMatchObject({
      companyId: principal.companyId,
      OR: [{ status: FinanceTransactionStatus.REVERSED }, { adjustmentKind: FinanceAdjustmentKind.VOID }]
    });
    expect(paid.items[0].status).toBe(FinanceTransactionStatus.PAID);
    expect(reversed.items.map((item) => item.status)).toEqual([FinanceTransactionStatus.REVERSED, FinanceTransactionStatus.REVERSED]);
  });

  it('lists refunds with their own public status and filter', async () => {
    txMock.financeTransaction.count.mockResolvedValue(1);
    txMock.financeTransaction.findMany.mockResolvedValue([
      transactionRow({
        id: reversalId,
        type: FinanceEntryType.EXPENSE,
        category: FinanceCategory.OTHER,
        reversalOfId: transactionId,
        adjustmentKind: FinanceAdjustmentKind.REFUND
      })
    ] as never);

    const result = await service.listTransactions(principal, { page: 1, limit: 20, status: 'REFUNDED' });

    expect(txMock.financeTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: principal.companyId, adjustmentKind: FinanceAdjustmentKind.REFUND })
    }));
    expect(result.items[0]).toMatchObject({ status: 'REFUNDED', hasAdjustment: true });
  });

  it.each([
    { type: FinanceEntryType.INCOME, category: FinanceCategory.RENT, from: '2026-09-01', to: '2026-09-30' },
    { type: FinanceEntryType.EXPENSE, category: FinanceCategory.RENT, from: '2026-10-01', to: '2026-09-30' }
  ])('rejects inconsistent list filters before querying the database', async (filters) => {
    await expect(service.listTransactions(principal, { page: 1, limit: 20, ...filters })).rejects.toThrow();
    expect(txMock.financeTransaction.count).not.toHaveBeenCalled();
    expect(txMock.financeTransaction.findMany).not.toHaveBeenCalled();
  });

  it('creates a transaction and its audit event in the same database transaction', async () => {
    const entry = transactionRow({
      type: FinanceEntryType.INCOME,
      category: FinanceCategory.SALES,
      subcategory: 'Loja física',
      description: 'Venda de serviços',
      amount: decimal('125.50'),
      occurredAt: new Date('2026-10-04T00:00:00.000Z'),
      dueAt: new Date('2026-10-15T00:00:00.000Z'),
      status: FinanceTransactionStatus.PENDING
    });
    const tx = {
      financeTransaction: { create: resolvesTo(entry) },
      auditLog: { create: resolvesTo({}) }
    };
    prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
      return (callback as (transaction: typeof tx) => Promise<unknown>)(tx);
    });

    const result = await service.createTransaction(principal, {
      type: FinanceEntryType.INCOME,
      category: FinanceCategory.SALES,
      subcategory: ' Loja física ',
      description: 'Venda de serviços',
      amount: 125.5,
      occurredAt: '2026-10-04',
      dueAt: '2026-10-15',
      status: FinanceTransactionStatus.PENDING
    });

    expect(result.amount).toBe(125.5);
    expect(result.status).toBe(FinanceTransactionStatus.PENDING);
    expect(tx.financeTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        companyId: principal.companyId,
        createdByUserId: principal.userId,
        amount: decimal('125.50'),
        subcategory: 'Loja física',
        dueAt: new Date('2026-10-15T00:00:00.000Z'),
        status: FinanceTransactionStatus.PENDING
      })
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'FINANCE_TRANSACTION_CREATED', companyId: principal.companyId })
    }));
  });

  it('links only a same-company customer to an income transaction', async () => {
    const counterpartyId = '9290fe85-8d51-4a32-aa63-79339578a4ad';
    const linked = { id: counterpartyId, name: 'Cliente Exemplo', role: 'CUSTOMER' as const };
    const entry = transactionRow({ type: FinanceEntryType.INCOME, category: FinanceCategory.SALES, counterpartyId, counterparty: linked });
    const tx = {
      financeCounterparty: { findFirst: resolvesTo({ role: 'CUSTOMER' as const }) },
      financeTransaction: { create: resolvesTo(entry) },
      auditLog: { create: resolvesTo({}) }
    };
    prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
      return (callback as (transaction: typeof tx) => Promise<unknown>)(tx);
    });

    const result = await service.createTransaction(principal, {
      type: FinanceEntryType.INCOME,
      category: FinanceCategory.SALES,
      description: 'Venda para cliente',
      amount: 100,
      occurredAt: '2026-10-05',
      counterpartyId
    });

    expect(tx.financeCounterparty.findFirst).toHaveBeenCalledWith({
      where: { id: counterpartyId, companyId: principal.companyId },
      select: { role: true }
    });
    expect(tx.financeTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId: principal.companyId, counterpartyId })
    }));
    expect(result.counterparty).toEqual(linked);
  });

  it('rejects a counterparty that is outside the authenticated company before creating a transaction', async () => {
    const tx = {
      financeCounterparty: { findFirst: resolvesTo(null) },
      financeTransaction: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
      return (callback as (transaction: typeof tx) => Promise<unknown>)(tx);
    });

    await expect(service.createTransaction(principal, {
      type: FinanceEntryType.EXPENSE,
      category: FinanceCategory.SUPPLIERS,
      description: 'Pagamento a fornecedor',
      amount: 50,
      occurredAt: '2026-10-05',
      counterpartyId: '9290fe85-8d51-4a32-aa63-79339578a4ad'
    })).rejects.toThrow('não pertence à empresa autenticada');
    expect(tx.financeTransaction.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    { type: FinanceEntryType.INCOME, category: FinanceCategory.SALES, role: CounterpartyRole.CUSTOMER, allowed: true },
    { type: FinanceEntryType.INCOME, category: FinanceCategory.SALES, role: CounterpartyRole.BOTH, allowed: true },
    { type: FinanceEntryType.INCOME, category: FinanceCategory.SALES, role: CounterpartyRole.SUPPLIER, allowed: false },
    { type: FinanceEntryType.EXPENSE, category: FinanceCategory.SUPPLIERS, role: CounterpartyRole.SUPPLIER, allowed: true },
    { type: FinanceEntryType.EXPENSE, category: FinanceCategory.SUPPLIERS, role: CounterpartyRole.BOTH, allowed: true },
    { type: FinanceEntryType.EXPENSE, category: FinanceCategory.SUPPLIERS, role: CounterpartyRole.CUSTOMER, allowed: false }
  ])('enforces role $role for $type transactions', async ({ type, category, role, allowed }) => {
    const counterpartyId = '9290fe85-8d51-4a32-aa63-79339578a4ad';
    const linked = { id: counterpartyId, name: 'Parte Exemplo', role };
    const tx = {
      financeCounterparty: { findFirst: resolvesTo({ role }) },
      financeTransaction: { create: resolvesTo(transactionRow({ type, category, counterpartyId, counterparty: linked })) },
      auditLog: { create: resolvesTo({}) }
    };
    prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
      return (callback as (transaction: typeof tx) => Promise<unknown>)(tx);
    });

    const input = { type, category, description: 'Movimentação vinculada', amount: 100, occurredAt: '2026-10-05', counterpartyId };
    if (!allowed) {
      await expect(service.createTransaction(principal, input)).rejects.toThrow();
      expect(tx.financeTransaction.create).not.toHaveBeenCalled();
      return;
    }

    await expect(service.createTransaction(principal, input)).resolves.toMatchObject({ counterparty: linked });
    expect(tx.financeTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId: principal.companyId, counterpartyId })
    }));
  });

  it('updates only a company-owned transaction and writes before/after values atomically', async () => {
    const existing = transactionRow();
    const updated = transactionRow({ description: 'Aluguel atualizado', version: 2 });
    const tx = {
      financeTransaction: {
        findFirst: resolvesTo(existing).mockResolvedValueOnce(existing).mockResolvedValueOnce(updated),
        updateMany: resolvesTo({ count: 1 })
      },
      auditLog: { create: resolvesTo({}) }
    };
    prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
      return (callback as (transaction: typeof tx) => Promise<unknown>)(tx);
    });

    const result = await service.updateTransaction(principal, transactionId, { description: ' Aluguel atualizado ' });

    expect(result.description).toBe('Aluguel atualizado');
    expect(tx.financeTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: transactionId, companyId: principal.companyId, version: existing.version }),
      data: { description: 'Aluguel atualizado', version: { increment: 1 } }
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'FINANCE_TRANSACTION_UPDATED',
        metadata: expect.objectContaining({ before: expect.objectContaining({ amount: '1250.50' }), after: expect.objectContaining({ description: 'Aluguel atualizado' }) })
      })
    }));
  });

  it('links a company-owned supplier when editing an existing expense', async () => {
    const counterpartyId = '9290fe85-8d51-4a32-aa63-79339578a4ad';
    const linked = { id: counterpartyId, name: 'Fornecedor Exemplo', role: CounterpartyRole.SUPPLIER };
    const existing = transactionRow({ counterpartyId: null, counterparty: null });
    const updated = transactionRow({ counterpartyId, counterparty: linked, version: existing.version + 1 });
    const tx = {
      financeCounterparty: { findFirst: resolvesTo({ role: CounterpartyRole.SUPPLIER }) },
      financeTransaction: {
        findFirst: resolvesTo(existing).mockResolvedValueOnce(existing).mockResolvedValueOnce(updated),
        updateMany: resolvesTo({ count: 1 })
      },
      auditLog: { create: resolvesTo({}) }
    };
    prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
      return (callback as (transaction: typeof tx) => Promise<unknown>)(tx);
    });

    const result = await service.updateTransaction(principal, transactionId, { counterpartyId });

    expect(result.counterparty).toEqual(linked);
    expect(tx.financeTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ counterpartyId, version: { increment: 1 } })
    }));
  });

  it('clears the counterparty link without looking up an unassigned record', async () => {
    const counterpartyId = '9290fe85-8d51-4a32-aa63-79339578a4ad';
    const existing = transactionRow({ counterpartyId, counterparty: { id: counterpartyId, name: 'Fornecedor Exemplo', role: CounterpartyRole.SUPPLIER } });
    const updated = transactionRow({ counterpartyId: null, counterparty: null, version: existing.version + 1 });
    const tx = {
      financeCounterparty: { findFirst: jest.fn() },
      financeTransaction: {
        findFirst: resolvesTo(existing).mockResolvedValueOnce(existing).mockResolvedValueOnce(updated),
        updateMany: resolvesTo({ count: 1 })
      },
      auditLog: { create: resolvesTo({}) }
    };
    prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
      return (callback as (transaction: typeof tx) => Promise<unknown>)(tx);
    });

    const result = await service.updateTransaction(principal, transactionId, { counterpartyId: null });

    expect(result.counterpartyId).toBeNull();
    expect(tx.financeCounterparty.findFirst).not.toHaveBeenCalled();
    expect(tx.financeTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ counterpartyId: null, version: { increment: 1 } })
    }));
  });

  it('does not move a paid transaction back to pending', async () => {
    const tx = {
      financeTransaction: {
        findFirst: resolvesTo(transactionRow()),
        updateMany: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
      return (callback as (transaction: typeof tx) => Promise<unknown>)(tx);
    });

    await expect(service.updateTransaction(principal, transactionId, { status: FinanceTransactionStatus.PENDING }))
      .rejects.toThrow('Um lançamento pago não pode voltar para pendente');

    expect(tx.financeTransaction.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('creates a compensating entry instead of deleting a paid transaction', async () => {
    const existing = transactionRow({ type: FinanceEntryType.INCOME, category: FinanceCategory.SALES, description: 'Serviço recebido' });
    const reversedAt = new Date('2026-10-05T12:00:00.000Z');
    const updated = transactionRow({ ...existing, status: FinanceTransactionStatus.REVERSED, reversedAt });
    const reversal = transactionRow({
      id: reversalId,
      type: FinanceEntryType.EXPENSE,
      category: FinanceCategory.OTHER,
      description: 'Estorno do lançamento 5d2a9a0e',
      occurredAt: reversedAt,
      reversalOfId: transactionId,
      adjustmentKind: FinanceAdjustmentKind.VOID
    });
    const tx = {
      financeTransaction: {
        findFirst: resolvesTo(updated).mockResolvedValueOnce(existing).mockResolvedValueOnce(updated),
        updateMany: resolvesTo({ count: 1 }),
        create: resolvesTo(reversal)
      },
      auditLog: { create: resolvesTo({}) }
    };
    prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
      return (callback as (transaction: typeof tx) => Promise<unknown>)(tx);
    });

    const result = await service.cancelTransaction(principal, transactionId);

    expect(result).toEqual({ cancelled: true, adjustmentKind: FinanceAdjustmentKind.VOID, reversalId });
    expect(tx.financeTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: transactionId, companyId: principal.companyId }),
      data: expect.objectContaining({ status: FinanceTransactionStatus.REVERSED, reversedAt: new Date('2026-10-05T12:00:00.000Z'), version: { increment: 1 } })
    }));
    expect(tx.financeTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        companyId: principal.companyId,
        createdByUserId: principal.userId,
        type: FinanceEntryType.EXPENSE,
        amount: decimal('1250.50'),
        reversalOfId: transactionId,
        adjustmentKind: FinanceAdjustmentKind.VOID
      })
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'FINANCE_TRANSACTION_VOIDED',
        companyId: principal.companyId,
        metadata: expect.objectContaining({
          before: expect.objectContaining({ status: FinanceTransactionStatus.PAID, reversedAt: null }),
          after: expect.objectContaining({ status: FinanceTransactionStatus.REVERSED, reversedAt: reversedAt.toISOString() }),
          reversalId,
          reversal: expect.objectContaining({ id: reversalId, amount: '1250.50', reversalOfId: transactionId })
        })
      })
    }));
  });

  it('records a full refund as an opposite paid flow while keeping the original paid', async () => {
    const existing = transactionRow({ type: FinanceEntryType.INCOME, category: FinanceCategory.SALES });
    const adjustment = transactionRow({
      id: reversalId,
      type: FinanceEntryType.EXPENSE,
      category: FinanceCategory.OTHER,
      description: 'Devolução do lançamento 5d2a9a0e',
      reversalOfId: transactionId,
      adjustmentKind: FinanceAdjustmentKind.REFUND
    });
    const updated = transactionRow({ version: 2, reversal: { id: reversalId, adjustmentKind: FinanceAdjustmentKind.REFUND } });
    const tx = {
      financeTransaction: {
        findFirst: resolvesTo(updated).mockResolvedValueOnce(existing).mockResolvedValueOnce(updated),
        updateMany: resolvesTo({ count: 1 }),
        create: resolvesTo(adjustment)
      },
      auditLog: { create: resolvesTo({}) }
    };
    prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
      return (callback as (transaction: typeof tx) => Promise<unknown>)(tx);
    });

    const result = await service.refundTransaction(principal, transactionId);

    expect(result).toEqual({ refunded: true, adjustmentId: reversalId });
    expect(tx.financeTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: transactionId, companyId: principal.companyId, status: FinanceTransactionStatus.PAID, reversalOfId: null, version: 1 },
      data: { version: { increment: 1 } }
    });
    expect(tx.financeTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: FinanceEntryType.EXPENSE,
        amount: decimal('1250.50'),
        reversalOfId: transactionId,
        adjustmentKind: FinanceAdjustmentKind.REFUND
      })
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'FINANCE_TRANSACTION_REFUND_RECORDED',
        metadata: expect.objectContaining({
          before: expect.objectContaining({ status: FinanceTransactionStatus.PAID }),
          after: expect.objectContaining({ status: FinanceTransactionStatus.PAID, version: 2 }),
          adjustment: expect.objectContaining({ id: reversalId, adjustmentKind: FinanceAdjustmentKind.REFUND })
        })
      })
    }));
  });

  it('rejects a second adjustment for a paid transaction', async () => {
    const existing = transactionRow({ reversal: { id: reversalId, adjustmentKind: FinanceAdjustmentKind.REFUND } });
    const tx = {
      financeTransaction: { findFirst: resolvesTo(existing), updateMany: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
      return (callback as (transaction: typeof tx) => Promise<unknown>)(tx);
    });

    await expect(service.refundTransaction(principal, transactionId)).rejects.toThrow('A devolução integral só pode ser registrada uma vez');
    expect(tx.financeTransaction.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('cancels a pending transaction without generating a compensating entry', async () => {
    const existing = transactionRow({ status: FinanceTransactionStatus.PENDING });
    const updated = transactionRow({ status: FinanceTransactionStatus.CANCELLED });
    const tx = {
      financeTransaction: {
        findFirst: resolvesTo(updated).mockResolvedValueOnce(existing).mockResolvedValueOnce(updated),
        updateMany: resolvesTo({ count: 1 }),
        create: jest.fn()
      },
      auditLog: { create: resolvesTo({}) }
    };
    prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
      return (callback as (transaction: typeof tx) => Promise<unknown>)(tx);
    });

    const result = await service.cancelTransaction(principal, transactionId);

    expect(result).toEqual({ cancelled: true, adjustmentKind: null, reversalId: null });
    expect(tx.financeTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: FinanceTransactionStatus.CANCELLED, version: { increment: 1 } }
    }));
    expect(tx.financeTransaction.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'FINANCE_TRANSACTION_CANCELLED' })
    }));
  });

  it.each([
    { type: FinanceEntryType.INCOME, category: FinanceCategory.RENT },
    { type: FinanceEntryType.EXPENSE, category: FinanceCategory.SALES }
  ])('rejects a category that does not match the entry type', async ({ type, category }) => {
    await expect(service.createTransaction(principal, {
      type,
      category,
      description: 'Lançamento de teste',
      amount: 100,
      occurredAt: '2026-10-04'
    })).rejects.toThrow('A categoria não corresponde ao tipo de lançamento.');

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
