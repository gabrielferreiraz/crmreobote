import { prisma } from "@/lib/prisma";

/**
 * "Marcelo Souza" -> "marcelo-souza" — minúsculo, sem acento, só letras/
 * dígitos/hífen, sem hífen duplicado nem nas pontas. Usado pra sugerir o
 * slug inicial do cartão a partir do nome do usuário (ver
 * app/api/digital-cards/route.ts) — a pessoa pode editar depois. Reaproveitada
 * também por vCardFileName (lib/digital-cards/vcard.ts) — mesma
 * transformação, nome de arquivo só precisa ser "seguro", não bonito.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos (marcas diacríticas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// Nunca deixar um slug ficar preso num nome que colidiria com uma rota real
// do app (ex.: alguém chamado "Login Silva" não pode virar /c/login e
// sombrear /login por engano só porque as duas ficam sob "/" — na prática
// /c/[slug] já isola isso, mas mantemos a lista curta por precaução caso o
// prefixo mude no futuro).
const RESERVED_SLUGS = new Set(["admin", "api", "login", "register", "novo", "editar", "config"]);

/**
 * Acha um slug livre a partir de uma base (já passada por `slugify`) —
 * tenta o valor puro primeiro, senão vai anexando "-2", "-3"... `excludeId`
 * permite reeditar o próprio cartão sem trombar com o slug dele mesmo.
 */
export async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  const cleanBase = base || "cartao";
  let candidate = RESERVED_SLUGS.has(cleanBase) ? `${cleanBase}-1` : cleanBase;
  let suffix = 2;

  // Tabela pequena (1 linha por usuário com cartão ativado) — um loop
  // sequencial de verificação é simples e suficiente, sem necessidade de
  // uma query mais esperta pra achar o próximo número livre de uma vez.
  while (true) {
    const existing = await prisma.digitalCard.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${cleanBase}-${suffix}`;
    suffix += 1;
  }
}
