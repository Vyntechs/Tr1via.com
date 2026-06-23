// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// next/font/google is a build-time transform; stub it so the RSC layout renders
// under vitest.
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
  Bricolage_Grotesque: () => ({ variable: "--font-bricolage" }),
}));

import RootLayout from "@/app/layout";

afterEach(() => vi.useRealTimers());

describe("RootLayout seasonal theming", () => {
  it("sets <html data-theme> to the current month and injects the pre-paint script", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 1)); // July
    const html = renderToStaticMarkup(
      <RootLayout>
        <div id="kid" />
      </RootLayout>,
    );
    expect(html).toContain('data-theme="july"');
    // pre-paint correction script present
    expect(html).toContain("setAttribute('data-theme'");
    // children still render
    expect(html).toContain('id="kid"');
  });

  it("falls to a valid month for any calendar month (no daylight pin)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 9)); // January
    const html = renderToStaticMarkup(
      <RootLayout>
        <div />
      </RootLayout>,
    );
    expect(html).toContain('data-theme="january"');
    expect(html).not.toContain('data-theme="daylight"');
  });
});
