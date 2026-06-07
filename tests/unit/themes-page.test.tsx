// tests/unit/themes-page.test.tsx
//
// Guards the dedicated /themes gallery page: it must (a) carry SEO metadata so
// the seasonal-themes keywords are indexable, (b) actually render the wall of
// months, and (c) link back to the marketing pitch so the page isn't a dead end.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ThemesPage, { metadata } from "@/app/(marketing)/themes/page";

describe("/themes gallery page", () => {
  it("renders the hero hook and the month wall", () => {
    render(<ThemesPage />);
    expect(screen.getByText(/the color year/i)).toBeTruthy();
    // Two months from opposite ends of the wall prove the showcase mounted.
    expect(screen.getByText("January")).toBeTruthy();
    expect(screen.getByText("December")).toBeTruthy();
  });

  it("links back to the marketing overview (not a dead end)", () => {
    render(<ThemesPage />);
    const back = screen.getByTestId("themes-back-to-marketing");
    expect(back.getAttribute("href")).toBe("/trivia-night");
  });

  it("exports SEO metadata (title + description) for search traffic", () => {
    expect(typeof metadata.title).toBe("string");
    expect((metadata.title as string).length).toBeGreaterThan(0);
    expect(typeof metadata.description).toBe("string");
    expect((metadata.description as string).length).toBeGreaterThan(0);
  });
});
