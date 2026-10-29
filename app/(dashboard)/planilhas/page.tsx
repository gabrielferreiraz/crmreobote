import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSheetsAccess } from "@/lib/sheets/access";
import { listSheets } from "@/lib/sheets/sheets";
import { SheetsHome } from "./sheets-home";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Planilhas" };

/** Planilhas do Administrativo — quem não é da área (nem Dono) volta para o início. */
export default async function PlanilhasPage() {
  const access = await getSheetsAccess();
  if (!access) redirect("/");
  const [active, archived] = await Promise.all([listSheets(access.organizationId), listSheets(access.organizationId, { archived: true })]);
  const serialize = (list: typeof active) =>
    list.map((s) => ({ id: s.id, name: s.name, description: s.description, rowCount: s.rowCount, updatedAt: s.updatedAt.toISOString() }));
  return <SheetsHome initialSheets={serialize(active)} initialArchived={serialize(archived)} />;
}
