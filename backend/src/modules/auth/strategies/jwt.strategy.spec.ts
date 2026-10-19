import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompanyRole } from '../../../generated/prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const config = {
    getOrThrow: jest.fn(() => 'a-secret-long-enough-for-tests-123456'),
    get: jest.fn((_key: string, fallback: string) => fallback)
  } as unknown as ConfigService;

  function makeStrategy(membership: unknown) {
    const prisma = {
      companyMembership: { findUnique: jest.fn().mockResolvedValue(membership) }
    } as unknown as PrismaService;
    return { strategy: new JwtStrategy(prisma, config), prisma };
  }

  it('returns the current company role from the database, not from JWT claims', async () => {
    const membership = {
      userId: 'user-1', companyId: 'company-1', role: CompanyRole.ADMIN, isActive: true,
      user: { id: 'user-1', email: 'user@example.com', status: 'ACTIVE' }
    };
    const { strategy, prisma } = makeStrategy(membership);

    await expect(strategy.validate({ sub: 'user-1', companyId: 'company-1' })).resolves.toEqual({
      userId: 'user-1', email: 'user@example.com', companyId: 'company-1', role: CompanyRole.ADMIN
    });
    expect(prisma.companyMembership.findUnique).toHaveBeenCalledWith({
      where: { userId_companyId: { userId: 'user-1', companyId: 'company-1' } },
      include: { user: true }
    });
  });

  it('rejects a missing subject or company claim', async () => {
    const { strategy, prisma } = makeStrategy(null);
    await expect(strategy.validate({ sub: '', companyId: 'company-1' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.companyMembership.findUnique).not.toHaveBeenCalled();
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
