/**
 * Geração/hash do token do link público (sem login) da TV — mesmo raciocínio
 * de lib/api-keys.ts (o token em texto puro nunca é persistido, só o hash;
 * SHA-256 é suficiente porque o token já nasce de alta entropia, não é senha
 * escolhida por humano). Prefixo próprio (`tvpub_`) só pra reconhecer de
 * relance a que serve um token vazado num log, nunca confundir com uma
 * ApiKey (`crm_`) que teria muito mais poder.
 */

import { randomBytes, createHash } from "node:crypto";

const TOKEN_PREFIX = "tvpub_";
/** Quantos caracteres do início do token ficam visíveis na UI de gestão (nunca o token inteiro de novo). */
const VISIBLE_PREFIX_LENGTH = 12;

export function hashTvDisplayLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateTvDisplayLinkToken(): { fullToken: string; tokenPrefix: string; tokenHash: string } {
  const fullToken = `${TOKEN_PREFIX}${randomBytes(24).toString("hex")}`;
  return {
    fullToken,
    tokenPrefix: fullToken.slice(0, VISIBLE_PREFIX_LENGTH),
    tokenHash: hashTvDisplayLinkToken(fullToken),
  };
}
