// Regression lock for useSectionCompleteCelebration. The hook owns the
// timing window of the section-complete overlay shown on top of the
// Jeopardy grid between sections — getting any of these triggers wrong
// would either skip the celebration entirely or step on the End Game flow.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  CELEBRATION_DURATION_MS,
  useSectionCompleteCelebration,
} from "@/lib/hooks/useSectionCompleteCelebration";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";

type Game = TVSnapshot["games"][number];
type Category = TVSnapshot["categories"][number];
type Question = TVSnapshot["questions"][number];

function snapshot(overrides: Partial<TVSnapshot> = {}): TVSnapshot {
  return {
    night: {
      id: "n",
      venueName: "T",
      themeKey: "house",
      hostDefaultThemeKey: "daylight",
      roomCode: "ABCDEF",
      openedAt: "2026-05-24T00:00:00Z",
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
    ...overrides,
  };
}

function game(o: Partial<Game> & Pick<Game, "id" | "gameNo" | "state">): Game {
  return {
    startedAt: null,
    endedAt: null,
    categoryCount: 1,
    questionCount: 7,
    ...o,
  };
}

function category(o: Partial<Category> & Pick<Category, "id" | "gameId">): Category {
  return {
    name: "T",
    topic: "t",
    position: 1,
    color: null,
    state: "ready",
    ...o,
  };
}

function question(o: Partial<Question> & Pick<Question, "id" | "categoryId">): Question {
  return {
    prompt: "Q",
    options: ["a", "b", "c", "d"],
    correctIndex: 0,
    pointValue: 100,
    isPicked: true,
    playedAt: null,
    finishedAt: null,
    factBlurb: null,
    imageUrl: null,
    ...o,
  };
}

/** Game where category "Skirts" just cleared and "Kyle Bush" is still unplayed. */
function sectionEndedSnapshot(): TVSnapshot {
  return snapshot({
    games: [game({ id: "g1", gameNo: 1, state: "live" })],
    currentGameId: "g1",
    categories: [
      category({
        id: "c-skirts",
        gameId: "g1",
        name: "Skirts",
        color: "#F2A02D",
        position: 1,
      }),
      category({
        id: "c-kyle",
        gameId: "g1",
        name: "Kyle Bush",
        color: "#9B7BD8",
        position: 2,
      }),
    ],
    questions: [
      question({
        id: "q-skirts-prev",
        categoryId: "c-skirts",
        finishedAt: "2026-05-24T00:06:00Z",
      }),
      question({
        id: "q-skirts-last",
        categoryId: "c-skirts",
        finishedAt: "2026-05-24T00:07:00Z",
      }),
      question({ id: "q-kyle-1", categoryId: "c-kyle", finishedAt: null }),
    ],
  });
}

/** Same situation but the resolve event is still in the snapshot (sticky reveal). */
function sectionEndedWithStickyReveal(): TVSnapshot {
  const base = sectionEndedSnapshot();
  return {
    ...base,
    targetQuestionId: "q-skirts-last",
    reveals: [
      {
        id: "r1",
        gameId: "g1",
        questionId: "q-skirts-last",
        event: "resolve",
        occurredAt: "2026-05-24T00:07:30Z",
        metadata: null,
      },
    ],
  };
}

/** Single-category game whose only category just cleared — End Game territory. */
function lastCategorySnapshot(): TVSnapshot {
  return snapshot({
    games: [game({ id: "g1", gameNo: 1, state: "live" })],
    currentGameId: "g1",
    categories: [category({ id: "c1", gameId: "g1", name: "Solo" })],
    questions: [
      question({
        id: "q1",
        categoryId: "c1",
        finishedAt: "2026-05-24T00:07:00Z",
      }),
    ],
  });
}

describe("useSectionCompleteCelebration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when no snapshot", () => {
    const { result } = renderHook(() => useSectionCompleteCelebration(null));
    expect(result.current).toBeNull();
  });

  it("fires when the most-recent finished question clears a category and others remain", () => {
    const { result } = renderHook(() =>
      useSectionCompleteCelebration(sectionEndedSnapshot(), true),
    );
    expect(result.current).not.toBeNull();
    expect(result.current?.topicName).toBe("Skirts");
    expect(result.current?.color).toBe("#F2A02D");
    expect(result.current?.triggeredByQuestionId).toBe("q-skirts-last");
  });

  it("does NOT fire when the LAST category in the game completes (End Game wins)", () => {
    const { result } = renderHook(() =>
      useSectionCompleteCelebration(lastCategorySnapshot(), true),
    );
    expect(result.current).toBeNull();
  });

  it("does NOT fire while a sticky reveal is still showing (audience path)", () => {
    const { result } = renderHook(() =>
      useSectionCompleteCelebration(sectionEndedWithStickyReveal()),
    );
    expect(result.current).toBeNull();
  });

  it("fires once the sticky reveal naturally clears on the audience TV", () => {
    const { result } = renderHook(() =>
      useSectionCompleteCelebration(sectionEndedSnapshot()),
    );
    expect(result.current).not.toBeNull();
  });

  it("auto-clears after the 1.8 s window", () => {
    const { result } = renderHook(() =>
      useSectionCompleteCelebration(sectionEndedSnapshot(), true),
    );
    expect(result.current).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(CELEBRATION_DURATION_MS);
    });
    expect(result.current).toBeNull();
  });

  it("does NOT re-fire for the same question id after clearing", () => {
    const snap = sectionEndedSnapshot();
    const { result, rerender } = renderHook(
      ({ s }: { s: TVSnapshot }) => useSectionCompleteCelebration(s, true),
      { initialProps: { s: snap } },
    );
    expect(result.current).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(CELEBRATION_DURATION_MS);
    });
    expect(result.current).toBeNull();
    rerender({ s: { ...snap } });
    expect(result.current).toBeNull();
  });

  it("does NOT fire when a question is mid-play", () => {
    const base = sectionEndedSnapshot();
    const midPlay: TVSnapshot = {
      ...base,
      liveQuestionId: "q-kyle-1",
      questions: base.questions.map((q) =>
        q.id === "q-kyle-1"
          ? { ...q, playedAt: "2026-05-24T00:08:00Z" }
          : q,
      ),
    };
    const { result } = renderHook(() =>
      useSectionCompleteCelebration(midPlay, true),
    );
    expect(result.current).toBeNull();
  });
});
