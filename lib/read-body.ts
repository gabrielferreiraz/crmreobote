import { NextResponse } from "next/server";

/**
 * Leitura de corpo de requisição COM TETO (auditoria de 09/2026, P1).
 *
 * `req.formData()`, `req.json()` e `req.text()` leem o corpo INTEIRO pra
 * memória antes de qualquer checagem — e o Next não limita corpo de Route
 * Handler (o proxy.ts nem roda em /api). Um upload de 2 GB, ou um corpo sem
 * Content-Length (chunked) que nunca termina, esgotava a memória da VPS antes
 * de a rota ter chance de dizer "arquivo grande demais". Aqui o corpo é lido
 * em pedaços e a leitura é abortada assim que passa do teto.
 *
 * Duas camadas: Content-Length declarado acima do teto é recusado sem ler
 * nada; sem Content-Length (ou mentindo), conta os bytes que chegam de fato.
 *
 * Sempre chamar DEPOIS da autenticação: quem não está logado não deve nem
 * conseguir fazer o servidor ler um byte do corpo.
 */

export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Corpo da requisição maior que ${formatBytes(maxBytes)}`);
    this.name = "BodyTooLargeError";
  }
}

export class InvalidBodyError extends Error {
  constructor(message = "Corpo da requisição inválido") {
    super(message);
    this.name = "InvalidBodyError";
  }
}

/** Tetos de uso comum — o upload mais pesado aceito hoje é mídia de chat/planilha. */
export const BODY_LIMITS = {
  /** JSON de formulário/API comum. */
  json: 1 * 1024 * 1024,
  /** Webhook de terceiros (Evolution/Meta) — payload de mensagem, nunca a mídia em si. */
  webhook: 2 * 1024 * 1024,
  /** Imagem (avatar, TV, cartão digital): o próprio validador aceita até 10 MB + folga do multipart. */
  image: 11 * 1024 * 1024,
  /** Mídia do chat (áudio/imagem): mesmo raciocínio, teto do validador de mídia + folga. */
  chatMedia: 17 * 1024 * 1024,
  /** Planilha de importação — as rotas aceitam até 5 MB (MAX_FILE_SIZE) + folga do multipart. */
  spreadsheet: 6 * 1024 * 1024,
} as const;

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${Math.round(n / (1024 * 1024))} MB` : `${Math.round(n / 1024)} KB`;
}

export async function readBodyBytes(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);
  if (!req.body) return new Uint8Array(new ArrayBuffer(0));

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function readText(req: Request, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBodyBytes(req, maxBytes));
}

export async function readJson<T = unknown>(req: Request, maxBytes: number = BODY_LIMITS.json): Promise<T> {
  const text = await readText(req, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new InvalidBodyError("JSON inválido");
  }
}

export async function readFormData(req: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readBodyBytes(req, maxBytes);
  try {
    return await new Response(bytes, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    throw new InvalidBodyError("Envio de arquivo inválido");
  }
}

/** Resposta padrão pros dois erros acima (413/400); `null` = não é erro de corpo, quem chamou relança. */
export function bodyErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof BodyTooLargeError) {
    return NextResponse.json({ error: `Arquivo ou envio grande demais (máximo ${formatBytes(err.maxBytes)}).` }, { status: 413 });
  }
  if (err instanceof InvalidBodyError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return null;
}
