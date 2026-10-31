import type { Lista50Progress } from "@/lib/lista-50";

/** dd/mm — faixa da semana, sempre nesse formato curto (cabe no cabeçalho da seção). */
function formatarData(data: Date): string {
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Campo_Grande" });
}

/**
 * Visão do supervisor/gerente/dono: quanto cada consultor do escopo dele já
 * entregou, semana a semana, desde o início da campanha (ver
 * lib/lista-50.ts). Some consultor com 0 entregas de propósito — é o que
 * deixa visível quem ainda não entregou nada.
 */
export function Lista50SupervisorPanel({ progress }: { progress: Lista50Progress }) {
  return (
    <section className="relative mt-8 overflow-hidden rounded-2xl border border-[#262933] bg-[#121318] p-6 shadow-2xl md:p-8">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ffcc00] via-yellow-500 to-transparent" />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">Visão de equipe</span>
          <h2 className="text-xl font-bold text-white">Entrega da Lista dos 50 por consultor</h2>
        </div>
        <p className="text-xs text-gray-400">
          Meta: <span className="font-bold text-[#ffcc00]">{progress.weeklyGoal}</span> leads por consultor, por semana.
        </p>
      </div>

      <div className="space-y-6">
        {progress.weeks.map((semana) => (
          <div key={semana.weekNumber} className="rounded-xl border border-gray-800 bg-[#0a0a0c]/60 p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">
                Semana {semana.weekNumber}
                {semana.weekNumber === progress.currentWeek && (
                  <span className="ml-2 rounded border border-[#ffcc00]/40 bg-[#ffcc00]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#ffcc00]">
                    Atual
                  </span>
                )}
              </h3>
              <span className="text-xs text-gray-500">
                {formatarData(semana.start)} – {formatarData(new Date(semana.end.getTime() - 1))}
              </span>
            </div>

            {semana.byOwner.length === 0 ? (
              <p className="text-xs text-gray-500">Nenhum consultor neste escopo ainda.</p>
            ) : (
              <ul className="space-y-2">
                {semana.byOwner.map((consultor) => {
                  const porcentagem = Math.min(100, Math.round((consultor.count / progress.weeklyGoal) * 100));
                  const bateu = consultor.count >= progress.weeklyGoal;
                  return (
                    <li key={consultor.userId} className="flex items-center gap-3 text-xs">
                      <span className="w-32 shrink-0 truncate font-medium text-gray-300">{consultor.name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full border border-gray-700 bg-gray-800">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${bateu ? "bg-green-500" : "bg-gradient-to-r from-yellow-600 to-[#ffcc00]"}`}
                          style={{ width: `${porcentagem}%` }}
                        />
                      </div>
                      <span className={`w-16 shrink-0 text-right font-bold ${bateu ? "text-green-400" : "text-gray-300"}`}>
                        {consultor.count}/{progress.weeklyGoal}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
