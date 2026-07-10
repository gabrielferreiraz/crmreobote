# ─── deps: instala as dependências ────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ─── builder: gera o client do Prisma e builda o Next ─────────────────
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# prisma generate só lê prisma/schema.prisma (não precisa de banco vivo).
# O valor abaixo é só um placeholder pra validação do schema não falhar por
# falta de env var — a URL de verdade só é usada em runtime.
ARG DATABASE_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder"
ENV DATABASE_URL=${DATABASE_URL}

RUN npx prisma generate
RUN npm run build

# ─── runner: imagem final, só com o necessário pra rodar ──────────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Carimbo de quando esta imagem foi montada — exposto em /api/health. Serve só
# pra diagnosticar deploy: dá pra confirmar de fora (curl) se o container que
# está respondendo em produção é mesmo o da build mais recente, ou se o
# EasyPanel nunca trocou o tráfego pro container novo.
RUN date -u +"%Y-%m-%dT%H:%M:%SZ" > /app/BUILD_TIME.txt

USER nextjs

ENV PORT=3000
EXPOSE 3000

# SEM HEALTHCHECK aqui de propósito — já tentamos duas vezes (wget, depois
# node puro) e nas duas o container entrou num loop de reinício constante em
# produção (o EasyPanel parece tratar "unhealthy" como motivo pra matar e
# recriar o container, não só pra segurar o corte de tráfego). Isso é bem
# pior do que o problema original ("Not Found" logo após o deploy, até o
# próximo request achar tudo pronto). Se for reintroduzir isso no futuro,
# testar com bastante cautela e acompanhar de perto os logs de runtime.
CMD ["node", "server.js"]
