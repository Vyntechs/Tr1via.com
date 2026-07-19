import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const CODE = "ABCDEF";

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
    gte: () => b,
    not: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
    then: (onF: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(onF),
  };
  return b;
}

function makeAdmin(roomMagicEnabled: boolean) {
  const seed: Record<string, Record<string, unknown>[]> = {
    nights: [
      {
        id: NIGHT_ID,
        venue_name: "V",
        theme_key: "house",
        room_code: CODE,
        opened_at: null,
        closed_at: null,
        scheduled_at: null,
        is_locked: false,
        room_magic_enabled: roomMagicEnabled,
        hosts: { default_theme_key: "house" },
      },
    ],
    games: [],
    players: [],
    categories: [],
    questions: [],
    reveals: [],
    game_scores: [],
    answers: [],
    room_magic_reactions: [
      {
        id: "reaction-1",
        night_id: NIGHT_ID,
        question_id: "question-1",
        player_id: "player-1",
        kind: "wow",
        created_at: "2026-07-02T01:54:31.000Z",
      },
      {
        id: "reaction-2",
        night_id: NIGHT_ID,
        question_id: "question-1",
        player_id: "player-2",
        kind: "nice_one",
        created_at: "2026-07-02T01:54:36.000Z",
      },
    ],
  };
  return { from: vi.fn((table: string) => qb(seed[table] ?? [])) };
}

async function callRoute() {
  const { GET } = await import("@/app/api/tv/[code]/snapshot/route");
  return GET(new NextRequest(`http://test/api/tv/${CODE}/snapshot`), {
    params: Promise.resolve({ code: CODE }),
  });
}

describe("GET /api/tv/[code]/snapshot — Room Magic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "snapshot-test-secret";
  });

  it("maps the night-level Room Magic flag onto the TV night payload", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin(true));

    const res = await callRoute();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.night.roomMagicEnabled).toBe(true);
  });

  it("returns recent replay reactions through the TV snapshot without player or question ids", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin(true));

    const res = await callRoute();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.roomMagicReactions).toEqual([
      {
        id: "reaction-1",
        kind: "wow",
        serverNow: "2026-07-02T01:54:31.000Z",
      },
      {
        id: "reaction-2",
        kind: "nice_one",
        serverNow: "2026-07-02T01:54:36.000Z",
      },
    ]);
    expect(JSON.stringify(body.roomMagicReactions)).not.toContain("player");
    expect(JSON.stringify(body.roomMagicReactions)).not.toContain("question");
  });

  it("defaults the TV payload to false when the flag is missing", async () => {
    const admin = makeAdmin(true);
    const nightRows = [
      {
        id: NIGHT_ID,
        venue_name: "V",
        theme_key: "house",
        room_code: CODE,
        opened_at: null,
        closed_at: null,
        scheduled_at: null,
        is_locked: false,
        hosts: { default_theme_key: "house" },
      },
    ];
    admin.from = vi.fn((table: string) =>
      table === "nights" ? qb(nightRows) : qb([]),
    );
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const res = await callRoute();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.night.roomMagicEnabled).toBe(false);
  });
});
