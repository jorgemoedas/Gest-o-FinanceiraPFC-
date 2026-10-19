import { z } from 'zod';
import { financeCategorySchema, financeEntryTypeSchema } from './types';

export function parseBrazilianAmount(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed;
  return Number(normalized);
}

function validIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const transactionInputSchema = z.object({
  type: financeEntryTypeSchema,
  category: financeCategorySchema,
  description: z.string().trim().min(1, 'Informe uma descrição.').max(160, 'Use até 160 caracteres.'),
  amount: z.preprocess(
    parseBrazilianAmount,
    z.number({ error: 'Informe um valor válido.' })
      .finite('Informe um valor válido.')
      .min(0.01, 'O valor precisa ser maior que zero.')
      .max(999999999999.99, 'O valor ultrapassa o limite permitido.')
  ),
  occurredAt: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato dia/mês/ano.')
    .refine(validIsoDate, 'Informe uma data válida.')
}).strict();

export const dashboardMonthsSchema = z.union([z.literal(3), z.literal(6), z.literal(12)]);
export const insightsInputSchema = z.object({ months: dashboardMonthsSchema }).strict();
const transactionDateFilterSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data no formato dia/mês/ano.')
  .refine(validIsoDate, 'Informe uma data válida.');

export const transactionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(160).optional(),
  type: financeEntryTypeSchema.optional(),
  category: financeCategorySchema.optional(),
  from: transactionDateFilterSchema.optional(),
  to: transactionDateFilterSchema.optional()
}).strict().superRefine((query, context) => {
  if (query.from && query.to && query.from > query.to) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'A data final deve ser igual ou posterior à data inicial.' });
  }
  if (query.type && query.category) {
    const income = ['SALES', 'SERVICES', 'OTHER'];
    const expense = ['TAXES', 'RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'TRANSPORT', 'SUPPLIERS', 'OTHER'];
    const allowed = query.type === 'INCOME' ? income : expense;
    if (!allowed.includes(query.category)) {
      context.addIssue({ code: 'custom', path: ['category'], message: 'A categoria não corresponde ao tipo de lançamento.' });
    }
  }
});

export type TransactionInput = z.infer<typeof transactionInputSchema>;
