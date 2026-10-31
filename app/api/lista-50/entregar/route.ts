import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { submitLista50Leads, Lista50CampaignInactiveError, type Lista50LeadInput } from "@/lib/lista-50";

export const dynamic = "force-dynamic";

// Mesma folga de qualquer formulário de uma página só — bem acima dos 50 da
// meta, só pra não deixar um corpo gigante passar sem limite nenhum.
const MAX_LEADS_PER_SUBMIT = 200;

// Trava em memória contra duas entregas do MESMO consultor em voo ao mesmo
// tempo (clique duplo que passou da trava síncrona do navegador, aba
// duplicada, retry de rede) — sem isso, duas requisições concorrentes podiam
// ambas não encontrar o contato ainda, e as duas criarem um Contato/Deal
// para o mesmo nome (não há índice único de telefone no banco pra impedir
// isso na camada de dados). Mesma limitação de processo único de
// lib/rate-limit.ts — aceitável aqui pelo mesmo motivo.
const emVoo = new Set<string>();

function isValidLead(v: unknown): v is Lista50LeadInput {
  if (!v || typeof v !== "object") return false;
  const lead = v as Record<string, unknown>;
  return (
    typeof lead.nome === "string" &&
    typeof lead.whatsapp === "string" &&
    (lead.circulo === undefined || typeof lead.circulo === "string") &&
    (lead.interesse === undefined || typeof lead.interesse === "string") &&
    (lead.temperatura === undefined || typeof lead.temperatura === "string") &&
    (lead.observacao === undefined || typeof lead.observacao === "string")
  );
}

/**
 * Entrega da Lista dos 50 — qualquer pessoa logada e ativa pode entregar a
 * própria lista (mesma abertura que a tela já tinha). Cada linha válida vira
 * Contato + Deal na etapa "Black November" com ESTE usuário como dono (ver
 * lib/lista-50.ts) — nunca em nome de outra pessoa.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !Array.isArray((body as { leads?: unknown }).leads)) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  const leadsInput = (body as { leads: unknown[] }).leads;
  if (leadsInput.length === 0) {
    return NextResponse.json({ error: "Envie ao menos um contato" }, { status: 400 });
  }
  if (leadsInput.length > MAX_LEADS_PER_SUBMIT || !leadsInput.every(isValidLead)) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const chave = `${access.organizationId}:${access.userId}`;
  if (emVoo.has(chave)) {
    return NextResponse.json({ error: "Sua lista já está sendo entregue — aguarde terminar." }, { status: 409 });
  }
  emVoo.add(chave);

  try {
    return await runWithTenant(access.organizationId, async () => {
      try {
        const result = await submitLista50Leads(access.organizationId, access.userId, leadsInput as Lista50LeadInput[]);
        return NextResponse.json(result);
      } catch (err) {
        if (err instanceof Lista50CampaignInactiveError) {
          return NextResponse.json({ error: err.message }, { status: 409 });
        }
        throw err;
      }
    });
  } finally {
    emVoo.delete(chave);
  }
}
