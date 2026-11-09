# GFT Inteligente — API NestJS

API NestJS 11 com PostgreSQL/Prisma 7 para autenticação, auditoria, consulta de CNPJ e gestão financeira de microempresas. O front-end Next.js acessa a API por BFF server-side; o JWT curto é mantido em cookie `HttpOnly` no fluxo web.

## Requisitos e preparação

- Node.js 22.12+ e npm 10.9.2+.
- Execute `npm ci`, copie `.env.example` para `.env` e configure a URL PostgreSQL, o segredo JWT e, para Supabase, o certificado CA do projeto. Nunca versione `.env` nem segredos.
- Execute `npm run prisma:generate`, `npm run build` e `npm run test:cov`.

A API escuta em `PORT` (padrão 3001) e usa o prefixo `/api/v1`. `TERMS_VERSION` e `PRIVACY_POLICY_VERSION` são obrigatórios e devem coincidir com o front-end. `GEMINI_API_KEY` fica somente no ambiente do servidor e é necessária apenas ao solicitar insights.

## Supabase — schema isolado

O projeto Supabase “Gestão Financeira” é acessado pelo Session Pooler. A aplicação utiliza exclusivamente o schema `gft_inteligente`, com `DATABASE_CA_CERT` e validação TLS de CA e hostname (`verify-full`, `rejectUnauthorized: true`). A migração `20261005120000_gft_initial` foi aplicada e verificada em 05/10/2026: seis tabelas da aplicação com RLS ativo, sem privilégios de acesso ao schema para `PUBLIC`, `anon`, `authenticated` ou `service_role`; o schema `public` não foi alterado.

A checagem imediatamente pós-migração ocorreu com schema vazio. Os testes E2E posteriores criaram dados **sintéticos** que permanecem nesse schema por instrução do usuário: **4 contas/empresas, 4 aceites versionados, 6 lançamentos e 19 eventos de auditoria** (estado conferido em 06/10/2026). Nenhum dado real de usuário foi usado ou apagado.

Para preparar outra instalação:

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy:supabase
npm run build
npm run test:cov
```

O script de migration grava a CA em arquivo temporário `0600`, força `schema=gft_inteligente`, valida o hostname, evita registrar a DSN e remove o arquivo ao terminar. Não aplique a baseline sobre schema populado sem verificar alvo e histórico de migrations.

## Rotas

| Método | Rota | Acesso e finalidade |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Público e limitado; cria usuário/empresa/membership, registra aceites versionados e auditoria. |
| `POST` | `/api/v1/auth/login` | Público e limitado; verifica bcrypt e emite JWT curto. |
| `GET` | `/api/v1/auth/me` | JWT obrigatório; retorna principal autenticado. |
| `GET` | `/api/v1/auth/admin-check` | JWT e perfil OWNER/ADMIN. |
| `GET` | `/api/v1/audit-logs` | OWNER/ADMIN; auditoria paginada da própria empresa. |
| `GET` | `/api/v1/business-registry/cnpj/:cnpj` | JWT; valida CNPJ numérico/alfanumérico de 2026 e consulta ReceitaWS server-side. |
| `GET` | `/api/v1/finance/dashboard?months=3\|6\|12` | JWT; agrega dados somente da empresa autenticada. |
| `GET` | `/api/v1/finance/transactions?page=1&limit=20&type=...&category=...&search=...&from=YYYY-MM-DD&to=YYYY-MM-DD` | JWT; lista com paginação, filtros por tipo/categoria/descrição/período e escopo obrigatório da empresa do principal; datas inicial/final inclusivas, limite de 100 itens. |
| `POST` | `/api/v1/finance/transactions` | OWNER/ADMIN/MEMBER; valida e persiste lançamento e auditoria na mesma transação. |
| `POST` | `/api/v1/finance/insights` | JWT; chama Gemini sob demanda com totais agregados e categorias controladas. |

O `companyId` é obtido do principal JWT, nunca do corpo da requisição. Valores monetários são armazenados como Decimal; o banco também recusa valores não positivos. O Gemini não recebe descrições livres, nomes, e-mails, CNPJ ou identificadores de pessoa/empresa. A integração ReceitaWS tem limites e disponibilidade definidos pelo provedor.

## Gemini

O modelo primário configurável é `gemini-3.8-flash`. Se e somente se essa chamada retornar HTTP 503, a API faz uma única tentativa com `gemini-3.5-flash-lite`; não repete chamadas em outros status. O resultado e o modelo efetivamente usado são registrados na auditoria. Se ambos falharem, a API devolve erro seguro e retryable. Uma verificação integrada em 05/10/2026 recebeu insight gerado pelo modelo alternativo; o modelo primário estava temporariamente sob alta demanda.

## Execução local

Configure `.env` com os valores do exemplo e use HTTPS/CA para Supabase. Inicie em terminais separados:

```bash
# backend/
npm run start:dev

# frontend/ (no repositório integrado; workspace original: .)
npm run build
npm run start
```

No Next, `AUTH_API_BASE_URL` deve apontar para o Nest acessível pelo servidor Next, por exemplo `http://localhost:3001/api/v1`. Para HTTP local, use `AUTH_COOKIE_SECURE=false`; em Preview/HTTPS, configure a origem pública exata e `AUTH_COOKIE_SECURE=true` para `SameSite=None; Secure; HttpOnly`.

## Verificações e limitações

Em 05/10/2026, `npm run build` passou e `npm run test:cov` passou com **10 suítes/42 testes**. Cobertura Jest: **90,96% statements, 71,81% branches, 94,82% functions e 94,49% lines**. A suíte inclui autenticação/autorização, auditoria, CNPJ numérico/alfanumérico, conexão TLS PostgreSQL, isolamento de agregações, criação atômica com auditoria, tratamento de falha e fallback Gemini.

Atualização em **06/10/2026**: o build atual passou; `npm run test:cov` passou com **11 suítes/43 testes**, mantendo a mesma cobertura. `GET /api/v1/health` foi reiniciado e verificado com HTTP 200, sem exigir autenticação. O sistema continua somente em Preview e não foi publicado.

Atualização em **07/10/2026**: `npm run test:cov` passou novamente com **11 suítes/45 testes**; cobertura Jest global de **91,03% statements, 72,00% branches, 94,82% functions e 94,55% lines**. A suíte inclui a rejeição de categoria incompatível com o tipo da transação antes de qualquer gravação; são testes unitários e não acessam o Supabase. O build da versão com essa regra havia passado na validação de 06/10. O sistema continua somente em Preview e não foi publicado.

Atualização em **08/10/2026**: o GET paginado de transações está integrado ao Dashboard por BFF, com filtros validados, datas inclusivas, paginação de até 100 itens e escopo da empresa autenticada; nenhum schema ou registro do banco foi alterado. `npm test` e `npm run build` passaram; `npm run test:cov` passou com **11 suítes/48 testes**, cobertura de **91,39% statements, 72,61% branches, 95,00% functions e 94,78% lines**. São testes unitários e não acessam o Supabase. O sistema continua somente em Preview e não foi publicado.

Atualização em **15/10/2026**: os 48 testes/11 suítes passaram novamente com a mesma cobertura. Após o usuário reativar o Supabase pausado, a mesma URI respondeu com TLS validado; o teste real acrescentou uma conta/empresa com aceite e receita de R$ 1.000,00/despesa de R$ 200,00, resultando em saldo de R$ 800,00, login/logout e histórico persistidos. O inventário de 06/10 acima é histórico, não a contagem atual. Os registros anteriores e os novos foram preservados. O health HTTP verifica processo, não disponibilidade do banco. ReceitaWS/Gemini não foram chamados novamente neste teste. A build otimizada Next servida localmente foi o modo funcional da Preview; o site não foi publicado.

O primeiro release ainda não possui refresh token, recuperação/verificação de e-mail, MFA, calendário tributário oficial, envio de declarações ou relatórios exportáveis. Termos e Política de Privacidade são minutas acadêmicas e requerem identificação do controlador, contato, retenção e revisão antes de uso real. O site não foi publicado.
