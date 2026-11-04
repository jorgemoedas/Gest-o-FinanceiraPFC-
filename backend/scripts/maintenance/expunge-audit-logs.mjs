import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEFAULT_RETENTION_MONTHS,
  expungeAuditLogs,
  parseCliArgs
} = require('./expunge-audit-logs-core.cjs');

export { DEFAULT_RETENTION_MONTHS, expungeAuditLogs, parseCliArgs };

async function createMaintenancePrisma() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada.');

  // O build do backend fornece o PrismaClient gerado com o schema gft_inteligente.
  // A rotina não imprime a URL, o certificado nem qualquer credencial.
  const [{ PrismaPg }, { PrismaClient }, { postgresAdapterOptions }] = await Promise.all([
    import('@prisma/adapter-pg'),
    import('../../dist/generated/prisma/client.js'),
    import('../../dist/database/postgres-connection.js')
  ]);
  const adapter = new PrismaPg(
    postgresAdapterOptions(databaseUrl, process.env.DATABASE_CA_CERT)
  );
  return new PrismaClient({ adapter });
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const prisma = await createMaintenancePrisma();
  try {
    await expungeAuditLogs({ prisma, ...options, logger: console });
  } finally {
    await prisma.$disconnect();
  }
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((error) => {
    console.error(`[audit-expunge] falha: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
