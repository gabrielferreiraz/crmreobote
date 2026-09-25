/**
 * O que de um usuário pode aparecer embutido (responsável/autor) numa resposta
 * de API ou numa página que serializa dados pro navegador: só o que a tela
 * precisa pra mostrar "quem" (nome + foto). Usar no lugar de `owner: true` /
 * `user: true` — que devolviam a linha inteira de User (e-mail, nascimento,
 * datas internas; e, antes de lib/prisma-omit.ts, o hash da senha).
 *
 * Achado A1 do relatório de QA (excesso de dados em POST /api/tasks). O hash
 * já é barrado globalmente por lib/prisma-omit.ts; isto é a segunda camada:
 * um colega não precisa receber o e-mail e a data de nascimento de quem é
 * dono de uma tarefa só porque abriu a lista.
 */
export const USER_PUBLIC_SELECT = { id: true, name: true, image: true } as const;
