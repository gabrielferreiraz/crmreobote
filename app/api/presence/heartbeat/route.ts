import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { recordHeartbeat } from "@/lib/user-activity";
import { recordFeatureUsage } from "@/lib/feature-usage/record";
import { sendBirthdayPushOncePerDay } from "@/lib/birthdays";

export const dynamic = "force-dynamic";

/**
 * Chamado a cada 30s pelo navegador enquanto a aba está em primeiro plano
 * (ver components/presence-heartbeat.tsx) — alimenta tanto "está online
 * agora" quanto o tempo diário no CRM (lib/user-activity.ts).
 *
 * Desde a medição de uso de funcionalidade (ver lib/feature-usage/), o
 * corpo pode trazer de carona o lote de cliques acumulado no navegador:
 * `{ features: { "pipeline.massa.etapa": 3 } }`. De carona de propósito —
 * uma rota própria significaria uma requisição a mais a cada 30s por aba
 * aberta, pra mandar um objeto que quase sempre tem 1 ou 2 chaves. O corpo
 * é OPCIONAL: heartbeats sem nada pra reportar continuam sendo um POST sem
 * corpo, exatamente como antes.
 */
export async function POST(req: Request) {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // Corpo ausente/inválido nunca derruba o heartbeat — presença é o dado
  // principal desta rota, a telemetria é o acessório.
  let features: Record<string, unknown> | null = null;
  try {
    const body = (await req.json()) as { features?: Record<string, unknown> } | null;
    if (body?.features && typeof body.features === "object") features = body.features;
  } catch {
    // sem corpo (o caso comum) — segue só com a presença
  }

  return runWithTenant(organizationId, async () => {
    await recordHeartbeat(organizationId, userId);
    // Push de aniversário de cliente no 1º acesso do dia (ver
    // lib/birthdays.ts) — sem await, nunca pode atrasar nem derrubar o
    // heartbeat; mesmo padrão de recordUserChange nas outras rotas.
    sendBirthdayPushOncePerDay(organizationId, userId).catch((err) =>
      console.error("[birthdays] falha ao enviar push de aniversário", err),
    );
    if (features) await recordFeatureUsage(organizationId, userId, features);
    return NextResponse.json({ ok: true });
  });
}
