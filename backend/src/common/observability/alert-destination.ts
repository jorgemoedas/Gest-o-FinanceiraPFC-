import { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSmtpTransport, isEnabled, readSmtpSettings } from '../notifications/smtp-client';
import { ActiveAlert } from './alerts.service';

export interface AlertDestination {
  readonly name?: string;
  isConfigured?(): boolean;
  send(alert: ActiveAlert): void | Promise<void>;
}

export class StructuredLogAlertDestination implements AlertDestination {
  readonly name = 'structured_log';

  constructor(private readonly logger: LoggerService) {}

  send(alert: ActiveAlert): void {
    this.logger.warn({ message: 'observability.alert', alert }, 'OBSERVABILITY');
  }
}

export class WebhookAlertDestination implements AlertDestination {
  readonly name = 'webhook';

  constructor(
    private readonly enabled: boolean,
    private readonly url?: string,
    private readonly timeoutMs = 3000
  ) {}

  isConfigured(): boolean {
    return this.enabled && Boolean(this.url);
  }

  async send(alert: ActiveAlert): Promise<void> {
    if (!this.isConfigured()) return;
    const response = await fetch(this.url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'observability.alert', alert }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`alert webhook returned HTTP ${response.status}`);
  }
}

export class SmtpAlertDestination implements AlertDestination {
  readonly name = 'smtp';
  private readonly transport?: ReturnType<typeof createSmtpTransport>;

  constructor(
    private readonly enabled: boolean,
    private readonly to: string | undefined,
    private readonly settings?: Parameters<typeof createSmtpTransport>[0]
  ) {
    if (enabled && to && this.settings) this.transport = createSmtpTransport(this.settings);
  }

  isConfigured(): boolean {
    return Boolean(this.enabled && this.to && this.transport);
  }

  async send(alert: ActiveAlert): Promise<void> {
    if (!this.transport || !this.to) return;
    await this.transport.sendMail({
      from: this.settings?.from,
      to: this.to,
      subject: `[GFT] Alerta de observabilidade: ${alert.severity}`,
      text: [
        'Alerta de observabilidade do GFT Inteligente.',
        `Código: ${alert.id}`,
        `Severidade: ${alert.severity}`,
        `Início: ${alert.startedAt}`,
        `Mensagem: ${alert.message}`
      ].join('\n')
    });
  }
}

export function createAlertDestinations(config: ConfigService): AlertDestination[] {
  const destinations: AlertDestination[] = [];
  const webhookEnabled = isEnabled(config, 'ALERT_WEBHOOK_ENABLED');
  const webhookUrl = config.get<string>('ALERT_WEBHOOK_URL')?.trim() || undefined;
  const webhookTimeout = Number(config.get<string>('ALERT_WEBHOOK_TIMEOUT_MS', '3000'));
  if (webhookEnabled && webhookUrl) {
    destinations.push(new WebhookAlertDestination(webhookEnabled, webhookUrl, Number.isFinite(webhookTimeout) && webhookTimeout > 0 ? webhookTimeout : 3000));
  }

  const smtpEnabled = isEnabled(config, 'ALERT_SMTP_ENABLED');
  if (smtpEnabled) {
    const smtp = readSmtpSettings(config, 'ALERT_SMTP');
    const to = config.get<string>('ALERT_SMTP_TO')?.trim() || undefined;
    if (smtp.settings && to) destinations.push(new SmtpAlertDestination(true, to, smtp.settings));
  }
  return destinations;
}
