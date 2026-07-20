/**
 * SSO por token assinado pro Simulador (sistema externo separado, ver botão
 * "Simulador" no header) — nunca compartilha cookie/sessão entre domínios
 * (impossível pelo próprio navegador); em vez disso, o CRM assina um token
 * de curtíssima duração dizendo "este é o usuário X", e o Simulador confere
 * a assinatura com o MESMO segredo antes de criar a própria sessão dele.
 * Nenhuma senha trafega nunca — funciona igual não importa a política de
 * senha do Simulador (importante pra quando o CRM for vendido pra fora:
 * `organizationId` já vai no token, pronto pra cada organização ter seu
 * próprio Simulador/segredo no futuro, em vez de ficar preso à Reobote).
 *
 * Formato do token: "<payload base64url>.<assinatura hex>" — HMAC-SHA256 do
 * payload com SIMULADOR_SSO_SECRET (compartilhado entre os dois sistemas).
 * Curto de propósito (60s) — só precisa sobreviver ao redirecionamento do
 * clique até o Simulador processar, nunca é reutilizável depois disso.
 *
 * `verifySimuladorSsoToken` existe aqui só como REFERÊNCIA pro lado do
 * Simulador implementar (mesmo algoritmo, HMAC-SHA256 é padrão em qualquer
 * linguagem/stack) — o CRM nunca chama essa função sozinho, quem verifica de
 * verdade é o outro sistema.
 */

import { createHmac } from "node:crypto";
import { secureEqual } from "@/lib/security/secure-compare";

const TOKEN_TTL_SECONDS = 60;

function getSecret(): string {
  const secret = process.env.SIMULADOR_SSO_SECRET;
  if (!secret) throw new Error("SIMULADOR_SSO_SECRET não configurado");
  return secret;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

export type SimuladorSsoPayload = {
  email: string;
  name: string;
  organizationId: string;
  userId: string;
  iat: number;
  exp: number;
};

export function buildSimuladorSsoToken(user: { id: string; email: string; name: string; organizationId: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SimuladorSsoPayload = {
    email: user.email,
    name: user.name,
    organizationId: user.organizationId,
    userId: user.id,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", getSecret()).update(encodedPayload).digest("hex");
  return `${encodedPayload}.${signature}`;
}

/** Referência pro Simulador — ver nota no topo do arquivo. */
export function verifySimuladorSsoToken(token: string): SimuladorSsoPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expected = createHmac("sha256", getSecret()).update(encodedPayload).digest("hex");
  if (!secureEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SimuladorSsoPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
