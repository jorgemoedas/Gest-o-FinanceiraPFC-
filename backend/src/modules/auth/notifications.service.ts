import { Inject, Injectable, LoggerService, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JSON_LOGGER, createJsonLogger } from '../../common/observability/logger';
import { createSmtpTransport, readSmtpSettings, type SmtpSettings, type SmtpSettingsResult } from '../../common/notifications/smtp-client';
import type { PasswordResetNotifier } from './password-reset.service';

export interface PasswordResetChannelStatus {
  configured: boolean;
  missing: string[];
}

function publicUrl(config: ConfigService): { value?: string; missing: string[] } {
  const raw = config.get<string>('PUBLIC_APP_URL')?.trim();
  if (!raw) return { missing: ['PUBLIC_APP_URL'] };
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return { missing: ['PUBLIC_APP_URL'] };
    return { value: parsed.toString().replace(/\/$/, ''), missing: [] };
  } catch {
    return { missing: ['PUBLIC_APP_URL'] };
  }
}

@Injectable()
export class SmtpPasswordResetNotifier implements PasswordResetNotifier, OnModuleInit {
  private readonly logger: LoggerService;
  private readonly settings?: SmtpSettings;
  private readonly transport?: ReturnType<typeof createSmtpTransport>;
  private readonly appUrl?: string;
  private readonly missing: string[];

  constructor(
    config: ConfigService,
    @Optional() @Inject(JSON_LOGGER) logger?: LoggerService
  ) {
    this.logger = logger ?? createJsonLogger();
    const smtp: SmtpSettingsResult = readSmtpSettings(config);
    const app = publicUrl(config);
    this.settings = smtp.settings;
    this.appUrl = app.value;
    this.missing = [...smtp.missing, ...app.missing];
    if (this.settings && this.appUrl) this.transport = createSmtpTransport(this.settings);
  }

  onModuleInit(): void {
    if (this.isConfigured()) return;
    this.logger.warn(
      { message: 'notification.password_reset.smtp_not_configured', missing: this.missing },
      'NOTIFICATIONS'
    );
  }

  isConfigured(): boolean {
    return Boolean(this.settings && this.transport && this.appUrl);
  }

  status(): PasswordResetChannelStatus {
    return { configured: this.isConfigured(), missing: [...this.missing] };
  }

  async send(input: { email: string; token: string; expiresAt: Date }): Promise<void> {
    if (!this.transport || !this.settings || !this.appUrl) {
      throw new Error('Nenhum canal de entrega de redefinição de senha está configurado.');
    }

    const url = new URL('/redefinir-senha', this.appUrl);
    url.searchParams.set('token', input.token);
    const expiresAt = input.expiresAt.toLocaleString('pt-BR', { timeZone: 'UTC', timeZoneName: 'short' });
    await this.transport.sendMail({
      from: this.settings.from,
      to: input.email,
      subject: 'Redefinição de senha — GFT Inteligente',
      text: [
        'Recebemos uma solicitação para redefinir sua senha.',
        '',
        `Abra este link para escolher uma nova senha: ${url.toString()}`,
        '',
        `O link expira em ${expiresAt} e pode ser usado uma única vez.`,
        'Se você não solicitou a redefinição, ignore esta mensagem.'
      ].join('\n')
    });
  }
}
