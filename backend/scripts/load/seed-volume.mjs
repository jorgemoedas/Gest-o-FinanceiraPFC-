#!/usr/bin/env node
import { tmpdir } from 'node:os';
import path from 'node:path';




import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const { postgresAdapterOptions } = await import('../../dist/database/postgres-connection.js');

const SCHEMA = 'gft_inteligente';
const CREDENTIALS_PATH = path.join(tmpdir(), 'gft-load-volume.json');
const EMAIL = 'carga-volume@exemplo.invalid';
const COMPANY_NAME = 'Medicao de carga (sintetica)';

const quantity = Number(process.argv[2] ?? 50000);
if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200000) {
  console.error('Quantidade inválida.');
  process.exit(1);
}

function connection() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL ausente no ambiente.');
  }
  return new Client(postgresAdapterOptions(databaseUrl, process.env.DATABASE_CA_CERT));
}

const client = connection();
await client.connect();

try {
  await client.query('BEGIN');

  const existente = await client.query(
    `SELECT id FROM ${SCHEMA}."Company" WHERE name = $1 LIMIT 1`,
    [COMPANY_NAME]
  );

  let companyId;
  let userId;

  if (existente.rowCount === 1) {
    companyId = existente.rows[0].id;
    const membro = await client.query(
      `SELECT "userId" FROM ${SCHEMA}."CompanyMembership" WHERE "companyId" = $1 LIMIT 1`,
      [companyId]
    );
    userId = membro.rows[0].userId;
    console.log('Tenant de medição já existente, reaproveitando.');
  } else {
    const usuario = await client.query(`SELECT id FROM ${SCHEMA}."User" WHERE email = $1`, [EMAIL]);
    if (usuario.rowCount === 1) {
      userId = usuario.rows[0].id;
    } else {
      const password = randomBytes(24).toString('base64url');
      const passwordHash = await bcrypt.hash(password, 12);
      const inserido = await client.query(
        `INSERT INTO ${SCHEMA}."User" (id, email, "passwordHash", status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now()) RETURNING id`,
        [EMAIL, passwordHash]
      );
      userId = inserido.rows[0].id;
      writeFileSync(CREDENTIALS_PATH, JSON.stringify({ email: EMAIL, password }, null, 2), { mode: 0o600 });
      console.log(`Credenciais sintéticas gravadas em ${CREDENTIALS_PATH}.`);
    }

    const empresa = await client.query(
      `INSERT INTO ${SCHEMA}."Company" (id, name, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, now(), now()) RETURNING id`,
      [COMPANY_NAME]
    );
    companyId = empresa.rows[0].id;

    await client.query(
      `INSERT INTO ${SCHEMA}."CompanyMembership" ("userId", "companyId", role, "isActive", "createdAt")
       VALUES ($1, $2, 'OWNER', true, now())`,
      [userId, companyId]
    );
  }

  const antes = await client.query(
    `SELECT count(*)::int AS total FROM ${SCHEMA}."FinanceTransaction" WHERE "companyId" = $1`,
    [companyId]
  );

  const faltam = quantity - antes.rows[0].total;

  if (faltam > 0) {
    console.log(`Inserindo ${faltam} lançamentos sintéticos.`);
    await client.query(
      `INSERT INTO ${SCHEMA}."FinanceTransaction"
         (id, "companyId", "createdByUserId", type, category, description, amount,
          "occurredAt", "dueAt", status, version, "createdAt", "updatedAt")
       SELECT
         gen_random_uuid(),
         $1::uuid,
         $2::uuid,
         (ARRAY['INCOME','EXPENSE'])[1 + (i % 2)]::${SCHEMA}."FinanceEntryType",
         (ARRAY['SALES','SERVICES','TAXES','RENT','PAYROLL','UTILITIES','MARKETING','TRANSPORT','SUPPLIERS','OTHER'])[1 + (i % 10)]::${SCHEMA}."FinanceCategory",
         'Lancamento sintetico de volume ' || i,
         round((random() * 5000 + 50)::numeric, 2),
         (now() - ((i % 730) || ' days')::interval),
         CASE WHEN (i % 3) = 0 THEN (now() - ((i % 730) || ' days')::interval) + interval '15 days' ELSE NULL END,
         (ARRAY['PAID','PENDING'])[1 + (i % 2)]::${SCHEMA}."FinanceTransactionStatus",
         1,
         (now() - ((i % 730) || ' days')::interval),
         now()
       FROM generate_series(1, $3::int) AS s(i)`,
      [companyId, userId, faltam]
    );
  } else {
    console.log('Volume já presente, nenhuma inserção necessária.');
  }

  await client.query('COMMIT');

  const resumo = await client.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'PAID')::int AS pagos,
            count(*) FILTER (WHERE status = 'PENDING')::int AS pendentes,
            min("occurredAt")::date AS inicio,
            max("occurredAt")::date AS fim
       FROM ${SCHEMA}."FinanceTransaction" WHERE "companyId" = $1`,
    [companyId]
  );
  console.log(JSON.stringify({ companyId, userId, ...resumo.rows[0] }, null, 2));
} catch (erro) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('Falha na semeadura:', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
