#!/usr/bin/env node
import { tmpdir } from 'node:os';
import path from 'node:path';




import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const { postgresAdapterOptions } = await import('../../dist/database/postgres-connection.js');

const SCHEMA = 'gft_inteligente';
const EMAIL = 'carga-volume@exemplo.invalid';
const COMPANY_NAME = 'Medicao de carga (sintetica)';
const CREDENTIALS_PATH = path.join(tmpdir(), 'gft-load-volume.json');
const metadataArgument = process.argv.find((value) => value.startsWith('--metadata='));
const metadataPath = metadataArgument?.slice(11) ?? process.env.LOAD_METADATA;

if (!process.argv.includes('--confirmar')) {
  console.error('Recusado: este script apaga dados. Repita com --confirmar.');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL ausente no ambiente.');
  process.exit(1);
}

const client = new Client(postgresAdapterOptions(databaseUrl, process.env.DATABASE_CA_CERT));
await client.connect();

try {
  await client.query('BEGIN');

  if (metadataPath) {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    if (metadata.marker !== 'gft-load-massive-v1' || !metadata.companyId || !metadata.userId) {
      throw new Error('Metadata de carga massiva inválido; limpeza cancelada.');
    }
    const apagados = await client.query(
      `DELETE FROM ${SCHEMA}."FinanceTransaction" WHERE "companyId" = $1 RETURNING id`,
      [metadata.companyId]
    );
    const empresa = await client.query(`DELETE FROM ${SCHEMA}."Company" WHERE id = $1 RETURNING id`, [metadata.companyId]);
    const usuario = await client.query(`DELETE FROM ${SCHEMA}."User" WHERE id = $1 AND email = $2 RETURNING id`, [metadata.userId, metadata.email]);
    await client.query('COMMIT');
    rmSync(metadataPath, { force: true });
    console.log(JSON.stringify({ empresas_removidas: empresa.rowCount, lancamentos_removidos: apagados.rowCount, usuarios_removidos: usuario.rowCount, metadata_removido: metadataPath }));
    await client.end().catch(() => undefined);
    process.exit(0);
  }

  const empresas = await client.query(`SELECT id FROM ${SCHEMA}."Company" WHERE name = $1`, [COMPANY_NAME]);
  const ids = empresas.rows.map((linha) => linha.id);
  let lancamentos = 0;

  if (ids.length > 0) {
    const apagados = await client.query(
      `DELETE FROM ${SCHEMA}."FinanceTransaction" WHERE "companyId" = ANY($1::uuid[]) RETURNING id`,
      [ids]
    );
    lancamentos = apagados.rowCount;
    await client.query(`DELETE FROM ${SCHEMA}."Company" WHERE id = ANY($1::uuid[])`, [ids]);
  }

  const usuarios = await client.query(`DELETE FROM ${SCHEMA}."User" WHERE email = $1 RETURNING id`, [EMAIL]);

  await client.query('COMMIT');

  if (existsSync(CREDENTIALS_PATH)) {
    rmSync(CREDENTIALS_PATH);
  }

  console.log(JSON.stringify({ empresas_removidas: ids.length, lancamentos_removidos: lancamentos, usuarios_removidos: usuarios.rowCount }));
} catch (erro) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('Falha na limpeza:', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
