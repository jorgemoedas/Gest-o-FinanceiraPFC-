import { z } from 'zod';
import { financeCategorySchema, financeTransactionSchema } from './types';

export const bulkTransactionItemSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive()
}).strict();

export const bulkTransactionChangesSchema = z.object({
  category: financeCategorySchema.optional(),
  subcategory: z.string().trim().min(1).max(80).nullable().optional(),
  status: z.enum(['PAID', 'PENDING']).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo para atualizar.');

export const bulkUpdateTransactionsRequestSchema = z.object({
  items: z.array(bulkTransactionItemSchema).min(1).max(100),
  changes: bulkTransactionChangesSchema
}).strict().superRefine((value, context) => {
  const ids = value.items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['items'], message: 'Não é permitido repetir lançamentos.' });
});

export const bulkUpdateTransactionsResponseSchema = z.object({
  items: z.array(financeTransactionSchema.extend({ version: z.number().int().positive() }))
}).strict();

export type BulkUpdateTransactionsRequest = z.infer<typeof bulkUpdateTransactionsRequestSchema>;
export type BulkUpdateTransactionsResponse = z.infer<typeof bulkUpdateTransactionsResponseSchema>;

async function requestJson(path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers ?? {}) }
    });
  } catch {
    throw new Error('Não foi possível acessar o serviço financeiro. Verifique sua conexão e tente novamente.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
      ? payload.message
      : 'A edição em lote não pôde ser concluída.';
    throw new Error(message);
  }
  return payload;
}

export async function bulkUpdateFinanceTransactions(input: BulkUpdateTransactionsRequest): Promise<BulkUpdateTransactionsResponse> {
  const request = bulkUpdateTransactionsRequestSchema.parse(input);
  const payload = await requestJson('/api/finance/transactions/bulk', { method: 'PATCH', body: JSON.stringify(request) });
  const result = bulkUpdateTransactionsResponseSchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou uma resposta de edição em lote inválida.');
  return result.data;
}
