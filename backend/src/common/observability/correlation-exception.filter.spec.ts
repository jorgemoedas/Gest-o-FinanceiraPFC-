import { BadRequestException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { CorrelationExceptionFilter } from './correlation-exception.filter';
import { requestContextStorage } from './request-context.middleware';

describe('CorrelationExceptionFilter', () => {
  it('returns the active correlation ID in headers and error body', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const response = { setHeader: jest.fn(), status, json };
    const request = { requestId: 'corr_123456', correlationId: 'corr_123456' };
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request })
    } as unknown as ArgumentsHost;

    requestContextStorage.run({ requestId: 'corr_123456', correlationId: 'corr_123456' }, () => {
      new CorrelationExceptionFilter().catch(new BadRequestException('Dados inválidos.'), host);
    });

    expect(response.setHeader).toHaveBeenNthCalledWith(1, 'x-request-id', 'corr_123456');
    expect(response.setHeader).toHaveBeenNthCalledWith(2, 'x-correlation-id', 'corr_123456');
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      message: 'Dados inválidos.',
      requestId: 'corr_123456',
      correlationId: 'corr_123456'
    }));
  });
});
