// REGRESSION (2026-07-29, live venue run, room 5A6PHG on production):
//
// The host console sat on "0 OF 32 LOCKED IN" for the whole of a question that
// 15 people answered, then printed "Nobody nailed this one" on a reveal 5 people
// got right, then announced the WRONG Game 1 winners — three players at 0 points
// while the database held Malik 3100 / Bnipps360 2340 / Leena 2300. The venue TV,
// which is server-rendered, had the correct values the entire time. Reloading the
// host page fixed it instantly.
//
// Cause: `answers` and `game_scores` loaded exactly once and then depended
// entirely on a `postgres_changes` subscription for every later value. When that
// stream delivers nothing — `answers` is deliberately ungranted to `anon` for
// anti-cheat, and Realtime evaluates postgres_changes under the subscriber's
// role — the first load's legitimate zero became permanent. Resolving a question
// does not change `answerTargetId` (currentQuestion -> lastResolvedQuestion is
// the same id), so nothing re-fired on reveal either.
//
// These tests pin the floor: the reads must re-poll on their own with NO
// subscription event ever arriving, and a failed read must never overwrite good
// data with an empty list.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostLiveConsoleClient } from "@/app/host/live/[nightId]/HostLiveConsoleClient";
import { ThemeProvider } from "@/components/system";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type { GameRow, NightRow, PlayerRow, QuestionRow } from "@/lib/supabase/types";

const h = vi.hoisted(() => ({
  room: null as RoomSnapshot | null,
  /** Rows the next `answers` read resolves with. */
  answerRows: [] as Array<Record<string, unknown>>,
  /** When set, the next `answers` read fails with this message instead. */
  answersError: null as string | null,
  answerReads: 0,
  scoreReads: 0,
  /** Answer/score row counts the console last handed to the TV renderer. */
  lastAnswersSeen: 0,
  lastScoresSeen: 0,
  /** Deliberately never invoked — this suite proves the poll works without it. */
  subscriptionHandlers: [] as Array<() => void>,
}));

vi.mock("@/components/system/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("@/lib/hooks/useRoom", () => ({ useRoom: () => h.room }));
vi.mock("@/lib/room/roomFallbackStore", () => ({
  useRoomFallback: () => ({ backupMode: false, payload: null }),
}));
vi.mock("@/lib/hooks/useAllLockedAutoReveal", () => ({
  useAllLockedAutoReveal: () => undefined,
}));
// roomToTVSnapshot is fed the exact `answers` + `scores` state that drives every
// number on the console (lock count, "X of N got it", the winners list). Reading
// it here asserts the component's own state, not a downstream derivation.
vi.mock("@/lib/host/roomToTVSnapshot", () => ({
  roomToTVSnapshot: (args: { answers?: unknown[]; scores?: unknown[] }) => {
    h.lastAnswersSeen = args.answers?.length ?? 0;
    h.lastScoresSeen = args.scores?.length ?? 0;
    return {};
  },
}));
vi.mock("@/components/host/HostConnectionBanner", () => ({
  HostConnectionBanner: () => null,
}));

// Surface the one number this bug corrupted, so the assertions read like the
// venue screenshot rather than like an implementation detail.
vi.mock("@/components/host", async () => {
  const actual = await vi.importActual<typeof import("@/components/host")>("@/components/host");
  return {
    ...actual,
    HostLiveConsole: ({ lockedCount }: { lockedCount?: number }) => (
      <div data-testid="locked-count">{lockedCount ?? -1}</div>
    ),
  };
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => {
    const channel = {
      on: (_kind: string, _filter: unknown, handler: () => void) => {
        h.subscriptionHandlers.push(handler);
        return channel;
      },
      subscribe: () => channel,
    };
    return {
      from: (table: string) => {
        if (table === "categories") {
          return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
        }
        if (table === "questions") {
          return {
            select: () => ({
              in: () => ({ eq: async () => ({ data: [], error: null }) }),
            }),
          };
        }
        if (table === "game_scores") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => {
                  h.scoreReads += 1;
                  return { data: [], error: null };
                },
              }),
            }),
          };
        }
        if (table === "answers") {
          return {
            select: () => ({
              eq: async () => {
                h.answerReads += 1;
                if (h.answersError) {
                  return { data: null, error: { message: h.answersError } };
                }
                return { data: h.answerRows, error: null };
              },
            }),
          };
        }
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      },
      channel: () => channel,
      removeChannel: () => undefined,
    };
  },
}));

const night: NightRow = {
  id: "night-1",
  host_id: "host-1",
  venue_name: "Soul Fire Pizza",
  room_code: "5A6PHG",
  scheduled_at: "2026-07-29T00:00:00Z",
  opened_at: "2026-07-29T00:00:00Z",
  closed_at: null,
  theme_key: "july",
  is_locked: false,
  room_magic_enabled: false,
  created_at: "2026-07-29T00:00:00Z",
};

const game: GameRow = {
  id: "game-1",
  night_id: night.id,
  game_no: 1,
  state: "live",
  started_at: "2026-07-29T00:01:00Z",
  ended_at: null,
  category_count: 2,
  question_count: 10,
};

const liveQuestion = {
  id: "question-1",
  category_id: "cat-1",
  played_at: "2026-07-29T00:02:00Z",
  finished_at: null,
} as unknown as QuestionRow;

const player: PlayerRow = {
  id: "player-1",
  night_id: night.id,
  device_id: "device-1",
  display_name: "Jordan",
  joined_at: "2026-07-29T00:00:00Z",
  last_seen_at: "2026-07-29T00:02:00Z",
  removed_at: null,
  app_switch_total_seconds: 0,
  can_answer: true,
};

function room(): RoomSnapshot {
  return {
    night,
    games: [game],
    categories: [],
    players: [player],
    currentGame: game,
    currentQuestion: liveQuestion,
    currentReveal: null,
    lastResolvedQuestion: null,
    lastBroadcast: null,
    lastFireworksBeat: null,
    lastRoomMagicReaction: null,
    roomMagicReactions: [],
    hostDefaultThemeKey: "house",
    requestRefresh: vi.fn(),
    isLoading: false,
  } as RoomSnapshot;
}

function renderConsole() {
  return render(
    <ThemeProvider themeKey="july">
      <HostLiveConsoleClient
        nightId={night.id}
        roomCode={night.room_code}
        venueName={night.venue_name}
        hostName="Heather"
        themeKey="july"
      />
    </ThemeProvider>,
  );
}

/** Advance timers and let the resulting promise chain settle inside act(). */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Let mount effects and their awaited reads settle. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("HostLiveConsoleClient — stale lock/score counts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.room = room();
    h.answerRows = [];
    h.answersError = null;
    h.answerReads = 0;
    h.scoreReads = 0;
    h.lastAnswersSeen = 0;
    h.lastScoresSeen = 0;
    h.subscriptionHandlers = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-reads answers on its own when NO subscription event ever fires", async () => {
    renderConsole();
    await settle();
    const afterMount = h.answerReads;
    expect(afterMount).toBeGreaterThan(0);

    // The venue failure: not one postgres_changes callback is ever invoked.
    await tick(6_000);

    expect(h.subscriptionHandlers.length).toBeGreaterThan(0); // it did subscribe…
    expect(h.answerReads).toBeGreaterThan(afterMount); // …and still refreshed itself.
  });

  it("re-reads game_scores on its own too, so the winners screen can't freeze at zero", async () => {
    renderConsole();
    await settle();
    const afterMount = h.scoreReads;

    await tick(6_000);

    expect(h.scoreReads).toBeGreaterThan(afterMount);
  });

  it("picks up answers that land AFTER the first load — the '0 OF 32 LOCKED IN' case", async () => {
    // Mount while nobody has answered yet. This zero is legitimate…
    renderConsole();
    await settle();
    expect(h.lastAnswersSeen).toBe(0);

    // …then 15 people lock in, and the push that would have said so never comes.
    h.answerRows = Array.from({ length: 15 }, (_, i) => ({
      id: `a${i}`,
      player_id: `p${i}`,
      question_id: liveQuestion.id,
      is_correct: i < 5,
      ms_to_lock: 3000 + i * 100,
    }));

    await tick(6_000);

    expect(h.lastAnswersSeen).toBe(15);
  });

  it("a failed read must not overwrite a good count with zero", async () => {
    h.answerRows = Array.from({ length: 15 }, (_, i) => ({
      id: `a${i}`,
      player_id: `p${i}`,
      question_id: liveQuestion.id,
      is_correct: i < 5,
      ms_to_lock: 3000 + i * 100,
    }));
    renderConsole();
    await settle();
    await tick(3_000);
    expect(h.lastAnswersSeen).toBe(15);

    // Now the read starts failing (this is what a missing grant looks like).
    h.answersError = "permission denied for table answers";
    await tick(6_000);

    // The old truth survives. It must NOT read as "nobody locked in".
    expect(h.lastAnswersSeen).toBe(15);
  });
});
