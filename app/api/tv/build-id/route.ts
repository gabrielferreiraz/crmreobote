import { NextResponse } from "next/server";
import { SERVER_INSTANCE_ID } from "@/lib/server-instance";

export const dynamic = "force-dynamic";

/**
 * Ping de "qual processo está rodando agora" pra TV detectar deploy novo
 * sozinha (ver app/tv/tv-view.tsx) — SEM ser uma Server Action de
 * propósito. Server Actions são identificadas por um ID que muda a CADA
 * deploy (Next.js rotaciona, ver node_modules/next/dist/docs/01-app/
 * 02-guides/server-actions.md#deployment-considerations) — então o
 * navegador da TV, ainda rodando o bundle ANTIGO depois de um deploy,
 * chamava fetchTvMetrics (Server Action) e a chamada em si já falhava
 * ("Failed to find Server Action") antes de qualquer resposta chegar,
 * nunca dando chance de comparar o serverInstanceId que vinha junto nela —
 * era exatamente por isso que a TV não recarregava sozinha mesmo depois de
 * um deploy de verdade. Rota HTTP comum (não Server Action) não tem esse
 * problema: o endereço `/api/tv/build-id` é o mesmo antes e depois de
 * qualquer deploy, então SEMPRE responde com o que estiver rodando agora,
 * não importa o quão desatualizado o bundle de quem pergunta esteja.
 *
 * Sem autenticação de propósito — não devolve nenhum dado sensível (só um
 * UUID aleatório que muda a cada reinício do processo), e precisa
 * continuar respondendo mesmo pra um bundle velho/sem sessão válida.
 */
export async function GET() {
  return NextResponse.json({ serverInstanceId: SERVER_INSTANCE_ID });
}
