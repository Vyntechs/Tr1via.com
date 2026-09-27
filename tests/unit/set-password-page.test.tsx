// @vitest-environment node
// app/host/set-password/page.tsx — the server wrapper.
//
// Proves: "Not now" goes back to the page the gate interrupted (the safe
// `next`), falling back to /host for a missing, unsafe or in-show `next`;
// and while a show is running the page skips itself to that same place.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ running: false as boolean | null, redirect: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    h.redirect(to);
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", app_metadata: {} } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock("@/lib/auth/live-show", () => ({ hostHasRunningShow: async () => h.running }));

import SetPasswordPage from "@/app/host/set-password/page";

const later = (next: string) => `/auth/password-later?next=${encodeURIComponent(next)}`;

async function laterHrefFor(next?: string): Promise<string> {
  const el = (await SetPasswordPage({
    searchParams: Promise.resolve(next === undefined ? {} : { next }),
  })) as { props: { laterHref: string; returnPath: string } };
  return el.props.laterHref;
}

beforeEach(() => {
  h.running = false;
  h.redirect.mockClear();
});

describe("set-password page: 'Not now' target", () => {
  it("returns to the page the gate interrupted", async () => {
    expect(await laterHrefFor("/host/setup/n1?slot=2")).toBe(later("/host/setup/n1?slot=2"));
  });

  it.each([
    [undefined, "no next"],
    ["https://evil.example/x", "off-site"],
    ["/host/live/n1", "in-show"],
    ["/host/set-password", "itself"],
  ] as const)("falls back to /host (%s: %s)", async (next: string | undefined, _why: string) => {
    expect(await laterHrefFor(next)).toBe(later("/host"));
  });

  it("a running show skips the page to that same place", async () => {
    h.running = true;
    await expect(laterHrefFor("/host/setup/n1")).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirect).toHaveBeenCalledWith(later("/host/setup/n1"));
  });
});
