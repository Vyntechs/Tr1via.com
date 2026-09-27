// @vitest-environment node
// middleware.ts — the "Create your password" gate as wired into requests.
//
// Proves: the founder (app_metadata.founder) without a password is sent to
// /host/set-password (with next); in-show routes pass straight through; an
// existing host with no switch set (Heather) passes through; a host whose
// switch is on is sent; the prompt page itself never loops; API routes
// untouched. And NO page load ever queries the hosts table.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  hostRole: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: h.getUser },
    from: (table: string) => {
      h.from(table);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: h.hostRole(), error: null }),
          }),
        }),
      };
    },
  }),
}));

import { middleware } from "@/middleware";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

// A fixed "password saved at" time for the marker (built, not a literal).
const SET_AT = new Date(Date.UTC(2026, 8, 27, 12)).toISOString();
function asUser(appMetadata: Record<string, unknown>) {
  h.getUser.mockResolvedValue({ data: { user: { id: "u1", app_metadata: appMetadata } } });
}

const run = (path: string, cookie?: string) =>
  middleware(new NextRequest(`http://test${path}`, cookie ? { headers: { cookie } } : undefined));

function location(res: Response): string | null {
  const loc = res.headers.get("location");
  return loc ? loc.replace("http://test", "") : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.hostRole.mockReturnValue({ role: "host" });
});

afterEach(() => {
  // No gate decision may cost a database round-trip on a page load.
  expect(h.from).not.toHaveBeenCalled();
});

describe("middleware password gate", () => {
  it("sends the founder with no password to set-password, keeping next", async () => {
    asUser({ founder: true });
    const res = await run("/host");
    expect(location(res)).toBe("/host/set-password?next=%2Fhost");
  });

  it.each(["/host/live/night-1", "/host/phone/night-1"])(
    "never interrupts %s",
    async (path) => {
      asUser({ password_prompt: "on" });
      const res = await run(path);
      expect(location(res)).toBeNull();

      asUser({ founder: true });
      const res2 = await run(path);
      expect(location(res2)).toBeNull();
    },
  );

  it("lets an existing host through when the founder hasn't switched her prompt on", async () => {
    asUser({});
    const res = await run("/host/setup/night-1");
    expect(location(res)).toBeNull();
    expect(location(await run("/host"))).toBeNull();
  });

  it("sends a host whose switch is on, without a hosts lookup", async () => {
    asUser({ password_prompt: "on" });
    const res = await run("/host/setup/night-1");
    expect(location(res)).toBe(`/host/set-password?next=${encodeURIComponent("/host/setup/night-1")}`);
  });

  it("switch off wins for everyone", async () => {
    asUser({ password_prompt: "off", founder: true });
    expect(location(await run("/host"))).toBeNull();
  });

  it("never redirects the set-password page to itself", async () => {
    asUser({ password_prompt: "on" });
    expect(location(await run("/host/set-password"))).toBeNull();
  });

  it("stops once the password marker exists", async () => {
    asUser({ password_set_at: SET_AT, password_prompt: "on", founder: true });
    expect(location(await run("/host"))).toBeNull();
  });

  it("still bounces signed-out visitors to /login", async () => {
    h.getUser.mockResolvedValue({ data: { user: null } });
    expect(location(await run("/host/setup/night-1"))).toBe("/login?next=%2Fhost%2Fsetup%2Fnight-1");
  });

  it("'Not now' (tr1via_pw_later) lets her through until her next sign-in", async () => {
    asUser({ password_prompt: "on" });
    expect(location(await run("/host", "tr1via_pw_later=1"))).toBeNull();
    asUser({ founder: true });
    expect(location(await run("/host/setup/night-1", "tr1via_pw_later=1"))).toBeNull();
    // Without the cookie (a fresh sign-in clears it) she's asked again.
    expect(location(await run("/host"))).toBe("/host/set-password?next=%2Fhost");
  });

  it("leaves API routes alone", async () => {
    asUser({ password_prompt: "on" });
    expect(location(await run("/api/nights"))).toBeNull();
    expect(h.getUser).not.toHaveBeenCalled();
  });
});
