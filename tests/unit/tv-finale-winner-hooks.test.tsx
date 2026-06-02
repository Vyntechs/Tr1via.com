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

// `Weather` paints canvas/lightning via browser APIs jsdom lacks; replace it
// with a prop-recording stub so (a) an unrelated throw can't masquerade as (or
// mask) the hooks crash, and (b) the finale-lightning test can observe the
// `lightningTriggerCount` the real component feeds a *mounted* Weather over
// time. Keep the real ThemeProvider/useTheme — those are exactly what we're
// exercising. `vi.hoisted` lets the (hoisted) mock factory reach the array.
const { weatherTriggerCounts } = vi.hoisted(() => ({
  weatherTriggerCounts: [] as Array<number | undefined>,
}));
vi.mock("@/components/system", async (importActual) => {
  const actual = await importActual<typeof import("@/components/system")>();
  return {
    ...actual,
    Weather: ({ lightningTriggerCount }: { lightningTriggerCount?: number }) => {
      weatherTriggerCounts.push(lightningTriggerCount);
      return null;
    },
  };
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
  weatherTriggerCounts.length = 0;
  vi.useRealTimers();
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

// Regression for the SECOND-order fallout of the #310 hoist above. Hoisting the
// finale-lightning `useEffect` above `if (!winner) return null` fixed the crash
// but moved WHEN the three strike-timers start: they now begin on the empty
// (no-winner, scores-still-loading) render. `Lightning` seeds its "last seen"
// ref from the `triggerCount` present AT MOUNT and only strikes when the count
// CHANGES afterward — so if the winner arrives after those timers have already
// pushed the count to 3, Weather/Lightning mounts already at 3, seeds its ref
// past every strike, and the finale plays NOTHING. The fix gates the effect
// body on the winner and re-runs it when the winner arrives, so the strikes
// fire against a mounted Lightning (mount at 0, then 0→1→2→3).
describe("TVFinaleWinner finale lightning across a late-arriving winner (May storm)", () => {
  it("fires the three close strikes when winner data arrives after the finale timers", async () => {
    vi.useFakeTimers();

    const tree = (winner: TVFinaleWinnerData | undefined) => (
      <TVFinaleWinner themeKey="may" winner={winner} />
    );

    // 1. Finale paints with no winner yet (scores still loading). The hoisted
    //    lightning effect must NOT burn its strikes here — nothing is mounted
    //    to receive them.
    let rerender!: (ui: React.ReactElement) => void;
    await act(async () => {
      const result = render(tree(undefined));
      rerender = result.rerender;
    });

    // 2. The full finale window elapses while the winner is still absent.
    //    Pre-fix the three timers all fire now, advancing the count to 3
    //    against a null render — wasted, with no Weather mounted to see them.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // 3. Winner data arrives — Weather/Lightning mounts for the FIRST time.
    await act(async () => {
      rerender(tree(WINNER));
    });

    // 4. Let the finale window elapse again, one strike per flush so batching
    //    can't collapse 0→1→2→3 into a single render and hide a lost strike.
    await act(async () => {
      vi.advanceTimersByTime(300); // crosses the 250ms first strike
    });
    await act(async () => {
      vi.advanceTimersByTime(700); // crosses the 950ms second strike
    });
    await act(async () => {
      vi.advanceTimersByTime(800); // crosses the 1700ms third strike
    });

    // Lightning seeds its ref from the count at MOUNT, so the count Weather
    // first receives must be 0 — otherwise the strikes are seeded past.
    expect(
      weatherTriggerCounts[0],
      `Weather first mounted at lightningTriggerCount=${weatherTriggerCounts[0]} — ` +
        `a non-zero seed means the finale timers were consumed by the empty ` +
        `(no-winner) render, so Lightning will never play the close strikes. ` +
        `Sequence seen: [${weatherTriggerCounts.join(", ")}].`,
    ).toBe(0);

    const strikes = weatherTriggerCounts.filter(
      (c, i) => i > 0 && (c ?? 0) > (weatherTriggerCounts[i - 1] ?? 0),
    ).length;
    expect(
      strikes,
      `Expected 3 close strikes (count 0→1→2→3) once the winner mounted; ` +
        `saw the sequence [${weatherTriggerCounts.join(", ")}].`,
    ).toBe(3);
  });

  // Guard the normal path: when the winner is present from the first frame
  // (gallery, or a snapshot that already carries scores), the gate must NOT
  // suppress the strikes — they fire exactly as before the fix.
  it("still fires the three strikes when the winner is present from first render", async () => {
    vi.useFakeTimers();

    await act(async () => {
      render(<TVFinaleWinner themeKey="may" winner={WINNER} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(weatherTriggerCounts[0]).toBe(0);
    const strikes = weatherTriggerCounts.filter(
      (c, i) => i > 0 && (c ?? 0) > (weatherTriggerCounts[i - 1] ?? 0),
    ).length;
    expect(
      strikes,
      `Normal path regressed — expected 3 strikes (0→1→2→3); saw [${weatherTriggerCounts.join(", ")}].`,
    ).toBe(3);
  });
});
