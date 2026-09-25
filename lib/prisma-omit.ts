/**
 * Campos que NUNCA saem de uma query do Prisma por padrão — configuração
 * global (`omit` do PrismaClient), aplicada em TODO cliente criado no
 * projeto (lib/prisma.ts, lib/search-db.ts).
 *
 * Por que existe (relatório de QA, achado A1): `include: { owner: true }` /
 * `include: { user: true }` devolvem a linha INTEIRA de User, e o hash bcrypt
 * da senha (User.password) foi parar no corpo de POST /api/tasks (e de
 * qualquer rota que embutia o responsável/autor) — qualquer usuário logado
 * coletava hash de colegas pra quebrar offline. Havia ~16 pontos assim; tapar
 * um a um deixaria a porta aberta pro próximo `include` que alguém escrever.
 * Com o `omit` global o campo simplesmente não é lido do banco, em nenhuma
 * consulta, incluindo relações aninhadas — e o TypeScript passa a acusar
 * quem tentar ler `user.password` sem pedir.
 *
 * Único lugar que precisa do hash: o login (lib/auth.ts), que pede
 * explicitamente `omit: { password: false }`. Qualquer outro novo uso deve
 * fazer o mesmo, conscientemente, e nunca devolver o resultado numa resposta.
 */
export const GLOBAL_OMIT = {
  user: { password: true },
} as const;
