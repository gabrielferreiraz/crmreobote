"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";
import { DatePicker } from "./date-picker";
import { Select } from "./select";
import { brazilDateKey } from "@/lib/timezone";
import { getServerTodayKey } from "@/app/actions/date-actions";
import { formatCurrency } from "@/lib/format";
import { formatMonthLong } from "@/lib/commissions/engine";

type CommissionPreview =
  | { status: "inactive" }
  | { status: "pending"; sellerName: string; isMe: boolean; hasReducedRules: boolean }
  | {
      status: "ok";
      sellerName: string;
      isMe: boolean;
      hasReducedRules: boolean;
      total: number;
      count: number;
      firstMonth: string;
      lastMonth: string;
      paidByAdministrator: boolean;
    };

/**
 * Pergunta só a data de fechamento — usado tanto pra marcar Ganho de um
 * negócio só (negocios/[id]/deal-detail.tsx) quanto pro bulk "Marcar como
 * ganho" em massa (pipeline/deals-list.tsx, que passa `title`/`confirmLabel`
 * no plural). Extraído pra cá quando o bulk precisou do mesmo diálogo — só
 * havia 1 cópia, local ao detalhe do negócio, até então.
 *
 * O valor inicial do campo vem do SERVIDOR (getServerTodayKey), não do
 * relógio local do dispositivo — relógios de celular/PC podem estar errados
 * e causariam um closedAt gravado no dia errado (bug real: consultora com
 * relógio 1 dia atrasado, venda sumiu do ranking da TV).
 * Enquanto a resposta do servidor não chegou, o botão de confirmar fica
 * desabilitado — a espera típica é < 1s (1 round-trip), aceitável pra uma
 * ação de fechamento de negócio.
 *
 * `askAdministrator` (só no Ganho): pede também a administradora do
 * consórcio — módulo de Comissões. A lista vem do servidor ao abrir; se a
 * corretora não tem nenhuma administradora cadastrada (não usa Comissões),
 * o campo simplesmente não aparece e nada muda pra ela.
 *
 * `previewDealId` (Ganho de UM negócio): assim que a administradora é
 * escolhida, mostra quanto a venda vai render de comissão — o momento de
 * maior emoção do consultor, e também a hora de perceber que escolheu a
 * administradora errada. Mesmo motor da venda de comissão (ver
 * /api/commissions/preview), então o número é o mesmo que ele vê depois.
 */
export function ClosedAtDialog({
  title,
  confirmLabel,
  confirmClassName,
  onClose,
  onConfirm,
  askAdministrator = false,
  initialAdministratorId = null,
  previewDealId,
}: {
  title: string;
  confirmLabel: string;
  confirmClassName: string;
  onClose: () => void;
  onConfirm: (closedAt: string, extra: { administratorId: string | null }) => Promise<void>;
  askAdministrator?: boolean;
  initialAdministratorId?: string | null;
  previewDealId?: string;
}) {
  // Fallback local enquanto a server action não respondeu — evita campo vazio
  // piscando, mas não permite confirmar com esse valor (ready=false).
  const [closedAt, setClosedAt] = useState(brazilDateKey());
  // Teto do calendário: nunca depois de HOJE (servidor) — sem isso, um
  // clique errado no dia seguinte no calendário grava um closedAt no futuro,
  // que nunca deixa de ser "o mais recente" pra TV/Relatórios (ORDER BY
  // closedAt DESC) até o calendário de verdade alcançar aquela data. Bug
  // real encontrado em produção (venda travada 5 dias "no futuro"). Mesma
  // fonte (servidor, não relógio do dispositivo) que já evita o problema
  // irmão (closedAt no passado por relógio atrasado, ver comentário acima).
  const [maxDate, setMaxDate] = useState(brazilDateKey());
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [administrators, setAdministrators] = useState<{ id: string; name: string }[]>([]);
  const [administratorId, setAdministratorId] = useState(initialAdministratorId ?? "");
  // Enquanto a lista não chegou, não deixa confirmar sem ela — senão um
  // clique rápido passaria sem a administradora e o servidor recusaria.
  const [administratorsReady, setAdministratorsReady] = useState(!askAdministrator);

  useEffect(() => {
    getServerTodayKey()
      .then((serverDate) => {
        setClosedAt(serverDate);
        setMaxDate(serverDate);
        setReady(true);
      })
      .catch(() => {
        // Se a action falhar (rede, servidor fora), aceita o fallback local.
        setReady(true);
      });
  }, []);

  useEffect(() => {
    if (!askAdministrator) return;
    fetch("/api/commissions/administrators")
      .then((res) => (res.ok ? res.json() : { administrators: [] }))
      .then((data: { administrators?: { id: string; name: string }[] }) => {
        const list = data.administrators ?? [];
        setAdministrators(list);
        // A que estava no negócio pode ter sido desativada — sem ela na lista, pede de novo.
        setAdministratorId((current) => (list.some((a) => a.id === current) ? current : ""));
      })
      .catch(() => setAdministrators([]))
      .finally(() => setAdministratorsReady(true));
  }, [askAdministrator]);

  const needsAdministrator = administrators.length > 0;

  const [preview, setPreview] = useState<CommissionPreview | null>(null);
  useEffect(() => {
    if (!previewDealId || !administratorId || !closedAt || !ready) return;
    const controller = new AbortController();
    const qs = new URLSearchParams({ dealId: previewDealId, administratorId, closedAt });
    fetch(`/api/commissions/preview?${qs}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: CommissionPreview | null) => setPreview(data))
      .catch(() => {});
    return () => controller.abort();
  }, [previewDealId, administratorId, closedAt, ready]);
  const shownPreview = administratorId ? preview : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (needsAdministrator && !administratorId) return;
    setLoading(true);
    await onConfirm(closedAt, { administratorId: needsAdministrator ? administratorId : null });
    setLoading(false);
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="field-label">Data</label>
          <DatePicker value={closedAt} onChange={setClosedAt} max={maxDate} />
        </div>

        {needsAdministrator && (
          <div className="space-y-1">
            <label className="field-label">Administradora</label>
            <Select
              value={administratorId}
              onChange={setAdministratorId}
              options={administrators.map((a) => ({ value: a.id, label: a.name }))}
              placeholder="Escolha a administradora"
              ariaLabel="Administradora"
            />
          </div>
        )}

        {shownPreview && shownPreview.status !== "inactive" && (
          <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
            {shownPreview.status === "ok" ? (
              <>
                <p>
                  Essa venda vai {shownPreview.isMe ? "te render" : "render"}{" "}
                  <strong className="text-base font-semibold">{formatCurrency(shownPreview.total)}</strong> de comissão
                  {shownPreview.isMe ? "" : ` para ${shownPreview.sellerName}`}
                  {shownPreview.count === 1
                    ? `, em ${formatMonthLong(shownPreview.firstMonth).toLowerCase()}`
                    : `, em ${shownPreview.count} parcelas de ${formatMonthLong(shownPreview.firstMonth).toLowerCase()} a ${formatMonthLong(shownPreview.lastMonth).toLowerCase()}`}
                  .
                </p>
                {shownPreview.paidByAdministrator && <p className="mt-1">Quem paga é a administradora, direto.</p>}
                {shownPreview.hasReducedRules && <p className="mt-1">Se a venda for em meia parcela, o Financeiro ajusta esse valor.</p>}
              </>
            ) : (
              <p>O Financeiro ainda vai confirmar o valor da comissão desta venda.</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || !closedAt || !ready || !administratorsReady || (needsAdministrator && !administratorId)}
            className={confirmClassName}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {loading ? (
              <span className="inline-flex items-center gap-1">
                Salvando
                <LoadingDots />
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
