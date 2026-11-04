import { z } from 'zod';
import { extractApiMessage } from './api-message';

const passwordSchema = z
  .string()
  .min(12, 'Use pelo menos 12 caracteres na senha.')
  .max(72, 'A senha deve ter no máximo 72 caracteres.')
  .refine((value) => new TextEncoder().encode(value).byteLength <= 72, {
    message: 'A senha deve ocupar no máximo 72 bytes em UTF-8.'
  });

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().min(1, 'Informe seu e-mail.').max(320, 'O e-mail deve ter no máximo 320 caracteres.').email('Informe um e-mail válido.')
}).strict();

export const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(1, 'O link de redefinição não contém um token válido.').max(512),
  newPassword: passwordSchema
}).strict();

export const passwordResetRequestResponseSchema = z.object({ delivered: z.boolean() }).strict();
export const passwordResetConfirmResponseSchema = z.object({ reset: z.literal(true) }).strict();

export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>;

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init.headers ?? {})
      }
    });
  } catch {
    throw new Error('Não foi possível acessar o serviço. Verifique sua conexão e tente novamente.');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(extractApiMessage(payload, response.status));
  return payload as T;
}

export async function requestPasswordReset(email: string): Promise<{ delivered: boolean }> {
  const input = passwordResetRequestSchema.parse({ email });
  const payload = await requestJson<unknown>('/api/auth/password-reset', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  const result = passwordResetRequestResponseSchema.safeParse(payload);
  if (!result.success) throw new Error('A API de autenticação retornou uma resposta inválida.');
  return result.data;
}

export async function confirmPasswordReset(input: PasswordResetConfirm): Promise<{ reset: true }> {
  const parsedInput = passwordResetConfirmSchema.parse(input);
  const payload = await requestJson<unknown>('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: JSON.stringify(parsedInput)
  });
  const result = passwordResetConfirmResponseSchema.safeParse(payload);
  if (!result.success) throw new Error('A API de autenticação retornou uma confirmação inválida.');
  return result.data;
}
