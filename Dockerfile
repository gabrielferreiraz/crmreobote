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

USER nextjs

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
