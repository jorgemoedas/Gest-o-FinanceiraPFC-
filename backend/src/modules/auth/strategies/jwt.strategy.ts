import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../database/prisma.service';
import { AuthPrincipal } from '../../../common/auth-principal';

interface JwtAccessPayload {
  sub: string;
  companyId: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      issuer: config.get<string>('JWT_ISSUER', 'gft-inteligente-api'),
      audience: config.get<string>('JWT_AUDIENCE', 'gft-inteligente-client')
    });
  }

  async validate(payload: JwtAccessPayload): Promise<AuthPrincipal> {
    if (!payload.sub || !payload.companyId) {
      throw new UnauthorizedException('Token inválido.');
    }

    const membership = await this.prisma.companyMembership.findUnique({
      where: {
        userId_companyId: {
          userId: payload.sub,
          companyId: payload.companyId
        }
      },
      include: { user: true }
    });

    if (!membership || !membership.isActive || membership.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Sessão inválida ou usuário sem acesso ativo.');
    }

    return {
      userId: membership.user.id,
      email: membership.user.email,
      companyId: membership.companyId,
      role: membership.role
    };
  }
}
