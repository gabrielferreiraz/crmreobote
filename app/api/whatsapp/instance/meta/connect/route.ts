import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  subscribeAppToWaba,
  registerPhoneNumber,
  getPhoneNumberHealth,
  MetaApiError,
} from "@/lib/meta-whatsapp";
import { encryptSecret } from "@/lib/security/secret-crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const instance = await prisma.whatsAppInstance.findFirst({
      where: { organizationId, userId, provider: "META_CLOUD" },
    });
    if (!instance) return NextResponse.json({ connected: false, status: "DISCONNECTED", phoneNumber: null });

    return NextResponse.json({
      connected: instance.status === "CONNECTED",
      status: instance.status,
      phoneNumber: instance.phoneNumber,
      tokenExpiresAt: instance.metaTokenExpiresAt,
    });
  });
}

/**
 * Recebe o resultado do Embedded Signup (ver components/whatsapp-connect.tsx)
 * e completa a conexão do lado do servidor — troca o code por token, assina
 * o app na WABA (senão nenhuma mensagem chega no webhook), tenta registrar o
 * número, e grava a linha de WhatsAppInstance (provider META_CLOUD).
 * "code" nunca é reaproveitável — se essa troca falhar, a única saída é
 * refazer o Embedded Signup do zero (não tem como tentar de novo com o
 * mesmo code).
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { code, phoneNumberId, wabaId } = body as { code?: string; phoneNumberId?: string; wabaId?: string };

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (!code || !phoneNumberId || !wabaId) {
    return NextResponse.json({ error: "Retorno do Embedded Signup incompleto" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    let longLivedToken: string;
    let expiresInSec: number | undefined;
    try {
      const shortLivedToken = await exchangeCodeForToken(code);
      const exchanged = await exchangeForLongLivedToken(shortLivedToken);
      longLivedToken = exchanged.accessToken;
      expiresInSec = exchanged.expiresInSec;
    } catch (err) {
      console.error("[wa:meta-connect] falha ao trocar code por token", err);
      const message = err instanceof MetaApiError ? err.message : "Falha ao validar a conexão com a Meta";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    try {
      await subscribeAppToWaba(wabaId, longLivedToken);
    } catch (err) {
      console.error("[wa:meta-connect] falha ao assinar o app na WABA — mensagens não vão chegar no webhook", err);
      return NextResponse.json(
        { error: "Conectou, mas não foi possível ativar o recebimento de mensagens. Tente reconectar." },
        { status: 502 },
      );
    }

    // Best-effort — o Embedded Signup normalmente já deixa o número
    // registrado sozinho; ver comentário em lib/meta-whatsapp.ts.
    const pin = randomInt(100_000, 999_999).toString();
    await registerPhoneNumber(phoneNumberId, longLivedToken, pin);

    let displayPhoneNumber: string | null = null;
    try {
      const health = await getPhoneNumberHealth(phoneNumberId, longLivedToken);
      displayPhoneNumber = health.displayPhoneNumber ?? null;
    } catch (err) {
      console.error("[wa:meta-connect] falha ao consultar dados do número (não bloqueia a conexão)", err);
    }

    const encryptedToken = encryptSecret(longLivedToken);
    const metaTokenExpiresAt = expiresInSec ? new Date(Date.now() + expiresInSec * 1000) : null;
    // instanceName sintético só pra reaproveitar o mesmo mecanismo de
    // bootstrap de RLS do webhook do Evolution (ver 20260710153000_whatsapp_instance_bootstrap_policy) —
    // nunca usado como identificador de verdade fora disso.
    const instanceName = `meta-${phoneNumberId}`;

    try {
      const existing = await prisma.whatsAppInstance.findFirst({
        where: { organizationId, userId, provider: "META_CLOUD" },
      });

      const data = {
        instanceName,
        phoneNumber: displayPhoneNumber,
        status: "CONNECTED" as const,
        metaAccessToken: encryptedToken,
        metaPhoneNumberId: phoneNumberId,
        metaWabaId: wabaId,
        metaTokenExpiresAt,
        disconnectedAt: null,
        disconnectAlertLevel: 0,
        pendingDisconnectSince: null,
      };

      if (existing) {
        await prisma.whatsAppInstance.update({ where: { id: existing.id }, data });
      } else {
        await prisma.whatsAppInstance.create({
          data: { organizationId, userId, provider: "META_CLOUD", ...data },
        });
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json(
          { error: "Este número já está conectado em outra conta deste CRM." },
          { status: 409 },
        );
      }
      throw err;
    }

    return NextResponse.json({ ok: true, phoneNumber: displayPhoneNumber });
  });
}

/**
 * Desconecta o número META_CLOUD deste usuário — diferente do DELETE do
 * Evolution (que faz logout/apaga a instância num gateway externo), aqui só
 * apaga a linha local: a Meta não tem um "logout" de sessão pra desfazer (o
 * número continua existindo do lado dela até alguém removê-lo manualmente
 * no Business Manager), então a única coisa que de fato precisa acontecer
 * pra este CRM parar de usar essa conexão é apagar a credencial local.
 */
export async function DELETE() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const instance = await prisma.whatsAppInstance.findFirst({
      where: { organizationId, userId, provider: "META_CLOUD" },
    });
    if (!instance) return NextResponse.json({ ok: true });

    await prisma.whatsAppInstance.delete({ where: { id: instance.id } });
    return NextResponse.json({ ok: true });
  });
}
