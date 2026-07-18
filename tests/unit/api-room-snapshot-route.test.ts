// Route-level tests — GET /api/room/[code]/snapshot (the degraded-network
// fallback). Pins: (1) auth modes (403 for neither host nor player),
// (2) the SAME correct_index gating the TV feed enforces (live/unplayed →
// withheld; resolved → exposed), (3) player mode returns the player's own
// answers + participations. Supabase admin + auth helpers are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({
  getAuthedHost: vi.fn(),
  getDeviceId: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const CODE = "ABCDEF";
const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const HOST_ID = "host-1";
const DEVICE_ID = "DEVICE-ID-LEAK";
const PLAYER_ID = "P1";
const DEVICE_ID_LEAK = "DEVICE-ID-LEAK";
const SCRAMBLE_LEAK = "SCRAMBLE-LEAK";

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
    is: (c: string, v: unknown) => apply(c, (r) => (r[c] ?? null) === v),
    not: (c: string, _op: string, v: unknown) => apply(c, (r) => (r[c] ?? null) !== v),
    gte: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () => Promise.resolve({ data: project(data)[0] ?? null, error }),
    then: (onF: (v: { data: unknown; error: { message: string } | null }) => unknown) =>
      Promise.resolve({ data: project(data), error }).then(onF),
  };
  return b;
}

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

function makeAdmin(errorTable?: string) {
  const seed: Record<string, Record<string, unknown>[]> = {
    nights: [{
      id: NIGHT_ID, venue_name: "V", theme_key: "house", room_code: CODE,
      host_id: HOST_ID, opened_at: null, closed_at: null, scheduled_at: null,
      is_locked: false, room_magic_enabled: true, hosts: { default_theme_key: "house" },
    }],
    games: [{
      id: "G1", game_no: 1, state: "live", started_at: null, ended_at: null,
      category_count: 1, question_count: 7, night_id: NIGHT_ID,
    }],
    categories: [{
      id: "C1", game_id: "G1", name: "Cat", topic: "t", position: 0,
      color: null, state: "ready",
    }],
    questions: [Q_LIVE, Q_RESOLVED],
    players: [{
      id: PLAYER_ID, display_name: "Alice", night_id: NIGHT_ID,
      device_id: DEVICE_ID_LEAK, joined_at: "2026-06-07T00:00:00Z",
      last_seen_at: null, removed_at: null, app_switch_total_seconds: 0,
    }, {
      id: "P2", display_name: "Bob", night_id: NIGHT_ID,
      device_id: "OTHER-DEVICE-ID-LEAK", joined_at: "2026-06-07T00:00:01Z",
      last_seen_at: null, removed_at: null, app_switch_total_seconds: 0,
    }],
    reveals: [],
    game_scores: [],
    answers: [{
      id: "a1", player_id: PLAYER_ID, question_id: "q-resolved",
      chosen_index: 3, scramble: SCRAMBLE_LEAK, ms_to_lock: 1200,
      is_correct: true, awarded_points: 500, locked_at: "2026-06-07T00:00:10Z",
    }, {
      // Another player's answer on the LIVE question — the anti-cheat target:
      // a player must NOT receive this via liveAnswers while the question is open.
      id: "a2", player_id: "P2", question_id: "q-live",
      chosen_index: 0, scramble: [0, 1, 2, 3], ms_to_lock: 800,
      is_correct: null, awarded_points: null, locked_at: "2026-06-07T00:00:05Z",
    }],
    game_participations: [{ id: "gp1", player_id: PLAYER_ID, game_id: "G1" }],
    room_magic_reactions: [{
      id: "reaction-1",
      night_id: NIGHT_ID,
      question_id: "q-resolved",
      player_id: PLAYER_ID,
      kind: "wow",
      created_at: "2026-06-07T00:00:22Z",
    }],
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
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin());
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
    expect(body.currentQuestion).not.toHaveProperty("correct_index");
    expect(body.lastResolvedQuestion.id).toBe("q-resolved");
    expect(body.lastResolvedQuestion.correct_index).toBe(3);

    // Board withholds the live answer index entirely.
    const allJson = JSON.stringify(body.allQuestions);
    expect(body.allQuestions.find((question: { id: string }) => question.id === "q-live"))
      .not.toHaveProperty("correct_index");
    expect(allJson).toContain('"correct_index":3');

    // Player's own data present.
    expect(body).toMatchObject({
      audience: "player",
      self: { id: PLAYER_ID, displayName: "Alice" },
    });
    expect(body.myAnswers).toHaveLength(1);
    expect(body.myParticipations).toHaveLength(1);
    expect(body.roomMagicReactions).toEqual([]);
  });

  it("PLAYER mode: never exposes a browser identity, answer scramble, or another player's live choice", async () => {
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    const json = JSON.stringify(body);

    expect(json).not.toContain(DEVICE_ID_LEAK);
    expect(json).not.toContain("OTHER-DEVICE-ID-LEAK");
    expect(json).not.toContain(SCRAMBLE_LEAK);
    expect(json).not.toContain('"id":"a2"');
    expect(body).not.toHaveProperty("liveAnswers");
  });

  it("HOST mode: owning host gets room state with the same gating", async () => {
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: HOST_ID } });
    authMock.getDeviceId.mockResolvedValue(null);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currentQuestion).not.toHaveProperty("correct_index");
    expect(body.lastResolvedQuestion.correct_index).toBe(3);
    // Host mode carries no player-scoped data.
    expect(body).toMatchObject({ audience: "host", self: null });
    expect(body).not.toHaveProperty("myAnswers");
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
    expect(JSON.stringify(body)).not.toContain('"id":"a2"');
  });

  it("HOST mode: still receives the LIVE question's answers (lock counts work)", async () => {
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: HOST_ID } });
    authMock.getDeviceId.mockResolvedValue(null);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.liveAnswers).toHaveLength(1);
    expect(body.liveAnswers[0].id).toBe("a2");
    // The host needs chosen_index for lock counts / reveal data.
    expect(body.liveAnswers[0].chosen_index).toBe(0);
    // And question_id, so host fallback mode can still match answers to the
    // live question when deciding whether every eligible player has locked.
    expect(body.liveAnswers[0].question_id).toBe("q-live");
  });

  it("a signed-in host who does NOT own the night falls through to player auth", async () => {
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
