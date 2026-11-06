import { z } from 'zod';
import { financeCategorySchema, financeEntryTypeSchema } from './types';

export const recurrenceFrequencySchema = z.enum(['WEEKLY', 'MONTHLY', 'YEARLY']);
const isoDateSchema = z.string().datetime({ offset: true });
const amountSchema = z.number().finite().min(0.01).max(999999999999.99).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'O valor deve ter no máximo duas casas decimais.');
const versionSchema = z.number().int().positive();

export const financeRecurrenceSchema = z.object({
  id: z.string().uuid(),
  type: financeEntryTypeSchema,
  category: financeCategorySchema,
  subcategory: z.string().nullable(),
  description: z.string().min(1).max(160),
  amount: z.number().finite(),
  counterpartyId: z.string().uuid().nullable(),
  frequency: recurrenceFrequencySchema,
  intervalCount: z.number().int().min(1).max(12),
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable(),
  nextRunAt: isoDateSchema,
  lastRunAt: isoDateSchema.nullable(),
  isActive: z.boolean(),
  version: versionSchema
}).strict();

export const financeRecurrenceListSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  items: z.array(financeRecurrenceSchema)
}).strict();

export const recurrenceCreateRequestSchema = z.object({
  type: financeEntryTypeSchema,
  category: financeCategorySchema,
  subcategory: z.string().trim().min(1).max(80).nullable().optional(),
  description: z.string().trim().min(1).max(160),
  amount: amountSchema,
  counterpartyId: z.string().uuid().nullable().optional(),
  frequency: recurrenceFrequencySchema,
  intervalCount: z.number().int().min(1).max(12),
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable().optional()
}).strict();

export const recurrenceUpdateRequestSchema = z.object({
  type: financeEntryTypeSchema.optional(),
  category: financeCategorySchema.optional(),
  subcategory: z.string().trim().min(1).max(80).nullable().optional(),
  description: z.string().trim().min(1).max(160).optional(),
  amount: amountSchema.optional(),
  counterpartyId: z.string().uuid().nullable().optional(),
  frequency: recurrenceFrequencySchema.optional(),
  intervalCount: z.number().int().min(1).max(12).optional(),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.nullable().optional(),
  version: versionSchema
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'version'), 'Informe ao menos um campo para atualizar.');

export const recurrenceActiveRequestSchema = z.object({
  isActive: z.boolean(),
  version: versionSchema
}).strict();

export const recurrencePatchRequestSchema = z.union([recurrenceActiveRequestSchema, recurrenceUpdateRequestSchema]);

export const runDueRecurrencesRequestSchema = z.object({ until: isoDateSchema }).strict();
export const runDueRecurrencesResponseSchema = z.object({
  generated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  items: z.array(z.object({
    id: z.string().uuid(),
    recurrenceId: z.string().uuid(),
    occurredAt: isoDateSchema
  }).strict())
}).strict();

export type FinanceRecurrence = z.infer<typeof financeRecurrenceSchema>;
export type FinanceRecurrenceList = z.infer<typeof financeRecurrenceListSchema>;
export type RecurrenceCreateRequest = z.infer<typeof recurrenceCreateRequestSchema>;
export type RecurrenceUpdateRequest = z.infer<typeof recurrenceUpdateRequestSchema>;
export type RunDueRecurrencesResponse = z.infer<typeof runDueRecurrencesResponseSchema>;

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
    throw new Error('Não foi possível acessar as recorrências financeiras. Verifique sua conexão e tente novamente.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'message' in payload
      ? Array.isArray(payload.message) ? payload.message[0] : payload.message
      : null;
    throw new Error(typeof message === 'string' ? message : 'A operação de recorrência não pôde ser concluída.');
  }
  return payload;
}

export async function listFinanceRecurrences(query: { page?: number; limit?: number } = {}): Promise<FinanceRecurrenceList> {
  const params = new URLSearchParams({ page: String(query.page ?? 1), limit: String(query.limit ?? 50) });
  const payload = await requestJson(`/api/finance/recurrences?${params.toString()}`, { method: 'GET' });
  const result = financeRecurrenceListSchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou uma lista de recorrências inválida.');
  return result.data;
}

export async function createFinanceRecurrence(input: RecurrenceCreateRequest): Promise<FinanceRecurrence> {
  const request = recurrenceCreateRequestSchema.parse(input);
  const payload = await requestJson('/api/finance/recurrences', { method: 'POST', body: JSON.stringify(request) });
  const result = financeRecurrenceSchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou uma recorrência inválida.');
  return result.data;
}

export async function updateFinanceRecurrence(id: string, input: RecurrenceUpdateRequest): Promise<FinanceRecurrence> {
  const request = recurrenceUpdateRequestSchema.parse(input);
  const payload = await requestJson(`/api/finance/recurrences/${id}`, { method: 'PATCH', body: JSON.stringify(request) });
  const result = financeRecurrenceSchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou uma recorrência inválida.');
  return result.data;
}

export async function setFinanceRecurrenceActive(id: string, isActive: boolean, version: number): Promise<FinanceRecurrence> {
  const request = recurrenceActiveRequestSchema.parse({ isActive, version });
  const payload = await requestJson(`/api/finance/recurrences/${id}`, { method: 'PATCH', body: JSON.stringify(request) });
  const result = financeRecurrenceSchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou uma recorrência inválida.');
  return result.data;
}

export async function runDueFinanceRecurrences(until = new Date().toISOString()): Promise<RunDueRecurrencesResponse> {
  const request = runDueRecurrencesRequestSchema.parse({ until });
  const payload = await requestJson('/api/finance/recurrences/run', { method: 'POST', body: JSON.stringify(request) });
  const result = runDueRecurrencesResponseSchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou um resultado de materialização inválido.');
  return result.data;
}
