/**
 * SSO por token assinado pro Painel de Nichos (sistema externo separado,
 * mesma ideia do Simulador — ver lib/simulador-sso.ts, mesmo padrão,
 * arquivo próprio e independente) — nunca compartilha cookie/sessão entre
 * domínios (impossível pelo próprio navegador); em vez disso, o CRM assina
 * um token de curtíssima duração dizendo "este é o usuário X", e o Painel
 * de Nichos confere a assinatura com o MESMO segredo antes de criar a
 * própria sessão dele. Nenhuma senha trafega nunca.
 *
 * Formato do token: "<payload base64url>.<assinatura hex>" — HMAC-SHA256 do
 * payload com PAINEL_NICHOS_SSO_SECRET (compartilhado entre os dois
 * sistemas). Curto de propósito (60s) — só precisa sobreviver ao
 * redirecionamento do clique até o Painel de Nichos processar, nunca é
 * reutilizável depois disso.
 *
 * `aud: "painel-nichos"` no payload — diferente do Simulador (que não tem
 * esse campo): identifica pra que sistema este token foi emitido, útil se
 * um dia os dois (ou mais) passarem a compartilhar algum segredo por
 * engano, ou se o Painel de Nichos quiser recusar um token emitido por
 * outro fluxo.
 *
 * Verificação de verdade é do OUTRO lado (o Painel de Nichos), com o mesmo
 * algoritmo — HMAC-SHA256 é padrão em qualquer stack. Não existe uma função
 * de verificação aqui porque o CRM nunca precisa conferir o próprio token.
 */

import { createHmac } from "node:crypto";

const TOKEN_TTL_SECONDS = 60;

function getSecret(): string {
  const secret = process.env.PAINEL_NICHOS_SSO_SECRET;
  if (!secret) throw new Error("PAINEL_NICHOS_SSO_SECRET não configurado");
  return secret;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

export type PainelNichosSsoPayload = {
  aud: "painel-nichos";
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  iat: number;
  exp: number;
};

export function buildPainelNichosSsoToken(user: { id: string; email: string; name: string; organizationId: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: PainelNichosSsoPayload = {
    aud: "painel-nichos",
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: user.organizationId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", getSecret()).update(encodedPayload).digest("hex");
  return `${encodedPayload}.${signature}`;
}
