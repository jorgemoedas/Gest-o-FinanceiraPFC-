import nodemailer from 'nodemailer';
import { SmtpPasswordResetNotifier } from './notifications.service';

describe('SmtpPasswordResetNotifier', () => {
  const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), fatal: jest.fn(), setLogLevels: jest.fn() };
  const config = (values: Record<string, string>) => ({
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback)
  }) as never;

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('envia o link da aplicação com o token e a expiração pelo cliente SMTP', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'local-message-id' });
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    const notifier = new SmtpPasswordResetNotifier(config({
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '2525',
      SMTP_SECURE: 'false',
      SMTP_FROM: 'no-reply@gft.test',
      PUBLIC_APP_URL: 'https://app.gft.test'
    }), logger);

    expect(notifier.isConfigured()).toBe(true);
    await notifier.send({ email: 'pessoa@empresa.test', token: 'token-local-único', expiresAt: new Date('2026-11-16T12:30:00.000Z') });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'no-reply@gft.test',
      to: 'pessoa@empresa.test',
      text: expect.stringContaining('https://app.gft.test/redefinir-senha?token=token-local-%C3%BAnico')
    }));
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000
    }));
  });

  it('prioriza a API HTTP do Resend quando a chave está configurada', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.MAIL_FROM = 'GFT <mail@gft.test>';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: jest.fn() });
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as typeof fetch);
    const notifier = new SmtpPasswordResetNotifier(config({ PUBLIC_APP_URL: 'https://app.gft.test' }), logger);

    expect(notifier.isConfigured()).toBe(true);
    await notifier.send({ email: 'pessoa@empresa.test', token: 'token', expiresAt: new Date('2026-11-16T12:30:00.000Z') });

    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer re_test_key', 'Content-Type': 'application/json' },
      signal: expect.any(AbortSignal)
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      from: 'GFT <mail@gft.test>',
      to: 'pessoa@empresa.test',
      subject: 'Redefinição de senha — GFT Inteligente',
      html: expect.any(String),
      text: expect.stringContaining('https://app.gft.test/redefinir-senha?token=token')
    }));
  });

  it('inclui status e corpo quando o Resend responde com erro HTTP', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 422, text: jest.fn().mockResolvedValue('invalid from') } as unknown as Response);
    const notifier = new SmtpPasswordResetNotifier(config({ PUBLIC_APP_URL: 'https://app.gft.test' }), logger);

    await expect(notifier.send({ email: 'pessoa@empresa.test', token: 'token', expiresAt: new Date() }))
      .rejects.toThrow('status 422: invalid from');
  });

  it('expõe configuração ausente, avisa na inicialização e não simula envio', async () => {
    const notifier = new SmtpPasswordResetNotifier(config({}), logger);

    notifier.onModuleInit();
    expect(notifier.isConfigured()).toBe(false);
    expect(notifier.status()).toEqual(expect.objectContaining({
      configured: false,
      missing: expect.arrayContaining(['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'PUBLIC_APP_URL'])
    }));
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ message: 'notification.password_reset.smtp_not_configured' }), 'NOTIFICATIONS');
    await expect(notifier.send({ email: 'pessoa@empresa.test', token: 'token', expiresAt: new Date() })).rejects.toThrow('Nenhum canal');
  });
});
