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

# Só marca o container como "saudável" depois que o server realmente responde
# — sem isso, o proxy pode trocar o tráfego pro container novo antes dele
# terminar de subir (ex.: enquanto ainda abre a primeira conexão com o banco
# remoto, que pode levar alguns segundos), resultando em "Not Found" logo
# após o deploy até o próximo request "por sorte" já achar tudo pronto.
#
# Usa `node` puro (módulo http embutido) em vez de wget/curl: a imagem
# `node:24-alpine` não garante ter nenhum dos dois instalado, e se o comando
# do healthcheck não existir, o container nunca fica "saudável" — o build
# continua dando sucesso, mas o deploy nunca troca o tráfego pro container
# novo (era exatamente o sintoma: build ok, site em produção continua com a
# versão antiga). `node` já existe garantido, é a própria imagem.
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
