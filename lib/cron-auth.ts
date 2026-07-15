import { secureEqual } from "@/lib/security/secure-compare";

/** Autenticação dos 4 crons (automations/campaigns/whatsapp-health/whatsapp-media-cleanup) — mesmo CRON_SECRET compartilhado, comparação em tempo constante. */
export function isAuthorizedCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  const expected = secret ? `Bearer ${secret}` : null;
  return !!expected && !!header && secureEqual(header, expected);
}
