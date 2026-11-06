import { z } from 'zod';

const finiteNumberSchema = z.number().finite();

export const financeDashboardComparisonChangeSchema = z.object({
  amount: finiteNumberSchema,
  percent: finiteNumberSchema.nullable()
}).strict();

export const financeDashboardComparisonSchema = z.object({
  previousPeriod: z.object({ from: z.string(), to: z.string() }).strict(),
  previousSummary: z.object({
    income: finiteNumberSchema,
    expense: finiteNumberSchema,
    net: finiteNumberSchema,
    transactionCount: z.number().int().nonnegative()
  }).strict(),
  changes: z.object({
    income: financeDashboardComparisonChangeSchema,
    expense: financeDashboardComparisonChangeSchema,
    net: financeDashboardComparisonChangeSchema
  }).strict()
}).strict();

export type FinanceDashboardComparison = z.infer<typeof financeDashboardComparisonSchema>;
