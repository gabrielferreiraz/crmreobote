"use client";

/**
 * Planilha modelo pra importação de contatos — pedido explícito: "vamos
 * adicionar para baixar uma planilha MODELO". Gerada no próprio navegador
 * (nunca precisa ir ao servidor, é só um arquivo estático) com os
 * cabeçalhos EXATOS que o detector de coluna reconhece de cara (ver
 * FIELD_META em lib/contacts/import-resolve.ts — primeiro candidato de cada
 * campo), mais uma linha de exemplo pra mostrar o formato esperado.
 *
 * ; como separador (não ,) — mesma convenção já usada no resto do app pra
 * CSV (ver app/api/deals/import/[id]/errors/route.ts): no Excel em
 * português, "," é separador decimal, então um CSV separado por vírgula
 * abre tudo numa coluna só.
 */
const TEMPLATE_HEADERS = ["nome", "cargo", "email", "celular", "whatsapp", "origem", "empresa", "responsavel", "tags"];
const TEMPLATE_EXAMPLE_ROW = [
  "João da Silva",
  "Empresário",
  "joao@email.com",
  "67999998888",
  "67999998888",
  "Indicação",
  "Empresa Exemplo Ltda",
  "",
  "cliente vip",
];

export function downloadContactImportTemplate() {
  const lines = [TEMPLATE_HEADERS.join(";"), TEMPLATE_EXAMPLE_ROW.join(";")];
  // BOM no início — sem isso o Excel no Windows abre acento errado (lê como
  // Latin-1 em vez de UTF-8 sem esse aviso explícito no arquivo).
  // String.fromCharCode em vez do caractere literal no código-fonte —
  // invisível de propósito, fácil de virar bagunça de encoding no editor
  // (mesma convenção de app/api/deals/import/[id]/errors/route.ts).
  const csv = String.fromCharCode(0xfeff) + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "modelo-importacao-contatos.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
