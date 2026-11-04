/**
 * Cálculo de verdade do bônus por meta — toca banco (ver lib/commissions/bonus.ts
 * pro núcleo puro). Disparado só por botão ("Calcular bônus do mês" em
 * Configurar comissões → Bônus por meta), nunca sozinho: o Financeiro decide
 * quando rodar, depois de conferir que as metas do mês estão certas — mesmo
 * espírito manual-primeiro de "Lançar ajuste".
 *
 * Idempotente por organização+regra+pessoa+mês (CommissionBonusAward
 * @@unique) — rodar duas vezes no mesmo mês nunca paga duas vezes. Rodar de
 * novo DEPOIS que uma venda nova entrar pode destravar uma faixa mais alta
 * que ainda não tinha sido premiada: aí sim cria um segundo lançamento (a
 * diferença), nunca mexe no já pago. Nunca REBAIXA um bônus já concedido
 * (se uma venda for cancelada depois e o total cair) — o Financeiro ajusta à
 * mão pelo mesmo "Lançar ajuste" de sempre, igual a qualquer outra correção
 * manual do sistema.
 */

import { Prisma } from "@/app/generated/prisma/client";
import { prisma, prismaRaw } from "@/lib/prisma";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { BRAZIL_UTC_OFFSET_HOURS } from "@/lib/timezone";
import { isMonthKey, type BeneficiaryRole } from "@/lib/commissions/engine";
import { computeAchievedPercent, pickBonusTier, bonusAmountCents, bonusEntryNote } from "@/lib/commissions/bonus";

export type BonusCalculationItem = {
  ruleId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  achievedPercent: number;
  tierThresholdPercent: number;
  amount: number;
};

export type BonusCalculationResult = {
  awarded: BonusCalculationItem[];
  /** Vendedor elegível (role bate, regra pede "todo mundo") sem meta cadastrada no mês — nada pra comparar. */
  skippedNoGoal: { beneficiaryId: string; beneficiaryName: string }[];
  /** Não bateu nenhuma faixa (ficou abaixo da faixa mais baixa). */
  skippedBelowThreshold: { beneficiaryId: string; beneficiaryName: string; achievedPercent: number }[];
  /** Regra já tinha concedido um prêmio pra essa pessoa neste mês — não recalcula (ver docstring do arquivo). */
  alreadyAwarded: { beneficiaryId: string; beneficiaryName: string }[];
};

function monthRangeUTC(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1, BRAZIL_UTC_OFFSET_HOURS, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, BRAZIL_UTC_OFFSET_HOURS, 0, 0, 0));
  return { start, end };
}

/** Quem pode ser beneficiário de uma regra "todo mundo" — ativo na organização, no papel certo. */
async function eligibleBeneficiaries(organizationId: string, role: BeneficiaryRole): Promise<{ id: string; name: string }[]> {
  // "Vendedor" não é um OrganizationUser.role fixo (quem vende, de fato, é
  // quem aparece como sellerId numa CommissionSale — até supervisor/gerente
  // pode vender) — mesmo critério já usado pro seletor de pessoa de
  // CommissionRule (ver personOptions em rule-dialog.tsx): pra SELLER,
  // qualquer membro ativo é candidato; pra SUPERVISOR/MANAGER, só quem tem
  // esse papel na organização.
  const members = await prisma.organizationUser.findMany({
    where: {
      organizationId,
      active: true,
      ...(role === "SELLER" ? {} : { role }),
    },
    select: { user: { select: { id: true, name: true } } },
  });
  return members.map((m) => ({ id: m.user.id, name: m.user.name }));
}

export async function runCommissionBonusCalculation(
  organizationId: string,
  month: string,
  actorUserId: string,
): Promise<BonusCalculationResult> {
  if (!isMonthKey(month)) throw new Error("Mês inválido");
  const [year, monthNum] = month.split("-").map(Number);
  const { start, end } = monthRangeUTC(year, monthNum);

  return runWithTenant(organizationId, async () => {
    const rules = await prisma.commissionBonusRule.findMany({
      where: { organizationId, active: true },
      include: { tiers: true, user: { select: { id: true, name: true } } },
    });

    const awarded: BonusCalculationItem[] = [];
    const skippedNoGoal: BonusCalculationResult["skippedNoGoal"] = [];
    const skippedBelowThreshold: BonusCalculationResult["skippedBelowThreshold"] = [];
    const alreadyAwarded: BonusCalculationResult["alreadyAwarded"] = [];

    for (const rule of rules) {
      if (rule.tiers.length === 0) continue;
      const beneficiaries = rule.userId
        ? rule.user
          ? [{ id: rule.user.id, name: rule.user.name }]
          : []
        : await eligibleBeneficiaries(organizationId, rule.beneficiaryRole);

      for (const beneficiary of beneficiaries) {
        const goal = await prisma.commissionIndividualGoal.findUnique({
          where: { organizationId_userId_year_month: { organizationId, userId: beneficiary.id, year, month: monthNum } },
          select: { value: true },
        });
        if (!goal || Number(goal.value) <= 0) {
          skippedNoGoal.push({ beneficiaryId: beneficiary.id, beneficiaryName: beneficiary.name });
          continue;
        }

        const existingAward = await prisma.commissionBonusAward.findUnique({
          where: { ruleId_beneficiaryId_month: { ruleId: rule.id, beneficiaryId: beneficiary.id, month } },
          select: { id: true },
        });
        if (existingAward) {
          alreadyAwarded.push({ beneficiaryId: beneficiary.id, beneficiaryName: beneficiary.name });
          continue; // já concedido — nunca recalcula/rebaixa (ver docstring).
        }

        const sold = await prisma.commissionSale.aggregate({
          where: { organizationId, sellerId: beneficiary.id, status: "ACTIVE", saleDate: { gte: start, lt: end } },
          _sum: { netValue: true },
        });
        const achievedCents = Math.round(Number(sold._sum.netValue ?? 0) * 100);
        const goalCents = Math.round(Number(goal.value) * 100);
        const percent = computeAchievedPercent(achievedCents, goalCents);

        const tiers = rule.tiers.map((t) => ({
          id: t.id,
          thresholdPercent: Number(t.thresholdPercent),
          rewardType: t.rewardType,
          rewardValue: Number(t.rewardValue),
        }));
        const tier = pickBonusTier(tiers, percent);
        if (!tier) {
          skippedBelowThreshold.push({ beneficiaryId: beneficiary.id, beneficiaryName: beneficiary.name, achievedPercent: percent });
          continue;
        }

        const amountCents = bonusAmountCents(tier, achievedCents);
        if (amountCents <= 0) continue; // faixa configurada com prêmio zero/negativo — não lança nada.
        const amount = amountCents / 100;

        // Award ANTES do Entry, numa transação só: a trava é o
        // @@unique([ruleId, beneficiaryId, month]) do Award — se dois
        // cliques em "Calcular" caírem juntos nesta mesma pessoa, o segundo
        // esbarra no índice único e nunca chega a criar um Entry duplicado
        // (dinheiro duplicado). prismaRaw + setTenantOnTx porque o cliente
        // de uma transação interativa não carrega a extensão de RLS
        // sozinho (mesmo motivo de toda transação multi-passo no projeto).
        const created = await prismaRaw.$transaction(async (tx) => {
          await setTenantOnTx(tx, organizationId);
          try {
            await tx.commissionBonusAward.create({
              data: { organizationId, ruleId: rule.id, tierId: tier.id, beneficiaryId: beneficiary.id, month, achievedPercent: percent.toFixed(2), amount: amount.toFixed(2) },
            });
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false; // concorrência — outra chamada já garantiu.
            throw err;
          }
          const entry = await tx.commissionEntry.create({
            data: {
              organizationId,
              beneficiaryId: beneficiary.id,
              role: rule.beneficiaryRole,
              kind: "ADJUSTMENT",
              paymentMonth: month,
              amount: amount.toFixed(2),
              note: bonusEntryNote(tier.thresholdPercent, percent),
              createdById: actorUserId,
            },
            select: { id: true },
          });
          await tx.commissionBonusAward.update({
            where: { ruleId_beneficiaryId_month: { ruleId: rule.id, beneficiaryId: beneficiary.id, month } },
            data: { entryId: entry.id },
          });
          return true;
        });
        if (!created) {
          alreadyAwarded.push({ beneficiaryId: beneficiary.id, beneficiaryName: beneficiary.name });
          continue;
        }

        awarded.push({
          ruleId: rule.id,
          beneficiaryId: beneficiary.id,
          beneficiaryName: beneficiary.name,
          achievedPercent: percent,
          tierThresholdPercent: tier.thresholdPercent,
          amount,
        });
      }
    }

    return { awarded, skippedNoGoal, skippedBelowThreshold, alreadyAwarded };
  });
}
