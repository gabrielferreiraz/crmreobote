import { createHmac, randomBytes } from "node:crypto";

/** HMAC-SHA256 do corpo cru (string exata que vai no POST) — quem recebe confere com o próprio secret pra saber que o webhook é legítimo. */
export function signPayload(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function generateWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}
