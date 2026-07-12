/**
 * Envio de e-mail via SMTP comum (StayCloud, mail.reoboteconsorcios.com.br —
 * mesma hospedagem já usada pela empresa pros e-mails de verdade, sem
 * depender de um serviço terceiro novo). Isolado neste arquivo de propósito,
 * igual ao lib/evolution.ts: se um dia trocar de provedor, o ajuste é só aqui.
 *
 * NUNCA importar este módulo em código que roda no cliente — lê credenciais
 * do ambiente do servidor.
 */

import nodemailer from "nodemailer";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 465);
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;

  if (!host || !user || !password) {
    throw new Error("SMTP não configurado (SMTP_HOST/SMTP_USER/SMTP_PASSWORD ausentes)");
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: password },
  });
  return transporter;
}

/**
 * Nunca lança exceção — nunca pode derrubar o fluxo principal que chamou
 * isso (ex.: processar um evento de webhook). Devolve `{ ok, error }` em vez
 * de void pra quem precisa saber se realmente funcionou (ex.: uma rota de
 * teste), sem obrigar os outros chamadores a tratar isso.
 */
export async function sendEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  const fromEmail = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER;
  const fromName = process.env.SMTP_FROM_NAME ?? "CRM Reobote";

  try {
    await getTransporter().sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email] falha ao enviar "${params.subject}" para ${params.to}`, err);
    return { ok: false, error: message };
  }
}
