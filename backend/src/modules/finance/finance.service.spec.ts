import { FinanceCategory, FinanceEntryType, Prisma } from '../../generated/prisma/client';
import { AuthPrincipal } from '../../common/auth-principal';
import { PrismaService } from '../../database/prisma.service';
import { FinanceService } from './finance.service';

const principal: AuthPrincipal = {
  userId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10',
  email: 'owner@example.test',
  companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8',
  role: 'OWNER' as AuthPrincipal['role']
};
const decimal = (value: string) => new Prisma.Decimal(value);

describe('FinanceService', () => {
  const prisma = {
    financeTransaction: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn()
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn()
  } as unknown as PrismaService;
  let service: FinanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-05T12:00:00.000Z'));
    service = new FinanceService(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns only company-scoped real aggregates and fills months without transactions with zeroes', async () => {
    jest.mocked(prisma.financeTransaction.groupBy)
      .mockResolvedValueOnce([
        { type: FinanceEntryType.INCOME, _sum: { amount: decimal('1000.00') }, _count: { _all: 2 } },
        { type: FinanceEntryType.EXPENSE, _sum: { amount: decimal('250.00') }, _count: { _all: 1 } }
      ] as never)
      .mockResolvedValueOnce([
        { category: 'TAXES', _sum: { amount: decimal('250.00') } }
      ] as never);
    jest.mocked(prisma.$queryRaw).mockResolvedValue([
      { month: new Date('2026-08-01T00:00:00.000Z'), income: decimal('1000.00'), expense: decimal('250.00') }
    ]);
    jest.mocked(prisma.financeTransaction.findMany).mockResolvedValue([]);

    const result = await service.getDashboard(principal.companyId, 3);
    const [totalsQuery] = jest.mocked(prisma.financeTransaction.groupBy).mock.calls[0] as unknown as [{ where: { companyId: string } }];

    expect(totalsQuery.where.companyId).toBe(principal.companyId);
    expect(result.summary).toEqual({ income: 1000, expense: 250, net: 750, transactionCount: 3 });
    expect(result.monthly).toHaveLength(3);
    expect(result.monthly[0]).toMatchObject({ month: '2026-08', income: 1000, expense: 250 });
    expect(result.monthly[1]).toMatchObject({ month: '2026-09', income: 0, expense: 0 });
    expect(result.expensesByCategory[0]).toMatchObject({ category: 'TAXES', amount: 250, sharePercent: 100 });
  });

  it('lists transactions with company scope, filters, inclusive date range and pagination', async () => {
    const row = {
      id: '5d2a9a0e-339a-470e-9cc0-4624044cae86',
      type: FinanceEntryType.EXPENSE,
      category: FinanceCategory.RENT,
      description: 'Aluguel da sala',
      amount: decimal('1250.50'),
      occurredAt: new Date('2026-09-30T16:00:00.000Z')
    };
    jest.mocked(prisma.financeTransaction.count).mockResolvedValue(21);
    jest.mocked(prisma.financeTransaction.findMany).mockResolvedValue([row] as never);

    const result = await service.listTransactions(principal.companyId, {
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
      description: { contains: 'Aluguel', mode: 'insensitive' },
      occurredAt: { gte: new Date('2026-09-01T00:00:00.000Z'), lt: new Date('2026-10-01T00:00:00.000Z') }
    });

    expect(prisma.financeTransaction.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(prisma.financeTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expectedWhere,
      skip: 10,
      take: 10,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }]
    }));
    expect(result).toMatchObject({ page: 2, limit: 10, total: 21, totalPages: 3 });
    expect(result.items[0].amount).toBe(1250.5);
  });

  it.each([
    { type: FinanceEntryType.INCOME, category: FinanceCategory.RENT, from: '2026-09-01', to: '2026-09-30' },
    { type: FinanceEntryType.EXPENSE, category: FinanceCategory.RENT, from: '2026-10-01', to: '2026-09-30' }
  ])('rejects inconsistent list filters before querying the database', async (filters) => {
    await expect(service.listTransactions(principal.companyId, { page: 1, limit: 20, ...filters })).rejects.toThrow();
    expect(prisma.financeTransaction.count).not.toHaveBeenCalled();
    expect(prisma.financeTransaction.findMany).not.toHaveBeenCalled();
  });

  it('creates a transaction and its audit event in the same database transaction', async () => {
    const entry = {
      id: '5d2a9a0e-339a-470e-9cc0-4624044cae86',
      type: FinanceEntryType.INCOME,
      category: 'SALES',
      description: 'Venda de serviços',
      amount: decimal('125.50'),
      occurredAt: new Date('2026-10-04T00:00:00.000Z')
    };
    const tx = {
      financeTransaction: { create: jest.fn().mockResolvedValue(entry) },
      auditLog: { create: jest.fn().mockResolvedValue({}) }
    };
    jest.mocked(prisma.$transaction).mockImplementation(async (callback: unknown) => {
      return (callback as (transaction: typeof tx) => Promise<unknown>)(tx);
    });

    const result = await service.createTransaction(principal, {
      type: FinanceEntryType.INCOME,
      category: 'SALES',
      description: 'Venda de serviços',
      amount: 125.5,
      occurredAt: '2026-10-04'
    });

    expect(result.amount).toBe(125.5);
    expect(tx.financeTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId: principal.companyId, createdByUserId: principal.userId })
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'FINANCE_TRANSACTION_CREATED', companyId: principal.companyId })
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

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
