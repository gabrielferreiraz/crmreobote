/**
 * Confere a Central de Ajuda: links quebrados, tópicos órfãos, ícone
 * inexistente, verbete que não ensina nada e busca que não acha o que
 * deveria.
 *
 * Roda com:  npx tsx scripts/check-help-content.ts
 *
 * Existe porque erro de CONTEÚDO não aparece no typecheck: um link pra uma
 * rota que não existe mais, ou um tópico citado em lib/help/screens.ts que
 * foi renomeado, compila perfeitamente e só quebra na cara do consultor —
 * justamente no momento em que ele estava perdido e foi pedir ajuda.
 *
 * Ao acrescentar tópico novo, rode isto antes de considerar pronto.
 */
import { HELP_TOPICS, HELP_CATEGORIES, HELP_TOPIC_BY_ID } from "@/lib/help/topics";
import { HELP_TOURS } from "@/lib/help/tours";
import { screenForPath } from "@/lib/help/screens";
import { CHECKLIST_ITEMS } from "@/lib/help/checklist";
import { DISCOVERY_ORDER, EVERGREEN_TOPIC_IDS } from "@/lib/help/discovery";
import { searchTopics, visibleTopics } from "@/lib/help/search";
import { HELP_ICONS } from "@/components/help/help-icons";
import { FEATURE_KEYS } from "@/lib/feature-usage/features";
import type { HelpRole } from "@/lib/help/types";

const problems: string[] = [];
const fail = (m: string) => problems.push(m);

// 1. ids únicos
const ids = HELP_TOPICS.map((t) => t.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length) fail(`ids repetidos: ${dupes.join(", ")}`);

// 2. ícones existem
for (const t of HELP_TOPICS) if (!HELP_ICONS[t.icon]) fail(`tópico "${t.id}" usa ícone inexistente: ${t.icon}`);
for (const c of HELP_CATEGORIES) if (!HELP_ICONS[c.icon]) fail(`categoria "${c.id}" usa ícone inexistente: ${c.icon}`);

// 3. toda categoria tem tópico e todo tópico tem categoria válida
const catIds = new Set(HELP_CATEGORIES.map((c) => c.id));
for (const t of HELP_TOPICS) if (!catIds.has(t.category)) fail(`tópico "${t.id}" aponta categoria inválida: ${t.category}`);
for (const c of HELP_CATEGORIES)
  if (!HELP_TOPICS.some((t) => t.category === c.id)) fail(`categoria "${c.id}" está vazia`);

// 4. tours referenciados existem, e todo tour é alcançável por algum tópico
const tourIds = new Set(HELP_TOURS.map((t) => t.id));
for (const t of HELP_TOPICS) if (t.tourId && !tourIds.has(t.tourId)) fail(`tópico "${t.id}" aponta tour inexistente: ${t.tourId}`);
for (const tour of HELP_TOURS)
  if (!HELP_TOPICS.some((t) => t.tourId === tour.id)) fail(`tour "${tour.id}" não é alcançável por nenhum tópico`);

// 5. referências cruzadas de telas / checklist / descoberta
const ROUTES = [
  "/", "/clientes", "/clientes/abc", "/pipeline", "/negocios/abc", "/agenda",
  "/whatsapp", "/whatsapp/conversas", "/whatsapp/campanhas", "/whatsapp/scripts",
  "/relatorios", "/automacoes", "/configuracoes", "/configuracoes/meu-cartao", "/processos",
];
for (const route of ROUTES) {
  const screen = screenForPath(route);
  if (!screen) { fail(`rota sem ajuda de contexto: ${route}`); continue; }
  for (const id of screen.topicIds) if (!HELP_TOPIC_BY_ID.has(id)) fail(`tela "${screen.title}" (${route}) aponta tópico inexistente: ${id}`);
}
for (const item of CHECKLIST_ITEMS) if (!HELP_TOPIC_BY_ID.has(item.topicId)) fail(`checklist "${item.id}" aponta tópico inexistente: ${item.topicId}`);
const featureKeys = new Set<string>(FEATURE_KEYS);
for (const d of DISCOVERY_ORDER) {
  if (!HELP_TOPIC_BY_ID.has(d.topicId)) fail(`descoberta aponta tópico inexistente: ${d.topicId}`);
  if (!featureKeys.has(d.feature)) fail(`descoberta aponta chave de medição inexistente: ${d.feature}`);
}
for (const id of EVERGREEN_TOPIC_IDS) if (!HELP_TOPIC_BY_ID.has(id)) fail(`dica permanente aponta tópico inexistente: ${id}`);

// 6. todo link interno aponta pra rota que existe no app
const APP_ROUTES = new Set([
  "/", "/clientes", "/pipeline", "/agenda", "/processos", "/relatorios", "/relatorios/meta-ads",
  "/automacoes", "/whatsapp", "/whatsapp/conversas", "/whatsapp/campanhas", "/whatsapp/scripts",
  "/whatsapp/scripts/novo", "/docs",
  "/configuracoes", "/configuracoes/perfil", "/configuracoes/meu-cartao", "/configuracoes/desfazer",
  "/configuracoes/usuarios", "/configuracoes/equipes", "/configuracoes/pipeline",
  "/configuracoes/motivos-perda", "/configuracoes/origens", "/configuracoes/tipos-de-credito",
  "/configuracoes/cargos", "/configuracoes/campos-personalizados", "/configuracoes/horario-atendimento",
  "/configuracoes/processos", "/configuracoes/tv", "/configuracoes/proposta",
  "/configuracoes/integracoes", "/configuracoes/auditoria", "/configuracoes/uso",
  "/configuracoes/saude-do-sistema", "/configuracoes/notificacoes-email",
  "/api/simulador-sso",
]);
const checkHref = (href: string, origin: string) => {
  const base = href.split(/[?#]/)[0];
  if (!APP_ROUTES.has(base)) fail(`${origin} aponta rota que não existe no app: ${href}`);
};
for (const t of HELP_TOPICS) for (const l of t.links ?? []) checkHref(l.href, `tópico "${t.id}"`);
for (const item of CHECKLIST_ITEMS) checkHref(item.action.href, `checklist "${item.id}"`);

// 7. qualidade mínima do verbete
for (const t of HELP_TOPICS) {
  if (!t.steps?.length && !t.reference?.length && !t.tourId)
    fail(`tópico "${t.id}" não ensina nada (sem passos, referência ou tour)`);
  if (t.summary.length > 110) fail(`resumo longo demais em "${t.id}" (${t.summary.length})`);
}

// 8. busca — termos que um consultor digitaria de verdade
const audience = { role: "MEMBER" as HelpRole, isAdministrativo: false };
const EXPECTED: [string, string][] = [
  ["apaguei sem querer", "desfazer"],
  ["disparo", "campanhas"],
  ["planilha", "importar-clientes"],
  ["qr code", "conectar-whatsapp"],
  ["atalho", "atalhos"],
  ["nao compareceu", "resultado-reuniao"],
  ["mensagem pronta", "scripts"],
  ["perdi a venda", "perder-negocio"],
  ["ctrl k", "busca-rapida"],
  ["microfone", "ditado-voz"],
  ["varios de uma vez", "acoes-em-massa"],
  ["pdf", "propostas"],
];
for (const [query, expectedId] of EXPECTED) {
  const found = searchTopics(query, audience).map((t) => t.id);
  if (!found.includes(expectedId)) fail(`busca "${query}" não achou "${expectedId}" (achou: ${found.join(", ") || "nada"})`);
}

// 9. papel: consultor não pode ver tópico de administração restrito
const memberIds = new Set(visibleTopics(audience).map((t) => t.id));
for (const restricted of ["usuarios-permissoes", "configurar-funil", "tv-ranking", "saude-sistema", "uso-do-crm"])
  if (memberIds.has(restricted)) fail(`consultor está vendo tópico restrito: ${restricted}`);
const ownerIds = new Set(visibleTopics({ role: "OWNER", isAdministrativo: false }).map((t) => t.id));
for (const restricted of ["usuarios-permissoes", "saude-sistema"])
  if (!ownerIds.has(restricted)) fail(`dono NÃO está vendo tópico que devia: ${restricted}`);
const admIds = new Set(visibleTopics({ role: "MEMBER", isAdministrativo: true }).map((t) => t.id));
if (admIds.has("acoes-em-massa") || admIds.has("criar-negocio")) fail("Administrativo está vendo tópico de vendas");


// 10. perguntas do jeito que a pessoa digita — o certo tem de vir em PRIMEIRO,
//     não em algum lugar da lista (ninguém rola resultado de ajuda).
const PHRASES: [string, string][] = [
  ["como faço pra criar uma campanha", "campanhas"],
  ["apaguei um cliente sem querer", "desfazer"],
  ["quero subir uma planilha", "importar-clientes"],
  ["meu whatsapp desconectou", "conectar-whatsapp"],
  ["o cliente não apareceu na reunião", "resultado-reuniao"],
  ["como marcar que vendi", "ganhar-negocio"],
  ["quero um qr code do meu contato", "cartao-digital"],
  ["não sei onde fica o relatório", "relatorios"],
  ["como mandar mensagem pra vários de uma vez", "acoes-em-massa"],
];
for (const [phrase, expectedId] of PHRASES) {
  const first = searchTopics(phrase, audience)[0]?.id;
  if (first !== expectedId) fail(`"${phrase}" devia trazer "${expectedId}" em primeiro, trouxe "${first ?? "nada"}"`);
}
if (searchTopics("asdfgh", audience).length > 0) fail("busca sem sentido devia devolver vazio");

console.log(`tópicos: ${HELP_TOPICS.length} | categorias: ${HELP_CATEGORIES.length} | tours: ${HELP_TOURS.length}`);
console.log(`visíveis — consultor: ${memberIds.size} | dono: ${ownerIds.size} | administrativo: ${admIds.size}`);
if (problems.length) {
  console.error(`\n${problems.length} PROBLEMA(S):`);
  for (const p of problems) console.error(" -", p);
  process.exit(1);
}
console.log("\nTudo consistente.");
