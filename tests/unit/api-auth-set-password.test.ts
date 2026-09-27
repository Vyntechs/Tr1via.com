// Route test — POST /api/auth/set-password.
//
// Proves: no session → 401 and nothing written; bad input → 400 with a
// plain-English message; success writes the password AND the
// password_set_at marker server-side while keeping existing app_metadata
// (the founder's password_prompt switch), then refreshes the session with
// the new password; Supabase rate limits → 429; saving clears a
// wrong-password lockout on her email.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { memoryRateStore } from "./helpers/memory-rate-store";
import { RATE_LIMITS, isOverLimit, recordEvent } from "@/lib/auth/rate-limits";

type SetAll = (c: Array<{ name: string; value: string; options?: object }>) => void;

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUserById: vi.fn(),
  signInWithPassword: vi.fn(),
  setAll: null as null | SetAll,
  rates: null as unknown,
}));

vi.mock("@/lib/auth/rate-limit-store", () => ({
  supabaseRateStore: () => h.rates,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: SetAll } }) => {
    h.setAll = opts.cookies.setAll;
    return { auth: { signInWithPassword: h.signInWithPassword } };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: async () => ({ auth: { getUser: h.getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({ auth: { admin: { updateUserById: h.updateUserById } } }),
}));

import { POST } from "@/app/api/auth/set-password/route";

const req = (body: unknown) =>
  new NextRequest("http://test/api/auth/set-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const USER = {
  id: "user-1",
  email: "heather@example.com",
  app_metadata: { provider: "email", password_prompt: "on" },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.rates = memoryRateStore();
  h.getUser.mockResolvedValue({ data: { user: USER }, error: null });
  h.updateUserById.mockResolvedValue({ data: { user: USER }, error: null });
  h.signInWithPassword.mockImplementation(async () => {
    h.setAll?.([{ name: "sb-test-auth-token", value: "fresh-session", options: { path: "/" } }]);
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

  it("saves the password + marker server-side and keeps existing app_metadata", async () => {
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    expect(res.status).toBe(200);
    expect(h.updateUserById).toHaveBeenCalledTimes(1);
    const [id, attrs] = h.updateUserById.mock.calls[0];
    expect(id).toBe("user-1");
    expect(attrs.password).toBe("trivia-night");
    expect(attrs.app_metadata).toMatchObject({ provider: "email", password_prompt: "on" });
    expect(typeof attrs.app_metadata.password_set_at).toBe("string");
    expect(Number.isNaN(Date.parse(attrs.app_metadata.password_set_at))).toBe(false);
  });

  it("signs the host in again with the new password so she stays signed in", async () => {
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    expect(res.status).toBe(200);
    expect(h.signInWithPassword).toHaveBeenCalledWith({
      email: "heather@example.com",
      password: "trivia-night",
    });
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("fresh-session");
  });

  it("still reports success if the fresh sign-in fails (password is saved)", async () => {
    h.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { status: 500 } });
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    expect(res.status).toBe(200);
    expect(res.cookies.get("sb-test-auth-token")).toBeUndefined();
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

  it("clears a wrong-password lockout on her email once the new password is saved", async () => {
    for (let i = 0; i < RATE_LIMITS["fail:login-email"]; i++) await recordEvent("fail:login-email", USER.email);
    expect(await isOverLimit("fail:login-email", USER.email)).toBe(true);
    const res = await POST(req({ password: "trivia-night", confirm: "trivia-night" }));
    expect(res.status).toBe(200);
    expect(await isOverLimit("fail:login-email", USER.email)).toBe(false);
  });
});
