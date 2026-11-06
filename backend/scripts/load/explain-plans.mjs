#!/usr/bin/env node
import { tmpdir } from 'node:os';
import { join } from 'node:path';



import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client } = require('pg');
const { postgresAdapterOptions } = await import('../../dist/database/postgres-connection.js');
const SCHEMA = 'gft_inteligente';
const metadataArgument = process.argv.find((value) => value.startsWith('--metadata='));
const metadataPath = metadataArgument?.slice(11) ?? process.env.LOAD_METADATA ?? join(tmpdir(), 'gft-load-massive.json');
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
if (metadata.marker !== 'gft-load-massive-v1' || !metadata.companyId) throw new Error('Metadata de carga massiva inválido.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente no ambiente.');
const client = new Client(postgresAdapterOptions(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT));
await client.connect();
try {
  const plans = {};
  const search = await client.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id, name FROM ${SCHEMA}."FinanceCounterparty" WHERE "companyId" = $1::uuid AND name ILIKE '%' || $2 || '%' ORDER BY name ASC, id ASC LIMIT 100`,
    [metadata.companyId, 'sintetico']
  );
  const period = await client.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id, "occurredAt", amount, status FROM ${SCHEMA}."FinanceTransaction" WHERE "companyId" = $1::uuid AND "occurredAt" >= $2::timestamptz AND "occurredAt" < $3::timestamptz ORDER BY "occurredAt" DESC, "createdAt" DESC LIMIT 100`,
    [metadata.companyId, '2025-01-01T00:00:00Z', '2026-12-31T00:00:00Z']
  );
  await client.query('BEGIN');
  await client.query('SET LOCAL enable_seqscan = off');
  const trigram = await client.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id, name FROM ${SCHEMA}."FinanceCounterparty" WHERE name ILIKE '%' || $1 || '%' ORDER BY name ASC, id ASC LIMIT 100`,
    ['sintetico']
  );
  await client.query('ROLLBACK');
  plans.busca_nome_contraparte = search.rows[0]['QUERY PLAN'][0];
  plans.busca_nome_trigram = trigram.rows[0]['QUERY PLAN'][0];
  plans.listagem_empresa_periodo = period.rows[0]['QUERY PLAN'][0];
  console.log(JSON.stringify({ metadata: { companyId: metadata.companyId, quantity: metadata.quantity }, plans }, null, 2));
} finally {
  await client.end().catch(() => undefined);
}
