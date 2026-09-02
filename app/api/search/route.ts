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
  // Contatos e negócios em DUAS queries em paralelo (Promise.all), não uma
  // sequencial — cada uma já usa bem o índice trigram, mas ainda visita cada
  // linha candidata pra computar `similarity()` antes de ordenar (o índice
  // GIN é "lossy": só credencia candidatos, não decide sozinho). Rodar as
  // duas ao mesmo tempo em conexões diferentes do pool corta o tempo total
  // pra busca de ~metade.
  const [contacts, deals] = await Promise.all([
    searchDb.$queryRaw<ContactRow[]>`
      SELECT ct.id, ct.name, ct.email, ct.whatsapp, u.name AS "ownerName"
      FROM "Contact" ct
      LEFT JOIN "User" u ON u.id = ct."responsavelId"
      WHERE ct."organizationId" = ${organizationId}
        ${contactResponsavelFilterSql}
        AND (
          ct.name ILIKE '%' || ${q} || '%' OR
          ct.name % ${q} OR
          ct.company ILIKE '%' || ${q} || '%' OR
          ct.company % ${q} OR
          ct.email ILIKE '%' || ${q} || '%' OR
          (${digits} <> '' AND (
            ct."phoneNormalized" LIKE '%' || ${digits} || '%' OR
            ct."whatsappNormalized" LIKE '%' || ${digits} || '%'
          ))
        )
      ORDER BY GREATEST(similarity(ct.name, ${q}), similarity(coalesce(ct.company, ''), ${q})) DESC, ct.name ASC
      LIMIT 5
    `,
    searchDb.$queryRaw<DealRow[]>`
      SELECT d.id, d.name, c.name AS "contactName", u.name AS "ownerName", d.status
      FROM "Deal" d
      JOIN "Contact" c ON c.id = d."contactId"
      LEFT JOIN "User" u ON u.id = d."ownerId"
      WHERE d."organizationId" = ${organizationId}
        ${dealOwnerFilterSql}
        AND (d.name ILIKE '%' || ${q} || '%' OR d.name % ${q})
      ORDER BY similarity(d.name, ${q}) DESC, d.name ASC
      LIMIT 5
    `,
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
