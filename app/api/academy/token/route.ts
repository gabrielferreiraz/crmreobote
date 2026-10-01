import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant, runWithAcademyCredentialLookup } from "@/lib/tenant-context";
import { rateLimitOrResponse, getClientIp } from "@/lib/rate-limit";
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_SESSION_TTL_MS,
  REFRESH_ROTATION_GRACE_MS,
  verifyClientBasicAuth,
  verifyPkce,
  generateOpaqueSecret,
  hashReceivedSecret,
  mapOrgRoleToAcademyRole,
} from "@/lib/academy-oauth";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, status: number, extraHeaders?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache", ...extraHeaders } });
}
const invalidClientResponse = () => jsonNoStore({ error: "invalid_client" }, 401, { "WWW-Authenticate": "Basic" });
// Mensagem SEMPRE genérica (nunca diz qual dos itens 2-6 falhou) — ver spec
// da Academy: "sem detalhes". Evita virar um oráculo pra quem está tentando
// adivinhar code/code_verifier.
const invalidGrantResponse = () => jsonNoStore({ error: "invalid_grant" }, 400);

type Membership = { active: boolean; role: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER" };

async function getFreshMembership(organizationId: string, userId: string): Promise<Membership | null> {
  return runWithTenant(organizationId, () =>
    prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { active: true, role: true },
    }),
  );
}

function tokenResponseBody(params: {
  accessToken: string;
  refreshToken?: string;
  userId: string;
  role: Membership["role"];
}) {
  return {
    access_token: params.accessToken,
    token_type: "Bearer",
    expires_in: Math.round(ACCESS_TOKEN_TTL_MS / 1000),
    ...(params.refreshToken
      ? { refresh_token: params.refreshToken, refresh_expires_in: Math.round(REFRESH_TOKEN_SESSION_TTL_MS / 1000) }
      : {}),
    user: { id: params.userId, role: mapOrgRoleToAcademyRole(params.role) },
  };
}

/**
 * POST /api/academy/token — troca (`grant_type=authorization_code`) ou
 * renova (`grant_type=refresh_token`) tokens. Chamado SÓ pelo backend da
 * Academy (nunca o navegador) — client autenticado via HTTP Basic (RFC
 * 6749 §2.3.1), nunca por cookie/sessão do CRM.
 *
 * Nada aqui é logado em caso de erro: nem o `code`, nem `code_verifier`,
 * nem tokens, nem o header Authorization — as mensagens de erro são sempre
 * genéricas o bastante pra não precisar disso pra depurar (ver spec da
 * Academy, item de segurança).
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const ipLimited = rateLimitOrResponse(`academy-token-ip:${ip}`, 120, 60_000);
  if (ipLimited) return ipLimited;

  const clientAuth = verifyClientBasicAuth(req);
  // Rate limit também por client_id (mesmo se inválido — impede adivinhar o
  // client_id certo por força bruta batendo de vários IPs).
  const clientLimited = rateLimitOrResponse(`academy-token-client:${clientAuth.clientId ?? "unknown"}`, 120, 60_000);
  if (clientLimited) return clientLimited;
  if (!clientAuth.ok) return invalidClientResponse();

  const body = await req.formData().catch(() => null);
  if (!body) return invalidGrantResponse();

  const grantType = body.get("grant_type");
  const bodyClientId = body.get("client_id");
  // O client_id do corpo precisa coincidir com o do Basic (spec explícito).
  if (typeof bodyClientId !== "string" || bodyClientId !== clientAuth.clientId) return invalidGrantResponse();

  if (grantType === "authorization_code") {
    const code = body.get("code");
    const codeVerifier = body.get("code_verifier");
    if (typeof code !== "string" || typeof codeVerifier !== "string" || !code || !codeVerifier) {
      return invalidGrantResponse();
    }

    const codeHash = hashReceivedSecret(code);
    const codeRow = await runWithAcademyCredentialLookup(codeHash, () => prisma.academyAuthCode.findUnique({ where: { codeHash } }));
    if (!codeRow) return invalidGrantResponse();

    // Uso único, reivindicado ATOMICAMENTE — mesmo se tudo mais abaixo
    // falhar (PKCE errado, expirado), o code já morreu a partir daqui
    // (spec explícito: "mesmo se a troca falhar"). O UPDATE só afeta a
    // linha se `usedAt` ainda for null — é essa condição no WHERE que
    // resolve a corrida entre duas trocas concorrentes do MESMO code.
    const claim = await runWithAcademyCredentialLookup(codeHash, () =>
      prisma.academyAuthCode.updateMany({ where: { id: codeRow.id, usedAt: null }, data: { usedAt: new Date() } }),
    );
    if (claim.count === 0) {
      // Reuso: remove a origem e, por cascade, todos os tokens derivados.
      // Isso também fecha a corrida com um refresh que já leu seu token,
      // mas ainda não chegou a criar a substituição.
      await runWithTenant(codeRow.organizationId, async () => {
        await prisma.academyAuthCode.deleteMany({ where: { id: codeRow.id } });
      });
      return invalidGrantResponse();
    }

    if (codeRow.expiresAt <= new Date()) return invalidGrantResponse();
    if (!verifyPkce(codeVerifier, codeRow.codeChallenge)) return invalidGrantResponse();

    const membership = await getFreshMembership(codeRow.organizationId, codeRow.userId);
    if (!membership?.active) return invalidGrantResponse();

    const access = generateOpaqueSecret();
    const refresh = generateOpaqueSecret();
    const now = Date.now();
    await runWithTenant(codeRow.organizationId, () =>
      prisma.$transaction([
        prisma.academyAccessToken.create({
          data: {
            organizationId: codeRow.organizationId,
            userId: codeRow.userId,
            tokenHash: access.hash,
            issuedFromCodeId: codeRow.id,
            expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
          },
        }),
        prisma.academyRefreshToken.create({
          data: {
            organizationId: codeRow.organizationId,
            userId: codeRow.userId,
            tokenHash: refresh.hash,
            issuedFromCodeId: codeRow.id,
            sessionExpiresAt: new Date(now + REFRESH_TOKEN_SESSION_TTL_MS),
          },
        }),
      ]),
    );

    return jsonNoStore(
      tokenResponseBody({ accessToken: access.value, refreshToken: refresh.value, userId: codeRow.userId, role: membership.role }),
      200,
    );
  }

  if (grantType === "refresh_token") {
    const refreshToken = body.get("refresh_token");
    if (typeof refreshToken !== "string" || !refreshToken) return invalidGrantResponse();

    const refreshHash = hashReceivedSecret(refreshToken);
    const refreshRow = await runWithAcademyCredentialLookup(refreshHash, () =>
      prisma.academyRefreshToken.findUnique({ where: { tokenHash: refreshHash } }),
    );
    if (!refreshRow) return invalidGrantResponse();
    if (refreshRow.revokedAt) return invalidGrantResponse();

    const now = new Date();
    if (refreshRow.sessionExpiresAt <= now) return invalidGrantResponse();
    // Já foi substituído (rotação) — ainda aceito por GRACE_WINDOW_MS (ver
    // comentário no schema), inválido depois disso.
    if (refreshRow.replacedAt && now.getTime() - refreshRow.replacedAt.getTime() > REFRESH_ROTATION_GRACE_MS) {
      return invalidGrantResponse();
    }

    const membership = await getFreshMembership(refreshRow.organizationId, refreshRow.userId);
    if (!membership?.active) return invalidGrantResponse();

    const access = generateOpaqueSecret();

    if (refreshRow.replacedAt) {
      // Chamada concorrente de um refresh_token que OUTRA requisição
      // paralela já rotacionou há pouco (dentro da janela de graça) — ainda
      // válido, mas não gera um 2º refresh_token novo (campo opcional na
      // resposta, ver spec): só um access_token fresco. Evita uma árvore de
      // tokens crescendo sem fim a cada corrida.
      await runWithTenant(refreshRow.organizationId, () =>
        prisma.academyAccessToken.create({
          data: {
            organizationId: refreshRow.organizationId,
            userId: refreshRow.userId,
            tokenHash: access.hash,
            issuedFromCodeId: refreshRow.issuedFromCodeId,
            expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
          },
        }),
      );
      return jsonNoStore(tokenResponseBody({ accessToken: access.value, userId: refreshRow.userId, role: membership.role }), 200);
    }

    // Reivindica a rotação ATOMICAMENTE (mesma técnica do code acima) —
    // `replacedAt: null` no WHERE resolve a corrida entre chamadas
    // concorrentes do MESMO refresh_token: só a primeira a chegar aqui cria
    // um refresh_token novo de verdade, as demais caem no ramo acima.
    const claim = await runWithTenant(refreshRow.organizationId, () =>
      prisma.academyRefreshToken.updateMany({ where: { id: refreshRow.id, replacedAt: null }, data: { replacedAt: now } }),
    );
    if (claim.count === 0) {
      // Perdeu a corrida contra outra requisição concorrente — mesmo ramo
      // de "só access_token novo" acima.
      await runWithTenant(refreshRow.organizationId, () =>
        prisma.academyAccessToken.create({
          data: {
            organizationId: refreshRow.organizationId,
            userId: refreshRow.userId,
            tokenHash: access.hash,
            issuedFromCodeId: refreshRow.issuedFromCodeId,
            expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
          },
        }),
      );
      return jsonNoStore(tokenResponseBody({ accessToken: access.value, userId: refreshRow.userId, role: membership.role }), 200);
    }

    const refresh = generateOpaqueSecret();
    await runWithTenant(refreshRow.organizationId, () =>
      prisma.$transaction([
        prisma.academyAccessToken.create({
          data: {
            organizationId: refreshRow.organizationId,
            userId: refreshRow.userId,
            tokenHash: access.hash,
            issuedFromCodeId: refreshRow.issuedFromCodeId,
            expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
          },
        }),
        prisma.academyRefreshToken.create({
          data: {
            organizationId: refreshRow.organizationId,
            userId: refreshRow.userId,
            tokenHash: refresh.hash,
            issuedFromCodeId: refreshRow.issuedFromCodeId,
            // NUNCA estendido — o mesmo teto absoluto da sessão original.
            sessionExpiresAt: refreshRow.sessionExpiresAt,
          },
        }),
      ]),
    );

    return jsonNoStore(
      tokenResponseBody({ accessToken: access.value, refreshToken: refresh.value, userId: refreshRow.userId, role: membership.role }),
      200,
    );
  }

  return jsonNoStore({ error: "unsupported_grant_type" }, 400);
}
