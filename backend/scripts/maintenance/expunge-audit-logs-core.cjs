'use strict';

const DEFAULT_RETENTION_MONTHS = 12;
const DEFAULT_BATCH_SIZE = 100;
const UNASSIGNED_COMPANY = '(sem empresa)';

function positiveInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} deve ser um inteiro positivo.`);
  }
  return parsed;
}

function parseCliArgs(argv = []) {
  let retentionMonths = DEFAULT_RETENTION_MONTHS;
  let batchSize = DEFAULT_BATCH_SIZE;
  let dryRun = true;

  for (const argument of argv) {
    if (argument === '--dry-run' || argument === '--simulate') {
      dryRun = true;
      continue;
    }
    if (argument === '--execute') {
      dryRun = false;
      continue;
    }
    const retentionMatch = argument.match(/^--(?:retention-months|months)=(.+)$/);
    if (retentionMatch) {
      retentionMonths = positiveInteger(retentionMatch[1], '--retention-months');
      continue;
    }
    const batchMatch = argument.match(/^--batch-size=(.+)$/);
    if (batchMatch) {
      batchSize = positiveInteger(batchMatch[1], '--batch-size');
      continue;
    }
    throw new Error(`Parâmetro não reconhecido: ${argument}`);
  }

  return { retentionMonths, batchSize, dryRun };
}

function calculateCutoffDate(now, retentionMonths) {
  const months = positiveInteger(retentionMonths, 'retentionMonths');
  const reference = new Date(now);
  if (Number.isNaN(reference.getTime())) throw new Error('now deve ser uma data válida.');
  const originalDay = reference.getUTCDate();
  const targetMonth = reference.getUTCMonth() - months;
  const cutoff = new Date(Date.UTC(
    reference.getUTCFullYear(),
    targetMonth,
    1,
    reference.getUTCHours(),
    reference.getUTCMinutes(),
    reference.getUTCSeconds(),
    reference.getUTCMilliseconds()
  ));
  const lastDayOfTargetMonth = new Date(Date.UTC(
    cutoff.getUTCFullYear(),
    cutoff.getUTCMonth() + 1,
    0
  )).getUTCDate();
  cutoff.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return cutoff;
}

function nextPageWhere(cutoff, lastRow) {
  const base = { createdAt: { lt: cutoff } };
  if (!lastRow) return base;
  return {
    AND: [
      base,
      {
        OR: [
          { createdAt: { gt: lastRow.createdAt } },
          { createdAt: lastRow.createdAt, id: { gt: lastRow.id } }
        ]
      }
    ]
  };
}

function incrementCompanyCount(byCompany, companyId, count) {
  const key = companyId || UNASSIGNED_COMPANY;
  byCompany[key] = (byCompany[key] || 0) + count;
}

async function expungeAuditLogs({
  prisma,
  retentionMonths = DEFAULT_RETENTION_MONTHS,
  dryRun = true,
  batchSize = DEFAULT_BATCH_SIZE,
  now = new Date(),
  logger = console
}) {
  if (!prisma || !prisma.auditLog) throw new Error('É necessário fornecer um cliente Prisma com auditLog.');
  const safeBatchSize = positiveInteger(batchSize, 'batchSize');
  const cutoff = calculateCutoffDate(now, retentionMonths);
  const byCompany = {};
  const batches = [];
  let lastRow;
  let totalMatched = 0;
  let totalExpunged = 0;

  while (true) {
    const rows = await prisma.auditLog.findMany({
      where: nextPageWhere(cutoff, lastRow),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: safeBatchSize,
      select: { id: true, companyId: true, createdAt: true }
    });
    if (rows.length === 0) break;

    const batchCompanyCounts = {};
    for (const row of rows) {
      incrementCompanyCount(byCompany, row.companyId, 1);
      incrementCompanyCount(batchCompanyCounts, row.companyId, 1);
    }
    totalMatched += rows.length;

    let deletedCount = 0;
    if (!dryRun) {
      const deletion = await prisma.auditLog.deleteMany({
        where: {
          id: { in: rows.map((row) => row.id) },
          createdAt: { lt: cutoff }
        }
      });
      deletedCount = deletion.count;
      totalExpunged += deletedCount;
    }

    const batch = {
      count: rows.length,
      deletedCount,
      companyCounts: batchCompanyCounts,
      firstCreatedAt: new Date(rows[0].createdAt).toISOString(),
      lastCreatedAt: new Date(rows[rows.length - 1].createdAt).toISOString()
    };
    batches.push(batch);
    logger.info?.('[audit-expunge] lote processado', batch);

    lastRow = rows[rows.length - 1];
    if (rows.length < safeBatchSize) break;
  }

  const summary = {
    mode: dryRun ? 'simulation' : 'execution',
    dryRun,
    retentionMonths: Number(retentionMonths),
    cutoff: cutoff.toISOString(),
    totalMatched,
    totalExpunged: dryRun ? 0 : totalExpunged,
    byCompany,
    batches
  };
  logger.info?.('[audit-expunge] resumo', summary);
  return summary;
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  DEFAULT_RETENTION_MONTHS,
  UNASSIGNED_COMPANY,
  calculateCutoffDate,
  expungeAuditLogs,
  parseCliArgs
};
