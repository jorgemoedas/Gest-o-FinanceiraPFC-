import { LoggerService } from '@nestjs/common';
import { currentCorrelationId, currentRequestId } from './request-context.middleware';

export const JSON_LOGGER = 'JSON_LOGGER';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type LogLevel = 'verbose' | 'debug' | 'log' | 'warn' | 'error' | 'fatal';
type LogRecord = Record<string, unknown>;

const forbiddenKeyNames = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'token',
  'secret',
  'database_url',
  'stack'
]);

function isRecord(value: unknown): value is LogRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isForbiddenKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll('_', '-');
  return forbiddenKeyNames.has(normalized) ||
    normalized.includes('authorization') ||
    normalized.includes('cookie') ||
    normalized.includes('password') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('database-url');
}

function sanitize(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): JsonValue {
  const scalar = sanitizeScalar(value);
  if (typeof scalar !== 'undefined') return scalar;
  const objectValue = value as object;
  if (seen.has(objectValue)) return '[Circular]';
  seen.add(objectValue);
  return Array.isArray(objectValue) ? sanitizeArray(objectValue, seen) : sanitizeObject(objectValue, seen);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function sanitizePrimitive(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  return undefined;
}

function sanitizeSpecialValue(value: unknown): JsonValue | undefined {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  return undefined;
}

function sanitizeScalar(value: unknown): JsonValue | undefined {
  return sanitizePrimitive(value) ?? sanitizeSpecialValue(value);
}

function sanitizeArray(value: unknown[], seen: WeakSet<object>): JsonValue[] {
  const items = value.map((item) => sanitize(item, seen));
  seen.delete(value);
  return items;
}

function sanitizeObject(value: object, seen: WeakSet<object>): { [key: string]: JsonValue } {
  const output: { [key: string]: JsonValue } = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (!isForbiddenKey(key)) output[key] = sanitize(nestedValue, seen);
  }
  seen.delete(value);
  return output;
}

function addStructuredFields(event: LogRecord, sanitized: LogRecord): void {
  const structuredMessage = sanitized.message;
  if (typeof structuredMessage !== 'undefined') event.message = structuredMessage;
  for (const field of ['context', 'requestId', 'correlationId', 'method', 'path', 'statusCode', 'durationMs', 'errorCode']) {
    if (typeof sanitized[field] !== 'undefined') event[field] = sanitized[field];
  }
}

function addRequestContext(event: LogRecord, level: LogLevel, optionalParams: unknown[]): void {
  const correlationId = typeof event.correlationId === 'string' ? event.correlationId : currentCorrelationId();
  const requestId = typeof event.requestId === 'string' ? event.requestId : currentRequestId() ?? correlationId;
  if (requestId) event.requestId = requestId;
  if (correlationId) event.correlationId = correlationId;
  const context = stringValue(optionalParams.at(-1));
  const isErrorStackOnly = level === 'error' && optionalParams.length === 1;
  if (context && !isErrorStackOnly && typeof event.context === 'undefined') event.context = context;
}

function buildEvent(level: LogLevel, rawMessage: unknown, optionalParams: unknown[]): LogRecord {
  const sanitized = sanitize(rawMessage);
  const event: LogRecord = { level, time: new Date().toISOString(), message: sanitized };
  if (isRecord(sanitized)) addStructuredFields(event, sanitized);
  addRequestContext(event, level, optionalParams);
  return event;
}

export function createJsonLogger(): LoggerService {
  const write = (level: LogLevel, rawMessage: unknown, optionalParams: unknown[]): void => {
    process.stdout.write(`${JSON.stringify(buildEvent(level, rawMessage, optionalParams))}\n`);
  };

  return {
    log(message: unknown, ...optionalParams: unknown[]): void {
      write('log', message, optionalParams);
    },
    error(message: unknown, ...optionalParams: unknown[]): void {
      write('error', message, optionalParams);
    },
    warn(message: unknown, ...optionalParams: unknown[]): void {
      write('warn', message, optionalParams);
    },
    debug(message: unknown, ...optionalParams: unknown[]): void {
      write('debug', message, optionalParams);
    },
    verbose(message: unknown, ...optionalParams: unknown[]): void {
      write('verbose', message, optionalParams);
    },
    fatal(message: unknown, ...optionalParams: unknown[]): void {
      write('fatal', message, optionalParams);
    }
  };
}
