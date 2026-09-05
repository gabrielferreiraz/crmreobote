import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

/**
 * Cliente dedicado à busca global (app/api/search/route.ts), conectado como
 * `app_search` — role só-leitura (SELECT em Contact/Deal/User) com
 * BYPASSRLS (ver .env, DATABASE_URL_SEARCH).
 *
 * Por quê bypassar RLS aqui: o Postgres implementa RLS com semântica de
 * "security barrier" — quando a policy usa `current_setting()` (nosso caso,
 * ver lib/tenant-context.ts) e a própria query usa operador não-leakproof
 * (ILIKE, `%` do pg_trgm), o planner se recusa a combinar a policy com um
 * Bitmap Index Scan no índice GIN trigram, caindo pra sequential scan —
 * confirmado via EXPLAIN ANALYZE (300ms-1.4s virou sequential scan sob RLS,
 * contra ~35ms usando o índice). Não é falta de índice nem query mal escrita;
 * é limitação do planner com RLS + operador não-leakproof.
 *
 * Em vez de usar a role de superusuário (que bypassaria RLS em TUDO e ainda
 * teria DDL/acesso a toda tabela), `app_search` só tem SELECT nas 3 tabelas
 * que essa busca lê — o menor privilégio possível pra resolver o problema.
 * O filtro `organizationId = $1` explícito na query continua sendo a
 * proteção multi-tenant (agora a única camada, já que RLS está bypassada
 * pra essa conexão) — nunca remova esse filtro das queries que usam este
 * client, e nunca importe `searchDb` fora da rota de busca.
 */
function createSearchClient() {
  // Pool criado à mão (em vez de passar as opções direto pro PrismaPg) só
  // pra poder plugar o hook `connect` abaixo — baixa o limiar de
  // similaridade do pg_trgm (mais "globalesco", acha com letras parecidas/
  // digitação parcial — ver app/api/search/route.ts) UMA VEZ por conexão
  // física nova, não a cada busca. A alternativa óbvia (`SELECT
  // set_config(..., true)` dentro de um `$transaction` por query) funciona,
  // mas soma 2 idas-e-voltas extras (BEGIN+COMMIT) em CADA busca — nesta
  // pool pequena (max 5, compartilhada só por esta rota) isso segura a
  // conexão por mais tempo à toa sob uso concorrente. Rodar uma vez por
  // conexão custa perto de zero (a pool com keepAlive reaproveita a mesma
  // conexão física por muito tempo) e nunca precisa de transação nenhuma —
  // `false` (não `true`) porque aqui é pra ficar valendo a vida toda da
  // conexão, não só uma transação: esta pool é exclusiva desta rota, então
  // não existe "outra query" que precisaria do limiar padrão de volta.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL_SEARCH,
    keepAlive: true,
    max: 5,
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

  return new PrismaClient({ adapter });
}

type GlobalSearchDb = { searchDb?: PrismaClient };
const globalForSearchDb = globalThis as unknown as GlobalSearchDb;

export const searchDb = globalForSearchDb.searchDb ?? createSearchClient();

if (process.env.NODE_ENV !== "production") {
  globalForSearchDb.searchDb = searchDb;
}
