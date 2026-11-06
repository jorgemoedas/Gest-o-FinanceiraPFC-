import type { NextFunction, Response } from 'express';
import { RequestContextMiddleware, RequestWithId, currentRequestId } from './request-context.middleware';

describe('RequestContextMiddleware', () => {
  it('accepts a valid client request ID and exposes it in the response', () => {
    const request = { headers: { 'x-request-id': 'client_123456' } } as unknown as RequestWithId;
    const response = { setHeader: jest.fn() } as unknown as Response;
    let observed: string | undefined;
    const next: NextFunction = jest.fn(() => {
      observed = currentRequestId();
    });

    new RequestContextMiddleware().use(request, response, next);

    expect(request.requestId).toBe('client_123456');
    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', 'client_123456');
    expect(observed).toBe('client_123456');
  });

  it('replaces invalid IDs with a UUID correlation ID', () => {
    const request = { headers: { 'x-request-id': 'bad id' } } as unknown as RequestWithId;
    const response = { setHeader: jest.fn() } as unknown as Response;
    let observed: string | undefined;
    const next: NextFunction = jest.fn(() => {
      observed = currentRequestId();
    });

    new RequestContextMiddleware().use(request, response, next);

    expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', request.requestId);
    expect(observed).toBe(request.requestId);
  });
});
