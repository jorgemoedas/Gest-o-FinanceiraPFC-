import { z } from 'zod';
import { extractApiMessage } from '../auth/api-message';

export const ERASE_CONFIRMATION_TEXT = 'ELIMINAR MEUS DADOS';
export const erasePrivacyRequestSchema = z.object({
  confirmation: z.string().refine((value) => value === ERASE_CONFIRMATION_TEXT, 'Digite exatamente a confirmação solicitada.')
}).strict();

export const privacyEraseResponseSchema = z.object({
  erased: z.literal(true),
  retained: z.array(z.string())
}).strict();

export type PrivacyExportData = {
  generatedAt: string;
  subject: { userId: string; email: string };
  memberships: unknown[];
  acceptances: unknown[];
  authoredTransactions: unknown[];
  auditEvents: unknown[];
};

export function privacyExportShape(value: unknown): value is PrivacyExportData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const subject = candidate.subject;
  return typeof candidate.generatedAt === 'string'
    && typeof subject === 'object'
    && subject !== null
    && typeof (subject as Record<string, unknown>).userId === 'string'
    && typeof (subject as Record<string, unknown>).email === 'string'
    && Array.isArray(candidate.memberships)
    && Array.isArray(candidate.acceptances)
    && Array.isArray(candidate.authoredTransactions)
    && Array.isArray(candidate.auditEvents);
}

async function readJson(response: Response): Promise<unknown> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(extractApiMessage(payload, response.status));
  return payload;
}

export async function exportPrivacyData(): Promise<PrivacyExportData> {
  let response: Response;
  try {
    response = await fetch('/api/privacy/export', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
  } catch {
    throw new Error('Não foi possível acessar os seus dados. Verifique sua conexão e tente novamente.');
  }
  const payload = await readJson(response);
  if (!payload || typeof payload !== 'object' || !('generatedAt' in payload) || !('subject' in payload)) {
    throw new Error('A API de privacidade retornou um arquivo inválido.');
  }
  return payload as PrivacyExportData;
}

export async function erasePrivacyData(confirmation: string): Promise<{ erased: true; retained: string[] }> {
  const input = erasePrivacyRequestSchema.parse({ confirmation });
  let response: Response;
  try {
    response = await fetch('/api/privacy/erase', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
  } catch {
    throw new Error('Não foi possível solicitar a eliminação. Verifique sua conexão e tente novamente.');
  }
  const payload = await readJson(response);
  const result = privacyEraseResponseSchema.safeParse(payload);
  if (!result.success) throw new Error('A API de privacidade retornou uma confirmação inválida.');
  return result.data;
}
