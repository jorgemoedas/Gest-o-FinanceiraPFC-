import { z } from 'zod';
import { counterpartyRoleSchema, financeCategorySchema, financeEntryTypeSchema, financeTransactionStatusSchema } from './types';
import { normalizeCnpjInput } from '@/features/business-registry/business-registry-client';

export function parseBrazilianAmount(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  const groupedBrazilian = /^\d{1,3}(?:\.\d{3})+$/;
  let normalized: string;
  if (trimmed.includes(',')) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(trimmed)) return Number.NaN;
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else if (groupedBrazilian.test(trimmed)) {
    normalized = trimmed.replace(/\./g, '');
  } else {
    if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
    normalized = trimmed;
  }
  return Number(normalized);
}

function validIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const transactionDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato dia/mês/ano.')
  .refine(validIsoDate, 'Informe uma data válida.');
const transactionAmountSchema = z.preprocess(
  parseBrazilianAmount,
  z.number({ error: 'Informe um valor válido.' })
    .finite('Informe um valor válido.')
    .min(0.01, 'O valor precisa ser maior que zero.')
    .max(999999999999.99, 'O valor ultrapassa o limite permitido.')
);
const transactionFields = {
  type: financeEntryTypeSchema,
  category: financeCategorySchema,
  subcategory: z.string().trim().min(1, 'Informe uma subcategoria ou deixe o campo vazio.').max(80, 'Use até 80 caracteres.').nullable().optional(),
  description: z.string().trim().min(1, 'Informe uma descrição.').max(160, 'Use até 160 caracteres.'),
  amount: transactionAmountSchema,
  occurredAt: transactionDateSchema,
  dueAt: transactionDateSchema.nullable().optional(),
  counterpartyId: z.string().uuid().nullable().optional(),
  status: z.enum(['PAID', 'PENDING']).optional()
};

function validateCategory(type: z.infer<typeof financeEntryTypeSchema> | undefined, category: z.infer<typeof financeCategorySchema> | undefined, context: z.RefinementCtx) {
  if (!type || !category) return;
  const income = ['SALES', 'SERVICES', 'OTHER'];
  const expense = ['TAXES', 'RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'TRANSPORT', 'SUPPLIERS', 'OTHER'];
  const allowed = type === 'INCOME' ? income : expense;
  if (!allowed.includes(category)) {
    context.addIssue({ code: 'custom', path: ['category'], message: 'A categoria não corresponde ao tipo de lançamento.' });
  }
}

export const transactionInputSchema = z.object(transactionFields).strict().superRefine(({ type, category }, context) => {
  validateCategory(type, category, context);
});

export const transactionUpdateSchema = z.object(transactionFields).partial().strict().superRefine((input, context) => {
  if (Object.keys(input).length === 0) {
    context.addIssue({ code: 'custom', message: 'Informe ao menos um campo para atualizar.' });
  }
  validateCategory(input.type, input.category, context);
});

export const dashboardMonthsSchema = z.union([z.literal(3), z.literal(6), z.literal(12)]);
export const insightsInputSchema = z.object({ months: dashboardMonthsSchema }).strict();
const transactionDateFilterSchema = transactionDateSchema;

export const transactionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(160).optional(),
  type: financeEntryTypeSchema.optional(),
  category: financeCategorySchema.optional(),
  status: financeTransactionStatusSchema.optional(),
  from: transactionDateFilterSchema.optional(),
  to: transactionDateFilterSchema.optional()
}).strict().superRefine((query, context) => {
  if (query.from && query.to && query.from > query.to) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'A data final deve ser igual ou posterior à data inicial.' });
  }
  validateCategory(query.type, query.category, context);
});

export const counterpartyInputSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do cliente ou fornecedor.').max(160, 'Use até 160 caracteres.'),
  role: counterpartyRoleSchema,
  cnpj: z.string().transform(normalizeCnpjInput).pipe(z.string().regex(/^[A-Z0-9]{12}\d{2}$/, 'Informe um CNPJ com 14 caracteres.')).optional()
}).strict();

export const counterpartyListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  role: counterpartyRoleSchema.optional(),
  search: z.string().trim().min(1).max(160).optional()
}).strict();

export type TransactionInput = z.infer<typeof transactionInputSchema>;
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;
