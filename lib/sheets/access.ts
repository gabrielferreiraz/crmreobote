import { NextResponse } from "next/server";
import { getCurrentMembership, type CurrentMembership } from "@/lib/current-membership";
import { isCrmRestrictedByAcademy } from "@/lib/academy-onboarding";

export type SheetsAccess = {
  organizationId: string;
  userId: string;
  actorName: string;
};

/**
 * Fase de testes em produção: o módulo só abre para os e-mails de
 * SHEETS_BETA_USER_EMAILS (lista separada por vírgula; sem a variável, só o
 * desenvolvedor). SHEETS_ACCESS=all libera para a regra normal abaixo.
 */
const DEFAULT_BETA_EMAILS = "reoboteconsorciosti@gmail.com";

function inSheetsBeta(email: string | null): boolean {
  if (process.env.SHEETS_ACCESS === "all") return true;
  if (!email) return false;
  const list = (process.env.SHEETS_BETA_USER_EMAILS ?? DEFAULT_BETA_EMAILS).split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

/** Regra pura (sem consulta): usada pelas rotas/páginas e pelo menu do layout. */
export function canUseSheets(m: Pick<CurrentMembership, "active" | "role" | "area" | "academyOnboardingStatus" | "email">): boolean {
  if (!m.active) return false;
  if (isCrmRestrictedByAcademy(m.role, m.area, m.academyOnboardingStatus)) return false;
  if (m.area !== "ADMINISTRATIVO" && m.role !== "OWNER") return false;
  return inSheetsBeta(m.email);
}

/**
 * Planilhas são exclusivas do Administrativo: área ADMINISTRATIVO ou Dono
 * (o Dono vê tudo do CRM). Vendas — inclusive gerente — não entra: as
 * planilhas guardam controles internos (documentos, pagamentos) que não são
 * da carteira de ninguém. Sempre confere no banco (getCurrentMembership),
 * nunca só no JWT: tirar alguém do Administrativo derruba o acesso na hora.
 */
export async function getSheetsAccess(): Promise<SheetsAccess | null> {
  const m = await getCurrentMembership();
  if (!m || !canUseSheets(m)) return null;
  return {
    organizationId: m.organizationId,
    userId: m.userId,
    actorName: m.session.user.name ?? m.session.user.email ?? "Usuário",
  };
}

/** Para rotas: acesso ou a resposta 403 pronta. */
export async function requireSheetsAccess(): Promise<{ access: SheetsAccess } | { response: NextResponse }> {
  const access = await getSheetsAccess();
  if (!access) return { response: NextResponse.json({ error: "Planilhas em fase de testes — acesso restrito" }, { status: 403 }) };
  return { access };
}
