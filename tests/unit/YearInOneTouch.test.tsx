// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// The real weather engine draws to canvas (no-op'd in jsdom); stub it so the
// test focuses on the controller logic, not particle rendering.
vi.mock("@/components/system", () => ({ Weather: () => null }));

import { ThemeProvider } from "@/components/system/ThemeProvider";
import { YearInOneTouch } from "@/components/marketing/YearInOneTouch";

// The toy drives the WHOLE document's theme (so the season carries to every page
// you click into), not just its own section — so we assert on <html>.
function docTheme() {
  return document.documentElement.getAttribute("data-theme");
}

function mount(ssrThemeKey = "july") {
  return render(
    <ThemeProvider themeKey={ssrThemeKey as never}>
      <YearInOneTouch ssrThemeKey={ssrThemeKey as never}>
        <div>hero</div>
      </YearInOneTouch>
    </ThemeProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-theme");
});

describe("YearInOneTouch", () => {
  it("opens in the visitor's real current month and marks it 'you're here'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 4)); // July
    act(() => {
      mount("july");
    });
    expect(docTheme()).toBe("july");
    const jul = screen.getByRole("tab", { name: /jul/i });
    expect(jul).toHaveTextContent(/you'?re here/i);
  });

  it("repaints the WHOLE document when a month is tapped (carries across the app)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 4)); // July
    act(() => {
      mount("july");
    });
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /dec/i }));
    });
    // The document theme — not just a section — follows the pick, so /login,
    // /join, everything the visitor navigates to wears December too.
    expect(docTheme()).toBe("december");
    expect(screen.getByRole("tab", { name: /dec/i })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the visual troupe synchronized to the selected month without audio affordances", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 4)); // July
    act(() => {
      mount("july");
    });
    expect(screen.getByTestId("theme-character-band")).toHaveAttribute("data-theme-character", "july");
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /dec/i }));
    });
    expect(screen.getByTestId("theme-character-band")).toHaveAttribute("data-theme-character", "december");
    expect(screen.getByTestId("theme-character-band").textContent).not.toMatch(/sound|audio|music|speaker/i);
  });

  it("auto-drifts the document theme until first interaction, then stops", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 4)); // July
    act(() => {
      mount("july");
    });
    expect(docTheme()).toBe("july");
    act(() => {
      vi.advanceTimersByTime(2300);
    });
    expect(docTheme()).toBe("august");
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /mar/i }));
    });
    expect(docTheme()).toBe("march");
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(docTheme()).toBe("march"); // never drifts again
  });

  it("does not auto-drift when the visitor prefers reduced motion", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 4)); // July
    const mql = (q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent() {
        return false;
      },
    });
    vi.stubGlobal("matchMedia", mql as unknown as typeof window.matchMedia);
    act(() => {
      mount("july");
    });
    expect(docTheme()).toBe("july");
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(docTheme()).toBe("july");
  });
});
