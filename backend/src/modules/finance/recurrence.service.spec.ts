import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { CompanyRole, CounterpartyRole, FinanceCategory, FinanceEntryType, FinanceTransactionStatus, RecurrenceFrequency, Prisma } from '../../generated/prisma/client';
import type { AuthPrincipal } from '../../common/auth-principal';
import { RecurrenceService, type RecurrenceInput } from './recurrence.service';
import { setTenantContext } from '../../database/tenant-context';

jest.mock('../../database/tenant-context', () => ({ setTenantContext: jest.fn() }));

const principal: AuthPrincipal = { userId: '11111111-1111-1111-1111-111111111111', email: 'member@example.test', companyId: '22222222-2222-2222-2222-222222222222', role: CompanyRole.MEMBER };
const readonlyPrincipal = { ...principal, role: CompanyRole.READ_ONLY };
const recurrenceId = '33333333-3333-3333-3333-333333333333';
const counterpartyId = '44444444-4444-4444-4444-444444444444';

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: recurrenceId,
    type: FinanceEntryType.INCOME,
    category: FinanceCategory.SALES,
    subcategory: null,
    description: 'Mensalidade',
    amount: new Prisma.Decimal('100.00'),
    counterpartyId: null,
    frequency: RecurrenceFrequency.MONTHLY,
    intervalCount: 1,
    startDate: new Date('2026-01-31T00:00:00.000Z'),
    endDate: null,
    nextRunAt: new Date('2026-01-31T00:00:00.000Z'),
    lastRunAt: null,
    isActive: true,
    version: 1,
    ...overrides
  };
}

type MockFn = {
  mockResolvedValue(value: unknown): MockFn;
  mockImplementation(implementation: (...args: never[]) => unknown): MockFn;
  mock: { calls: unknown[][] };
};
type TxMock = {
  $queryRaw: MockFn;
  financeRecurrence: { count: MockFn; findMany: MockFn; findFirst: MockFn; create: MockFn; updateMany: MockFn };
  financeCounterparty: { findFirst: MockFn };
  financeTransaction: { findFirst: MockFn; create: MockFn };
  auditLog: { create: MockFn };
};

function setup(initial: ReturnType<typeof row> = row()) {
  const tx: TxMock = {
    $queryRaw: jest.fn() as unknown as MockFn,
    financeRecurrence: { count: jest.fn() as unknown as MockFn, findMany: jest.fn() as unknown as MockFn, findFirst: jest.fn() as unknown as MockFn, create: jest.fn() as unknown as MockFn, updateMany: jest.fn() as unknown as MockFn },
    financeCounterparty: { findFirst: (jest.fn() as unknown as MockFn).mockResolvedValue(null) },
    financeTransaction: { findFirst: (jest.fn() as unknown as MockFn).mockResolvedValue(null), create: jest.fn() as unknown as MockFn },
    auditLog: { create: (jest.fn() as unknown as MockFn).mockResolvedValue({}) }
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: TxMock) => unknown) => callback(tx)),
    tx
  } as unknown as { $transaction: jest.Mock; tx: TxMock };
  tx.financeRecurrence.create.mockResolvedValue(initial);
  tx.financeRecurrence.findFirst.mockResolvedValue(initial);
  tx.financeRecurrence.updateMany.mockResolvedValue({ count: 1 });
  tx.financeRecurrence.findMany.mockResolvedValue([initial]);
  tx.financeRecurrence.count.mockResolvedValue(1);
  tx.financeTransaction.create.mockImplementation(async () => ({ id: `transaction-${tx.financeTransaction.create.mock.calls.length}` }));
  return { tx, prisma, service: new RecurrenceService(prisma as never) };
}

const input: RecurrenceInput = {
  type: FinanceEntryType.INCOME,
  category: FinanceCategory.SALES,
  description: 'Mensalidade',
  amount: 100,
  frequency: RecurrenceFrequency.MONTHLY,
  intervalCount: 1,
  startDate: '2026-01-31T00:00:00.000Z'
};

describe('RecurrenceService', () => {
  it('rejects READ_ONLY before opening a transaction', async () => {
    const { service, prisma } = setup();
    await expect(service.create(readonlyPrincipal, input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('validates category, amount scale, end date and counterparty company/role', async () => {
    const category = setup();
    await expect(serviceCall(category.service, category.prisma, 'create', principal, { ...input, category: FinanceCategory.RENT })).rejects.toBeInstanceOf(BadRequestException);
    const scale = setup();
    await expect(scale.service.create(principal, { ...input, amount: '10.123' })).rejects.toBeInstanceOf(BadRequestException);
    const dates = setup();
    await expect(dates.service.create(principal, { ...input, endDate: '2025-12-31T00:00:00.000Z' })).rejects.toBeInstanceOf(BadRequestException);
    const otherCompany = setup();
    otherCompany.tx.financeCounterparty.findFirst.mockResolvedValue(null);
    await expect(otherCompany.service.create(principal, { ...input, counterpartyId })).rejects.toBeInstanceOf(BadRequestException);
    expect(otherCompany.tx.financeCounterparty.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: counterpartyId, companyId: principal.companyId } }));
  });

  it('creates nextRunAt at start and audits in the same transaction', async () => {
    const { service, prisma, tx } = setup();
    const result = await service.create(principal, input);
    expect(result.nextRunAt).toBe(input.startDate);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(setTenantContext).toHaveBeenCalledWith(tx, principal);
    expect(tx.financeRecurrence.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ companyId: principal.companyId, createdByUserId: principal.userId, nextRunAt: new Date(input.startDate) }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'FINANCE_RECURRENCE_CREATED', companyId: principal.companyId }) }));
  });

  it('uses company and version in optimistic update and raises conflict', async () => {
    const { service, tx } = setup();
    tx.financeRecurrence.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update(principal, recurrenceId, { version: 1, description: 'Novo' })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.financeRecurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: recurrenceId, companyId: principal.companyId, version: 1 } }));
  });

  it('clamps day 31 to February without overflowing into March and is idempotent', async () => {
    const { service, tx } = setup(row());
    const first = await service.runDue(principal, new Date('2026-02-28T00:00:00.000Z'));
    expect(first.generated).toBe(2);
    expect(tx.financeTransaction.create.mock.calls.map((call: unknown[]) => (call[0] as { data: { occurredAt: Date } }).data.occurredAt.toISOString())).toEqual(['2026-01-31T00:00:00.000Z', '2026-02-28T00:00:00.000Z']);
    const state = row({ nextRunAt: new Date('2026-03-31T00:00:00.000Z'), lastRunAt: new Date('2026-02-28T00:00:00.000Z') });
    tx.financeRecurrence.findMany.mockResolvedValue([state]);
    tx.financeTransaction.findFirst.mockResolvedValue({ id: 'existing' });
    const second = await service.runDue(principal, new Date('2026-02-28T00:00:00.000Z'));
    expect(second.generated).toBe(0);
    expect(second.skipped).toBe(0);
    expect(tx.financeTransaction.create.mock.calls).toHaveLength(2);
  });
});

async function serviceCall(service: RecurrenceService, _prisma: unknown, method: 'create', ...args: [AuthPrincipal, RecurrenceInput]) {
  return service[method](...args);
}
