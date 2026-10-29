/**
 * "De → Para" de texto para membros da equipe (converter uma coluna de Texto
 * para Membro da equipe). Sugere quem é quem casando o texto da célula com os
 * nomes da equipe; o que for ambíguo fica para a pessoa escolher.
 *
 *   "FRED"        → Fred Lima            (primeiro nome único)
 *   "EDU/FELIPE"  → Edu Souza + Felipe   (venda dividida: um membro por nome)
 *   "FELIPE ICHIY"→ Felipe Ichiyama      (nome que começa assim)
 *   "KLEB"        → Kleber               (começo do primeiro nome, 3+ letras, único)
 *   "JOSE"        → (nada) se houver dois José — a pessoa escolhe
 */

import { splitMemberNames } from "@/lib/sheets/column-types";

export type Member = { id: string; label: string };
export type MemberSuggestion = { ids: string[]; unresolved: string[] };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Um nome (sem separadores) → o membro, se houver um só candidato no primeiro critério que encontrar alguém. */
function matchOne(part: string, members: { id: string; full: string; tokens: string[] }[]): string | null {
  const p = norm(part);
  if (!p) return null;
  const tiers: ((m: { full: string; tokens: string[] }) => boolean)[] = [
    (m) => m.full === p, // nome completo igual
    (m) => m.tokens[0] === p, // primeiro nome igual
    (m) => m.full.startsWith(`${p} `) || (p.includes(" ") && m.full.startsWith(p)), // "FELIPE ICHIY" → "FELIPE ICHIYAMA"
    (m) => m.tokens.includes(p), // sobrenome igual
    (m) => p.length >= 3 && !p.includes(" ") && (m.tokens[0] ?? "").startsWith(p), // apelido: "RAPHA" → Raphael, "KLEB" → Kleber
  ];
  for (const test of tiers) {
    const hits = members.filter(test);
    if (hits.length === 1) return hits[0].id;
    // Mais de um no mesmo critério: ambíguo — não chuta (critério mais frouxo só piora).
    if (hits.length > 1) return null;
  }
  return null;
}

export function memberMatcher(members: Member[]) {
  const prepared = members.map((m) => {
    const full = norm(m.label);
    return { id: m.id, full, tokens: full.split(" ").filter(Boolean) };
  });
  return (text: string): MemberSuggestion => {
    const whole = matchOne(text, prepared);
    if (whole) return { ids: [whole], unresolved: [] };
    const parts = splitMemberNames(text);
    const ids: string[] = [];
    const unresolved: string[] = [];
    for (const part of parts) {
      const id = matchOne(part, prepared);
      if (id) {
        if (!ids.includes(id)) ids.push(id);
      } else unresolved.push(part);
    }
    return { ids, unresolved };
  };
}
