import { createHash, randomBytes } from "node:crypto";

const KEY_PREFIX = "svw_";
const VISIBLE_PREFIX_LENGTH = 12;
const PAIRING_PREFIX = "svp_";

export function hashServopaWorkerKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateServopaWorkerKey(): { fullKey: string; keyPrefix: string; keyHash: string } {
  const fullKey = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    fullKey,
    keyPrefix: fullKey.slice(0, VISIBLE_PREFIX_LENGTH),
    keyHash: hashServopaWorkerKey(fullKey),
  };
}

export function readServopaWorkerBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const key = header.slice("Bearer ".length).trim();
  if (!key.startsWith(KEY_PREFIX) || key.length > 128) return null;
  return key;
}

/**
 * Código do instalador: `svp_<organizationId>.<segredo>`. O id da organização
 * não é segredo (só diz em qual tenant procurar); o segredo tem 256 bits e o
 * banco guarda somente o SHA-256 do código inteiro.
 */
export function generateServopaPairingCode(organizationId: string): { code: string; codeHash: string } {
  const code = `${PAIRING_PREFIX}${organizationId}.${randomBytes(32).toString("base64url")}`;
  return { code, codeHash: hashServopaWorkerKey(code) };
}

/** Nome do computador montado no próprio Windows: "usuário - computador". */
export function servopaWorkerName(windowsUser: string | undefined, computerName: string | undefined): string {
  const clean = (value: string | undefined) =>
    (value ?? "").normalize("NFC").replace(/[^\p{L}\p{N} ._-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return [clean(windowsUser), clean(computerName)].filter(Boolean).join(" - ") || "Computador";
}

export function parseServopaPairingCode(value: unknown): { code: string; organizationId: string; codeHash: string } | null {
  if (typeof value !== "string" || value.length > 160) return null;
  const match = /^svp_([a-z0-9]{10,40})\.[A-Za-z0-9_-]{43}$/.exec(value);
  if (!match) return null;
  return { code: value, organizationId: match[1], codeHash: hashServopaWorkerKey(value) };
}
