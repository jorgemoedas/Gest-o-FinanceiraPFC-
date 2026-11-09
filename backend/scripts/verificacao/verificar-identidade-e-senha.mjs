import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { postgresAdapterOptions } from '../../dist/database/postgres-connection.js';

const API = 'http://127.0.0.1:3001/api/v1';
const TABLES = ['User', 'Company', 'CompanyMembership', 'TermAcceptance', 'PasswordResetToken'];
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function api(path, body, token) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

const stamp = Date.now();
const email = `identidade.${stamp}@exemplo.local`;
const password = 'SenhaInicial123!';
const newPassword = 'SenhaRedefinida456!';

const registered = await api('/auth/register', {
  email,
  password,
  companyName: `Empresa Identidade ${stamp}`,
  acceptedTerms: true,
  acceptedPrivacy: true,
  termsVersion: '2026-10-01',
  privacyVersion: '2026-10-01'
});
check('cadastro cria a conta', registered.status === 201, `status=${registered.status}`);

const owner = new Client(postgresAdapterOptions(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT));
await owner.connect();
const userId = (await owner.query('SELECT id FROM gft_inteligente."User" WHERE email = $1', [email])).rows[0]?.id;
check('conta localizada no banco', Boolean(userId));

// Leitura como papel restrito, sem contexto de tenant.
await owner.query('BEGIN');
await owner.query('SET LOCAL ROLE gft_app');
for (const table of TABLES) {
  const count = (await owner.query(`SELECT count(*)::int AS n FROM gft_inteligente."${table}"`)).rows[0].n;
  check(`sem contexto nada é visível em ${table}`, count === 0, `linhas=${count}`);
}
const lookup = await owner.query('SELECT email FROM gft_inteligente.auth_user_by_email($1)', [email]);
check('função restrita resolve a conta pelo e-mail', lookup.rows.length === 1, `linhas=${lookup.rows.length}`);
await owner.query('ROLLBACK');

// Leitura como papel restrito com contexto do próprio titular.
const companyId = (await owner.query('SELECT "companyId" FROM gft_inteligente."CompanyMembership" WHERE "userId" = $1 LIMIT 1', [userId])).rows[0].companyId;
await owner.query('BEGIN');
await owner.query('SET LOCAL ROLE gft_app');
await owner.query("SELECT set_config('gft.user_id', $1, true), set_config('gft.company_id', $2, true)", [userId, companyId]);
const ownUsers = await owner.query('SELECT email FROM gft_inteligente."User"');
check('titular enxerga apenas a própria conta', ownUsers.rows.length === 1 && ownUsers.rows[0].email === email, `linhas=${ownUsers.rows.length}`);
const others = await owner.query('SELECT count(*)::int AS n FROM gft_inteligente."User" WHERE email <> $1', [email]);
check('nenhuma conta de terceiro é visível', others.rows[0].n === 0, `linhas=${others.rows[0].n}`);
await owner.query('ROLLBACK');

// Redefinição de senha ponta a ponta com token conhecido.
const token = randomUUID();
const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
const requested = await api('/auth/password-reset', { email });
await owner.query(
  `INSERT INTO gft_inteligente."PasswordResetToken" (id, "userId", "tokenHash", "expiresAt")
   VALUES (gen_random_uuid(), $1, $2, now() + interval '30 minutes')`,
  [userId, tokenHash]
);
check('pedido de redefinição responde sem revelar a conta', requested.status === 200 || requested.status === 201, `status=${requested.status}`);
const confirmed = await api('/auth/password-reset/confirm', { token, newPassword });
check('redefinição confirma com o token', confirmed.status === 200 || confirmed.status === 201, `status=${confirmed.status}`);
const relogin = await api('/auth/login', { email, password: newPassword });
check('login funciona com a nova senha', relogin.status === 200 || relogin.status === 201, `status=${relogin.status}`);
const oldPassword = await api('/auth/login', { email, password });
check('senha anterior deixa de valer', oldPassword.status === 401, `status=${oldPassword.status}`);

await owner.end();

const approved = results.filter(Boolean).length;
console.log(`RESUMO: ${approved}/${results.length} verificações de identidade aprovadas`);
process.exit(approved === results.length ? 0 : 1);