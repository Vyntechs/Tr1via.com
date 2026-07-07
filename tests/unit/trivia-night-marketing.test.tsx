// tests/unit/trivia-night-marketing.test.tsx
//
// Guards the public marketing landing at /trivia-night — the page a stranger
// hits from Google search. The page's ONLY job is to (a) land the positioning
// hook and (b) route the visitor to the two real entry points without ever
// touching gameplay. So this test pins the three things that, if they broke,
// would silently kill the page's purpose:
//   1. the differentiator hook headline is actually rendered (not lost in a refactor)
//   2. the primary CTA points to /login (start hosting)
//   3. the secondary CTA points to /join (enter a code) — NOT "/", which now
//      redirects to this very page, so a "/" join button would loop the player.
// It also asserts the page exports SEO metadata (title + description), since a
// landing page with no <title>/description is invisible to the search traffic
// it exists to capture.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TriviaNightPage, { metadata } from "@/app/(marketing)/trivia-night/page";
import { ThemeProvider } from "@/components/system/ThemeProvider";

// The page always renders under the root layout's ThemeProvider in production;
// the front-door toy reads that theme context, so tests supply it too.
const renderPage = () =>
  render(
    <ThemeProvider themeKey="june">
      <TriviaNightPage />
    </ThemeProvider>,
  );

describe("/trivia-night marketing landing", () => {
  it("renders the anti-cheat differentiator hook", () => {
    renderPage();
    // The sharp edge of the positioning: solo play + per-phone scramble.
    expect(screen.getByText(/nobody can cheat/i)).toBeTruthy();
  });

  it("renders the premium showpiece proof above the fold", () => {
    renderPage();
    expect(screen.getAllByText(/one press/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/three surfaces/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("landing-surface-stage")).toBeTruthy();
    expect(screen.getByText(/seasonal room system/i)).toBeTruthy();
    expect(screen.getByText(/preview Room Magic/i)).toBeTruthy();
  });

  it("explains the live room to a first-time visitor before the visual showpiece", () => {
    renderPage();
    expect(
      screen.getByRole("heading", {
        name: /host live trivia\. players answer on phones/i,
      }),
    ).toBeTruthy();
    const roleMap = screen.getByTestId("landing-role-map");
    expect(within(roleMap).getByText(/host laptop/i)).toBeTruthy();
    expect(within(roleMap).getByText(/venue tv/i)).toBeTruthy();
    expect(within(roleMap).getByText(/player phones/i)).toBeTruthy();
    expect(within(roleMap).getByText(/no extra gear/i)).toBeTruthy();
    expect(
      within(roleMap).getByText(/no app download, buzzers, tablets, or paper answer sheets/i),
    ).toBeTruthy();
    expect(screen.getByText(/for venues/i)).toBeTruthy();
    expect(screen.getByText(/for weekly hosts/i)).toBeTruthy();
  });

  it("gives venue buyers a concrete setup path without hard business claims", () => {
    renderPage();
    const buyerPath = screen.getByTestId("venue-buyer-path");
    expect(within(buyerPath).getByText(/for bars and venues/i)).toBeTruthy();
    expect(within(buyerPath).getByText(/run a weekly trivia night without buying gear/i)).toBeTruthy();
    expect(within(buyerPath).getByText(/laptop to tv/i)).toBeTruthy();
    expect(within(buyerPath).getByText(/players join by qr/i)).toBeTruthy();
    expect(within(buyerPath).getByText(/start with one test night/i)).toBeTruthy();
    expect(within(buyerPath).getByText(/no app download/i)).toBeTruthy();
    expect(within(buyerPath).getByText(/no buzzers/i)).toBeTruthy();

    const testNightCta = within(buyerPath).getByRole("link", { name: /start a test night/i });
    expect(testNightCta.getAttribute("href")).toBe("/login");
    expect(buyerPath.textContent).not.toMatch(/revenue/i);
    expect(buyerPath.textContent).not.toMatch(/guarantee/i);
  });

  it("labels the hero product diagram with real-world roles", () => {
    renderPage();
    const stage = screen.getByTestId("landing-surface-stage");
    expect(stage.getAttribute("aria-label")).toMatch(/host laptop/i);
    expect(stage.getAttribute("aria-label")).toMatch(/venue TV/i);
    expect(stage.getAttribute("aria-label")).toMatch(/player/i);
    expect(stage.textContent).not.toMatch(/live room map/i);
    expect(stage.textContent).not.toMatch(/one host tap/i);
    expect(stage.textContent).not.toMatch(/phone [abc]/i);
    expect(screen.getByText(/what the room sees/i)).toBeTruthy();
    expect(screen.getByText(/one host controls it/i)).toBeTruthy();
    expect(screen.getByText(/tap once to reveal/i)).toBeTruthy();
    expect(screen.getAllByText(/player 1 phone/i).length).toBeGreaterThan(0);
  });

  it("renders the Heather trust proof on the landing page", () => {
    renderPage();
    expect(screen.getAllByText(/Heather/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/weekly trivia host/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/first live host/i)).toBeTruthy();
  });

  it("renders the canonical proportional wordmark in the header", () => {
    renderPage();
    const home = screen.getByRole("link", { name: /tr1via home/i });
    expect(home.textContent?.replace(/\s+/g, "")).toContain("TR1VIA");
    expect(home.querySelector("[data-testid='tr1via-wordmark']")).toBeTruthy();
  });

  it("primary CTA starts hosting (links to /login)", () => {
    renderPage();
    const start = screen.getByTestId("marketing-cta-host");
    expect(start.getAttribute("href")).toBe("/login");
    expect(within(start).getByText(/host/i)).toBeTruthy();
  });

  it("secondary CTA joins a game (links to /join, not / — / now redirects here)", () => {
    renderPage();
    const join = screen.getByTestId("marketing-cta-join");
    expect(join.getAttribute("href")).toBe("/join");
  });

  it("exports SEO metadata (title + description) for search traffic", () => {
    expect(typeof metadata.title).toBe("string");
    expect((metadata.title as string).length).toBeGreaterThan(0);
    expect(typeof metadata.description).toBe("string");
    expect((metadata.description as string).length).toBeGreaterThan(0);
  });
});
