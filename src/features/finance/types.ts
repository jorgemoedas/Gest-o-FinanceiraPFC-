import { z } from 'zod';
import { financeDashboardComparisonSchema } from './finance-dashboard-comparison';

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
export const financeTransactionStatusSchema = z.enum(['PAID', 'PENDING', 'OVERDUE', 'CANCELLED', 'REVERSED', 'REFUNDED']);
export const counterpartyRoleSchema = z.enum(['CUSTOMER', 'SUPPLIER', 'BOTH']);
const finiteNumberSchema = z.number().finite();
export const financeCounterpartySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(160),
  role: counterpartyRoleSchema,
  cnpj: z.string().regex(/^[A-Z0-9]{12}\d{2}$/).nullable().optional(),
  legalName: z.string().min(1).max(200).nullable().optional(),
  tradeName: z.string().max(200).nullable().optional(),
  source: z.literal('ReceitaWS').nullable().optional(),
  consultedAt: z.string().datetime().nullable().optional()
}).strict();
export const financeCounterpartyListSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  items: z.array(financeCounterpartySchema)
}).strict();
const openBalanceSchema = z.object({
  amount: finiteNumberSchema,
  count: z.number().int().nonnegative()
}).strict();

export const financeTransactionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  type: financeEntryTypeSchema,
  category: financeCategorySchema,
  subcategory: z.string().nullable(),
  counterpartyId: z.string().uuid().nullable(),
  counterparty: financeCounterpartySchema.nullable(),
  description: z.string(),
  amount: finiteNumberSchema,
  occurredAt: z.string(),
  dueAt: z.string().nullable(),
  hasAdjustment: z.boolean(),
  status: financeTransactionStatusSchema
}).strict();

export const financeDashboardSchema = z.object({
  currency: z.literal('BRL'),
  period: z.object({ months: z.number().int(), from: z.string(), to: z.string() }).strict(),
  comparison: financeDashboardComparisonSchema,
  summary: z.object({
    income: finiteNumberSchema,
    expense: finiteNumberSchema,
    net: finiteNumberSchema,
    transactionCount: z.number().int().nonnegative()
  }).strict(),
  openBalances: z.object({
    receivables: openBalanceSchema,
    payables: openBalanceSchema,
    overdueReceivables: openBalanceSchema,
    overduePayables: openBalanceSchema
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

export const financeTransactionCancellationSchema = z.object({
  cancelled: z.literal(true),
  adjustmentKind: z.enum(['VOID']).nullable(),
  reversalId: z.string().uuid().nullable()
}).strict();

export const financeTransactionRefundSchema = z.object({
  refunded: z.literal(true),
  adjustmentId: z.string().uuid()
}).strict();

export const financeInsightSchema = z.object({
  generated: z.boolean(),
  model: z.string().nullable(),
  generatedAt: z.string().optional(),
  insights: z.string()
}).strict();

export type FinanceEntryType = z.infer<typeof financeEntryTypeSchema>;
export type FinanceCategory = z.infer<typeof financeCategorySchema>;
export type FinanceTransactionStatus = z.infer<typeof financeTransactionStatusSchema>;
export type CounterpartyRole = z.infer<typeof counterpartyRoleSchema>;
export type FinanceCounterparty = z.infer<typeof financeCounterpartySchema>;
export type FinanceCounterpartyList = z.infer<typeof financeCounterpartyListSchema>;
export type FinanceTransaction = z.infer<typeof financeTransactionSchema>;
export type FinanceTransactionList = z.infer<typeof financeTransactionListSchema>;
export type FinanceTransactionListQuery = {
  page: number;
  limit: number;
  search?: string;
  type?: FinanceEntryType;
  category?: FinanceCategory;
  status?: FinanceTransactionStatus;
  from?: string;
  to?: string;
};
export type FinanceCounterpartyListQuery = {
  page?: number;
  limit?: number;
  role?: CounterpartyRole;
  search?: string;
};
export type FinanceDashboard = z.infer<typeof financeDashboardSchema>;
export type FinanceInsight = z.infer<typeof financeInsightSchema>;
