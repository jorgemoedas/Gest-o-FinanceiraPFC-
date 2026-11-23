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
  private readonly resendApiKey?: string;
  private readonly mailFrom: string;
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
    this.resendApiKey = process.env.RESEND_API_KEY?.trim() || undefined;
    this.mailFrom = process.env.MAIL_FROM?.trim() || 'GFT Inteligente <onboarding@resend.dev>';
    this.missing = this.resendApiKey ? app.missing : [...smtp.missing, ...app.missing];
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
    return Boolean(this.appUrl && (this.resendApiKey || (this.settings && this.transport)));
  }

  status(): PasswordResetChannelStatus {
    return { configured: this.isConfigured(), missing: [...this.missing] };
  }

  async send(input: { email: string; token: string; expiresAt: Date }): Promise<void> {
    if (!this.appUrl) {
      throw new Error('Nenhum canal de entrega de redefinição de senha está configurado.');
    }

    const url = new URL('/redefinir-senha', this.appUrl);
    url.searchParams.set('token', input.token);
    const expiresAt = input.expiresAt.toLocaleString('pt-BR', { timeZone: 'UTC', timeZoneName: 'short' });
    const subject = 'Redefinição de senha — GFT Inteligente';
    const text = [
      'Recebemos uma solicitação para redefinir sua senha.',
      '',
      `Abra este link para escolher uma nova senha: ${url.toString()}`,
      '',
      `O link expira em ${expiresAt} e pode ser usado uma única vez.`,
      'Se você não solicitou a redefinição, ignore esta mensagem.'
    ].join('\n');
    const html = `<p>Recebemos uma solicitação para redefinir sua senha.</p><p><a href="${url.toString()}">Escolher uma nova senha</a></p><p>O link expira em ${expiresAt} e pode ser usado uma única vez.</p><p>Se você não solicitou a redefinição, ignore esta mensagem.</p>`;

    if (this.resendApiKey) {
      await this.sendWithResend({ email: input.email, subject, html, text });
      return;
    }

    if (!this.transport || !this.settings) {
      throw new Error('Nenhum canal de entrega de redefinição de senha está configurado.');
    }
    await this.transport.sendMail({ from: this.settings.from, to: input.email, subject, text, html });
  }

  private async sendWithResend(input: { email: string; subject: string; html: string; text: string }): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from: this.mailFrom, to: input.email, subject: input.subject, html: input.html, text: input.text }),
        signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Resend email request failed with status ${response.status}: ${body}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
