import { BadRequestException, ConflictException } from '@nestjs/common';
import { CompanyRole, UserStatus } from '../../generated/prisma/client';
import { PrivacyService, deterministicAnonymization } from './privacy.service';

const principal = { userId: 'user-1', email: 'pessoa@empresa.test', companyId: 'company-1', role: CompanyRole.MEMBER };

function makeTx(ownerCount = 2) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: principal.userId, email: principal.email }),
      update: jest.fn().mockResolvedValue({ id: principal.userId, email: deterministicAnonymization(principal.userId).email, status: UserStatus.SUSPENDED })
    },
    company: { findUnique: jest.fn().mockResolvedValue({ id: principal.companyId, name: 'Empresa Demo' }) },
    companyMembership: {
      findMany: jest.fn().mockResolvedValue([{ userId: principal.userId, companyId: principal.companyId, role: CompanyRole.MEMBER, isActive: true, createdAt: new Date() }]),
      count: jest.fn().mockResolvedValue(ownerCount),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    termAcceptance: { findMany: jest.fn().mockResolvedValue([]) },
    financeTransaction: { findMany: jest.fn().mockResolvedValue([{ id: 'tx-1', companyId: principal.companyId, createdByUserId: principal.userId, description: 'Lançamento' }]) },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([{ id: 'audit-1', actorUserId: principal.userId, companyId: principal.companyId, action: 'AUTH_LOGIN_SUCCEEDED', metadata: null }]),
      create: jest.fn().mockResolvedValue({ id: 'audit-2' })
    },
    passwordResetToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }
  };
}

function makePrisma(tx: any) {
  return { $transaction: jest.fn().mockImplementation(async (callback: (value: any) => unknown) => callback(tx)) } as any;
}

describe('PrivacyService', () => {
  it('exporta somente dados do titular, sem passwordHash, e audita na mesma transação', async () => {
    const tx = makeTx();
    const result = await new PrivacyService(makePrisma(tx)).exportData(principal);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result.subject).toEqual({ userId: principal.userId, email: principal.email });
    expect(result.authoredTransactions).toEqual(expect.any(Array));
    expect(JSON.stringify(result)).not.toContain('passwordHash');
    expect(tx.financeTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: principal.companyId, createdByUserId: principal.userId } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PRIVACY_DATA_EXPORTED', companyId: principal.companyId }) }));
  });

  it('recusa confirmação incorreta sem alterar os dados', async () => {
    const tx = makeTx();
    await expect(new PrivacyService(makePrisma(tx)).eraseData(principal, { confirmation: 'apagar' })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('anonimiza, suspende, remove vínculo, invalida reset e preserva lançamentos/auditoria', async () => {
    const tx = makeTx();
    const result = await new PrivacyService(makePrisma(tx)).eraseData(principal, { confirmation: 'ELIMINAR MEUS DADOS' });
    expect(result.erased).toBe(true);
    expect(result.retained.join(' ')).toContain('Lançamentos financeiros');
    expect(result.retained.join(' ')).toContain('auditoria');
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: principal.userId }, data: { email: deterministicAnonymization(principal.userId).email, status: UserStatus.SUSPENDED } }));
    expect(tx.financeTransaction.findMany).not.toHaveBeenCalled();
    expect(tx.companyMembership.deleteMany).toHaveBeenCalledWith({ where: { userId: principal.userId, companyId: principal.companyId } });
    expect(tx.passwordResetToken.updateMany).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PRIVACY_DATA_ERASED' }) }));
  });

  it('recusa quando o titular é o único OWNER ativo', async () => {
    const tx = makeTx(1);
    const ownerPrincipal = { ...principal, role: CompanyRole.OWNER };
    await expect(new PrivacyService(makePrisma(tx)).eraseData(ownerPrincipal, { confirmation: 'ELIMINAR MEUS DADOS' })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('exporta empresa, consentimentos versionados com data e somente eventos do próprio titular', async () => {
    const tx = makeTx();
    const acceptedAt = new Date('2026-10-01T12:00:00.000Z');
    tx.company = {
      findUnique: jest.fn().mockResolvedValue({ id: principal.companyId, name: 'Empresa Demo' })
    };
    tx.termAcceptance.findMany.mockResolvedValue([
      {
        id: 'acceptance-1',
        userId: principal.userId,
        companyId: principal.companyId,
        termsVersion: '2026-10-01',
        privacyVersion: '2026-10-01',
        acceptedAt
      }
    ]);
    tx.auditLog.findMany.mockResolvedValue([
      {
        id: 'audit-owned',
        actorUserId: principal.userId,
        companyId: principal.companyId,
        action: 'AUTH_LOGIN_SUCCEEDED',
        metadata: null
      }
    ]);

    const result = await new PrivacyService(makePrisma(tx)).exportData(principal);

    expect(result).toMatchObject({
      subject: { userId: principal.userId, email: principal.email },
      company: { id: principal.companyId, name: 'Empresa Demo' },
      acceptances: [{ termsVersion: '2026-10-01', privacyVersion: '2026-10-01', acceptedAt }],
      auditEvents: [{ id: 'audit-owned', actorUserId: principal.userId }]
    });
    expect(JSON.stringify(result)).not.toContain('passwordHash');
    expect(tx.company.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: principal.companyId } }));
    expect(tx.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { actorUserId: principal.userId, companyId: principal.companyId }
    }));
  });

  it('anonimiza e-mail e marcador de nome de forma determinística e sem caminho de reversão', async () => {
    const firstTx = makeTx();
    const secondTx = makeTx();
    const first = await new PrivacyService(makePrisma(firstTx)).eraseData(principal, { confirmation: 'ELIMINAR MEUS DADOS' });
    const second = await new PrivacyService(makePrisma(secondTx)).eraseData(principal, { confirmation: 'ELIMINAR MEUS DADOS' });

    expect(first.anonymized).toEqual(second.anonymized);
    expect(first.anonymized.email).toBe(deterministicAnonymization(principal.userId).email);
    expect(first.anonymized.name).toBe(deterministicAnonymization(principal.userId).name);
    expect(first.anonymized.email).not.toContain(principal.email);
    expect(first.anonymized.namePersisted).toBe(false);
    expect(first.anonymized.reversible).toBe(false);
    expect(firstTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'PRIVACY_DATA_ERASED',
        metadata: expect.objectContaining({ irreversible: true, reversible: false })
      })
    }));
  });
});
