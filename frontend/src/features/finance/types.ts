import { z } from 'zod';

export const financeEntryTypeSchema = z.enum(['INCOME', 'EXPENSE']);
export const financeCategorySchema = z.enum([
  'SALES',
  'SERVICES',
  'TAXES',
  'RENT',
  'PAYROLL',
  'UTILITIES',
  'MARKETING',
  'TRANSPORT',
  'SUPPLIERS',
  'OTHER'
]);
const finiteNumberSchema = z.number().finite();

export const financeTransactionSchema = z.object({
  id: z.string().uuid(),
  type: financeEntryTypeSchema,
  category: financeCategorySchema,
  description: z.string(),
  amount: finiteNumberSchema,
  occurredAt: z.string()
}).strict();

export const financeDashboardSchema = z.object({
  currency: z.literal('BRL'),
  period: z.object({ months: z.number().int(), from: z.string(), to: z.string() }).strict(),
  summary: z.object({
    income: finiteNumberSchema,
    expense: finiteNumberSchema,
    net: finiteNumberSchema,
    transactionCount: z.number().int().nonnegative()
  }).strict(),
  monthly: z.array(z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    label: z.string(),
    income: finiteNumberSchema,
    expense: finiteNumberSchema,
    net: finiteNumberSchema
  }).strict()),
  expensesByCategory: z.array(z.object({
    category: financeCategorySchema,
    amount: finiteNumberSchema,
    sharePercent: finiteNumberSchema
  }).strict()),
  recentTransactions: z.array(financeTransactionSchema)
}).strict();

export const financeTransactionListSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  items: z.array(financeTransactionSchema)
}).strict();

export const financeInsightSchema = z.object({
  generated: z.boolean(),
  model: z.string().nullable(),
  generatedAt: z.string().optional(),
  insights: z.string()
}).strict();

export type FinanceEntryType = z.infer<typeof financeEntryTypeSchema>;
export type FinanceCategory = z.infer<typeof financeCategorySchema>;
export type FinanceTransaction = z.infer<typeof financeTransactionSchema>;
export type FinanceTransactionList = z.infer<typeof financeTransactionListSchema>;
export type FinanceTransactionListQuery = {
  page: number;
  limit: number;
  search?: string;
  type?: FinanceEntryType;
  category?: FinanceCategory;
  from?: string;
  to?: string;
};
export type FinanceDashboard = z.infer<typeof financeDashboardSchema>;
export type FinanceInsight = z.infer<typeof financeInsightSchema>;
