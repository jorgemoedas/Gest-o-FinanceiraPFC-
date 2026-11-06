import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  LoggerService,
  Optional,
  NestInterceptor
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, catchError, finalize, throwError } from 'rxjs';
import { currentCorrelationId, currentRequestId, RequestWithId } from './request-context.middleware';
import { JSON_LOGGER, createJsonLogger } from './logger';
import { MetricsService } from './metrics.service';
import { AlertsService } from './alerts.service';

type ErrorRecord = Record<string, unknown>;

interface RequestErrorDetails {
  statusCode: number;
  errorCode: string;
}

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null;
}

function validStatus(value: unknown): number | undefined {
  return typeof value === 'number' && value >= 100 && value <= 599 ? value : undefined;
}

function statusFromError(error: unknown): number {
  if (!isRecord(error)) return 500;
  const getStatus = error.getStatus;
  if (typeof getStatus === 'function') {
    const status = validStatus(getStatus.call(error));
    if (status !== undefined) return status;
  }
  return validStatus(error.statusCode) ?? validStatus(error.status) ?? 500;
}

function codeFromError(error: unknown): string {
  if (isRecord(error)) {
    const errorCode = error.errorCode;
    if (typeof errorCode === 'string' && errorCode.length > 0) return errorCode;
    const code = error.code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'HTTP_REQUEST_FAILED';
}

function normalizedPath(request: RequestWithId): string {
  const candidate = request.originalUrl ?? request.url ?? request.path ?? '/';
  const path = candidate.split('?')[0] || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function isLowNoisePath(path: string): boolean {
  return path === '/health' || path === '/metrics' || path === '/openapi.json' ||
    path.endsWith('/health') || path.endsWith('/metrics') || path.endsWith('/openapi.json');
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger: LoggerService;

  constructor(
    private readonly metrics: MetricsService,
    private readonly alerts: AlertsService,
    @Optional() @Inject(JSON_LOGGER) logger?: LoggerService
  ) {
    this.logger = logger ?? createJsonLogger();
  }

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const requestId = currentRequestId() ?? request.requestId;
    const correlationId = currentCorrelationId() ?? request.correlationId ?? requestId;
    if (requestId) request.requestId = requestId;
    if (correlationId) request.correlationId = correlationId;

    const method = typeof request.method === 'string' ? request.method.toUpperCase() : 'UNKNOWN';
    const path = normalizedPath(request);
    const startedAt = Date.now();
    let errorDetails: RequestErrorDetails | undefined;

    return next.handle().pipe(
      catchError((error: unknown) => {
        errorDetails = {
          statusCode: statusFromError(error),
          errorCode: codeFromError(error)
        };
        return throwError(() => error);
      }),
      finalize(() => this.completeRequest({ method, path, response, requestId, correlationId, startedAt, errorDetails }))
    );
  }

  private completeRequest(input: {
    method: string;
    path: string;
    response: Response;
    requestId?: string;
    correlationId?: string;
    startedAt: number;
    errorDetails?: RequestErrorDetails;
  }): void {
    const durationMs = Math.max(0, Date.now() - input.startedAt);
    const statusCode = input.errorDetails?.statusCode ?? (input.response.statusCode || 200);
    this.metrics.recordRequest({ method: input.method, route: input.path, statusCode, durationMs });
    this.recordOperationalEvent(statusCode);
    this.alerts.evaluate();
    this.writeRequestEvent(input, statusCode, durationMs);
  }

  private recordOperationalEvent(statusCode: number): void {
    if (statusCode === 401 || statusCode === 403) this.metrics.recordOperationalEvent('authentication_failure');
    if (statusCode === 429) this.metrics.recordOperationalEvent('rate_limit');
  }

  private writeRequestEvent(
    input: { method: string; path: string; requestId?: string; correlationId?: string; errorDetails?: RequestErrorDetails },
    statusCode: number,
    durationMs: number
  ): void {
    const event = {
      message: input.errorDetails ? 'http.request.failed' : 'http.request.completed',
      method: input.method,
      path: input.path,
      statusCode,
      durationMs,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.errorDetails ? { errorCode: input.errorDetails.errorCode } : {})
    };
    if (input.errorDetails) this.logger.error(event, 'HTTP');
    else if (isLowNoisePath(input.path)) this.logger.debug?.(event, 'HTTP');
    else this.logger.log(event, 'HTTP');
  }
}
