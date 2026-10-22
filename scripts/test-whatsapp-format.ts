/**
 * Horários do WhatsApp (lib/whatsapp/format-time.ts) e busca da lista de
 * Conversas (use-conversations-list.ts) — puro, sem banco:
 *
 *   npx tsx --test scripts/test-whatsapp-format.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatDayKey, formatChatClock, formatChatDayDivider, formatChatListTime, formatLastSeen } from "@/lib/whatsapp/format-time";
import { matchesConversationSearch, type Conversation } from "@/app/(dashboard)/whatsapp/conversas/use-conversations-list";
import { messagePreview } from "@/lib/whatsapp/message-preview";
import { renderSamplePreview, stepDelayLabel } from "@/lib/campaigns/spintax";

// Quarta-feira, 21/10/2026, 15:00 em Campo Grande (UTC-4) = 19:00 UTC.
const NOW = new Date("2026-10-21T19:00:00Z");
const at = (iso: string) => new Date(iso);

test("dia é o de Campo Grande, não o do aparelho: 23h30 local ainda é o mesmo dia", () => {
  // 21/10 23:30 em Campo Grande = 22/10 03:30 UTC.
  assert.equal(chatDayKey(at("2026-10-22T03:30:00Z")), "2026-10-21");
  assert.equal(formatChatClock(at("2026-10-22T03:30:00Z")), "23:30");
});

test("lista: hora hoje, 'Ontem', dia da semana até 6 dias, depois a data", () => {
  assert.equal(formatChatListTime(at("2026-10-21T13:05:00Z"), NOW), "09:05");
  assert.equal(formatChatListTime(at("2026-10-20T13:05:00Z"), NOW), "Ontem");
  assert.equal(formatChatListTime(at("2026-10-18T13:05:00Z"), NOW), "Domingo");
  assert.equal(formatChatListTime(at("2026-10-10T13:05:00Z"), NOW), "10/10/2026");
});

test("divisor do chat: 'Hoje', 'Ontem', dia da semana, depois a data por extenso", () => {
  assert.equal(formatChatDayDivider(at("2026-10-21T13:05:00Z"), NOW), "Hoje");
  assert.equal(formatChatDayDivider(at("2026-10-20T13:05:00Z"), NOW), "Ontem");
  assert.equal(formatChatDayDivider(at("2026-10-16T13:05:00Z"), NOW), "Sexta-feira");
  assert.equal(formatChatDayDivider(at("2026-10-01T13:05:00Z"), NOW), "1 de outubro de 2026");
});

test("'visto por último' diz o dia (antes era só a hora)", () => {
  assert.equal(formatLastSeen(at("2026-10-21T18:00:00Z"), NOW), "hoje às 14:00");
  assert.equal(formatLastSeen(at("2026-10-20T18:00:00Z"), NOW), "ontem às 14:00");
  assert.equal(formatLastSeen(at("2026-10-18T18:00:00Z"), NOW), "em 18/10 às 14:00");
});

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  threadId: "t",
  contactId: "c",
  displayName: "João da Conceição",
  phoneNormalized: "5567991234567",
  whatsappName: null,
  lastMessagePreview: "",
  lastMessageDirection: "INBOUND",
  lastMessageFrom: null,
  lastMessageAt: NOW,
  unreadCount: 0,
  deal: { id: "d", name: "Imóvel Campo Grande" },
  ownerId: "u",
  ownerName: "Fulano",
  senderIds: [],
  profilePicUrl: null,
  ...over,
});

test("busca ignora acento e maiúscula", () => {
  assert.ok(matchesConversationSearch(conv(), "joao"));
  assert.ok(matchesConversationSearch(conv(), "CONCEICAO"));
  assert.ok(matchesConversationSearch(conv(), "imovel"));
  assert.ok(!matchesConversationSearch(conv(), "maria"));
});

test("busca por telefone aceita o número formatado", () => {
  assert.ok(matchesConversationSearch(conv(), "(67) 99123-4567"));
  assert.ok(matchesConversationSearch(conv(), "99123"));
  assert.ok(!matchesConversationSearch(conv(), "(11) 98888"));
});

test("busca vazia mostra tudo", () => {
  assert.ok(matchesConversationSearch(conv(), "   "));
});

test("prévia de mensagem: texto ganha; sem texto, rótulo do tipo; senão o fallback", () => {
  assert.equal(messagePreview("oi", "IMAGE", "—"), "oi");
  assert.equal(messagePreview(null, "IMAGE", "—"), "📷 Imagem");
  assert.equal(messagePreview("", "PIX", "—"), "💰 Pix");
  assert.equal(messagePreview(null, "TEXT", "Nova mensagem"), "Nova mensagem");
  assert.equal(messagePreview(null, null, "Mensagem"), "Mensagem");
});

test("prévia de script usa o mesmo contato de exemplo em todas as telas", () => {
  assert.equal(renderSamplePreview("Oi {primeiro_nome}, de {cidade}? Sou {consultor}."), "Oi Maria, de Campo Grande? Sou Ana.");
  assert.equal(renderSamplePreview("{saudacao}! {desconhecida}"), "Boa tarde! Maria");
  assert.equal(stepDelayLabel(30), "30s depois");
  assert.equal(stepDelayLabel(120), "2 min depois");
});
