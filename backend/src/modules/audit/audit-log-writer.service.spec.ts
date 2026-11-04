import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PrismaService } from '../../database/prisma.service';
import { setTenantContext } from '../../database/tenant-context';
import { AuditLogWriter } from './audit-log-writer.service';

jest.mock('../../database/tenant-context', () => ({
  setTenantContext: jest.fn(async (_tx: unknown, _principal: unknown) => undefined)
}));

const tx = { auditLog: { create: jest.fn<(...args: unknown[]) => Promise<unknown>>() } };
const prismaMock = { $transaction: jest.fn<(...args: unknown[]) => Promise<unknown>>() };
const prisma = prismaMock as unknown as PrismaService;
const writer = new AuditLogWriter(prisma);
const input = {
  action: 'BUSINESS_REGISTRY_LOOKUP_SUCCEEDED',
  actorUserId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10',
  companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8',
  entityType: 'CompanyProfile',
  entityId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8'
};

beforeEach(() => {
  jest.clearAllMocks();
  tx.auditLog.create.mockResolvedValue({});
  prismaMock.$transaction.mockImplementation(async (callback: unknown) =>
    (callback as (transaction: typeof tx) => Promise<unknown>)(tx)
  );
});

describe('AuditLogWriter', () => {
  it('sets tenant context and writes through the transaction client', async () => {
    await writer.write(input);

    expect(setTenantContext).toHaveBeenCalledWith(tx, {
      userId: input.actorUserId,
      companyId: input.companyId
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: input.action,
        actorUserId: input.actorUserId,
        companyId: input.companyId,
        entityType: input.entityType,
        entityId: input.entityId,
        requestId: undefined,
        metadata: undefined
      }
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(jest.mocked(setTenantContext).mock.invocationCallOrder[0]).toBeLessThan(tx.auditLog.create.mock.invocationCallOrder[0]);
  });

  it('propagates an audit write failure', async () => {
    tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));

    await expect(writer.write(input)).rejects.toThrow('audit unavailable');
  });
});
