import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { JSON_LOGGER } from './common/observability/logger';
import { LoggingInterceptor } from './common/observability/logging.interceptor';
import { createOriginPolicy } from './common/origin-policy.middleware';
import { RequestContextMiddleware } from './common/observability/request-context.middleware';
import { CorrelationExceptionFilter } from './common/observability/correlation-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const allowedOrigins = config.get<string>('FRONTEND_ORIGIN', 'http://localhost:3000').split(',').map((origin) => origin.trim()).filter(Boolean);

  app.useLogger(app.get(JSON_LOGGER));

  const requestContext = new RequestContextMiddleware();
  app.use(requestContext.use.bind(requestContext));
  app.useGlobalFilters(new CorrelationExceptionFilter());
  app.useGlobalInterceptors(app.get(LoggingInterceptor));

  app.use(helmet());
  app.use(createOriginPolicy(allowedOrigins));
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      { path: 'health/ready', method: RequestMethod.ALL },
      { path: 'metrics', method: RequestMethod.ALL },
      { path: 'openapi.json', method: RequestMethod.GET }
    ]
  });
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    credentials: false
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );

  const port = Number(config.get<string>('PORT', '3001'));
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
