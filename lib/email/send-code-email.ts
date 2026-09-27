// Sends the 6-digit TR1VIA sign-in code by email, in-house, over SMTP
// through Brandon's Zoho Mail (vyntechs.com — SPF/DKIM/DMARC live on Zoho).
//
// Env (server only, read from process.env; see .env.example):
//   ZOHO_SMTP_PASSWORD  the Zoho app password — required; without it we
//                       don't try to send and the host is told to text Brandon
//   ZOHO_SMTP_USER      mailbox to send as (default support@vyntechs.com)
//   ZOHO_SMTP_HOST      default smtppro.zoho.com — Zoho's server for paid
//                       organization (custom-domain) accounts. A FREE Zoho
//                       organization uses smtp.zoho.com instead.
//   Port 465 with SSL.
//
// Route handlers must `await` this before responding: Vercel pauses a
// function once its response is sent, so a send left running may never go.

import "server-only";
import nodemailer from "nodemailer";

export const DEFAULT_SMTP_HOST = "smtppro.zoho.com";
export const DEFAULT_SMTP_USER = "support@vyntechs.com";
export const SMTP_PORT = 465;

export interface SmtpConfig {
  host: string;
  user: string;
  password: string;
}

export function smtpConfigFromEnv(): SmtpConfig | null {
  const password = process.env.ZOHO_SMTP_PASSWORD;
  if (!password) return null;
  return {
    host: process.env.ZOHO_SMTP_HOST || DEFAULT_SMTP_HOST,
    user: process.env.ZOHO_SMTP_USER || DEFAULT_SMTP_USER,
    password,
  };
}

export function codeEmailContent(code: string): { subject: string; text: string; html: string } {
  const subject = `Your TR1VIA code: ${code}`;
  const text = [
    "Here's your TR1VIA code:",
    "",
    `    ${code}`,
    "",
    "Type it on the TR1VIA sign-in page.",
    "",
    "This code works for 10 minutes. If you didn't ask for it, ignore this email.",
    "",
    "— TR1VIA",
  ].join("\n");
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f4ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px 28px;">
      <div style="font-size:14px;font-weight:700;letter-spacing:0.12em;">TR1VIA</div>
      <p style="margin:24px 0 8px;font-size:18px;line-height:1.5;">Here's your TR1VIA code:</p>
      <div style="margin:8px 0 20px;font-size:40px;font-weight:800;letter-spacing:0.18em;font-family:Menlo,Consolas,monospace;">${code}</div>
      <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">Type it on the TR1VIA sign-in page.</p>
      <p style="margin:0;font-size:14px;line-height:1.5;color:#555555;">This code works for 10 minutes. If you didn't ask for it, ignore this email.</p>
    </div>
  </body>
</html>`;
  return { subject, text, html };
}

export type SendResult = { ok: true } | { ok: false; reason: "not_configured" | "send_failed" };

export async function sendCodeEmail(to: string, code: string): Promise<SendResult> {
  const config = smtpConfigFromEnv();
  if (!config) return { ok: false, reason: "not_configured" };
  const transport = nodemailer.createTransport({
    host: config.host,
    port: SMTP_PORT,
    secure: true,
    auth: { user: config.user, pass: config.password },
    // Keep a stuck mail server from holding the sign-in page for long.
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 10_000,
  });
  const { subject, text, html } = codeEmailContent(code);
  try {
    await transport.sendMail({
      // Zoho only relays mail from the signed-in mailbox (or its aliases).
      from: { name: "TR1VIA", address: config.user },
      to,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (err) {
    // Log what went wrong, never the code or the password.
    const e = err as { code?: string; responseCode?: number; message?: string };
    console.error("[email-code] send failed", {
      host: config.host,
      code: e?.code,
      responseCode: e?.responseCode,
    });
    return { ok: false, reason: "send_failed" };
  } finally {
    transport.close();
  }
}
