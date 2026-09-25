import { NextResponse } from "next/server";
import { getClientIp, rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Coletor de violações da Content-Security-Policy-Report-Only (ver next.config.ts).
 * O navegador manda um POST aqui (sem sessão, sem cookie garantido) toda vez que
 * algo violaria a política completa — nada é bloqueado, só relatado. Cada
 * violação DISTINTA vira UMA linha `[csp-report]` no log do servidor; com uma ou
 * duas semanas de uso real é possível decidir, com dados, promover a política
 * pra enforce.
 *
 * Endpoint público por natureza, então é defensivo em tudo:
 *  - limite por IP e corpo pequeno (não vira canal de spam/lotar disco);
 *  - só 4 campos, truncados e sem caractere de controle (não vira injeção de
 *    linha falsa no log);
 *  - NUNCA grava query string nem caminho completo: a URL de imagem assinada do
 *    R2 e o link público da TV (/t/CÓDIGO) carregam assinatura/código secreto —
 *    guarda só a origem do recurso bloqueado e o 1º segmento da página;
 *  - de-duplicação em memória com teto (um usuário abrindo 200 telas gera 200
 *    relatórios iguais; aqui vira 1 linha).
 */

const MAX_BODY_BYTES = 10_000;
const MAX_DISTINCT_LOGGED = 300;
const seen = new Set<string>();

function clean(value: unknown, max = 120): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}

/** "https://x.r2.cloudflarestorage.com/a?sig=..." → "https://x.r2.cloudflarestorage.com"; "inline"/"eval" ficam como estão. */
function originOnly(value: unknown): string {
  const raw = clean(value, 300);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : url.protocol;
  } catch {
    return clean(raw, 40);
  }
}

/** "https://crm.x.com/t/ABC123?x=1" → "/t" — o segmento de cima basta pra saber QUAL tela, sem vazar código. */
function pageSegment(value: unknown): string {
  const raw = clean(value, 300);
  try {
    const first = new URL(raw).pathname.split("/")[1] ?? "";
    return `/${clean(first, 30)}`;
  } catch {
    return "";
  }
}

type Violation = { directive: string; blocked: string; page: string; source: string };

// Dois formatos: `report-uri` ({"csp-report": {...}}) e a Reporting API
// ([{type:"csp-violation", body:{...}}]) — o navegador escolhe, aceito os dois.
function extractViolations(json: unknown): Violation[] {
  const candidates: Record<string, unknown>[] = [];
  if (Array.isArray(json)) {
    for (const item of json) {
      const body = (item as { body?: unknown })?.body;
      if (body && typeof body === "object") candidates.push(body as Record<string, unknown>);
    }
  } else if (json && typeof json === "object") {
    const inner = (json as { "csp-report"?: unknown })["csp-report"];
    if (inner && typeof inner === "object") candidates.push(inner as Record<string, unknown>);
  }
  return candidates.slice(0, 5).map((c) => ({
    directive: clean(c["effective-directive"] ?? c["effectiveDirective"] ?? c["violated-directive"] ?? c["violatedDirective"], 40),
    blocked: originOnly(c["blocked-uri"] ?? c["blockedURL"] ?? c["blockedUri"]),
    page: pageSegment(c["document-uri"] ?? c["documentURL"] ?? c["documentUri"]),
    source: originOnly(c["source-file"] ?? c["sourceFile"]),
  }));
}

export async function POST(req: Request) {
  const limited = rateLimitOrResponse(`csp-report:${getClientIp(req)}`, 60, 60_000);
  if (limited) return limited;

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });

  let text: string;
  try {
    text = await req.text();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  for (const v of extractViolations(json)) {
    if (!v.directive) continue;
    const key = `${v.directive}|${v.blocked}|${v.page}|${v.source}`;
    if (seen.has(key)) continue;
    if (seen.size >= MAX_DISTINCT_LOGGED) {
      if (seen.size === MAX_DISTINCT_LOGGED) {
        seen.add("__limit__");
        console.warn(`[csp-report] limite de ${MAX_DISTINCT_LOGGED} violações distintas registradas neste processo — as demais são ignoradas`);
      }
      continue;
    }
    seen.add(key);
    console.warn(
      `[csp-report] diretiva=${v.directive} bloqueado=${v.blocked || "-"} página=${v.page || "-"}${v.source ? ` origem-do-script=${v.source}` : ""}`,
    );
  }

  return new NextResponse(null, { status: 204 });
}
