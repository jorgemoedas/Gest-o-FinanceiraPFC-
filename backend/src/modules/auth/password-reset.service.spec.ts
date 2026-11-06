import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserStatus } from '../../generated/prisma/client';
import { PasswordResetService, type PasswordResetNotifier } from './password-reset.service';

const user = { id: 'user-1', email: 'pessoa@empresa.test', status: UserStatus.ACTIVE, passwordHash: 'old-hash' };

type FakeTx = ReturnType<typeof makeTx>;
function makeTx() {
  const tokenRecord: any = {
    id: 'reset-1',
    userId: user.id,
    tokenHash: '',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    usedAt: null,
    user
  };
  const state: { lookupUser: typeof user | null; tokenFound: boolean } = { lookupUser: user, tokenFound: true };
  const tx = {
    state,
    tokenRecord,
    passwordResetToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        Object.assign(tokenRecord, data);
        return { id: tokenRecord.id, ...data };
      }),
      findUnique: jest.fn().mockResolvedValue(tokenRecord),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        Object.assign(tokenRecord, data);
        return tokenRecord;
      })
    },
    user: {
      update: jest.fn().mockImplementation(async ({ data }: any) => Object.assign(user, data)),
      findUnique: jest.fn().mockResolvedValue(user)
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn(async (strings: unknown) => {
      const sql = Array.isArray(strings) ? (strings as string[]).join(' ') : String(strings);
      if (sql.includes('auth_user_by_email')) return state.lookupUser ? [state.lookupUser] : [];
      if (sql.includes('auth_reset_token_by_hash')) return state.tokenFound ? [tokenRecord] : [];
      return [{ company_id: null, user_id: user.id }];
    })
  };
  return tx;
}

function makePrisma(tx: FakeTx, found: unknown = user) {
  tx.state.lookupUser = found as typeof user | null;
  return {
    $transaction: jest.fn().mockImplementation(async (callback: (value: FakeTx) => unknown) => callback(tx))
  } as any;
}

describe('PasswordResetService', () => {
  it('retorna resposta neutra para e-mail inexistente sem abrir transação', async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx, null);
    const notifier: PasswordResetNotifier = { isConfigured: jest.fn().mockReturnValue(true), send: jest.fn() };
    const result = await new PasswordResetService(prisma, notifier).request({ email: 'nao@existe.test' });
    expect(result).toEqual({ delivered: false });
    expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('guarda somente hash, invalida token pendente e não simula entrega sem notifier', async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx);
    const notifier: PasswordResetNotifier = { isConfigured: jest.fn().mockReturnValue(false), send: jest.fn() };
    const result = await new PasswordResetService(prisma, notifier).request({ email: ' Pessoa@Empresa.Test ' });
    expect(result).toEqual({ delivered: false });
    expect(notifier.send).not.toHaveBeenCalled();
    const createData = tx.passwordResetToken.create.mock.calls[0][0].data;
    expect(createData.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createData.tokenHash).not.toBe('Pessoa@Empresa.Test');
    expect(createData.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 60 * 1000);
    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: user.id }) }));
    expect(tx.auditLog.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'AUTH_PASSWORD_RESET_REQUESTED', metadata: { delivered: false, reason: 'delivery_not_configured' } }) }));
    expect(JSON.stringify(tx.auditLog.createMany.mock.calls[0])).not.toContain('token');
  });

  it('entrega token somente quando notifier está configurado', async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx);
    const notifier: PasswordResetNotifier = { isConfigured: jest.fn().mockReturnValue(true), send: jest.fn().mockResolvedValue(undefined) };
    const result = await new PasswordResetService(prisma, notifier).request({ email: user.email });
    expect(result).toEqual({ delivered: true });
    expect(notifier.send).toHaveBeenCalledWith(expect.objectContaining({ email: user.email, token: expect.any(String), expiresAt: expect.any(Date) }));
  });

  it('recusa token expirado e token reutilizado com mensagem genérica', async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx);
    const service = new PasswordResetService(prisma, { isConfigured: () => false, send: jest.fn() });
    tx.state.tokenFound = false;
    await expect(service.confirm({ token: 'token', newPassword: 'senha-nova-segura' })).rejects.toBeInstanceOf(BadRequestException);
    tx.state.tokenFound = true;
    tx.tokenRecord.usedAt = new Date();
    await expect(service.confirm({ token: 'token', newPassword: 'senha-nova-segura' })).rejects.toBeInstanceOf(BadRequestException);
    tx.tokenRecord.usedAt = null;
    tx.tokenRecord.expiresAt = new Date(Date.now() - 1);
    await expect(service.confirm({ token: 'token', newPassword: 'senha-nova-segura' })).rejects.toThrow('inválido ou expirou');
  });

  it('atualiza com bcrypt de 12 rounds, marca o token e invalida os demais na mesma transação', async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx);
    const service = new PasswordResetService(prisma, { isConfigured: () => false, send: jest.fn() });
    const result = await service.confirm({ token: 'token-secreto', newPassword: 'senha-nova-segura' });
    expect(result).toEqual({ reset: true });
    const passwordHash = tx.user.update.mock.calls[0][0].data.passwordHash;
    expect(passwordHash).not.toBe('senha-nova-segura');
    expect(await bcrypt.compare('senha-nova-segura', passwordHash)).toBe(true);
    expect(tx.passwordResetToken.update).toHaveBeenCalledWith(expect.objectContaining({ data: { usedAt: expect.any(Date) } }));
    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: user.id, id: { not: 'reset-1' } }) }));
    expect(tx.auditLog.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'AUTH_PASSWORD_RESET_COMPLETED' }) }));
  });
});
