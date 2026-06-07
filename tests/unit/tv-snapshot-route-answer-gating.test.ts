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
function qb(rows: Record<string, unknown>[]) {
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
    maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
    then: (onF: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(onF),
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

function makeAdmin() {
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
    questions: [Q_UNPLAYED, Q_LIVE, Q_RESOLVED],
    players: [{
      id: "P1", display_name: "Alice", joined_at: "2026-06-07T00:00:00Z",
      last_seen_at: null, removed_at: null,
    }],
    reveals: [],
    game_scores: [],
    answers: [],
  };
  return { from: vi.fn((table: string) => qb(seed[table] ?? [])) };
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
});
