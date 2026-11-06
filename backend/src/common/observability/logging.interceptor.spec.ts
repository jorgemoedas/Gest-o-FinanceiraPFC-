import { ExecutionContext, LoggerService } from '@nestjs/common';
import type { Response } from 'express';
import { lastValueFrom, of } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';
import { MetricsService } from './metrics.service';
import { RequestWithId, requestContextStorage } from './request-context.middleware';

describe('LoggingInterceptor', () => {
  it('logs duration, strips query strings and propagates request ID', async () => {
    const metrics = new MetricsService();
    const alerts = { evaluate: jest.fn() } as never;
    const logger: LoggerService = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      fatal: jest.fn()
    };
    const request = { method: 'get', originalUrl: '/finance/transactions?status=PAID' } as RequestWithId;
    const response = { statusCode: 200 } as Response;
    const http = { getRequest: () => request, getResponse: () => response };
    const context = { switchToHttp: () => http } as unknown as ExecutionContext;
    const handler = { handle: () => of({ ok: true }) };

    await requestContextStorage.run({ requestId: 'req_123456' }, () =>
      lastValueFrom(new LoggingInterceptor(metrics, alerts, logger).intercept(context, handler))
    );

    expect(request.requestId).toBe('req_123456');
    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/finance/transactions', statusCode: 200, durationMs: expect.any(Number), requestId: 'req_123456' }), 'HTTP');
    expect(metrics.snapshot().byRoute).toEqual([expect.objectContaining({ method: 'GET', route: '/finance/transactions', count: 1 })]);
  });
});
