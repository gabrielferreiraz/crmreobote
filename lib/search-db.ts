import { PrismaClient } from "@/app/generated/prisma/client";
import { GLOBAL_OMIT } from "@/lib/prisma-omit";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

/**
 * Cliente dedicado a busca por texto (ILIKE/trigram) — hoje usado pela
 * busca global (app/api/search/route.ts) E pela listagem/busca de clientes
 * (lib/contacts/list-query.ts, ver comentário lá: mesmíssimo sintoma,
 * "demora e demora bem" depois de digitar nome/telefone — pedido explícito
 * do usuário). Conectado como `app_search` — role só-leitura (SELECT em
 * Contact/Deal/User) com BYPASSRLS (ver .env, DATABASE_URL_SEARCH).
 *
 * Por quê bypassar RLS aqui: o Postgres implementa RLS com semântica de
 * "security barrier" — quando a policy usa `current_setting()` (nosso caso,
 * ver lib/tenant-context.ts) e a própria query usa operador não-leakproof
 * (ILIKE, `%` do pg_trgm), o planner se recusa a combinar a policy com um
 * Bitmap Index Scan no índice GIN trigram, caindo pra sequential scan —
 * confirmado via EXPLAIN ANALYZE (300ms-2s virou sequential scan sob RLS,
 * contra ~2-30ms usando o índice, mesmo com os índices trigram existindo e
 * válidos). Não é falta de índice nem query mal escrita; é limitação do
 * planner com RLS + operador não-leakproof.
 *
 * Em vez de usar a role de superusuário (que bypassaria RLS em TUDO e ainda
 * teria DDL/acesso a toda tabela), `app_search` só tem SELECT nas 3 tabelas
 * que essas buscas leem — o menor privilégio possível pra resolver o
 * problema. O filtro `organizationId = $1` explícito na query continua
 * sendo a proteção multi-tenant (agora a única camada, já que RLS está
 * bypassada pra essa conexão) — nunca remova esse filtro das queries que
 * usam este client, e nunca importe `searchDb` fora de um lugar que já
 * monta esse filtro incondicionalmente (hoje: a rota de busca global e
 * lib/contacts/list-query.ts, os dois únicos consumidores).
 */
function createSearchClient() {
  // Pool criado à mão (em vez de passar as opções direto pro PrismaPg) só
  // pra poder plugar o hook `connect` abaixo — baixa o limiar de
  // similaridade do pg_trgm (mais "globalesco", acha com letras parecidas/
  // digitação parcial — ver app/api/search/route.ts) UMA VEZ por conexão
  // física nova, não a cada busca. A alternativa óbvia (`SELECT
  // set_config(..., true)` dentro de um `$transaction` por query) funciona,
  // mas soma 2 idas-e-voltas extras (BEGIN+COMMIT) em CADA busca — nesta
  // pool (compartilhada por 2 rotas agora, ver comentário acima) isso
  // segura a conexão por mais tempo à toa sob uso concorrente. Rodar uma
  // vez por conexão custa perto de zero (a pool com keepAlive reaproveita a
  // mesma conexão física por muito tempo) e nunca precisa de transação
  // nenhuma — `false` (não `true`) porque aqui é pra ficar valendo a vida
  // toda da conexão, não só uma transação: esta pool é exclusiva de busca
  // (nunca escreve nada), então não existe "outra query" que precisaria do
  // limiar padrão de volta. O threshold só afeta o operador de similaridade
  // (`%`, usado só pela busca global) — a busca de clientes usa ILIKE
  // (contains), que ignora esse GUC, então compartilhar a pool não muda o
  // comportamento dela em nada.
  //
  // max 10 (era 5, quando só a busca global ⌘K usava): a busca de clientes
  // (lib/contacts/list-query.ts) é disparada muito mais vezes por minuto do
  // que a global — junto com o pool de app_runtime (max 20, ver
  // lib/prisma.ts), o total fica bem abaixo do max_connections típico de
  // um Postgres gerenciado.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL_SEARCH,
    keepAlive: true,
    max: 10,
  });
  pool.on("error", (err) => console.error("[search pg pool error]", err));
  pool.on("connect", (client) => {
    client
      .query(
        `SELECT set_config('pg_trgm.similarity_threshold', '0.15', false), set_config('pg_trgm.word_similarity_threshold', '0.4', false)`,
      )
      .catch((err) => console.error("[search pg connect setup error]", err));
  });

  const adapter = new PrismaPg(pool, {
    onConnectionError: (err) => console.error("[search pg connection error]", err),
  });

  return new PrismaClient({ adapter, omit: GLOBAL_OMIT });
}

type GlobalSearchDb = { searchDb?: ReturnType<typeof createSearchClient> };
const globalForSearchDb = globalThis as unknown as GlobalSearchDb;

export const searchDb = globalForSearchDb.searchDb ?? createSearchClient();

if (process.env.NODE_ENV !== "production") {
  globalForSearchDb.searchDb = searchDb;
}
