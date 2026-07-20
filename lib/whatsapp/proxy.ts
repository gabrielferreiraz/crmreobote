/**
 * Configuração de proxy por instância — só provider EVOLUTION (sessão
 * WhatsApp Web/Baileys; a Cloud API oficial da Meta não roda atrás de proxy
 * nosso). Nunca vem preenchido sozinho: IP de datacenter (onde a maioria
 * hospeda o Evolution API) é um sinal que a própria WhatsApp usa pra
 * identificar sessão automatizada — isso só deixa PRONTO pra usar assim que
 * a organização tiver um proxy residencial/móvel de verdade (serviço pago;
 * proxy "grátis" público é datacenter ou já malicioso, os dois piores tipos
 * possíveis pra essa finalidade — por isso não vem nada configurado por
 * padrão). Aplicado só na CRIAÇÃO da instância — trocar de proxy depois
 * exige desconectar e reconectar (mesma limitação de qualquer troca de rede
 * numa sessão Baileys já aberta).
 */

import { encryptSecret, decryptSecret } from "@/lib/security/secret-crypto";

const VALID_PROTOCOLS = ["http", "https", "socks5"] as const;
type ProxyProtocol = (typeof VALID_PROTOCOLS)[number];

export type ProxyInput = {
  host?: string;
  port?: number;
  protocol?: string;
  username?: string;
  password?: string;
};

export type StoredProxyFields = {
  proxyHost: string | null;
  proxyPort: number | null;
  proxyProtocol: string | null;
  proxyUsername: string | null;
  proxyPasswordEncrypted: string | null;
};

const EMPTY_PROXY: StoredProxyFields = {
  proxyHost: null,
  proxyPort: null,
  proxyProtocol: null,
  proxyUsername: null,
  proxyPasswordEncrypted: null,
};

export type ProxyValidationResult = { ok: true; data: StoredProxyFields } | { ok: false; error: string };

export function validateProxyInput(input: ProxyInput | undefined | null): ProxyValidationResult {
  if (!input || !input.host?.trim()) return { ok: true, data: EMPTY_PROXY }; // proxy é opcional

  const host = input.host.trim();
  const port = input.port;
  const protocol = (input.protocol ?? "http").toLowerCase();

  if (!port || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "Porta do proxy inválida" };
  }
  if (!VALID_PROTOCOLS.includes(protocol as ProxyProtocol)) {
    return { ok: false, error: `Protocolo do proxy inválido — use ${VALID_PROTOCOLS.join(", ")}` };
  }

  return {
    ok: true,
    data: {
      proxyHost: host,
      proxyPort: port,
      proxyProtocol: protocol,
      proxyUsername: input.username?.trim() || null,
      proxyPasswordEncrypted: input.password ? encryptSecret(input.password) : null,
    },
  };
}

export type EvolutionProxyConfig = {
  host: string;
  port: string;
  protocol: string;
  username?: string;
  password?: string;
};

/**
 * Monta o payload de proxy pro /instance/create do Evolution a partir do que
 * está gravado. Formato (proxyHost/proxyPort/proxyProtocol/proxyUsername/
 * proxyPassword flat na raiz do corpo) baseado na documentação pública do
 * Evolution API — não dá pra confirmar 100% sem testar contra a versão
 * exata implantada (ver nota em lib/evolution.ts); se o Evolution não
 * aplicar o proxy na prática, é o primeiro lugar a revisar.
 */
export function buildEvolutionProxyPayload(instance: StoredProxyFields): EvolutionProxyConfig | undefined {
  if (!instance.proxyHost || !instance.proxyPort || !instance.proxyProtocol) return undefined;
  return {
    host: instance.proxyHost,
    port: String(instance.proxyPort),
    protocol: instance.proxyProtocol,
    ...(instance.proxyUsername ? { username: instance.proxyUsername } : {}),
    ...(instance.proxyPasswordEncrypted ? { password: decryptSecret(instance.proxyPasswordEncrypted) } : {}),
  };
}
