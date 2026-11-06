import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns a minimal healthy status without environment details', () => {
    expect(new HealthController().getHealth()).toEqual({ status: 'ok' });
  });

  it('returns ready when the read-only database probe succeeds', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ result: 1 }]);
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: { $queryRaw: typeof queryRaw }) => Promise<unknown>) =>
        callback({ $queryRaw: queryRaw })
      )
    };
    const controller = new HealthController(prisma as never);

    await expect(controller.getReadiness()).resolves.toEqual({ status: 'ready' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns degraded when the password reset channel is not configured', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ result: 1 }]);
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: { $queryRaw: typeof queryRaw }) => Promise<unknown>) =>
        callback({ $queryRaw: queryRaw })
      )
    };
    const response = { status: jest.fn() };
    const notifier = { isConfigured: () => false, send: jest.fn() };

    await expect(new HealthController(prisma as never, notifier as never).getReadiness(response as never)).resolves.toEqual({
      status: 'degraded',
      checks: [{ name: 'password_reset', status: 'failed', code: 'notification_channel_not_configured' }]
    });
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('returns degraded with a reason code when the database probe fails', async () => {
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(new Error('driver details must not escape'))
    };
    const response = { status: jest.fn() };

    await expect(new HealthController(prisma as never).getReadiness(response as never)).resolves.toEqual({
      status: 'degraded',
      checks: [{ name: 'database', status: 'failed', code: 'database_unavailable' }]
    });
    expect(response.status).toHaveBeenCalledWith(503);
  });
});
