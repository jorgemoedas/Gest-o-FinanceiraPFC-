import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { CompanyRole } from '../../generated/prisma/client';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from './auth.service';

const validRegistration = {
  email: '  Demo@Example.com ',
  password: 'A-strong-password-123',
  companyName: 'Empresa Demo',
  acceptedTerms: true,
  acceptedPrivacy: true,
  termsVersion: '2026-10-01',
  privacyVersion: '2026-10-01'
};

function makeHarness() {
  const user = { id: 'user-1', email: 'demo@example.com' };
  const company = { id: 'company-1', name: 'Empresa Demo' };
  const membership = { userId: user.id, companyId: company.id, role: CompanyRole.OWNER };
  const lookup: { authUser: any; membership: any; refreshOutcome: any; revokeOutcome: any } = { authUser: null, membership: null, refreshOutcome: null, revokeOutcome: null };
  const tx = {
    user: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ ...user, ...data })),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...user, ...data }))
    },
    company: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ ...company, ...data })) },
    companyMembership: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ ...membership, ...data })) },
    termAcceptance: { create: jest.fn().mockResolvedValue({ id: 'acceptance-1' }) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn(async (strings: unknown) => {
      const sql = Array.isArray(strings) ? (strings as string[]).join(' ') : String(strings);
      if (sql.includes('auth_user_by_email')) return lookup.authUser ? [lookup.authUser] : [];
      if (sql.includes('auth_active_membership')) return lookup.membership ? [lookup.membership] : [];
      if (sql.includes('auth_consume_refresh_token')) return lookup.refreshOutcome ? [lookup.refreshOutcome] : [];
      if (sql.includes('auth_revoke_refresh_family')) return lookup.revokeOutcome ? [lookup.revokeOutcome] : [];
      return [{ company_id: 'company-1', user_id: 'user-1' }];
    })
  };
  const prismaMock = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({})
    },
    auditLog: { create: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn(async (operation: unknown) => {
      if (typeof operation === 'function') return operation(tx);
      return Promise.all(operation as Promise<unknown>[]);
    })
  };
  const configMock = {
    get: jest.fn((key: string, fallback?: string) => {
      const values: Record<string, string> = {
        BCRYPT_COST: '4',
        JWT_ACCESS_TTL_SECONDS: '900'
      };
      return values[key] ?? fallback;
    }),
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        TERMS_VERSION: '2026-10-01',
        PRIVACY_POLICY_VERSION: '2026-10-01'
      };
      return values[key];
    })
  };
  const jwtMock = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
  const service = new AuthService(
    prismaMock as unknown as PrismaService,
    jwtMock as unknown as JwtService,
    configMock as unknown as ConfigService
  );

  return { service, prismaMock, configMock, jwtMock, tx, user, company, membership, lookup };
}

describe('AuthService', () => {
  it('registers with bcrypt hash, creates company, acceptance, audit and a JWT', async () => {
    const { service, tx, jwtMock } = makeHarness();

    const result = await service.register(validRegistration);

    const lookupSql = (tx.$queryRaw as jest.Mock).mock.calls.map((call) => String(call[0]));
    expect(lookupSql.some((sql) => sql.includes('auth_user_by_email'))).toBe(true);
    const createdUser = tx.user.create.mock.calls[0][0].data;
    expect(createdUser.email).toBe('demo@example.com');
    expect(createdUser.passwordHash).not.toBe(validRegistration.password);
    expect(await bcrypt.compare(validRegistration.password, createdUser.passwordHash)).toBe(true);
    expect(tx.termAcceptance.create.mock.calls[0][0].data).toMatchObject({
      termsVersion: '2026-10-01',
      privacyVersion: '2026-10-01'
    });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      actorUserId: createdUser.id,
      action: 'AUTH_REGISTERED'
    });
    expect(result).toMatchObject({
      accessToken: 'signed.jwt.token',
      tokenType: 'Bearer',
      expiresInSeconds: 900,
      user: { email: 'demo@example.com', companyName: 'Empresa Demo', role: CompanyRole.OWNER }
    });
    expect(jwtMock.signAsync).toHaveBeenCalledWith({
      sub: createdUser.id,
      companyId: tx.company.create.mock.calls[0][0].data.id
    });
  });

  it('rejects a registration that did not accept both documents', async () => {
    const { service, prismaMock } = makeHarness();
    await expect(service.register({ ...validRegistration, acceptedPrivacy: false })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects document versions that are no longer current', async () => {
    const { service, prismaMock } = makeHarness();
    await expect(service.register({ ...validRegistration, termsVersion: 'old-version' })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects passwords exceeding bcrypt input capacity', async () => {
    const { service } = makeHarness();
    await expect(
      service.register({ ...validRegistration, password: 'á'.repeat(40) })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an already-registered email', async () => {
    const { service, prismaMock, lookup } = makeHarness();
    lookup.authUser = { id: 'existing-user', email: 'demo@example.com', passwordHash: 'x', status: 'ACTIVE' };
    await expect(service.register(validRegistration)).rejects.toBeInstanceOf(ConflictException);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('authenticates an active user and records the successful login', async () => {
    const { service, tx, jwtMock, lookup } = makeHarness();
    const hash = await bcrypt.hash('A-strong-password-123', 4);
    lookup.authUser = { id: 'user-1', email: 'demo@example.com', passwordHash: hash, status: 'ACTIVE' };
    lookup.membership = { companyId: 'company-1', role: CompanyRole.OWNER, companyName: 'Empresa Demo' };

    const result = await service.login({ email: 'DEMO@example.com', password: 'A-strong-password-123' });

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { lastLoginAt: expect.any(Date) }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'AUTH_LOGIN_SUCCEEDED', actorUserId: 'user-1' })
    }));
    expect(jwtMock.signAsync).toHaveBeenCalledWith({ sub: 'user-1', companyId: 'company-1' });
  });


  it('rotates an active refresh token and issues another opaque token', async () => {
    const { service, lookup, tx, jwtMock } = makeHarness();
    lookup.refreshOutcome = { result_status: 'ACTIVE', user_id: 'user-1', company_id: 'company-1', family_id: 'family-1', email: 'demo@example.com', role: CompanyRole.OWNER, company_name: 'Empresa Demo' };
    const result = await service.refresh('opaque-old-token');
    expect(result.refreshToken).toBeTruthy();
    expect(result.refreshToken).not.toBe('opaque-old-token');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'AUTH_REFRESH_ROTATED' }) }));
    expect(jwtMock.signAsync).toHaveBeenCalledWith({ sub: 'user-1', companyId: 'company-1' });
  });

  it('audits reuse after the database function revokes the token family', async () => {
    const { service, lookup, tx } = makeHarness();
    lookup.refreshOutcome = { result_status: 'REUSED', user_id: 'user-1', company_id: 'company-1', family_id: 'family-1' };
    await expect(service.refresh('already-used-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'AUTH_REFRESH_REUSE_DETECTED', metadata: expect.objectContaining({ familyId: 'family-1' }) }) }));
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects an expired refresh token', async () => {
    const { service, lookup, tx } = makeHarness();
    lookup.refreshOutcome = { result_status: 'EXPIRED', user_id: 'user-1', company_id: 'company-1', family_id: 'family-1' };
    await expect(service.refresh('expired-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects renewal when the company membership is inactive', async () => {
    const { service, lookup, tx } = makeHarness();
    lookup.refreshOutcome = { result_status: 'INACTIVE', user_id: 'user-1', company_id: 'company-1', family_id: 'family-1' };
    await expect(service.refresh('inactive-link-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('returns the same unauthorized response for an invalid password and audits without storing the email', async () => {
    const { service, prismaMock, lookup } = makeHarness();
    const hash = await bcrypt.hash('another-password', 4);
    lookup.authUser = { id: 'user-1', email: 'demo@example.com', passwordHash: hash, status: 'ACTIVE' };
    lookup.membership = { companyId: 'company-1', role: CompanyRole.OWNER, companyName: 'Empresa Demo' };

    await expect(service.login({ email: 'demo@example.com', password: 'wrong-password' })).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    const auditInput = prismaMock.auditLog.createMany.mock.calls[0][0].data;
    expect(auditInput.action).toBe('AUTH_LOGIN_FAILED');
    expect(JSON.stringify(auditInput)).not.toContain('demo@example.com');
  });

  it('rejects login input exceeding bcrypt byte capacity before querying or comparing credentials', async () => {
    const { service, prismaMock, tx } = makeHarness();

    await expect(service.login({ email: 'demo@example.com', password: 'á'.repeat(40) })).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'AUTH_LOGIN_FAILED' })
    }));
  });
});
