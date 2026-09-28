-- Renomeia o valor dos enums preservando todos os registros históricos.
-- O PostgreSQL mantém o valor interno do enum, então índices parciais e
-- referências existentes continuam apontando para as mesmas linhas.
ALTER TYPE "TaskType" RENAME VALUE 'MEETING' TO 'VIDEO_CALL';
ALTER TYPE "ActivityType" RENAME VALUE 'MEETING' TO 'VIDEO_CALL';
