import { promises as dns } from "node:dns";

/**
 * Confere se a URL de um webhook é segura pro SERVIDOR buscar — só Dono/
 * Gerente cadastra webhooks, mas quem faz o fetch de verdade é o motor de
 * entrega (lib/webhooks/engine.ts), então uma URL apontando pra rede interna
 * (ou pro endpoint de metadados da nuvem, 169.254.169.254) vira um SSRF a
 * partir do próprio servidor. Resolve o host e rejeita qualquer IP em faixa
 * privada/loopback/link-local — chamada tanto na criação (validação) quanto
 * de novo na entrega (defesa contra DNS rebinding: domínio podia resolver
 * pra IP público no cadastro e pra um IP interno depois).
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

export async function isUrlSafeToFetch(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.hostname.toLowerCase() === "localhost") return false;

  let addresses: string[];
  try {
    const results = await dns.lookup(url.hostname, { all: true, verbatim: true });
    addresses = results.map((r) => r.address);
  } catch {
    return false; // não resolveu: trata como inseguro
  }
  if (addresses.length === 0) return false;

  return addresses.every((address) => !isPrivateAddress(address));
}
