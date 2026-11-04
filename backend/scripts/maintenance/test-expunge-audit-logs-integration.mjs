#!/usr/bin/env node
/**
 * Integração isolada da retenção de auditoria.
 *
 * O script cria um schema efêmero, nunca toca gft_inteligente e usa a
 * credencial administrativa de DATABASE_URL somente para DDL/DML de teste e
 * para executar o núcleo do expurgo. A conexão em SET ROLE gft_app só pode
 * ler/inserir na tabela sintética; UPDATE e DELETE devem ser negados.
 *
 * Executar a partir de backend:
 *   node scripts/maintenance/test-expunge-audit-logs-integration.mjs
 */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const dotenv = require('dotenv');
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS' }
});
const { postgresAdapterOptions } = require('../../src/database/postgres-connection.ts');
const { calculateCutoffDate, expungeAuditLogs } = require('./expunge-audit-logs-core.cjs');

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? resolve(process.cwd(), '.env'), quiet: true });

function quoteIdentifier(identifier) {
  if (!/^gft_test_audit_[a-f0-9]{12}$/.test(identifier)) {
    throw new Error('Identificador de schema de teste inválido.');
  }
  return `"${identifier}"`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeAdapter(admin, schema) {
  const table = `${quoteIdentifier(schema)}."AuditLog"`;
  return {
    auditLog: {
      async findMany(input) {
        const where = input.where || {};
        const base = where.createdAt || where.AND?.[0]?.createdAt;
        const cutoff = base?.lt;
        const cursor = where.AND?.[1]?.OR;
        const cursorDate = cursor?.[0]?.createdAt?.gt ?? null;
        const cursorId = cursor?.[1]?.id?.gt ?? null;
        const values = [cutoff];
        let predicate = `"createdAt" < $1`;
        if (cursorDate && cursorId) {
          values.push(cursorDate, cursorId);
          predicate += ' AND ("createdAt" > $2 OR ("createdAt" = $2 AND id > $3))';
        }
        values.push(input.take);
        const query = `SELECT id, "companyId", "createdAt" FROM ${table} WHERE ${predicate} ORDER BY "createdAt" ASC, id ASC LIMIT $${values.length}`;
        const result = await admin.query(query, values);
        return result.rows;
      },
      async deleteMany(input) {
        const ids = input.where?.id?.in || [];
        const cutoff = input.where?.createdAt?.lt;
        if (!ids.length) return { count: 0 };
        const result = await admin.query(
          `DELETE FROM ${table} WHERE id = ANY($1::uuid[]) AND "createdAt" < $2`,
          [ids, cutoff]
        );
        return { count: result.rowCount || 0 };
      }
    }
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');
  const schema = `gft_test_audit_${crypto.randomBytes(6).toString('hex')}`;
  const qualifiedSchema = quoteIdentifier(schema);
  const table = `${qualifiedSchema}."AuditLog"`;
  const adapterOptions = postgresAdapterOptions(databaseUrl, process.env.DATABASE_CA_CERT);
  const pool = new Pool({ ...adapterOptions, max: 2, connectionTimeoutMillis: 7000, idleTimeoutMillis: 10000 });
  let admin;
  let schemaCreated = false;
  let evidence;
  const now = new Date();
  const cutoff = calculateCutoffDate(now, 12);
  const oldRows = [
    { id: crypto.randomUUID(), companyId: crypto.randomUUID(), action: 'TEST_OLD_A', createdAt: new Date(cutoff.getTime() - 1000) },
    { id: crypto.randomUUID(), companyId: crypto.randomUUID(), action: 'TEST_OLD_B', createdAt: new Date(cutoff.getTime() - 86_400_000) }
  ];
  const recentRows = [
    { id: crypto.randomUUID(), companyId: crypto.randomUUID(), action: 'TEST_BOUNDARY', createdAt: new Date(cutoff) },
    { id: crypto.randomUUID(), companyId: crypto.randomUUID(), action: 'TEST_RECENT', createdAt: new Date(now.getTime() + 1000) }
  ];
  const allRows = [...oldRows, ...recentRows];
  try {
    admin = await pool.connect();
    await admin.query(`CREATE SCHEMA ${qualifiedSchema}`);
    schemaCreated = true;
    await admin.query(`
      CREATE TABLE ${table} (
        id uuid PRIMARY KEY,
        "companyId" uuid NULL,
        action varchar(80) NOT NULL,
        "createdAt" timestamptz(3) NOT NULL
      )
    `);
    await admin.query(`REVOKE ALL ON SCHEMA ${qualifiedSchema} FROM PUBLIC`);
    await admin.query(`GRANT USAGE ON SCHEMA ${qualifiedSchema} TO gft_app`);
    await admin.query(`REVOKE ALL ON TABLE ${table} FROM PUBLIC`);
    await admin.query(`GRANT SELECT, INSERT ON TABLE ${table} TO gft_app`);
    await admin.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`CREATE POLICY audit_append ON ${table} FOR INSERT WITH CHECK (true)`);
    await admin.query(`CREATE POLICY audit_read ON ${table} FOR SELECT USING (true)`);
    for (const row of allRows) {
      await admin.query(
        `INSERT INTO ${table} (id, "companyId", action, "createdAt") VALUES ($1, $2, $3, $4)`,
        [row.id, row.companyId, row.action, row.createdAt]
      );
    }

    const adapter = makeAdapter(admin, schema);
    const simulation = await expungeAuditLogs({
      prisma: adapter,
      retentionMonths: 12,
      batchSize: 1,
      dryRun: true,
      now,
      logger: { info() {} }
    });
    assert(simulation.totalMatched === oldRows.length, 'A simulação não encontrou exatamente os registros antigos.');
    assert(simulation.totalExpunged === 0, 'A simulação alterou registros.');

    const execution = await expungeAuditLogs({
      prisma: adapter,
      retentionMonths: 12,
      batchSize: 1,
      dryRun: false,
      now,
      logger: { info() {} }
    });
    assert(execution.totalMatched === oldRows.length, 'A execução não encontrou exatamente os registros antigos.');
    assert(execution.totalExpunged === oldRows.length, 'A execução não removeu exatamente os registros antigos.');

    const after = await admin.query(`SELECT id, action FROM ${table} ORDER BY "createdAt" ASC, id ASC`);
    const remainingIds = new Set(after.rows.map((row) => row.id));
    assert(oldRows.every((row) => !remainingIds.has(row.id)), 'Há registro antigo preservado indevidamente.');
    assert(recentRows.every((row) => remainingIds.has(row.id)), 'Há registro novo/borda removido indevidamente.');

    const appClient = await pool.connect();
    let insertAllowed = false;
    let updateDenied = false;
    let deleteDenied = false;
    const appRow = { id: crypto.randomUUID(), companyId: crypto.randomUUID(), action: 'TEST_APPEND', createdAt: new Date(now) };
    try {
      await appClient.query('SET ROLE gft_app');
      await appClient.query(
        `INSERT INTO ${table} (id, "companyId", action, "createdAt") VALUES ($1, $2, $3, $4)`,
        [appRow.id, appRow.companyId, appRow.action, appRow.createdAt]
      );
      insertAllowed = true;
      try {
        await appClient.query(`UPDATE ${table} SET action = 'TEST_UPDATE_DENIED' WHERE id = $1`, [appRow.id]);
      } catch (error) {
        updateDenied = error?.code === '42501';
      }
      try {
        await appClient.query(`DELETE FROM ${table} WHERE id = $1`, [appRow.id]);
      } catch (error) {
        deleteDenied = error?.code === '42501';
      }
    } finally {
      await appClient.query('RESET ROLE').catch(() => {});
      appClient.release();
    }
    assert(insertAllowed, 'gft_app não pôde acrescentar o registro sintético.');
    assert(updateDenied, 'gft_app conseguiu alterar auditoria.');
    assert(deleteDenied, 'gft_app conseguiu excluir auditoria.');

    evidence = {
      schema,
      retentionMonths: 12,
      simulationMatched: simulation.totalMatched,
      simulationDeleted: simulation.totalExpunged,
      executionMatched: execution.totalMatched,
      executionDeleted: execution.totalExpunged,
      oldRowsRemoved: oldRows.length,
      recentRowsPreserved: recentRows.length,
      appRole: 'gft_app',
      appendInsertAllowed: insertAllowed,
      updateDenied,
      deleteDenied
    };
  } finally {
    try {
      if (schemaCreated && admin) {
        await admin.query(`DROP SCHEMA IF EXISTS ${qualifiedSchema} CASCADE`);
        const remaining = await admin.query('SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = $1', [schema]);
        assert(remaining.rows[0].count === 0, 'Schema temporário não removido.');
        if (evidence) evidence.schemaRemoved = true;
      }
    } finally {
      admin?.release();
      await pool.end().catch(() => {});
    }
  }
  console.log(JSON.stringify(evidence));
}

main().catch((error) => {
  console.error(`[audit-expunge-integration] falha operacional: ${error?.code || error?.name || 'Error'}; detalhes omitidos`);
  process.exitCode = 1;
});
