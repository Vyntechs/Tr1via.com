// lib/email/send-code-email — the Zoho SMTP sender (nodemailer mocked).
//
// Proves: nothing is attempted without ZOHO_SMTP_PASSWORD; defaults are
// smtp.zoho.com:465 over SSL as support@vyntechs.com; the from name is
// TR1VIA; the email says "Your TR1VIA code: 123456" with the 10-minute
// line in both text and HTML; a failed send reports send_failed and never
// logs the code or the password.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: h.createTransport },
  createTransport: h.createTransport,
}));

import { codeEmailContent, sendCodeEmail } from "@/lib/email/send-code-email";

beforeEach(() => {
  vi.clearAllMocks();
  h.createTransport.mockReturnValue({ sendMail: h.sendMail, close: h.close });
  h.sendMail.mockResolvedValue({ messageId: "m1" });
  vi.stubEnv("ZOHO_SMTP_PASSWORD", "app-password-xyz");
  vi.stubEnv("ZOHO_SMTP_USER", "");
  vi.stubEnv("ZOHO_SMTP_HOST", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sendCodeEmail", () => {
  it("does nothing and says not_configured without the Zoho password", async () => {
    vi.stubEnv("ZOHO_SMTP_PASSWORD", "");
    expect(await sendCodeEmail("h@example.com", "123456")).toEqual({ ok: false, reason: "not_configured" });
    expect(h.createTransport).not.toHaveBeenCalled();
  });

  it("sends over SSL 465 via smtp.zoho.com as TR1VIA <support@vyntechs.com>", async () => {
    expect(await sendCodeEmail("h@example.com", "123456")).toEqual({ ok: true });
    expect(h.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.zoho.com",
        port: 465,
        secure: true,
        auth: { user: "support@vyntechs.com", pass: "app-password-xyz" },
      }),
    );
    const mail = h.sendMail.mock.calls[0][0];
    expect(mail.from).toEqual({ name: "TR1VIA", address: "support@vyntechs.com" });
    expect(mail.to).toBe("h@example.com");
    expect(mail.subject).toBe("Your TR1VIA code: 123456");
    expect(mail.text).toContain("123456");
    expect(mail.text).toContain("This code works for 10 minutes. If you didn't ask for it, ignore this email.");
    expect(mail.html).toContain("123456");
    expect(h.close).toHaveBeenCalled();
  });

  it("uses ZOHO_SMTP_HOST / ZOHO_SMTP_USER when set", async () => {
    vi.stubEnv("ZOHO_SMTP_HOST", "smtppro.zoho.com");
    vi.stubEnv("ZOHO_SMTP_USER", "hello@vyntechs.com");
    await sendCodeEmail("h@example.com", "123456");
    expect(h.createTransport.mock.calls[0][0]).toMatchObject({
      host: "smtppro.zoho.com",
      auth: { user: "hello@vyntechs.com" },
    });
    expect(h.sendMail.mock.calls[0][0].from).toEqual({ name: "TR1VIA", address: "hello@vyntechs.com" });
  });

  it("reports send_failed and never logs the code or the password", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.sendMail.mockRejectedValue(Object.assign(new Error("535 auth failed"), { code: "EAUTH", responseCode: 535 }));
    expect(await sendCodeEmail("h@example.com", "987654")).toEqual({ ok: false, reason: "send_failed" });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("987654");
    expect(logged).not.toContain("app-password-xyz");
    log.mockRestore();
  });
});

describe("codeEmailContent", () => {
  it("keeps the plain wording Brandon asked for", () => {
    const c = codeEmailContent("042519");
    expect(c.subject).toBe("Your TR1VIA code: 042519");
    expect(c.html).toContain("This code works for 10 minutes. If you didn't ask for it, ignore this email.");
  });
});
