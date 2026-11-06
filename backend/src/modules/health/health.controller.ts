import { Controller, Get, HttpStatus, Inject, Optional, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { PASSWORD_RESET_NOTIFIER, type PasswordResetNotifier } from '../auth/password-reset.service';

type ReadinessCheck =
  | { name: 'database'; status: 'failed'; code: 'database_unavailable' | 'dependency_not_configured' }
  | { name: 'password_reset'; status: 'failed'; code: 'notification_channel_not_configured' };
interface DegradedHealth {
  status: 'degraded';
  checks: ReadinessCheck[];
}


@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma?: PrismaService,
    @Optional() @Inject(PASSWORD_RESET_NOTIFIER) private readonly passwordResetNotifier?: PasswordResetNotifier
  ) {}

  @Get()
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async getReadiness(@Res({ passthrough: true }) response?: Response): Promise<{ status: 'ready' } | DegradedHealth> {
    if (!this.prisma) {
      response?.status(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        status: 'degraded',
        checks: [
          { name: 'database', status: 'failed', code: 'dependency_not_configured' },
          ...this.missingPasswordResetCheck()
        ]
      };
    }

    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT 1`;
      });
      const passwordResetCheck = this.missingPasswordResetCheck();
      if (passwordResetCheck.length > 0) {
        response?.status(HttpStatus.SERVICE_UNAVAILABLE);
        return { status: 'degraded', checks: passwordResetCheck };
      }
      return { status: 'ready' };
    } catch {
      response?.status(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        status: 'degraded',
        checks: [
          { name: 'database', status: 'failed', code: 'database_unavailable' },
          ...this.missingPasswordResetCheck()
        ]
      };
    }
  }

  private missingPasswordResetCheck(): ReadinessCheck[] {
    if (!this.passwordResetNotifier || this.passwordResetNotifier.isConfigured()) return [];
    return [{ name: 'password_reset', status: 'failed', code: 'notification_channel_not_configured' }];
  }
}
