// Route tests — POST /api/auth/login (password sign-in) and
// POST /api/auth/host-access (sign-up with a password).
//
// Proves:
//   - email alone never signs anyone in
//   - the account is looked up FIRST with one indexed row (never paging
//     listUsers); a correct password + marker → 200 with session cookies
//   - no marker (every pre-password account) → 403 "we'll email you a code"
//     BEFORE any password check, so no session is ever created
//   - if the marker is somehow missing on the signed-in user, just that new
//     session is signed out (scope "local") and no cookies are sent
//   - wrong password / unknown email are told apart
//   - sign-up needs a correct emailed "signup" code before anything is made,
//     and only uses the code up once the account exists (a password
//     Supabase refuses keeps the code good, with the rule in plain words)
//   - sign-up creates the account WITH password + marker, then signs in
//   - sign-up for an existing email → 409, no session
//   - 10 wrong passwords for one email from one network (or 20 from one IP,
//     or 50 for one email from every network together) lock that door for
//     15 minutes with a friendly message, even for the right password; a
//     stranger's wrong passwords on their network never lock her out on
//     hers; setting a new password lifts both locks on every network

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { memoryRateStore } from "./helpers/memory-rate-store";
import { LOCKED_OUT_MESSAGE, NO_PASSWORD_MESSAGE } from "@/lib/auth/auth-messages";
import { RATE_LIMITS } from "@/lib/auth/rate-limits";

type SetAll = (c: Array<{ name: string; value: string; options?: object }>) => void;

const h = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  listUsers: vi.fn(),
  rpc: vi.fn(),
  accounts: [] as Array<{ id: string; email: string; app_metadata: object }>,
  createUser: vi.fn(),
  checkCode: vi.fn(),
  spendCode: vi.fn(),
  setAll: null as null | SetAll,
  rates: null as unknown,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: SetAll } }) => {
    h.setAll = opts.cookies.setAll;
    return { auth: { signInWithPassword: h.signInWithPassword, signOut: h.signOut } };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    rpc: h.rpc,
    auth: { admin: { listUsers: h.listUsers, createUser: h.createUser } },
  }),
}));

vi.mock("@/lib/auth/rate-limit-store", () => ({
  supabaseRateStore: () => h.rates,
}));

vi.mock("@/lib/auth/email-code-flow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/email-code-flow")>()),
  checkCode: h.checkCode,
  spendCode: h.spendCode,
}));

import { POST as login } from "@/app/api/auth/login/route";
import { POST as signUp } from "@/app/api/auth/host-access/route";

const req = (path: string, body: unknown, ip = "203.0.113.7") =>
  new NextRequest(`http://test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
    body: JSON.stringify(body),
  });

// A fixed "password saved at" time for the marker (built, not a literal).
const SET_AT = new Date(Date.UTC(2026, 8, 27, 12)).toISOString();
const MARKED = { password_set_at: SET_AT };

function signInSucceeds(appMetadata: Record<string, unknown>) {
  h.signInWithPassword.mockImplementation(async () => {
    h.setAll?.([{ name: "sb-test-auth-token", value: "session", options: { path: "/" } }]);
    return { data: { user: { id: "u1", app_metadata: appMetadata } }, error: null };
  });
}

function signInFails() {
  h.signInWithPassword.mockResolvedValue({
    data: { user: null, session: null },
    error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
  });
}

/** The accounts the indexed lookup (public.find_auth_user_by_email) sees. */
function accounts(...list: Array<{ id: string; email: string; app_metadata: object }>) {
  h.accounts = list;
}

const MARKED_USER = { id: "b", email: "brandon@vyntechs.com", app_metadata: MARKED };

beforeEach(() => {
  vi.clearAllMocks();
  h.setAll = null;
  h.rates = memoryRateStore();
  h.checkCode.mockResolvedValue({ ok: true, codeId: "code-1" });
  h.spendCode.mockResolvedValue("used");
  h.signOut.mockResolvedValue({ error: null });
  accounts(
    MARKED_USER,
    { id: "h", email: "heather@x.test", app_metadata: MARKED },
    { id: "bx", email: "b@x.test", app_metadata: MARKED },
    { id: "a", email: "a@x.test", app_metadata: MARKED },
  );
  h.rpc.mockImplementation(async (_fn: string, { p_email }: { p_email: string }) => ({
    data: h.accounts
      .filter((u) => u.email === p_email)
      .map((u) => ({ id: u.id, email: u.email, raw_app_meta_data: u.app_metadata })),
    error: null,
  }));
});

describe("POST /api/auth/login", () => {
  it("400 for email alone — no Supabase call", async () => {
    const res = await login(req("/api/auth/login", { email: "brandon@vyntechs.com" }));
    expect(res.status).toBe(400);
    expect(h.signInWithPassword).not.toHaveBeenCalled();
  });

  it("200 with session cookies for the right password on a marked account (one indexed lookup)", async () => {
    signInSucceeds(MARKED);
    const res = await login(req("/api/auth/login", { email: " Brandon@Vyntechs.com ", password: "pw-12345678" }));
    expect(res.status).toBe(200);
    expect(h.signInWithPassword).toHaveBeenCalledWith({
      email: "brandon@vyntechs.com",
      password: "pw-12345678",
    });
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("session");
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("find_auth_user_by_email", { p_email: "brandon@vyntechs.com" });
    expect(h.listUsers).not.toHaveBeenCalled();
  });

  it("403 'we'll email you a code' for a no-marker account — refused BEFORE any password check", async () => {
    accounts({ id: "old", email: "old@x.test", app_metadata: { provider: "email" } });
    signInSucceeds({ provider: "email" });
    const res = await login(req("/api/auth/login", { email: "old@x.test", password: "whatever1" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("no_password");
    expect(body.error).toBe(NO_PASSWORD_MESSAGE);
    expect(body.error).toContain('Tap "Use a different email"');
    // No password check → no session was ever created.
    expect(h.signInWithPassword).not.toHaveBeenCalled();
    expect(res.cookies.get("sb-test-auth-token")).toBeUndefined();
  });

  it("if the marker is missing on the signed-in user, ends only that new session and sends no cookies", async () => {
    signInSucceeds({ provider: "email" });
    const res = await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "pw-12345678" }));
    expect(res.status).toBe(403);
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(res.cookies.get("sb-test-auth-token")).toBeUndefined();
  });

  it("401 wrong password for a marked account", async () => {
    signInFails();
    const res = await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "nope-nope" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("wrong_password");
  });

  it("404 no_account for an unknown email, without a password check", async () => {
    signInFails();
    const res = await login(req("/api/auth/login", { email: "new@x.test", password: "whatever1" }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("no_account");
    expect(h.signInWithPassword).not.toHaveBeenCalled();
  });

  it("429 when Supabase rate limits", async () => {
    h.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 429, code: "over_request_rate_limit", message: "slow down" },
    });
    const res = await login(req("/api/auth/login", { email: "a@x.test", password: "whatever1" }));
    expect(res.status).toBe(429);
  });

  it.each([
    ["an outage (500)", { status: 500, code: "unexpected_failure", message: "Database error" }],
    ["a network failure (no status)", { name: "AuthRetryableFetchError", message: "fetch failed" }],
    ["an unconfirmed email", { status: 400, code: "email_not_confirmed", message: "Email not confirmed" }],
  ])("%s → 'couldn't sign you in right now', never counted as a wrong password", async (_label, error) => {
    h.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error });
    // One network, past its lockout: any count would show up as a 429.
    for (let i = 0; i < RATE_LIMITS["fail:login-ip-email"] + 2; i++) {
      const res = await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "whatever1" }));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe("sign_in_unavailable");
      expect(body.error).toBe("We couldn't sign you in right now. Try again in a minute.");
    }
    // No lockout built up: the right password works as soon as Supabase is back.
    signInSucceeds(MARKED);
    const ok = await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "right-one" }));
    expect(ok.status).toBe(200);
  });
});

describe("POST /api/auth/login — wrong-password lockout", () => {
  it("locks one email on one network after 10 wrong passwords — even the right one is refused there", async () => {
    signInFails();
    for (let i = 0; i < RATE_LIMITS["fail:login-ip-email"]; i++) {
      const r = await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "nope" }, "198.51.100.7"));
      expect(r.status).toBe(401);
    }
    expect(RATE_LIMITS["fail:login-ip-email"]).toBe(10);
    signInSucceeds(MARKED);
    const locked = await login(
      req("/api/auth/login", { email: "brandon@vyntechs.com", password: "pw-12345678" }, "198.51.100.7"),
    );
    expect(locked.status).toBe(429);
    expect(await locked.json()).toEqual({ code: "locked_out", error: LOCKED_OUT_MESSAGE });
    expect(locked.cookies.get("sb-test-auth-token")).toBeUndefined();

    // Her own network isn't locked: a stranger can't lock her out.
    const hers = await login(
      req("/api/auth/login", { email: "brandon@vyntechs.com", password: "pw-12345678" }, "203.0.113.20"),
    );
    expect(hers.status).toBe(200);
  });

  it("a new password lifts the network lock on EVERY network (e.g. reset from her phone, laptop on venue WiFi)", async () => {
    signInFails();
    for (let i = 0; i < RATE_LIMITS["fail:login-ip-email"]; i++) {
      await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "nope" }, "198.51.100.7"));
    }
    signInSucceeds(MARKED);
    const locked = await login(
      req("/api/auth/login", { email: "brandon@vyntechs.com", password: "pw-12345678" }, "198.51.100.7"),
    );
    expect(locked.status).toBe(429);
    // She saves a new password from another network (password_set_at moves on).
    const fresh = { password_set_at: new Date(Date.now() + 1000).toISOString() };
    accounts({ ...MARKED_USER, app_metadata: fresh });
    signInSucceeds(fresh);
    const ok = await login(
      req("/api/auth/login", { email: "brandon@vyntechs.com", password: "new-password" }, "198.51.100.7"),
    );
    expect(ok.status).toBe(200);
  });

  it("backstop: 50 wrong passwords for one email from many networks lock it everywhere", async () => {
    signInFails();
    for (let i = 0; i < RATE_LIMITS["fail:login-email"]; i++) {
      // Spread over IPs so only the per-email backstop can trip.
      const r = await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "nope" }, `198.51.100.${i}`));
      expect(r.status).toBe(401);
    }
    signInSucceeds(MARKED);
    const locked = await login(
      req("/api/auth/login", { email: "brandon@vyntechs.com", password: "pw-12345678" }, "198.51.100.99"),
    );
    expect(locked.status).toBe(429);
    expect(await locked.json()).toEqual({ code: "locked_out", error: LOCKED_OUT_MESSAGE });
    expect(LOCKED_OUT_MESSAGE).toBe("Too many tries. Wait 15 minutes or use Forgot password.");
    expect(locked.cookies.get("sb-test-auth-token")).toBeUndefined();

    // Another host is unaffected.
    const other = await login(req("/api/auth/login", { email: "heather@x.test", password: "pw-12345678" }, "198.51.100.99"));
    expect(other.status).toBe(200);
  });

  it("locks one IP after 20 failed tries across many emails", async () => {
    signInFails();
    for (let i = 0; i < RATE_LIMITS["fail:login-ip"]; i++) {
      const r = await login(req("/api/auth/login", { email: `guess${i}@x.test`, password: "nope" }));
      expect(r.status).toBe(404);
    }
    const r = await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "pw-12345678" }));
    expect(r.status).toBe(429);
    expect((await r.json()).code).toBe("locked_out");
    // A different IP can still sign in.
    signInSucceeds(MARKED);
    const ok = await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "pw-12345678" }, "192.0.2.5"));
    expect(ok.status).toBe(200);
  });

  it("caps requests per IP", async () => {
    signInSucceeds(MARKED);
    for (let i = 0; i < RATE_LIMITS["ip:login"]; i++) {
      expect((await login(req("/api/auth/login", { email: "b@x.test", password: "pw-12345678" }))).status).toBe(200);
    }
    const r = await login(req("/api/auth/login", { email: "b@x.test", password: "pw-12345678" }));
    expect(r.status).toBe(429);
    expect((await r.json()).code).toBe("too_many_tries");
  });

  it("the lock lifts after 15 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 27, 20, 0)));
      signInFails();
      for (let i = 0; i < RATE_LIMITS["fail:login-email"]; i++) {
        await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "nope" }, `198.51.100.${i}`));
      }
      signInSucceeds(MARKED);
      expect((await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "pw-12345678" }, "192.0.2.9"))).status).toBe(429);
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 27, 20, 16)));
      expect((await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "pw-12345678" }, "192.0.2.9"))).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails open — sign-in works when the limits table is missing", async () => {
    h.rates = {
      count: async () => {
        throw new Error('relation "public.auth_rate_events" does not exist');
      },
      record: async () => {
        throw new Error("missing");
      },
      clear: async () => {},
      deleteOlderThan: async () => {},
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    signInSucceeds(MARKED);
    const res = await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "pw-12345678" }));
    expect(res.status).toBe(200);
    log.mockRestore();
  });
});

describe("POST /api/auth/host-access (sign-up)", () => {
  it("400 without a password — no account is made from an email alone", async () => {
    const res = await signUp(req("/api/auth/host-access", { email: "new@x.test" }));
    expect(res.status).toBe(400);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("400 when the two passwords don't match", async () => {
    const res = await signUp(
      req("/api/auth/host-access", { email: "new@x.test", password: "trivia-night", confirm: "trivia-nite" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("confirm");
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("creates the account with password + marker, then signs in with cookies", async () => {
    h.createUser.mockResolvedValue({ data: { user: { id: "n1" } }, error: null });
    signInSucceeds(MARKED);
    const res = await signUp(
      req("/api/auth/host-access", {
        email: "New@X.test",
        password: "trivia-night",
        confirm: "trivia-night",
        code: "123456",
      }),
    );
    expect(res.status).toBe(200);
    expect(h.checkCode).toHaveBeenCalledWith("new@x.test", "signup", "123456", {
      ip: "203.0.113.7",
      consume: false,
    });
    const attrs = h.createUser.mock.calls[0][0];
    expect(attrs).toMatchObject({ email: "new@x.test", password: "trivia-night", email_confirm: true });
    expect(typeof attrs.app_metadata.password_set_at).toBe("string");
    expect(h.signInWithPassword).toHaveBeenCalledWith({ email: "new@x.test", password: "trivia-night" });
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("session");
    expect(h.listUsers).not.toHaveBeenCalled();
    // The code is used up only now that the account exists.
    expect(h.spendCode).toHaveBeenCalledWith({ codeId: "code-1", email: "new@x.test", purpose: "signup" });
  });

  it("account made but the sign-in right after fails → 'Your account is ready. Sign in with your password.'", async () => {
    h.createUser.mockResolvedValue({ data: { user: { id: "n1" } }, error: null });
    h.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 500, code: "unexpected_failure", message: "Database error" },
    });
    const res = await signUp(
      req("/api/auth/host-access", {
        email: "new@x.test",
        password: "trivia-night",
        confirm: "trivia-night",
        code: "123456",
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "account_ready",
      error: "Your account is ready. Sign in with your password.",
    });
    expect(res.cookies.get("sb-test-auth-token")).toBeUndefined();
    // The account exists, so the code is used up.
    expect(h.spendCode).toHaveBeenCalled();
  });

  it("a password Supabase refuses keeps the code good and says the rule in plain words", async () => {
    h.createUser.mockResolvedValue({
      data: { user: null },
      error: {
        status: 422,
        code: "weak_password",
        message: "Password should be at least 10 characters.",
        reasons: ["length", "pwned"],
      },
    });
    const res = await signUp(
      req("/api/auth/host-access", {
        email: "new@x.test",
        password: "trivia-nt",
        confirm: "trivia-nt",
        code: "123456",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ code: "weak_password", field: "password" });
    expect(body.error).toBe(
      "Please pick a different password. It needs at least 10 characters. It has shown up in a data leak on another website, so it isn't safe.",
    );
    expect(h.spendCode).not.toHaveBeenCalled();
    expect(h.signInWithPassword).not.toHaveBeenCalled();
  });

  it("409 'sign in instead' for an existing email, and no session", async () => {
    h.createUser.mockResolvedValue({
      data: { user: null },
      error: { status: 422, code: "email_exists", message: "already registered" },
    });
    const res = await signUp(
      req("/api/auth/host-access", {
        email: "heather@x.test",
        password: "trivia-night",
        confirm: "trivia-night",
        code: "123456",
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("account_exists");
    expect(h.signInWithPassword).not.toHaveBeenCalled();
  });

  it("400 without an emailed code — nothing is created", async () => {
    const res = await signUp(
      req("/api/auth/host-access", { email: "new@x.test", password: "trivia-night", confirm: "trivia-night" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("bad_code");
    expect(h.checkCode).not.toHaveBeenCalled();
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("a wrong code never creates the account or a session", async () => {
    h.checkCode.mockResolvedValue({ ok: false, status: 400, code: "wrong_code", error: "nope" });
    const res = await signUp(
      req("/api/auth/host-access", {
        email: "new@x.test",
        password: "trivia-night",
        confirm: "trivia-night",
        code: "000000",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("wrong_code");
    expect(body.field).toBe("code");
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.signInWithPassword).not.toHaveBeenCalled();
  });
});
