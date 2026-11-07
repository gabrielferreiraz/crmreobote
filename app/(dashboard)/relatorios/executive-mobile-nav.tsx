"use client";

import { useEffect, useState } from "react";

const ITEMS = [
  { id: "executive-overview", label: "Resumo" },
  { id: "executive-sales", label: "Vendas" },
  { id: "executive-team", label: "Time" },
  { id: "executive-ranking", label: "Ranking" },
] as const;

export function ExecutiveMobileNav() {
  const [active, setActive] = useState<(typeof ITEMS)[number]["id"]>(ITEMS[0].id);

  useEffect(() => {
    const sections = ITEMS
      .map((item) => document.getElementById(item.id))
      .filter((section): section is HTMLElement => section !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id as (typeof ITEMS)[number]["id"]);
      },
      { rootMargin: "-18% 0px -66% 0px", threshold: [0, 0.1, 0.35] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const goTo = (id: (typeof ITEMS)[number]["id"]) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <nav
      className="sticky top-0 z-20 grid grid-cols-4 border-b border-neutral-200 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur-md lg:hidden dark:border-neutral-800 dark:bg-neutral-950/95"
      aria-label="Seções do relatório executivo"
    >
      {ITEMS.map((item) => {
        const selected = active === item.id;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            onClick={(event) => {
              event.preventDefault();
              goTo(item.id);
            }}
            aria-current={selected ? "location" : undefined}
            className={`relative flex min-h-11 items-center justify-center px-2 text-sm font-semibold transition-colors active:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:active:bg-violet-950/40 ${
              selected
                ? "text-violet-700 dark:text-violet-300"
                : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            }`}
          >
            {item.label}
            <span
              className={`absolute right-2 bottom-0 left-2 h-0.5 origin-center bg-violet-500 transition-transform duration-300 ease-out ${selected ? "scale-x-100" : "scale-x-0"}`}
              aria-hidden="true"
            />
          </a>
        );
      })}
    </nav>
  );
}
