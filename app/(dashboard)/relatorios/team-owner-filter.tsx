"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select } from "@/components/select";
import { sortSelfFirst } from "@/lib/sort-self-first";
import { WHO_FILTER_KEY } from "./filters-storage";

/**
 * Filtro por equipe ou responsável — um único parâmetro de URL (?who=team:<id>
 * ou ?who=owner:<id>), lido pela página (Server Component) pra estreitar o
 * escopo das agregações. As opções já vêm pré-filtradas por quem pode ver o
 * quê (ver relatorios/page.tsx) — nunca abre acesso a mais gente do que o
 * papel do usuário já permite, só estreita.
 */
export function TeamOwnerFilter({
  teams,
  members,
  currentUserId,
}: {
  teams: { id: string; name: string }[];
  members: { id: string; name: string }[];
  /** Pra "Eu" aparecer sempre em primeiro (ver lib/sort-self-first.ts). */
  currentUserId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("who") ?? "";

  // Nada pra filtrar (nem mais de uma equipe, nem mais de uma pessoa visível).
  if (teams.length === 0 && members.length <= 1) return null;

  function apply(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("who", value);
    else params.delete("who");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    try {
      if (value) localStorage.setItem(WHO_FILTER_KEY, value);
      else localStorage.removeItem(WHO_FILTER_KEY);
    } catch {}
  }

  const orderedMembers = sortSelfFirst(members, currentUserId);
  const options = [
    { value: "", label: "Todos" },
    ...teams.map((t) => ({ value: `team:${t.id}`, label: `Equipe: ${t.name}` })),
    ...orderedMembers.map((m) => ({ value: `owner:${m.id}`, label: m.id === currentUserId ? "Eu" : m.name })),
  ];

  return <Select value={current} onChange={apply} options={options} className="w-52" />;
}
