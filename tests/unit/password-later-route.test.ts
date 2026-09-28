// @vitest-environment node
// GET /auth/password-later — "Not now" on "Create your password".
//
// Proves: sets the browser-session "not now" cookie (no Max-Age, httpOnly)
// and sends her to /host by default; a hand-typed next can't leave the host
// pages, loop back to the prompt, or land in a show path through here.

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/auth/password-later/route";

const go = (qs: string) => GET(new NextRequest(`http://test/auth/password-later${qs}`));

describe("GET /auth/password-later", () => {
  it("remembers 'not now' for this browser session and goes to /host", async () => {
    const res = await go("?next=%2Fhost");
    expect(res.headers.get("location")).toBe("http://test/host");
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("tr1via_pw_later="));
    expect(cookie).toMatch(/^tr1via_pw_later=1;/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
  });

  it.each([
    ["", "http://test/host"],
    ["?next=https%3A%2F%2Fevil.test", "http://test/host"],
    ["?next=%2Fhost%2Fset-password", "http://test/host"],
    ["?next=%2Fhost%2Fsetup%2Fn1", "http://test/host/setup/n1"],
  ])("next %s → %s", async (qs, where) => {
    expect((await go(qs)).headers.get("location")).toBe(where);
  });
});
