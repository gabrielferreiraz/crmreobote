import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico: confirma que o SMTP configurado (SMTP_HOST/PORT/USER/PASSWORD
 * no .env) está funcionando de verdade, sem precisar esperar uma desconexão
 * de WhatsApp de verdade acontecer. Só OWNER pode disparar.
 */
export async function POST(req: Request) {
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const to = (body as { to?: string }).to || access.session.user.email;

  if (!to) return NextResponse.json({ error: "Informe um e-mail de destino" }, { status: 400 });

  const result = await sendEmail({
    to,
    subject: "Teste de e-mail — CRM Reobote",
    html: `<p>Se você está lendo isso, o envio de e-mail via SMTP (${process.env.SMTP_HOST ?? "não configurado"}) está funcionando.</p>`,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Falha ao enviar" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, to });
}
