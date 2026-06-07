// tests/unit/root-redirect.test.tsx
//
// The root URL `/` no longer renders the room-code form — it redirects to the
// public marketing page at /trivia-night. This guards that contract: if someone
// turns app/page.tsx back into a rendered page (or points the redirect at the
// wrong route), the player/host front door silently changes and this fails.
//
// next/navigation's redirect() throws internally to halt rendering, so we mock
// it to a plain spy and assert the target instead of letting it throw.

import { describe, expect, it, vi, beforeEach } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

import RootPage from "@/app/page";

describe("root URL `/`", () => {
  beforeEach(() => redirect.mockClear());

  it("redirects to the public marketing page", () => {
    RootPage();
    expect(redirect).toHaveBeenCalledWith("/trivia-night");
  });

  it("redirects exactly once (no double-redirect / fall-through render)", () => {
    RootPage();
    expect(redirect).toHaveBeenCalledTimes(1);
  });
});
