import { z } from 'zod';
import { extractApiMessage } from '@/features/auth/api-message';

const finiteNumber = z.number().finite();
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const analyticsQuerySchema = z.object({
  months: z.union([z.literal(3), z.literal(6), z.literal(12)]),
  projectionMonths: z.union([z.literal(1), z.literal(3), z.literal(6)])
}).strict();

export const analyticsTrendSchema = z.object({
  direction: z.enum(['UP', 'DOWN', 'FLAT']),
  slopePerMonth: finiteNumber,
  changePercent: finiteNumber.nullable(),
  explanation: z.string()
}).strict();

export const analyticsReportSchema = z.object({
  currency: z.literal('BRL'),
  period: z.object({ from: z.string(), to: z.string(), months: z.union([z.literal(3), z.literal(6), z.literal(12)]) }).strict(),
  monthly: z.array(z.object({
    monthKey,
    income: finiteNumber,
    expense: finiteNumber,
    net: finiteNumber,
    transactionCount: z.number().int().nonnegative()
  }).strict()),
  trend: z.object({ income: analyticsTrendSchema, expense: analyticsTrendSchema, net: analyticsTrendSchema }).strict(),
  seasonality: z.object({
    index: z.array(z.object({ month: z.number().int().min(1).max(12), factor: finiteNumber }).strict()).length(12).nullable(),
    monthsObserved: z.number().int().nonnegative(),
    explanation: z.string()
  }).strict(),
  projection: z.array(z.object({ monthKey, income: finiteNumber, expense: finiteNumber, net: finiteNumber }).strict()),
  projectionAssumptions: z.array(z.string()),
  alerts: z.array(z.object({
    code: z.string().min(1),
    severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
    title: z.string(),
    explanation: z.string(),
    source: z.object({ metric: z.string(), value: finiteNumber, reference: z.string() }).strict()
  }).strict())
}).strict();


export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsReport = z.infer<typeof analyticsReportSchema>;

async function requestJson(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
  } catch {
    throw new Error('Não foi possível acessar a análise financeira. Verifique sua conexão e tente novamente.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(extractApiMessage(payload, response.status));
  return payload;
}

export async function getFinanceAnalytics(query: AnalyticsQuery): Promise<AnalyticsReport> {
  const parsedQuery = analyticsQuerySchema.parse(query);
  const params = new URLSearchParams({ months: String(parsedQuery.months), projectionMonths: String(parsedQuery.projectionMonths) });
  const payload = await requestJson(`/api/finance/analytics?${params.toString()}`);
  const parsed = analyticsReportSchema.safeParse(payload);
  if (!parsed.success) throw new Error('A API financeira retornou um relatório de analytics inválido.');
  return parsed.data;
}
