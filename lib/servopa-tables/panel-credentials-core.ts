/**
 * Leitura/validação do acesso da Servopa a partir de variáveis de ambiente —
 * parte pura (sem `server-only`) para poder ser testada. Quem usa no servidor
 * é panel-credentials.ts.
 */

export type ServopaPanelCredentials = { user: string; password: string };

type Env = Record<string, string | undefined>;

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 100 || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

export function parseServopaPanelCredentials(env: Env): ServopaPanelCredentials | null {
  const user = clean(env.SERVOPA_USER);
  const password = clean(env.SERVOPA_PASS);
  return user && password ? { user, password } : null;
}
