const messages = {
  login: {
    'invalid-form': 'Preencha um e-mail válido e a senha para entrar.',
    'invalid-credentials': 'E-mail ou senha inválidos.',
    'rate-limited': 'Muitas tentativas de acesso. Aguarde um minuto antes de tentar novamente.',
    'service-unavailable': 'Não foi possível concluir o acesso agora. Tente novamente em instantes.'
  },
  register: {
    'invalid-form': 'Confira os campos obrigatórios e marque os dois aceites para criar a conta.',
    'email-exists': 'Já existe uma conta para esse e-mail. Entre na conta existente ou use outro e-mail.',
    'documents-updated': 'Confira os dados e recarregue a página para ler e aceitar as versões vigentes dos Termos e da Política de Privacidade.',
    'rate-limited': 'Muitas tentativas de cadastro. Aguarde um minuto antes de tentar novamente.',
    'service-unavailable': 'Não foi possível concluir o cadastro agora. Tente novamente em instantes.'
  }
} as const;

export function authFormErrorMessage(kind: 'login' | 'register', code: unknown): string {
  if (typeof code !== 'string') return '';
  const allowed: Readonly<Record<string, string>> = messages[kind];
  return Object.hasOwn(allowed, code) ? allowed[code] : '';
}
