import Link from "next/link";
import { Cake, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/avatar";
import type { ContactBirthday } from "@/lib/birthdays";

function whenLabel(b: ContactBirthday): string {
  if (b.daysUntil === 0) return "Hoje";
  if (b.daysUntil === 1) return "Amanhã";
  return `${String(b.day).padStart(2, "0")}/${String(b.month).padStart(2, "0")}`;
}

/**
 * Aniversário dos clientes (ver lib/birthdays.ts). Consultor/Gerente/
 * Supervisor veem só os clientes em que são o responsável; o Dono vê os de
 * TODOS (`showResponsavel`), então cada linha diz de qual consultor é o
 * cliente. Quem faz aniversário HOJE ganha o destaque de cor da marca; os
 * próximos dias vêm discretos.
 */
export function BirthdaysCard({
  birthdays,
  windowDays,
  showResponsavel,
}: {
  birthdays: ContactBirthday[];
  windowDays: number;
  showResponsavel: boolean;
}) {
  const todayCount = birthdays.filter((b) => b.daysUntil === 0).length;

  return (
    <div className="card p-5 border border-neutral-200 dark:border-neutral-800/80 shadow-xs bg-white dark:bg-neutral-900/90">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Clientes Aniversariantes</h2>
            {todayCount > 0 && (
              <span className="rounded-full bg-brand/10 dark:bg-brand/20 border border-brand/20 px-2 py-0.5 text-[11px] font-semibold text-brand dark:text-brand-light">
                {todayCount} hoje
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {showResponsavel ? "Clientes de todos os consultores" : "Seus clientes"} · próximos {windowDays} dias
          </p>
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
          <Cake className="h-4 w-4 text-brand" strokeWidth={2} />
        </div>
      </div>

      {birthdays.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
          Nenhum aniversário nos próximos {windowDays} dias.
        </p>
      ) : (
        <>
          {todayCount > 0 && (
            <p className="mb-2.5 text-xs font-medium text-brand dark:text-brand-light">
              {todayCount === 1 ? "1 cliente faz aniversário hoje" : `${todayCount} clientes fazem aniversário hoje`}
            </p>
          )}
          <div className="max-h-80 space-y-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-neutral-300 dark:scrollbar-thumb-neutral-700">
            {birthdays.map((b) => (
              <Link
                key={b.contactId}
                href={`/clientes/${b.contactId}`}
                className="-mx-1.5 flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60 group"
              >
                <span
                  className={`w-14 shrink-0 rounded-md px-1.5 py-0.5 text-center text-xs font-medium ${
                    b.daysUntil === 0
                      ? "bg-brand text-white font-semibold"
                      : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                  }`}
                >
                  {whenLabel(b)}
                </span>

                <Avatar name={b.name} size="xs" className="shrink-0" />

                <span className="min-w-0 flex-1 truncate">
                  <span className="block truncate font-medium text-neutral-900 dark:text-neutral-100 group-hover:text-brand dark:group-hover:text-brand-light transition-colors">
                    {b.name}
                  </span>
                  {showResponsavel && (
                    <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">
                      {b.responsavelName ?? "Sem responsável"}
                    </span>
                  )}
                </span>

                {b.turningAge && (
                  <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                    {b.turningAge} anos
                  </span>
                )}

                <ChevronRight className="h-3.5 w-3.5 text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" strokeWidth={2} />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
