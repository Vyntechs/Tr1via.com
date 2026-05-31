// tests/unit/tv-finale-winner-hooks.test.tsx
//
// Regression test for a TV-screen crash (React #310) — the SAME class as the
// #67 TVPage crash, but on the finale/winner screen.
//
// `TVFinaleWinnerInner` called `useTheme`, `useState`, and `useEffect` AFTER an
// `if (!winner) return null` early return. While `winner` was absent the early
// return fired and those three hooks never ran; the moment real finale data
// arrived (`winner` populated) the early return stopped firing and the hooks
// suddenly ran — the hook COUNT changed between renders, so React threw
// "Rendered more hooks than during the previous render" (minified #310 in
// prod) and the venue TV went blank at the climax of the night.
//
// This test drives `TVFinaleWinner` through that exact transition (no winner →
// winner) and asserts React reports NO hook-order violation. With the hooks
// left below the early return it fails; with them hoisted above it passes.

import { Component, type ReactNode } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Substrings React uses when it detects a rules-of-hooks / hook-count
// violation, across React builds (dev internal diagnostic + user-facing).
const HOOK_VIOLATION_SIGNALS = [
  "Expected static flag was missing",
  "Rendered more hooks than during the previous render",
  "Rendered fewer hooks than expected",
  "change in the order of Hooks",
  "Rules of Hooks",
];

function isHookViolation(message: string): boolean {
  return HOOK_VIOLATION_SIGNALS.some((s) => message.includes(s));
}

// `Weather` paints canvas/lightning via browser APIs jsdom lacks; no-op it so
// an unrelated throw can't masquerade as (or mask) the hooks crash. Keep the
// real ThemeProvider/useTheme — those are exactly what we're exercising.
vi.mock("@/components/system", async (importActual) => {
  const actual = await importActual<typeof import("@/components/system")>();
  return { ...actual, Weather: () => null };
});

import { TVFinaleWinner, type TVFinaleWinnerData } from "@/components/tv/TVFinaleWinner";

const WINNER: TVFinaleWinnerData = {
  name: "Dana",
  score: 8120,
  correct: 11,
  of: 12,
  streak: 5,
  fastest: "0.9s",
};

// In prod the hook-count drift throws (React #310) and React routes that
// render-phase throw to the nearest error boundary — a blank TV. Catch it so
// that path is asserted too, not only the console path.
let caughtError: Error | null = null;

class CatchBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    caughtError = error;
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

afterEach(() => {
  caughtError = null;
  vi.restoreAllMocks();
});

describe("TVFinaleWinner hook order across no-winner → winner", () => {
  it("does not violate the rules of hooks when finale data arrives", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });

    // Same component, same tree position, same themeKey identity, so React
    // UPDATES the existing instance and compares its hook count — only the
    // `winner` prop flips from undefined to populated.
    const tree = (winner: TVFinaleWinnerData | undefined) => (
      <CatchBoundary>
        <TVFinaleWinner themeKey="june" winner={winner} />
      </CatchBoundary>
    );

    // First render: no winner yet (early return fires; pre-fix the three hooks
    // below it are skipped).
    let rerender!: (ui: React.ReactElement) => void;
    await act(async () => {
      const result = render(tree(undefined));
      rerender = result.rerender;
    });

    // Second render: finale data arrives. Pre-fix, the previously skipped hooks
    // now run → hook count changes → React reports a rules-of-hooks violation.
    await act(async () => {
      rerender(tree(WINNER));
    });

    const hookViolations = errors.filter(isHookViolation);
    expect(
      hookViolations,
      `React reported a rules-of-hooks violation across the no-winner → winner transition:\n${hookViolations.join("\n")}`,
    ).toEqual([]);
    expect(caughtError).toBeNull();
  });
});
