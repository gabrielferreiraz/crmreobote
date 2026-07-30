/**
 * Dedup de pessoa duplicada no Agendor — mesmo telefone aparecendo sob mais
 * de um "Código da pessoa" (achado real: 2.890 casos no arquivo completo,
 * a maioria fruto do processo antigo de reatribuir o mesmo lead pra um
 * consultor novo excluindo e recriando a pessoa). Regra confirmada: o
 * registro mais recentemente atualizado vence e vira o Contact canônico;
 * os outros nunca ganham um Contact próprio — todo Código da Pessoa
 * duplicado resolve pro mesmo id canônico.
 */

import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { loadSheet, getHeaders, colIndex, cellText, cellDate } from "@/scripts/agendor/xlsx-utils";

export type CanonicalMap = Map<string, string>; // agendorPersonId (qualquer, inclusive canônico) -> agendorPersonId canônico

export async function buildCanonicalPersonMap(pessoasPath: string): Promise<CanonicalMap> {
  const sheet = await loadSheet(pessoasPath);
  const headers = getHeaders(sheet);
  const idxCodigo = colIndex(headers, "Código da pessoa");
  const idxWhatsapp = colIndex(headers, "WhatsApp");
  const idxCelular = colIndex(headers, "Celular");
  const idxAtualizacao = colIndex(headers, "Ultima atualização");
  const idxCadastro = colIndex(headers, "Data de cadastro");

  type Row = { codigo: string; updatedAt: Date };
  const byPhone = new Map<string, Row[]>();

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const codigo = cellText(row, idxCodigo);
    if (!codigo) continue;

    const phoneRaw = cellText(row, idxWhatsapp) ?? cellText(row, idxCelular);
    const normalized = normalizePhoneNumber(phoneRaw);
    if (!normalized) continue; // sem telefone não tem como agrupar — cada um fica com seu próprio Código da Pessoa

    const updatedAt = cellDate(row, idxAtualizacao) ?? cellDate(row, idxCadastro) ?? new Date(0);
    const list = byPhone.get(normalized) ?? [];
    list.push({ codigo, updatedAt });
    byPhone.set(normalized, list);
  }

  const canonical: CanonicalMap = new Map();
  let groupsWithDuplicates = 0;
  for (const rows of byPhone.values()) {
    if (rows.length === 1) {
      canonical.set(rows[0].codigo, rows[0].codigo);
      continue;
    }
    groupsWithDuplicates++;
    const winner = rows.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    for (const r of rows) canonical.set(r.codigo, winner.codigo);
  }

  console.log(`[phone-dedup] ${byPhone.size} telefone(s) distinto(s), ${groupsWithDuplicates} com mais de uma pessoa (resolvidos pro mais atualizado).`);
  return canonical;
}

/** Resolve um Código da Pessoa qualquer (inclusive um "perdedor" de duplicata) pro id canônico — se não estava no mapa (não tinha telefone), resolve pra si mesmo. */
export function resolveCanonicalPersonId(map: CanonicalMap, agendorPersonId: string): string {
  return map.get(agendorPersonId) ?? agendorPersonId;
}
