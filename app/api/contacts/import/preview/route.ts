import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { parseSpreadsheet, spreadsheetParseFailure } from "@/lib/parse-spreadsheet";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { resolveImportPlan, type ContactImportField } from "@/lib/contacts/import-resolve";
import { loadContactImportContext } from "@/lib/contacts/import-context";
import { readFormData, bodyErrorResponse, BODY_LIMITS } from "@/lib/read-body";
import { MAX_CONTACT_IMPORT_FILE_SIZE_BYTES, MAX_CONTACT_IMPORT_ROWS } from "@/lib/contacts/import-limits";

export const dynamic = "force-dynamic";

// Nunca grava nada — só lê e resolve em memória — então pode ser bem mais
// generoso que a cota de commit de verdade (5/hora, ver /api/contacts/import):
// quem está ajustando o mapeamento de coluna até acertar pode analisar várias
// vezes seguidas sem gastar a cota de importar de fato.
const PREVIEW_LIMIT = 30;
// Não devolve as 20 mil linhas resolvidas pro navegador — só uma amostra (mais
// o resumo agregado, que já é sobre TODAS as linhas) é suficiente pra pessoa
// confirmar que o mapeamento está certo.
const PREVIEW_ROWS_SHOWN = 50;
const MAX_DUPLICATE_ROWS_SHOWN = 3_000;

function columnSamples(dataRows: string[][], index: number): string[] {
  const samples: string[] = [];
  for (const row of dataRows) {
    const raw = (row[index] ?? "").trim();
    const value = raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
    if (value && !samples.includes(value)) samples.push(value);
    if (samples.length === 3) break;
  }
  return samples;
}

export async function POST(req: Request) {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const rateLimited = rateLimitOrResponse(`contact-import-preview:${organizationId}`, PREVIEW_LIMIT, 60 * 60_000);
  if (rateLimited) return rateLimited;

  // Lido só depois da autenticação e com teto (lib/read-body.ts) — antes
  // req.formData() carregava o corpo INTEIRO pra memória antes de checar tamanho.
  let formData: FormData;
  try {
    formData = await readFormData(req, BODY_LIMITS.spreadsheet);
  } catch (err) {
    const res = bodyErrorResponse(err);
    if (res) return res;
    throw err;
  }
  const file = formData.get("file");
  const columnOverridesRaw = formData.get("columnOverrides");
  const includeAllRows = formData.get("includeAllRows") === "true";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo .csv ou .xlsx" }, { status: 400 });
  }
  if (file.size > MAX_CONTACT_IMPORT_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "Arquivo maior que 5MB" }, { status: 400 });
  }
  let columnOverrides: Partial<Record<ContactImportField, number>> | undefined;
  if (typeof columnOverridesRaw === "string" && columnOverridesRaw) {
    try {
      columnOverrides = JSON.parse(columnOverridesRaw);
    } catch {
      return NextResponse.json({ error: "columnOverrides inválido" }, { status: 400 });
    }
  }

  return runWithTenant(organizationId, async () => {
    const buffer = Buffer.from(await file.arrayBuffer());
    let rows: string[][];
    try {
      rows = await parseSpreadsheet(buffer, file.name, { maxRows: MAX_CONTACT_IMPORT_ROWS + 1 });
    } catch (err) {
      if (err instanceof Error && err.message === "XLS_NOT_SUPPORTED") {
        return NextResponse.json(
          { error: "Arquivo .xls (Excel 97-2003) não é suportado — salve como .xlsx e tente de novo" },
          { status: 400 },
        );
      }
      const parseFailure = spreadsheetParseFailure(err);
      if (parseFailure) return NextResponse.json({ error: parseFailure.message }, { status: parseFailure.status });
      return NextResponse.json({ error: "Não foi possível ler o arquivo" }, { status: 400 });
    }

    if (rows.length < 2) {
      return NextResponse.json({ error: "Arquivo vazio ou sem linhas de dados" }, { status: 400 });
    }

    const totalDataRows = rows.length - 1;
    if (totalDataRows > MAX_CONTACT_IMPORT_ROWS) {
      return NextResponse.json(
        { error: `Arquivo tem ${totalDataRows} linhas — o máximo por importação é ${MAX_CONTACT_IMPORT_ROWS}. Divida em arquivos menores e importe em partes.` },
        { status: 400 },
      );
    }

    const dataRows = rows.slice(1, 1 + MAX_CONTACT_IMPORT_ROWS);
    const rawHeaderRow = rows[0];

    const context = await loadContactImportContext(organizationId);

    const plan = resolveImportPlan({
      dataRows,
      rawHeaderRow,
      columnOverrides,
      ...context,
      // Sem valueMappings de propósito: a prévia devolve os valores que não
      // bateram com o CRM (pendingValues) e a tela aplica as escolhas.
      includeWrites: false,
    });

    // Lista de duplicados SEPARADA da amostra de linhas — pedido explícito:
    // mostrar de quem é cada contato que já existe, com ação de assumir/pedir
    // pra quem a linha ia. Antes saía da amostra de 50 linhas, então numa
    // planilha de 800 com 300 duplicados a lista mostrava só os que caíam nas
    // primeiras 50. Um item por CONTATO existente (a mesma pessoa pode colidir
    // em mais de uma linha), com teto pra não mandar megabytes ao navegador.
    const seenContactIds = new Set<string>();
    const duplicateRows: typeof plan.rows = [];
    for (const r of plan.rows) {
      if (!r.existingContact || seenContactIds.has(r.existingContact.id)) continue;
      seenContactIds.add(r.existingContact.id);
      duplicateRows.push(r);
    }

    return NextResponse.json({
      rawHeaderRow,
      // Até 3 valores de exemplo por coluna — na tela de colunas, ver o
      // conteúdo ("Campo Grande", "Dourados") diz muito mais que o nome do
      // cabeçalho sozinho pra saber se o mapeamento está certo.
      columnSamples: rawHeaderRow.map((_, index) => columnSamples(dataRows, index)),
      columns: plan.columns,
      missingRequiredColumns: plan.missingRequiredColumns,
      summary: plan.summary,
      pendingValues: plan.pendingValues,
      rows: includeAllRows ? plan.rows : plan.rows.slice(0, PREVIEW_ROWS_SHOWN),
      rowsShown: includeAllRows ? plan.rows.length : Math.min(PREVIEW_ROWS_SHOWN, plan.rows.length),
      duplicateRows: duplicateRows.slice(0, MAX_DUPLICATE_ROWS_SHOWN),
      duplicateRowsTruncated: duplicateRows.length > MAX_DUPLICATE_ROWS_SHOWN,
    });
  });
}
