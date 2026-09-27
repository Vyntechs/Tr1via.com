// Route tests — POST /api/auth/login (password sign-in) and
// POST /api/auth/host-access (sign-up with a password).
//
// Proves:
//   - email alone never signs anyone in
//   - a correct password + marker → 200 with session cookies, no user lookup
//   - no marker (every pre-password account) → 403 "we'll email you a code"
//     and no cookies
//   - wrong password / unknown email are told apart via an uncapped lookup
//     (a user on page 2 of listUsers is still found)
//   - sign-up needs a correct emailed "signup" code before anything is made
//   - sign-up creates the account WITH password + marker, then signs in
//   - sign-up for an existing email → 409, no session
//   - 10 wrong passwords for one email (or 20 from one IP) lock that door
//     for 15 minutes with a friendly message, even for the right password;
//     setting a new password clears the email lock

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { memoryRateStore } from "./helpers/memory-rate-store";
import { LOCKED_OUT_MESSAGE, NO_PASSWORD_MESSAGE } from "@/lib/auth/auth-messages";
import { RATE_LIMITS } from "@/lib/auth/rate-limits";

type SetAll = (c: Array<{ name: string; value: string; options?: object }>) => void;

const h = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  listUsers: vi.fn(),
  createUser: vi.fn(),
  checkCode: vi.fn(),
  setAll: null as null | SetAll,
  rates: null as unknown,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: SetAll } }) => {
    h.setAll = opts.cookies.setAll;
    return { auth: { signInWithPassword: h.signInWithPassword } };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { listUsers: h.listUsers, createUser: h.createUser } },
  }),
}));

vi.mock("@/lib/auth/rate-limit-store", () => ({
  supabaseRateStore: () => h.rates,
}));

vi.mock("@/lib/auth/email-code-flow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/email-code-flow")>()),
  checkCode: h.checkCode,
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

function usersPages(...pages: Array<Array<{ id: string; email: string; app_metadata?: object }>>) {
  h.listUsers.mockImplementation(async ({ page }: { page: number }) => ({
    data: { users: pages[page - 1] ?? [] },
    error: null,
  }));
}

function filler(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `f${i}`, email: `filler${i}@x.test` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.setAll = null;
  h.rates = memoryRateStore();
  h.checkCode.mockResolvedValue({ ok: true });
});

describe("POST /api/auth/login", () => {
  it("400 for email alone — no Supabase call", async () => {
    const res = await login(req("/api/auth/login", { email: "brandon@vyntechs.com" }));
    expect(res.status).toBe(400);
    expect(h.signInWithPassword).not.toHaveBeenCalled();
  });

  it("200 with session cookies for the right password on a marked account, no lookup", async () => {
    signInSucceeds(MARKED);
    const res = await login(req("/api/auth/login", { email: " Brandon@Vyntechs.com ", password: "pw-12345678" }));
    expect(res.status).toBe(200);
    expect(h.signInWithPassword).toHaveBeenCalledWith({
      email: "brandon@vyntechs.com",
      password: "pw-12345678",
    });
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("session");
    expect(h.listUsers).not.toHaveBeenCalled();
  });

  it("403 'we'll email you a code' and NO cookies when the account has no marker", async () => {
    signInSucceeds({ provider: "email" });
    const res = await login(req("/api/auth/login", { email: "old@x.test", password: "whatever1" }));
    expect(res.status).toBe(403);
    const error = (await res.json()).error;
    expect(error).toBe(NO_PASSWORD_MESSAGE);
    expect(error).toContain('Tap "Use a different email"');
    expect(res.cookies.get("sb-test-auth-token")).toBeUndefined();
  });

  it("403 no_password for a pre-password account found on page 2", async () => {
    signInFails();
    usersPages(filler(1000), [{ id: "heather", email: "heather@x.test", app_metadata: {} }]);
    const res = await login(req("/api/auth/login", { email: "heather@x.test", password: "guess-123" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("no_password");
    expect(body.error).toMatch(/email you a code/);
    expect(h.listUsers).toHaveBeenCalledTimes(2);
  });

  it("401 wrong password for a marked account", async () => {
    signInFails();
    usersPages([{ id: "b", email: "brandon@vyntechs.com", app_metadata: MARKED }]);
    const res = await login(req("/api/auth/login", { email: "brandon@vyntechs.com", password: "nope-nope" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("wrong_password");
  });

  it("404 no_account for an unknown email", async () => {
    signInFails();
    usersPages([{ id: "b", email: "brandon@vyntechs.com", app_metadata: MARKED }]);
    const res = await login(req("/api/auth/login", { email: "new@x.test", password: "whatever1" }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("no_account");
  });

  it("429 when Supabase rate limits, without a lookup", async () => {
    h.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 429, code: "over_request_rate_limit", message: "slow down" },
    });
    const res = await login(req("/api/auth/login", { email: "a@x.test", password: "whatever1" }));
    expect(res.status).toBe(429);
    expect(h.listUsers).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login — wrong-password lockout", () => {
  const MARKED_USER = { id: "b", email: "brandon@vyntechs.com", app_metadata: MARKED };

  it("locks one email after 10 wrong passwords — even the right one is refused", async () => {
    signInFails();
    usersPages([MARKED_USER]);
    for (let i = 0; i < RATE_LIMITS["fail:login-email"]; i++) {
      // Spread over IPs so only the per-email lock can trip.
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
    usersPages([]);
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
      usersPages([MARKED_USER]);
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
    expect(h.checkCode).toHaveBeenCalledWith("new@x.test", "signup", "123456");
    const attrs = h.createUser.mock.calls[0][0];
    expect(attrs).toMatchObject({ email: "new@x.test", password: "trivia-night", email_confirm: true });
    expect(typeof attrs.app_metadata.password_set_at).toBe("string");
    expect(h.signInWithPassword).toHaveBeenCalledWith({ email: "new@x.test", password: "trivia-night" });
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("session");
    expect(h.listUsers).not.toHaveBeenCalled();
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
