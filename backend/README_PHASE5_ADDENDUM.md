# Fase 5 — auditoria, ReceitaWS e finanças

## Estado do schema Supabase

A migração inicial `prisma/migrations/20261005120000_gft_initial/migration.sql` foi aplicada em 05/10/2026 no projeto “Gestão Financeira”, somente no schema `gft_inteligente`, via Session Pooler e TLS, com CA e hostname verificados. A validação confirmou seis tabelas de aplicação com RLS ativo; `PUBLIC`, `anon`, `authenticated` e `service_role` não receberam privilégios de acesso ao schema; `public` não foi alterado.

A checagem imediatamente pós-migração encontrou o schema vazio. O E2E subsequente inseriu dados sintéticos, mantidos no banco conforme instrução do usuário: **3 contas/empresas, 3 aceites versionados, 6 transações e 17 eventos de auditoria**. Nenhum dado real foi usado ou apagado.

Para preparar uma instalação, configure `DATABASE_URL` e `DATABASE_CA_CERT`, confirme projeto/schema/histórico e execute:

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy:supabase
npm run build
npm run test:cov
```

O procedimento de deploy usa arquivo CA temporário `0600`, `sslmode=verify-full`, validação de hostname, redação da DSN e remoção do arquivo temporário. Não aplique a baseline sobre schema populado sem revisão.

## Rotas adicionadas

| Método | Rota | Acesso | Observação |
|---|---|---|---|
| `GET` | `/api/v1/audit-logs?page=1&limit=20&action=...&from=...&to=...` | JWT + `OWNER`/`ADMIN` | Paginada e limitada à empresa do principal |
| `GET` | `/api/v1/business-registry/cnpj/:cnpj` | JWT; limitado por IP | ReceitaWS, valida CNPJ numérico/alfanumérico, cache e auditoria mascarada |
| `GET` | `/api/v1/finance/dashboard?months=3|6|12` | JWT | Agregados e lançamentos da empresa do principal |
| `POST` | `/api/v1/finance/transactions` | JWT + `OWNER`/`ADMIN`/`MEMBER` | Valida/persiste entrada ou saída e registra auditoria atomicamente |
| `POST` | `/api/v1/finance/insights` | JWT; até 5/min | Gemini sob demanda, apenas métricas agregadas e categorias controladas |

O `companyId` sempre vem do principal JWT. Valores monetários são `DECIMAL(14,2)` e a migration também impõe positividade no banco.

## Integrações

`GEMINI_API_KEY` é opcional na inicialização e necessária somente para insights. `GEMINI_MODEL` configura o modelo principal (padrão `gemini-3.8-flash`). Se o provedor retornar **HTTP 503**, o servidor tenta uma vez `gemini-3.5-flash-lite`; não há fallback para outros erros. O modelo utilizado e o resultado são auditados. No smoke integrado, o modelo principal apresentou 503 e o fallback retornou insight válido por meio do BFF/API.

A chamada Gemini tem timeout de 20 segundos; o prompt não contém descrições, e-mail, CNPJ ou IDs. A ReceitaWS é pública, sujeita a limites, cache de 15 minutos e disponibilidade do provedor. Uma consulta demonstrativa de CNPJ público retornou HTTP 200 com dados normalizados. Nenhuma resposta cadastral é persistida pelo painel do front-end.

## Testes

Em 05/10/2026, `npm run build` passou e `npm run test:cov` passou com **10 suítes e 42 testes**. Cobertura Jest: **90,96% statements, 71,81% branches, 94,82% functions e 94,49% lines**. A suíte cobre autenticação/autorização, auditoria, CNPJ numérico/alfanumérico, TLS, isolamento de agregações, criação financeira com auditoria e Gemini, incluindo fallback após 503.

No registro de 05/10/2026, o projeto ainda não estava publicado. Os documentos legais eram minutas acadêmicas; antes de uso real, seriam necessários revisão institucional e definição de controlador, contato e retenção.


## Atualização de validação — 06/10/2026

- Build atual do NestJS aprovado; suíte de cobertura aprovada com **11 suítes/43 testes**: **90,96% statements, 71,81% branches, 94,82% functions e 94,49% lines**.
- `GET /api/v1/health` foi verificado após reinício do serviço e respondeu HTTP 200.
- Contagem read-only no schema isolado `gft_inteligente`, usando o adaptador Prisma com TLS/CA verificados: **4 usuários, 4 empresas, 4 aceites versionados, 6 transações sintéticas e 19 eventos de auditoria**. Os dados permanecem conforme pedido; nenhum registro foi apagado ou alterado por essa consulta.
- O teste do fluxo de cadastro/login adicionou um registro sintético de demonstração, sem criar transação financeira. O fluxo de Preview HTTPS já confirmou sessão em cookie HttpOnly/Secure; os documentos legais continuam sendo minutas acadêmicas.
- O site continua sem publicação; publicação e exclusão dos dados sintéticos não foram realizadas.


## Atualização de validação — 07/10/2026

- `npm run test:cov` passou com **11 suítes/45 testes**; cobertura global: **91,03% statements, 72,00% branches, 94,82% functions e 94,55% lines**.
- A cobertura inclui o teste que rejeita categoria incompatível com `INCOME`/`EXPENSE` antes de iniciar a transação; esta execução é unitária e não acessa nem altera o Supabase.
- O build da versão com a regra RB01 havia passado na validação de 06/10. Nenhuma chamada ou gravação de dados foi feita nesta atualização.
- O Preview permanece sem publicação; os dados sintéticos continuam preservados conforme a instrução do usuário.


## Nota de contexto — 15/10/2026

Este adendo registra marcos históricos; afirmações de validação e cobertura acima referem-se às datas indicadas e não atestam execução ou implantação atual. O projeto individual é de Jorge Vinícius Kayaki Cerqueira (RGM 11262401310), orientado por Alessandro Aparecido da Silva Horas. A stack atual é Next.js 16, React 19, NestJS 11, Prisma 7, PostgreSQL 17 e Supabase. BigQuery, Cloud Run e Cloud SQL não estão implantados. O site não está publicado; os envios oficiais e ao GitHub estão pendentes. RF01–RF06 permanecem parciais; calendário e exportações não estão concluídos.

O inventário informado registra **71 testes frontend e 48 backend**. Uma medição posterior, em 15/10/2026 às 15:55, registrou **90,90% statements, 87,80% branches, 94,11% functions e 96,06% lines**. Essa medição não implica nova execução de build; os percentuais históricos anteriores foram mantidos.
