"use client";

import { useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, Kanban, MessageCircle, CalendarDays, ClipboardList, BarChart3 } from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";

// Configurações saiu daqui — mora no menu do usuário agora (ver
// components/user-menu.tsx), pra deixar essa fileira só com o que é
// trabalho do dia a dia (menos itens grudados aqui em cima).
const NAV_ITEMS = [
  { href: "/", label: "Início", icon: Home },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/pipeline", label: "Pipeline", icon: Kanban, alsoActiveOn: ["/negocios"], salesOnly: true },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/processos", label: "Processos", icon: ClipboardList },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
];

/**
 * Enquanto o Next navega pra rota (sem loading.tsx em nenhuma página do
 * dashboard, a troca pode levar um instante com dado carregando), some com
 * "..." flutuando ao lado do nome — sem isso, clicar num link parecia não
 * ter feito nada até a página seguinte terminar de renderizar. Ícone e
 * rótulo nunca mudam, só isso é adicionado. Só funciona dentro de um <Link>
 * (useLinkStatus).
 */
function NavLinkContent({ icon: Icon, label, isActive }: { icon: typeof Home; label: string; isActive: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <Icon className="h-3 w-3 shrink-0" strokeWidth={isActive ? 2.3 : 2} />
      {label}
      {pending && <LoadingDots />}
    </>
  );
}

// Distância mínima (px) pra contar como "arrastou" em vez de "clicou" — mesmo
// valor de activationConstraint já usado no drag-and-drop da Agenda
// (task-calendar.tsx), pela mesma razão: sem um limiar, todo clique normal
// (mouse nunca fica 100% parado entre mousedown/mouseup) seria interpretado
// como um arraste de 1px e cancelaria a navegação à toa.
const DRAG_THRESHOLD_PX = 4;

/** Administrativo (pós-venda) não vê Pipeline/Negócios — não é o CRM de vendas que ele opera. */
export function TopNavLinks({ isAdministrativo }: { isAdministrativo: boolean }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !(isAdministrativo && item.salesOnly));

  const scrollRef = useRef<HTMLElement>(null);
  // dragState só existe enquanto o botão está pressionado (null fora
  // disso) — didDrag sobrevive até o clique seguinte, pra bloquear a
  // navegação de um <Link> se o mouseup terminou um arraste de verdade
  // (senão soltar o mouse depois de arrastar pra ver "Relatórios" navegava
  // pra ele sem querer).
  const dragState = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  const [didDrag, setDidDrag] = useState(false);

  function handleMouseDown(e: React.MouseEvent<HTMLElement>) {
    const el = scrollRef.current;
    if (!el) return;
    dragState.current = { startX: e.clientX, startScrollLeft: el.scrollLeft };
    // Reseta aqui (não só depois de um clique consumir) — sem isso, soltar
    // um arraste fora de cima de qualquer Link (espaço vazio da fileira)
    // deixava didDrag preso em `true`, e o PRÓXIMO clique normal (sem
    // arrastar nada) seria cancelado à toa por engano.
    setDidDrag(false);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLElement>) {
    const el = scrollRef.current;
    const start = dragState.current;
    if (!el || !start) return;
    const delta = e.clientX - start.startX;
    if (!didDrag && Math.abs(delta) > DRAG_THRESHOLD_PX) setDidDrag(true);
    el.scrollLeft = start.startScrollLeft - delta;
  }

  function endDrag() {
    dragState.current = null;
  }

  return (
    // Tablet/laptop de tela menor: nem sempre cabem os 7 itens + o resto do
    // cabeçalho (busca, "Novo negócio", sino, avatar) numa linha só. Antes
    // (overflow-x-hidden) o que não cabia simplesmente cortava e sumia da
    // tela, sem nenhum jeito de chegar lá — pedido explícito pra trocar por
    // "arrastar pro lado" (overflow-x-auto) em vez de esconder de vez. Nome
    // de cada página continua sempre por extenso (não é isto que deve
    // encolher — ver busca/"Novo negócio" em layout.tsx/adaptive-header-row,
    // que viram só ícone primeiro); a visão de celular (abaixo de lg, barra
    // inferior própria — ver mobile-nav.tsx) nem passa por aqui, intocada.
    //
    // cursor-grab/active:cursor-grabbing só dá a DICA visual do arraste com
    // mouse; o touch/trackpad já rola sozinho nativamente com o
    // overflow-x-auto, sem precisar de handler nenhum — os handlers de mouse
    // abaixo são só pra quem usa mouse comum (sem trackpad de duas dedos)
    // numa janela apertada.
    <nav
      ref={scrollRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      className="flex min-w-0 cursor-grab items-center gap-0.5 overflow-x-auto active:cursor-grabbing"
    >
      {items.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href) || (item.alsoActiveOn?.some((p) => pathname.startsWith(p)) ?? false);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            onClick={(e) => {
              // Só bloqueia a navegação quando o arraste que TERMINOU agora
              // (mouseup) foi de verdade — didDrag reseta em toda checagem,
              // então um próximo clique normal (sem arrastar nada) navega
              // igual sempre navegou.
              if (didDrag) {
                e.preventDefault();
                setDidDrag(false);
              }
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-all duration-150 ${
              isActive
                ? "bg-brand text-white shadow-sm dark:text-white"
                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            }`}
          >
            <NavLinkContent icon={Icon} label={item.label} isActive={isActive} />
          </Link>
        );
      })}
    </nav>
  );
}
