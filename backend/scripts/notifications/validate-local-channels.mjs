#!/usr/bin/env node
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AlertsService } = require('../../dist/common/observability/alerts.service.js');
const { MetricsService } = require('../../dist/common/observability/metrics.service.js');
const { PasswordResetService } = require('../../dist/modules/auth/password-reset.service.js');
const { SmtpPasswordResetNotifier } = require('../../dist/modules/auth/notifications.service.js');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const smtpOutput = argument('--smtp-output', join(tmpdir(), 'gft-smtp-message.eml'));
const webhookOutput = argument('--webhook-output', join(tmpdir(), 'gft-webhook.json'));
const smtpPort = argument('--smtp-port', '2525');
const webhookUrl = argument('--webhook-url', 'http://127.0.0.1:8099/alerts');
const tokenProbe = 'token-obtido-do-email';
const user = { id: 'user-local-validation', email: 'pessoa@empresa.test', status: 'ACTIVE', passwordHash: 'old-hash' };
const state = { tokenRecord: null, tokenFound: true };

const tx = {
  passwordResetToken: {
    updateMany: async ({ where, data }) => {
      if (state.tokenRecord && where?.userId === user.id && (!where.id || where.id.not !== state.tokenRecord.id)) {
        state.tokenRecord.usedAt = data.usedAt;
      }
      return { count: 1 };
    },
    create: async ({ data }) => {
      state.tokenRecord = { id: 'reset-local', userId: user.id, userEmail: user.email, ...data, usedAt: null };
      return state.tokenRecord;
    },
    update: async ({ data }) => {
      Object.assign(state.tokenRecord, data);
      return state.tokenRecord;
    }
  },
  user: { update: async ({ data }) => Object.assign(user, data) },
  auditLog: { createMany: async () => ({ count: 1 }) },
  $executeRawUnsafe: async () => 0,
  $queryRaw: async (strings) => {
    const sql = strings.join(' ');
    if (sql.includes('auth_user_by_email')) return [user];
    if (sql.includes('auth_reset_token_by_hash')) return state.tokenFound && state.tokenRecord ? [state.tokenRecord] : [];
    return [{ company_id: null, user_id: user.id }];
  }
};
const prisma = { $transaction: async (callback) => callback(tx) };
const makeConfig = (values) => ({ get: (key, fallback) => values[key] ?? fallback });
const logger = { warn() {}, log() {}, error() {}, debug() {}, verbose() {}, fatal() {}, setLogLevels() {} };

async function waitForFile(path, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(path) && readFileSync(path).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('validation collector did not receive a message in time');
}

const notifier = new SmtpPasswordResetNotifier(makeConfig({
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: smtpPort,
  SMTP_SECURE: 'false',
  SMTP_FROM: 'no-reply@gft.test',
  PUBLIC_APP_URL: 'http://app.local:3000'
}), logger);
const resetService = new PasswordResetService(prisma, notifier);
const requestResult = await resetService.request({ email: user.email });
await waitForFile(smtpOutput);
const mail = readFileSync(smtpOutput, 'utf8');
const linkMatch = mail.match(/https?:\/\/[^\s]+\/redefinir-senha\?token=[^\s]+/);
if (!linkMatch) throw new Error('reset link not found in captured email');
const link = linkMatch[0];
const tokenFromMail = new URL(link).searchParams.get('token');
if (!tokenFromMail) throw new Error('reset token not found in captured link');
const first = await resetService.confirm({ token: tokenFromMail, newPassword: 'senha-local-segura-1' }).then(() => true).catch(() => false);
const second = await resetService.confirm({ token: tokenFromMail, newPassword: 'senha-local-segura-2' }).then(() => false).catch(() => true);
state.tokenRecord.usedAt = null;
state.tokenRecord.expiresAt = new Date(Date.now() - 1);
const expired = await resetService.confirm({ token: tokenFromMail, newPassword: 'senha-local-segura-3' }).then(() => false).catch(() => true);

const metrics = new MetricsService();
const alerts = new AlertsService(metrics, makeConfig({
  ALERT_WEBHOOK_ENABLED: 'true',
  ALERT_WEBHOOK_URL: webhookUrl,
  ALERT_ERROR_RATE_PERCENT: '20',
  ALERT_MIN_ROUTE_REQUESTS: '5',
  ALERT_LATENCY_P95_MS: '1000',
  ALERT_SILENCE_SECONDS: '300'
}), logger);
for (let index = 0; index < 5; index += 1) {
  metrics.recordRequest({ method: 'GET', route: '/local-validation', statusCode: index < 2 ? 500 : 200, durationMs: 10 });
}
const active = alerts.evaluate();
await waitForFile(webhookOutput);
const webhook = JSON.parse(readFileSync(webhookOutput, 'utf8'));

console.log(`smtp_delivery=${requestResult.delivered && mail.includes('Subject:')}`);
console.log(`recovery_link_path=${link.includes('/redefinir-senha?token=')}`);
console.log(`recovery_token_match=${link.includes(encodeURIComponent(tokenFromMail))}`);
console.log(`token_first_use=${first}`);
console.log(`token_second_use_rejected=${second}`);
console.log(`token_expired_rejected=${expired}`);
console.log(`webhook_delivery=${webhook.event === 'observability.alert'}`);
console.log(`webhook_alert_id=${webhook.alert?.id === 'route_error:GET /local-validation'}`);
console.log(`webhook_active_count=${active.length}`);
