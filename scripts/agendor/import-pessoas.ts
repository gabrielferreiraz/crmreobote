/**
 * Importa Pessoas do Agendor → Contact. Só a linha CANÔNICA de cada grupo
 * de telefone duplicado (ver phone-dedup.ts) vira Contact de verdade — as
 * outras são descartadas por completo em favor da mais atualizada (não é
 * merge campo a campo, é "a mais recente representa o grupo inteiro").
 *
 * Create-only por agendorContactId: se já existir (execução anterior),
 * ignora e segue — nunca sobrescreve.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { normalizePhoneNumber, fallbackWhatsappToPhone } from "@/lib/phone-normalize";
import { ORGANIZATION_ID, resolveUserId } from "@/scripts/agendor/users";
import { loadSheet, getHeaders, colIndex, cellText, cellDate } from "@/scripts/agendor/xlsx-utils";
import { type CanonicalMap, resolveCanonicalPersonId } from "@/scripts/agendor/phone-dedup";
import { runConcurrent } from "@/scripts/agendor/concurrency";
import { findAllPaged } from "@/scripts/agendor/pagination";

const CONCURRENCY = 16;

const FOUR_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 4;
const CPF_FIELD_LABEL = "CPF";
const NO_CONTACT_TAG = "sem-contato-agendor";

export type PessoasImportResult = {
  created: number;
  skippedDuplicate: number; // linha não-canônica, já coberta pela canônica
  skippedEmptyNameOld: number;
  skippedAlreadyImported: number;
  // A "vencedora" do dedup desta leva (ver phone-dedup.ts) já tem o
  // telefone dela pertencendo a um Contact que existe de uma leva
  // ANTERIOR (sob outro Código da Pessoa) — dedup.ts só compara linhas
  // DENTRO do arquivo atual entre si, não sabe quem já foi importado
  // antes. Sem essa checagem, isso batia na constraint única do banco e
  // virava um "falha ao criar contato" — agora é detectado antes e
  // pulado sem erro nenhum.
  skippedPhoneAlreadyExists: number;
};

async function ensureCpfFieldDefinition(dryRun: boolean): Promise<string> {
  const existing = await prisma.customFieldDefinition.findFirst({
    where: { organizationId: ORGANIZATION_ID, entityType: "CONTACT", label: CPF_FIELD_LABEL },
  });
  if (existing) return existing.id;
  if (dryRun) return "dry-run:cpf-field";
  const created = await prisma.customFieldDefinition.create({
    data: { organizationId: ORGANIZATION_ID, entityType: "CONTACT", label: CPF_FIELD_LABEL, type: "TEXT" },
  });
  console.log(`[pessoas] campo personalizado "${CPF_FIELD_LABEL}" criado (${created.id})`);
  return created.id;
}

export async function importPessoas(
  pessoasPath: string,
  canonicalMap: CanonicalMap,
  wonDealPersonIds: Set<string>,
  dryRun: boolean,
): Promise<PessoasImportResult> {
  const cpfFieldId = await ensureCpfFieldDefinition(dryRun);
  const sheet = await loadSheet(pessoasPath);
  const headers = getHeaders(sheet);

  const idxCodigo = colIndex(headers, "Código da pessoa");
  const idxNome = colIndex(headers, "Nome");
  const idxCargo = colIndex(headers, "Cargo");
  const idxEmpresaRel = colIndex(headers, "Empresa relacionada");
  const idxCategoria = colIndex(headers, "Categoria");
  const idxOrigem = colIndex(headers, "Origem do cliente");
  const idxResponsavel = colIndex(headers, "Usuário responsável");
  const idxCpf = colIndex(headers, "CPF");
  const idxWhatsapp = colIndex(headers, "WhatsApp");
  const idxCelular = colIndex(headers, "Celular");
  const idxEmail = colIndex(headers, "E-mail");
  const idxCadastro = colIndex(headers, "Data de cadastro");
  const idxAtualizacao = colIndex(headers, "Ultima atualização");

  const result: PessoasImportResult = {
    created: 0,
    skippedDuplicate: 0,
    skippedEmptyNameOld: 0,
    skippedAlreadyImported: 0,
    skippedPhoneAlreadyExists: 0,
  };
  const fourMonthsAgo = new Date(Date.now() - FOUR_MONTHS_MS);

  // Pré-carrega TODO Contact da organização numa passada só (em vez de 1
  // findUnique/findFirst por linha) — é isso que faz a idempotência (e
  // agora também a checagem de telefone abaixo) ficar essencialmente de
  // graça mesmo com dezenas/centenas de milhares de linhas. Paginado (ver
  // findAllPaged): mesmo com poucas colunas, ~140 mil contatos já
  // demonstraram estourar o teto de 15s da mini-transação do RLS num banco
  // remoto sob carga real (ver import-negocios.ts).
  //
  // `existingPhoneNumbers` cobre QUALQUER contato já existente (não só os
  // com agendorContactId — pode ter vindo do CRM ao vivo, de outra
  // integração, etc.) porque a constraint única do banco também não olha
  // a origem: o que importa é que já existe alguém com esse telefone.
  const allExistingContacts = await findAllPaged((skip, take) =>
    prisma.contact.findMany({
      where: { organizationId: ORGANIZATION_ID },
      select: { agendorContactId: true, phoneNormalized: true, whatsappNormalized: true },
      orderBy: { id: "asc" },
      skip,
      take,
    }),
  );
  const alreadyImported = new Set<string>();
  const existingPhoneNumbers = new Set<string>();
  for (const c of allExistingContacts) {
    if (c.agendorContactId) alreadyImported.add(c.agendorContactId);
    if (c.phoneNormalized) existingPhoneNumbers.add(c.phoneNormalized);
    if (c.whatsappNormalized) existingPhoneNumbers.add(c.whatsappNormalized);
  }

  const rows: number[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) rows.push(r);

  await runConcurrent(rows, CONCURRENCY, async (r) => {
    const row = sheet.getRow(r);
    const codigo = cellText(row, idxCodigo);
    if (!codigo) return;

    const canonical = resolveCanonicalPersonId(canonicalMap, codigo);
    if (canonical !== codigo) {
      result.skippedDuplicate++;
      return; // não-canônica — a linha canônica do grupo já cobre esse contato
    }

    if (alreadyImported.has(codigo)) {
      result.skippedAlreadyImported++;
      return;
    }

    let name = cellText(row, idxNome);
    if (!name) {
      const updatedAt = cellDate(row, idxAtualizacao) ?? cellDate(row, idxCadastro);
      const isRecent = updatedAt ? updatedAt >= fourMonthsAgo : false;
      const hasWon = wonDealPersonIds.has(codigo);
      if (!isRecent && !hasWon) {
        result.skippedEmptyNameOld++;
        return;
      }
      name = "(sem nome)";
    }

    const whatsappRaw = cellText(row, idxWhatsapp);
    const celularRaw = cellText(row, idxCelular);
    const categoria = cellText(row, idxCategoria);
    const cpf = cellText(row, idxCpf);
    const responsavel = cellText(row, idxResponsavel);

    // Calculado ANTES do dryRun (não só antes do create de verdade) — pra
    // dry-run também prever corretamente esse caso, não só o real. Mesma
    // função usada na gravação de verdade logo abaixo (não uma
    // aproximação): os telefones finais são sempre os mesmos dos dois lados.
    //
    // phone E whatsapp são DUAS colunas com constraint única cada uma — não
    // basta checar uma só (bug que eu mesmo cometi na 1ª versão desta
    // correção: um WhatsApp novo passava, mas o Celular por trás dele já
    // era de outro contato, e ainda batia na constraint de phoneNormalized).
    const whatsappFallback = fallbackWhatsappToPhone(celularRaw, normalizePhoneNumber(celularRaw), whatsappRaw, normalizePhoneNumber(whatsappRaw));
    const phoneCollision =
      (whatsappFallback.phoneNormalized && existingPhoneNumbers.has(whatsappFallback.phoneNormalized)) ||
      (whatsappFallback.whatsappNormalized && existingPhoneNumbers.has(whatsappFallback.whatsappNormalized));
    if (phoneCollision) {
      result.skippedPhoneAlreadyExists++;
      return;
    }
    // "Reserva" os dois números AGORA, antes de qualquer await — cobre o
    // caso de duas linhas DIFERENTES deste mesmo arquivo (não agrupadas
    // pelo dedup, que só olha 1 coluna por vez — ver comentário acima)
    // compartilharem um Celular ou WhatsApp entre si (não com um contato
    // pré-existente). Seguro sem lock/promise-em-voo como em
    // import-negocios.ts porque JS roda isto tudo de um fôlego só, sem
    // `await` no meio — nenhum outro worker do runConcurrent consegue
    // "entrar" entre a checagem acima e este ponto.
    if (whatsappFallback.phoneNormalized) existingPhoneNumbers.add(whatsappFallback.phoneNormalized);
    if (whatsappFallback.whatsappNormalized) existingPhoneNumbers.add(whatsappFallback.whatsappNormalized);

    if (dryRun) {
      result.created++;
      return;
    }

    const ownerId = await resolveUserId(responsavel, dryRun);

    try {
      await prisma.contact.create({
        data: {
          organizationId: ORGANIZATION_ID,
          name,
          email: cellText(row, idxEmail),
          phone: whatsappFallback.phone,
          whatsapp: whatsappFallback.whatsapp,
          phoneNormalized: whatsappFallback.phoneNormalized,
          whatsappNormalized: whatsappFallback.whatsappNormalized,
          source: cellText(row, idxOrigem),
          company: cellText(row, idxEmpresaRel),
          jobTitle: cellText(row, idxCargo),
          tags: categoria ? [categoria] : [],
          responsavelId: ownerId,
          agendorContactId: codigo,
          createdAt: cellDate(row, idxCadastro) ?? undefined,
          customFieldValues: cpf ? ({ [cpfFieldId]: cpf } as Prisma.InputJsonValue) : undefined,
        },
      });
      result.created++;
    } catch (err) {
      // Corrida rara / telefone que por algum motivo já colide com outro
      // Contact fora do grupo de duplicata detectado (ex.: alguém já
      // cadastrou manualmente no CRM novo com o mesmo número) — loga e
      // segue, não derruba o import inteiro por uma linha.
      console.error(`[pessoas] falha ao criar contato (Código da Pessoa ${codigo}):`, err instanceof Error ? err.message : err);
    }
  });

  return result;
}

/** Marca contatos "reconstruídos" (sem telefone, só nome do título do negócio) com a tag padrão — usado por import-negocios.ts. */
export { NO_CONTACT_TAG };
