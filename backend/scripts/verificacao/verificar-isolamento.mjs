import pg from 'pg';
import { postgresAdapterOptions } from '../../dist/database/postgres-connection.js';

const SCHEMA = 'gft_inteligente';
const adminDsn = process.env.DATABASE_URL;
const ca = process.env.DATABASE_CA_CERT;


const PAPEL_LIMITADO = 'gft_app';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const admin = new pg.Client(postgresAdapterOptions(adminDsn, ca));
await admin.connect();
const truth = await admin.query(
  `SELECT "companyId"::text AS company, count(*)::int AS total
   FROM ${SCHEMA}."FinanceTransaction" GROUP BY 1 ORDER BY 2 DESC LIMIT 4`
);
const expected = Object.fromEntries(truth.rows.map((row) => [row.company, row.total]));
const companies = truth.rows.map((row) => row.company);
await admin.end();

const app = new pg.Client(postgresAdapterOptions(adminDsn, ca));
await app.connect();

await app.query('BEGIN');
await app.query(`SET LOCAL ROLE ${PAPEL_LIMITADO}`);
const papel = await app.query('SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user');
await app.query('ROLLBACK');
check('papel restrito não contorna RLS', papel.rows[0].rolbypassrls === false);

await app.query('BEGIN');
await app.query(`SET LOCAL ROLE ${PAPEL_LIMITADO}`);
const withoutContext = await app.query(`SELECT count(*)::int AS total FROM ${SCHEMA}."FinanceTransaction"`);
await app.query('ROLLBACK');
check('sem contexto nenhuma linha é visível', withoutContext.rows[0].total === 0, `total=${withoutContext.rows[0].total}`);

for (const company of companies.slice(0, 2)) {
  await app.query('BEGIN');
await app.query(`SET LOCAL ROLE ${PAPEL_LIMITADO}`);
  await app.query(`SELECT set_config('gft.company_id', $1, true)`, [company]);
  const scoped = await app.query(`SELECT count(*)::int AS total FROM ${SCHEMA}."FinanceTransaction"`);
  await app.query('ROLLBACK');
  check(`empresa ${company.slice(0, 8)} vê apenas as próprias linhas`, scoped.rows[0].total === expected[company], `visto=${scoped.rows[0].total} esperado=${expected[company]}`);
}

const other = companies[1];
await app.query('BEGIN');
await app.query(`SET LOCAL ROLE ${PAPEL_LIMITADO}`);
await app.query(`SELECT set_config('gft.company_id', $1, true)`, [companies[0]]);
const leaked = await app.query(`SELECT count(*)::int AS total FROM ${SCHEMA}."FinanceTransaction" WHERE "companyId" = $1`, [other]);
await app.query('ROLLBACK');
check('empresa não enxerga lançamentos de outra', leaked.rows[0].total === 0, `vazamento=${leaked.rows[0].total}`);

await app.query('BEGIN');
await app.query(`SET LOCAL ROLE ${PAPEL_LIMITADO}`);
await app.query(`SELECT set_config('gft.company_id', $1, true)`, [companies[0]]);
let blocked = false;
let reason = '';
try {
  await app.query(
    `INSERT INTO ${SCHEMA}."FinanceCounterparty" ("id","companyId","name","role","createdAt","updatedAt")
     VALUES (gen_random_uuid(), $1, 'Teste de isolamento', 'CUSTOMER', now(), now())`,
    [other]
  );
} catch (error) {
  blocked = true;
  reason = error.code;
}
await app.query('ROLLBACK');
check('gravação para outra empresa é recusada', blocked, `código=${reason}`);

await app.query('BEGIN');
await app.query(`SET LOCAL ROLE ${PAPEL_LIMITADO}`);
await app.query(`SELECT set_config('gft.company_id', $1, true)`, [companies[0]]);
let allowed = false;
try {
  await app.query(
    `INSERT INTO ${SCHEMA}."FinanceCounterparty" ("id","companyId","name","role","createdAt","updatedAt")
     VALUES (gen_random_uuid(), $1, 'Teste de isolamento', 'CUSTOMER', now(), now())`,
    [companies[0]]
  );
  allowed = true;
} catch (error) {
  allowed = false;
}
await app.query('ROLLBACK');
check('gravação para a própria empresa é aceita', allowed);

await app.end();

const failed = results.filter((item) => !item.ok);
console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} verificações de isolamento aprovadas`);
if (failed.length > 0) {
  console.log('FALHAS: ' + failed.map((item) => item.name).join(', '));
  process.exit(1);
}
