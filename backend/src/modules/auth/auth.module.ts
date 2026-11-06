import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PASSWORD_RESET_NOTIFIER, PasswordResetService } from './password-reset.service';
import { SmtpPasswordResetNotifier } from './notifications.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const ttl = Number(config.get<string>('JWT_ACCESS_TTL_SECONDS', '900'));
        return {
          secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          signOptions: {
            expiresIn: `${ttl}s` as JwtSignOptions['expiresIn'],
            issuer: config.get<string>('JWT_ISSUER', 'gft-inteligente-api'),
            audience: config.get<string>('JWT_AUDIENCE', 'gft-inteligente-client')
          }
        };
      }
    })
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    PasswordResetService,
    { provide: PASSWORD_RESET_NOTIFIER, useClass: SmtpPasswordResetNotifier }
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard, PASSWORD_RESET_NOTIFIER]
})
export class AuthModule {}
