"use client";

import { createContext, useContext, type KeyboardEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChartNoAxesCombined, GitBranch, LayoutDashboard, MessageCircle, UsersRound } from "lucide-react";

type Topic = "resumo" | "vendas" | "funil" | "equipe" | "whatsapp";

const TOPICS = [
  { id: "resumo", label: "Resumo", icon: LayoutDashboard },
  { id: "vendas", label: "Vendas", icon: ChartNoAxesCombined },
  { id: "funil", label: "Funil", icon: GitBranch },
  { id: "equipe", label: "Equipe", icon: UsersRound },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
] as const;

const TopicContext = createContext<Topic>("resumo");

export function CommercialGuide({ children, showWhatsapp }: { children: ReactNode; showWhatsapp: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topics = showWhatsapp ? TOPICS : TOPICS.filter((topic) => topic.id !== "whatsapp");
  const requested = searchParams.get("topic");
  const active = topics.find((topic) => topic.id === requested)?.id ?? "resumo";

  function select(topic: Topic) {
    if (topic === active) return;
    const params = new URLSearchParams(searchParams.toString());
    if (topic === "resumo") params.delete("topic");
    else params.set("topic", topic);
    const query = params.toString();
    router.push(`${window.location.pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % topics.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + topics.length) % topics.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = topics.length - 1;
    else return;
    event.preventDefault();
    select(topics[next].id);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]");
    buttons?.[next]?.focus();
  }

  return (
    <TopicContext.Provider value={active}>
      <div className="min-w-0">
        <div className="scrollbar-none overflow-x-auto border-b border-neutral-200 dark:border-neutral-800">
          <div role="tablist" aria-label="Assuntos do relatório comercial" className="flex min-w-max gap-1">
            {topics.map((topic, index) => {
              const Icon = topic.icon;
              const selected = active === topic.id;
              return (
                <button
                  key={topic.id}
                  id={`commercial-topic-${topic.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="commercial-guide-content"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(topic.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                  className={`relative flex min-h-11 items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand sm:text-base ${
                    selected
                      ? "text-brand after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-brand"
                      : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={selected ? 2.2 : 1.8} aria-hidden="true" />
                  {topic.label}
                </button>
              );
            })}
          </div>
        </div>
        <div id="commercial-guide-content" role="tabpanel" aria-labelledby={`commercial-topic-${active}`} className="min-w-0 space-y-10 pt-6 sm:space-y-16 sm:pt-8">
          {children}
        </div>
      </div>
    </TopicContext.Provider>
  );
}

export function CommercialGuideSection({ topic, children }: { topic: Topic; children: ReactNode }) {
  const active = useContext(TopicContext);
  return active === topic ? <div className="space-y-10 sm:space-y-16">{children}</div> : null;
}
