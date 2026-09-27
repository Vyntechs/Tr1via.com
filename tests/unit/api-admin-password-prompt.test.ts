// Founder-only per-host "Ask to create password" switch + the founder's
// sign-in link landing.
//
// PATCH /api/admin/hosts/[id] { passwordPrompt }:
//   - non-founder → 403, nothing written
//   - founder → writes ONLY app_metadata.password_prompt server-side (GoTrue
//     merges app_metadata, so no stale read-then-write); the paywall row is
//     untouched
//   - paywall + switch together: hosts row first, then the switch; if the
//     switch fails the hosts row is put back (never half-applied)
// GET /auth/grant:
//   - a host with no password lands on /host/set-password (unless the
//     founder switched her prompt explicitly off); with one → /host
//   - the founder's own account gets app_metadata.founder at sign-in, so
//     the middleware gate never needs a hosts query

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type SetAll = (c: Array<{ name: string; value: string; options?: object }>) => void;

const h = vi.hoisted(() => ({
  requireFounder: vi.fn(),
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
  hostsUpdate: vi.fn(),
  hostsUpdateError: null as null | { message: string },
  hostRow: null as null | Record<string, unknown>,
  verifyOtp: vi.fn(),
  setAll: null as null | SetAll,
}));

vi.mock("@/lib/api/auth", () => ({ requireFounder: h.requireFounder }));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { getUserById: h.getUserById, updateUserById: h.updateUserById } },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: h.hostRow }),
        }),
      }),
      update: (patch: unknown) => {
        h.hostsUpdate(patch);
        return { eq: async () => ({ error: h.hostsUpdateError }) };
      },
    }),
  }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: SetAll } }) => {
    h.setAll = opts.cookies.setAll;
    return { auth: { verifyOtp: h.verifyOtp } };
  },
}));

import { PATCH } from "@/app/api/admin/hosts/[id]/route";
import { GET as grant } from "@/app/auth/grant/route";

// A fixed "password saved at" time for the marker (built, not a literal).
const SET_AT = new Date(Date.UTC(2026, 8, 27, 12)).toISOString();
const patchReq = (body: unknown) =>
  new NextRequest("http://test/api/admin/hosts/host-h", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: "host-h" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.requireFounder.mockResolvedValue({ ok: true, host: { id: "founder-host" } });
  h.getUserById.mockResolvedValue({
    data: { user: { id: "user-h", app_metadata: { provider: "email" } } },
    error: null,
  });
  h.updateUserById.mockResolvedValue({ data: {}, error: null });
  h.hostsUpdateError = null;
  h.hostRow = {
    id: "host-h",
    user_id: "user-h",
    role: "host",
    is_paywall_bypassed: true,
    comped_at: SET_AT,
    comped_by: "founder-host",
  };
});

describe("PATCH /api/admin/hosts/[id] passwordPrompt", () => {
  it("403 for a non-founder, nothing written", async () => {
    h.requireFounder.mockResolvedValue({ ok: false, status: 403, error: "founder only" });
    const res = await PATCH(patchReq({ passwordPrompt: "on" }), ctx);
    expect(res.status).toBe(403);
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it("writes only password_prompt to the host's app_metadata (no stale read-then-write)", async () => {
    const res = await PATCH(patchReq({ passwordPrompt: "on" }), ctx);
    expect(res.status).toBe(200);
    expect(h.updateUserById).toHaveBeenCalledWith("user-h", {
      app_metadata: { password_prompt: "on" },
    });
    expect(h.getUserById).not.toHaveBeenCalled();
    expect(h.hostsUpdate).not.toHaveBeenCalled();
  });

  it("paywall + switch: hosts row first, then the switch", async () => {
    const res = await PATCH(patchReq({ isPaywallBypassed: false, passwordPrompt: "off" }), ctx);
    expect(res.status).toBe(200);
    expect(h.hostsUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      h.updateUserById.mock.invocationCallOrder[0],
    );
  });

  it("puts the paywall back when the switch can't be saved", async () => {
    h.updateUserById.mockResolvedValue({ data: null, error: { message: "auth down" } });
    const res = await PATCH(patchReq({ isPaywallBypassed: false, passwordPrompt: "on" }), ctx);
    expect(res.status).toBe(500);
    expect(h.hostsUpdate).toHaveBeenCalledTimes(2);
    expect(h.hostsUpdate.mock.calls[1][0]).toEqual({
      is_paywall_bypassed: true,
      comped_at: SET_AT,
      comped_by: "founder-host",
    });
  });

  it("never touches the switch when the paywall write fails", async () => {
    h.hostsUpdateError = { message: "db down" };
    const res = await PATCH(patchReq({ isPaywallBypassed: false, passwordPrompt: "on" }), ctx);
    expect(res.status).toBe(500);
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it("rejects anything but on/off", async () => {
    const res = await PATCH(patchReq({ passwordPrompt: "maybe" }), ctx);
    expect(res.status).toBe(400);
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it("still toggles the paywall exactly as before", async () => {
    const res = await PATCH(patchReq({ isPaywallBypassed: false }), ctx);
    expect(res.status).toBe(200);
    expect(h.hostsUpdate).toHaveBeenCalledWith({
      is_paywall_bypassed: false,
      comped_at: null,
      comped_by: null,
    });
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it("400 for an empty body", async () => {
    expect((await PATCH(patchReq({}), ctx)).status).toBe(400);
  });
});

describe("GET /auth/grant", () => {
  const TOKEN = "t".repeat(40);
  const grantReq = () => new NextRequest(`http://test/auth/grant?t=${TOKEN}`);

  function verifiedAs(appMetadata: Record<string, unknown>) {
    h.verifyOtp.mockImplementation(async () => {
      h.setAll?.([{ name: "sb-test-auth-token", value: "session", options: { path: "/" } }]);
      return { data: { user: { id: "user-h", app_metadata: appMetadata } }, error: null };
    });
  }

  it("lands a host with no password on set-password, signed in", async () => {
    verifiedAs({});
    const res = await grant(grantReq());
    expect(res.headers.get("location")).toBe("http://test/host/set-password?next=%2Fhost");
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("session");
  });

  it("goes straight to /host once a password exists", async () => {
    verifiedAs({ password_set_at: SET_AT });
    const res = await grant(grantReq());
    expect(res.headers.get("location")).toBe("http://test/host");
  });

  it("respects the founder's explicit off switch", async () => {
    verifiedAs({ password_prompt: "off" });
    const res = await grant(grantReq());
    expect(res.headers.get("location")).toBe("http://test/host");
  });

  it("marks the founder's own account at sign-in (only the one key)", async () => {
    h.hostRow = { role: "founder" };
    verifiedAs({});
    await grant(grantReq());
    expect(h.updateUserById).toHaveBeenCalledWith("user-h", { app_metadata: { founder: true } });
  });

  it("never marks anyone else, and skips the lookup once a password exists", async () => {
    verifiedAs({});
    await grant(grantReq());
    expect(h.updateUserById).not.toHaveBeenCalled();
    h.hostRow = { role: "founder" };
    verifiedAs({ password_set_at: SET_AT });
    await grant(grantReq());
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it("an expired link goes back to /login with no session", async () => {
    h.verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    const res = await grant(grantReq());
    expect(res.headers.get("location")).toMatch(/^http:\/\/test\/login\?error=/);
    expect(res.cookies.get("sb-test-auth-token")).toBeUndefined();
  });
});
