/**
 * Variáveis disponíveis pra Assunto/Texto/Mensagem das automações — lista
 * "pura" (sem Prisma), importável tanto pelo componente de cliente
 * (components/variable-input.tsx, o seletor) quanto pelo motor no servidor
 * (lib/automations/engine.ts, a substituição de verdade). Os valores reais
 * são resolvidos em engine.ts::resolveTemplateValues, a partir da entidade
 * (negócio/contato/responsável) que disparou a regra.
 */
export type AutomationVariableGroup = {
  label: string;
  variables: { token: string; label: string }[];
};

export const AUTOMATION_VARIABLE_GROUPS: AutomationVariableGroup[] = [
  {
    label: "Negócio",
    variables: [
      { token: "negocio.nome", label: "Nome do negócio" },
      { token: "negocio.valor", label: "Valor do negócio" },
      { token: "negocio.etapa", label: "Etapa atual" },
      { token: "negocio.tipoCredito", label: "Tipo de crédito" },
      { token: "negocio.diasNaEtapa", label: "Dias na etapa atual" },
      { token: "negocio.diasAberto", label: "Dias desde a criação" },
    ],
  },
  {
    label: "Cliente",
    variables: [
      { token: "cliente.nome", label: "Nome do cliente" },
      { token: "cliente.cargo", label: "Cargo do cliente" },
      { token: "cliente.telefone", label: "Telefone do cliente" },
    ],
  },
  {
    label: "Responsável",
    variables: [{ token: "responsavel.nome", label: "Nome do responsável" }],
  },
];

/** Troca cada `{{token}}` conhecido pelo valor correspondente; token sem valor vira string vazia (nunca deixa chave crua sobrar numa mensagem de verdade). */
export function interpolateAutomationTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
}
