import { describe, expect, it, jest } from '@jest/globals';
import { isTransientDatabaseError, withTransientRetry } from './transient-retry';

describe('transient database retry', () => {
  it('retries transient transaction failures with capped exponential backoff', async () => {
    const operation = jest.fn<() => Promise<string>>()
      .mockRejectedValueOnce({ code: 'P2028', message: 'transaction timeout' })
      .mockRejectedValueOnce({ code: 'P1001', message: 'cannot reach database' })
      .mockResolvedValue('ok');
    const sleep = jest.fn<(_: number) => Promise<void>>().mockResolvedValue(undefined);
    const logger = { warn: jest.fn() };

    await expect(withTransientRetry(operation, {
      operation: 'test.read',
      writeSafety: 'read-only',
      maxAttempts: 3,
      baseDelayMs: 25,
      maxDelayMs: 40,
      sleep,
      logger
    })).resolves.toBe('ok');

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 25);
    expect(sleep).toHaveBeenNthCalledWith(2, 40);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenNthCalledWith(1, expect.objectContaining({
      event: 'database_transient_retry',
      operation: 'test.read',
      errorCode: 'P2028',
      attempt: 1,
      writeSafety: 'read-only'
    }));
  });

  it.each([
    ['P2028', { code: 'P2028', message: 'interactive transaction timeout' }],
    ['P1001', { code: 'P1001', message: 'database server unreachable' }],
    ['P1017', { code: 'P1017', message: 'server closed connection' }],
    ['ECONNRESET', new Error('socket ECONNRESET')]
  ])('recognizes %s as transient', (_name, error) => {
    expect(isTransientDatabaseError(error)).toBe(true);
  });

  it('does not retry a non-transient failure or exceed the attempt limit', async () => {
    const operation = jest.fn<() => Promise<never>>()
      .mockRejectedValue({ code: 'P2002', message: 'unique constraint' });
    const sleep = jest.fn<(_: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(withTransientRetry(operation, {
      operation: 'test.read',
      writeSafety: 'read-only',
      maxAttempts: 4,
      sleep
    })).rejects.toMatchObject({ code: 'P2002' });

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('rethrows the final transient error without a fourth operation', async () => {
    const error = { code: 'P1017', message: 'server closed connection' };
    const operation = jest.fn<() => Promise<never>>().mockRejectedValue(error);
    const sleep = jest.fn<(_: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(withTransientRetry(operation, {
      operation: 'test.read',
      writeSafety: 'read-only',
      maxAttempts: 3,
      baseDelayMs: 1,
      sleep
    })).rejects.toBe(error);

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
