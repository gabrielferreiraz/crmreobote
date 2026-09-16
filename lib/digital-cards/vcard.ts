import { slugify } from "@/lib/digital-cards/slug";

/**
 * Gera o vCard (.vcf) do cartão — texto puro, sem lib nenhuma (o formato é
 * simples o bastante): baixado dinamicamente a cada clique em "Salvar
 * Contato" (ver app/api/public/cards/[slug]/vcard/route.ts), nunca
 * armazenado em arquivo por usuário.
 */

// vCard usa \r\n como quebra de linha e exige escapar vírgula/ponto-e-vírgula/
// barra invertida dentro de cada valor — sem isso, um nome com vírgula (raro,
// mas possível) ou um endereço com ";" quebraria a leitura do arquivo no
// app de Contatos.
function escapeVCardValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export type VCardInput = {
  name: string;
  jobTitle?: string | null;
  companyName?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  publicUrl: string;
};

export function buildVCard(input: VCardInput): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${escapeVCardValue(input.name)}`, `N:${escapeVCardValue(input.name)};;;;`];

  if (input.jobTitle) lines.push(`TITLE:${escapeVCardValue(input.jobTitle)}`);
  if (input.companyName) lines.push(`ORG:${escapeVCardValue(input.companyName)}`);
  if (input.phone) lines.push(`TEL;TYPE=WORK,VOICE:${escapeVCardValue(input.phone)}`);
  // WhatsApp não tem um TYPE padrão em vCard — CELL é o mais próximo (a
  // maioria dos apps de Contatos do celular reconhece como "celular", que é
  // exatamente o que um número de WhatsApp brasileiro é na prática).
  if (input.whatsapp && input.whatsapp !== input.phone) lines.push(`TEL;TYPE=CELL:${escapeVCardValue(input.whatsapp)}`);
  if (input.email) lines.push(`EMAIL:${escapeVCardValue(input.email)}`);
  if (input.address) lines.push(`ADR;TYPE=WORK:;;${escapeVCardValue(input.address)};;;;`);
  lines.push(`URL:${escapeVCardValue(input.publicUrl)}`);
  lines.push("END:VCARD");

  return lines.join("\r\n");
}

/** Nome de arquivo amigável pro download — "Marcelo Souza" -> "marcelo-souza.vcf". */
export function vCardFileName(name: string): string {
  return `${slugify(name) || "contato"}.vcf`;
}
