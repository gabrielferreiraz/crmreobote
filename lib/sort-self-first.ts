/**
 * Reordena uma lista de membros pra o usuário atual vir sempre primeiro —
 * usado em todo filtro de "Responsável" (Pipeline, Clientes, Relatórios,
 * Conversas) pra achar a si mesmo na hora, sem procurar o próprio nome no
 * meio da lista. Quem chama decide o rótulo (normalmente "Eu"); esta função
 * só cuida da ordem.
 */
export function sortSelfFirst<T extends { id: string }>(members: T[], currentUserId: string | undefined | null): T[] {
  if (!currentUserId) return members;
  const selfIndex = members.findIndex((m) => m.id === currentUserId);
  if (selfIndex <= 0) return members;
  const copy = members.slice();
  const [self] = copy.splice(selfIndex, 1);
  copy.unshift(self);
  return copy;
}
