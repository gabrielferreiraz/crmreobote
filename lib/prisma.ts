import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  getCurrentOrganizationId,
  getCurrentUserId,
  getCurrentInstanceName,
  getCurrentApiKeyHash,
  getCurrentMetaPageId,
} from "@/lib/tenant-context";

function createBaseClient() {
  const adapter = new PrismaPg(
    {
      connectionString: process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL,
      keepAlive: true,
      max: 20,
    },
    {
      onPoolError: (err) => console.error("[pg pool error]", err),
      onConnectionError: (err) => console.error("[pg connection error]", err),
    },
  );

  return new PrismaClient({ adapter });
}

/**
 * Segunda camada de proteção multi-tenant (além do `where: organizationId` em
 * cada query): antes de rodar qualquer operação, define `app.current_organization_id`
 * via SET LOCAL (escopado à mini-transação da própria operação) — as policies de
 * RLS no Postgres usam esse valor pra nunca devolver/gravar linha de outra
 * organização, mesmo que a query em si tenha esquecido o filtro.
 *
 * Se não houver organizationId nem userId no contexto (lib/tenant-context.ts) —
 * por exemplo, durante o cadastro de uma organização nova, antes de existir
 * sessão — a operação roda normalmente, sem SET LOCAL; nesse caso a proteção
 * continua sendo só o `where` de cada query, como já era antes.
 *
 * `app.current_user_id` também é definido (quando disponível) porque o login
 * (lib/auth.ts) precisa localizar a própria filiação (OrganizationUser) do
 * usuário antes de saber a qual organização ele pertence — a policy de RLS
 * dessa tabela permite ver a própria filiação por userId mesmo sem
 * organizationId definido ainda.
 *
 * `app.current_instance_name` é o mesmo tipo de bootstrap, só que pro webhook
 * do Evolution API (lib/whatsapp/webhook.ts): a requisição só traz o
 * instanceName, e a policy de WhatsAppInstance permite achar a própria linha
 * por ele antes de conhecer o organizationId.
 *
 * `app.current_api_key_hash` é o mesmo tipo de bootstrap, só que pra
 * autenticação de integração externa (lib/require-api-key.ts): a requisição
 * só traz o hash da API key, e a policy de ApiKey permite achar a própria
 * linha por ele antes de conhecer o organizationId.
 *
 * `app.current_meta_page_id` é o mesmo tipo de bootstrap, só que pro webhook
 * de Lead Ads da Meta (lib/tenant-context.ts's runWithMetaPageLookup): a
 * requisição só traz o pageId, e a policy de MetaAdsConnection permite achar
 * a própria linha por ele antes de conhecer o organizationId.
 */
function withTenantRls(client: PrismaClient) {
  return client.$extends({
    name: "tenant-rls",
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const organizationId = getCurrentOrganizationId();
          const userId = getCurrentUserId();
          const instanceName = getCurrentInstanceName();
          const apiKeyHash = getCurrentApiKeyHash();
          const metaPageId = getCurrentMetaPageId();
          if (!organizationId && !userId && !instanceName && !apiKeyHash && !metaPageId) return query(args);

          // Importante: tem que ser a forma em array do $transaction, não
          // `$transaction(async (tx) => ...)`. Na forma de callback, `query(args)`
          // (a operação interceptada) NÃO roda dentro da transação de `tx` — ela
          // segue pela conexão normal do pool, então o `set_config(..., true)`
          // (escopado à transação) nunca chega a valer pra ela, e a RLS acaba
          // filtrando tudo silenciosamente (zero linhas, sem erro nenhum). A forma
          // em array agrupa todas as operações numa única transação/conexão real.
          //
          // As 5 chamadas set_config viram uma ÚNICA consulta (uma SELECT com 5
          // colunas, não 5 SELECTs) — banco é remoto (~40ms de ida-e-volta por
          // consulta), e cada uma dessas era uma ida-e-volta própria. Isso corta
          // de 7 idas-e-voltas por operação (BEGIN + 5 set_config + a consulta
          // de verdade + COMMIT) pra 4 (BEGIN + 1 set_config combinado + a
          // consulta + COMMIT) — em TODA operação do Prisma no app inteiro, não
          // só numa tela. Continua sendo uma única query parametrizada (sem
          // concatenar string à mão), só com várias chamadas de função no lugar
          // de várias declarações.
          //
          // maxWait/timeout acima do padrão (2s/5s) porque o Postgres é remoto e
          // uma conexão nova pode levar alguns segundos pra estabelecer — sem essa
          // folga, várias consultas em paralelo (ex.: a Home, que dispara ~9 de
          // uma vez) estouram o prazo padrão logo após o dev server reiniciar,
          // com o pool ainda frio.
          const [, result] = await client.$transaction(
            [
              client.$executeRaw`SELECT
                set_config('app.current_organization_id', ${organizationId ?? ""}, true),
                set_config('app.current_user_id', ${userId ?? ""}, true),
                set_config('app.current_instance_name', ${instanceName ?? ""}, true),
                set_config('app.current_api_key_hash', ${apiKeyHash ?? ""}, true),
                set_config('app.current_meta_page_id', ${metaPageId ?? ""}, true)`,
              query(args),
            ],
            { maxWait: 10_000, timeout: 15_000 },
          );
          return result;
        },
      },
    },
  });
}

type GlobalPrisma = {
  prismaRaw?: PrismaClient;
  prisma?: ReturnType<typeof withTenantRls>;
};

const globalForPrisma = globalThis as unknown as GlobalPrisma;

/**
 * Cliente sem a extensão de RLS. Use apenas dentro de
 * `prismaRaw.$transaction(async (tx) => ...)` quando for preciso atomicidade real
 * entre múltiplos passos — chame `setTenantOnTx(tx, organizationId)` (lib/tenant-context.ts)
 * como primeira linha. Nunca use `prismaRaw` fora de uma transação interativa: ele
 * não tem a proteção de RLS.
 */
export const prismaRaw = globalForPrisma.prismaRaw ?? createBaseClient();

export const prisma = globalForPrisma.prisma ?? withTenantRls(prismaRaw);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaRaw = prismaRaw;
  globalForPrisma.prisma = prisma;
}
