// Route test — POST /api/auth/set-password.
//
// Proves: no session → 401 and nothing written; bad input → 400 with a
// plain-English message; success writes the password AND the
// password_set_at marker server-side while keeping existing app_metadata
// (only the marker key is sent — GoTrue merges app_metadata — so the
// founder's password_prompt switch can't be undone by a stale copy), then
// signs this device in again with the new password and sends ONLY that new
// session's cookies (never a refreshed copy of the old, now-dead session);
// if that sign-in fails → 409 "sign_in_again" with a /login link and the
// dead cookies cleared; Supabase rate limits → 429; saving clears a
// wrong-password lockout on her email; and it REFUSES while one of her
// nights is running (409 "show_running", nothing written, no session
// touched) or when that can't be checked (503) — so no path can sign a
// running show out.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { memoryRateStore } from "./helpers/memory-rate-store";
import { RATE_LIMITS, ipEmailKey, isOverLimit, recordEvent } from "@/lib/auth/rate-limits";
import { fakeShowDb, openedNight, type FakeShowDb } from "./helpers/fake-show-db";

type SetAll = (c: Array<{ name: string; value: string; options?: object }>) => void;

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUserById: vi.fn(),
  signInWithPassword: vi.fn(),
  setAll: null as null | SetAll,
  rates: null as unknown,
  db: null as null | FakeShowDb,
  nights: [] as object[],
}));

vi.mock("@/lib/auth/rate-limit-store", () => ({
  supabaseRateStore: () => h.rates,
}));

// Every route-handler client gets its own cookie sink, handed to the mocks
// so a test can make getUser() "refresh" the old session.
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: SetAll } }) => {
    const setAll = opts.cookies.setAll;
    return {
      auth: {
        getUser: () => h.getUser(setAll),
        signInWithPassword: (creds: unknown) => h.signInWithPassword(creds, setAll),
      },
    };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => h.db!.from(t),
    auth: { admin: { updateUserById: h.updateUserById } },
  }),
}));

import { POST } from "@/app/api/auth/set-password/route";

const req = (body: unknown) =>
  new NextRequest("http://test/api/auth/set-password", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "sb-test-auth-token=old-session" },
    body: JSON.stringify(body),
  });

/** getUser() refreshes the old session's tokens, as supabase-js does near expiry. */
function oldSessionRefreshes() {
  h.getUser.mockImplementation(async (setAll: SetAll) => {
    setAll([{ name: "sb-test-auth-token", value: "refreshed-old-session", options: { path: "/" } }]);
    return { data: { user: USER }, error: null };
  });
}

function setCookies(res: Response, name: string): string[] {
  return res.headers.getSetCookie().filter((c) => c.startsWith(`${name}=`));
}

const USER = {
  id: "user-1",
  email: "heather@example.com",
  app_metadata: { provider: "email", password_prompt: "on" },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.rates = memoryRateStore();
  // Heather's host row; last week's night was never closed (like prod).
  h.nights = [openedNight("host-h", 24 * 8)]; // 8 days: exactly a week ago would make today show day
  h.db = fakeShowDb({
    hosts: () => [{ id: "host-h", user_id: USER.id }],
    nights: () => h.nights as never,
    games: () => [],
  });
  h.getUser.mockImplementation(async () => ({ data: { user: USER }, error: null }));
  h.updateUserById.mockResolvedValue({ data: { user: USER }, error: null });
  h.signInWithPassword.mockImplementation(async (_creds: unknown, setAll: SetAll) => {
    setAll([{ name: "sb-test-auth-token", value: "fresh-session", options: { path: "/" } }]);
    return { data: { user: USER }, error: null };
  });
});

describe("POST /api/auth/set-password", () => {
  it("401 when not signed in, and writes nothing", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/sign in again/i);
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it("400 with a plain message when the password is too short", async () => {
    const res = await POST(req({ password: "short", confirm: "short" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("password");
    expect(body.error).toMatch(/at least 8/);
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it("400 when the two boxes don't match", async () => {
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-nite" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("confirm");
    expect(body.error).toMatch(/don't match/);
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it("400 on a missing / non-JSON body", async () => {
    const bad = new NextRequest("http://test/api/auth/set-password", {
      method: "POST",
      body: "not json",
    });
    expect((await POST(bad)).status).toBe(400);
  });

  it("saves the password + marker server-side, sending only the marker key", async () => {
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    expect(res.status).toBe(200);
    expect(h.updateUserById).toHaveBeenCalledTimes(1);
    const [id, attrs] = h.updateUserById.mock.calls[0];
    expect(id).toBe("user-1");
    expect(attrs.password).toBe("trivia-night");
    // GoTrue merges app_metadata: sending a stale copy of password_prompt
    // could undo a switch the founder flipped a moment ago.
    expect(Object.keys(attrs.app_metadata)).toEqual(["password_set_at"]);
    expect(Number.isNaN(Date.parse(attrs.app_metadata.password_set_at))).toBe(false);
  });

  it("signs the host in again with the new password so she stays signed in", async () => {
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    expect(res.status).toBe(200);
    expect(h.signInWithPassword.mock.calls[0][0]).toEqual({
      email: "heather@example.com",
      password: "trivia-night",
    });
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("fresh-session");
  });

  it("sends ONLY the new session's cookies, even when the session check refreshed the old one", async () => {
    oldSessionRefreshes();
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    expect(res.status).toBe(200);
    const sent = setCookies(res, "sb-test-auth-token");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^sb-test-auth-token=fresh-session;/);
  });

  it("409 'Your password is saved. Sign in with it now.' + /login link when signing back in fails", async () => {
    oldSessionRefreshes();
    h.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { status: 500, message: "down" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night", next: "/host/setup/n1" }));
    log.mockRestore();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({
      code: "sign_in_again",
      error: "Your password is saved. Sign in with it now.",
      redirect: `/login?notice=password-saved&next=${encodeURIComponent("/host/setup/n1")}`,
    });
    // The password WAS saved.
    expect(h.updateUserById).toHaveBeenCalledTimes(1);
    // The old session is dead: its cookie is cleared, never refreshed.
    const sent = setCookies(res, "sb-test-auth-token");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^sb-test-auth-token=;/);
    expect(sent[0]).toMatch(/Max-Age=0/i);
  });

  it("the /login link never leaves the host pages", async () => {
    h.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { status: 500 } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night", next: "https://evil.test" }));
    log.mockRestore();
    expect((await res.json()).redirect).toBe("/login?notice=password-saved&next=%2Fhost");
  });

  it("keeps a refreshed old session on an early error (the old session is still alive then)", async () => {
    oldSessionRefreshes();
    const res = await POST(req({ password: "short", confirm: "short" }));
    expect(res.status).toBe(400);
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("refreshed-old-session");
  });

  it("429 with a wait-a-minute message when Supabase rate limits", async () => {
    h.updateUserById.mockResolvedValue({
      data: null,
      error: { status: 429, code: "over_request_rate_limit", message: "rate limit" },
    });
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/wait a minute/i);
  });

  it("500 with a friendly message on any other Supabase error", async () => {
    h.updateUserById.mockResolvedValue({ data: null, error: { status: 500, message: "boom" } });
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toMatch(/boom/);
  });

  it("clears a wrong-password lockout on her email (and on this network) once the new password is saved", async () => {
    // No IP header in these requests, so the network key is "unknown".
    const pair = ipEmailKey("unknown", USER.email);
    for (let i = 0; i < RATE_LIMITS["fail:login-email"]; i++) await recordEvent("fail:login-email", USER.email);
    for (let i = 0; i < RATE_LIMITS["fail:login-ip-email"]; i++) await recordEvent("fail:login-ip-email", pair);
    expect(await isOverLimit("fail:login-email", USER.email)).toBe(true);
    expect(await isOverLimit("fail:login-ip-email", pair)).toBe(true);
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    expect(res.status).toBe(200);
    expect(await isOverLimit("fail:login-email", USER.email)).toBe(false);
    expect(await isOverLimit("fail:login-ip-email", pair)).toBe(false);
  });

  it("REFUSES while one of her nights is running: nothing saved, no session touched", async () => {
    h.nights = [openedNight("host-h", 1)];
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("show_running");
    expect(body.error).toBe(
      "Your show is running right now. Create your password after the show, so your TV screen and phone stay signed in.",
    );
    expect(h.updateUserById).not.toHaveBeenCalled();
    expect(h.signInWithPassword).not.toHaveBeenCalled();
    // Her session cookie is left alone.
    expect(setCookies(res, "sb-test-auth-token")).toHaveLength(0);
  });

  it("works again once the show is closed", async () => {
    h.nights = [openedNight("host-h", 1, { closed_at: new Date().toISOString() })];
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    expect(res.status).toBe(200);
    expect(h.updateUserById).toHaveBeenCalledTimes(1);
  });

  it("refuses (try again) when it can't check for a running show", async () => {
    h.db!.fail = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    log.mockRestore();
    expect(res.status).toBe(503);
    expect(h.updateUserById).not.toHaveBeenCalled();
  });
});
