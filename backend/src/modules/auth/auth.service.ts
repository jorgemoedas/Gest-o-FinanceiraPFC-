import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CompanyRole } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { enterRestrictedRole, setTenantContext } from '../../database/tenant-context';
import {
  findActiveMembership,
  findAuthUserByEmail
} from '../../database/identity-lookup';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcrypt';

const BCRYPT_MAX_INPUT_BYTES = 72;

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresInSeconds: number;
  user: {
    id: string;
    email: string;
    companyId: string;
    companyName: string;
    role: CompanyRole;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService
  ) {}

  async register(input: RegisterDto): Promise<AuthResponse> {
    this.assertPasswordLength(input.password);
    this.assertCurrentDocumentAcceptance(input);

    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.$transaction(async (tx) => {
      await enterRestrictedRole(tx);
      return findAuthUserByEmail(tx, email);
    });
    if (existing) {
      throw new ConflictException('Já existe uma conta cadastrada para este e-mail.');
    }

    const cost = Number(this.config.get<string>('BCRYPT_COST', '12'));
    const passwordHash = await bcrypt.hash(input.password, cost);
    const termsVersion = this.config.getOrThrow<string>('TERMS_VERSION');
    const privacyVersion = this.config.getOrThrow<string>('PRIVACY_POLICY_VERSION');


    const userId = randomUUID();
    const companyId = randomUUID();

    try {
      return await this.prisma.$transaction(async (tx) => {
        await setTenantContext(tx, { userId, companyId });
        const user = await tx.user.create({
          data: { id: userId, email, passwordHash }
        });
        const company = await tx.company.create({
          data: { id: companyId, name: input.companyName.trim() }
        });
        const membership = await tx.companyMembership.create({
          data: {
            userId,
            companyId,
            role: CompanyRole.OWNER,
            isActive: true
          }
        });

        await tx.termAcceptance.create({
          data: {
            userId: user.id,
            companyId: company.id,
            termsVersion,
            privacyVersion
          }
        });
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            companyId: company.id,
            action: 'AUTH_REGISTERED',
            entityType: 'User',
            entityId: user.id,
            metadata: { termsVersion, privacyVersion }
          }
        });

        const refreshToken = await this.issueRefreshToken(tx, user.id, company.id);
        await tx.auditLog.create({ data: { actorUserId: user.id, companyId: company.id, action: 'AUTH_REFRESH_ISSUED', entityType: 'RefreshSession', metadata: { event: 'registration' } } });
        return this.createAuthResponse(user, company, membership.role, refreshToken);
      });
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Já existe uma conta cadastrada para este e-mail.');
      }
      throw error;
    }
  }

  async login(input: LoginDto): Promise<AuthResponse> {
    if (Buffer.byteLength(input.password, 'utf8') > BCRYPT_MAX_INPUT_BYTES) {
      await this.recordFailedLogin();
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const email = input.email.trim().toLowerCase();
    const lookup = await this.prisma.$transaction(async (tx) => {
      await enterRestrictedRole(tx);
      const account = await findAuthUserByEmail(tx, email);
      if (!account) return { account: null, membership: null };
      return { account, membership: await findActiveMembership(tx, account.id) };
    });
    const user = lookup.account;
    const membership = lookup.membership;

    const passwordMatches = user
      ? await bcrypt.compare(input.password, user.passwordHash)
      : false;

    if (!user || user.status !== 'ACTIVE' || !passwordMatches || !membership) {
      await this.recordFailedLogin();
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const refreshToken = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, { userId: user.id, companyId: membership.companyId });
      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          companyId: membership.companyId,
          action: 'AUTH_LOGIN_SUCCEEDED',
          entityType: 'User',
          entityId: user.id
        }
      });
      const token = await this.issueRefreshToken(tx, user.id, membership.companyId);
      await tx.auditLog.create({ data: { actorUserId: user.id, companyId: membership.companyId, action: 'AUTH_REFRESH_ISSUED', entityType: 'RefreshSession', metadata: { event: 'login' } } });
      return token;
    });

    return this.createAuthResponse(
      user,
      { id: membership.companyId, name: membership.companyName },
      membership.role as CompanyRole,
      refreshToken
    );
  }

  async refresh(rawToken: string): Promise<AuthResponse> {
    if (!rawToken || rawToken.length > 256) throw new UnauthorizedException('Sessão de renovação inválida.');
    const oldHash = this.hashRefreshToken(rawToken);
    const outcome = await this.prisma.$transaction(async (tx) => {
      await enterRestrictedRole(tx);
      const rows = await tx.$queryRaw<Array<{ result_status: string; user_id: string | null; company_id: string | null; family_id: string | null; email: string | null; role: string | null; company_name: string | null }>>`
        SELECT * FROM gft_inteligente.auth_consume_refresh_token(${oldHash})`;
      const row = rows[0];
      if (!row || row.result_status !== 'ACTIVE') {
        if (row?.result_status === 'REUSED' && row.user_id && row.company_id) {
          await setTenantContext(tx, { userId: row.user_id, companyId: row.company_id });
          await tx.auditLog.create({ data: { actorUserId: row.user_id, companyId: row.company_id, action: 'AUTH_REFRESH_REUSE_DETECTED', entityType: 'RefreshSession', metadata: { familyId: row.family_id, response: 'family_revoked' } } });
        }
        return { row, refreshToken: null };
      }
      await setTenantContext(tx, { userId: row.user_id!, companyId: row.company_id! });
      const refreshToken = await this.insertRefreshToken(tx, row.user_id!, row.company_id!, row.family_id!);
      await tx.auditLog.create({ data: { actorUserId: row.user_id!, companyId: row.company_id!, action: 'AUTH_REFRESH_ROTATED', entityType: 'RefreshSession', metadata: { familyId: row.family_id } } });
      return { row, refreshToken };
    });
    if (!outcome.row || outcome.row.result_status !== 'ACTIVE' || !outcome.refreshToken) {
      throw new UnauthorizedException(outcome.row?.result_status === 'INACTIVE' ? 'Vínculo da empresa inativo.' : 'Sessão de renovação inválida ou expirada.');
    }
    const user = { id: outcome.row.user_id!, email: outcome.row.email! };
    return this.createAuthResponse(user, { id: outcome.row.company_id!, name: outcome.row.company_name! }, outcome.row.role as CompanyRole, outcome.refreshToken);
  }

  async logout(rawToken?: string): Promise<{ ok: true }> {
    if (!rawToken || rawToken.length > 256) return { ok: true };
    const tokenHash = this.hashRefreshToken(rawToken);
    await this.prisma.$transaction(async (tx) => {
      await enterRestrictedRole(tx);
      const rows = await tx.$queryRaw<Array<{ user_id: string; company_id: string; family_id: string }>>`
        SELECT * FROM gft_inteligente.auth_revoke_refresh_family(${tokenHash})`;
      const row = rows[0];
      if (!row) return;
      await setTenantContext(tx, { userId: row.user_id, companyId: row.company_id });
      await tx.auditLog.create({ data: { actorUserId: row.user_id, companyId: row.company_id, action: 'AUTH_SESSION_ENDED', entityType: 'RefreshSession', metadata: { familyId: row.family_id } } });
    });
    return { ok: true };
  }

  private async issueRefreshToken(tx: any, userId: string, companyId: string): Promise<string> {
    return this.insertRefreshToken(tx, userId, companyId, randomUUID());
  }

  private async insertRefreshToken(tx: any, userId: string, companyId: string, familyId: string): Promise<string> {
    const token = randomBytes(48).toString('base64url');
    const ttl = Math.max(60, Number(this.config.get<string>('REFRESH_TOKEN_TTL_SECONDS', '2592000')));
    const hash = this.hashRefreshToken(token);
    await tx.$executeRaw`INSERT INTO gft_inteligente."RefreshSessionToken" ("tokenHash", "familyId", "userId", "companyId", "expiresAt") VALUES (${hash}, ${familyId}::uuid, ${userId}::uuid, ${companyId}::uuid, now() + (${ttl} * interval '1 second'))`;
    return token;
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private async recordFailedLogin(): Promise<void> {


    await this.prisma.auditLog.createMany({
      data: {
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        metadata: { reason: 'invalid_credentials_or_inactive_access' }
      }
    });
  }

  private assertCurrentDocumentAcceptance(input: RegisterDto): void {
    const expectedTerms = this.config.getOrThrow<string>('TERMS_VERSION');
    const expectedPrivacy = this.config.getOrThrow<string>('PRIVACY_POLICY_VERSION');

    if (!input.acceptedTerms || !input.acceptedPrivacy) {
      throw new BadRequestException('É necessário aceitar os Termos de Uso e a Política de Privacidade.');
    }
    if (input.termsVersion !== expectedTerms || input.privacyVersion !== expectedPrivacy) {
      throw new BadRequestException('As versões dos documentos foram atualizadas. Recarregue a página e aceite as versões vigentes.');
    }
  }

  private assertPasswordLength(password: string): void {
    if (Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_INPUT_BYTES) {
      throw new BadRequestException('A senha excede o limite suportado pelo algoritmo de hash.');
    }
  }

  private async createAuthResponse(
    user: { id: string; email: string },
    company: { id: string; name: string },
    role: CompanyRole,
    refreshToken: string
  ): Promise<AuthResponse> {
    const expiresInSeconds = Number(this.config.get<string>('JWT_ACCESS_TTL_SECONDS', '900'));
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      companyId: company.id
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresInSeconds,
      user: {
        id: user.id,
        email: user.email,
        companyId: company.id,
        companyName: company.name,
        role
      }
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
