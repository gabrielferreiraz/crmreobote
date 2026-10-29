import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSheetsAccess } from "@/lib/sheets/access";
import { listSheetTabs, openSheet } from "@/lib/sheets/open";
import { SheetError } from "@/lib/sheets/errors";
import { SheetEditor } from "./sheet-editor";

export const dynamic = "force-dynamic";

/**
 * Uma leitura por requisição, compartilhada entre o título da aba
 * (generateMetadata) e a página — antes eram leituras separadas, em sequência.
 */
const loadSheet = cache(async (organizationId: string, id: string) => {
  try {
    return await openSheet(organizationId, id, { limit: 200 });
  } catch (err) {
    if (err instanceof SheetError && err.status === 404) return null;
    throw err;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const access = await getSheetsAccess();
  if (!access) return { title: "Planilhas" };
  const { id } = await params;
  const opened = await loadSheet(access.organizationId, id);
  return { title: opened ? `${opened.sheet.name} · Planilhas` : "Planilhas" };
}

export default async function PlanilhaPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getSheetsAccess();
  if (!access) redirect("/");
  const { id } = await params;

  // Planilha (estrutura + primeira tela + nomes) e abas ao mesmo tempo.
  const [opened, tabs] = await Promise.all([loadSheet(access.organizationId, id), listSheetTabs(access.organizationId)]);
  if (!opened) notFound();
  const { sheet, columns, page, refs } = opened;

  return (
    <SheetEditor
      sheet={{ id: sheet.id, name: sheet.name, description: sheet.description }}
      initialColumns={columns}
      initialRows={page.rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }))}
      initialTotal={page.total}
      initialRefs={refs}
      initialSettings={sheet.settings}
      initialAllTotal={page.allTotal}
      initialHasFormulas={page.hasFormulas}
      // Abas do rodapé (como as abas de planilha do Excel): mais antigas primeiro, ordem estável.
      sheetTabs={tabs}
    />
  );
}
