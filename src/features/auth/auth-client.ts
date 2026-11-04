import { extractApiMessage } from './api-message';
import type { AuthDocumentVersions, AuthSession, CurrentUser } from './types';
import type { LoginFormValues, RegisterRequest } from './validation';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
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
    throw new Error('Não foi possível acessar o serviço. Verifique sua conexão e tente novamente.');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(extractApiMessage(payload, response.status));
  return payload as T;
}

export function login(input: LoginFormValues): Promise<AuthSession> {
  return requestJson<AuthSession>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function register(input: RegisterRequest): Promise<AuthSession> {
  return requestJson<AuthSession>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function getCurrentUser(): Promise<CurrentUser> {
  return requestJson<CurrentUser>('/api/auth/me');
}

export function getDocumentVersions(): Promise<AuthDocumentVersions> {
  return requestJson<AuthDocumentVersions>('/api/auth/versions');
}

export function logout(): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>('/api/auth/logout', { method: 'POST' });
}
