export const pushReminderEventKey = {
  quotaRegistration: (dealId: string) => `quota:${dealId}`,
  processRequest: (requestId: string) => `process-request:${requestId}`,
  documentResponse: (requestId: string) => `document-response:${requestId}`,
} as const;

export const pushReminderScopeKey = {
  deal: (dealId: string) => `deal:${dealId}`,
  process: (processId: string) => `process:${processId}`,
} as const;

/** Aceita somente os escopos que as telas do CRM sabem confirmar. */
export function isPushReminderScopeKey(value: unknown): value is string {
  return typeof value === "string" && /^(deal|process):[a-zA-Z0-9_-]{1,80}$/.test(value);
}
