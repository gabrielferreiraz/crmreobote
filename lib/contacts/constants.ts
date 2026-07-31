/**
 * Peças compartilhadas entre servidor (lib/contacts/list-query.ts) e cliente
 * (app/(dashboard)/clientes/contacts-table.tsx) — deliberadamente SEM
 * importar `@/lib/prisma` nem nada que dependa de `pg` aqui. Um componente
 * "use client" importando list-query.ts direto (mesmo só por uma constante)
 * arrasta o adaptador Postgres inteiro pro bundle do navegador e quebra o
 * build (`Module not found: Can't resolve 'dns'/'fs'/'net'/'tls'`, Node-only
 * dentro de `pg`) — esse arquivo existe só pra evitar essa armadilha.
 */

/** Sentinela pro filtro "sem cargo cadastrado" (não dá pra mandar `null` numa querystring). */
export const NO_JOB_TITLE = "__NONE__";
/** Mesma ideia pro filtro "sem responsável". */
export const NO_RESPONSAVEL = "__NONE__";

/**
 * As 27 UFs do Brasil — lista fechada, então o filtro de Estado (Clientes e
 * Negócios) usa essas opções fixas em vez de derivar de `Contact.state`
 * (que hoje está 100% vazio na base migrada do Agendor; só passa a ter
 * valor em contatos novos, cadastrados com o campo Estado preenchido).
 */
export const ESTADOS_BR = [
  { value: "AC", label: "Acre" },
  { value: "AL", label: "Alagoas" },
  { value: "AP", label: "Amapá" },
  { value: "AM", label: "Amazonas" },
  { value: "BA", label: "Bahia" },
  { value: "CE", label: "Ceará" },
  { value: "DF", label: "Distrito Federal" },
  { value: "ES", label: "Espírito Santo" },
  { value: "GO", label: "Goiás" },
  { value: "MA", label: "Maranhão" },
  { value: "MT", label: "Mato Grosso" },
  { value: "MS", label: "Mato Grosso do Sul" },
  { value: "MG", label: "Minas Gerais" },
  { value: "PA", label: "Pará" },
  { value: "PB", label: "Paraíba" },
  { value: "PR", label: "Paraná" },
  { value: "PE", label: "Pernambuco" },
  { value: "PI", label: "Piauí" },
  { value: "RJ", label: "Rio de Janeiro" },
  { value: "RN", label: "Rio Grande do Norte" },
  { value: "RS", label: "Rio Grande do Sul" },
  { value: "RO", label: "Rondônia" },
  { value: "RR", label: "Roraima" },
  { value: "SC", label: "Santa Catarina" },
  { value: "SP", label: "São Paulo" },
  { value: "SE", label: "Sergipe" },
  { value: "TO", label: "Tocantins" },
] as const;

/**
 * Só os campos que a listagem (app/(dashboard)/clientes/contacts-table.tsx)
 * de fato renderiza/filtra — endereço completo, empresa e customFieldValues
 * (JSON livre, ver lib/custom-fields.ts) só existem na página de detalhe do
 * contato (/clientes/[id], que busca o registro completo separadamente),
 * nunca na lista. Trazer isso pra até 500 linhas por página era bytes reais
 * do Postgres à toa.
 */
export type EnrichedContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string | null;
  jobTitle: string | null;
  tags: string[];
  responsavelId: string | null;
  responsavel: { id: string; name: string } | null;
  createdAt: Date;
  _count: { deals: number };
};
