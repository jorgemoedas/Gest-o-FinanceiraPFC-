import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { FinanceCategory, FinanceEntryType, FinanceTransactionStatus, Prisma } from '../../generated/prisma/client';
import type { AuthPrincipal } from '../../common/auth-principal';
import { BulkTransactionService } from './bulk-transaction.service';
import { setTenantContext } from '../../database/tenant-context';

jest.mock('../../database/tenant-context', () => ({ setTenantContext: jest.fn(async () => undefined) }));

const principal: AuthPrincipal = {
  userId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10',
  email: 'admin@example.test',
  companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8',
  role: 'ADMIN' as AuthPrincipal['role']
};
const id = 'f47ac10b-58cc-11cf-a447-001122334455';
const otherId = 'f47ac10b-58cc-11cf-a447-001122334456';
const row = (overrides: Record<string, unknown> = {}) => ({
  id,
  type: FinanceEntryType.EXPENSE,
  category: FinanceCategory.RENT,
  subcategory: null,
  counterpartyId: null,
  counterparty: null,
  description: 'Aluguel',
  amount: new Prisma.Decimal('100.00'),
  occurredAt: new Date('2026-10-01T00:00:00.000Z'),
  dueAt: new Date('2026-10-10T00:00:00.000Z'),
  status: FinanceTransactionStatus.PAID,
  reversalOfId: null,
  adjustmentKind: null,
  reversedAt: null,
  version: 2,
  reversal: null,
  ...overrides
});

describe('BulkTransactionService', () => {
  const transaction = {
    findMany: jest.fn<(...args: any[]) => Promise<any>>(),
    findFirst: jest.fn<(...args: any[]) => Promise<any>>(),
    updateMany: jest.fn<(...args: any[]) => Promise<any>>()
  };
  const auditLog = { create: jest.fn<(...args: any[]) => Promise<any>>() };
  const tx = { financeTransaction: transaction, auditLog, $queryRaw: jest.fn() };
  const prisma = { $transaction: jest.fn<(...args: any[]) => Promise<any>>() };
  let service: BulkTransactionService;

  beforeEach(() => {
    jest.clearAllMocks();
    transaction.findMany.mockResolvedValue([row()]);
    transaction.findFirst.mockResolvedValue(row({ category: FinanceCategory.OTHER, version: 3 }));
    transaction.updateMany.mockResolvedValue({ count: 1 });
    auditLog.create.mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (callback: unknown) => (callback as (value: typeof tx) => Promise<unknown>)(tx));
    service = new BulkTransactionService(prisma as never);
  });

  it('sets tenant context on the transaction and updates with an optimistic version guard', async () => {
    const result = await service.updateMany(principal, { items: [{ id, version: 2 }], changes: { category: FinanceCategory.OTHER } });
    expect(setTenantContext).toHaveBeenCalledWith(tx, principal);
    expect(transaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ companyId: principal.companyId, version: 2 }) }));
    expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entityId: id, metadata: expect.objectContaining({ before: expect.any(Object), after: expect.any(Object) }) }) }));
    expect(result.items[0]).toEqual(expect.objectContaining({ id, version: 3, category: FinanceCategory.OTHER }));
  });

  it('rejects a missing tenant before opening a database transaction', async () => {
    await expect(service.updateMany({ ...principal, companyId: '' }, { items: [{ id, version: 2 }], changes: { category: FinanceCategory.OTHER } })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects stale and future versions before any write or audit snapshot', async () => {
    for (const version of [1, 3]) {
      await expect(service.updateMany(principal, { items: [{ id, version }], changes: { category: FinanceCategory.OTHER } })).rejects.toBeInstanceOf(ConflictException);
    }
    expect(transaction.updateMany).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate, over-limit and empty-change requests', async () => {
    await expect(service.updateMany(principal, { items: [{ id, version: 2 }, { id, version: 2 }], changes: { category: FinanceCategory.OTHER } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateMany(principal, { items: Array.from({ length: 101 }, () => ({ id: otherId, version: 1 })), changes: { category: FinanceCategory.OTHER } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateMany(principal, { items: [{ id, version: 2 }], changes: {} })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid category, paid-to-pending, adjusted rows and no-ops', async () => {
    await expect(service.updateMany(principal, { items: [{ id, version: 2 }], changes: { category: FinanceCategory.SALES } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateMany(principal, { items: [{ id, version: 2 }], changes: { status: FinanceTransactionStatus.PENDING } })).rejects.toBeInstanceOf(BadRequestException);
    transaction.findMany.mockResolvedValueOnce([row({ adjustmentKind: 'VOID' })]);
    await expect(service.updateMany(principal, { items: [{ id, version: 2 }], changes: { category: FinanceCategory.OTHER } })).rejects.toBeInstanceOf(BadRequestException);
    transaction.findMany.mockResolvedValueOnce([row({ category: FinanceCategory.OTHER })]);
    await expect(service.updateMany(principal, { items: [{ id, version: 2 }], changes: { category: FinanceCategory.OTHER } })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing rows and rolls the transaction back on a version conflict', async () => {
    transaction.findMany.mockResolvedValueOnce([]);
    await expect(service.updateMany(principal, { items: [{ id, version: 2 }], changes: { category: FinanceCategory.OTHER } })).rejects.toBeInstanceOf(NotFoundException);
    transaction.findMany.mockResolvedValueOnce([row(), row({ id: otherId })]);
    transaction.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.updateMany(principal, { items: [{ id, version: 2 }, { id: otherId, version: 2 }], changes: { category: FinanceCategory.OTHER } })).rejects.toBeInstanceOf(ConflictException);
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('propagates a later conflict from the transaction callback after an earlier guarded item', async () => {
    transaction.findMany.mockResolvedValueOnce([row(), row({ id: otherId })]);
    transaction.findFirst.mockResolvedValueOnce(row({ category: FinanceCategory.OTHER, version: 3 }));
    transaction.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(service.updateMany(principal, {
      items: [{ id, version: 2 }, { id: otherId, version: 2 }],
      changes: { category: FinanceCategory.OTHER }
    })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

  });
});
