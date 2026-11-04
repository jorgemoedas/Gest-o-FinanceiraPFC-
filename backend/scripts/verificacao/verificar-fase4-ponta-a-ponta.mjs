const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3001/api/v1';
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function call(path, { method = 'GET', token, body, raw } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !raw) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const contentType = response.headers.get('content-type') ?? '';
  const parsed = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);
  return { status: response.status, body: parsed, headers: response.headers };
}

const stamp = Date.now();
const email = `e2e.fase4.${stamp}@exemplo.local`;
const password = 'VerificacaoFase4!2026';
const iso = (date) => date.toISOString();
const now = new Date();

const register = await call('/auth/register', {
  method: 'POST',
  body: {
    email,
    password,
    companyName: `Empresa Verificação ${stamp}`,
    acceptedTerms: true,
    acceptedPrivacy: true,
    termsVersion: '2026-10-01',
    privacyVersion: '2026-10-01'
  }
});
record('cadastro', register.status === 201 && Boolean(register.body?.accessToken), `status=${register.status}`);
const token = register.body?.accessToken;
if (!token) {
  console.log('Sem token; encerrando.');
  process.exit(1);
}

const me = await call('/auth/me', { token });
record('sessão autenticada (/auth/me)', me.status === 200 && me.body?.email === email, `role=${me.body?.role}`);

const counterparty = await call('/finance/counterparties', {
  method: 'POST',
  token,
  body: { name: `Cliente Verificação ${stamp}`, role: 'CUSTOMER' }
});
record('cadastro de cliente', counterparty.status === 201 && Boolean(counterparty.body?.id), `status=${counterparty.status}`);
const counterpartyId = counterparty.body?.id;

const transaction = await call('/finance/transactions', {
  method: 'POST',
  token,
  body: {
    type: 'INCOME',
    category: 'SALES',
    description: `Receita verificada ${stamp}`,
    amount: 1234.56,
    occurredAt: iso(now),
    status: 'PAID',
    counterpartyId
  }
});
record('lançamento de receita paga', transaction.status === 201 && Boolean(transaction.body?.id), `status=${transaction.status}`);

const dashboard = await call('/finance/dashboard?months=6', { token });
record(
  'dashboard com métricas persistidas',
  dashboard.status === 200 && typeof dashboard.body?.summary?.income === 'number',
  `income=${dashboard.body?.summary?.income}`
);

const recurrenceStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1, 12, 0, 0));
const recurrence = await call('/finance/recurrences', {
  method: 'POST',
  token,
  body: {
    type: 'EXPENSE',
    category: 'OTHER',
    description: `Assinatura verificada ${stamp}`,
    amount: 99.9,
    frequency: 'MONTHLY',
    intervalCount: 1,
    startDate: iso(recurrenceStart)
  }
});
record('criação de recorrência', recurrence.status === 201 && Boolean(recurrence.body?.id), `status=${recurrence.status}`);

const firstRun = await call('/finance/recurrences/run', { method: 'POST', token, body: { until: iso(now) } });
const secondRun = await call('/finance/recurrences/run', { method: 'POST', token, body: { until: iso(now) } });
record(
  'materialização idempotente',
  firstRun.status === 201 && (firstRun.body?.generated ?? 0) >= 3 && secondRun.body?.generated === 0,
  `gerados=${firstRun.body?.generated} repetidos=${secondRun.body?.generated} ignorados=${secondRun.body?.skipped}`
);

const recurrenceList = await call('/finance/recurrences?page=1&limit=10', { token });
record('listagem paginada de recorrências', recurrenceList.status === 200 && recurrenceList.body?.total >= 1, `total=${recurrenceList.body?.total}`);

const from = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)));
const to = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0)));
const generated = await call('/fiscal/calendar/generate-default', {
  method: 'POST',
  token,
  body: { regime: 'MEI', from, to }
});
record('geração do calendário fiscal', generated.status === 201 && (generated.body?.created ?? 0) >= 1, `criadas=${generated.body?.created} ignoradas=${generated.body?.skipped}`);

const calendar = await call(`/fiscal/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token });
record('calendário fiscal com resumo', calendar.status === 200 && Array.isArray(calendar.body?.items) && Boolean(calendar.body?.summary), `itens=${calendar.body?.items?.length}`);

const csv = await call(`/fiscal/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=csv`, { token });
record('exportação CSV', csv.status === 200 && typeof csv.body === 'string' && csv.body.includes(';'), `linhas=${typeof csv.body === 'string' ? csv.body.split('\r\n').length : 0}`);

const pdf = await call(`/fiscal/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=pdf`, { token });
record('exportação PDF', pdf.status === 200 && typeof pdf.body === 'string' && pdf.body.startsWith('%PDF-1.4') && pdf.body.includes('%%EOF'), `bytes=${typeof pdf.body === 'string' ? pdf.body.length : 0}`);

const analytics = await call('/finance/analytics?months=6&projectionMonths=3', { token });
record(
  'relatório analítico com projeção e alertas',
  analytics.status === 200 && Array.isArray(analytics.body?.projection) && Array.isArray(analytics.body?.alerts),
  `meses=${analytics.body?.monthly?.length} alertas=${analytics.body?.alerts?.length}`
);

const privacy = await call('/privacy/export', { token });
record('exportação de dados pessoais', privacy.status === 200 && Boolean(privacy.body?.subject) && !JSON.stringify(privacy.body).includes('passwordHash'), `chaves=${Object.keys(privacy.body ?? {}).length}`);

const form = new FormData();
form.append('transactionId', transaction.body.id);
form.append('file', new Blob([`descricao;valor\nVerificação;1234,56\n`], { type: 'text/csv' }), 'comprovante.csv');
const upload = await call('/finance/attachments', { method: 'POST', token, body: form, raw: true });
record('envio de anexo', upload.status === 201 && Boolean(upload.body?.id) && !('storageKey' in (upload.body ?? {})), `status=${upload.status}`);
const attachmentId = upload.body?.id;

const listAttachments = await call(`/finance/attachments?transactionId=${transaction.body.id}`, { token });
record('listagem de anexos', listAttachments.status === 200 && listAttachments.body?.length === 1, `itens=${listAttachments.body?.length}`);

const download = await call(`/finance/attachments/${attachmentId}`, { token });
record('download do anexo', download.status === 200 && typeof download.body === 'string' && download.body.includes('Verificação'), `status=${download.status}`);

const removed = await call(`/finance/attachments/${attachmentId}`, { method: 'DELETE', token });
record('remoção do anexo', removed.status === 200, `status=${removed.status}`);

const voided = await call(`/finance/transactions/${transaction.body.id}`, { method: 'DELETE', token });
record('anulação de lançamento', voided.status === 200, `status=${voided.status}`);

const audit = await call('/audit-logs?page=1&limit=50', { token });
const auditActions = Array.isArray(audit.body?.items) ? audit.body.items.map((item) => item.action) : [];
record(
  'trilha de auditoria com eventos novos',
  audit.status === 200 && auditActions.includes('FINANCE_RECURRENCE_MATERIALIZED') && auditActions.includes('FINANCE_ATTACHMENT_ADDED'),
  `eventos=${auditActions.length}`
);

const unauthorized = await call('/finance/analytics?months=6&projectionMonths=3');
record('proteção sem token', unauthorized.status === 401, `status=${unauthorized.status}`);

const failed = results.filter((item) => !item.ok);
console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} verificações aprovadas`);
if (failed.length > 0) {
  console.log('FALHAS: ' + failed.map((item) => item.name).join(', '));
  process.exit(1);
}
