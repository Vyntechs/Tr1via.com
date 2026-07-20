// Route-level regression test — GET /api/tv/[code]/snapshot.
//
// The pentest CRITICAL was at the ROUTE, not the helper: the public TV feed
// served `correct_index` for unrevealed questions. The unit test for
// `serializeBoardQuestion` proves the helper withholds the answer — but it does
// NOT prove the route keeps USING the helper. A future edit that re-inlines the
// mapping (the exact pre-fix shape) would pass the helper test while
// reintroducing the leak. This test pins the actual attack surface: the
// assembled HTTP payload must withhold `correctIndex` for any unfinished
// question and expose it only once resolved.
//
// 2026-06-13 follow-up pentest: the same route ALSO shipped every player's
// `chosen_index` (their actual pick) + `is_correct` for the LIVE question via
// `liveAnswers` — readable by any phone hitting this public feed mid-question.
// These tests also pin that the route withholds the pick + correctness until
// the target question is resolved, while keeping the lock-in display (name +
// lock time) the venue TV needs.
//
// Supabase admin client is mocked, so no live DB is needed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const CODE = "ABCDEF"; // valid: alphabet excludes I/L/O/0/1
const PLAYER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PLAYER_ID = "33333333-3333-4333-8333-333333333333";
const ANSWER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ANSWER_ID = "55555555-5555-4555-8555-555555555555";

// A chainable, awaitable query stub. Chain methods return `this`; filters
// (eq/is/not) actually narrow the seeded rows so the route's two distinct
// `questions` queries (picked vs live) resolve to faithful subsets; the object
// is thenable so `await`/`Promise.all` resolve it to { data, error }.
function fieldAt(row: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) =>
    value && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : undefined, row);
}

function qb(
  rows: Record<string, unknown>[],
  error: { message: string } | null = null,
  onEq?: (column: string, value: unknown) => void,
) {
  let data = [...rows];
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => {
      onEq?.(c, v);
      data = data.filter((r) => fieldAt(r, c) === v);
      return b;
    },
    neq: (c: string, v: unknown) => {
      data = data.filter((r) => fieldAt(r, c) !== v);
      return b;
    },
    is: (c: string, v: unknown) => {
      data = data.filter((r) => (fieldAt(r, c) ?? null) === v);
      return b;
    },
    not: (c: string, _op: string, v: unknown) => {
      data = data.filter((r) => (fieldAt(r, c) ?? null) !== v);
      return b;
    },
    order: (c: string, options?: { ascending?: boolean }) => {
      const ascending = options?.ascending ?? true;
      data.sort((a, b) => String(fieldAt(a, c) ?? "").localeCompare(String(fieldAt(b, c) ?? "")) * (ascending ? 1 : -1));
      return b;
    },
    limit: (count: number) => {
      data = data.slice(0, count);
      return b;
    },
    maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error }),
    then: (onF: (v: { data: unknown; error: { message: string } | null }) => unknown) =>
      Promise.resolve({ data, error }).then(onF),
  };
  return b;
}

const Q_UNPLAYED = {
  id: "q-unplayed", category_id: "C1", point_value: 300, prompt: "P1",
  options: ["a", "b", "c", "d"], correct_index: 2, image_url: null,
  fact_blurb: null, played_at: null, finished_at: null, is_picked: true,
};
const Q_LIVE = {
  id: "q-live", category_id: "C1", point_value: 400, prompt: "P2",
  options: ["a", "b", "c", "d"], correct_index: 1, image_url: null,
  fact_blurb: null, played_at: "2026-06-07T00:00:00Z", finished_at: null,
  is_picked: true,
};
const Q_RESOLVED = {
  id: "q-resolved", category_id: "C1", point_value: 500, prompt: "P3",
  options: ["a", "b", "c", "d"], correct_index: 3, image_url: null,
  fact_blurb: null, played_at: "2026-06-07T00:00:00Z",
  finished_at: "2026-06-07T00:00:20Z", is_picked: true,
};

function makeAdmin({
  live = true,
  resilient = false,
  secondGame = false,
  secondGameQuestionPlayed = false,
  secondGameQuestionResolved = false,
  playGameId = "G1",
  foreignRevealCount = 0,
  foreignQuestionCount = 0,
  errorTable,
}: {
  live?: boolean;
  resilient?: boolean;
  secondGame?: boolean;
  secondGameQuestionPlayed?: boolean;
  secondGameQuestionResolved?: boolean;
  playGameId?: "G1" | "G2";
  foreignRevealCount?: number;
  foreignQuestionCount?: number;
  errorTable?: string;
} = {}) {
  const foreignReveals = Array.from({ length: foreignRevealCount }, (_, index) => ({
    id: `foreign-r${index}`,
    game_id: `foreign-g${index}`,
    question_id: `foreign-q${index}`,
    event: "resolve",
    occurred_at: `2026-06-08T00:${String(index).padStart(2, "0")}:00Z`,
    metadata: null,
    games: { night_id: `foreign-night-${index}` },
  }));
  const foreignCategories = Array.from({ length: foreignQuestionCount }, (_, index) => ({
    id: `foreign-c${index}`,
    game_id: `foreign-g${index}`,
    name: `Foreign ${index}`,
    topic: "foreign",
    position: index,
    color: null,
    state: "ready",
    games: { night_id: `foreign-night-${index}` },
  }));
  const foreignQuestions = Array.from({ length: foreignQuestionCount }, (_, index) => ({
    id: `foreign-q${index}`,
    category_id: `foreign-c${index}`,
    point_value: 100,
    prompt: `Foreign ${index}`,
    options: ["a", "b", "c", "d"],
    correct_index: 0,
    image_url: null,
    fact_blurb: null,
    played_at: `2026-06-08T00:${String(index).padStart(2, "0")}:00Z`,
    finished_at: null,
    is_picked: true,
    categories: { games: { night_id: `foreign-night-${index}` } },
  }));
  const currentQuestions = (live
    ? [Q_UNPLAYED, Q_LIVE, Q_RESOLVED]
    : [Q_UNPLAYED, Q_RESOLVED]
  ).map((question) => ({
    ...question,
    categories: { games: { night_id: NIGHT_ID } },
  }));
  const secondGameQuestions = secondGame ? [{
    id: "q-g2",
    category_id: "C2",
    point_value: 100,
    prompt: "Game 2 question",
    options: ["a", "b", "c", "d"],
    correct_index: 0,
    image_url: null,
    fact_blurb: null,
    played_at: secondGameQuestionPlayed ? "2026-06-07T00:12:00Z" : null,
    finished_at: secondGameQuestionResolved ? "2026-06-07T00:12:20Z" : null,
    is_picked: true,
    categories: { games: { night_id: NIGHT_ID } },
  }] : [];
  const seed: Record<string, Record<string, unknown>[]> = {
    nights: [{
      id: NIGHT_ID, venue_name: "V", theme_key: "house", room_code: CODE,
      opened_at: null, closed_at: null, scheduled_at: null, is_locked: false,
      answer_engine: resilient ? "resilient_v1" : "legacy",
      current_run_id: resilient ? "run-1" : null,
      room_revision: resilient ? 8 : 0,
      control_revision: resilient ? 5 : 0,
      hosts: { default_theme_key: "house" },
    }],
    games: [{
      id: "G1", game_no: 1, state: "live", started_at: null, ended_at: null,
      category_count: 1, question_count: 7, night_id: NIGHT_ID,
      ...(secondGame ? { state: "done", ended_at: "2026-06-07T00:10:00Z" } : {}),
    }, ...(secondGame ? [{
      id: "G2", game_no: 2, state: "live", started_at: "2026-06-07T00:11:00Z",
      ended_at: null, category_count: 1, question_count: 7, night_id: NIGHT_ID,
    }] : [])],
    categories: [...foreignCategories, {
      id: "C1", game_id: "G1", name: "Cat", topic: "t", position: 0,
      color: null, state: "ready", games: { night_id: NIGHT_ID },
    }, ...(secondGame ? [{
      id: "C2", game_id: "G2", name: "Cat 2", topic: "t2", position: 0,
      color: null, state: "ready", games: { night_id: NIGHT_ID },
    }] : [])],
    // With `live: false` there's no open question, so the TV targets the
    // most-recently-resolved one (the reveal screen) via the 'resolve' reveal.
    questions: [...foreignQuestions, ...currentQuestions, ...secondGameQuestions],
    players: [
      { id: PLAYER_ID, display_name: "Alice", night_id: NIGHT_ID,
        joined_at: "2026-06-07T00:00:00Z", last_seen_at: null, removed_at: null },
      { id: OTHER_PLAYER_ID, display_name: "Bob", night_id: NIGHT_ID,
        joined_at: "2026-06-07T00:00:01Z", last_seen_at: null, removed_at: null },
    ],
    reveals: [...foreignReveals, ...(live ? [] : [{
      id: "r1", game_id: "G1", question_id: "q-resolved", event: "resolve",
      occurred_at: "2026-06-07T00:00:21Z", metadata: null,
      games: { night_id: NIGHT_ID },
    }])],
    game_scores: [{
      game_id: "G1", player_id: PLAYER_ID, display_name: "Alice", score: 500,
      answered_count: 1, correct_count: 1, fastest_correct_ms: 1200,
    }, ...(secondGame ? [{
      game_id: "G2", player_id: OTHER_PLAYER_ID, display_name: "Bob", score: 100,
      answered_count: secondGameQuestionPlayed ? 1 : 0,
      correct_count: secondGameQuestionPlayed ? 1 : 0,
      fastest_correct_ms: secondGameQuestionPlayed ? 900 : null,
    }] : [])],
    answers: [
      // Another player's pick on the LIVE question — the anti-cheat target a
      // player must never read off this public feed while the question is open.
      { id: OTHER_ANSWER_ID, player_id: OTHER_PLAYER_ID, question_id: "q-live", chosen_index: 2,
        scramble: [0, 1, 2, 3], ms_to_lock: 850, is_correct: null,
        awarded_points: null, locked_at: "2026-06-07T00:00:05Z" },
      // A pick on the RESOLVED question — the reveal screen legitimately reads it.
      { id: ANSWER_ID, player_id: PLAYER_ID, question_id: "q-resolved", chosen_index: 3,
        scramble: [0, 1, 2, 3], ms_to_lock: 1200, is_correct: true,
        awarded_points: 500, locked_at: "2026-06-07T00:00:10Z" },
    ],
    question_plays: resilient ? [{
      id: "play-1", night_id: NIGHT_ID, run_id: "run-1", game_id: playGameId,
      category_id: playGameId === "G2" ? "C2" : "C1",
      question_id: live ? "q-live" : "q-resolved",
      status: live ? "accepting" : "resolved",
      opened_at: "2026-06-07T00:00:00Z",
      main_zero_at: "2026-06-07T00:00:30Z",
      final_window_starts_at: null,
      final_window_ends_at: "2026-06-07T00:00:32Z", finalize_at: null,
      eligible_count: 2, confirmed_count: 1,
    }] : [],
    question_play_eligibility: [{
      play_id: "play-1", player_id: "P1", eligibility_reason: "DO-NOT-LEAK",
    }],
    question_play_answers: [{
      play_id: "play-1", player_id: "P1", submission_id: "SUBMISSION-LEAK",
      visible_slot: 2, canonical_index: 1, is_correct: true,
      device_id: "DEVICE-LEAK",
    }],
  };
  const scoreGameIds: unknown[] = [];
  return {
    scoreGameIds,
    from: vi.fn((table: string) => qb(
      seed[table] ?? [],
      table === errorTable ? { message: "RAW-DATABASE-ERROR-LEAK" } : null,
      table === "game_scores"
        ? (column, value) => {
            if (column === "game_id") scoreGameIds.push(value);
          }
        : undefined,
    )),
  };
}

describe("GET /api/tv/[code]/snapshot — answer gating (route level)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "snapshot-test-secret";
  });

  it("scopes reveal history before limiting and keeps the final current-game answer targeted", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({
      live: false,
      foreignRevealCount: 55,
    }));
    const { GET } = await import("@/app/api/tv/[code]/snapshot/route");
    const res = await GET(
      new NextRequest(`http://test/api/tv/${CODE}/snapshot`),
      { params: Promise.resolve({ code: CODE }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.targetQuestionId).toBe("q-resolved");
    expect(body.reveals).toHaveLength(1);
    expect(body.reveals[0]).toMatchObject({
      gameId: "G1",
      questionId: "q-resolved",
      event: "resolve",
    });
  });

  it("scopes categories and questions before the live-question cap without leaking join metadata", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({
      foreignQuestionCount: 55,
    }));
    const { GET } = await import("@/app/api/tv/[code]/snapshot/route");
    const res = await GET(
      new NextRequest(`http://test/api/tv/${CODE}/snapshot`),
      { params: Promise.resolve({ code: CODE }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.liveQuestionId).toBe("q-live");
    expect(body.targetQuestionId).toBe("q-live");
    expect(body.categories.map((category: { id: string }) => category.id)).toEqual(["C1"]);
    expect(body.questions.map((question: { id: string }) => question.id)).toEqual([
      "q-unplayed",
      "q-live",
      "q-resolved",
    ]);
    expect(JSON.stringify(body.categories)).not.toContain("games");
    expect(JSON.stringify(body.questions)).not.toContain("categories");
  });

  it("withholds correctIndex for unplayed + live questions, exposes it for resolved", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin());
    const { GET } = await import("@/app/api/tv/[code]/snapshot/route");
    const res = await GET(
      new NextRequest(`http://test/api/tv/${CODE}/snapshot`),
      { params: Promise.resolve({ code: CODE }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    const byId = (id: string) =>
      body.questions.find((q: { id: string }) => q.id === id);
    expect(byId("q-unplayed").correctIndex).toBeNull();
    expect(byId("q-live").correctIndex).toBeNull();
    expect(byId("q-resolved").correctIndex).toBe(3);

    // The withheld raw answer indices (2 for unplayed, 1 for live) must appear
    // nowhere in the questions payload — catches a re-inlined leak directly.
    const qjson = JSON.stringify(body.questions);
    expect(qjson).not.toContain('"correctIndex":2');
    expect(qjson).not.toContain('"correctIndex":1');
    expect(qjson).toContain('"correctIndex":3');
  });

  it("withholds per-player chosen_index + is_correct on the LIVE question (anti-cheat), but keeps the lock-in display", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin());
    const { GET } = await import("@/app/api/tv/[code]/snapshot/route");
    const res = await GET(
      new NextRequest(`http://test/api/tv/${CODE}/snapshot`),
      { params: Promise.resolve({ code: CODE }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // The live (unresolved) question is the target.
    expect(body.targetQuestionId).toBe("q-live");
    // The lock-in IS surfaced — the venue TV's "locked in" pile-up needs the
    // name + lock time ...
    expect(body.liveAnswers).toHaveLength(1);
    const a = body.liveAnswers[0];
    expect(a.question_id).toBe("q-live");
    expect(a.player_name).toBe("Bob");
    expect(a.ms_to_lock).toBe(850);
    // ... but the actual pick and its correctness are WITHHELD until resolved.
    expect(a.chosen_index).toBeNull();
    expect(a.is_correct).toBeNull();
    // The raw pick (2) must appear nowhere in the live-answers payload — catches
    // a re-inlined leak directly, the way the correctIndex guard above does.
    expect(JSON.stringify(body.liveAnswers)).not.toContain('"chosen_index":2');
  });

  it("never serializes raw night, player, or answer identifiers anywhere in the public TV response", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin());
    const { GET } = await import("@/app/api/tv/[code]/snapshot/route");
    const res = await GET(
      new NextRequest(`http://test/api/tv/${CODE}/snapshot`),
      { params: Promise.resolve({ code: CODE }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const json = JSON.stringify(body);

    for (const rawIdentifier of [
      NIGHT_ID,
      PLAYER_ID,
      OTHER_PLAYER_ID,
      ANSWER_ID,
      OTHER_ANSWER_ID,
    ]) {
      expect(json).not.toContain(rawIdentifier);
    }
    expect(body.players[0]).toMatchObject({ displayName: "Alice" });
    expect(body.players[0].id).toEqual(expect.any(String));
    expect(body.scores[0]).toMatchObject({ display_name: "Alice", score: 500 });
    expect(body.scores[0]).not.toHaveProperty("player_id");
    expect(body.liveAnswers[0]).not.toHaveProperty("id");
    expect(body.liveAnswers[0]).not.toHaveProperty("player_id");
  });

  it("exposes chosen_index + is_correct once the target question is RESOLVED (reveal screen)", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({ live: false }));
    const { GET } = await import("@/app/api/tv/[code]/snapshot/route");
    const res = await GET(
      new NextRequest(`http://test/api/tv/${CODE}/snapshot`),
      { params: Promise.resolve({ code: CODE }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // No live question → the TV targets the most-recently-resolved one.
    expect(body.targetQuestionId).toBe("q-resolved");
    expect(body.liveAnswers).toHaveLength(1);
    expect(body.liveAnswers[0].question_id).toBe("q-resolved");
    // The reveal screen ("who got it right", fastest-five) reads these.
    expect(body.liveAnswers[0].chosen_index).toBe(3);
    expect(body.liveAnswers[0].is_correct).toBe(true);
  });

  it("projects aggregate resilient play state without any selected answer or eligibility identity", async () => {
    const admin = makeAdmin({ resilient: true });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { GET } = await import("@/app/api/tv/[code]/snapshot/route");
    const res = await GET(
      new NextRequest(`http://test/api/tv/${CODE}/snapshot`),
      { params: Promise.resolve({ code: CODE }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.live).toEqual({
      runId: "run-1",
      roomRevision: 8,
      controlRevision: 5,
      playId: "play-1",
      play: {
        playId: "play-1",
        gameId: "G1",
        questionId: "q-live",
        state: "accepting",
        openedAt: "2026-06-07T00:00:00Z",
        mainZeroAt: "2026-06-07T00:00:30Z",
        finalWindowStartsAt: null,
        finalWindowEndsAt: "2026-06-07T00:00:32Z",
        finalizeAt: null,
        eligibleCount: 2,
        confirmedCount: 1,
      },
    });
    const json = JSON.stringify(body.live);
    expect(json).not.toContain("P1");
    expect(json).not.toContain("DO-NOT-LEAK");
    expect(json).not.toContain("SUBMISSION-LEAK");
    expect(json).not.toContain("DEVICE-LEAK");
    expect(json).not.toContain("canonical");
    expect(json).not.toContain("isCorrect");
    expect(json).not.toContain("selected");
  });

  it("does not project Game 1 play state after Game 2 starts before its first question", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({
      resilient: true,
      live: false,
      secondGame: true,
      playGameId: "G1",
    }));
    const { GET } = await import("@/app/api/tv/[code]/snapshot/route");
    const res = await GET(
      new NextRequest(`http://test/api/tv/${CODE}/snapshot`),
      { params: Promise.resolve({ code: CODE }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.currentGameId).toBe("G2");
    expect(body.live).toMatchObject({ playId: null, play: null });
  });

  it("keeps Game 1 standings during the started-Game-2 intermission gap, then switches to Game 2 after its first question plays", async () => {
    const gapAdmin = makeAdmin({
      live: false,
      secondGame: true,
      secondGameQuestionPlayed: false,
    });
    adminMock.getSupabaseAdmin.mockReturnValue(gapAdmin);
    const { GET } = await import("@/app/api/tv/[code]/snapshot/route");

    const gapRes = await GET(
      new NextRequest(`http://test/api/tv/${CODE}/snapshot`),
      { params: Promise.resolve({ code: CODE }) },
    );
    expect(gapRes.status).toBe(200);
    const gapBody = await gapRes.json();

    expect(gapBody.currentGameId).toBe("G2");
    expect(gapAdmin.scoreGameIds).toEqual(["G1"]);
    expect(gapBody.scores).toEqual([
      expect.objectContaining({ display_name: "Alice", score: 500 }),
    ]);

    for (const secondGameQuestionResolved of [false, true]) {
      const playedAdmin = makeAdmin({
        live: false,
        secondGame: true,
        secondGameQuestionPlayed: true,
        secondGameQuestionResolved,
      });
      adminMock.getSupabaseAdmin.mockReturnValue(playedAdmin);
      const playedRes = await GET(
        new NextRequest(`http://test/api/tv/${CODE}/snapshot`),
        { params: Promise.resolve({ code: CODE }) },
      );
      expect(playedRes.status).toBe(200);
      const playedBody = await playedRes.json();

      expect(playedBody.currentGameId).toBe("G2");
      expect(playedAdmin.scoreGameIds).toEqual(["G2"]);
      expect(playedBody.scores).toEqual([
        expect.objectContaining({ display_name: "Bob", score: 100 }),
      ]);
    }
  });

  it("maps a public snapshot database failure to a generic typed error", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({ errorTable: "nights" }));
    const { GET } = await import("@/app/api/tv/[code]/snapshot/route");
    const res = await GET(
      new NextRequest(`http://test/api/tv/${CODE}/snapshot`),
      { params: Promise.resolve({ code: CODE }) },
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "server error" });
    expect(JSON.stringify(body)).not.toContain("RAW-DATABASE-ERROR-LEAK");
  });
});
