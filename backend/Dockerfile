# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# O prisma.config.ts exige DATABASE_URL para carregar a configuração, mas generate não conecta ao banco.
# URL local sem credenciais, usada apenas nesta instrução de build.
RUN DATABASE_URL=postgresql://localhost:5432/build npm run prisma:generate
RUN npm run build

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0 \
    ATTACHMENT_STORAGE_DIR=/app/var/attachments
RUN mkdir -p /app/var/attachments && chown node:node /app/var/attachments
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3001') + '/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
