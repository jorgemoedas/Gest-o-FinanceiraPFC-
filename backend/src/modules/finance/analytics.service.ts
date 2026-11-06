import { BadRequestException, Injectable } from '@nestjs/common';
import { FinanceEntryType, Prisma } from '../../generated/prisma/client';
import type { AuthPrincipal } from '../../common/auth-principal';
import { PrismaService } from '../../database/prisma.service';
import { setTenantContext } from '../../database/tenant-context';
import { READ_TRANSACTION_OPTIONS, withTransientRetry } from '../../database/transient-retry';
import { linearTrend, percentChange, projectNextWithSeasonalIndex, seasonalIndex, type MonthlyValue } from './analytics-math';

export type AnalyticsQuery = { months: 3 | 6 | 12; projectionMonths: 1 | 3 | 6 };
export type TrendDirection = 'UP' | 'DOWN' | 'FLAT';
export type TrendResult = {
  direction: TrendDirection;
  slopePerMonth: number;
  changePercent: number | null;
  explanation: string;
};
export type AnalyticsAlert = {
  code: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  explanation: string;
  source: { metric: string; value: number; reference: string };
};
export type AnalyticsReport = {
  currency: 'BRL';
  period: { from: string; to: string; months: number };
  monthly: Array<{ monthKey: string; income: number; expense: number; net: number; transactionCount: number }>;
  trend: { income: TrendResult; expense: TrendResult; net: TrendResult };
  seasonality: { index: Array<{ month: number; factor: number }> | null; monthsObserved: number; explanation: string };
  projection: Array<{ monthKey: string; income: number; expense: number; net: number }>;
  projectionAssumptions: string[];
  alerts: AnalyticsAlert[];
};

type PaidAggregateRow = {
  month: Date;
  type: FinanceEntryType;
  category: string;
  amount: Prisma.Decimal;
  transactionCount: number;
};
type OverdueAggregate = { amount: Prisma.Decimal; count: number };
type MonthlyBucket = {
  income: Prisma.Decimal;
  expense: Prisma.Decimal;
  transactionCount: number;
};
type AnalyticsPeriod = { periodFrom: Date; periodTo: Date; historyFrom: Date; today: Date };
type AnalyticsBuckets = {
  fullBuckets: Map<string, MonthlyBucket>;
  reportBuckets: Array<[string, MonthlyBucket]>;
  monthly: AnalyticsReport['monthly'];
  categoryMonths: Map<string, Map<string, Prisma.Decimal>>;
};
type AnalyticsSeasonality = AnalyticsReport['seasonality'];
type ProjectionItem = AnalyticsReport['projection'][number];

const ZERO = () => new Prisma.Decimal(0);
const MONEY_EPSILON = 0.005;

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function emptyBucket(): MonthlyBucket {
  return { income: ZERO(), expense: ZERO(), transactionCount: 0 };
}

function decimalMoney(value: Prisma.Decimal): number {
  return value.toNumber();
}

function amountText(value: Prisma.Decimal | number): string {
  const amount = value instanceof Prisma.Decimal ? value.toNumber() : value;
  return `R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percentText(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function trendDirection(slope: number): TrendDirection {
  if (slope > 0) return 'UP';
  if (slope < 0) return 'DOWN';
  return 'FLAT';
}

function serializeMonthly(key: string, bucket: MonthlyBucket) {
  return {
    monthKey: key,
    income: decimalMoney(bucket.income),
    expense: decimalMoney(bucket.expense),
    net: decimalMoney(bucket.income.minus(bucket.expense)),
    transactionCount: bucket.transactionCount
  };
}

function trendFor(label: string, values: number[]): TrendResult {
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const fitted = linearTrend(values);
  const slope = fitted?.slope ?? 0;
  const normalizedSlope = Math.abs(slope) < MONEY_EPSILON ? 0 : slope;
  const direction = trendDirection(normalizedSlope);
  const change = percentChange(last, first);
  const baseExplanation = `${label}: ${amountText(first)} no primeiro mês e ${amountText(last)} no último; inclinação linear de ${amountText(normalizedSlope)} por mês.`;
  if (!fitted) {
    return {
      direction: 'FLAT',
      slopePerMonth: 0,
      changePercent: change,
      explanation: `${baseExplanation} A série tem menos de três pontos ou é degenerada; não extrapolamos uma tendência.`
    };
  }
  return {
    direction,
    slopePerMonth: normalizedSlope,
    changePercent: change,
    explanation: `${baseExplanation} Direção ${direction === 'UP' ? 'de alta' : direction === 'DOWN' ? 'de baixa' : 'estável'}; variação entre extremos ${change === null ? 'sem base percentual (base zero)' : percentText(change)}.`
  };
}

function average(values: Prisma.Decimal[]): Prisma.Decimal | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum.plus(value), ZERO()).dividedBy(values.length);
}

function source(metric: string, value: number, reference: string) {
  return { metric, value, reference };
}

function validateQuery(query: AnalyticsQuery): void {
  if (![3, 6, 12].includes(query.months) || ![1, 3, 6].includes(query.projectionMonths)) {
    throw new BadRequestException('Os meses devem ser 3, 6 ou 12 e a projeção deve ser 1, 3 ou 6 meses.');
  }
}

function analyticsPeriod(query: AnalyticsQuery, now: Date): AnalyticsPeriod {
  const periodTo = monthStart(now);
  return {
    periodTo,
    periodFrom: addMonths(periodTo, -query.months),
    historyFrom: addMonths(periodTo, -Math.max(24, query.months)),
    today: startOfUtcDay(now)
  };
}

function aggregateRows(rows: PaidAggregateRow[], period: AnalyticsPeriod, months: number): AnalyticsBuckets {
  const fullBuckets = new Map<string, MonthlyBucket>();
  for (let cursor = period.historyFrom; cursor < period.periodTo; cursor = addMonths(cursor, 1)) {
    fullBuckets.set(monthKey(cursor), emptyBucket());
  }
  const reportMonthKeys = new Set(Array.from({ length: months }, (_, index) => monthKey(addMonths(period.periodTo, index - months))));
  const categoryMonths = new Map<string, Map<string, Prisma.Decimal>>();
  for (const row of rows) {
    const key = monthKey(new Date(row.month));
    const bucket = fullBuckets.get(key);
    if (!bucket) continue;
    bucket.transactionCount += row.transactionCount;
    if (row.type === FinanceEntryType.INCOME) {
      bucket.income = bucket.income.plus(row.amount);
      continue;
    }
    bucket.expense = bucket.expense.plus(row.amount);
    if (!reportMonthKeys.has(key)) continue;
    const byMonth = categoryMonths.get(row.category) ?? new Map<string, Prisma.Decimal>();
    byMonth.set(key, (byMonth.get(key) ?? ZERO()).plus(row.amount));
    categoryMonths.set(row.category, byMonth);
  }
  const reportBuckets = Array.from(fullBuckets.entries()).slice(-months);
  return {
    fullBuckets,
    reportBuckets,
    monthly: reportBuckets.map(([key, bucket]) => serializeMonthly(key, bucket)),
    categoryMonths
  };
}

function buildSeasonality(fullBuckets: Map<string, MonthlyBucket>): AnalyticsSeasonality {
  const fullMonthly = Array.from(fullBuckets.entries()).map(([key, bucket]) => serializeMonthly(key, bucket));
  const observed: MonthlyValue[] = fullMonthly
    .filter((item) => item.transactionCount > 0)
    .map((item) => ({ monthKey: item.monthKey, value: item.income + item.expense }));
  const seasonal = seasonalIndex(observed);
  return {
    index: seasonal.index?.map((factor, index) => ({ month: index + 1, factor })) ?? null,
    monthsObserved: seasonal.monthsObserved,
    explanation: seasonal.index
      ? `Índice sazonal multiplicativo calculado com ${seasonal.monthsObserved} meses observados; fatores ausentes no calendário usam 1,00.`
      : (seasonal.reason ?? `Não há base sazonal suficiente: ${seasonal.monthsObserved} meses observados.`)
  };
}

function buildProjection(monthly: AnalyticsReport['monthly'], months: number, index: number[] | null): ProjectionItem[] {
  const incomeHistory = monthly.map((item) => ({ monthKey: item.monthKey, value: item.income }));
  const expenseHistory = monthly.map((item) => ({ monthKey: item.monthKey, value: item.expense }));
  const projectionIncome = projectNextWithSeasonalIndex(incomeHistory, months, index);
  const projectionExpense = projectNextWithSeasonalIndex(expenseHistory, months, index);
  return projectionIncome.map((income, position) => {
    const expense = projectionExpense[position]?.value ?? 0;
    const net = new Prisma.Decimal(income.value).minus(new Prisma.Decimal(expense)).toNumber();
    return { monthKey: income.monthKey, income: income.value, expense, net };
  });
}

function addExpenseGrowthAlert(
  alerts: AnalyticsAlert[],
  reportBuckets: Array<[string, MonthlyBucket]>,
  monthly: AnalyticsReport['monthly']
): void {
  const previousAverage = average(reportBuckets.slice(0, -1).map(([, bucket]) => bucket.expense));
  const lastBucket = reportBuckets[reportBuckets.length - 1]?.[1] ?? emptyBucket();
  const lastMonth = monthly[monthly.length - 1];
  if (!previousAverage || previousAverage.isZero() || !lastBucket.expense.gt(previousAverage.times('1.20'))) return;
  const growth = percentChange(lastBucket.expense.toNumber(), previousAverage.toNumber()) ?? 0;
  alerts.push({
    code: 'EXPENSE_GROWTH',
    severity: 'WARNING',
    title: 'Despesas aceleraram no último mês fechado',
    explanation: `A despesa total foi ${amountText(lastBucket.expense)} em ${lastMonth.monthKey}, contra média de ${amountText(previousAverage)} nos ${Math.max(0, monthly.length - 1)} meses anteriores: crescimento de ${percentText(growth)} (acima de 20%).`,
    source: source('expense.total', growth, `${lastMonth.monthKey} versus média anterior`)
  });
}

function addCategoryGrowthAlerts(
  alerts: AnalyticsAlert[],
  categoryMonths: Map<string, Map<string, Prisma.Decimal>>,
  monthly: AnalyticsReport['monthly']
): void {
  const lastMonth = monthly[monthly.length - 1];
  const previousMonths = monthly.slice(0, -1);
  for (const [category, byMonth] of categoryMonths) {
    const current = byMonth.get(lastMonth.monthKey) ?? ZERO();
    const prior = average(previousMonths.map((item) => byMonth.get(item.monthKey) ?? ZERO()));
    if (!prior || prior.isZero() || !current.gt(prior.times('1.30'))) continue;
    const growth = percentChange(current.toNumber(), prior.toNumber()) ?? 0;
    alerts.push({
      code: 'CATEGORY_EXPENSE_GROWTH',
      severity: 'WARNING',
      title: `Categoria ${category} cresceu acima do limite`,
      explanation: `A categoria ${category} somou ${amountText(current)} em ${lastMonth.monthKey}, contra média de ${amountText(prior)} nos meses anteriores: crescimento de ${percentText(growth)} (acima de 30%).`,
      source: source(`expense.category.${category}`, growth, `${lastMonth.monthKey} versus média anterior`)
    });
  }
}

function addOverdueAlert(alerts: AnalyticsAlert[], overdue: OverdueAggregate[], today: Date): void {
  const overdueAmount = overdue[0]?.amount ?? ZERO();
  const overdueCount = overdue[0]?.count ?? 0;
  if (overdueCount === 0) return;
  const day = today.toISOString().slice(0, 10);
  alerts.push({
    code: 'OVERDUE_RECEIVABLES',
    severity: 'WARNING',
    title: 'Contas a receber estão atrasadas',
    explanation: `Existem ${overdueCount} contas PENDING/INCOME vencidas até ${day}, totalizando ${amountText(overdueAmount)}.`,
    source: source('receivables.overdue', overdueAmount.toNumber(), `PENDING/INCOME com dueAt anterior a ${day}`)
  });
}

function addNegativeProjectionAlert(alerts: AnalyticsAlert[], projection: ProjectionItem[]): void {
  const negative = projection.find((item) => item.net < 0);
  if (!negative) return;
  alerts.push({
    code: 'NEGATIVE_PROJECTED_NET',
    severity: 'CRITICAL',
    title: 'Saldo líquido projetado negativo',
    explanation: `O saldo líquido projetado para ${negative.monthKey} é ${amountText(negative.net)}, com receitas de ${amountText(negative.income)} e despesas de ${amountText(negative.expense)}.`,
    source: source('projection.net', negative.net, negative.monthKey)
  });
}

function addRevenueConcentrationAlert(alerts: AnalyticsAlert[], reportBuckets: Array<[string, MonthlyBucket]>, monthly: AnalyticsReport['monthly']): void {
  const totalIncome = reportBuckets.reduce((sum, [, bucket]) => sum.plus(bucket.income), ZERO());
  if (totalIncome.isZero()) return;
  const concentratedEntry = reportBuckets.reduce((current, entry) => entry[1].income.gt(current[1].income) ? entry : current, reportBuckets[0]);
  const concentratedMonth = monthly.find((item) => item.monthKey === concentratedEntry?.[0]);
  const concentratedIncome = concentratedEntry?.[1].income ?? ZERO();
  const concentration = concentratedIncome.dividedBy(totalIncome).times(100).toNumber();
  if (concentration < 70) return;
  alerts.push({
    code: 'REVENUE_CONCENTRATION',
    severity: 'INFO',
    title: 'Receita concentrada em um único mês',
    explanation: `${concentratedMonth?.monthKey ?? 'O período'} concentra ${amountText(concentratedIncome)} de ${amountText(totalIncome)}, ou ${percentText(concentration)} da receita dos ${monthly.length} meses.`,
    source: source('income.concentration', concentration, concentratedMonth?.monthKey ?? 'período')
  });
}

function buildAlerts(
  buckets: AnalyticsBuckets,
  overdue: OverdueAggregate[],
  projection: ProjectionItem[],
  today: Date
): AnalyticsAlert[] {
  const alerts: AnalyticsAlert[] = [];
  addExpenseGrowthAlert(alerts, buckets.reportBuckets, buckets.monthly);
  addCategoryGrowthAlerts(alerts, buckets.categoryMonths, buckets.monthly);
  addOverdueAlert(alerts, overdue, today);
  addNegativeProjectionAlert(alerts, projection);
  addRevenueConcentrationAlert(alerts, buckets.reportBuckets, buckets.monthly);
  return alerts;
}

function buildReport(query: AnalyticsQuery, period: AnalyticsPeriod, buckets: AnalyticsBuckets, overdue: OverdueAggregate[]): AnalyticsReport {
  const seasonality = buildSeasonality(buckets.fullBuckets);
  const projection = buildProjection(buckets.monthly, query.projectionMonths, seasonality.index?.map((item) => item.factor) ?? null);
  const trendInput = buckets.monthly;
  return {
    currency: 'BRL',
    period: { from: period.periodFrom.toISOString(), to: period.periodTo.toISOString(), months: query.months },
    monthly: buckets.monthly,
    trend: {
      income: trendFor('Receita', trendInput.map((item) => item.income)),
      expense: trendFor('Despesa', trendInput.map((item) => item.expense)),
      net: trendFor('Saldo líquido', trendInput.map((item) => item.net))
    },
    seasonality,
    projection,
    projectionAssumptions: [
      'A projeção usa a tendência linear dos meses observados.',
      seasonality.index
        ? 'Quando há base suficiente, aplica-se o índice sazonal multiplicativo por mês do calendário.'
        : `O índice sazonal não foi aplicado: ${seasonality.explanation}`,
      'Quando a série é curta ou degenerada, mantém-se o patamar atual em vez de extrapolar uma tendência.',
      'Assume-se ausência de eventos atípicos futuros; a projeção não é uma previsão garantida.',
      'Qualquer valor projetado negativo ou não finito é limitado a zero e deve ser interpretado como degradação do modelo.'
    ],
    alerts: buildAlerts(buckets, overdue, projection, period.today)
  };
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(principal: AuthPrincipal, query: AnalyticsQuery): Promise<AnalyticsReport> {
    validateQuery(query);
    const period = analyticsPeriod(query, new Date());
    const { paidAggregates, overdue } = await this.readAggregates(principal, period);
    const report = buildReport(query, period, aggregateRows(paidAggregates, period, query.months), overdue);
    await this.auditReport(principal, query, report);
    return report;
  }

  private async readAggregates(principal: AuthPrincipal, period: AnalyticsPeriod): Promise<{ paidAggregates: PaidAggregateRow[]; overdue: OverdueAggregate[] }> {
    return withTransientRetry(
      () => this.prisma.$transaction(async (tx) => {
        await setTenantContext(tx, principal);
        const [paidAggregates, overdue] = await Promise.all([
          tx.$queryRaw<PaidAggregateRow[]>`
          SELECT date_trunc('month', "occurredAt", 'UTC') AS "month",
            "type", "category", SUM("amount")::numeric AS "amount", COUNT(*)::int AS "transactionCount"
          FROM "gft_inteligente"."FinanceTransaction"
          WHERE "companyId" = ${principal.companyId}::uuid
            AND "occurredAt" >= ${period.historyFrom}
            AND "occurredAt" < ${period.periodTo}
            AND "status" = 'PAID'
            AND ("adjustmentKind" IS NULL OR "adjustmentKind" = 'REFUND')
          GROUP BY 1, "type", "category"
          `,
          tx.$queryRaw<OverdueAggregate[]>`
          SELECT COALESCE(SUM("amount"), 0)::numeric AS "amount", COUNT(*)::int AS "count"
          FROM "gft_inteligente"."FinanceTransaction"
          WHERE "companyId" = ${principal.companyId}::uuid
            AND "type" = 'INCOME'
            AND "status" = 'PENDING'
            AND "reversalOfId" IS NULL
            AND "adjustmentKind" IS NULL
            AND "dueAt" < ${period.today}
          `
        ]);
        return { paidAggregates, overdue };
      }, READ_TRANSACTION_OPTIONS),
      { operation: 'finance.analytics.read', writeSafety: 'read-only' }
    );
  }

  private async auditReport(principal: AuthPrincipal, query: AnalyticsQuery, report: AnalyticsReport): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      await tx.auditLog.create({
        data: {
          actorUserId: principal.userId,
          companyId: principal.companyId,
          action: 'FINANCE_ANALYTICS_VIEWED',
          entityType: 'Analytics',
          metadata: {
            months: query.months,
            projectionMonths: query.projectionMonths,
            monthlyCount: report.monthly.length,
            projectionCount: report.projection.length,
            transactionCount: report.monthly.reduce((count, item) => count + item.transactionCount, 0),
            alertCount: report.alerts.length,
            seasonalityMonthsObserved: report.seasonality.monthsObserved
          }
        }
      });
    }, READ_TRANSACTION_OPTIONS);
  }
}
