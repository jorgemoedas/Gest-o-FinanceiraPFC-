import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AuthPrincipal } from '../../common/auth-principal';
import { setTenantContext } from '../../database/tenant-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

jest.mock('../../database/tenant-context', () => ({
  setTenantContext: jest.fn(async (_tx: unknown, _principal: unknown) => undefined)
}));

const principal: AuthPrincipal = {
  userId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10',
  email: 'admin@example.test',
  companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8',
  role: 'ADMIN' as AuthPrincipal['role']
};

const auditLog = {
  findMany: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  count: jest.fn<(...args: unknown[]) => Promise<number>>()
};
const globalAuditLog = {
  findMany: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  count: jest.fn<(...args: unknown[]) => Promise<number>>()
};
const tx = { auditLog };
const prismaMock = {
  auditLog: globalAuditLog,
  $transaction: jest.fn<(...args: unknown[]) => Promise<unknown>>()
};
const prisma = prismaMock as unknown as PrismaService;
let service: AuditService;

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (callback: unknown) =>
    (callback as (transaction: typeof tx) => Promise<unknown>)(tx)
  );
  service = new AuditService(prisma);
  auditLog.findMany.mockResolvedValue([]);
  auditLog.count.mockResolvedValue(0);
});

describe('AuditService', () => {
  it('limits results to the principal company and applies page/action/date filters', async () => {
    const query = Object.assign(new AuditQueryDto(), {
      page: 2,
      limit: 10,
      action: 'AUTH',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T23:59:59.999Z'
    });

    const result = await service.list(principal, query);
    const [args] = auditLog.findMany.mock.calls[0] as unknown as [{ skip: number; take: number; where: Record<string, unknown> }];
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(args.where.companyId).toBe(principal.companyId);
    expect(args.where.action).toEqual({ contains: 'AUTH', mode: 'insensitive' });
    expect(result).toEqual({ items: [], page: 2, limit: 10, total: 0, pages: 0 });
    expect(setTenantContext).toHaveBeenCalledWith(tx, principal);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(globalAuditLog.findMany).not.toHaveBeenCalled();
    expect(globalAuditLog.count).not.toHaveBeenCalled();
  });

  it('rejects an inverted date range before querying the database', async () => {
    const query = Object.assign(new AuditQueryDto(), {
      page: 1,
      limit: 20,
      from: '2026-10-31T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z'
    });
    await expect(service.list(principal, query)).rejects.toBeInstanceOf(BadRequestException);
    expect(auditLog.findMany).not.toHaveBeenCalled();
    expect(globalAuditLog.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
