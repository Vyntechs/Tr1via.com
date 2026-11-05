// A TV that lost its live connection during question 1 can bring up question 2
// from a poll while still holding question 1's reveal message. Those stamps must
// not drive question 2's clock: the TV showed TIME'S UP at once while phones still
// had about 21 seconds, and sent a close request the server refused.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/system";
import { TVStateMachine } from "@/components/tv/TVStateMachine";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

const START = Date.parse("2026-07-20T02:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function liveSnapshot(playedAtMs: number): TVSnapshot {
  return {
    night: { id: "n", venueName: "V", themeKey: null, hostDefaultThemeKey: "house", roomCode: "ABC123", openedAt: iso(START - 3_600_000), closedAt: null, scheduledAt: null, isLocked: false, roomMagicEnabled: false },
    games: [{ id: "g1", gameNo: 1, state: "live", startedAt: iso(START - 600_000), endedAt: null, categoryCount: 1, questionCount: 1 }],
    currentGameId: "g1",
    categories: [{ id: "c1", gameId: "g1", name: "Music", topic: "Music", position: 0, color: null, state: "ready" }],
    questions: [{ id: "q2", categoryId: "c1", pointValue: 100, prompt: "Q2?", options: ["A", "B", "C", "D"], correctIndex: null, imageUrl: null, factBlurb: null, playedAt: iso(playedAtMs), finishedAt: null, isPicked: true }],
    liveQuestionId: "q2",
    targetQuestionId: "q2",
    players: [],
    scores: [],
    liveAnswers: [],
    reveals: [],
  } as unknown as TVSnapshot;
}

function renderTV(tag: { questionId: string | null; stampMs: number }) {
  return render(
    <ThemeProvider themeKey="house">
      <TVStateMachine
        snapshot={liveSnapshot(START)}
        themeKey="house"
        lastBroadcastQuestionId={tag.questionId}
        lastBroadcastRevealedAt={iso(tag.stampMs)}
        lastBroadcastServerNow={iso(tag.stampMs)}
        lastBroadcastReceivedAtMs={tag.stampMs}
      />
    </ThemeProvider>,
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const resolveCalls = () => vi.mocked(fetch).mock.calls.length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "question answer window is still open", retryInMs: 24_000 }), { status: 409 })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TV clock and a reveal message from another question", () => {
  it("a 60s-old message for question 1 leaves question 2 on its own full clock", async () => {
    renderTV({ questionId: "q1", stampMs: START - 60_000 });

    await advance(1_000);
    expect(screen.queryByText("TIME'S UP")).toBeNull();
    await advance(3_000);
    expect(screen.queryByText("Locking in answers")).toBeNull();
    expect(resolveCalls()).toBe(0);

    await advance(21_100);
    expect(screen.queryByText("TIME'S UP")).not.toBeNull();
    expect(resolveCalls()).toBe(1);
  });

  it("a screen with no question id on its message gets the same safe clock", async () => {
    renderTV({ questionId: null, stampMs: START - 60_000 });

    await advance(4_000);
    expect(screen.queryByText("TIME'S UP")).toBeNull();
    expect(resolveCalls()).toBe(0);
  });

  it("a message for the question on screen still drives its clock", async () => {
    renderTV({ questionId: "q2", stampMs: START - 20_000 });

    await advance(4_000);
    expect(screen.queryByText("TIME'S UP")).toBeNull();
    await advance(1_100);
    expect(screen.queryByText("TIME'S UP")).not.toBeNull();
    expect(resolveCalls()).toBe(1);
  });
});
