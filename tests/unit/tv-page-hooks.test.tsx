// tests/unit/tv-page-hooks.test.tsx
//
// Regression test for the TV-screen crash (React #310 in prod):
// `TVPage` called the `useTVWelcomeEvent` hook AFTER three conditional
// early returns. While `useTVRoom` reported `status: "loading"` the page
// returned early and the hook never ran; the moment the room loaded
// (`status: "ready"`) the early returns stopped firing and the hook
// suddenly ran — the hook COUNT changed between renders, so React threw
// "Rendered more hooks than during the previous render" (minified #310 in
// prod) and the whole venue TV went blank.
//
// This test drives TVPage through that exact transition (loading → ready)
// and asserts React reports NO hook-order violation. With the hook left
// below the early returns it fails; with the hook hoisted to the top of the
// component it passes.
//
// How the crash surfaces in test: React's hooks-mismatch detector reports
// the violation via `console.error` (in this dev build, as the internal
// "Expected static flag was missing" diagnostic; in prod it throws the #310
// error). We spy on `console.error` AND wrap the page in an error boundary,
// asserting neither path fires — so the test catches the bug regardless of
// which way React reports it.

import { Component, Suspense, type ReactNode } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TVBroadcast, TVSnapshot } from "@/lib/hooks/useTVRoom";

// Substrings React uses when it detects a rules-of-hooks / hook-count
// violation. Covers the dev-build internal diagnostic AND the user-facing
// messages across React builds.
const HOOK_VIOLATION_SIGNALS = [
  "Expected static flag was missing", // dev-build internal diagnostic for hook-count drift
  "Rendered more hooks than during the previous render",
  "Rendered fewer hooks than expected",
  "change in the order of Hooks",
  "Rules of Hooks",
];

function isHookViolation(message: string): boolean {
  return HOOK_VIOLATION_SIGNALS.some((s) => message.includes(s));
}

// Mutable module-level room state we flip between renders. `useTVRoom` is
// mocked to return whatever this points at, so a `rerender` after mutating
// it reproduces the live loading → ready transition.
type RoomState =
  | { status: "loading"; snapshot: null; lastBroadcast: TVBroadcast | null }
  | { status: "ready"; snapshot: TVSnapshot; lastBroadcast: TVBroadcast | null };

let roomState: RoomState = { status: "loading", snapshot: null, lastBroadcast: null };

vi.mock("@/lib/hooks/useTVRoom", () => ({
  useTVRoom: () => roomState,
}));

// Heavy TV children — render nothing so we only exercise TVPage's own hook
// order, not the state machine's deep tree.
const tvStateMachineRender = vi.hoisted(() => vi.fn());
vi.mock("@/components/tv", () => ({
  TVStateMachine: (props: unknown) => {
    tvStateMachineRender(props);
    return null;
  },
  TVSectionComplete: () => null,
  TVRoomMagicOverlay: () => null,
}));

// Audio + lightning touch browser APIs jsdom doesn't have; no-op them so an
// unrelated throw can't masquerade as (or mask) the hooks crash.
vi.mock("@/lib/audio/welcomeChime", () => ({ playWelcomeChime: () => {} }));
vi.mock("@/components/system/Lightning", () => ({ fireLightningBeat: () => {} }));
vi.mock("@/lib/hooks/useSectionCompleteCelebration", () => ({
  useSectionCompleteCelebration: () => null,
}));

// Import under test AFTER the mocks are registered.
import TVPage from "@/app/tv/[code]/page";

const READY_SNAPSHOT: TVSnapshot = {
  night: {
    id: "night-1",
    venueName: "Test Venue",
    themeKey: "june",
    hostDefaultThemeKey: null,
    roomCode: "EP8G5U",
    openedAt: new Date().toISOString(),
    closedAt: null,
    scheduledAt: null,
    isLocked: false,
    roomMagicEnabled: false,
  },
  games: [],
  currentGameId: null,
  categories: [],
  questions: [],
  liveQuestionId: null,
  targetQuestionId: null,
  players: [],
  scores: [],
  liveAnswers: [],
  reveals: [],
};

// In prod the hook-count drift throws (React #310) and React routes that
// render-phase throw to the nearest error boundary — a blank TV. We catch
// with a boundary so that path is asserted too, not just the console path.
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
  roomState = { status: "loading", snapshot: null, lastBroadcast: null };
  caughtError = null;
  tvStateMachineRender.mockClear();
  vi.restoreAllMocks();
});

describe("TVPage hook order across loading → ready", () => {
  it("does not violate the rules of hooks when the room transitions from loading to ready", async () => {
    // Capture every console.error React emits during the transition so we
    // can detect the hook-count violation (React reports it here in this
    // build) rather than letting it pass silently.
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });

    // First render: room is still loading (early return fires, the welcome
    // hook below the returns is skipped).
    roomState = { status: "loading", snapshot: null, lastBroadcast: null };

    const params = Promise.resolve({ code: "EP8G5U" });
    let rerender!: (ui: React.ReactElement) => void;

    // A fresh element each call (same component, same tree position, same
    // `params` identity) so React UPDATES the existing TVPage instance and
    // compares its hook count — re-using a memoized element would let React
    // bail out of re-rendering and hide the bug; a `key` change would remount
    // and hide it too.
    const tree = () => (
      <CatchBoundary>
        <Suspense fallback={null}>
          <TVPage params={params} />
        </Suspense>
      </CatchBoundary>
    );

    await act(async () => {
      const result = render(tree());
      rerender = result.rerender;
      await params; // let React `use(params)` resolve
    });

    // Second render: room is now ready. Pre-fix, the previously skipped
    // `useTVWelcomeEvent` hook now runs → hook count changes → React reports
    // a rules-of-hooks violation (and the TV goes blank in prod).
    await act(async () => {
      roomState = { status: "ready", snapshot: READY_SNAPSHOT, lastBroadcast: null };
      rerender(tree());
    });

    const hookViolations = errors.filter(isHookViolation);
    expect(
      hookViolations,
      `React reported a rules-of-hooks violation across the loading→ready transition:\n${hookViolations.join("\n")}`,
    ).toEqual([]);
    // And the page did not crash into the error boundary (prod #310 path).
    expect(caughtError).toBeNull();
  });

  it("clears a held room A welcome before room B becomes ready", async () => {
    const roomAWelcome: TVBroadcast = {
      event: "roster-changed",
      questionId: "",
      serverNow: "2026-07-19T00:00:01.000Z",
      joinToken: "room-a-welcome",
      displayName: "Alice",
    };
    roomState = {
      status: "ready",
      snapshot: READY_SNAPSHOT,
      lastBroadcast: roomAWelcome,
    };

    const params = Promise.resolve({ code: "EP8G5U" });
    const tree = () => (
      <Suspense fallback={null}>
        <TVPage params={params} />
      </Suspense>
    );
    let rerender!: (ui: React.ReactElement) => void;

    await act(async () => {
      const result = render(tree());
      rerender = result.rerender;
      await params;
    });
    await waitFor(() =>
      expect(tvStateMachineRender).toHaveBeenLastCalledWith(
        expect.objectContaining({
          welcomeEvent: expect.objectContaining({
            joinToken: "room-a-welcome",
          }),
        }),
      ),
    );

    await act(async () => {
      roomState = { status: "loading", snapshot: null, lastBroadcast: null };
      rerender(tree());
    });
    await act(async () => {
      roomState = {
        status: "ready",
        snapshot: {
          ...READY_SNAPSHOT,
          night: {
            ...READY_SNAPSHOT.night,
            id: "night-2",
            roomCode: "GHIJKL",
            venueName: "Room B",
          },
        },
        lastBroadcast: null,
      };
      rerender(tree());
    });

    expect(tvStateMachineRender).toHaveBeenLastCalledWith(
      expect.objectContaining({ welcomeEvent: null }),
    );
  });
});
