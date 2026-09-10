-- Achado investigando "new row violates row-level security policy for
-- table TvDisplayLink" nos logs do banco (o fire-and-forget que grava
-- lastUsedAt em lib/require-tv-link.ts) — a policy de bootstrap de
-- TvDisplayLink (e a de ApiKey, exatamente o mesmo padrão, mesmo bug) tem
-- USING com o fallback por hash (SELECT acha a própria linha sem
-- organizationId definido, é assim que a autenticação "descobre" a
-- organização a partir só do token), mas o WITH CHECK (usado no UPDATE)
-- só aceita organizationId = app.current_organization_id — que nunca está
-- definido nesse fluxo (só app.current_tv_link_token_hash /
-- app.current_api_key_hash, ver runWithTvLinkLookup/runWithApiKeyLookup em
-- lib/tenant-context.ts). Todo UPDATE de "lastUsedAt" batia nesse WITH
-- CHECK e falhava — silencioso pro usuário (.catch(() => {}) em
-- lib/require-tv-link.ts e lib/require-api-key.ts), mas o "último uso" na
-- UI de gestão (Configurações → TV/Integrações) nunca atualizava de
-- verdade, e o banco loga o erro a cada tentativa (a cada ~15s por TV
-- ligada, a cada chamada de API externa).
ALTER POLICY tenant_isolation ON "TvDisplayLink"
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "tokenHash" = current_setting('app.current_tv_link_token_hash', true)
  );

ALTER POLICY tenant_isolation ON "ApiKey"
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "keyHash" = current_setting('app.current_api_key_hash', true)
  );
