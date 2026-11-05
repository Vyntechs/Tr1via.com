// What the TV says at timer zero, with the network down throughout: the real
// state machine, the real useTimer and the real ladder, with fetch refusing.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostLiveConsole } from "@/components/host/HostLiveConsole";
import { ThemeProvider } from "@/components/system";
import { TVStateMachine } from "@/components/tv/TVStateMachine";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import type { ThemeKey } from "@/lib/theme/tokens";

const hold = vi.hoisted(() => ({ forced: false }));
vi.mock("@/lib/tv/revealPause", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tv/revealPause")>();
  return {
    ...real,
    shouldHoldReveal: (input: Parameters<typeof real.shouldHoldReveal>[0]) =>
      hold.forced || real.shouldHoldReveal(input),
  };
});

const START = Date.parse("2026-07-20T02:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const LOCKING = "Locking in answers";
const TIMES_UP = "TIME'S UP";

const THEMES: ThemeKey[] = [
  "house", "daylight", "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function liveSnapshot(
  playedAtMs: number,
  overrides: Partial<TVSnapshot> = {},
  finishedAt: string | null = null,
): TVSnapshot {
  return {
    night: {
      id: "night-key",
      venueName: "The Venue",
      themeKey: null,
      hostDefaultThemeKey: "house",
      roomCode: "ABC123",
      openedAt: iso(START - 3_600_000),
      closedAt: null,
      scheduledAt: null,
      isLocked: false,
      roomMagicEnabled: false,
    },
    games: [
      { id: "g1", gameNo: 1, state: "live", startedAt: iso(START - 600_000), endedAt: null, categoryCount: 1, questionCount: 1 },
    ],
    currentGameId: "g1",
    categories: [
      { id: "c1", gameId: "g1", name: "Music", topic: "Music", position: 0, color: null, state: "ready" },
    ],
    questions: [
      {
        id: "q1",
        categoryId: "c1",
        pointValue: 100,
        prompt: "Which band recorded this song?",
        options: ["A", "B", "C", "D"],
        correctIndex: finishedAt ? 1 : null,
        imageUrl: null,
        factBlurb: null,
        playedAt: iso(playedAtMs),
        finishedAt,
        isPicked: true,
      },
    ],
    liveQuestionId: "q1",
    targetQuestionId: "q1",
    players: [],
    scores: [],
    liveAnswers: [],
    reveals: [],
    ...overrides,
  };
}

function tv(snapshot: TVSnapshot, themeKey: ThemeKey) {
  return (
    <ThemeProvider themeKey={themeKey}>
      <TVStateMachine snapshot={snapshot} themeKey={themeKey} />
    </ThemeProvider>
  );
}

/** One act per step: React commits between steps, as it does between real ticks. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
});

afterEach(() => {
  hold.forced = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TV timer labels at zero", () => {
  it.each(THEMES)("%s: TIME'S UP at zero, then the wait is named at zero + 3s", async (themeKey) => {
    render(tv(liveSnapshot(START - 24_000), themeKey));
    expect(screen.getByText("FINAL SECONDS")).toBeInTheDocument();

    await advance(1_100);
    expect(screen.getByText(TIMES_UP)).toBeInTheDocument();
    expect(screen.queryByText("FINAL SECONDS")).not.toBeInTheDocument();

    await advance(2_800);
    expect(screen.getByText(TIMES_UP)).toBeInTheDocument();
    expect(screen.queryByText(LOCKING)).not.toBeInTheDocument();

    await advance(300);
    expect(screen.getByText(LOCKING)).toBeInTheDocument();
    expect(screen.queryByText(TIMES_UP)).not.toBeInTheDocument();

    // Long after the ladder has given up, nothing has changed on screen.
    await advance(60_000);
    expect(screen.getByText(LOCKING)).toBeInTheDocument();
  });

  it("reaches the panel embedded in the host console", async () => {
    render(<HostLiveConsole themeKey="house" tvSnapshot={liveSnapshot(START - 24_000)} />);
    const panel = screen.getByTestId("host-tv-panel");

    await advance(1_100);
    expect(panel).toHaveTextContent(TIMES_UP);

    await advance(3_100);
    expect(panel).toHaveTextContent(LOCKING);
  });

  it("lets the reveal take over when the close arrives, with no wait wording left behind", async () => {
    const closed = (at: number) =>
      liveSnapshot(START - 24_000, {
        liveQuestionId: null,
        reveals: [
          { id: "r1", gameId: "g1", questionId: "q1", event: "resolve", occurredAt: iso(at), metadata: null },
        ],
      }, iso(at));
    const { rerender } = render(tv(liveSnapshot(START - 24_000), "house"));
    await advance(1_100);
    await advance(3_100);
    expect(screen.getByText(LOCKING)).toBeInTheDocument();

    rerender(tv(closed(START + 4_500), "house"));
    await advance(100);

    expect(screen.queryByText(LOCKING)).not.toBeInTheDocument();
    expect(screen.queryByText(TIMES_UP)).not.toBeInTheDocument();
  });

  it("never names the wait on the ceremony hold, because the close has been seen", async () => {
    // Only the hold decision is forced, so the hold outlasts the three seconds.
    hold.forced = true;
    const closedAt = iso(START + 1_300);
    const { rerender } = render(tv(liveSnapshot(START - 24_000), "house"));
    await advance(1_100);
    await advance(200);

    rerender(
      tv(
        liveSnapshot(
          START - 24_000,
          {
            liveQuestionId: null,
            reveals: [
              { id: "r1", gameId: "g1", questionId: "q1", event: "resolve", occurredAt: closedAt, metadata: null },
            ],
          },
          closedAt,
        ),
        "house",
      ),
    );
    await advance(100);
    expect(screen.getByText(TIMES_UP)).toBeInTheDocument();

    await advance(3_100);
    await advance(100);
    expect(screen.getByText(TIMES_UP)).toBeInTheDocument();
    expect(screen.queryByText(LOCKING)).not.toBeInTheDocument();
  });

  it("starts the three seconds over when the same question is undone and replayed", async () => {
    const { rerender } = render(tv(liveSnapshot(START - 24_000), "house"));
    await advance(1_100);
    await advance(3_100);
    expect(screen.getByText(LOCKING)).toBeInTheDocument();

    const replayedAt = Date.now();
    rerender(tv(liveSnapshot(replayedAt), "house"));
    await advance(100);
    expect(screen.getByText("SPEED BONUS < 5s")).toBeInTheDocument();

    await advance(25_000);
    await advance(100);
    expect(screen.getByText(TIMES_UP)).toBeInTheDocument();
    expect(screen.queryByText(LOCKING)).not.toBeInTheDocument();

    await advance(3_200);
    expect(screen.getByText(LOCKING)).toBeInTheDocument();
  });
});
