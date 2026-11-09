import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { enterRestrictedRole, setTenantContext } from '../../database/tenant-context';
import { findAuthUserByEmail, findResetTokenByHash } from '../../database/identity-lookup';

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const BCRYPT_ROUNDS = 12;
const BCRYPT_MAX_INPUT_BYTES = 72;
const GENERIC_TOKEN_ERROR = 'O token de redefinição é inválido ou expirou.';
export const PASSWORD_RESET_NOTIFIER = 'PASSWORD_RESET_NOTIFIER';

export interface PasswordResetNotifier {
  isConfigured(): boolean;
  send(input: { email: string; token: string; expiresAt: Date }): Promise<void>;
}

/** Default seguro: sem canal configurado, nunca finge que entregou a mensagem. */
export class UnconfiguredPasswordResetNotifier implements PasswordResetNotifier {
  isConfigured(): boolean {
    return false;
  }

  async send(_input: { email: string; token: string; expiresAt: Date }): Promise<void> {
    throw new Error('Nenhum canal de entrega de redefinição de senha está configurado.');
  }
}

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PASSWORD_RESET_NOTIFIER) private readonly notifier: PasswordResetNotifier
  ) {}

  async request(input: { email: string }): Promise<{ delivered: boolean }> {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.$transaction(async (tx) => {
      await enterRestrictedRole(tx);
      return findAuthUserByEmail(tx, email);
    });

    // A mesma resposta é usada para e-mails inexistentes para evitar enumeração.
    if (!user) return { delivered: false };

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, { userId: user.id, companyId: null });
      const now = new Date();
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });

      const resetToken = await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt }
      });

      let delivered = false;
      let reason = 'delivery_not_configured';
      if (this.notifier.isConfigured()) {
        try {
          await this.notifier.send({ email: user.email, token, expiresAt });
          delivered = true;
          reason = 'delivery_sent';
        } catch {
          // Falha do canal não deve revelar a existência da conta nem simular entrega.
          reason = 'delivery_failed';
        }
      }

      // O fluxo é pré-autenticação e não tem empresa no contexto, então o
      // evento é gravado sem leitura de retorno.
      await tx.auditLog.createMany({
        data: {
          actorUserId: user.id,
          action: 'AUTH_PASSWORD_RESET_REQUESTED',
          entityType: 'PasswordResetToken',
          entityId: resetToken.id,
          metadata: { delivered, reason }
        }
      });

      return { delivered };
    });
  }

  async confirm(input: { token: string; newPassword: string }): Promise<{ reset: true }> {
    this.assertPasswordPolicy(input.newPassword);
    const tokenHash = createHash('sha256').update(input.token, 'utf8').digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await enterRestrictedRole(tx);
      const token = await findResetTokenByHash(tx, tokenHash);
      const now = new Date();

      if (!token || token.usedAt || new Date(token.expiresAt).getTime() <= now.getTime()) {
        throw new BadRequestException(GENERIC_TOKEN_ERROR);
      }
      await setTenantContext(tx, { userId: token.userId, companyId: null });
      const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
      await tx.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: now }
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: token.userId, id: { not: token.id }, usedAt: null },
        data: { usedAt: now }
      });
      await tx.auditLog.createMany({
        data: {
          actorUserId: token.userId,
          action: 'AUTH_PASSWORD_RESET_COMPLETED',
          entityType: 'User',
          entityId: token.userId,
          metadata: { reason: 'password_updated' }
        }
      });

      return { reset: true };
    });
  }

  private assertPasswordPolicy(password: string): void {
    if (password.length < 12) {
      throw new BadRequestException('Use pelo menos 12 caracteres na nova senha.');
    }
    if (password.length > 72 || Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_INPUT_BYTES) {
      throw new BadRequestException('A nova senha deve ocupar no máximo 72 bytes em UTF-8.');
    }
  }
}
