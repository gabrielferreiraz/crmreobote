import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireCommissionManager, badRequest } from "@/lib/commissions/route-helpers";
import { isMonthKey, ROLE_LABELS } from "@/lib/commissions/engine";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { formatCnpj } from "@/lib/cnpj";

export const dynamic = "force-dynamic";

/**
 * Planilha do pagamento do mês — o elo entre "marcar como pago" no CRM e
 * pagar de verdade no banco/folha. Aba "Resumo": uma linha por pessoa com o
 * total (o que o banco precisa); aba "Detalhe": de onde vem cada valor (o
 * que a contabilidade confere).
 *
 * `what=topay` (padrão): o que a EMPRESA ainda vai pagar no mês (pronto,
 * não travado). `what=paid`: o que já foi marcado como pago no mês. O que a
 * administradora paga direto nunca entra — não sai do caixa da corretora.
 */
export async function GET(req: Request) {
  const guard = await requireCommissionManager();
  if ("error" in guard) return guard.error;
  const { access } = guard;

  const params = new URL(req.url).searchParams;
  const month = params.get("month");
  if (!isMonthKey(month)) return badRequest("Mês inválido");
  const what = params.get("what") === "paid" ? "paid" : "topay";

  const entries = await runWithTenant(access.organizationId, () =>
    prisma.commissionEntry.findMany({
      where: {
        organizationId: access.organizationId,
        paymentMonth: month,
        paidByAdministrator: false,
        status: what === "paid" ? "PAID" : "SCHEDULED",
        OR: [{ saleId: null }, { sale: { status: "ACTIVE" } }],
      },
      select: {
        amount: true,
        role: true,
        kind: true,
        installmentNumber: true,
        installmentCount: true,
        note: true,
        beneficiaryId: true,
        beneficiary: { select: { name: true, email: true, company: { select: { cnpj: true, name: true } } } },
        sale: { select: { clientName: true, quotaNumber: true, groupNumber: true, administrator: { select: { name: true } } } },
      },
      orderBy: [{ beneficiary: { name: "asc" } }, { createdAt: "asc" }],
    }),
  );

  const workbook = new ExcelJS.Workbook();
  const header = (sheet: ExcelJS.Worksheet) => {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  };
  const money = "#,##0.00";

  const summary = workbook.addWorksheet("Resumo");
  summary.columns = [
    { header: "Pessoa", key: "name", width: 32 },
    { header: "E-mail", key: "email", width: 32 },
    { header: "CNPJ", key: "cnpj", width: 22 },
    { header: "Razão social", key: "company", width: 32 },
    { header: "Lançamentos", key: "count", width: 13 },
    { header: "Valor (R$)", key: "total", width: 16, style: { numFmt: money } },
  ];
  header(summary);
  const byPerson = new Map<string, { name: string; email: string; cnpj: string; company: string; count: number; total: number }>();
  for (const e of entries) {
    const row = byPerson.get(e.beneficiaryId) ?? {
      name: e.beneficiary.name,
      email: e.beneficiary.email,
      cnpj: e.beneficiary.company ? formatCnpj(e.beneficiary.company.cnpj) : "",
      company: e.beneficiary.company?.name ?? "",
      count: 0,
      total: 0,
    };
    row.count += 1;
    row.total += Number(e.amount);
    byPerson.set(e.beneficiaryId, row);
  }
  let grandTotal = 0;
  for (const row of byPerson.values()) {
    grandTotal += row.total;
    summary.addRow({ ...row, name: sanitizeCell(row.name), company: sanitizeCell(row.company), total: Math.round(row.total * 100) / 100 });
  }
  const totalRow = summary.addRow({ name: "TOTAL", count: entries.length, total: Math.round(grandTotal * 100) / 100 });
  totalRow.font = { bold: true };

  const detail = workbook.addWorksheet("Detalhe");
  detail.columns = [
    { header: "Pessoa", key: "name", width: 28 },
    { header: "Recebe como", key: "role", width: 14 },
    { header: "Cliente", key: "client", width: 32 },
    { header: "Administradora", key: "administrator", width: 20 },
    { header: "Grupo", key: "group", width: 10 },
    { header: "Cota", key: "quota", width: 10 },
    { header: "Parcela", key: "installment", width: 10 },
    { header: "Observação", key: "note", width: 36 },
    { header: "Valor (R$)", key: "amount", width: 14, style: { numFmt: money } },
  ];
  header(detail);
  for (const e of entries) {
    detail.addRow({
      name: sanitizeCell(e.beneficiary.name),
      role: e.kind === "ADJUSTMENT" ? "Ajuste" : ROLE_LABELS[e.role],
      client: sanitizeCell(e.sale?.clientName ?? ""),
      administrator: sanitizeCell(e.sale?.administrator?.name ?? ""),
      group: sanitizeCell(e.sale?.groupNumber ?? ""),
      quota: sanitizeCell(e.sale?.quotaNumber ?? ""),
      installment: e.installmentNumber ? `${e.installmentNumber}/${e.installmentCount}` : "",
      note: sanitizeCell(e.note ?? ""),
      amount: Number(e.amount),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="comissoes-${what === "paid" ? "pagas" : "a-pagar"}-${month}.xlsx"`,
    },
  });
}
