type ApiErrorObject = {
  message?: unknown;
  error?: unknown;
};

function isApiErrorObject(value: unknown): value is ApiErrorObject {
  return typeof value === 'object' && value !== null;
}

export function extractApiMessage(payload: unknown, status?: number): string {
  if (isApiErrorObject(payload)) {
    const rawMessage = payload.message ?? payload.error;
    if (typeof rawMessage === 'string' && rawMessage.trim()) return rawMessage;
    if (Array.isArray(rawMessage)) {
      const messages = rawMessage.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
      if (messages.length) return messages.join(' ');
    }
  }

  if (status === 401) return 'E-mail ou senha incorretos. Confira os dados e tente novamente.';
  if (status === 409) return 'Este e-mail já possui cadastro. Acesse sua conta ou use outro e-mail.';
  if (status === 429) return 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.';
  if (status === 502 || status === 503) return 'Não foi possível conectar ao serviço de autenticação. Tente novamente mais tarde.';
  return 'Não foi possível concluir a solicitação. Revise os dados e tente novamente.';
}
