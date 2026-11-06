type OpenApiObject = Record<string, unknown>;

type Schema = OpenApiObject;

type ResponseMap = Record<string, unknown>;

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

const jsonResponse = (description: string, schema: Schema): Schema => ({
  description,
  content: { [JSON_MEDIA_TYPE]: { schema } }
});

const responses = (entries: Array<[string, string, Schema?]>): ResponseMap => {
  const result: ResponseMap = {};
  for (const [status, description, schema] of entries) {
    result[status] = schema ? jsonResponse(description, schema) : { description };
  }
  return result;
};

function operation(
  summary: string,
  description: string,
  responseMap: ResponseMap,
  options: { publicRoute?: boolean; requestBody?: Schema; planned?: boolean } = {}
): Schema {
  const result: Schema = {
    summary,
    description,
    responses: responseMap
  };
  if (options.publicRoute) result.security = [];
  if (options.requestBody) result.requestBody = options.requestBody;
  if (options.planned) {
    result['x-implementation-status'] = 'planned';
    result.description = `${description} Esta rota está planejada e ainda não possui implementação no backend lido.`;
  }
  return result;
}

const errorResponses = (includeNotFound = false): Array<[string, string, Schema]> => [
  ['400', INVALID_REQUEST, ERROR_RESPONSE],
  ['401', 'Token ausente ou inválido.', ERROR_RESPONSE],
  ['403', 'Acesso proibido para o papel atual.', ERROR_RESPONSE],
  ...(includeNotFound ? [['404', 'Recurso não encontrado.', ERROR_RESPONSE] as [string, string, Schema]] : []),
  ['409', 'Conflito de estado ou recurso duplicado.', ERROR_RESPONSE],
  ['413', 'Payload excede o limite permitido.', ERROR_RESPONSE],
  ['429', 'Limite de requisições excedido.', ERROR_RESPONSE],
  ['500', 'Erro interno sem detalhes sensíveis.', ERROR_RESPONSE]
];

const transactionBody: Schema = {
  type: 'object',
  required: ['type', 'category', 'description', 'amount', 'occurredAt'],
  properties: {
    type: { type: 'string', enum: ['INCOME', 'EXPENSE'] },
    category: { type: 'string' },
    subcategory: { type: ['string', 'null'], maxLength: 80 },
    description: { type: 'string', minLength: 1, maxLength: 160 },
    amount: { type: 'number', minimum: 0.01 },
    occurredAt: { type: 'string', format: 'date-time' },
    dueAt: { type: ['string', 'null'], format: 'date-time' },
    status: { type: 'string', enum: ['PAID', 'PENDING'] },
    counterpartyId: { type: ['string', 'null'], format: 'uuid' }
  }
};

const genericObject: Schema = { type: 'object', additionalProperties: true };

const ERROR_RESPONSE = ref('ErrorResponse');
const JSON_MEDIA_TYPE = 'application/json';
const PAYLOAD_TOO_LARGE = 'Payload excede o limite.';
const INVALID_REQUEST = 'Requisição inválida.';
const UNAUTHENTICATED = 'Não autenticado.';
const INTERNAL_ERROR = 'Erro interno.';
const FORBIDDEN = 'Acesso proibido.';
const RATE_LIMITED = 'Limite excedido.';
const CONFLICT = 'Conflito.';

const paths: Record<string, unknown> = {
    '/health': {
      get: operation(
        'Verificar disponibilidade',
        'Retorna o contrato mínimo de disponibilidade da API.',
        responses([
          ['200', 'Serviço disponível.', ref('HealthResponse')],
          ['500', 'Falha interna.', ERROR_RESPONSE]
        ]),
        { publicRoute: true }
      )
    },
    '/health/ready': {
      get: operation(
        'Verificar prontidão',
        'Executa SELECT 1 em uma transação de leitura e não expõe detalhes do driver.',
        responses([
          ['200', 'Dependência de banco pronta.', ref('ReadyResponse')],
          ['503', 'Dependência de banco degradada.', ref('DegradedHealthResponse')]
        ]),
        { publicRoute: true }
      )
    },
    '/metrics': {
      get: operation(
        'Obter métricas',
        'Retorna contadores e percentis de requisições mantidos em memória.',
        responses([
          ['200', 'Snapshot de métricas.', ref('MetricsSnapshot')],
          ['500', 'Falha interna.', ERROR_RESPONSE]
        ]),
        { publicRoute: true }
      )
    },
    '/openapi.json': {
      get: operation(
        'Obter contrato OpenAPI',
        'Retorna este documento OpenAPI serializável.',
        responses([['200', 'Documento OpenAPI.', { type: 'object' }]]),
        { publicRoute: true }
      )
    },
    '/auth/register': {
      post: operation(
        'Registrar conta',
        'Cria uma conta e a empresa inicial.',
        responses([
          ['201', 'Conta criada.', ref('AuthSession')],
          ...errorResponses().filter(([status]) => ['400', '409', '413', '429', '500'].includes(status))
        ]),
        { publicRoute: true, requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: ref('RegisterRequest') } } } }
      )
    },
    '/auth/login': {
      post: operation(
        'Autenticar conta',
        'Emite uma sessão com token JWT.',
        responses([
          ['200', 'Login concluído.', ref('AuthSession')],
          ...errorResponses().filter(([status]) => ['400', '401', '429', '500'].includes(status))
        ]),
        { publicRoute: true, requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: ref('LoginRequest') } } } }
      )
    },
    '/auth/me': {
      get: operation('Obter usuário atual', 'Retorna o principal autenticado.', responses([['200', 'Principal atual.', ref('AuthPrincipal')], ['401', UNAUTHENTICATED, ERROR_RESPONSE]]))
    },
    '/auth/password-reset': {
      post: operation('Solicitar redefinição', 'Solicita redefinição de senha sem revelar se o e-mail existe. A entrega depende de canal de notificação configurado.', responses([['200', 'Solicitação aceita.', genericObject], ['400', INVALID_REQUEST, ERROR_RESPONSE], ['413', PAYLOAD_TOO_LARGE, ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]), { publicRoute: true, requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } } } } })
    },
    '/auth/password-reset/confirm': {
      post: operation('Confirmar redefinição', 'Confirma o token de redefinição e troca a senha.', responses([['200', 'Senha alterada.', genericObject], ['400', 'Token ou payload inválido.', ERROR_RESPONSE], ['401', 'Token de redefinição inválido.', ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]), { publicRoute: true, requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: { type: 'object', required: ['token', 'newPassword'], properties: { token: { type: 'string' }, newPassword: { type: 'string', format: 'password', minLength: 12 } } } } } } })
    },
    '/auth/admin-check': {
      get: operation(
        'Verificar papel administrativo',
        'Confirma que o principal possui papel OWNER ou ADMIN.',
        responses([
          ['200', 'Acesso autorizado.', genericObject],
          ['401', UNAUTHENTICATED, ERROR_RESPONSE],
          ['403', 'Papel insuficiente.', ERROR_RESPONSE]
        ])
      )
    },
    '/audit-logs': {
      get: operation('Listar auditoria', 'Lista eventos de auditoria para OWNER ou ADMIN.', responses([['200', 'Eventos de auditoria paginados.', genericObject], ...errorResponses(true).filter(([status]) => ['401', '403', '429', '500'].includes(status))]))
    },
    '/business-registry/cnpj/{cnpj}': {
      get: operation('Consultar CNPJ', 'Consulta dados cadastrais de CNPJ para a empresa autenticada.', responses([['200', 'Dados cadastrais.', genericObject], ...errorResponses(true).filter(([status]) => ['400', '401', '404', '429', '500'].includes(status))]))
    },
    '/business-registry/profile': {
      get: operation('Obter perfil empresarial', 'Retorna o perfil empresarial da companhia autenticada.', responses([['200', 'Perfil empresarial.', genericObject], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]])),
      put: operation('Salvar perfil empresarial', 'Atualiza o perfil empresarial para OWNER ou ADMIN.', responses([['200', 'Perfil salvo.', genericObject], ...errorResponses(true).filter(([status]) => ['400', '401', '403', '404', '409', '429', '500'].includes(status))]), { requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: { type: 'object', required: ['cnpj'], properties: { cnpj: { type: 'string' } } } } } } })
    },
    '/finance/transactions': {
      get: operation('Listar transações', 'Lista transações financeiras da empresa autenticada.', responses([['200', 'Transações.', genericObject], ...errorResponses().filter(([status]) => ['401', '429', '500'].includes(status))])),
      post: operation('Criar transação', 'Cria uma transação financeira.', responses([['201', 'Transação criada.', ref('FinanceTransaction')], ...errorResponses().filter(([status]) => ['400', '401', '403', '409', '413', '429', '500'].includes(status))]), { requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: transactionBody } } } })
    },
    '/finance/transactions/{id}': {
      patch: operation('Atualizar transação', 'Atualiza uma transação financeira por UUID.', responses([['200', 'Transação atualizada.', ref('FinanceTransaction')], ...errorResponses(true).filter(([status]) => ['400', '401', '403', '404', '409', '413', '429', '500'].includes(status))]), { requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: { ...transactionBody, required: [] } } } } }),
      delete: operation('Cancelar transação', 'Cancela uma transação financeira por UUID.', responses([['200', 'Transação cancelada.', genericObject], ...errorResponses(true).filter(([status]) => ['401', '403', '404', '409', '429', '500'].includes(status))]))
    },
    '/finance/transactions/{id}/refund': {
      post: operation('Reembolsar transação', 'Solicita reembolso de uma transação financeira.', responses([['200', 'Transação reembolsada.', genericObject], ...errorResponses(true).filter(([status]) => ['401', '403', '404', '409', '429', '500'].includes(status))]))
    },
    '/finance/transactions/bulk': {
      patch: operation('Atualizar transações em lote', 'Atualiza até 100 transações com controle de versão.', responses([['200', 'Transações atualizadas.', genericObject], ...errorResponses().filter(([status]) => ['400', '401', '403', '409', '413', '429', '500'].includes(status))]), { requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: ref('BulkUpdateTransactionsRequest') } } } })
    },
    '/finance/dashboard': {
      get: operation('Obter dashboard financeiro', 'Retorna agregados do dashboard financeiro.', responses([['200', 'Dashboard.', genericObject], ...errorResponses().filter(([status]) => ['401', '429', '500'].includes(status))]))
    },
    '/finance/insights': {
      post: operation('Gerar insights financeiros', 'Gera insights financeiros para a empresa autenticada.', responses([['200', 'Insights.', genericObject], ...errorResponses().filter(([status]) => ['400', '401', '413', '429', '500'].includes(status))]), { requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: { type: 'object', properties: { months: { type: 'integer', minimum: 1 } } } } } } })
    },
    '/finance/counterparties': {
      get: operation('Listar contrapartes', 'Lista contrapartes da companhia.', responses([['200', 'Contrapartes.', genericObject], ...errorResponses().filter(([status]) => ['401', '429', '500'].includes(status))])),
      post: operation('Criar contraparte', 'Cria uma contraparte para a companhia.', responses([['201', 'Contraparte criada.', genericObject], ...errorResponses().filter(([status]) => ['400', '401', '403', '409', '413', '429', '500'].includes(status))]), { requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 160 }, role: { type: 'string' } } } } } } })
    },
    '/finance/recurrences': {
      get: operation('Listar recorrências', 'Lista recorrências financeiras com paginação.', responses([['200', 'Recorrências paginadas.', genericObject], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]])),
      post: operation('Criar recorrência', 'Cria uma recorrência financeira.', responses([['201', 'Recorrência criada.', genericObject], ['400', INVALID_REQUEST, ERROR_RESPONSE], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['403', FORBIDDEN, ERROR_RESPONSE], ['409', CONFLICT, ERROR_RESPONSE], ['413', PAYLOAD_TOO_LARGE, ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]), { requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: genericObject } } } })
    },
    '/finance/recurrences/{id}': {
      patch: operation('Atualizar recorrência', 'Atualiza campos da recorrência ou ativa e desativa a regra.', responses([['200', 'Recorrência atualizada.', genericObject], ['400', INVALID_REQUEST, ERROR_RESPONSE], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['403', FORBIDDEN, ERROR_RESPONSE], ['404', 'Não encontrada.', ERROR_RESPONSE], ['409', CONFLICT, ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]), { requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: genericObject } } } }),    },
    '/finance/recurrences/run': {
      post: operation('Executar recorrências', 'Materializa as ocorrências vencidas das recorrências ativas, de forma idempotente.', responses([['200', 'Execução concluída.', genericObject], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['403', FORBIDDEN, ERROR_RESPONSE], ['409', CONFLICT, ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]))
    },
    '/finance/analytics': {
      get: operation('Obter analytics', 'Retorna tendência, sazonalidade, projeção com premissas e alertas explicados.', responses([['200', 'Analytics.', genericObject], ['400', 'Filtros inválidos.', ERROR_RESPONSE], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]))
    },
    '/finance/attachments': {
      get: operation('Listar anexos', 'Lista os anexos de um lançamento informado por transactionId.', responses([['200', 'Anexos do lançamento.', genericObject], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]])),
      post: operation('Criar anexo', 'Recebe um arquivo por multipart/form-data com o campo transactionId.', responses([['201', 'Anexo criado.', genericObject], ['400', INVALID_REQUEST, ERROR_RESPONSE], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['413', PAYLOAD_TOO_LARGE, ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]), { requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: genericObject } } } })
    },
    '/finance/attachments/{id}': {
      get: operation('Obter anexo', 'Baixa o conteúdo do anexo, restrito à empresa autenticada.', responses([['200', 'Conteúdo do anexo.', { type: 'string', format: 'binary' }], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['404', 'Anexo não encontrado.', ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]])),
      delete: operation('Excluir anexo', 'Remove o anexo e o arquivo armazenado.', responses([['200', 'Anexo excluído.', genericObject], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['403', FORBIDDEN, ERROR_RESPONSE], ['404', 'Anexo não encontrado.', ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]))
    },
    '/fiscal/calendar': {
      get: operation('Obter calendário fiscal', 'Retorna obrigações do período com resumo de pendentes, atrasadas, próximas e concluídas.', responses([['200', 'Calendário fiscal do período.', genericObject], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]])),
      post: operation('Criar obrigação fiscal', 'Cria uma obrigação no calendário fiscal.', responses([['201', 'Obrigação criada.', ref('FiscalObligation')], ['400', INVALID_REQUEST, ERROR_RESPONSE], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['403', FORBIDDEN, ERROR_RESPONSE], ['409', CONFLICT, ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]), { requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: genericObject } } } })
    },
    '/fiscal/calendar/generate-default': {
      post: operation('Gerar calendário padrão', 'Gera obrigações mensais de referência para o regime informado, sem calcular tributos.', responses([['201', 'Calendário gerado.', genericObject], ['400', 'Regime ou período inválido.', ERROR_RESPONSE], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['403', FORBIDDEN, ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]), { requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: { type: 'object', required: ['regime', 'from', 'to'], properties: { regime: { type: 'string', enum: ['MEI', 'SIMPLES_ME_EPP'] }, from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } } } } } } })
    },
    '/fiscal/calendar/{id}': {
      patch: operation('Atualizar obrigação fiscal', 'Atualiza a situação de uma obrigação com controle de versão.', responses([['200', 'Obrigação atualizada.', ref('FiscalObligation')], ['400', INVALID_REQUEST, ERROR_RESPONSE], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['403', FORBIDDEN, ERROR_RESPONSE], ['404', 'Obrigação não encontrada.', ERROR_RESPONSE], ['409', CONFLICT, ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]), { requestBody: { required: true, content: { [JSON_MEDIA_TYPE]: { schema: genericObject } } } }),
      delete: operation('Excluir obrigação fiscal', 'Exclui uma obrigação do calendário fiscal.', responses([['200', 'Obrigação excluída.', genericObject], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['403', FORBIDDEN, ERROR_RESPONSE], ['404', 'Obrigação não encontrada.', ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]))
    },
    '/fiscal/export': {
      get: operation('Exportar dados fiscais', 'Exporta as obrigações do período em CSV ou PDF.', responses([['200', 'Arquivo ou dados de exportação.', genericObject], ['400', 'Filtros inválidos.', ERROR_RESPONSE], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['413', 'Exportação excede o limite.', ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]))
    },
    '/privacy/export': {
      get: operation('Exportar dados pessoais', 'Exporta os dados pessoais do titular autenticado.', responses([['200', 'Exportação aceita.', genericObject], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['413', 'Exportação excede o limite.', ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]))
    },
    '/privacy/erase': {
      post: operation('Apagar dados pessoais', 'Anonimiza os dados pessoais do titular, preservando registros contábeis por obrigação legal.', responses([['200', 'Solicitação aceita.', genericObject], ['400', INVALID_REQUEST, ERROR_RESPONSE], ['401', UNAUTHENTICATED, ERROR_RESPONSE], ['403', FORBIDDEN, ERROR_RESPONSE], ['409', 'Conflito de retenção.', ERROR_RESPONSE], ['429', RATE_LIMITED, ERROR_RESPONSE], ['500', INTERNAL_ERROR, ERROR_RESPONSE]]))
    }
};

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'GFT Inteligente API',
      version: '1.0.0',
      description: 'Contrato HTTP do backend NestJS. Rotas implementadas ainda estão em implementação.'
    },
    servers: [
      { url: '/api/v1', description: 'Rotas autenticadas do backend' },
      { url: '/', description: 'Rotas públicas excluídas do prefixo global' }
    ],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string', example: 'VALIDATION_ERROR' },
            message: { type: 'string' },
            details: { type: 'object', additionalProperties: true }
          }
        },
        HealthResponse: { type: 'object', required: ['status'], properties: { status: { const: 'ok' } } },
        ReadyResponse: { type: 'object', required: ['status'], properties: { status: { const: 'ready' } } },
        DegradedHealthResponse: {
          type: 'object',
          required: ['status', 'checks'],
          properties: {
            status: { const: 'degraded' },
            checks: { type: 'array', items: { type: 'object', required: ['name', 'status', 'code'], properties: { name: { const: 'database' }, status: { const: 'failed' }, code: { type: 'string', enum: ['database_unavailable', 'dependency_not_configured'] } } } }
          }
        },
        MetricsSnapshot: {
          type: 'object',
          required: ['uptimeSeconds', 'totalRequests', 'totalErrors', 'byRoute'],
          properties: {
            uptimeSeconds: { type: 'integer', minimum: 0 },
            totalRequests: { type: 'integer', minimum: 0 },
            totalErrors: { type: 'integer', minimum: 0 },
            byRoute: { type: 'array', items: ref('RouteMetric') }
          }
        },
        RouteMetric: {
          type: 'object',
          required: ['method', 'route', 'count', 'errors', 'p50Ms', 'p95Ms', 'maxMs'],
          properties: { method: { type: 'string' }, route: { type: 'string' }, count: { type: 'integer' }, errors: { type: 'integer' }, p50Ms: { type: 'number' }, p95Ms: { type: 'number' }, maxMs: { type: 'number' } }
        },
        RegisterRequest: {
          type: 'object',
          required: ['email', 'password', 'companyName', 'acceptedTerms', 'acceptedPrivacy', 'termsVersion', 'privacyVersion'],
          properties: {
            email: { type: 'string', format: 'email', maxLength: 320 },
            password: { type: 'string', format: 'password', minLength: 12, maxLength: 72 },
            companyName: { type: 'string', minLength: 2, maxLength: 160 },
            acceptedTerms: { const: true },
            acceptedPrivacy: { const: true },
            termsVersion: { type: 'string', maxLength: 40 },
            privacyVersion: { type: 'string', maxLength: 40 }
          }
        },
        LoginRequest: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password' } } },
        AuthSession: { type: 'object', properties: { accessToken: { type: 'string' }, tokenType: { type: 'string', example: 'Bearer' }, expiresIn: { type: 'integer' }, user: ref('AuthPrincipal') } },
        AuthPrincipal: { type: 'object', properties: { userId: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, companyId: { type: 'string', format: 'uuid' }, role: { type: 'string' } } },
        FinanceTransaction: { type: 'object', allOf: [transactionBody, { properties: { id: { type: 'string', format: 'uuid' }, version: { type: 'integer' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } }] },
        BulkUpdateTransactionsRequest: { type: 'object', required: ['items', 'changes'], properties: { items: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', required: ['id', 'version'], properties: { id: { type: 'string', format: 'uuid' }, version: { type: 'integer', minimum: 1 } } } }, changes: { type: 'object', properties: { category: { type: 'string' }, subcategory: { type: ['string', 'null'] }, status: { type: 'string', enum: ['PAID', 'PENDING'] }, dueAt: { type: ['string', 'null'], format: 'date-time' } } } } },
        AuditEvent: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, action: { type: 'string' }, actorUserId: { type: 'string', format: 'uuid' }, entityType: { type: 'string' }, entityId: { type: 'string' }, requestId: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } },
        Attachment: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, filename: { type: 'string' }, contentType: { type: 'string' }, sizeBytes: { type: 'integer' }, createdAt: { type: 'string', format: 'date-time' } } },
        FiscalObligation: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, dueDate: { type: 'string', format: 'date' }, status: { type: 'string' } } }
      }
    }
  };
}
