import { Eye, MessageCircle, Phone, UserPlus, Share2 } from "lucide-react";
import type { CardStats as CardStatsData } from "@/lib/digital-cards/queries";

/**
 * Resultados do cartão — só leitura. Palavras do dia a dia, não
 * "visualizações/vCard". Sem "visitantes únicos": a visita é gravada no
 * servidor sem o id do visitante (ver app/c/[slug]), então esse número
 * ficava sempre 0 ao lado de centenas de visitas — parecia defeito.
 */
export function CardStats({ stats }: { stats: CardStatsData }) {
  const items = [
    { icon: Eye, label: "Visitas", value: stats.views },
    { icon: MessageCircle, label: "Chamaram no WhatsApp", value: stats.whatsappClicks },
    { icon: Phone, label: "Ligaram", value: stats.phoneClicks },
    { icon: UserPlus, label: "Salvaram seu contato", value: stats.vcardDownloads },
    { icon: Share2, label: "Compartilharam", value: stats.shares },
  ];

  return (
    <section className="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-[0_1px_3px_rgba(20,24,50,0.06),0_10px_20px_-8px_rgba(20,24,50,0.08)] sm:p-5 dark:border-white/10 dark:bg-neutral-900/60 dark:shadow-none">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">Resultados</h2>
        {stats.lastAccessAt && (
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            Última visita{" "}
            {new Date(stats.lastAccessAt).toLocaleString("pt-BR", {
              dateStyle: "short",
              timeStyle: "short",
              // O servidor roda em UTC — sem isto a hora saía 4h adiantada.
              timeZone: "America/Campo_Grande",
            })}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {items.map((item, i) => (
          <div key={item.label} className={`rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50 ${i === 0 ? "col-span-2 sm:col-span-1" : ""}`}>
            <item.icon className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
            <p className="mt-1.5 text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{item.value.toLocaleString("pt-BR")}</p>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{item.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
