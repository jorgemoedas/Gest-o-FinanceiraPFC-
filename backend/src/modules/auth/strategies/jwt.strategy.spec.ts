import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, jest } from '@jest/globals';
import { CompanyRole } from '../../../generated/prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const config = {
    getOrThrow: jest.fn(() => 'a-secret-long-enough-for-tests-123456'),
    get: jest.fn((_key: string, fallback: string) => fallback)
  } as unknown as ConfigService;

  function makeStrategy(membership: unknown) {
    const queryRaw = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
    const findUnique = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(membership);
    const tx = {
      $executeRawUnsafe: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(0),
      $queryRaw: queryRaw,
      companyMembership: { findUnique }
    };
    const $transaction = jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
    const prisma = { $transaction } as unknown as PrismaService;
    return { strategy: new JwtStrategy(prisma, config), prisma, queryRaw, findUnique };
  }

  it('sets tenant context from signed claims and returns the current company role from the database', async () => {
    const membership = {
      userId: 'user-1', companyId: 'company-1', role: CompanyRole.ADMIN, isActive: true,
      user: { id: 'user-1', email: 'user@example.com', status: 'ACTIVE' }
    };
    const { strategy, prisma, queryRaw, findUnique } = makeStrategy(membership);

    await expect(strategy.validate({ sub: 'user-1', companyId: 'company-1' })).resolves.toEqual({
      userId: 'user-1', email: 'user@example.com', companyId: 'company-1', role: CompanyRole.ADMIN
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId_companyId: { userId: 'user-1', companyId: 'company-1' } },
      include: { user: true }
    });
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(findUnique.mock.invocationCallOrder[0]);
    const [sql, companyId, userId] = queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, string, string];
    expect(sql.join('')).toContain("set_config('gft.company_id'");
    expect(sql.join('')).toContain("set_config('gft.user_id'");
    expect([companyId, userId]).toEqual(['company-1', 'user-1']);
  });

  it('rejects a missing subject or company claim before querying the database', async () => {
    const { strategy, prisma, findUnique } = makeStrategy(null);
    await expect(strategy.validate({ sub: '', companyId: 'company-1' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a revoked membership', async () => {
    const { strategy } = makeStrategy(null);
    await expect(strategy.validate({ sub: 'user-1', companyId: 'company-1' })).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it('rejects a suspended user even when the membership is active', async () => {
    const { strategy } = makeStrategy({
      userId: 'user-1', companyId: 'company-1', role: CompanyRole.OWNER, isActive: true,
      user: { id: 'user-1', email: 'user@example.com', status: 'SUSPENDED' }
    });
    await expect(strategy.validate({ sub: 'user-1', companyId: 'company-1' })).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });
});
