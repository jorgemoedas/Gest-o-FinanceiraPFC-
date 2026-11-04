import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Injectable, NestMiddleware } from '@nestjs/common';

export interface RequestWithId extends Request {
  requestId?: string;
  correlationId?: string;
}

export const requestContextStorage = new AsyncLocalStorage<{ requestId: string; correlationId?: string }>();

const requestIdPattern = /^[A-Za-z0-9_-]{8,64}$/;

function requestIdFromHeader(request: Request): string | undefined {
  const correlationHeader = request.headers['x-correlation-id'];
  const requestHeader = request.headers['x-request-id'];
  const value = correlationHeader ?? requestHeader;
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' && requestIdPattern.test(candidate) ? candidate : undefined;
}

export function currentRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}

export function currentCorrelationId(): string | undefined {
  const store = requestContextStorage.getStore();
  return store?.correlationId ?? store?.requestId;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const correlationId = requestIdFromHeader(request) ?? randomUUID();
    request.requestId = correlationId;
    request.correlationId = correlationId;
    response.setHeader('x-request-id', correlationId);
    response.setHeader('x-correlation-id', correlationId);
    requestContextStorage.run({ requestId: correlationId, correlationId }, next);
  }
}
