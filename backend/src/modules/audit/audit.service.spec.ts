import { BadRequestException } from '@nestjs/common';
import { AuthPrincipal } from '../../common/auth-principal';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

const principal: AuthPrincipal = {
  userId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10',
  email: 'admin@example.test',
  companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8',
  role: 'ADMIN' as AuthPrincipal['role']
};

describe('AuditService', () => {
  const prisma = {
    auditLog: {
      findMany: jest.fn(),
      count: jest.fn()
    }
  } as unknown as PrismaService;
  let service: AuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditService(prisma);
    jest.mocked(prisma.auditLog.findMany).mockResolvedValue([]);
    jest.mocked(prisma.auditLog.count).mockResolvedValue(0);
  });

  it('limits results to the principal company and applies page/action/date filters', async () => {
    const query = Object.assign(new AuditQueryDto(), {
      page: 2,
      limit: 10,
      action: 'AUTH',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T23:59:59.999Z'
    });

    const result = await service.list(principal, query);
    const [args] = jest.mocked(prisma.auditLog.findMany).mock.calls[0] as unknown as [{ skip: number; take: number; where: Record<string, unknown> }];
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(args.where.companyId).toBe(principal.companyId);
    expect(args.where.action).toEqual({ contains: 'AUTH', mode: 'insensitive' });
    expect(result).toEqual({ items: [], page: 2, limit: 10, total: 0, pages: 0 });
  });

  it('rejects an inverted date range before querying the database', async () => {
    const query = Object.assign(new AuditQueryDto(), {
      page: 1,
      limit: 20,
      from: '2026-10-31T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z'
    });
    await expect(service.list(principal, query)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});
