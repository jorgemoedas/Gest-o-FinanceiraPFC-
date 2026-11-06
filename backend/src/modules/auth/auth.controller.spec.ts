import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { describe, expect, it } from '@jest/globals';
import { ThrottlerStorageService } from '@nestjs/throttler/dist/throttler.service';
import { AuthController } from './auth.controller';

describe('AuthController login throttling', () => {
  const login = AuthController.prototype.login;

  it('limita o login a cinco tentativas por minuto no balde padrão da rota', () => {
    expect(Reflect.getMetadata(THROTTLER_LIMIT + 'default', login)).toBe(5);
    expect(Reflect.getMetadata(THROTTLER_TTL + 'default', login)).toBe(60_000);
  });

  it('permite exatamente cinco hits e bloqueia o sexto', async () => {
    const storage = new ThrottlerStorageService();
    const attempts = [];
    for (let i = 0; i < 6; i++) {
      attempts.push(await storage.increment('AuthController-login-default-client', 60_000, 5, 60_000, 'default'));
    }

    expect(attempts.slice(0, 5).every((attempt) => !attempt.isBlocked)).toBe(true);
    expect(attempts[5].isBlocked).toBe(true);
    storage.onApplicationShutdown();
  });
});
