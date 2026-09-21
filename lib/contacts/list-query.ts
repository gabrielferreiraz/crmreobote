import { Prisma } from "@/app/generated/prisma/client";
import { searchDb } from "@/lib/search-db";
import { NO_JOB_TITLE, NO_RESPONSAVEL, type EnrichedContact } from "@/lib/contacts/constants";
import { normalizePhoneNumber } from "@/lib/phone-normalize";

// Reexportados por compatibilidade com quem já importava daqui — mas
// componente "use client" deve importar de @/lib/contacts/constants
// diretamente (ver comentário lá: importar deste arquivo no cliente arrasta
// `pg` pro bundle do navegador e quebra o build).
export { NO_JOB_TITLE, NO_RESPONSAVEL, type EnrichedContact };

/** Placeholders reconstruídos na migração do Agendor (negócio órfão de
 * pessoa) — nunca aparecem na listagem de clientes, só existem pra
 * preservar o histórico do negócio (ver scripts/agendor/import-negocios.ts). */
const NO_CONTACT_TAG = "sem-contato-agendor";

export type ContactsFilterParams = {
  organizationId: string;
  q?: string;
  source?: string;
  /** Texto exato, ou NO_JOB_TITLE pra "sem cargo", ou vazio pra não filtrar. */
  jobTitle?: string;
  /** Id exato, ou NO_RESPONSAVEL pra "sem responsável", ou vazio pra não filtrar. */
  responsavelId?: string;
  /** Junto com responsavelId (id exato, nunca com NO_RESPONSAVEL): também
   * inclui contato SEM responsável nenhum, além do próprio. Só faz sentido
   * pra quem normalmente só vê os próprios contatos (MEMBER) — pra esse
   * papel poder achar (e reivindicar) um contato órfão na busca de "Novo
   * negócio"/tarefa (ver includeOrphans em app/api/contacts/route.ts e o
   * "pegar contato" em components/contact-search-input.tsx). OWNER/MANAGER
   * já enxergam órfão de qualquer forma (sem filtro de responsável nenhum),
   * então não precisam disto. */
  includeUnassigned?: boolean;
  /** Sigla exata (UF) — lista fechada, ver ESTADOS_BR em lib/contacts/constants.ts. */
  state?: string;
  /** Por trecho, sem diferenciar maiúsculas/acentos exatos (ver índice trigram) — cidade é texto livre, não uma lista fechada como estado. */
  city?: string;
  onlyWithDeals?: boolean;
  /** Uma tag exata (ver Contact.tags no schema — array livre, sem tabela
   * própria) — contato precisa TER essa tag entre as suas (`has`), pode ter
   * outras também. Lista de tags disponíveis pra filtrar vem de
   * getDistinctContactTags abaixo. */
  tag?: string;
  /** Filtro rápido de coluna (ver ColumnFilter em contacts-table.tsx) — "yes" = campo preenchido, "no" = vazio, undefined = não filtra. */
  hasEmail?: "yes" | "no";
  /** Mesma ideia de hasEmail, mas no campo `whatsapp` cru (não o `phone` de fallback que a coluna mostra quando falta WhatsApp). */
  hasWhatsapp?: "yes" | "no";
  registeredFrom?: Date;
  registeredTo?: Date;
};

/**
 * Monta o `where` uma vez só, reaproveitado tanto pela busca da página
 * quanto pela contagem (`countContacts`) — precisam sempre bater, senão a
 * paginação mostra um total que a busca não confirma.
 */
export function buildContactsWhere(params: ContactsFilterParams): Prisma.ContactWhereInput {
  const { organizationId, q, source, jobTitle, responsavelId, includeUnassigned, state, city, onlyWithDeals, tag, hasEmail, hasWhatsapp, registeredFrom, registeredTo } = params;
  const digits = q ? (normalizePhoneNumber(q) ?? "") : "";

  const where: Prisma.ContactWhereInput = {
    organizationId,
    NOT: { tags: { has: NO_CONTACT_TAG } },
    ...(source ? { source } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
    ...(state ? { state } : {}),
    ...(city ? { city: { contains: city, mode: "insensitive" } } : {}),
    // `phone`/`whatsapp` (campo cru, com formatação) saíram da busca —
    // ILIKE '%q%' neles não tem índice que sirva (só phoneNormalized/
    // whatsappNormalized têm trigram) e, pior, contamina o OR inteiro: com
    // qualquer condição do OR sem índice usável, o Postgres descarta o
    // índice das OUTRAS condições também e faz Parallel Seq Scan na tabela
    // inteira — medido em produção, ~90-140ms mesmo com cache quente, ~350ms
    // frio, em 141 mil linhas (só piora conforme a tabela cresce).
    //
    // `digits` é o mesmo dígitos-só que normalizePhoneNumber já extrai pra
    // busca global (ver app/api/search/route.ts) — "(67) 99999-9999" e
    // "67999999999" viram o mesmo dígitos, então buscar no campo
    // NORMALIZADO acha o contato independente de como o usuário formatou,
    // o que a busca antiga (no campo cru) não garantia. Guardado atrás de
    // `digits ?` pra nunca entrar no OR quando a busca é só texto (nome/
    // email) — sem dígito nenhum, essas 2 condições nem existem na query.
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            ...(digits
              ? [
                  { phoneNormalized: { contains: digits } },
                  { whatsappNormalized: { contains: digits } },
                ]
              : []),
          ],
        }
      : {}),
  };

  if (jobTitle === NO_JOB_TITLE) where.jobTitle = null;
  else if (jobTitle) where.jobTitle = jobTitle;

  if (responsavelId === NO_RESPONSAVEL) where.responsavelId = null;
  else if (responsavelId && includeUnassigned) where.AND = [{ OR: [{ responsavelId }, { responsavelId: null }] }];
  else if (responsavelId) where.responsavelId = responsavelId;

  if (onlyWithDeals) where.deals = { some: {} };

  // Sempre empilha em where.AND (nunca where.OR direto): a busca por texto
  // (q, acima) já pode ter posto o PRÓPRIO OR de nome/e-mail/telefone no
  // nível raiz — sobrescrever where.OR aqui apagaria essa condição por
  // engano em vez de somar (ex.: buscar texto + "Sem e-mail" ao mesmo
  // tempo). "" além de null: alguns caminhos de edição (ex.: card "Dados do
  // contato" do negócio, que sempre manda o campo mesmo vazio) gravam
  // string vazia em vez de null ao limpar o campo — sem cobrir os dois,
  // "Sem e-mail"/"Sem WhatsApp" deixaria contato assim de fora do resultado.
  const extraAnd: Prisma.ContactWhereInput[] = Array.isArray(where.AND) ? [...where.AND] : [];
  if (hasEmail === "yes") extraAnd.push({ email: { not: null } }, { NOT: { email: "" } });
  else if (hasEmail === "no") extraAnd.push({ OR: [{ email: null }, { email: "" }] });
  if (hasWhatsapp === "yes") extraAnd.push({ whatsapp: { not: null } }, { NOT: { whatsapp: "" } });
  else if (hasWhatsapp === "no") extraAnd.push({ OR: [{ whatsapp: null }, { whatsapp: "" }] });
  if (extraAnd.length > 0) where.AND = extraAnd;

  if (registeredFrom || registeredTo) {
    where.createdAt = {
      ...(registeredFrom ? { gte: registeredFrom } : {}),
      ...(registeredTo ? { lte: registeredTo } : {}),
    };
  }

  return where;
}

// Usam searchDb (BYPASSRLS, ver lib/search-db.ts), não o `prisma` normal —
// pedido explícito do usuário: "a velocidade de busca de clientes no CRM
// está muito lenta". Causa raiz medida em produção (141k+ contatos): sob
// RLS, o Postgres se recusa a combinar a policy (que usa current_setting())
// com um Bitmap Index Scan nos índices trigram porque ILIKE/`%` não são
// operadores "leakproof" — cai pra sequential scan mesmo com os índices
// existindo e válidos (300ms-2s+ por busca comum). Via searchDb, a MESMA
// query usa os índices normalmente (2-30ms). buildContactsWhere sempre
// inclui organizationId incondicionalmente (1ª condição do `where`, nunca
// opcional no tipo) — essa é a única proteção multi-tenant aqui agora,
// então isso NUNCA pode virar opcional nestas duas funções.
export async function countContacts(params: ContactsFilterParams): Promise<number> {
  return searchDb.contact.count({ where: buildContactsWhere(params) });
}

/**
 * Todas as tags já usadas em algum contato da organização — pro filtro de
 * Tag saber o que oferecer (ver "Tags" no FilterPopover de
 * contacts-table.tsx: "quando eu clico no filtro ele mostra as tags
 * disponíveis"). Não dá pra montar essa lista só com os contatos já
 * carregados na tela (como sourceOptions/jobTitleOptions em
 * contacts-table.tsx fazem) — igual origem/cargo, tag é texto livre sem
 * tabela própria, então uma tag usada só em contatos de outra página nunca
 * apareceria. `unnest` "desempacota" o array de cada linha em várias linhas
 * (1 por tag) pra dar pra fazer DISTINCT — mesmo raciocínio de índice/RLS
 * das outras buscas deste arquivo, por isso via searchDb também.
 */
// Cache em memória do resultado abaixo — a consulta é inerentemente um scan
// da tabela inteira de contatos (DISTINCT de um array não tem índice que
// sirva: medido em produção, 141.970 contatos produzindo só 4 tags
// distintas, ~150ms quente e ~1,1s frio). Como isso alimenta só as OPÇÕES
// de um filtro (o conjunto de tags muda raramente — só quando alguém
// etiqueta algo com uma tag nova), pagar esse scan em TODA abertura da
// página de Clientes era desperdício puro.
//
// TTL curto (1 min) de propósito: uma tag nova aparece no filtro em no
// máximo um minuto, sem precisar de invalidação explícita em todo caminho
// de escrita (bulk "Etiquetar", importação, API externa, edição de
// contato) — invalidar em todos eles seria fácil de esquecer num caminho
// novo e deixaria o filtro mentindo. Por processo/instância: cada réplica
// paga o scan uma vez por janela, o que é irrelevante perto de uma vez por
// pageview.
const TAGS_CACHE_TTL_MS = 60_000;
const tagsCache = new Map<string, { at: number; tags: string[] }>();

export async function getDistinctContactTags(organizationId: string, responsavelId?: string): Promise<string[]> {
  const cacheKey = `${organizationId}:${responsavelId ?? ""}`;
  const hit = tagsCache.get(cacheKey);
  if (hit && Date.now() - hit.at < TAGS_CACHE_TTL_MS) return hit.tags;

  const tags = await queryDistinctContactTags(organizationId, responsavelId);
  tagsCache.set(cacheKey, { at: Date.now(), tags });
  return tags;
}

async function queryDistinctContactTags(organizationId: string, responsavelId?: string): Promise<string[]> {
  // `responsavelId` (opcional) — MEMBER só pode ver/filtrar pelas tags dos
  // PRÓPRIOS contatos (mesma régua do resto da listagem, ver isMember em
  // app/(dashboard)/clientes/page.tsx e GET /api/contacts) — sem isso, o
  // filtro ofereceria tags de contatos de outros consultores que esse
  // usuário nem consegue ver, e escolher uma delas sempre daria "0
  // resultados" sem explicação nenhuma.
  const rows = await searchDb.$queryRaw<{ tag: string }[]>`
    SELECT DISTINCT tag
    FROM "Contact", unnest(tags) AS tag
    WHERE "organizationId" = ${organizationId}
      ${responsavelId ? Prisma.sql`AND "responsavelId" = ${responsavelId}` : Prisma.empty}
      AND NOT (tags @> ARRAY[${NO_CONTACT_TAG}]::text[])
      AND tag <> ${NO_CONTACT_TAG}
    ORDER BY tag
  `;
  return rows.map((r) => r.tag);
}

export async function fetchContactsList(params: ContactsFilterParams & { skip?: number; take: number }): Promise<EnrichedContact[]> {
  const { skip, take } = params;

  return searchDb.contact.findMany({
    where: buildContactsWhere(params),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      whatsapp: true,
      source: true,
      jobTitle: true,
      tags: true,
      responsavelId: true,
      responsavel: { select: { id: true, name: true } },
      createdAt: true,
      _count: { select: { deals: true } },
    },
    skip,
    take,
  });
}
