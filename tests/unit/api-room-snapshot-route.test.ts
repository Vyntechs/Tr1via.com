// Route-level tests — GET /api/room/[code]/snapshot (the degraded-network
// fallback). Pins: (1) auth modes (403 for neither host nor player),
// (2) the SAME correct_index gating the TV feed enforces (live/unplayed →
// withheld; resolved → exposed), (3) player mode returns the player's own
// answers + participations. Supabase admin + auth helpers are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { scrambleFor } from "@/lib/game/scramble";
import { presentationKey } from "@/lib/room/presentationKey";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({
  getAuthedHost: vi.fn(),
  getDeviceId: vi.fn(),
  hasHostSessionCookie: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const CODE = "ABCDEF";
const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const HOST_ID = "host-1";
const DEVICE_ID = "DEVICE-ID-LEAK";
const PLAYER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PLAYER_ID = "33333333-3333-4333-8333-333333333333";
const ANSWER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ANSWER_ID = "55555555-5555-4555-8555-555555555555";
const PARTICIPATION_ID = "66666666-6666-4666-8666-666666666666";
const DEVICE_ID_LEAK = "DEVICE-ID-LEAK";
const SCRAMBLE = [3, 1, 0, 2];

// Chainable, awaitable query stub. Real columns filter; join-path filters
// (keys containing ".") are no-ops since the seed rows are already night-scoped.
// select() records a plain (non-join) column list and projects OUTPUT rows to
// it — filters still run against the full row, matching real Postgres
// semantics where a narrower select doesn't hide columns from a later .eq().
function qb(rows: Record<string, unknown>[], error: { message: string } | null = null) {
  let data = [...rows];
  let cols: string | null = null;
  const project = (rs: Record<string, unknown>[]) => {
    if (!cols || cols === "*" || cols.includes("!") || cols.includes("(")) return rs;
    const fields = cols.split(",").map((c) => c.trim());
    return rs.map((r) => {
      const out: Record<string, unknown> = {};
      for (const f of fields) out[f] = r[f];
      return out;
    });
  };
  const apply = (c: string, keep: (r: Record<string, unknown>) => boolean) => {
    if (!c.includes(".")) data = data.filter(keep);
    return b;
  };
  const b: Record<string, unknown> = {
    select: (c?: string) => {
      cols = c ?? null;
      return b;
    },
    eq: (c: string, v: unknown) => apply(c, (r) => r[c] === v),
    neq: (c: string, v: unknown) => apply(c, (r) => r[c] !== v),
    in: (c: string, values: unknown[]) => apply(c, (r) => values.includes(r[c])),
    is: (c: string, v: unknown) => apply(c, (r) => (r[c] ?? null) === v),
    not: (c: string, _op: string, v: unknown) => apply(c, (r) => (r[c] ?? null) !== v),
    gte: () => b,
    order: () => b,
    limit: (count: number) => {
      data = data.slice(0, count);
      return b;
    },
    maybeSingle: () => Promise.resolve({ data: project(data)[0] ?? null, error }),
    then: (onF: (v: { data: unknown; error: { message: string } | null }) => unknown) =>
      Promise.resolve({ data: project(data), error }).then(onF),
  };
  return b;
}

const Q_LIVE = {
  id: "q-live", category_id: "C2", point_value: 400, prompt: "P2",
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

function makeAdmin(
  options?: string | {
    resilient?: boolean;
    eligible?: boolean;
    removed?: boolean;
    answered?: boolean;
    recentUndone?: number;
    playGameId?: "G1" | "G2";
  },
) {
  const errorTable = typeof options === "string" ? options : undefined;
  const resilient = typeof options === "object" && options.resilient === true;
  const eligible = typeof options !== "object" || options.eligible !== false;
  const removed = typeof options === "object" && options.removed === true;
  const answered = typeof options !== "object" || options.answered !== false;
  const recentUndone = typeof options === "object" ? options.recentUndone ?? 0 : 0;
  const playGameId = typeof options === "object" ? options.playGameId ?? "G2" : "G2";
  const seed: Record<string, Record<string, unknown>[]> = {
    nights: [{
      id: NIGHT_ID, venue_name: "V", theme_key: "house", room_code: CODE,
      host_id: HOST_ID, opened_at: null, closed_at: null, scheduled_at: null,
      is_locked: false, room_magic_enabled: true,
      answer_engine: resilient ? "resilient_v1" : "legacy",
      current_run_id: resilient ? "run-1" : null,
      room_revision: resilient ? 8 : 0,
      control_revision: resilient ? 5 : 0,
      hosts: { default_theme_key: "house" },
    }],
    games: [{
      id: "G1", game_no: 1, state: "done", started_at: null,
      ended_at: "2026-06-07T00:10:00Z", category_count: 1,
      question_count: 7, night_id: NIGHT_ID,
    }, {
      id: "G2", game_no: 2, state: "live", started_at: "2026-06-07T00:11:00Z",
      ended_at: null, category_count: 1, question_count: 7, night_id: NIGHT_ID,
    }],
    categories: [{
      id: "C1", game_id: "G1", name: "Cat", topic: "t", position: 0,
      color: null, state: "ready",
    }, {
      id: "C2", game_id: "G2", name: "Cat 2", topic: "t2", position: 0,
      color: null, state: "ready",
    }],
    questions: [Q_LIVE, Q_RESOLVED],
    players: [{
      id: PLAYER_ID, display_name: "Alice", night_id: NIGHT_ID,
      device_id: DEVICE_ID_LEAK, joined_at: "2026-06-07T00:00:00Z",
      last_seen_at: null,
      removed_at: removed ? "2026-06-07T00:00:03Z" : null,
      app_switch_total_seconds: 0,
    }, {
      id: OTHER_PLAYER_ID, display_name: "Bob", night_id: NIGHT_ID,
      device_id: "OTHER-DEVICE-ID-LEAK", joined_at: "2026-06-07T00:00:01Z",
      last_seen_at: null, removed_at: null, app_switch_total_seconds: 0,
    }],
    reveals: [],
    game_scores: [{
      game_id: "G1", player_id: PLAYER_ID, display_name: "Alice", score: 500,
      answered_count: 1, correct_count: 1, fastest_correct_ms: 1200,
    }, {
      game_id: "G2", player_id: PLAYER_ID, display_name: "Alice", score: 0,
      answered_count: 0, correct_count: 0, fastest_correct_ms: null,
    }],
    answers: [{
      id: ANSWER_ID, player_id: PLAYER_ID, question_id: "q-resolved",
      chosen_index: 3, scramble: SCRAMBLE, ms_to_lock: 1200,
      is_correct: true, awarded_points: 500, locked_at: "2026-06-07T00:00:10Z",
    }, {
      // Another player's answer on the LIVE question — the anti-cheat target:
      // a player must NOT receive this via liveAnswers while the question is open.
      id: OTHER_ANSWER_ID, player_id: OTHER_PLAYER_ID, question_id: "q-live",
      chosen_index: 0, scramble: [0, 1, 2, 3], ms_to_lock: 800,
      is_correct: null, awarded_points: null, locked_at: "2026-06-07T00:00:05Z",
    }],
    game_participations: [{ id: PARTICIPATION_ID, player_id: PLAYER_ID, game_id: "G1" }],
    room_magic_reactions: [{
      id: "reaction-1",
      night_id: NIGHT_ID,
      question_id: "q-resolved",
      player_id: PLAYER_ID,
      kind: "wow",
      created_at: "2026-06-07T00:00:22Z",
    }],
    question_plays: resilient ? [
      ...Array.from({ length: recentUndone }, (_, index) => ({
        id: `undone-${index}`, night_id: NIGHT_ID, run_id: "run-1", game_id: playGameId,
        category_id: playGameId === "G2" ? "C2" : "C1",
        question_id: `undone-question-${index}`,
        status: "undone", opened_at: `2026-06-07T00:01:0${index}Z`,
        main_zero_at: "2026-06-07T00:01:30Z",
        final_window_starts_at: null,
        final_window_ends_at: "2026-06-07T00:01:32Z", finalize_at: null,
        eligible_count: 1, confirmed_count: 0,
      })),
      {
      id: "play-1", night_id: NIGHT_ID, run_id: "run-1", game_id: playGameId,
      category_id: playGameId === "G2" ? "C2" : "C1",
      question_id: playGameId === "G2" ? "q-live" : "q-resolved",
      status: playGameId === "G2" ? "accepting" : "resolved",
      opened_at: "2026-06-07T00:00:00Z",
      main_zero_at: "2026-06-07T00:00:30Z",
      final_window_starts_at: null,
      final_window_ends_at: "2026-06-07T00:00:32Z", finalize_at: null,
      eligible_count: eligible ? 1 : 0, confirmed_count: answered ? 1 : 0,
      },
    ] : [],
    question_play_eligibility: resilient && eligible ? [{
      play_id: "play-1", player_id: PLAYER_ID, night_id: NIGHT_ID,
      frozen_at: "2026-06-07T00:00:00Z", eligibility_reason: "DO-NOT-LEAK",
    }] : [],
    question_play_answers: resilient && answered ? [{
      play_id: "play-1", player_id: PLAYER_ID,
      submission_id: "SUBMISSION-ID-LEAK", visible_slot: 3, canonical_index: 1,
      received_at: "2026-06-07T00:00:04Z",
      locked_at: "2026-06-07T00:00:04Z", ms_to_lock: 4_000,
      is_correct: null, awarded_points: null, device_id: "DEVICE-ANSWER-LEAK",
    }, {
      play_id: "old-play", player_id: OTHER_PLAYER_ID,
      submission_id: "OLD-SUBMISSION-ID", visible_slot: 1, canonical_index: 3,
      received_at: "2026-06-06T00:00:04Z",
      locked_at: "2026-06-06T00:00:04Z", ms_to_lock: 100,
      is_correct: true, awarded_points: 700,
    }] : [],
  };
  return {
    from: vi.fn((table: string) => qb(
      seed[table] ?? [],
      table === errorTable ? { message: "RAW-DATABASE-ERROR-LEAK" } : null,
    )),
  };
}

async function callRoute() {
  const { GET } = await import("@/app/api/room/[code]/snapshot/route");
  return GET(new NextRequest(`http://test/api/room/${CODE}/snapshot`), {
    params: Promise.resolve({ code: CODE }),
  });
}

describe("GET /api/room/[code]/snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "snapshot-test-secret";
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin());
    authMock.hasHostSessionCookie.mockResolvedValue(false);
  });

  it("403s when the caller is neither the owning host nor a player in the room", async () => {
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(null);
    const res = await callRoute();
    expect(res.status).toBe(403);
  });

  it("PLAYER mode: withholds live correct_index, exposes resolved, returns only signed-player state", async () => {
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.currentQuestion.id).toBe("q-live");
    expect(body.currentQuestion).not.toHaveProperty("correctIndex");
    expect(body.lastResolvedQuestion.id).toBe("q-resolved");
    expect(body.lastResolvedQuestion.correctIndex).toBe(3);

    // Board withholds the live answer index entirely.
    const allJson = JSON.stringify(body.allQuestions);
    expect(body.allQuestions.find((question: { id: string }) => question.id === "q-live"))
      .not.toHaveProperty("correctIndex");
    expect(allJson).toContain('"correctIndex":3');

    // Player's own data present.
    expect(body).toMatchObject({
      audience: "player",
      self: { playerKey: expect.any(String), displayName: "Alice" },
    });
    expect(body.myAnswers).toHaveLength(1);
    expect(body.myAnswers[0]).toMatchObject({
      questionId: "q-resolved",
      chosenIndex: 3,
      scramble: SCRAMBLE,
    });
    expect(body.myParticipations).toHaveLength(1);
    expect(body.questionScrambles["q-live"]).toEqual(scrambleFor("q-live", PLAYER_ID));
    expect(body.roomMagicReactions).toEqual([]);
  });

  it("PLAYER mode: skips Supabase host authentication when no host session cookie exists", async () => {
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);

    const res = await callRoute();

    expect(res.status).toBe(200);
    expect(authMock.getAuthedHost).not.toHaveBeenCalled();
  });

  it("coalesces concurrent room-wide loads while keeping player responses independent", async () => {
    const admin = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);

    const [first, second] = await Promise.all([callRoute(), callRoute()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const callsFor = (table: string) =>
      admin.from.mock.calls.filter(([calledTable]) => calledTable === table).length;
    for (const sharedTable of [
      "nights",
      "games",
      "categories",
      "questions",
      "reveals",
      "game_scores",
    ]) {
      expect(callsFor(sharedTable), sharedTable).toBe(1);
    }
    // Identity and personal history remain per-request and are never shared.
    expect(callsFor("players")).toBe(3);
    expect(callsFor("answers")).toBe(2);
    expect(callsFor("game_participations")).toBe(2);
  });

  it("PLAYER mode: exposes only its own scrambled answer and never another player's live choice", async () => {
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    const json = JSON.stringify(body);

    expect(json).not.toContain(DEVICE_ID_LEAK);
    expect(json).not.toContain("OTHER-DEVICE-ID-LEAK");
    expect(body.myAnswers[0].scramble).toEqual(SCRAMBLE);
    expect(json).not.toContain(OTHER_ANSWER_ID);
    expect(body).not.toHaveProperty("liveAnswers");
  });

  it("PLAYER mode: never serializes raw night, player, answer, or participation identifiers anywhere in the response", async () => {
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);

    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    const json = JSON.stringify(body);

    for (const rawIdentifier of [
      NIGHT_ID,
      HOST_ID,
      PLAYER_ID,
      OTHER_PLAYER_ID,
      ANSWER_ID,
      OTHER_ANSWER_ID,
      PARTICIPATION_ID,
    ]) {
      expect(json).not.toContain(rawIdentifier);
    }
    expect(body.self).toMatchObject({ displayName: "Alice" });
    expect(body.self.playerKey).toEqual(expect.any(String));
    expect(body.players.map((player: { displayName: string }) => player.displayName))
      .toEqual(["Alice", "Bob"]);
    expect(body.myAnswers[0]).not.toHaveProperty("id");
    expect(body.myAnswers[0]).not.toHaveProperty("playerId");
    expect(body.myParticipations[0]).not.toHaveProperty("id");
    expect(body.myParticipations[0]).not.toHaveProperty("playerId");
  });

  it("PLAYER mode: carries prior-game standings separately from current-game scores", async () => {
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);

    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.scores).toEqual([
      expect.objectContaining({ gameId: "G2", playerKey: expect.any(String), score: 0 }),
    ]);
    expect(body.allScores).toEqual(expect.arrayContaining([
      expect.objectContaining({ gameId: "G1", playerKey: expect.any(String), score: 500 }),
      expect.objectContaining({ gameId: "G2", playerKey: expect.any(String), score: 0 }),
    ]));
  });

  it("HOST mode: owning host gets room state with the same gating", async () => {
    authMock.hasHostSessionCookie.mockResolvedValue(true);
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: HOST_ID } });
    authMock.getDeviceId.mockResolvedValue(null);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currentQuestion).not.toHaveProperty("correctIndex");
    expect(body.lastResolvedQuestion.correctIndex).toBe(3);
    // Host mode carries no player-scoped data.
    expect(body).toMatchObject({ audience: "host", self: null });
    expect(body).not.toHaveProperty("myAnswers");
    expect(body.tvPlayerKeys).toEqual({
      [PLAYER_ID]: presentationKey(
        "snapshot-test-secret",
        "tv",
        "player",
        NIGHT_ID,
        PLAYER_ID,
      ),
      [OTHER_PLAYER_ID]: presentationKey(
        "snapshot-test-secret",
        "tv",
        "player",
        NIGHT_ID,
        OTHER_PLAYER_ID,
      ),
    });
    expect(body.roomMagicReactions).toEqual([
      {
        id: "reaction-1",
        kind: "wow",
        serverNow: "2026-06-07T00:00:22Z",
      },
    ]);
    expect(JSON.stringify(body.roomMagicReactions)).not.toContain("player");
    expect(JSON.stringify(body.roomMagicReactions)).not.toContain("question");
  });

  it("HOST mode: does not echo any player's browser device identity", async () => {
    authMock.hasHostSessionCookie.mockResolvedValue(true);
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: HOST_ID } });
    authMock.getDeviceId.mockResolvedValue(null);
    const res = await callRoute();
    expect(res.status).toBe(200);

    expect(JSON.stringify(await res.json())).not.toContain("DEVICE-ID-LEAK");
  });

  it("PLAYER mode: omits host-only liveAnswers for a LIVE question", async () => {
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    // The live question is the target; a player must not see anyone's live picks.
    expect(body.currentQuestion.id).toBe("q-live");
    expect(body).not.toHaveProperty("liveAnswers");
    // And the other player's chosen index appears nowhere in the payload.
    expect(JSON.stringify(body)).not.toContain(OTHER_ANSWER_ID);
  });

  it("HOST mode: still receives the LIVE question's answers (lock counts work)", async () => {
    authMock.hasHostSessionCookie.mockResolvedValue(true);
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: HOST_ID } });
    authMock.getDeviceId.mockResolvedValue(null);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.liveAnswers).toHaveLength(1);
    expect(body.liveAnswers[0].id).toBe(OTHER_ANSWER_ID);
    // The host needs chosen_index for lock counts / reveal data.
    expect(body.liveAnswers[0].chosenIndex).toBe(0);
    // And question_id, so host fallback mode can still match answers to the
    // live question when deciding whether every eligible player has locked.
    expect(body.liveAnswers[0].questionId).toBe("q-live");
  });

  it("RESILIENT PLAYER: projects only the signed eligible player's canonical play state", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({ resilient: true }));
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);

    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.live).toMatchObject({
      runId: "run-1",
      roomRevision: 8,
      controlRevision: 5,
      playId: "play-1",
      canAnswerThisPlay: true,
      canonicalAnswer: { confirmedSlot: 3, canonicalIndex: 1 },
      play: { eligibleCount: 1, confirmedCount: 1 },
    });
    const json = JSON.stringify(body.live);
    expect(json).not.toContain(PLAYER_ID);
    expect(json).not.toContain("SUBMISSION-ID-LEAK");
    expect(json).not.toContain("DEVICE-ANSWER-LEAK");
    expect(json).not.toContain("DO-NOT-LEAK");
  });

  it("RESILIENT PLAYER: makes a late join watch-only for the already-open play", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({
      resilient: true,
      eligible: false,
      answered: false,
    }));
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);

    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.live.canAnswerThisPlay).toBe(false);
    expect(body.live.canonicalAnswer).toBeNull();
  });

  it("RESILIENT PLAYER: honors frozen eligibility after the player is removed", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({
      resilient: true,
      removed: true,
      answered: false,
    }));
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);

    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.live.canAnswerThisPlay).toBe(true);
    expect(body.live.canonicalAnswer).toBeNull();
  });

  it("RESILIENT HOST: receives only exact-play canonical answers with aggregate operations", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({ resilient: true }));
    authMock.hasHostSessionCookie.mockResolvedValue(true);
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: HOST_ID } });
    authMock.getDeviceId.mockResolvedValue(null);

    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.live.operations).toEqual({
      eligibleCount: 1,
      confirmedCount: 1,
      awaitingCount: 0,
    });
    expect(JSON.stringify(body.live)).not.toContain(PLAYER_ID);
    expect(body.liveAnswers).toEqual([{
      id: `play-1:${PLAYER_ID}`,
      questionId: "q-live",
      playerId: PLAYER_ID,
      chosenIndex: 1,
      lockedAt: "2026-06-07T00:00:04Z",
      msToLock: 4_000,
      isCorrect: null,
      awardedPoints: null,
    }]);
    expect(JSON.stringify(body.liveAnswers)).not.toContain("OLD-SUBMISSION-ID");
    expect(JSON.stringify(body.liveAnswers)).not.toContain("SUBMISSION-ID-LEAK");
  });

  it("RESILIENT PLAYER: a newer undone play clears state instead of reviving an older play", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({
      resilient: true,
      recentUndone: 6,
    }));
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);

    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.live.playId).toBeNull();
    expect(body.live.play).toBeNull();
    expect(body.live.canAnswerThisPlay).toBe(false);
  });

  it("RESILIENT PLAYER: does not carry Game 1 play state into Game 2 before its first question", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({
      resilient: true,
      playGameId: "G1",
      eligible: false,
      answered: false,
    }));
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);

    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.live.playId).toBeNull();
    expect(body.live.play).toBeNull();
    expect(body.live.canAnswerThisPlay).toBe(false);
  });

  it("a signed-in host who does NOT own the night falls through to player auth", async () => {
    authMock.hasHostSessionCookie.mockResolvedValue(true);
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: "other-host" } });
    authMock.getDeviceId.mockResolvedValue(null);
    const res = await callRoute();
    expect(res.status).toBe(403); // not owner, no device cookie either
  });

  it("maps a player snapshot database failure to a generic typed error", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin("nights"));
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    const res = await callRoute();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "server error" });
    expect(JSON.stringify(body)).not.toContain("RAW-DATABASE-ERROR-LEAK");
  });
});
