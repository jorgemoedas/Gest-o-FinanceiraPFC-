import { extractApiMessage } from '@/features/auth/api-message';
import { financeCounterpartyListSchema, financeCounterpartySchema, financeDashboardSchema, financeInsightSchema, financeTransactionCancellationSchema, financeTransactionListSchema, financeTransactionRefundSchema, financeTransactionSchema } from './types';
import type { CounterpartyRole, FinanceCounterparty, FinanceCounterpartyList, FinanceCounterpartyListQuery, FinanceDashboard, FinanceInsight, FinanceTransaction, FinanceTransactionList, FinanceTransactionListQuery } from './types';
import type { TransactionInput, TransactionUpdateInput } from './validation';

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

export async function getFinanceCounterparties(query: FinanceCounterpartyListQuery = {}): Promise<FinanceCounterpartyList> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ limit: 100, ...query })) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const payload = await requestJson(`/api/finance/counterparties?${params.toString()}`);
  const result = financeCounterpartyListSchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou uma lista de clientes e fornecedores inválida.');
  return result.data;
}

export async function createFinanceCounterparty(input: { name: string; role: CounterpartyRole; cnpj?: string }): Promise<FinanceCounterparty> {
  const payload = await requestJson('/api/finance/counterparties', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  const result = financeCounterpartySchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou um cadastro de contraparte inválido.');
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

export async function updateFinanceTransaction(id: string, input: TransactionUpdateInput): Promise<FinanceTransaction> {
  const payload = await requestJson(`/api/finance/transactions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
  const result = financeTransactionSchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou um lançamento em formato inválido.');
  return result.data;
}

export async function cancelFinanceTransaction(id: string): Promise<{ cancelled: true; adjustmentKind: 'VOID' | null; reversalId: string | null }> {
  const payload = await requestJson(`/api/finance/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const result = financeTransactionCancellationSchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou uma confirmação de cancelamento inválida.');
  return result.data;
}

export async function refundFinanceTransaction(id: string): Promise<{ refunded: true; adjustmentId: string }> {
  const payload = await requestJson(`/api/finance/transactions/${encodeURIComponent(id)}/refund`, { method: 'POST' });
  const result = financeTransactionRefundSchema.safeParse(payload);
  if (!result.success) throw new Error('A API financeira retornou uma confirmação de devolução inválida.');
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
