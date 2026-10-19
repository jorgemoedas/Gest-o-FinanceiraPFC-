import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CompanyRole } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcrypt';

const BCRYPT_MAX_INPUT_BYTES = 72;

interface AuthResponse {
  accessToken: string;
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
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Já existe uma conta cadastrada para este e-mail.');
    }

    const cost = Number(this.config.get<string>('BCRYPT_COST', '12'));
    const passwordHash = await bcrypt.hash(input.password, cost);
    const termsVersion = this.config.getOrThrow<string>('TERMS_VERSION');
    const privacyVersion = this.config.getOrThrow<string>('PRIVACY_POLICY_VERSION');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash }
        });
        const company = await tx.company.create({
          data: { name: input.companyName.trim() }
        });
        const membership = await tx.companyMembership.create({
          data: {
            userId: user.id,
            companyId: company.id,
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

        return this.createAuthResponse(user, company, membership.role);
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
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          where: { isActive: true },
          include: { company: true },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    const passwordMatches = user
      ? await bcrypt.compare(input.password, user.passwordHash)
      : false;
    const membership = user?.memberships[0];

    if (!user || user.status !== 'ACTIVE' || !passwordMatches || !membership) {
      await this.recordFailedLogin();
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: user.id,
          companyId: membership.companyId,
          action: 'AUTH_LOGIN_SUCCEEDED',
          entityType: 'User',
          entityId: user.id
        }
      })
    ]);

    return this.createAuthResponse(user, membership.company, membership.role);
  }

  private async recordFailedLogin(): Promise<void> {
    await this.prisma.auditLog.create({
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
    role: CompanyRole
  ): Promise<AuthResponse> {
    const expiresInSeconds = Number(this.config.get<string>('JWT_ACCESS_TTL_SECONDS', '900'));
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      companyId: company.id
    });

    return {
      accessToken,
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
