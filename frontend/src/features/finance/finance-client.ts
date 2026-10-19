import { extractApiMessage } from '@/features/auth/api-message';
import { financeDashboardSchema, financeInsightSchema, financeTransactionListSchema, financeTransactionSchema } from './types';
import type { FinanceDashboard, FinanceInsight, FinanceTransaction, FinanceTransactionList, FinanceTransactionListQuery } from './types';
import type { TransactionInput } from './validation';

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {})
      }
    });
  } catch {
    throw new Error('Não foi possível acessar o serviço financeiro. Verifique sua conexão e tente novamente.');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(extractApiMessage(payload, response.status));
  return payload;
}

export async function getFinanceDashboard(months: 3 | 6 | 12): Promise<FinanceDashboard> {
  const payload = await requestJson(`/api/finance/dashboard?months=${months}`);
  const result = financeDashboardSchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou um resumo em formato inválido.');
  return result.data;
}

export async function getFinanceTransactions(query: FinanceTransactionListQuery): Promise<FinanceTransactionList> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const payload = await requestJson(`/api/finance/transactions?${params.toString()}`);
  const result = financeTransactionListSchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou um histórico em formato inválido.');
  return result.data;
}

export async function createFinanceTransaction(input: TransactionInput): Promise<FinanceTransaction> {
  const payload = await requestJson('/api/finance/transactions', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  const result = financeTransactionSchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou um lançamento em formato inválido.');
  return result.data;
}

export async function generateFinanceInsights(months: 3 | 6 | 12): Promise<FinanceInsight> {
  const payload = await requestJson('/api/finance/insights', {
    method: 'POST',
    body: JSON.stringify({ months })
  });
  const result = financeInsightSchema.safeParse(payload);
  if (!result.success) throw new Error('A API de insights retornou uma resposta em formato inválido.');
  return result.data;
}
