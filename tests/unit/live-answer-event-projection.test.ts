import { beforeEach, describe, expect, it, vi } from "vitest";

import { projectExactLiveEvent } from "@/lib/live-answer/projectEvent";

const NIGHT_ID = "00000000-0000-4000-8000-000000000001";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const GAME_ID = "22222222-2222-4222-8222-222222222222";
const PLAY_ID = "33333333-3333-4333-8333-333333333333";
const QUESTION_ID = "44444444-4444-4444-8444-444444444444";
const WRONG_GAME_ID = "55555555-5555-4555-8555-555555555555";
const WRONG_QUESTION_ID = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({ from: h.from }),
}));

const night = {
  answer_engine: "resilient_v1",
  current_run_id: RUN_ID,
  room_revision: 8,
  control_revision: 5,
};

function play(status: string, id = PLAY_ID) {
  return {
    id,
    night_id: NIGHT_ID,
    run_id: RUN_ID,
    game_id: GAME_ID,
    question_id: QUESTION_ID,
    status,
    opened_at: "2026-07-19T01:00:00.000Z",
    main_zero_at: "2026-07-19T01:00:30.000Z",
    final_window_starts_at:
      status === "accepting" ? null : "2026-07-19T01:00:30.000Z",
    final_window_ends_at: "2026-07-19T01:00:32.000Z",
    finalize_at:
      status === "accepting" ? null : "2026-07-19T01:00:32.000Z",
    eligible_count: 4,
    confirmed_count: 3,
  };
}

function installRows(options: {
  night?: typeof night | null;
  play?: ReturnType<typeof play> | null;
  game?: { id: string; night_id: string } | null;
  nightError?: unknown;
  playError?: unknown;
  gameError?: unknown;
}) {
  const filters: Record<string, unknown> = {};
  h.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => {
        filters[`${table}.${column}`] = value;
        return query;
      }),
      maybeSingle: vi.fn(async () => {
        if (table === "question_plays") {
          const exact =
            filters["question_plays.id"] === options.play?.id &&
            filters["question_plays.night_id"] === NIGHT_ID &&
            filters["question_plays.run_id"] === RUN_ID;
          return {
            data: exact ? (options.play ?? null) : null,
            error: options.playError ?? null,
          };
        }
        if (table === "games") {
          const exact =
            filters["games.id"] === options.game?.id &&
            filters["games.night_id"] === options.game?.night_id;
          return {
            data: exact ? (options.game ?? null) : null,
            error: options.gameError ?? null,
          };
        }
        return {
          data: options.night ?? null,
          error: options.nightError ?? null,
        };
      }),
    };
    return query;
  });
  return filters;
}

describe("exact live event projection", () => {
  beforeEach(() => {
    h.from.mockReset();
  });

  it("re-reads the exact returned play and projects every authoritative deadline", async () => {
    const filters = installRows({ night, play: play("final_window") });

    const projected = await projectExactLiveEvent(NIGHT_ID, {
      applied: true,
      freshness: "transaction_winner",
      kind: "answer_progress",
      runId: RUN_ID,
      gameId: GAME_ID,
      questionId: QUESTION_ID,
      roomRevision: 8,
      controlRevision: 5,
      playId: PLAY_ID,
      previousRunId: null,
    });

    expect(filters).toMatchObject({
      "question_plays.id": PLAY_ID,
      "question_plays.night_id": NIGHT_ID,
      "question_plays.run_id": RUN_ID,
      "nights.id": NIGHT_ID,
    });
    expect(projected?.play).toMatchObject({
      playId: PLAY_ID,
      state: "final_window",
      openedAt: "2026-07-19T01:00:00.000Z",
      mainZeroAt: "2026-07-19T01:00:30.000Z",
      finalWindowStartsAt: "2026-07-19T01:00:30.000Z",
      finalWindowEndsAt: "2026-07-19T01:00:32.000Z",
    });
  });

  it("suppresses the fast event when the night has advanced after the RPC result", async () => {
    installRows({
      night: { ...night, room_revision: 9 },
      play: play("final_window"),
    });

    await expect(
      projectExactLiveEvent(NIGHT_ID, {
        applied: true,
        freshness: "transaction_winner",
        kind: "answer_progress",
        runId: RUN_ID,
        gameId: GAME_ID,
        questionId: QUESTION_ID,
        roomRevision: 8,
        controlRevision: 5,
        playId: PLAY_ID,
        previousRunId: null,
      }),
    ).resolves.toBeNull();
  });

  it.each([
    ["play_undone", "undone"],
    ["play_resolved", "resolved"],
  ] as const)(
    "projects the exact %s play instead of substituting the latest active play",
    async (kind, state) => {
      installRows({ night, play: play(state) });

      const projected = await projectExactLiveEvent(NIGHT_ID, {
        applied: true,
        freshness: "transaction_winner",
        kind,
        runId: RUN_ID,
        gameId: GAME_ID,
        questionId: QUESTION_ID,
        roomRevision: 8,
        controlRevision: 5,
        playId: PLAY_ID,
        previousRunId: null,
      });

      expect(projected?.playId).toBe(PLAY_ID);
      expect(projected?.play?.state).toBe(state);
    },
  );

  it.each([
    [
      "play_opened with wrong gameId",
      "play_opened",
      "accepting",
      "gameId",
      WRONG_GAME_ID,
    ],
    [
      "play_opened with wrong questionId",
      "play_opened",
      "accepting",
      "questionId",
      WRONG_QUESTION_ID,
    ],
    [
      "final_window_started with wrong gameId",
      "final_window_started",
      "final_window",
      "gameId",
      WRONG_GAME_ID,
    ],
    [
      "final_window_started with wrong questionId",
      "final_window_started",
      "final_window",
      "questionId",
      WRONG_QUESTION_ID,
    ],
    [
      "play_resolved with wrong gameId",
      "play_resolved",
      "resolved",
      "gameId",
      WRONG_GAME_ID,
    ],
    [
      "play_resolved with wrong questionId",
      "play_resolved",
      "resolved",
      "questionId",
      WRONG_QUESTION_ID,
    ],
    [
      "play_undone with wrong gameId",
      "play_undone",
      "undone",
      "gameId",
      WRONG_GAME_ID,
    ],
    [
      "play_undone with wrong questionId",
      "play_undone",
      "undone",
      "questionId",
      WRONG_QUESTION_ID,
    ],
  ] as const)(
    "suppresses %s",
    async (_label, kind, state, ancestryField, wrongId) => {
      installRows({ night, play: play(state) });

      await expect(
        projectExactLiveEvent(NIGHT_ID, {
          applied: true,
          freshness: "transaction_winner",
          kind,
          runId: RUN_ID,
          gameId: ancestryField === "gameId" ? wrongId : GAME_ID,
          questionId:
            ancestryField === "questionId" ? wrongId : QUESTION_ID,
          roomRevision: 8,
          controlRevision: 5,
          playId: PLAY_ID,
          previousRunId: null,
        }),
      ).resolves.toBeNull();
    },
  );

  it("validates game events through the exact game relation", async () => {
    const filters = installRows({
      night,
      game: { id: GAME_ID, night_id: NIGHT_ID },
    });

    const projected = await projectExactLiveEvent(NIGHT_ID, {
      applied: true,
      freshness: "transaction_winner",
      kind: "game_started",
      runId: RUN_ID,
      gameId: GAME_ID,
      questionId: null,
      roomRevision: 8,
      controlRevision: 5,
      playId: null,
      previousRunId: null,
    });

    expect(filters).toMatchObject({
      "games.id": GAME_ID,
      "games.night_id": NIGHT_ID,
    });
    expect(projected).not.toBeNull();
  });

  it("fails closed when a game event has no exact game in this night", async () => {
    installRows({
      night,
      game: {
        id: GAME_ID,
        night_id: "77777777-7777-4777-8777-777777777777",
      },
    });

    await expect(
      projectExactLiveEvent(NIGHT_ID, {
        applied: true,
        freshness: "transaction_winner",
        kind: "game_ended",
        runId: RUN_ID,
        gameId: GAME_ID,
        questionId: null,
        roomRevision: 8,
        controlRevision: 5,
        playId: null,
        previousRunId: null,
      }),
    ).resolves.toBeNull();
  });

  it("fails closed on a missing exact play, database error, or event/state mismatch", async () => {
    installRows({ night, play: null });
    await expect(
      projectExactLiveEvent(NIGHT_ID, {
        applied: true,
        freshness: "transaction_winner",
        kind: "play_resolved",
        runId: RUN_ID,
        gameId: GAME_ID,
        questionId: QUESTION_ID,
        roomRevision: 8,
        controlRevision: 5,
        playId: PLAY_ID,
        previousRunId: null,
      }),
    ).resolves.toBeNull();

    installRows({ night, play: play("accepting"), nightError: new Error("db") });
    await expect(
      projectExactLiveEvent(NIGHT_ID, {
        applied: true,
        freshness: "transaction_winner",
        kind: "play_opened",
        runId: RUN_ID,
        gameId: GAME_ID,
        questionId: QUESTION_ID,
        roomRevision: 8,
        controlRevision: 5,
        playId: PLAY_ID,
        previousRunId: null,
      }),
    ).resolves.toBeNull();

    installRows({ night, play: play("accepting") });
    await expect(
      projectExactLiveEvent(NIGHT_ID, {
        applied: true,
        freshness: "transaction_winner",
        kind: "play_resolved",
        runId: RUN_ID,
        gameId: GAME_ID,
        questionId: QUESTION_ID,
        roomRevision: 8,
        controlRevision: 5,
        playId: PLAY_ID,
        previousRunId: null,
      }),
    ).resolves.toBeNull();
  });
});
