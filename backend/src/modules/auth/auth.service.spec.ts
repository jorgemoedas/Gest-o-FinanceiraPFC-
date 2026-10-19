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
  const tx = {
    user: { create: jest.fn().mockResolvedValue(user) },
    company: { create: jest.fn().mockResolvedValue(company) },
    companyMembership: { create: jest.fn().mockResolvedValue(membership) },
    termAcceptance: { create: jest.fn().mockResolvedValue({ id: 'acceptance-1' }) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) }
  };
  const prismaMock = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({})
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
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

  return { service, prismaMock, configMock, jwtMock, tx, user, company, membership };
}

describe('AuthService', () => {
  it('registers with bcrypt hash, creates company, acceptance, audit and a JWT', async () => {
    const { service, prismaMock, tx, jwtMock } = makeHarness();

    const result = await service.register(validRegistration);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: 'demo@example.com' } });
    const createdUser = tx.user.create.mock.calls[0][0].data;
    expect(createdUser.email).toBe('demo@example.com');
    expect(createdUser.passwordHash).not.toBe(validRegistration.password);
    expect(await bcrypt.compare(validRegistration.password, createdUser.passwordHash)).toBe(true);
    expect(tx.termAcceptance.create.mock.calls[0][0].data).toMatchObject({
      termsVersion: '2026-10-01',
      privacyVersion: '2026-10-01'
    });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      actorUserId: 'user-1',
      action: 'AUTH_REGISTERED'
    });
    expect(result).toMatchObject({
      accessToken: 'signed.jwt.token',
      tokenType: 'Bearer',
      expiresInSeconds: 900,
      user: { email: 'demo@example.com', companyName: 'Empresa Demo', role: CompanyRole.OWNER }
    });
    expect(jwtMock.signAsync).toHaveBeenCalledWith({ sub: 'user-1', companyId: 'company-1' });
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
    const { service, prismaMock } = makeHarness();
    prismaMock.user.findUnique.mockResolvedValue({ id: 'existing-user' });
    await expect(service.register(validRegistration)).rejects.toBeInstanceOf(ConflictException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('authenticates an active user and records the successful login', async () => {
    const { service, prismaMock, jwtMock } = makeHarness();
    const hash = await bcrypt.hash('A-strong-password-123', 4);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'demo@example.com',
      passwordHash: hash,
      status: 'ACTIVE',
      memberships: [{
        userId: 'user-1', companyId: 'company-1', role: CompanyRole.OWNER,
        company: { id: 'company-1', name: 'Empresa Demo' }
      }]
    });

    const result = await service.login({ email: 'DEMO@example.com', password: 'A-strong-password-123' });

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { lastLoginAt: expect.any(Date) }
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'AUTH_LOGIN_SUCCEEDED', actorUserId: 'user-1' })
    }));
    expect(jwtMock.signAsync).toHaveBeenCalledWith({ sub: 'user-1', companyId: 'company-1' });
  });

  it('returns the same unauthorized response for an invalid password and audits without storing the email', async () => {
    const { service, prismaMock } = makeHarness();
    const hash = await bcrypt.hash('another-password', 4);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'demo@example.com', passwordHash: hash, status: 'ACTIVE', memberships: []
    });

    await expect(service.login({ email: 'demo@example.com', password: 'wrong-password' })).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    const auditInput = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(auditInput.action).toBe('AUTH_LOGIN_FAILED');
    expect(JSON.stringify(auditInput)).not.toContain('demo@example.com');
  });

  it('rejects login input exceeding bcrypt byte capacity before querying or comparing credentials', async () => {
    const { service, prismaMock } = makeHarness();

    await expect(service.login({ email: 'demo@example.com', password: 'á'.repeat(40) })).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'AUTH_LOGIN_FAILED' })
    }));
  });
});
