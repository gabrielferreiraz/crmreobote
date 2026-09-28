/**
 * Cadastro público (qualquer pessoa cria uma organização nova em /register).
 *
 * DESLIGADO por padrão desde a auditoria de 09/2026: esta instalação atende uma
 * empresa só, e um cadastro aberto na internet era o primeiro passo da tomada
 * de conta entre organizações (ver lib/org-membership-guard.ts) — além de
 * deixar qualquer um criar organização no banco de produção. Usuário novo
 * entra pelo Dono (Configurações → Usuários).
 *
 * Pra vender como SaaS (cadastro self-service), basta PUBLIC_SIGNUP_ENABLED=true
 * no ambiente — a trava de filiação continua valendo mesmo com o cadastro aberto.
 */
export function isPublicSignupEnabled(): boolean {
  return process.env.PUBLIC_SIGNUP_ENABLED === "true";
}
