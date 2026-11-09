import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnvironment } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { BusinessRegistryModule } from './modules/business-registry/business-registry.module';
import { FinanceModule } from './modules/finance/finance.module';
import { FiscalModule } from './modules/fiscal/fiscal.module';
import { HealthModule } from './modules/health/health.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { JSON_LOGGER, createJsonLogger } from './common/observability/logger';
import { LoggingInterceptor } from './common/observability/logging.interceptor';
import { MetricsController } from './common/observability/metrics.controller';
import { ObservabilityModule } from './common/observability/observability.module';
import { OpenApiController } from './openapi/openapi.controller';
import { SecretsModule } from './common/secrets/secrets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    SecretsModule,
    ObservabilityModule,
    // Um limitador adicional declarado aqui passa a valer para todas as rotas, e
    // não só para as que o nomeiam; por isso o limite de autenticação é definido
    // na própria rota, sobre o balde padrão.
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }] }),
    PrismaModule,
    AuthModule,
    AuditModule,
    BusinessRegistryModule,
    FinanceModule,
    FiscalModule,
    PrivacyModule,
    HealthModule
  ],
  controllers: [OpenApiController, MetricsController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    LoggingInterceptor,
    { provide: JSON_LOGGER, useFactory: createJsonLogger }
  ]
})
export class AppModule {}
