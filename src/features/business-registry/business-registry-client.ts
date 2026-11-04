import { extractApiMessage } from '../auth/api-message';
import { businessRegistryRecordSchema } from './types';
import type { BusinessRegistryRecord } from './types';

const CNPJ_PATTERN = /^[A-Z0-9]{12}\d{2}$/;

export function normalizeCnpjInput(value: string): string {
  return value.replace(/[^0-9a-z]/gi, '').toUpperCase();
}

async function readRecord(response: Response, allowEmpty = false): Promise<BusinessRegistryRecord | null> {
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(extractApiMessage(payload, response.status));
  if (allowEmpty && payload === null) return null;

  const parsed = businessRegistryRecordSchema.safeParse(payload);
  if (!parsed.success) throw new Error('A API retornou dados cadastrais em formato inválido.');
  return parsed.data;
}

async function requestError(): Promise<never> {
  throw new Error('Não foi possível acessar o perfil empresarial. Verifique sua conexão e tente novamente.');
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

  const record = await readRecord(response);
  if (!record) throw new Error('A ReceitaWS não retornou um cadastro para este CNPJ.');
  return record;
}

export async function getCompanyProfile(): Promise<BusinessRegistryRecord | null> {
  let response: Response;
  try {
    response = await fetch('/api/business-registry/profile', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
  } catch {
    return requestError();
  }
  return readRecord(response, true);
}

export async function saveCompanyProfile(input: string): Promise<BusinessRegistryRecord> {
  const cnpj = normalizeCnpjInput(input);
  if (!CNPJ_PATTERN.test(cnpj)) {
    throw new Error('Informe um CNPJ válido com 14 caracteres.');
  }

  let response: Response;
  try {
    response = await fetch('/api/business-registry/profile', {
      method: 'PUT',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cnpj })
    });
  } catch {
    return requestError();
  }

  const record = await readRecord(response);
  if (!record) throw new Error('A API não retornou o perfil salvo.');
  return record;
}
