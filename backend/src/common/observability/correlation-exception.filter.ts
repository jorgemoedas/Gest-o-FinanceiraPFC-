import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { currentCorrelationId, RequestWithId } from './request-context.middleware';

function messageFrom(value: unknown): string | string[] {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value as string[];
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && message.every((item) => typeof item === 'string')) return message as string[];
  }
  return 'Não foi possível concluir a solicitação.';
}

@Catch()
export class CorrelationExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RequestWithId & Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = messageFrom(raw ?? exception);
    const correlationId = currentCorrelationId() ?? request.correlationId ?? request.requestId;

    if (correlationId) {
      response.setHeader('x-request-id', correlationId);
      response.setHeader('x-correlation-id', correlationId);
    }
    response.status(status).json({
      statusCode: status,
      message,
      ...(correlationId ? { requestId: correlationId, correlationId } : {})
    });
  }
}
