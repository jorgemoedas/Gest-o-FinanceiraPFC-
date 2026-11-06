import { createRequire } from 'node:module';

const loadCommonJs = createRequire(__filename);
const {
  calculateCutoffDate,
  expungeAuditLogs,
  parseCliArgs
} = loadCommonJs('../../../scripts/maintenance/expunge-audit-logs-core.cjs') as {
  calculateCutoffDate: (now: Date, retentionMonths: number) => Date;
  expungeAuditLogs: (input: Record<string, unknown>) => Promise<any>;
  parseCliArgs: (argv: string[]) => { retentionMonths: number; batchSize: number; dryRun: boolean };
};

type AuditRow = { id: string; companyId: string | null; createdAt: Date };

function makePrisma(rows: AuditRow[]) {
  const remaining = [...rows].sort((left, right) => {
    const dateOrder = left.createdAt.getTime() - right.createdAt.getTime();
    return dateOrder || left.id.localeCompare(right.id);
  });
  const auditLog = {
    findMany: jest.fn(async (input: any) => {
      const cutoff = input.where.createdAt?.lt ?? input.where.AND?.[0]?.createdAt.lt;
      const cursor = input.where.AND?.[1]?.OR?.[1]?.id?.gt;
      const cursorDate = input.where.AND?.[1]?.OR?.[0]?.createdAt?.gt;
      return remaining
        .filter((row) => row.createdAt < cutoff)
        .filter((row) => !cursor || row.createdAt > cursorDate || (row.createdAt.getTime() === cursorDate.getTime() && row.id > cursor))
        .slice(0, input.take);
    }),
    deleteMany: jest.fn(async (input: any) => {
      const ids = new Set(input.where.id.in);
      return { count: remaining.filter((row) => ids.has(row.id)).length };
    })
  };
  return { auditLog };
}

describe('expunge-audit-logs maintenance routine', () => {
  const now = new Date('2026-10-22T12:00:00.000Z');

  it('calcula o corte exatamente em 12 meses', () => {
    expect(calculateCutoffDate(now, 12).toISOString()).toBe('2025-10-22T12:00:00.000Z');
    expect(calculateCutoffDate(new Date('2026-03-31T12:00:00.000Z'), 1).toISOString()).toBe('2026-02-28T12:00:00.000Z');
    expect(parseCliArgs([])).toEqual({ retentionMonths: 12, batchSize: 100, dryRun: true });
    expect(parseCliArgs(['--retention-months=18', '--batch-size=2', '--execute'])).toEqual({
      retentionMonths: 18,
      batchSize: 2,
      dryRun: false
    });
  });

  it('em simulação inclui registros anteriores ao corte, não os recentes, conta por empresa e não exclui', async () => {
    const old = new Date('2025-10-22T11:59:59.999Z');
    const recent = new Date('2025-10-22T12:00:00.000Z');
    const prisma = makePrisma([
      { id: 'audit-old-1', companyId: 'company-1', createdAt: old },
      { id: 'audit-old-2', companyId: 'company-2', createdAt: new Date('2024-01-01T00:00:00.000Z') },
      { id: 'audit-boundary', companyId: 'company-1', createdAt: recent },
      { id: 'audit-new', companyId: 'company-1', createdAt: new Date('2026-01-01T00:00:00.000Z') }
    ]);

    const summary = await expungeAuditLogs({
      prisma,
      retentionMonths: 12,
      batchSize: 2,
      now,
      dryRun: true,
      logger: { info: jest.fn() }
    });

    expect(summary).toMatchObject({
      mode: 'simulation',
      dryRun: true,
      totalMatched: 2,
      totalExpunged: 0,
      byCompany: { 'company-1': 1, 'company-2': 1 }
    });
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.findMany).toHaveBeenCalled();
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.createdAt.lt).toEqual(
      new Date('2025-10-22T12:00:00.000Z')
    );
  });
});
