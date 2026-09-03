"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ComponentType } from "react";
import {
  Search,
  SearchX,
  ChevronRight,
  Kanban,
  Users,
  XCircle,
  UsersRound,
  UserCircle,
  SlidersHorizontal,
  Mail,
  Zap,
  Plug,
  Tag,
  CreditCard,
  Briefcase,
  ClipboardList,
  ShieldAlert,
  Monitor,
  HeartPulse,
  MessageCircle,
  Clock,
  Building2,
  Undo2,
} from "lucide-react";

export type ConfigItem = {
  href: string;
  /** Chave de components/configuracoes/page.tsx (não dá pra passar o componente do ícone direto de Server pra Client) — ver ICONS abaixo. */
  icon: string;
  title: string;
  description: string;
  /** Sinônimos/termos relacionados que a pessoa pode digitar sem bater no título/descrição — é isso que faz a busca parecer "inteligente" (ver normalize/matches). */
  keywords?: string[];
  /**
   * Sub-item de uma página maior (ex.: "Conectar WhatsApp" dentro de "Perfil
   * e preferências") — some da navegação normal (evita empilhar granularidade
   * demais quando ninguém tá buscando nada), só aparece quando a BUSCA bate
   * nele especificamente, com `parentLabel` como legenda acima do título —
   * mesmo padrão da busca de Configurações do Android/Samsung: acha e já
   * manda direto pro trecho certo da página, não só pro topo dela.
   */
  hiddenUnlessMatched?: boolean;
  /** Título da página-mãe — vira a legenda acima do nome quando este item aparece num resultado de busca (só faz sentido junto de hiddenUnlessMatched). */
  parentLabel?: string;
};

export type ConfigSection = {
  title: string;
  /** Legenda curta embaixo do título, dentro do próprio card — mesmo padrão
   * do Windows Settings ("Configurações recentes e comumente usadas" embaixo
   * de "Configurações recomendadas"). Opcional: nem toda seção precisa. */
  description?: string;
  /** Ícone do CABEÇALHO do card (chave de ICONS abaixo) — diferente do
   * `icon` de cada ConfigItem (esse é por LINHA, dentro da seção). Cai pro
   * ícone genérico (ver SECTION_FALLBACK_ICON) se omitido. */
  icon?: string;
  items: ConfigItem[];
};

type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

const ICONS: Record<string, IconComponent> = {
  Kanban,
  Users,
  XCircle,
  UsersRound,
  UserCircle,
  SlidersHorizontal,
  Mail,
  Zap,
  Plug,
  Tag,
  CreditCard,
  Briefcase,
  ClipboardList,
  ShieldAlert,
  Monitor,
  HeartPulse,
  MessageCircle,
  Clock,
  Building2,
  Undo2,
};
const SECTION_FALLBACK_ICON = SlidersHorizontal;

/** Remove acento e caixa — "compartilhamento" e "COMPARTILHAMENTO" e "compartilhaménto" batem igual. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Busca por termo, não por frase exata — cada PALAVRA digitada precisa
 * aparecer em algum lugar do item (título, descrição, ou um dos
 * `keywords`), em qualquer ordem. É o `keywords` que dá a sensação de
 * "inteligente": ele guarda sinônimos e termos relacionados que a pessoa
 * naturalmente tentaria (ex.: digitar "compartilhar" acha "Equipes", que
 * tem "compartilhamento" nos keywords, mesmo o título não contendo essa
 * palavra) — sem precisar de busca semântica de verdade pra um catálogo
 * pequeno e fixo como este.
 */
function matchesQuery(item: ConfigItem, query: string): boolean {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize([item.title, item.description, ...(item.keywords ?? [])].join(" "));
  return words.every((word) => haystack.includes(word));
}

export function ConfigSearch({ sections }: { sections: ConfigSection[] }) {
  const [query, setQuery] = useState("");
  const isSearching = !!query.trim();

  const filteredSections = useMemo(() => {
    if (!isSearching) {
      // Navegação normal: nunca mostra hiddenUnlessMatched (ver comentário
      // no type) — só a busca ativa revela esses sub-itens.
      return sections
        .map((section) => ({ ...section, items: section.items.filter((item) => !item.hiddenUnlessMatched) }))
        .filter((section) => section.items.length > 0);
    }
    return sections
      .map((section) => ({ ...section, items: section.items.filter((item) => matchesQuery(item, query)) }))
      .filter((section) => section.items.length > 0);
  }, [sections, query, isSearching]);

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
          strokeWidth={2}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar em Configurações..."
          className="field-input w-full py-2 pl-9"
        />
      </div>

      {query.trim() && filteredSections.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-10 text-center">
          <SearchX className="h-8 w-8 text-neutral-300 dark:text-neutral-600" strokeWidth={1.5} />
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Nada em Configurações bate com &quot;{query}&quot;
          </p>
        </div>
      ) : (
        // Colunas CSS (não grid) de propósito — é a técnica mais simples que
        // dá o efeito "bento" do Windows Settings (cards de altura BEM
        // diferente — uma seção com 2 itens e outra com 8 — se encaixando
        // sem vão vazio): o navegador distribui cada card na coluna mais
        // curta sozinho, sem precisar calcular row-span manualmente como um
        // CSS grid exigiria. `break-inside-avoid` em cada card (ver Section)
        // é o que impede um card ser cortado ao meio na quebra de coluna.
        <div className="columns-1 gap-5 lg:columns-2">
          {filteredSections.map((section) => (
            <Section key={section.title} title={section.title} description={section.description} icon={section.icon}>
              {section.items.map((item) => (
                <Row key={item.href + item.title} {...item} />
              ))}
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Card auto-contido (ícone + título + legenda opcional NO TOPO, dentro da
 * mesma caixa — não mais um rótulo solto acima de um card separado) — é
 * essa mudança que faz a página ler como um mosaico de "widgets", cada um
 * completo em si, em vez de uma lista de listas. */
function Section({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: string;
  children: React.ReactNode;
}) {
  const Icon = (icon && ICONS[icon]) || SECTION_FALLBACK_ICON;
  return (
    <div className="card mb-5 break-inside-avoid overflow-hidden p-0">
      {/* Cabeçalho com peso visual BEM maior que uma linha comum — ícone
          sólido (fundo cor cheia, não o tom clarinho das linhas), título
          maior, e um fundo levemente tintado só nessa faixa — antes o
          cabeçalho usava quase o mesmo peso das opções abaixo (ícone
          clarinho do mesmo tamanho, título só um pouco mais forte),
          confundia "isto é o tópico" com "isto é uma opção". */}
      <div className="flex items-center gap-3 bg-brand-light/40 p-4 dark:bg-white/[0.04]">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand shadow-sm shadow-brand/30">
          <Icon className="h-5 w-5 text-white" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{description}</p>}
        </div>
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">{children}</div>
    </div>
  );
}

function Row({ icon, title, description, href, parentLabel }: ConfigItem) {
  const Icon = ICONS[icon] ?? Kanban;
  return (
    <Link href={href} className="group flex items-center gap-3 p-4 text-sm transition-colors hover:bg-brand-light/50 dark:hover:bg-brand-light/30">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-light dark:bg-brand-light">
        <Icon className="h-4 w-4 text-brand dark:text-brand" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        {/* Breadcrumb da página-mãe — só aparece em sub-itens revelados pela
            busca (ver hiddenUnlessMatched), mesmo padrão do Android/Samsung
            de mostrar onde aquele resultado mora antes do nome dele. */}
        {parentLabel && (
          <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">{parentLabel}</p>
        )}
        <p className="font-medium text-neutral-900 dark:text-neutral-100">{title}</p>
        <p className="mt-0.5 text-sm text-neutral-400 dark:text-neutral-500">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand dark:text-neutral-600 dark:group-hover:text-brand" strokeWidth={2} />
    </Link>
  );
}
