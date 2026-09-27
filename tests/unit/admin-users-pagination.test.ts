// lib/auth/admin-users — reading every Supabase auth user, no 200 cap.
//
// Proves: walks past page 1; honours the x-total-count total when the server
// hands back fewer than requested per page; stops on a short or empty page
// when no total is given; surfaces errors instead of a partial list.

import { describe, expect, it, vi } from "vitest";
import { findAuthUserByEmail, listAllAuthUsers } from "@/lib/auth/admin-users";

type U = { id: string; email: string };
const users = (from: number, n: number): U[] =>
  Array.from({ length: n }, (_, i) => ({ id: `u${from + i}`, email: `u${from + i}@x.test` }));

function adminWith(pages: U[][], total?: number) {
  const listUsers = vi.fn(async ({ page }: { page: number }) => ({
    data: { users: pages[page - 1] ?? [], ...(total ? { total } : {}) },
    error: null,
  }));
  return { admin: { auth: { admin: { listUsers } } } as never, listUsers };
}

describe("listAllAuthUsers", () => {
  it("reads every full page until a short one", async () => {
    const { admin, listUsers } = adminWith([users(0, 1000), users(1000, 1000), users(2000, 5)]);
    const res = await listAllAuthUsers(admin);
    expect(res.ok && res.users.length).toBe(2005);
    expect(listUsers).toHaveBeenCalledTimes(3);
  });

  it("uses the total when the server returns fewer per page than asked", async () => {
    const { admin, listUsers } = adminWith([users(0, 50), users(50, 50), users(100, 20)], 120);
    const res = await listAllAuthUsers(admin);
    expect(res.ok && res.users.length).toBe(120);
    expect(listUsers).toHaveBeenCalledTimes(3);
  });

  it("returns an error rather than a partial list", async () => {
    const listUsers = vi.fn(async () => ({ data: null, error: { message: "down" } }));
    const res = await listAllAuthUsers({ auth: { admin: { listUsers } } } as never);
    expect(res).toEqual({ ok: false, error: "down" });
  });
});

describe("findAuthUserByEmail", () => {
  it("finds a user past the old 200 cap, case-insensitively", async () => {
    const pages = [users(0, 1000), [{ id: "heather", email: "Heather@Example.com" }]];
    const { admin } = adminWith(pages);
    const res = await findAuthUserByEmail(admin, " heather@example.com ");
    expect(res.ok && res.user?.id).toBe("heather");
  });

  it("returns null when nobody matches", async () => {
    const { admin, listUsers } = adminWith([users(0, 3)]);
    const res = await findAuthUserByEmail(admin, "nobody@x.test");
    expect(res).toEqual({ ok: true, user: null });
    expect(listUsers).toHaveBeenCalledTimes(1);
  });
});
