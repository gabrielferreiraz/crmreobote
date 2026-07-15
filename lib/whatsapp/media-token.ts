/**
 * Token de curta duração pra app/api/whatsapp/media-file/[...key] — essa
 * rota hoje só é protegida pelo prefixo fixo "whatsapp-media/" na chave, sem
 * autenticação nenhuma (é chamada pelo Evolution API, nunca pelo navegador,
 * então não dá pra usar sessão). Se a chave vazar (histórico de proxy, log),
 * a mídia ficava acessível pra sempre, de qualquer organização.
 *
 * Vai como SEGMENTO DE PATH (não query string) de propósito: o Evolution
 * acrescenta um "?timestamp=" na URL antes de baixar (ver comentário em
 * lib/whatsapp/send.ts), o que corromperia um token em query string.
 */
import crypto from "crypto";
import { secureEqual } from "@/lib/security/secure-compare";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1h — mesmo TTL das URLs assinadas do R2 usadas no resto do app

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET não configurado");
  return s;
}

function sign(key: string, expires: number): string {
  return crypto.createHmac("sha256", secret()).update(`${key}:${expires}`).digest("hex");
}

export function signMediaKey(key: string): string {
  const expires = Date.now() + TOKEN_TTL_MS;
  return `${expires}.${sign(key, expires)}`;
}

export function verifyMediaToken(key: string, token: string | undefined): boolean {
  if (!token) return false;
  const [expiresStr, sig] = token.split(".");
  const expires = Number(expiresStr);
  if (!sig || !Number.isFinite(expires) || Date.now() > expires) return false;
  return secureEqual(sig, sign(key, expires));
}
