/**
 * Tipos de ação desfazível (Ctrl+Z) — ver lib/undo/record.ts (gravar) e
 * lib/undo/handlers.ts (reverter). Cada type tem um payload próprio, ver
 * comentário de cada handler; a maioria passa por revertFieldUpdate
 * (genérico), só delete/bulkMove têm formato específico.
 */
export type UndoActionType =
  | "task.delete"
  | "task.update"
  | "task.bulkMove"
  | "contact.update"
  | "contact.delete"
  | "deal.update"
  | "deal.delete"
  | "deal.move";

/**
 * Par de descrições que se alterna pra sempre entre undo/redo — gênero e
 * tempo verbal em português não dá pra gerar de forma confiável de modo
 * genérico ("restaurada" vs "restaurado", por exemplo), então cada rota
 * que grava uma ação já escreve as DUAS frases prontas uma vez:
 * `afterRevert` é o que aparece no aviso assim que ESTA ação for desfeita;
 * `original` é o texto da própria ação (vira o `afterRevert` da PRÓXIMA
 * reversão, se a pessoa desfizer de novo). Cada handler devolve o par
 * invertido a cada passo, sem precisar recalcular texto nenhum.
 */
export type DescriptionPair = { afterRevert: string; original: string };

/**
 * Payload comum a todo type que passa pelo handler genérico de campo
 * (task.update, contact.update, deal.update, deal.move) — ver
 * lib/undo/handlers.ts's revertFieldUpdate. `entities` é uma LISTA, não um
 * único alvo, de propósito: uma ação do usuário pode mexer em mais de uma
 * linha ao mesmo tempo (ex.: reatribuir o dono de um negócio também
 * sincroniza Contact.responsavelId, ver app/api/deals/[id]/route.ts) e
 * precisa ser UMA ação desfazível só — desfazer o negócio sem desfazer o
 * contato junto reintroduziria a própria inconsistência que a
 * sincronização existe pra evitar. Pra edição de campo comum (a imensa
 * maioria dos casos), é só um array com 1 item.
 */
export type FieldUpdateTarget = {
  model: "task" | "contact" | "deal";
  entityId: string;
  previousValues: Record<string, unknown>;
};

export type FieldUpdatePayload = {
  entities: FieldUpdateTarget[];
  descriptions: DescriptionPair;
};

export type TaskBulkMovePayload = {
  moves: { taskId: string; previousDueAt: string }[];
  descriptions: DescriptionPair;
};

/** Payload de task.delete/contact.delete/deal.delete — snapshot completo da
 * linha (+ filhas em cascade, quando existirem) preservando o `id`
 * original, pra restaurar sem quebrar FK de quem referenciava aquela
 * linha. `T` é o shape scalar da linha (sem relações). */
export type DeleteSnapshotPayload<T extends { id: string } = Record<string, unknown> & { id: string }> = {
  snapshot: T;
  /** Linhas filhas apagadas em cascade junto (ex.: CampaignRecipient de um
   * Contact, Process de um Deal) — restauradas na mesma transação, na
   * mesma ordem que dependências FK exigem. */
  cascaded?: { model: "campaignRecipient" | "process"; rows: Record<string, unknown>[] }[];
  descriptions: DescriptionPair;
};
