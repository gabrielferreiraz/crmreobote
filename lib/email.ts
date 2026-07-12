/**
 * Envio de e-mail via SMTP comum (StayCloud — smtp.staydns.com, porta 465
 * SSL — mesma hospedagem já usada pela empresa, sem depender de um serviço
 * terceiro novo). Isolado neste arquivo de propósito, igual ao lib/evolution.ts:
 * se um dia trocar de provedor, o ajuste é só aqui.
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

export async function sendEmail(params: { to: string | string[]; subject: string; html: string }): Promise<void> {
  const fromEmail = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER;
  const fromName = process.env.SMTP_FROM_NAME ?? "CRM Reobote";

  try {
    await getTransporter().sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
  } catch (err) {
    // Nunca deixa uma falha de e-mail derrubar o fluxo principal que a
    // chamou (ex.: processar um evento de webhook) — só loga.
    console.error(`[email] falha ao enviar "${params.subject}" para ${params.to}`, err);
  }
}
