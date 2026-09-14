import { Eye, Users, MessageCircle, Phone, Download, Share2, Clock } from "lucide-react";
import type { CardStats as CardStatsData } from "@/lib/digital-cards/queries";

/** Dashboard básico de "Meu Cartão" (pedido: visualizações, visitantes únicos, cliques, contatos salvos, compartilhamentos, último acesso) — puro display, sem interação, arquitetura já preparada pra um dashboard corporativo mais completo depois. */
export function CardStats({ stats }: { stats: CardStatsData }) {
  const items = [
    { icon: Eye, label: "Visualizações", value: stats.views },
    { icon: Users, label: "Visitantes únicos (estimado)", value: stats.uniqueVisitorsEstimate },
    { icon: MessageCircle, label: "Cliques no WhatsApp", value: stats.whatsappClicks },
    { icon: Phone, label: "Cliques no telefone", value: stats.phoneClicks },
    { icon: Download, label: "Contatos salvos", value: stats.vcardDownloads },
    { icon: Share2, label: "Compartilhamentos", value: stats.shares },
  ];

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Estatísticas</h2>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border border-neutral-100 p-3 dark:border-neutral-800">
            <item.icon className="h-3.5 w-3.5 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
            <p className="mt-1.5 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{item.value}</p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">{item.label}</p>
          </div>
        ))}
      </div>
      {stats.lastAccessAt && (
        <p className="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
          <Clock className="h-3 w-3" strokeWidth={2} />
          Último acesso: {new Date(stats.lastAccessAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
        </p>
      )}
    </div>
  );
}
