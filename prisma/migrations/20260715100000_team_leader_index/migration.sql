-- getDealScope (lib/team-scope.ts) consulta Team por (organizationId, leaderId)
-- pra saber se um ADMIN lidera uma equipe. Agora passa a rodar em toda
-- requisição de API de negócios/tarefas (não só em carregamento de página),
-- então precisa de índice composto, não só o de organizationId sozinho.
CREATE INDEX "Team_organizationId_leaderId_idx" ON "Team"("organizationId", "leaderId");
