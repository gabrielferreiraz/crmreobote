/**
 * "Que experiência essa pessoa vê" — Vendas (CRM de sempre) ou
 * Administrativo (pós-venda: início só com tarefas/anotações, sem Pipeline/
 * Negócios, Relatórios próprio). Sempre confere no banco (não confia só no
 * JWT), mesmo padrão de requireSession/requireProcessAccess — na prática via
 * getCurrentMembership(), que já faz essa consulta e é reaproveitada (React
 * cache()) por quem mais precisar dela na mesma requisição.
 */

import type { $Enums } from "@/app/generated/prisma/client";
import { getCurrentMembership } from "@/lib/current-membership";

export async function getCurrentUserArea(): Promise<$Enums.UserArea | null> {
  const membership = await getCurrentMembership();
  if (!membership?.active) return null;
  return membership.area;
}
