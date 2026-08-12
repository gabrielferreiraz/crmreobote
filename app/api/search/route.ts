import { NextResponse } from "next/server";
import { searchDb } from "@/lib/search-db";
import { requireSession } from "@/lib/require-session";
import { normalizePhoneNumber } from "@/lib/phone-normalize";

export const dynamic = "force-dynamic";

type ContactRow = { id: string; name: string; email: string | null; ownerName: string | null };
type DealRow = { id: string; name: string; contactName: string; ownerName: string | null };

// Abaixo disso, pg_trgm não discrimina bem (poucos trigramas pra comparar) e
// o ILIKE '%x%' de 1 caractere bate com uma fração enorme da tabela — cara
// de computar (ordenar por similaridade exige visitar cada linha candidata,
// ver comentário mais abaixo) e o resultado não seria útil de qualquer
// forma. Mesmo padrão de UX de qualquer busca "instantânea" por aí.
const MIN_QUERY_LENGTH = 2;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (q.length < MIN_QUERY_LENGTH) return NextResponse.json({ contacts: [], deals: [] });

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
  // proteção multi-tenant — única camada agora nesta rota, mantenha sempre.
  //
  // Contatos e negócios em DUAS queries em paralelo (Promise.all), não uma
  // sequencial — cada uma já usa bem o índice trigram, mas ainda visita cada
  // linha candidata pra computar `similarity()` antes de ordenar (o índice
  // GIN é "lossy": só credencia candidatos, não decide sozinho). Rodar as
  // duas ao mesmo tempo em conexões diferentes do pool corta o tempo total
  // pra busca de ~metade.
  const [contacts, deals] = await Promise.all([
    searchDb.$queryRaw<ContactRow[]>`
      SELECT ct.id, ct.name, ct.email, u.name AS "ownerName"
      FROM "Contact" ct
      LEFT JOIN "User" u ON u.id = ct."responsavelId"
      WHERE ct."organizationId" = ${organizationId}
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
      SELECT d.id, d.name, c.name AS "contactName", u.name AS "ownerName"
      FROM "Deal" d
      JOIN "Contact" c ON c.id = d."contactId"
      LEFT JOIN "User" u ON u.id = d."ownerId"
      WHERE d."organizationId" = ${organizationId}
        AND (d.name ILIKE '%' || ${q} || '%' OR d.name % ${q})
      ORDER BY similarity(d.name, ${q}) DESC, d.name ASC
      LIMIT 5
    `,
  ]);

  return NextResponse.json({
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, email: c.email, ownerName: c.ownerName })),
    deals: deals.map((d) => ({ id: d.id, name: d.name, contact: { name: d.contactName }, ownerName: d.ownerName })),
  });
}
