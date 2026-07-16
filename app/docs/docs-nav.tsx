"use client";

import { useEffect, useRef, useState } from "react";

type NavItem = { id: string; label: string };

/** Marca a seção mais visível na tela como ativa, em ambos os menus (desktop e mobile). */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

export function DocsSidebar({ items }: { items: NavItem[] }) {
  const active = useActiveSection(items.map((i) => i.id));

  return (
    <nav className="hidden w-56 shrink-0 lg:block">
      <div className="sticky top-20 space-y-1">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={
              active === item.id
                ? "block rounded-md bg-neutral-100 px-2.5 py-1.5 text-sm font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                : "block rounded-md px-2.5 py-1.5 text-sm text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100"
            }
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

export function DocsMobileNav({ items }: { items: NavItem[] }) {
  const active = useActiveSection(items.map((i) => i.id));
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [active]);

  return (
    <div className="sticky top-[49px] z-10 -mx-4 border-b border-neutral-200/60 bg-white/90 px-4 backdrop-blur-md lg:hidden dark:border-neutral-800/60 dark:bg-neutral-950/90">
      <div className="scrollbar-thin flex gap-1.5 overflow-x-auto py-2">
        {items.map((item) => (
          <a
            key={item.id}
            ref={active === item.id ? activeRef : undefined}
            href={`#${item.id}`}
            className={
              active === item.id
                ? "shrink-0 rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium whitespace-nowrap text-white dark:bg-white dark:text-neutral-900"
                : "shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-xs whitespace-nowrap text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
            }
          >
            {item.label}
          </a>
        ))}
      </div>
    </div>
  );
}
