import { extractApiMessage } from '../auth/api-message';
import { businessRegistryRecordSchema } from './types';
import type { BusinessRegistryRecord } from './types';

const CNPJ_PATTERN = /^[A-Z0-9]{12}\d{2}$/;

export function normalizeCnpjInput(value: string): string {
  return value.replace(/[^0-9a-z]/gi, '').toUpperCase();
}

export async function lookupBusinessRegistry(input: string): Promise<BusinessRegistryRecord> {
  const cnpj = normalizeCnpjInput(input);
  if (!CNPJ_PATTERN.test(cnpj)) {
    throw new Error('Informe um CNPJ válido com 14 caracteres. O CNPJ alfanumérico também é aceito.');
  }

  let response: Response;
  try {
    response = await fetch(`/api/business-registry/cnpj/${encodeURIComponent(cnpj)}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
  } catch {
    throw new Error('Não foi possível acessar a consulta de CNPJ. Verifique sua conexão e tente novamente.');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(extractApiMessage(payload, response.status));

  const parsed = businessRegistryRecordSchema.safeParse(payload);
  if (!parsed.success) throw new Error('A ReceitaWS retornou dados cadastrais em formato inválido.');
  return parsed.data;
}
