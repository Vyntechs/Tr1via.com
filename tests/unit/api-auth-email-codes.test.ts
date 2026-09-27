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
import { memoryRateStore } from "./helpers/memory-rate-store";
import { RATE_LIMITS } from "@/lib/auth/rate-limits";
import { MAX_SENDS_PER_HOUR_SITEWIDE } from "@/lib/auth/email-codes";

type SetAll = (c: Array<{ name: string; value: string; options?: object }>) => void;

const h = vi.hoisted(() => ({
  listUsers: vi.fn(),
  rpc: vi.fn(),
  updateUserById: vi.fn(),
  hostRole: "host" as string,
  generateLink: vi.fn(),
  createUser: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  sendMail: vi.fn(),
  setAll: null as null | SetAll,
  store: null as unknown,
  rates: null as unknown,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: SetAll } }) => {
    h.setAll = opts.cookies.setAll;
    return { auth: { verifyOtp: h.verifyOtp, signInWithPassword: h.signInWithPassword } };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    rpc: h.rpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: h.hostRole } }) }) }),
    }),
    auth: {
      admin: {
        listUsers: h.listUsers,
        generateLink: h.generateLink,
        createUser: h.createUser,
        updateUserById: h.updateUserById,
      },
    },
  }),
}));
vi.mock("@/lib/auth/email-code-store", () => ({
  supabaseCodeStore: () => h.store,
}));
vi.mock("@/lib/auth/rate-limit-store", () => ({
  supabaseRateStore: () => h.rates,
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

const req = (path: string, body: unknown, ip = "203.0.113.7") =>
  new NextRequest(`http://test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });

const MARKED = { password_set_at: new Date(Date.UTC(2026, 8, 1)).toISOString() };

/** The accounts the indexed lookup (public.find_auth_user_by_email) sees. */
function users(...list: Array<{ id: string; email: string; app_metadata?: object }>) {
  h.rpc.mockImplementation(async (_fn: string, { p_email }: { p_email: string }) => ({
    data: list
      .filter((u) => u.email === p_email)
      .map((u) => ({ id: u.id, email: u.email, raw_app_meta_data: u.app_metadata ?? {} })),
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
  h.rates = memoryRateStore();
  h.sendMail.mockResolvedValue({ messageId: "m" });
  h.hostRole = "host";
  h.updateUserById.mockResolvedValue({ data: {}, error: null });
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

  it("this network's hourly code limit → NO code screen, 'Text Brandon for a sign-in link'", async () => {
    const legacy = Array.from({ length: RATE_LIMITS["ip:code-login"] + 1 }, (_, i) => ({
      id: `l${i}`,
      email: `legacy${i}@example.com`,
      app_metadata: {},
    }));
    users(...legacy);
    for (let i = 0; i < RATE_LIMITS["ip:code-login"]; i++) {
      expect((await start(req("/api/auth/start", { email: legacy[i].email }))).status).toBe(200);
    }
    const res = await start(req("/api/auth/start", { email: legacy.at(-1)!.email }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({
      code: "codes_paused",
      error: "We couldn't send a code right now. Text Brandon for a sign-in link.",
    });
    expect(body.step).toBeUndefined();
    expect(h.sendMail).toHaveBeenCalledTimes(RATE_LIMITS["ip:code-login"]);
    // Heather on her own network still gets her code.
    const other = await start(req("/api/auth/start", { email: legacy.at(-1)!.email }, "198.51.100.20"));
    expect(other.status).toBe(200);
  });

  it("login codes have no site-wide cap: many networks can't lock Heather out", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, email: `m${i}@example.com`, app_metadata: {} }));
    users(...many, { id: "h", email: "heather@example.com", app_metadata: {} });
    for (let i = 0; i < many.length; i++) {
      const r = await start(req("/api/auth/start", { email: many[i].email }, `203.0.113.${100 + i}`));
      expect(r.status).toBe(200);
    }
    const res = await start(req("/api/auth/start", { email: "heather@example.com" }, "198.51.100.77"));
    expect(res.status).toBe(200);
    expect((await res.json()).step).toBe("code");
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

  it("one network can't use up the site-wide signup allowance", async () => {
    users();
    for (let i = 0; i < RATE_LIMITS["ip:code-signup"]; i++) {
      expect((await sendCode(req("/api/auth/send-code", { email: `new${i}@x.test`, purpose: "signup" }))).status).toBe(200);
    }
    const blocked = await sendCode(req("/api/auth/send-code", { email: "spam@x.test", purpose: "signup" }));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).code).toBe("codes_paused");
    expect(RATE_LIMITS["ip:code-signup"]).toBeLessThan(MAX_SENDS_PER_HOUR_SITEWIDE.signup!);
    // A real new host elsewhere still gets her code.
    const real = await sendCode(req("/api/auth/send-code", { email: "real@x.test", purpose: "signup" }, "198.51.100.30"));
    expect(real.status).toBe(200);
  });

  it("site-wide signup cap → 'We couldn't send a code right now', not the code screen", async () => {
    users();
    for (let i = 0; i < MAX_SENDS_PER_HOUR_SITEWIDE.signup!; i++) {
      const r = await sendCode(req("/api/auth/send-code", { email: `s${i}@x.test`, purpose: "signup" }, `203.0.113.${i}`));
      expect(r.status).toBe(200);
    }
    const r = await sendCode(req("/api/auth/send-code", { email: "late@x.test", purpose: "signup" }, "198.51.100.40"));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({
      code: "codes_paused",
      error: "We couldn't send a code right now. Text Brandon for a sign-in link.",
    });
    // Existing hosts are unaffected: reset still works.
    users({ id: "b", email: "brandon@vyntechs.com", app_metadata: MARKED });
    const reset = await sendCode(req("/api/auth/send-code", { email: "brandon@vyntechs.com", purpose: "reset" }, "198.51.100.41"));
    expect(reset.status).toBe(200);
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

  it.each([
    ["login", {}],
    ["reset", MARKED],
  ] as const)("%s code with an in-show next → straight back to the show, no password step", async (purpose, meta) => {
    users({ id: "h", email: "heather@example.com", app_metadata: meta });
    if (purpose === "login") await start(req("/api/auth/start", { email: "heather@example.com" }));
    else await sendCode(req("/api/auth/send-code", { email: "heather@example.com", purpose: "reset" }));
    sessionWorks(meta);
    const res = await verify(
      req("/api/auth/verify-code", {
        email: "heather@example.com",
        purpose,
        code: lastEmailedCode(),
        next: "/host/live/n1",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirect: "/host/live/n1" });
  });

  it("login code for a host whose prompt the founder switched OFF → straight to next (same as /auth/grant)", async () => {
    users({ id: "h", email: "heather@example.com", app_metadata: { password_prompt: "off" } });
    await start(req("/api/auth/start", { email: "heather@example.com" }));
    sessionWorks({ password_prompt: "off" });
    const res = await verify(
      req("/api/auth/verify-code", {
        email: "heather@example.com",
        purpose: "login",
        code: lastEmailedCode(),
        next: "/host/setup/n1",
      }),
    );
    expect(await res.json()).toEqual({ ok: true, redirect: "/host/setup/n1" });
  });

  it("a reset code still goes to 'Choose a new password' even with the switch off", async () => {
    const meta = { password_set_at: MARKED.password_set_at, password_prompt: "off" };
    users({ id: "b", email: "brandon@vyntechs.com", app_metadata: meta });
    await sendCode(req("/api/auth/send-code", { email: "brandon@vyntechs.com", purpose: "reset" }));
    sessionWorks(meta);
    const res = await verify(
      req("/api/auth/verify-code", { email: "brandon@vyntechs.com", purpose: "reset", code: lastEmailedCode() }),
    );
    expect((await res.json()).redirect).toBe("/host/set-password?from=reset&next=%2Fhost");
  });

  it("the founder's account is marked at sign-in so pages never query hosts", async () => {
    users({ id: "f", email: "founder@example.com", app_metadata: {} });
    h.hostRole = "founder";
    await start(req("/api/auth/start", { email: "founder@example.com" }));
    sessionWorks({});
    await verify(req("/api/auth/verify-code", { email: "founder@example.com", purpose: "login", code: lastEmailedCode() }));
    expect(h.updateUserById).toHaveBeenCalledWith("u1", { app_metadata: { founder: true } });
  });

  it("an account deleted after its code was sent is never re-created", async () => {
    users({ id: "h", email: "heather@example.com", app_metadata: {} });
    await start(req("/api/auth/start", { email: "heather@example.com" }));
    const code = lastEmailedCode();
    users();
    sessionWorks({});
    const res = await verify(req("/api/auth/verify-code", { email: "heather@example.com", purpose: "login", code }));
    expect(res.status).toBe(404);
    // generateLink would create a brand-new account for an unknown email.
    expect(h.generateLink).not.toHaveBeenCalled();
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

describe("per-IP limits on the code doors", () => {
  it("start: refuses after the per-IP cap, other IPs unaffected", async () => {
    users({ id: "b", email: "brandon@vyntechs.com", app_metadata: MARKED });
    for (let i = 0; i < RATE_LIMITS["ip:start"]; i++) {
      expect((await start(req("/api/auth/start", { email: "brandon@vyntechs.com" }))).status).toBe(200);
    }
    const r = await start(req("/api/auth/start", { email: "brandon@vyntechs.com" }));
    expect(r.status).toBe(429);
    expect((await r.json()).code).toBe("too_many_tries");
    expect((await start(req("/api/auth/start", { email: "brandon@vyntechs.com" }, "192.0.2.1"))).status).toBe(200);
  });

  it("send-code: refuses after the per-IP cap without sending", async () => {
    users();
    for (let i = 0; i < RATE_LIMITS["ip:send-code"]; i++) {
      await sendCode(req("/api/auth/send-code", { email: `new${i}@x.test`, purpose: "signup" }));
    }
    const sent = h.sendMail.mock.calls.length;
    const r = await sendCode(req("/api/auth/send-code", { email: "late@x.test", purpose: "signup" }));
    expect(r.status).toBe(429);
    expect((await r.json()).code).toBe("too_many_tries");
    expect(h.sendMail.mock.calls.length).toBe(sent);
  });

  it("verify-code: refuses after the per-IP cap", async () => {
    users({ id: "h", email: "heather@x.test", app_metadata: {} });
    for (let i = 0; i < RATE_LIMITS["ip:verify-code"]; i++) {
      await verify(req("/api/auth/verify-code", { email: "heather@x.test", purpose: "login", code: "000000" }));
    }
    const r = await verify(req("/api/auth/verify-code", { email: "heather@x.test", purpose: "login", code: "000000" }));
    expect(r.status).toBe(429);
    expect((await r.json()).code).toBe("too_many_tries");
  });
});
