import { z } from "zod";

/**
 * Validação de payload das rotas /api/v1/* (integração externa — Make/
 * Zapier/geradores de lead, ver lib/require-api-key.ts). Diferente das rotas
 * internas (usadas só pelo próprio front-end deste CRM, onde o formato do
 * payload é controlado por nós), estas recebem JSON de sistemas fora do
 * nosso controle — daí a validação de schema em vez de só `typeof` pontual.
 * Os limites de tamanho abaixo são generosos de propósito (não é regra de
 * negócio, é só um teto contra abuso/payload gigante) — nunca mais restritivo
 * que os campos correspondentes já aceitam nas telas internas do CRM.
 */

const shortText = (max = 255) => z.string().trim().max(max).optional();

export const adAttributionSchema = z
  .object({
    campaignId: shortText(),
    campaignName: shortText(),
    adId: shortText(),
    adSetId: shortText(),
    formId: shortText(),
  })
  .partial();

/**
 * Todos os campos são opcionais aqui — quem decide se `name` é obrigatório é
 * upsertContactFromIntegration (só quando não há duplicata pra atualizar), a
 * mesma regra usada antes desta validação existir.
 */
export const contactInputSchema = z
  .object({
    name: z.string().trim().max(200).optional(),
    email: z.string().trim().max(254).optional(),
    phone: z.string().trim().max(30).optional(),
    whatsapp: z.string().trim().max(30).optional(),
    source: shortText(),
    company: shortText(),
    jobTitle: shortText(),
    address: shortText(),
    addressNumber: shortText(50),
    addressComplement: shortText(),
    neighborhood: shortText(),
    city: shortText(),
    state: shortText(50),
    zipCode: shortText(20),
    ownerId: z.string().trim().max(100).optional(),
    tags: z.array(z.string().trim().max(50)).max(50).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    adAttribution: adAttributionSchema.optional(),
  })
  .passthrough(); // campos extras desconhecidos são ignorados a jusante (ver upsertContactFromIntegration), não rejeitados aqui

export const bulkContactsSchema = z.object({
  contacts: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
});

export const dealInputSchema = z
  .object({
    contactId: z.string().trim().min(1).max(100).optional(),
    contact: contactInputSchema.optional(),
    pipelineId: z.string().trim().min(1).max(100).optional(),
    stageId: z.string().trim().min(1).max(100).optional(),
    ownerId: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().max(200).optional(),
    value: z.number().finite().optional(),
    creditType: shortText(),
    description: z.string().trim().max(5000).optional(),
    source: shortText(),
  })
  .refine((data) => !!data.contactId || !!data.contact, {
    message: "Envie 'contactId' (contato existente) ou 'contact' (dados pra criar/atualizar)",
  });

/**
 * POST /api/v1/appointments — agendamento de reunião (ver
 * lib/scheduling/meeting-availability.ts pra grade/cascata de horários).
 * `date`/`time` são revalidados no servidor contra a grade de verdade
 * (nunca confiar que o que o cliente mandou como "disponível" ainda está
 * livre — ver o endpoint).
 */
export const appointmentInputSchema = z
  .object({
    consultorId: z.string().trim().min(1).max(100),
    date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "date precisa estar no formato YYYY-MM-DD"),
    time: z.string().trim().regex(/^\d{2}:\d{2}$/, "time precisa estar no formato HH:MM"),
    contactId: z.string().trim().min(1).max(100).optional(),
    contact: contactInputSchema.optional(),
    dealId: z.string().trim().min(1).max(100).optional(),
  })
  .refine((data) => !!data.contactId || !!data.contact, {
    message: "Envie 'contactId' (contato existente) ou 'contact' (dados pra criar/atualizar)",
  });

/** Formata o primeiro erro do Zod numa mensagem curta, no mesmo estilo das mensagens de apiError já usadas nessas rotas. */
export function firstZodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Corpo da requisição inválido";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
