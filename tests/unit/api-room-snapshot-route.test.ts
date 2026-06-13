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
const DEVICE_ID = "device-abc";
const PLAYER_ID = "P1";

// Chainable, awaitable query stub. Real columns filter; join-path filters
// (keys containing ".") are no-ops since the seed rows are already night-scoped.
function qb(rows: Record<string, unknown>[]) {
  let data = [...rows];
  const apply = (c: string, keep: (r: Record<string, unknown>) => boolean) => {
    if (!c.includes(".")) data = data.filter(keep);
    return b;
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => apply(c, (r) => r[c] === v),
    is: (c: string, v: unknown) => apply(c, (r) => (r[c] ?? null) === v),
    not: (c: string, _op: string, v: unknown) => apply(c, (r) => (r[c] ?? null) !== v),
    order: () => b,
    limit: () => b,
    maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
    then: (onF: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(onF),
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

function makeAdmin() {
  const seed: Record<string, Record<string, unknown>[]> = {
    nights: [{
      id: NIGHT_ID, venue_name: "V", theme_key: "house", room_code: CODE,
      host_id: HOST_ID, opened_at: null, closed_at: null, scheduled_at: null,
      is_locked: false, hosts: { default_theme_key: "house" },
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
      device_id: DEVICE_ID, joined_at: "2026-06-07T00:00:00Z",
      last_seen_at: null, removed_at: null,
    }],
    reveals: [],
    game_scores: [],
    answers: [{
      id: "a1", player_id: PLAYER_ID, question_id: "q-resolved",
      chosen_index: 3, scramble: [0, 1, 2, 3], ms_to_lock: 1200,
      is_correct: true, awarded_points: 500, locked_at: "2026-06-07T00:00:10Z",
    }, {
      // Another player's answer on the LIVE question — the anti-cheat target:
      // a player must NOT receive this via liveAnswers while the question is open.
      id: "a2", player_id: "P2", question_id: "q-live",
      chosen_index: 0, scramble: [0, 1, 2, 3], ms_to_lock: 800,
      is_correct: null, awarded_points: null, locked_at: "2026-06-07T00:00:05Z",
    }],
    game_participations: [{ id: "gp1", player_id: PLAYER_ID, game_id: "G1" }],
  };
  return { from: vi.fn((table: string) => qb(seed[table] ?? [])) };
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

  it("PLAYER mode: withholds live correct_index, exposes resolved, returns own answers", async () => {
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.currentQuestion.id).toBe("q-live");
    expect(body.currentQuestion.correct_index).toBeNull();
    expect(body.lastResolvedQuestion.id).toBe("q-resolved");
    expect(body.lastResolvedQuestion.correct_index).toBe(3);

    // Board withholds the live answer index entirely.
    const allJson = JSON.stringify(body.allQuestions);
    expect(allJson).not.toContain('"correct_index":1');
    expect(allJson).toContain('"correct_index":3');

    // Player's own data present.
    expect(body.me.id).toBe(PLAYER_ID);
    expect(body.myAnswers).toHaveLength(1);
    expect(body.myParticipations).toHaveLength(1);
  });

  it("HOST mode: owning host gets room state with the same gating", async () => {
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: HOST_ID } });
    authMock.getDeviceId.mockResolvedValue(null);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currentQuestion.correct_index).toBeNull();
    expect(body.lastResolvedQuestion.correct_index).toBe(3);
    // Host mode carries no player-scoped data.
    expect(body.me).toBeNull();
    expect(body.myAnswers).toEqual([]);
  });

  it("PLAYER mode: withholds OTHER players' answers on a LIVE question (liveAnswers empty)", async () => {
    authMock.getAuthedHost.mockResolvedValue({ ok: false, status: 401, error: "x" });
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    // The live question is the target; a player must not see anyone's live picks.
    expect(body.currentQuestion.id).toBe("q-live");
    expect(body.liveAnswers).toEqual([]);
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
  });

  it("a signed-in host who does NOT own the night falls through to player auth", async () => {
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: "other-host" } });
    authMock.getDeviceId.mockResolvedValue(null);
    const res = await callRoute();
    expect(res.status).toBe(403); // not owner, no device cookie either
  });
});
