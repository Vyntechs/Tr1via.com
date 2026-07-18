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

// A chainable, awaitable query stub. Chain methods return `this`; filters
// (eq/is/not) actually narrow the seeded rows so the route's two distinct
// `questions` queries (picked vs live) resolve to faithful subsets; the object
// is thenable so `await`/`Promise.all` resolve it to { data, error }.
function qb(rows: Record<string, unknown>[], error: { message: string } | null = null) {
  let data = [...rows];
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => {
      data = data.filter((r) => r[c] === v);
      return b;
    },
    is: (c: string, v: unknown) => {
      data = data.filter((r) => (r[c] ?? null) === v);
      return b;
    },
    not: (c: string, _op: string, v: unknown) => {
      data = data.filter((r) => (r[c] ?? null) !== v);
      return b;
    },
    order: () => b,
    limit: () => b,
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
  errorTable,
}: { live?: boolean; errorTable?: string } = {}) {
  const seed: Record<string, Record<string, unknown>[]> = {
    nights: [{
      id: NIGHT_ID, venue_name: "V", theme_key: "house", room_code: CODE,
      opened_at: null, closed_at: null, scheduled_at: null, is_locked: false,
      hosts: { default_theme_key: "house" },
    }],
    games: [{
      id: "G1", game_no: 1, state: "live", started_at: null, ended_at: null,
      category_count: 1, question_count: 7, night_id: NIGHT_ID,
    }],
    categories: [{
      id: "C1", game_id: "G1", name: "Cat", topic: "t", position: 0,
      color: null, state: "ready",
    }],
    // With `live: false` there's no open question, so the TV targets the
    // most-recently-resolved one (the reveal screen) via the 'resolve' reveal.
    questions: live ? [Q_UNPLAYED, Q_LIVE, Q_RESOLVED] : [Q_UNPLAYED, Q_RESOLVED],
    players: [
      { id: "P1", display_name: "Alice", night_id: NIGHT_ID,
        joined_at: "2026-06-07T00:00:00Z", last_seen_at: null, removed_at: null },
      { id: "P2", display_name: "Bob", night_id: NIGHT_ID,
        joined_at: "2026-06-07T00:00:01Z", last_seen_at: null, removed_at: null },
    ],
    reveals: live ? [] : [{
      id: "r1", game_id: "G1", question_id: "q-resolved", event: "resolve",
      occurred_at: "2026-06-07T00:00:21Z", metadata: null,
    }],
    game_scores: [],
    answers: [
      // Another player's pick on the LIVE question — the anti-cheat target a
      // player must never read off this public feed while the question is open.
      { id: "a-live", player_id: "P2", question_id: "q-live", chosen_index: 2,
        scramble: [0, 1, 2, 3], ms_to_lock: 850, is_correct: null,
        awarded_points: null, locked_at: "2026-06-07T00:00:05Z" },
      // A pick on the RESOLVED question — the reveal screen legitimately reads it.
      { id: "a-res", player_id: "P1", question_id: "q-resolved", chosen_index: 3,
        scramble: [0, 1, 2, 3], ms_to_lock: 1200, is_correct: true,
        awarded_points: 500, locked_at: "2026-06-07T00:00:10Z" },
    ],
  };
  return {
    from: vi.fn((table: string) => qb(
      seed[table] ?? [],
      table === errorTable ? { message: "RAW-DATABASE-ERROR-LEAK" } : null,
    )),
  };
}

describe("GET /api/tv/[code]/snapshot — answer gating (route level)", () => {
  beforeEach(() => vi.clearAllMocks());

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
