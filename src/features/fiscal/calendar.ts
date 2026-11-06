import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true });
const statusSchema = z.enum(['PENDING', 'DONE', 'DISMISSED']);

export const fiscalObligationSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  kind: z.string().min(1).max(40),
  title: z.string().min(1).max(160),
  description: z.string().max(400).nullable(),
  dueAt: isoDate,
  status: statusSchema,
  source: z.string().min(1).max(40),
  periodKey: z.string().max(20).nullable(),
  completedAt: isoDate.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  isOverdue: z.boolean(),
  daysUntilDue: z.number().int(),
  version: z.number().int().positive()
}).strict();

export const fiscalCalendarQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  status: statusSchema.optional()
}).strict();

export const fiscalCalendarResponseSchema = z.object({
  items: z.array(fiscalObligationSchema),
  summary: z.object({
    pending: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
    dueSoon: z.number().int().nonnegative(),
    done: z.number().int().nonnegative()
  }).strict()
}).strict();

export const createFiscalObligationRequestSchema = z.object({
  kind: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(400).nullable().optional(),
  dueAt: isoDate,
  periodKey: z.string().trim().max(20).nullable().optional()
}).strict();

export const updateFiscalObligationStatusRequestSchema = z.object({
  status: statusSchema,
  version: z.number().int().positive()
}).strict();

export const generateDefaultFiscalCalendarRequestSchema = z.object({
  regime: z.enum(['MEI', 'SIMPLES_ME_EPP']),
  from: isoDate,
  to: isoDate
}).strict();

export type FiscalObligation = z.infer<typeof fiscalObligationSchema>;
export type FiscalCalendarQuery = z.infer<typeof fiscalCalendarQuerySchema>;
export type FiscalCalendarResponse = z.infer<typeof fiscalCalendarResponseSchema>;
export type CreateFiscalObligationRequest = z.infer<typeof createFiscalObligationRequestSchema>;
export type UpdateFiscalObligationStatusRequest = z.infer<typeof updateFiscalObligationStatusRequestSchema>;
export type GenerateDefaultFiscalCalendarRequest = z.infer<typeof generateDefaultFiscalCalendarRequestSchema>;

async function readError(response: Response, fallback: string): Promise<never> {
  const payload: unknown = await response.json().catch(() => null);
  const message = typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
    ? payload.message
    : fallback;
  throw new Error(message);
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers ?? {}) }
    });
  } catch {
    throw new Error('Não foi possível acessar o calendário fiscal. Verifique sua conexão e tente novamente.');
  }
  if (!response.ok) return readError(response, 'A operação fiscal não pôde ser concluída.');
  return response.json().catch(() => null);
}

export async function getFiscalCalendar(input: FiscalCalendarQuery): Promise<FiscalCalendarResponse> {
  const query = fiscalCalendarQuerySchema.parse(input);
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.status) params.set('status', query.status);
  const result = fiscalCalendarResponseSchema.safeParse(await requestJson(`/api/fiscal/calendar?${params.toString()}`));
  if (!result.success) throw new Error('A API fiscal retornou um calendário em formato inválido.');
  return result.data;
}

export async function createFiscalObligation(input: CreateFiscalObligationRequest): Promise<FiscalObligation> {
  const result = fiscalObligationSchema.safeParse(await requestJson('/api/fiscal/calendar', { method: 'POST', body: JSON.stringify(createFiscalObligationRequestSchema.parse(input)) }));
  if (!result.success) throw new Error('A API fiscal retornou uma obrigação em formato inválido.');
  return result.data;
}

export async function updateFiscalObligationStatus(id: string, input: UpdateFiscalObligationStatusRequest): Promise<FiscalObligation> {
  const parsedId = z.string().uuid().parse(id);
  const result = fiscalObligationSchema.safeParse(await requestJson(`/api/fiscal/calendar/${parsedId}`, { method: 'PATCH', body: JSON.stringify(updateFiscalObligationStatusRequestSchema.parse(input)) }));
  if (!result.success) throw new Error('A API fiscal retornou uma obrigação em formato inválido.');
  return result.data;
}

export async function removeFiscalObligation(id: string): Promise<{ removed: true }> {
  const parsedId = z.string().uuid().parse(id);
  const result = z.object({ removed: z.literal(true) }).strict().safeParse(await requestJson(`/api/fiscal/calendar/${parsedId}`, { method: 'DELETE' }));
  if (!result.success) throw new Error('A API fiscal retornou uma confirmação de remoção inválida.');
  return result.data;
}

export async function generateDefaultFiscalCalendar(input: GenerateDefaultFiscalCalendarRequest): Promise<{ created: number; skipped: number }> {
  const payload = generateDefaultFiscalCalendarRequestSchema.parse(input);
  const result = z.object({ created: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() }).strict().safeParse(
    await requestJson('/api/fiscal/calendar', { method: 'POST', body: JSON.stringify(payload) })
  );
  if (!result.success) throw new Error('A API fiscal retornou um resumo de geração inválido.');
  return result.data;
}
