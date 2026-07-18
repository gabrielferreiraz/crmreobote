/**
 * Cifra/decifra segredos reversíveis (tokens OAuth de terceiro) antes de
 * persistir — diferente de lib/api-keys.ts (hash, nunca precisa voltar ao
 * texto original), aqui a gente PRECISA do valor original de volta pra
 * mandar de volta pro Google. AES-256-GCM com uma chave de app dedicada
 * (nunca a mesma do NEXTAUTH_SECRET) via GOOGLE_TOKEN_ENCRYPTION_KEY.
 *
 * Formato do valor cifrado: "v1:<iv base64>:<authTag base64>:<ciphertext base64>".
 * O prefixo "v1:" existe pra `decryptSecret` diferenciar um valor já cifrado
 * por aqui de um valor legado gravado em texto puro (linhas do
 * GoogleCalendarConnection criadas antes desta cifra existir) — sem isso,
 * ligar a cifra quebraria toda conexão já existente na primeira leitura.
 * Valor legado é devolvido como está; volta a ser cifrado na próxima escrita
 * (reconexão ou renovação de access token), migrando organicamente sem
 * precisar de um script de backfill.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const PREFIX = "v1:";

function getKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY não configurado — necessário para gravar/renovar tokens do Google Calendar. " +
        "Gere 32 bytes aleatórios em base64, ex.: `node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"`.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY inválido — precisa decodificar (base64) para exatamente 32 bytes.");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/** Valor sem o prefixo "v1:" é tratado como legado em texto puro — devolvido como está. */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;

  const [ivB64, authTagB64, ciphertextB64] = stored.slice(PREFIX.length).split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Valor cifrado malformado — esperado v1:<iv>:<authTag>:<ciphertext>.");
  }

  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}
