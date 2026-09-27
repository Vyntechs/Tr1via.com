// Route tests — the email-first sign-in steps with emailed codes.
//   POST /api/auth/start        email → "password" | "code" (sends) | "signup"
//   POST /api/auth/send-code    new code / Forgot password? / new-account code
//   POST /api/auth/verify-code  code → session (generateLink → verifyOtp)
//   POST /api/auth/host-access  sign-up, only with a correct "signup" code
//
// Supabase + SMTP are mocked; codes live in an in-memory store and are read
// back out of the (mocked) email, exactly as a host would.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { memoryCodeStore } from "./helpers/memory-code-store";

type SetAll = (c: Array<{ name: string; value: string; options?: object }>) => void;

const h = vi.hoisted(() => ({
  listUsers: vi.fn(),
  generateLink: vi.fn(),
  createUser: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  sendMail: vi.fn(),
  setAll: null as null | SetAll,
  store: null as unknown,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: SetAll } }) => {
    h.setAll = opts.cookies.setAll;
    return { auth: { verifyOtp: h.verifyOtp, signInWithPassword: h.signInWithPassword } };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { listUsers: h.listUsers, generateLink: h.generateLink, createUser: h.createUser } },
  }),
}));
vi.mock("@/lib/auth/email-code-store", () => ({
  supabaseCodeStore: () => h.store,
}));
vi.mock("nodemailer", () => {
  const createTransport = () => ({ sendMail: h.sendMail, close: () => {} });
  return { default: { createTransport }, createTransport };
});

import { POST as start } from "@/app/api/auth/start/route";
import { POST as sendCode } from "@/app/api/auth/send-code/route";
import { POST as verify } from "@/app/api/auth/verify-code/route";
import { POST as signUp } from "@/app/api/auth/host-access/route";

type Store = ReturnType<typeof memoryCodeStore>;
const store = () => h.store as Store;

const req = (path: string, body: unknown) =>
  new NextRequest(`http://test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const MARKED = { password_set_at: new Date(Date.UTC(2026, 8, 1)).toISOString() };

function users(...list: Array<{ id: string; email: string; app_metadata?: object }>) {
  h.listUsers.mockImplementation(async ({ page }: { page: number }) => ({
    data: { users: page === 1 ? list : [] },
    error: null,
  }));
}

/** The code from the most recent email "sent". */
function lastEmailedCode(): string {
  const mail = h.sendMail.mock.calls.at(-1)?.[0];
  const m = /code: (\d{6})/.exec(mail?.subject ?? "");
  if (!m) throw new Error("no code email was sent");
  return m[1];
}

function sessionWorks(appMetadata: object) {
  h.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "hashed-tok" } }, error: null });
  h.verifyOtp.mockImplementation(async () => {
    h.setAll?.([{ name: "sb-test-auth-token", value: "session", options: { path: "/" } }]);
    return { data: { user: { id: "u1", app_metadata: appMetadata } }, error: null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.setAll = null;
  h.store = memoryCodeStore();
  h.sendMail.mockResolvedValue({ messageId: "m" });
  vi.stubEnv("SESSION_SECRET", "route-test-secret");
  vi.stubEnv("ZOHO_SMTP_PASSWORD", "zoho-app-password");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth/start — step 1, email only", () => {
  it("400 for a bad email", async () => {
    const res = await start(req("/api/auth/start", { email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("account with a password → password step, no email sent", async () => {
    users({ id: "b", email: "brandon@vyntechs.com", app_metadata: MARKED });
    const res = await start(req("/api/auth/start", { email: " Brandon@Vyntechs.com " }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ step: "password" });
    expect(h.sendMail).not.toHaveBeenCalled();
    expect(store().rows).toHaveLength(0);
  });

  it("account with no password → emails a login code and shows the code step", async () => {
    users({ id: "h", email: "heather@example.com", app_metadata: {} });
    const res = await start(req("/api/auth/start", { email: "heather@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ step: "code", purpose: "login", maskedEmail: "h***@example.com" });
    expect(h.sendMail).toHaveBeenCalledTimes(1);
    const mail = h.sendMail.mock.calls[0][0];
    expect(mail.to).toBe("heather@example.com");
    expect(mail.from).toEqual({ name: "TR1VIA", address: "support@vyntechs.com" });
    const code = lastEmailedCode();
    expect(store().rows).toHaveLength(1);
    expect(store().rows[0]).toMatchObject({ email: "heather@example.com", purpose: "login", attempts: 0 });
    expect(JSON.stringify(store().rows)).not.toContain(code);
  });

  it("no account → sign-up step, no email yet", async () => {
    users();
    const res = await start(req("/api/auth/start", { email: "new@example.com" }));
    expect(await res.json()).toEqual({ step: "signup" });
    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it("mail not set up → 'Text Brandon', and no code is made", async () => {
    vi.stubEnv("ZOHO_SMTP_PASSWORD", "");
    users({ id: "h", email: "heather@example.com", app_metadata: {} });
    const res = await start(req("/api/auth/start", { email: "heather@example.com" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("We couldn't send the code. Text Brandon for a sign-in link.");
    expect(store().rows).toHaveLength(0);
  });

  it("codes table missing (preview before the migration) → 'Text Brandon', not a crash", async () => {
    users({ id: "h", email: "heather@example.com", app_metadata: {} });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    store().insert = async () => {
      throw new Error('relation "public.auth_email_codes" does not exist');
    };
    const res = await start(req("/api/auth/start", { email: "heather@example.com" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/Text Brandon for a sign-in link/);
    expect(h.sendMail).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("SMTP failure → 'Text Brandon', and the unsent code can't be used", async () => {
    users({ id: "h", email: "heather@example.com", app_metadata: {} });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.sendMail.mockRejectedValue(new Error("connect ETIMEDOUT"));
    const res = await start(req("/api/auth/start", { email: "heather@example.com" }));
    expect(res.status).toBe(503);
    expect(store().rows.every((r) => r.consumed_at !== null)).toBe(true);
    log.mockRestore();
  });

  it("after 5 codes in an hour → 429, but she still lands on the code step", async () => {
    users({ id: "h", email: "heather@example.com", app_metadata: {} });
    for (let i = 0; i < 5; i++) {
      expect((await start(req("/api/auth/start", { email: "heather@example.com" }))).status).toBe(200);
    }
    const res = await start(req("/api/auth/start", { email: "heather@example.com" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ step: "code", purpose: "login", code: "too_many_codes" });
    expect(h.sendMail).toHaveBeenCalledTimes(5);
  });
});

describe("POST /api/auth/send-code — each purpose only for the right account", () => {
  it("login code refused for an account that has a password", async () => {
    users({ id: "b", email: "brandon@vyntechs.com", app_metadata: MARKED });
    const res = await sendCode(req("/api/auth/send-code", { email: "brandon@vyntechs.com", purpose: "login" }));
    expect(res.status).toBe(409);
    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it("reset code refused for an unknown email", async () => {
    users();
    const res = await sendCode(req("/api/auth/send-code", { email: "who@example.com", purpose: "reset" }));
    expect(res.status).toBe(404);
    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it("signup code refused for an existing account", async () => {
    users({ id: "h", email: "heather@example.com", app_metadata: {} });
    const res = await sendCode(req("/api/auth/send-code", { email: "heather@example.com", purpose: "signup" }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("account_exists");
  });

  it("400 for an unknown purpose", async () => {
    const res = await sendCode(req("/api/auth/send-code", { email: "a@example.com", purpose: "admin" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/verify-code", () => {
  it("login: right code → session cookies → Step 2 of 2 'Create your password'", async () => {
    users({ id: "h", email: "heather@example.com", app_metadata: {} });
    await start(req("/api/auth/start", { email: "heather@example.com" }));
    sessionWorks({});
    const res = await verify(
      req("/api/auth/verify-code", {
        email: "heather@example.com",
        purpose: "login",
        code: lastEmailedCode(),
        next: "/host/setup/n1",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      redirect: "/host/set-password?from=code&next=%2Fhost%2Fsetup%2Fn1",
    });
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("session");
    expect(h.generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "heather@example.com" });
    expect(h.verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "hashed-tok" });
  });

  it("wrong code → 400, no session, no magic link minted", async () => {
    users({ id: "h", email: "heather@example.com", app_metadata: {} });
    await start(req("/api/auth/start", { email: "heather@example.com" }));
    const right = lastEmailedCode();
    const wrong = right === "000000" ? "111111" : "000000";
    const res = await verify(req("/api/auth/verify-code", { email: "heather@example.com", purpose: "login", code: wrong }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("wrong_code");
    expect(res.cookies.get("sb-test-auth-token")).toBeUndefined();
    expect(h.generateLink).not.toHaveBeenCalled();
  });

  it("a code works once", async () => {
    users({ id: "h", email: "heather@example.com", app_metadata: {} });
    await start(req("/api/auth/start", { email: "heather@example.com" }));
    sessionWorks({});
    const code = lastEmailedCode();
    const body = { email: "heather@example.com", purpose: "login", code };
    expect((await verify(req("/api/auth/verify-code", body))).status).toBe(200);
    const again = await verify(req("/api/auth/verify-code", body));
    expect(again.status).toBe(400);
    expect((await again.json()).code).toBe("code_used");
  });

  it("forgot password: reset code → signed in → 'Choose a new password'; bad next falls back to /host", async () => {
    users({ id: "b", email: "brandon@vyntechs.com", app_metadata: MARKED });
    const sent = await sendCode(req("/api/auth/send-code", { email: "brandon@vyntechs.com", purpose: "reset" }));
    expect(sent.status).toBe(200);
    expect(await sent.json()).toEqual({ ok: true, maskedEmail: "b***@vyntechs.com" });
    sessionWorks(MARKED);
    const res = await verify(
      req("/api/auth/verify-code", {
        email: "brandon@vyntechs.com",
        purpose: "reset",
        code: lastEmailedCode(),
        next: "https://evil.example/host",
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).redirect).toBe("/host/set-password?from=reset&next=%2Fhost");
  });

  it("refuses signup codes (those go through host-access)", async () => {
    const res = await verify(req("/api/auth/verify-code", { email: "a@example.com", purpose: "signup", code: "123456" }));
    expect(res.status).toBe(400);
  });
});

describe("sign-up proves the email with a code before the account exists", () => {
  it("send-code(signup) → host-access with that code creates + signs in", async () => {
    users();
    const sent = await sendCode(req("/api/auth/send-code", { email: "new@example.com", purpose: "signup" }));
    expect(sent.status).toBe(200);
    h.createUser.mockResolvedValue({ data: { user: { id: "n1" } }, error: null });
    h.signInWithPassword.mockImplementation(async () => {
      h.setAll?.([{ name: "sb-test-auth-token", value: "session", options: { path: "/" } }]);
      return { data: { user: { id: "n1" } }, error: null };
    });
    const res = await signUp(
      req("/api/auth/host-access", {
        email: "new@example.com",
        password: "trivia-night",
        confirm: "trivia-night",
        code: lastEmailedCode(),
      }),
    );
    expect(res.status).toBe(200);
    expect(h.createUser).toHaveBeenCalledTimes(1);
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("session");
  });

  it("someone else's email can't be claimed without its code", async () => {
    users();
    await sendCode(req("/api/auth/send-code", { email: "victim@example.com", purpose: "signup" }));
    const right = lastEmailedCode();
    const res = await signUp(
      req("/api/auth/host-access", {
        email: "victim@example.com",
        password: "trivia-night",
        confirm: "trivia-night",
        code: right === "000000" ? "111111" : "000000",
      }),
    );
    expect(res.status).toBe(400);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("a login code for the same email doesn't count as a signup code", async () => {
    users({ id: "h", email: "heather@example.com", app_metadata: {} });
    await start(req("/api/auth/start", { email: "heather@example.com" }));
    const res = await signUp(
      req("/api/auth/host-access", {
        email: "heather@example.com",
        password: "trivia-night",
        confirm: "trivia-night",
        code: lastEmailedCode(),
      }),
    );
    expect(res.status).toBe(400);
    expect(h.createUser).not.toHaveBeenCalled();
  });
});
