

## Supabase PostgreSQL TLS (2026-10-05)

- Supabase's official SSL guide distinguishes `require` (encrypted, but it does **not** validate CA or hostname) from `verify-full` (encryption, CA validation and hostname validation); it recommends `verify-full` when SSL enforcement is used. Download the project's CA certificate from Database Settings → SSL Configuration: https://supabase.com/docs/guides/platform/ssl-enforcement
- Supabase's PSQL guide directs users to copy the URL from **Connect → Session Pooler** and use `sslmode=verify-full` plus `sslrootcert=<downloaded project certificate>`: https://supabase.com/docs/guides/database/psql
- node-postgres accepts `ssl.ca` with `rejectUnauthorized: true`. Its connection-string parser replaces the `ssl` object if SSL query parameters such as `sslmode` or `sslrootcert` are present, so the Prisma adapter removes those parameters before passing an explicit CA-verified TLS object: https://node-postgres.com/features/ssl
- This project normalizes PEM text collapsed by secret input, verifies TLS/hostname using the supplied project CA, and uses `verify-full` plus a temporary mode-0600 CA file for migrations. It never disables certificate validation.
- The protected Session Pooler URI resolved to IPv4; strict TLS verified against PostgreSQL 17. A read-only preflight confirmed that `gft_inteligente` did not exist. On 5 Oct. 2026 the baseline migration `20261005120000_gft_initial` was applied successfully and verified over the same CA-validated connection. Six application tables have RLS enabled; PUBLIC/anon/authenticated/service_role have no schema access; no users, companies or finance transactions were inserted for the migration check.

## Gemini and live integration verification (2026-10-05)

- Official Interactions API request/response reference: https://ai.google.dev/gemini-api/docs/interactions-overview. Official model catalog: https://ai.google.dev/gemini-api/docs/models.
- The service uses `gemini-3.8-flash` by default. Only when the primary call returns HTTP 503, it makes one fallback call to `gemini-3.5-flash-lite`; other HTTP statuses do not trigger another model call. The audit event records the selected model and result, and the response discloses the model that generated the insight.
- The integrated HTTPS Preview test observed HTTP 503/high demand from the primary model, then received a generated insight from the fallback through the NestJS endpoint/BFF (HTTP 201, expected for the POST endpoint). The prompt contained only synthetic aggregated finance metrics.
- The same end-to-end test confirmed a valid HTTP 200 CNPJ lookup through the authenticated front-end BFF and NestJS/ReceitaWS integration. No CNPJ response was persisted by the front-end panel.
- The final read-only, CA-verified Supabase count found 3 synthetic users/companies, 3 versioned acceptance rows, 6 synthetic finance transactions and 17 audit events. These records remain in the isolated `gft_inteligente` schema at the user's explicit instruction; no real user data was used and no records were deleted.
- Initial validation snapshot (2026-10-05): `npm run build` passed; 10 Jest suites/42 tests passed; 90.96% statements, 71.81% branches, 94.82% functions and 94.49% lines. The same snapshot recorded TypeScript typecheck and production build passing; 5 Vitest files/36 tests; 88.65% statements, 84.15% branches, 92.00% functions and 95.57% lines. Later validation records follow below.


## Atualização final de validação (2026-10-06)

- O teste E2E no Preview HTTPS confirmou cadastro, aceites, login, sessão protegida, dashboard, logout e novo login; a validação de formulários impediu o envio vazio e confirmou seletores das caixas de aceite e controle de visibilidade da senha.
- `GET /api/v1/health` respondeu HTTP 200 depois que o processo NestJS foi reiniciado com a build atual.
- Nova consulta read-only, por Prisma e conexão TLS com CA/hostname verificados, retornou somente contagens agregadas: 4 usuários, 4 empresas, 4 aceites versionados, 6 transações sintéticas e 19 eventos de auditoria. Foi criado um cadastro sintético adicional durante o fluxo de 06/10; nenhum lançamento foi acrescentado e nenhum registro foi excluído.
- Backend: build aprovado, 11 suítes/43 testes; 90,96% statements, 71,81% branches, 94,82% functions, 94,49% lines. Frontend: typecheck, 5 arquivos/37 testes e build de produção Next.js aprovados; 88,65% statements, 84,15% branches, 92,00% functions, 95,57% lines.
- O site continua sem publicação. Os dados são sintéticos e permanecem no schema Supabase `gft_inteligente` conforme a instrução expressa do usuário.


## Atualização de validação técnica — 2026-10-07

`npm run test:cov` passou novamente com **11 suítes e 45 testes**. Cobertura global: **91,03% statements, 72,00% branches, 94,82% functions e 94,55% lines**. A validação inclui a regra RB01 que rejeita categorias incompatíveis com o tipo de lançamento antes de abrir a transação; a execução atual é unitária e não usa o banco. O build dessa versão havia passado em 06/10. Não houve consulta ou alteração ao Supabase nesta atualização; os dados sintéticos permanecem preservados e o site continua sem publicação.

## Nota de estado atual (2026-10-15)

As seções anteriores registram validações e condições observadas nas datas indicadas; não devem ser interpretadas como evidência de implantação ou validação posterior. O projeto individual é de **Jorge Vinícius Kayaki Cerqueira (RGM 11262401310)**, com orientação de **Alessandro Aparecido da Silva Horas**. A stack atual é **Next.js 16, React 19, NestJS 11, Prisma 7, PostgreSQL 17 e Supabase**. **BigQuery, Cloud Run e Cloud SQL não estão implantados**; o site não foi publicado, e os envios oficiais e a submissão ao GitHub permanecem pendentes. **RF01–RF06 estão parcialmente implementados**; calendário e exportações não estão concluídos.

O inventário informado registra **71 testes de frontend e 48 de backend**. A medição posterior, realizada em **15/10/2026 às 15:55**, foi de **90,90% statements, 87,80% branches, 94,11% functions e 96,06% lines**. Esses dados não representam uma nova execução de build. Os percentuais e resultados históricos acima foram mantidos como registros datados.
