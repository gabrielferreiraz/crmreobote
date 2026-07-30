/**
 * Detecção do bug histórico do Agendor: telefone digitado sem querer no
 * campo "Valor" do negócio (o usuário confirmou — cadastro manual antigo,
 * esqueciam de tirar o telefone que estava lá antes de preencher o valor
 * de verdade). Confirmado nos dados reais: o padrão é sempre
 * "55" + DDD brasileiro válido + 8 ou 9 dígitos — nunca um valor de
 * consórcio de verdade parece com isso.
 *
 * Também é necessário na prática, não só desejável: Deal.value é
 * Decimal(12,2) (10 dígitos antes da vírgula) — um "valor" de 13 dígitos
 * (o tamanho típico desse telefone corrompido) nem cabe na coluna.
 */

import { VALID_BRAZILIAN_DDDS } from "@/lib/phone-normalize";

export function isCorruptedPhoneValue(valor: number): boolean {
  if (!Number.isFinite(valor) || valor <= 0) return false;
  const digits = String(Math.trunc(valor));
  if (!digits.startsWith("55")) return false;
  const ddd = digits.slice(2, 4);
  if (!VALID_BRAZILIAN_DDDS.has(ddd)) return false;
  const rest = digits.length - 4;
  return rest === 8 || rest === 9;
}
