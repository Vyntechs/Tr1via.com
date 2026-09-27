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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type SetAll = (c: Array<{ name: string; value: string; options?: object }>) => void;

const h = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  listUsers: vi.fn(),
  createUser: vi.fn(),
  checkCode: vi.fn(),
  setAll: null as null | SetAll,
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

vi.mock("@/lib/auth/email-code-flow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/email-code-flow")>()),
  checkCode: h.checkCode,
}));

import { POST as login } from "@/app/api/auth/login/route";
import { POST as signUp } from "@/app/api/auth/host-access/route";

const req = (path: string, body: unknown) =>
  new NextRequest(`http://test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    expect((await res.json()).error).toBe(
      "This account doesn't have a password yet. Go back, type your email, and we'll email you a code.",
    );
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
