import { promises as dns } from "node:dns";
import http from "node:http";
import https from "node:https";

/**
 * Confere se a URL de um webhook é segura pro SERVIDOR buscar — só Dono/
 * Gerente cadastra webhooks, mas quem faz o fetch de verdade é o motor de
 * entrega (lib/webhooks/engine.ts), então uma URL apontando pra rede interna
 * (ou pro endpoint de metadados da nuvem, 169.254.169.254) vira um SSRF a
 * partir do próprio servidor. Resolve o host e rejeita qualquer IP em faixa
 * privada/loopback/link-local.
 *
 * `resolveSafeAddress`/`safeFetchJson` (usados na ENTREGA, não só no
 * cadastro) fecham um problema que uma validação "resolve e depois faz
 * fetch()" sozinha não fecha: são duas consultas DNS separadas — um domínio
 * controlado pelo atacante pode responder IP público na 1ª (validação) e IP
 * interno na 2ª (a que o fetch faria na hora de conectar de verdade),
 * escolhendo a resposta certa pra cada consulta (DNS rebinding). A defesa
 * de verdade é resolver UMA vez só e FIXAR esse IP na conexão de rede —
 * nunca deixar a camada de transporte resolver o hostname de novo.
 */

const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8], // "esta" rede
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (inclui metadados de nuvem: 169.254.169.254)
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservado
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8) + n;
  }
  return result >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return true; // não parseou: trata como inseguro
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const baseInt = ipv4ToInt(base)!;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipInt & mask) === (baseInt & mask);
  });
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" || // loopback
    normalized === "::" || // unspecified
    normalized.startsWith("::ffff:") || // IPv4-mapped — a parte v4 já foi coberta acima quando dns retorna family 4
    normalized.startsWith("fe80:") || // link-local
    normalized.startsWith("fc") || // unique local fc00::/7
    normalized.startsWith("fd")
  );
}

function isPrivateAddress(address: string): boolean {
  return address.includes(":") ? isPrivateIPv6(address) : isPrivateIPv4(address);
}

type SafeAddress = { hostname: string; address: string; family: number };

async function resolveSafeAddress(rawUrl: string): Promise<SafeAddress | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname.toLowerCase() === "localhost") return null;

  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    return null; // não resolveu: trata como inseguro
  }
  if (addresses.length === 0) return null;
  if (addresses.some((a) => isPrivateAddress(a.address))) return null;

  return { hostname: url.hostname, address: addresses[0].address, family: addresses[0].family };
}

/** Usado só na validação de cadastro (POST /api/webhook-subscriptions) — não
 * faz nenhum fetch de verdade, então o TOCTOU de rebinding não se aplica
 * aqui (é a ENTREGA, via safeFetchJson, que precisa do IP fixado). */
export async function isUrlSafeToFetch(rawUrl: string): Promise<boolean> {
  return (await resolveSafeAddress(rawUrl)) !== null;
}

/** URL deixou de ser segura entre o cadastro e a entrega (ou nunca foi) —
 * falha permanente (não entra no backoff de retry, ver engine.ts): a URL em
 * si é que está errada, tentar de novo não muda isso. */
export class UnsafeWebhookUrlError extends Error {}

export type SafeFetchResult = { ok: boolean; status: number; body: string };

/**
 * POST JSON num destino externo com o IP fixado no que `resolveSafeAddress`
 * validou — a conexão de rede de verdade usa exatamente esse IP (via a
 * opção `lookup`, que substitui a resolução DNS que `http`/`https`
 * fariam sozinhos na hora de conectar), nunca resolve o hostname de novo.
 * `host`/`servername`/header `Host` continuam o hostname de verdade, então
 * SNI e verificação de certificado (HTTPS) seguem funcionando normalmente.
 *
 * Redirecionamento nunca é seguido (é só como `http`/`https` cru já se
 * comportam — um 3xx volta como resposta normal, não persegue o Location)
 * — um servidor malicioso devolver "302 Location: http://169.254.169.254/"
 * seria um jeito ainda mais fácil de contornar a validação do que o
 * rebinding, se algo aqui seguisse redirecionamento automaticamente.
 */
export async function safeFetchJson(
  rawUrl: string,
  init: { headers: Record<string, string>; body: string; timeoutMs: number },
): Promise<SafeFetchResult> {
  const resolved = await resolveSafeAddress(rawUrl);
  if (!resolved) throw new UnsafeWebhookUrlError("URL de destino não é mais um host público válido");

  const url = new URL(rawUrl);
  const isHttps = url.protocol === "https:";
  const requestFn = isHttps ? https.request : http.request;

  return new Promise<SafeFetchResult>((resolvePromise, reject) => {
    let settled = false;

    const req = requestFn(
      {
        // `host` já é o IP literal validado — net.connect/tls.connect
        // reconhecem isso (net.isIP()) e pulam a resolução DNS por completo,
        // não têm hostname nenhum pra resolver de novo. `servername` (SNI +
        // verificação de certificado) e o header `Host` continuam com o
        // hostname de verdade, então HTTPS e virtual hosting seguem
        // funcionando normalmente do lado do destino.
        host: resolved.address,
        servername: isHttps ? url.hostname : undefined,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...init.headers, Host: url.hostname },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const status = res.statusCode ?? 0;
          resolvePromise({ ok: status >= 200 && status < 300, status, body: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
      },
    );

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy(new Error("Tempo esgotado ao entregar webhook"));
      reject(new Error("Tempo esgotado ao entregar webhook"));
    }, init.timeoutMs);
    timer.unref?.();

    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    req.write(init.body);
    req.end();
  });
}
