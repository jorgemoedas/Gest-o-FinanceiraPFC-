import { Logger } from '@nestjs/common';

const TRANSIENT_ERROR_CODES = new Set(['P2028', 'P1001', 'P1017', 'ECONNRESET']);
const DEFAULT_POOL_TIMEOUT_MS = 5_000;
const DEFAULT_TRANSACTION_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 1_000;

export type ReadRetryOptions = {
  operation: string;

  writeSafety: 'read-only';
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  logger?: Pick<Logger, 'warn'>;
};

function positiveEnvironmentInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function databasePoolTimeoutMs(): number {
  return positiveEnvironmentInteger('DATABASE_POOL_TIMEOUT_MS', DEFAULT_POOL_TIMEOUT_MS);
}

export function databaseTransactionTimeoutMs(): number {
  return positiveEnvironmentInteger('DATABASE_TRANSACTION_TIMEOUT_MS', DEFAULT_TRANSACTION_TIMEOUT_MS);
}

export const READ_TRANSACTION_OPTIONS = {
  maxWait: databasePoolTimeoutMs(),
  timeout: databaseTransactionTimeoutMs()
} as const;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' ? value : undefined;
}

function errorChain(error: unknown, depth = 0): string {
  if (depth > 3 || error == null) return '';
  if (error instanceof Error) {
    return `${error.name} ${error.message} ${errorChain(error.cause, depth + 1)}`;
  }
  if (typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown; cause?: unknown };
    return `${String(value.code ?? '')} ${String(value.message ?? '')} ${errorChain(value.cause, depth + 1)}`;
  }
  return String(error);
}

export function isTransientDatabaseError(error: unknown): boolean {
  const code = errorCode(error);
  if (code && TRANSIENT_ERROR_CODES.has(code)) return true;
  return /(?:P2028|P1001|P1017|ECONNRESET)/i.test(errorChain(error));
}

function retryCode(error: unknown): string {
  const code = errorCode(error);
  if (code && TRANSIENT_ERROR_CODES.has(code)) return code;
  const text = errorChain(error).toUpperCase();
  return [...TRANSIENT_ERROR_CODES].find((candidate) => text.includes(candidate)) ?? 'TRANSIENT_DATABASE_ERROR';
}

const defaultSleep = (delayMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, delayMs));






export async function withTransientRetry<T>(operation: () => Promise<T>, options: ReadRetryOptions): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? positiveEnvironmentInteger('DATABASE_RETRY_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? positiveEnvironmentInteger('DATABASE_RETRY_BASE_DELAY_MS', DEFAULT_BASE_DELAY_MS));
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? positiveEnvironmentInteger('DATABASE_RETRY_MAX_DELAY_MS', DEFAULT_MAX_DELAY_MS));
  const sleep = options.sleep ?? defaultSleep;
  const logger = options.logger ?? new Logger('DatabaseRetry');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (!isTransientDatabaseError(error) || attempt >= maxAttempts) throw error;
      const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      logger.warn({
        event: 'database_transient_retry',
        operation: options.operation,
        errorCode: retryCode(error),
        attempt,
        maxAttempts,
        delayMs,
        writeSafety: options.writeSafety
      });
      await sleep(delayMs);
    }
  }

  throw new Error('Unreachable retry state.');
}
