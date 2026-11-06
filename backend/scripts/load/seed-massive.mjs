#!/usr/bin/env node
import { tmpdir } from 'node:os';
import { join } from 'node:path';



import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const { postgresAdapterOptions } = await import('../../dist/database/postgres-connection.js');

const SCHEMA = 'gft_inteligente';
const runId = randomUUID().slice(0, 8);
const quantityArgument = process.argv.find((value) => /^\d+$/.test(value));
const quantity = Number(quantityArgument ?? process.env.LOAD_QUANTITY ?? 200000);
const chunkArgument = process.argv.find((value) => value.startsWith('--chunk='));
const chunkSize = Math.min(20000, Math.max(1000, Number(chunkArgument?.slice(8) ?? 10000)));
const metadataArgument = process.argv.find((value) => value.startsWith('--metadata='));
const metadataPath = metadataArgument?.slice(11) ?? process.env.LOAD_METADATA ?? join(tmpdir(), 'gft-load-massive.json');
if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200000) throw new Error('A quantidade deve ser um inteiro entre 1 e 200000.');

const companyName = `Carga massiva sintetica ${runId}`;
const email = `carga-massiva-${runId}@exemplo.invalid`;
const password = randomBytes(24).toString('base64url');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL ausente no ambiente.');

const client = new Client(postgresAdapterOptions(databaseUrl, process.env.DATABASE_CA_CERT));
await client.connect();
try {
  await client.query('BEGIN');
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await client.query(
    `INSERT INTO ${SCHEMA}."User" (id, email, "passwordHash", status, "createdAt", "updatedAt") VALUES ($1, $2, $3, 'ACTIVE', now(), now()) RETURNING id`,
    [randomUUID(), email, passwordHash]
  );
  const userId = user.rows[0].id;
  const company = await client.query(
    `INSERT INTO ${SCHEMA}."Company" (id, name, "createdAt", "updatedAt") VALUES ($1, $2, now(), now()) RETURNING id`,
    [randomUUID(), companyName]
  );
  const companyId = company.rows[0].id;
  await client.query(
    `INSERT INTO ${SCHEMA}."CompanyMembership" ("userId", "companyId", role, "isActive", "createdAt") VALUES ($1, $2, 'OWNER', true, now())`,
    [userId, companyId]
  );

  const started = Date.now();
  let inserted = 0;
  while (inserted < quantity) {
    const size = Math.min(chunkSize, quantity - inserted);
    await client.query(
      `INSERT INTO ${SCHEMA}."FinanceTransaction"
        (id, "companyId", "createdByUserId", type, category, description, amount, "occurredAt", "dueAt", status, version, "createdAt", "updatedAt")
       SELECT gen_random_uuid(), $1::uuid, $2::uuid,
         (ARRAY['INCOME','EXPENSE'])[1 + ((i + $3) % 2)]::${SCHEMA}."FinanceEntryType",
         (ARRAY['SALES','SERVICES','TAXES','RENT','PAYROLL','UTILITIES','MARKETING','TRANSPORT','SUPPLIERS','OTHER'])[1 + ((i + $3) % 10)]::${SCHEMA}."FinanceCategory",
         'Lancamento massivo sintetico ' || (i + $3), round((random() * 5000 + 50)::numeric, 2),
         (now() - (((i + $3) % 730) || ' days')::interval),
         CASE WHEN ((i + $3) % 3) = 0 THEN (now() - (((i + $3) % 730) || ' days')::interval) + interval '15 days' ELSE NULL END,
         (ARRAY['PAID','PENDING'])[1 + ((i + $3) % 2)]::${SCHEMA}."FinanceTransactionStatus",
         1, now(), now()
       FROM generate_series(1, $4::int) AS s(i)`,
      [companyId, userId, inserted, size]
    );
    inserted += size;
    console.log(`Inseridos ${inserted}/${quantity}.`);
  }
  await client.query('COMMIT');
  const summary = await client.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'PAID')::int AS pagos, count(*) FILTER (WHERE status = 'PENDING')::int AS pendentes, min("occurredAt")::date AS inicio, max("occurredAt")::date AS fim FROM ${SCHEMA}."FinanceTransaction" WHERE "companyId" = $1`,
    [companyId]
  );
  const metadata = {
    marker: 'gft-load-massive-v1', runId, companyId, userId, companyName, email,
    quantity: summary.rows[0].total, createdAt: new Date().toISOString(), elapsedMs: Date.now() - started,
    resumo: summary.rows[0], credentialsPath: metadataPath
  };
  writeFileSync(metadataPath, JSON.stringify({ ...metadata, password }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...metadata, credentialsPath: metadataPath }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('Falha na semeadura massiva:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
