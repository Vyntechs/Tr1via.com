// tests/unit/trivia-night-marketing.test.tsx
//
// Guards the public marketing landing at /trivia-night — the page a stranger
// hits from Google search. The page's ONLY job is to (a) land the positioning
// hook and (b) route the visitor to the two real entry points without ever
// touching gameplay. So this test pins the three things that, if they broke,
// would silently kill the page's purpose:
//   1. the differentiator hook headline is actually rendered (not lost in a refactor)
//   2. the primary CTA points to /login (start hosting)
//   3. the secondary CTA points to / (join a game)
// It also asserts the page exports SEO metadata (title + description), since a
// landing page with no <title>/description is invisible to the search traffic
// it exists to capture.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TriviaNightPage, { metadata } from "@/app/(marketing)/trivia-night/page";

describe("/trivia-night marketing landing", () => {
  it("renders the anti-cheat differentiator hook", () => {
    render(<TriviaNightPage />);
    // The sharp edge of the positioning: solo play + per-phone scramble.
    expect(screen.getByText(/nobody can cheat/i)).toBeTruthy();
  });

  it("primary CTA starts hosting (links to /login)", () => {
    render(<TriviaNightPage />);
    const start = screen.getByTestId("marketing-cta-host");
    expect(start.getAttribute("href")).toBe("/login");
    expect(within(start).getByText(/host/i)).toBeTruthy();
  });

  it("secondary CTA joins a game (links to /)", () => {
    render(<TriviaNightPage />);
    const join = screen.getByTestId("marketing-cta-join");
    expect(join.getAttribute("href")).toBe("/");
  });

  it("exports SEO metadata (title + description) for search traffic", () => {
    expect(typeof metadata.title).toBe("string");
    expect((metadata.title as string).length).toBeGreaterThan(0);
    expect(typeof metadata.description).toBe("string");
    expect((metadata.description as string).length).toBeGreaterThan(0);
  });
});
