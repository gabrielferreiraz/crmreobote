/**
 * OAuth 2.0 Authorization Code + PKCE (S256) pra Reobote Academy — substitui
 * o fluxo anterior de token JWT passado direto (ver git history de
 * lib/academy-auth.ts, removido). Nenhum token passa mais pelo navegador:
 * só um `code` opaco de uso único, de 60s, que sem o `code_verifier` (que
 * nunca sai do lado da Academy) não serve pra nada.
 *
 * Fluxo completo:
 * 1. GET /api/academy/authorize (navegador, sessão do CRM) — valida PKCE,
 *    cria um AcademyAuthCode, redireciona pra Academy com `code`+`state`.
 * 2. POST /api/academy/token (só o BACKEND da Academy, client_id+secret via
 *    HTTP Basic) — troca `code`+`code_verifier` por access_token (15min) +
 *    refresh_token (8h, teto absoluto desde o login), ou renova um par a
 *    partir de um refresh_token ainda válido.
 * 3. GET/POST /api/academy/{me,progresso,progresso/me} — autenticadas pelo
 *    access_token opaco (ver lib/require-academy-token.ts), não mais JWT.
 *
 * O cliente "reobote-academy" é ÚNICO e fixo — vive em variável de
 * ambiente (ACADEMY_CLIENT_ID/ACADEMY_CLIENT_SECRET_HASH), mesmo padrão de
 * todo outro segredo compartilhado com sistema externo deste projeto
 * (SIMULADOR_SSO_SECRET, CRON_SECRET etc.): não é uma plataforma de
 * terceiros com vários clientes, não precisa de tabela de registro.
 * ACADEMY_CLIENT_SECRET_HASH é o HASH (sha256 hex) do segredo de verdade —
 * o CRM nunca guarda o segredo em texto puro em lugar nenhum, só compara
 * contra o hash (mesma lógica de nunca guardar senha em texto puro).
 * Calcular o hash uma vez, fora deste projeto:
 *   node -e "console.log(require('crypto').createHash('sha256').update('O_SEGREDO_AQUI').digest('hex'))"
 *
 * MULTI-TENANT — mesma peça que o spec original da Academy não previa (ver
 * comentário em Progresso, prisma/schema.prisma): todo `code`/token carrega
 * `organizationId`, capturado da sessão CRM ativa no momento do
 * /authorize e propagado sem mudar através de toda troca/renovação — é o
 * que permite cada chamada de /api/academy/* rodar dentro de runWithTenant.
 */

import { randomBytes, createHash } from "node:crypto";
import { secureEqual } from "@/lib/security/secure-compare";
import type { $Enums } from "@/app/generated/prisma/client";

export const AUTH_CODE_TTL_MS = 60_000;
export const ACCESS_TOKEN_TTL_MS = 15 * 60_000;
/** Teto ABSOLUTO da sessão, desde o login — nunca estendido por renovação (ver sessionExpiresAt no schema). */
export const REFRESH_TOKEN_SESSION_TTL_MS = 8 * 60 * 60_000;
/** Depois de um refresh_token ser substituído (renovação), ainda aceito por esta janela — chamadas paralelas da mesma sessão podem renovar quase ao mesmo tempo. */
export const REFRESH_ROTATION_GRACE_MS = 60_000;

/** "admin" enxerga o progresso de todo mundo; "consultor" só o próprio (ver
 * GET /api/academy/progresso). Só dois valores — é tudo que a Academy
 * precisa saber, o papel de verdade (OrgRole) continua sendo decisão deste
 * CRM, nunca da Academy. */
export type AcademyRole = "admin" | "consultor";

/**
 * OWNER/MANAGER = "admin" (mesmo corte que já separa "quem gerencia" do
 * resto em outros pontos do sistema — ver ALLOWED_ROLES em
 * app/api/tv-display-link/route.ts, o mesmo par). SUPERVISOR/MEMBER =
 * "consultor". Se a intenção for um dia um supervisor enxergar o progresso
 * da própria equipe (não de todo mundo) na Academy, este corte NÃO cobre
 * isso — ajustar aqui é a única mudança necessária.
 */
export function mapOrgRoleToAcademyRole(role: $Enums.OrgRole): AcademyRole {
  return role === "OWNER" || role === "MANAGER" ? "admin" : "consultor";
}

function hashOpaque(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** `code`/`access_token`/`refresh_token` opacos — 32 bytes (256 bits), bem acima do piso de 128 bits pedido pro `code`. */
export function generateOpaqueSecret(): { value: string; hash: string } {
  const value = randomBytes(32).toString("base64url");
  return { value, hash: hashOpaque(value) };
}

/** Mesmo hash usado pra GUARDAR (generateOpaqueSecret) — usado pra PROCURAR um valor recebido de fora. */
export function hashReceivedSecret(value: string): string {
  return hashOpaque(value);
}

// ── PKCE (RFC 7636) ─────────────────────────────────────────────────────

/** base64url(SHA-256(verifier)) de um `code_verifier` REAL sempre dá exatamente 43 caracteres — é matemática do próprio SHA-256 (32 bytes), não uma regra arbitrária. */
export function isValidCodeChallenge(challenge: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(challenge);
}

/** RFC 7636 §4.1 — alfabeto "unreserved" de URI, 43 a 128 caracteres. */
export function isValidCodeVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(verifier);
}

/** Confere se `verifier` corresponde ao `challenge` gravado no momento de /authorize — comparação em tempo constante (os dois já são strings de tamanho fixo/conhecido). */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return secureEqual(computed, challenge);
}

/** `state` é opaco pro CRM — só confere formato/tamanho (o spec da Academy: "43 caracteres hoje; aceitar até 512"), nunca interpreta o conteúdo. */
export function isValidState(state: string): boolean {
  return /^[A-Za-z0-9_-]{1,512}$/.test(state);
}

// ── Cliente OAuth (único, fixo, via env — ver comentário no topo) ──────

export type ClientAuthResult = { ok: true; clientId: string } | { ok: false; error: "invalid_client"; clientId: string | null };

// Nenhuma das duas LANÇA — devolvem null quando a env var falta. Achado em
// produção (2026-10-01): a versão anterior lançava `Error`, e GET
// /authorize chamava isKnownClientId ANTES de qualquer try/catch — sem
// ACADEMY_CLIENT_ID configurado, TODA requisição de autorização batia
// nesse throw não tratado e virava 500 genérico do Next ("Esta página não
// está funcionando"), nunca chegando no 400 que o próprio spec da Academy
// pede explicitamente pra "parâmetro inválido" ("nenhum undefined sem
// tratamento"). Falta de configuração não é exceção — é um estado
// esperado/checável, e precisa ser tratado como "cliente não confere"
// (nunca aceitar por engano), nunca como erro de servidor opaco.
function getExpectedClientId(): string | null {
  return process.env.ACADEMY_CLIENT_ID || null;
}

function getExpectedClientSecretHash(): string | null {
  return process.env.ACADEMY_CLIENT_SECRET_HASH || null;
}

/** `client_id` sozinho não é segredo (é só um identificador, tipo usuário) — usado em GET /authorize, onde não há Basic auth nenhum (a Academy ainda não "falou" com o backend do CRM nesse passo, é o navegador). Sem ACADEMY_CLIENT_ID configurado, nunca bate (fail-closed), nunca lança. */
export function isKnownClientId(clientId: string): boolean {
  const expected = getExpectedClientId();
  return expected !== null && clientId === expected;
}

/**
 * HTTP Basic (RFC 6749 §2.3.1): `Authorization: Basic base64(urlencode(id) + ":" + urlencode(secret))`.
 * client_id comparado por igualdade simples (não é segredo); client_secret
 * só por hash, em tempo constante — nunca comparamos o segredo em texto
 * puro contra nada (nem sequer o mantemos em variável de ambiente deste
 * lado, só o hash dele).
 */
export function verifyClientBasicAuth(req: Request): ClientAuthResult {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return { ok: false, error: "invalid_client", clientId: null };

  let decoded: string;
  try {
    decoded = Buffer.from(header.slice("Basic ".length).trim(), "base64").toString("utf8");
  } catch {
    return { ok: false, error: "invalid_client", clientId: null };
  }

  const sep = decoded.indexOf(":");
  if (sep < 0) return { ok: false, error: "invalid_client", clientId: null };

  let clientId: string;
  let clientSecret: string;
  try {
    clientId = decodeURIComponent(decoded.slice(0, sep));
    clientSecret = decodeURIComponent(decoded.slice(sep + 1));
  } catch {
    return { ok: false, error: "invalid_client", clientId: null };
  }

  const expectedId = getExpectedClientId();
  const expectedSecretHash = getExpectedClientSecretHash();
  if (expectedId === null || expectedSecretHash === null) return { ok: false, error: "invalid_client", clientId };
  if (clientId !== expectedId) return { ok: false, error: "invalid_client", clientId };
  if (!secureEqual(hashOpaque(clientSecret), expectedSecretHash)) {
    return { ok: false, error: "invalid_client", clientId };
  }

  return { ok: true, clientId };
}

/**
 * Base da Academy — pública por natureza (é só o domínio dela, visível pro
 * navegador no instante em que ele navega pra lá; ver NEXT_PUBLIC_* já
 * documentado em outros pontos do projeto) — mesma variável usada tanto no
 * servidor (construir a URL de callback) quanto nos botões/links do
 * front-end (apontar pra `${ACADEMY_URL}/auth/start`), pra nunca dessincronizar.
 * HTTPS obrigatório em produção (ver item 5 do spec da Academy).
 */
export function getAcademyBaseUrl(): URL | null {
  // Production uses ACADEMY_URL. The public name stays as a local legacy fallback.
  const raw = process.env.ACADEMY_URL ?? process.env.NEXT_PUBLIC_ACADEMY_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}
