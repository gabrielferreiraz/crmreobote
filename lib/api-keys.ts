/**
 * Geração/hash de API keys de integração externa — a chave em texto puro
 * nunca é persistida, só o hash (lib/require-api-key.ts compara pelo hash na
 * autenticação). Chave de alta entropia gerada por nós mesmos não precisa de
 * um hash lento tipo bcrypt (isso é pra senha escolhida por humano, com
 * entropia baixa) — SHA-256 já é o padrão de mercado pra esse caso.
 */

import { randomBytes, createHash } from "node:crypto";

const KEY_PREFIX = "crm_";
/** Quantos caracteres do início da chave ficam visíveis na UI de gestão (nunca a chave inteira de novo). */
const VISIBLE_PREFIX_LENGTH = 12;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { fullKey: string; keyPrefix: string; keyHash: string } {
  const fullKey = `${KEY_PREFIX}${randomBytes(24).toString("hex")}`;
  return {
    fullKey,
    keyPrefix: fullKey.slice(0, VISIBLE_PREFIX_LENGTH),
    keyHash: hashApiKey(fullKey),
  };
}
