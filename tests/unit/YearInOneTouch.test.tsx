// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// The real weather engine draws to canvas (no-op'd in jsdom); stub it so the
// test focuses on the controller logic, not particle rendering.
vi.mock("@/components/system", () => ({ Weather: () => null }));

import { YearInOneTouch } from "@/components/marketing/YearInOneTouch";

function theme() {
  return screen.getByTestId("year-in-one-touch").getAttribute("data-theme");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("YearInOneTouch", () => {
  it("opens in the visitor's real current month and marks it 'you're here'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 4)); // July
    act(() => {
      render(
        <YearInOneTouch ssrThemeKey="july">
          <div>hero</div>
        </YearInOneTouch>,
      );
    });
    expect(theme()).toBe("july");
    // The 'you're here' marker rides the real month (July).
    const jul = screen.getByRole("tab", { name: /jul/i });
    expect(jul).toHaveTextContent(/you'?re here/i);
  });

  it("repaints the whole hero to a month when its cell is tapped", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 4)); // July
    act(() => {
      render(
        <YearInOneTouch ssrThemeKey="july">
          <div>hero</div>
        </YearInOneTouch>,
      );
    });
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /dec/i }));
    });
    expect(theme()).toBe("december");
    expect(screen.getByRole("tab", { name: /dec/i })).toHaveAttribute("aria-selected", "true");
  });

  it("auto-drifts through the months until first interaction, then stops", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 4)); // July
    act(() => {
      render(
        <YearInOneTouch ssrThemeKey="july">
          <div>hero</div>
        </YearInOneTouch>,
      );
    });
    expect(theme()).toBe("july");
    // Drifts forward on its own.
    act(() => {
      vi.advanceTimersByTime(2300);
    });
    expect(theme()).toBe("august");
    // A tap takes control and freezes the drift.
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /mar/i }));
    });
    expect(theme()).toBe("march");
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(theme()).toBe("march"); // never drifts again
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
      render(
        <YearInOneTouch ssrThemeKey="july">
          <div>hero</div>
        </YearInOneTouch>,
      );
    });
    expect(theme()).toBe("july");
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(theme()).toBe("july"); // stays put — no ambient drift
  });
});
