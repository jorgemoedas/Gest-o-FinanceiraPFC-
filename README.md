# GFT Inteligente

Sistema web de gestão financeira e tributária para microempresas e microempreendedores individuais. A aplicação organiza lançamentos financeiros, dashboard, recorrências, contrapartes, obrigações fiscais, anexos, auditoria e consultas cadastrais.

## Arquitetura

O frontend usa Next.js, React, TypeScript e um BFF para as rotas web. O backend usa NestJS, Prisma e PostgreSQL. A autenticação é feita com JWT em cookie HttpOnly no fluxo web; autorização, isolamento por empresa, auditoria e validações permanecem no servidor e no banco.

A estrutura principal é:

- `src/`: frontend Next.js, componentes, clientes de API, validações e testes.
- `backend/src/`: módulos NestJS de autenticação, finanças, fiscal, auditoria, privacidade, observabilidade e cadastro empresarial.
- `backend/prisma/`: schema e migrations PostgreSQL.
- `backend/scripts/`: migração, manutenção, carga, backup e validações reproduzíveis.
- `scripts/`: scripts de contêineres e homologação.
- `docs/`: bases legais e referências usadas pelo simulador.
- `docker-compose.yml`, `Dockerfile` e arquivos de configuração: execução local e empacotamento.

## Requisitos

Node.js 22.12 ou superior compatível com os lockfiles, npm 10.9 ou superior e PostgreSQL compatível com o schema Prisma. As variáveis de ambiente devem ser configuradas a partir dos arquivos `.env.example`; credenciais reais não devem ser versionadas.

## Instalação

```bash
npm ci
cd backend
npm ci
npm run prisma:generate
cd ..
```

Configure o backend e o frontend conforme os respectivos `.env.example`. O backend usa a porta 3001 e o frontend usa a porta 3000.

## Execução

Em terminais separados:

```bash
cd backend
npm run start:dev
```

```bash
npm run dev
```

Para executar com contêineres:

```bash
docker compose up --build
```

## Testes e validação

Frontend:

```bash
npm test
npm run typecheck
npm run build
```

Backend:

```bash
cd backend
npm test
npm run test:cov
npm run build
```

A consolidação da Entrega 6 registrou 220 testes em 38 arquivos no frontend e 317 testes em 51 suítes no backend. A cobertura instrumentada alcançou 81,22% de instruções no frontend e 92,71% de linhas no backend, acima do mínimo de 50% definido para o projeto. Os percentuais se referem aos arquivos incluídos nas configurações de cobertura, não a código externo ou a dependências.

## Banco de dados

O schema e as migrations ficam em `backend/prisma`. Em banco existente, use `npm run prisma:migrate:deploy` somente após conferir a URL e o schema de destino. A aplicação usa contexto de empresa por transação e políticas de segurança de linha para restringir os registros ao tenant autenticado.

## Segurança e dados de demonstração

Não inclua senhas, tokens, chaves, certificados ou dados reais nos arquivos do projeto. Os testes e os scripts de carga usam dados sintéticos. Termos de Uso e Política de Privacidade são materiais acadêmicos e precisam de revisão jurídica antes de qualquer uso operacional.
