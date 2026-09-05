import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { searchDb } from "@/lib/search-db";
import { requireSession } from "@/lib/require-session";
import { getCurrentMembership } from "@/lib/current-membership";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { getDealScope } from "@/lib/team-scope";

export const dynamic = "force-dynamic";

type ContactRow = { id: string; name: string; email: string | null; whatsapp: string | null; ownerName: string | null };
type DealRow = {
  id: string;
  name: string;
  contactName: string;
  ownerName: string | null;
  status: "OPEN" | "WON" | "LOST";
};

// Abaixo disso, pg_trgm não discrimina bem (poucos trigramas pra comparar) e
// o ILIKE '%x%' de 1 caractere bate com uma fração enorme da tabela — cara
// de computar (ordenar por similaridade exige visitar cada linha candidata,
// ver comentário mais abaixo) e o resultado não seria útil de qualquer
// forma. Mesmo padrão de UX de qualquer busca "instantânea" por aí.
const MIN_QUERY_LENGTH = 2;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (q.length < MIN_QUERY_LENGTH) return NextResponse.json({ contacts: [], deals: [] });

  // Consultor (MEMBER) só vê seus próprios contatos (mesma regra da tela
  // de Clientes, que agora também filtra por responsável para MEMBER).
  // OWNER e MANAGER não têm restrição — buscam toda a organização.
  const membership = await getCurrentMembership();
  const isMember = membership?.role === "MEMBER";
  const contactResponsavelFilterSql = isMember
    ? Prisma.sql`AND ct."responsavelId" = ${userId}`
    : Prisma.empty;

  const scope = await getDealScope(organizationId, userId, session!.user.role);
  const dealOwnerFilterSql =
    scope.type === "owners"
      ? scope.ownerIds.length > 0
        ? Prisma.sql`AND d."ownerId" IN (${Prisma.join(scope.ownerIds)})`
        : Prisma.sql`AND false`
      : Prisma.empty;

  // Dígitos do termo buscado (ex.: "11 98888-7777" → "11988887777"), pra casar
  // com o telefone/WhatsApp do contato independente de como a pessoa formatou
  // a busca. String vazia quando o termo não tem nenhum dígito — nesse caso a
  // cláusula de telefone é ignorada (ver guarda "<> ''" abaixo; sem ela, um
  // LIKE '%%' bateria com toda linha).
  const digits = normalizePhoneNumber(q) ?? "";

  // `searchDb` (lib/search-db.ts) conecta como `app_search`, uma role
  // só-leitura com BYPASSRLS — RLS combinada com ILIKE/`%` (pg_trgm) faz o
  // planner do Postgres ignorar o índice GIN trigram e cair pra sequential
  // scan (confirmado via EXPLAIN ANALYZE: 300ms-1.4s virando ~35ms sem RLS
  // no caminho). O filtro `organizationId = ${organizationId}` abaixo é a
  // proteção MULTI-TENANT (entre organizações) — os `*OwnerFilterSql` acima
  // são a proteção INTRA-tenant (entre consultores da mesma organização),
  // igual scopeWhere/contactScopeWhere já fazem em toda outra rota; sem RLS
  // nesta conexão, as duas precisam continuar explícitas aqui sempre.
  //
  // Limiar de similaridade mais baixo que o padrão do Postgres (pedido
  // explícito: "mais globalesca", achar até com letras parecidas/digitação
  // parcial) — configurado UMA VEZ por conexão física nova, não aqui a cada
  // busca (ver o hook `pool.on("connect", ...)` em lib/search-db.ts).
  // similarity_threshold (0.3 → 0.15) afeta o operador `%` (trigrama do
  // texto inteiro); word_similarity_threshold (0.6 → 0.4) afeta `<%`
  // (melhor pra "nome tem várias palavras, buscou só um pedaço", ex.: "mar"
  // → "Maria Aparecida Souza" — o `%` sozinho penaliza demais esse caso
  // porque compara contra a string inteira). As duas continuam indexáveis
  // pelo mesmo índice GIN trigram (gin_trgm_ops suporta os dois
  // operadores).
  //
  // Contatos e negócios em DUAS queries em paralelo (Promise.all) — cada
  // uma já usa bem o índice trigram, mas ainda visita cada linha candidata
  // pra computar similarity()/word_similarity() antes de ordenar (o índice
  // GIN é "lossy": só credencia candidatos, não decide sozinho). Rodar as
  // duas ao mesmo tempo em conexões diferentes do pool corta o tempo total
  // pra busca de ~metade. Sem `$transaction` (nem aqui, nem no threshold) —
  // a pool de busca é pequena (max 5, ver lib/search-db.ts) e compartilhada
  // só por esta rota; envolver cada busca num BEGIN/COMMIT só pra aplicar o
  // limiar seguraria a conexão por 2 idas-e-voltas a mais à toa sob uso
  // concorrente, sem necessidade nenhuma agora que o limiar já vem certo
  // desde a conexão.
  const RESULT_LIMIT = 20; // "mostrar todas as pesquisas" — sem cap de 5; 20 cobre praticamente todo cenário real de digitação.

  // Limiar mais baixo (ver lib/search-db.ts) deixa o operador `%`/`<%` do
  // pg_trgm aceitar MUITO mais linha candidata — cada uma delas precisa
  // visitar a linha e calcular similarity()/word_similarity() antes do
  // ORDER BY, então a busca ficou mensuravelmente mais lenta pra digitação
  // normal (nome/empresa batendo por ILIKE de qualquer forma), mesmo essa
  // sendo a maioria esmagadora das buscas reais. Resolvido em 2 passadas:
  // 1ª só ILIKE/telefone (usa o mesmo índice GIN trigram, mas SEM depender
  // do limiar — sempre rápida, sem `similarity()` nenhuma pra calcular); só
  // dispara a 2ª passada (fuzzy de verdade, o comportamento "mais
  // globalesca" pedido) quando a 1ª não achou o suficiente. Resultado:
  // digitação normal paga só a passada rápida; nome digitado errado/parcial
  // ainda cai na fuzzy, exatamente como antes.
  const FUZZY_FALLBACK_MIN = 8;

  const [contacts, deals] = await Promise.all([
    (async (): Promise<ContactRow[]> => {
      const fast = await searchDb.$queryRaw<ContactRow[]>`
        SELECT ct.id, ct.name, ct.email, ct.whatsapp, u.name AS "ownerName"
        FROM "Contact" ct
        LEFT JOIN "User" u ON u.id = ct."responsavelId"
        WHERE ct."organizationId" = ${organizationId}
          ${contactResponsavelFilterSql}
          AND (
            ct.name ILIKE '%' || ${q} || '%' OR
            ct.company ILIKE '%' || ${q} || '%' OR
            ct.email ILIKE '%' || ${q} || '%' OR
            (${digits} <> '' AND (
              ct."phoneNormalized" LIKE '%' || ${digits} || '%' OR
              ct."whatsappNormalized" LIKE '%' || ${digits} || '%'
            ))
          )
        ORDER BY (ct.name ILIKE ${q + "%"}) DESC, ct.name ASC
        LIMIT ${RESULT_LIMIT}
      `;
      if (fast.length >= FUZZY_FALLBACK_MIN) return fast;

      const excludeIds = fast.map((c) => c.id);
      const fuzzy = await searchDb.$queryRaw<ContactRow[]>`
        SELECT ct.id, ct.name, ct.email, ct.whatsapp, u.name AS "ownerName"
        FROM "Contact" ct
        LEFT JOIN "User" u ON u.id = ct."responsavelId"
        WHERE ct."organizationId" = ${organizationId}
          ${contactResponsavelFilterSql}
          ${excludeIds.length > 0 ? Prisma.sql`AND ct.id NOT IN (${Prisma.join(excludeIds)})` : Prisma.empty}
          AND (
            ct.name % ${q} OR
            ${q} <% ct.name OR
            ct.company % ${q} OR
            ${q} <% ct.company
          )
        ORDER BY GREATEST(
          similarity(ct.name, ${q}),
          word_similarity(${q}, ct.name),
          similarity(coalesce(ct.company, ''), ${q}),
          word_similarity(${q}, coalesce(ct.company, ''))
        ) DESC, ct.name ASC
        LIMIT ${RESULT_LIMIT - fast.length}
      `;
      return [...fast, ...fuzzy];
    })(),
    (async (): Promise<DealRow[]> => {
      const fast = await searchDb.$queryRaw<DealRow[]>`
        SELECT d.id, d.name, c.name AS "contactName", u.name AS "ownerName", d.status
        FROM "Deal" d
        JOIN "Contact" c ON c.id = d."contactId"
        LEFT JOIN "User" u ON u.id = d."ownerId"
        WHERE d."organizationId" = ${organizationId}
          ${dealOwnerFilterSql}
          AND (
            d.name ILIKE '%' || ${q} || '%' OR
            c.name ILIKE '%' || ${q} || '%'
          )
        ORDER BY (d.name ILIKE ${q + "%"}) DESC, d.name ASC
        LIMIT ${RESULT_LIMIT}
      `;
      if (fast.length >= FUZZY_FALLBACK_MIN) return fast;

      const excludeIds = fast.map((d) => d.id);
      const fuzzy = await searchDb.$queryRaw<DealRow[]>`
        SELECT d.id, d.name, c.name AS "contactName", u.name AS "ownerName", d.status
        FROM "Deal" d
        JOIN "Contact" c ON c.id = d."contactId"
        LEFT JOIN "User" u ON u.id = d."ownerId"
        WHERE d."organizationId" = ${organizationId}
          ${dealOwnerFilterSql}
          ${excludeIds.length > 0 ? Prisma.sql`AND d.id NOT IN (${Prisma.join(excludeIds)})` : Prisma.empty}
          AND (
            d.name % ${q} OR
            ${q} <% d.name OR
            c.name % ${q} OR
            ${q} <% c.name
          )
        ORDER BY GREATEST(
          similarity(d.name, ${q}),
          word_similarity(${q}, d.name),
          similarity(c.name, ${q}),
          word_similarity(${q}, c.name)
        ) DESC, d.name ASC
        LIMIT ${RESULT_LIMIT - fast.length}
      `;
      return [...fast, ...fuzzy];
    })(),
  ]);

  return NextResponse.json({
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, email: c.email, whatsapp: c.whatsapp, ownerName: c.ownerName })),
    deals: deals.map((d) => ({
      id: d.id,
      name: d.name,
      contact: { name: d.contactName },
      ownerName: d.ownerName,
      status: d.status,
    })),
  });
}
